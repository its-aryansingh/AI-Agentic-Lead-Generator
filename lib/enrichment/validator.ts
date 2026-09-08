/**
 * validator.ts — deterministic gate between the model and the database.
 *
 * `strict: true` guarantees the SHAPE of the model's JSON. It guarantees
 * nothing about the CONTENT: gpt-4o-mini can still return a phone number
 * that was a GST number, an email from a third-party widget, or a
 * hallucinated address that never appeared on the page. Nothing reaches
 * Postgres without passing through here.
 *
 * Three rules, in order:
 *   1. GROUNDING  — every value must literally appear in the crawled
 *                   text. This is the single most important defence
 *                   against fabricated contacts.
 *   2. VALIDITY   — libphonenumber-js for phones, RFC-ish + MX-able
 *                   shape for emails.
 *   3. RELEVANCE  — on-domain emails rank above off-domain; role
 *                   mailboxes are KEPT (they are the legitimate public
 *                   B2B contact point for most Indian SMEs).
 *
 * Import-light (zod + libphonenumber-js) so it is unit-testable under
 * `node --test --experimental-strip-types`.
 */

// IMPORTANT: the `/max` entry point, not the bare package.
// The default export ships "min" metadata, where getType() returns
// undefined for every number — every landline would be classified
// "unknown" and ranked below toll-free. `/max` adds ~156KB of metadata
// and is the only build with usable type information.
import { parsePhoneNumberFromString, type PhoneNumber } from "libphonenumber-js/max"

import type {
  CrawledPage,
  Extraction,
  IndianPhoneType,
  KeyContact,
  PublicContacts,
  ValidatedEmail,
  ValidatedPhone,
} from "./types"

// ---------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------

/**
 * Role mailboxes. Unlike the current scraper's GENERIC_LOCAL filter,
 * these are RETAINED — for an Indian SME, sales@ or info@ is usually the
 * only published B2B contact point and discarding it throws away the
 * whole point of the crawl. They are flagged so ranking can prefer a
 * named address when one exists.
 */
const ROLE_LOCALPARTS = new Set([
  "info", "contact", "sales", "enquiry", "enquiries", "inquiry", "inquiries",
  "hello", "hi", "support", "help", "helpdesk", "care", "customercare",
  "admin", "office", "reception", "mail", "email", "connect", "reachus",
  "hr", "careers", "jobs", "recruitment", "hiring",
  "accounts", "accounting", "billing", "finance", "payments",
  "marketing", "media", "press", "pr", "partnerships", "business", "bd",
  "legal", "compliance", "grievance", "privacy", "dpo",
  "leadership", "founders", "team", "management", "director", "directors",
  "export", "exports", "purchase", "procurement", "orders", "booking",
])

/** Never useful, or actively wrong to store. */
const JUNK_LOCALPARTS = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply", "bounce", "bounces",
  "mailer-daemon", "postmaster", "abuse", "spam", "unsubscribe",
  "example", "test", "user", "username", "your", "youremail", "name",
  "email", "sentry", "wordpress", "wp",
])

/** Domains belonging to tooling embedded in the page, never the company. */
const VENDOR_DOMAINS = [
  "sentry.io", "wixpress.com", "wix.com", "squarespace.com", "godaddy.com",
  "shopify.com", "hubspot.com", "mailchimp.com", "sendgrid.net", "zoho.com",
  "google.com", "gstatic.com", "facebook.com", "cloudflare.com",
  "example.com", "example.org", "domain.com", "yourdomain.com", "email.com",
]

const EMAIL_SHAPE = /^[a-z0-9._%+-]{1,64}@([a-z0-9-]+\.)+[a-z]{2,24}$/

export function validateEmails(
  raw: string[],
  companyDomain: string,
  haystack: string,
  pageIndex: PageIndex,
): ValidatedEmail[] {
  const apex = companyDomain.toLowerCase().replace(/^www\./, "")
  // Grounding must be case-insensitive. Sites routinely publish a named
  // address as "Priya.Sharma@acme.in"; comparing a lower-cased candidate
  // against raw page text drops exactly the addresses worth having.
  const hay = haystack.toLowerCase()
  const seen = new Set<string>()
  const out: ValidatedEmail[] = []

  for (const candidate of raw) {
    const value = candidate
      .trim()
      .toLowerCase()
      .replace(/^mailto:/, "")
      .replace(/[.,;:)\]]+$/, "")
      .split("?")[0]

    if (!value || seen.has(value)) continue
    if (!EMAIL_SHAPE.test(value)) continue

    const [local, domain] = value.split("@")
    if (JUNK_LOCALPARTS.has(local)) continue
    if (VENDOR_DOMAINS.some((v) => domain === v || domain.endsWith(`.${v}`))) continue

    // Image-file false positives: logo@2x.png style strings.
    if (/\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/.test(domain)) continue

    // GROUNDING: it must actually have been on a page we fetched.
    if (!hay.includes(value)) continue

    seen.add(value)
    out.push({
      value,
      role: ROLE_LOCALPARTS.has(local),
      on_domain: domain === apex || domain.endsWith(`.${apex}`),
      page_url: pageIndex.find(value),
    })
  }

  // Named on-domain > role on-domain > named off-domain > role off-domain.
  return out.sort((a, b) => score(b) - score(a))

  function score(e: ValidatedEmail): number {
    return (e.on_domain ? 2 : 0) + (e.role ? 0 : 1)
  }
}

// ---------------------------------------------------------------------
// Phone — India-aware
// ---------------------------------------------------------------------

/**
 * Strings that look like phone numbers but are not. Indian business
 * pages are full of these, and every one of them costs a wasted call
 * if it reaches the dialler.
 */
function isNotAPhone(digits: string, rawContext: string): boolean {
  // GSTIN: 15 chars, 2-digit state + 10-char PAN + 3. Its digit run
  // frequently matches the loose phone regex.
  if (/\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]{2}\b/i.test(rawContext)) return true
  // CIN (21 chars), PAN, PIN codes, years, prices.
  if (/\b[LUu]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/i.test(rawContext)) return true
  if (/^(19|20)\d{2}$/.test(digits)) return true
  if (/^\d{6}$/.test(digits)) return true          // PIN code
  if (/^0+$/.test(digits)) return true
  if (/^(\d)\1{7,}$/.test(digits)) return true     // 0000000000, 9999999999
  if (/^1234567/.test(digits)) return true
  return false
}

/**
 * 1800 / 1860 / 1600 are India's customer-service ranges. libphonenumber
 * types 1860 as SHARED_COST rather than TOLL_FREE, so check the prefix
 * first and let metadata be the fallback, not the other way round.
 */
const TOLLFREE_PREFIXES = ["1800", "1860", "1600"]

function classifyIndian(pn: PhoneNumber): IndianPhoneType {
  const national = pn.nationalNumber.toString()

  if (TOLLFREE_PREFIXES.some((p) => national.startsWith(p))) return "tollfree"

  switch (pn.getType()) {
    case "MOBILE":
      return "mobile"
    case "FIXED_LINE":
      return "landline"
    case "FIXED_LINE_OR_MOBILE":
      // India's mobile ranges are 10 digits starting 6-9. When the
      // metadata is ambiguous, that rule decides.
      return national.length === 10 && /^[6-9]/.test(national) ? "mobile" : "landline"
    case "TOLL_FREE":
    case "SHARED_COST":
      return "tollfree"
    case "VOIP":
    case "PREMIUM_RATE":
    case "PERSONAL_NUMBER":
    case "PAGER":
    case "UAN":
    case "VOICEMAIL":
      return "unknown"
    default:
      // getType() returned undefined (unrecognised range). Fall back to
      // the digit-shape rule rather than discarding the number.
      return national.length === 10 && /^[6-9]/.test(national) ? "mobile" : "unknown"
  }
}

export function validatePhones(
  raw: string[],
  haystack: string,
  pageIndex: PageIndex,
): ValidatedPhone[] {
  const seen = new Set<string>()
  const out: ValidatedPhone[] = []

  for (const candidate of raw) {
    const trimmed = candidate.trim()
    if (!trimmed) continue

    const digits = trimmed.replace(/\D/g, "")
    if (digits.length < 8 || digits.length > 13) continue
    if (isNotAPhone(digits, trimmed)) continue

    // GROUNDING: compare on digits, because the model is allowed to
    // return the number with different spacing than the page used.
    if (!haystack.includes(trimmed) && !groundedByDigits(digits, haystack)) continue

    // Default region IN: bare 9876543210 and 011-26345678 both parse.
    const pn =
      parsePhoneNumberFromString(trimmed, "IN") ??
      parsePhoneNumberFromString(`+${digits}`)

    if (!pn || !pn.isValid()) continue
    if (pn.country !== "IN") continue // This pipeline is India-scoped.

    const e164 = pn.number
    if (seen.has(e164)) continue
    seen.add(e164)

    out.push({
      e164,
      raw: trimmed,
      type: classifyIndian(pn),
      page_url: pageIndex.find(trimmed) ?? pageIndex.findDigits(digits),
    })
  }

  // Mobile first (reachable on WhatsApp, which this product already
  // sends on), then landline, then toll-free.
  const rank: Record<IndianPhoneType, number> = {
    mobile: 3, landline: 2, tollfree: 1, unknown: 0,
  }
  return out.sort((a, b) => rank[b.type] - rank[a.type])
}

/** Digit-only containment check, ignoring the page's separators. */
function groundedByDigits(digits: string, haystack: string): boolean {
  const tail = digits.slice(-10)
  if (tail.length < 8) return false
  // Strip separators from the haystack once per call is expensive on a
  // 60k-char string, so match a spaced pattern instead.
  const spaced = tail.split("").join("[\\s.\\-()]*")
  return new RegExp(spaced).test(haystack)
}

// ---------------------------------------------------------------------
// Key contacts + social links
// ---------------------------------------------------------------------

const NAME_SHAPE = /^[\p{L}][\p{L}\p{M}.'-]*(?:\s+[\p{L}][\p{L}\p{M}.'-]*){0,4}$/u

export function validateKeyContacts(
  raw: KeyContact[],
  haystack: string,
  pageIndex: PageIndex,
): Array<KeyContact & { page_url: string | null }> {
  const seen = new Set<string>()
  const out: Array<KeyContact & { page_url: string | null }> = []

  for (const c of raw) {
    const name = c.name?.trim() ?? ""
    const title = c.title?.trim() ?? ""
    if (!name || name.length > 80 || title.length > 120) continue
    if (!NAME_SHAPE.test(name)) continue

    const key = name.toLowerCase()
    if (seen.has(key)) continue
    if (!haystack.toLowerCase().includes(key)) continue // GROUNDING

    seen.add(key)
    out.push({ name, title, page_url: pageIndex.find(name) })
  }

  return out.slice(0, 25)
}

const SOCIAL_HOSTS = [
  "linkedin.com", "twitter.com", "x.com", "facebook.com",
  "instagram.com", "youtube.com", "github.com",
]

export function validateSocialLinks(raw: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const candidate of raw) {
    let url: URL
    try {
      url = new URL(candidate.trim())
    } catch {
      continue
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue

    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    if (!SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) continue

    // Bare profile roots (linkedin.com/feed) carry no information.
    if (url.pathname === "/" || url.pathname === "") continue
    if (/^\/(feed|share|sharer|intent|home)\b/.test(url.pathname)) continue

    const normalized = `${url.protocol}//${host}${url.pathname.replace(/\/$/, "")}`
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }

  return out.slice(0, 15)
}

// ---------------------------------------------------------------------
// Page index — maps a value back to the page it was seen on (provenance)
// ---------------------------------------------------------------------

export interface PageIndex {
  find(value: string): string | null
  findDigits(digits: string): string | null
}

export function buildPageIndex(pages: CrawledPage[]): PageIndex {
  return {
    find(value: string): string | null {
      if (!value) return null
      const needle = value.toLowerCase()
      for (const p of pages) {
        if (p.text.toLowerCase().includes(needle)) return p.url
      }
      return null
    },
    findDigits(digits: string): string | null {
      const tail = digits.slice(-10)
      if (tail.length < 8) return null
      const rx = new RegExp(tail.split("").join("[\\s.\\-()]*"))
      for (const p of pages) {
        if (rx.test(p.text)) return p.url
      }
      return null
    },
  }
}

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------

export function validateExtraction(
  extraction: Extraction,
  pages: CrawledPage[],
  companyDomain: string,
): PublicContacts {
  const haystack = pages.map((p) => p.text).join("\n")
  const pageIndex = buildPageIndex(pages)

  return {
    emails: validateEmails(extraction.emails, companyDomain, haystack, pageIndex),
    phones: validatePhones(extraction.phones, haystack, pageIndex),
    key_contacts: validateKeyContacts(extraction.key_contacts, haystack, pageIndex),
    social_links: validateSocialLinks(extraction.social_links),
    source_urls: pages.map((p) => p.url),
    extracted_at: new Date().toISOString(),
  }
}

/**
 * Pick the single email/phone that gets projected onto the flat
 * prospects.email / prospects.phone columns. Everything else stays in
 * prospects.public_contacts.
 */
export function pickPrimary(contacts: PublicContacts): {
  email: string | null
  phone: string | null
  phone_e164: string | null
} {
  const email = contacts.emails.find((e) => e.on_domain) ?? contacts.emails[0] ?? null
  const phone =
    contacts.phones.find((p) => p.type === "mobile") ??
    contacts.phones.find((p) => p.type === "landline") ??
    contacts.phones[0] ??
    null

  return {
    email: email?.value ?? null,
    phone: phone?.e164 ?? phone?.raw ?? null,
    phone_e164: phone?.e164 ?? null,
  }
}
