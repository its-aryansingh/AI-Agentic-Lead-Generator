/**
 * POST /scrape/enrich — crawler.service
 *
 * Walks a company's public contact surface (/contact, /about, /team, ...)
 * and returns cleaned page TEXT plus cheap regex pre-hits. It does NOT
 * call an LLM and does NOT decide what is a valid contact — that is the
 * extractor's job in the Next.js app.
 *
 * Contract with the caller:
 *   - one total deadline for the whole job (the caller's HTTP timeout
 *     must be larger than `budget_ms`);
 *   - per-page budget so one slow page cannot eat the whole run;
 *   - every navigation is SSRF-checked before and after redirects;
 *   - text is capped per page and in total so the caller never has to
 *     ship an unbounded payload into a token-billed model.
 *
 * DPDP note: only pages a company publishes as its own business contact
 * surface are fetched. robots.txt is honoured. No login walls, no
 * paywalls, no personal social profiles.
 */

import type { FastifyRequest, FastifyReply } from "fastify"
import type { BrowserContext, Page, Route } from "playwright"

import { newJobContext } from "../lib/browser"
import {
  SsrfBlockedError,
  assertNavigationAllowed,
  assertPublicHostname,
  isUrlStructurallyAllowed,
  normalizeDomain,
} from "../lib/ssrf"

// ---------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------

export interface EnrichScrapeRequest {
  domain: string
  /** Total wall-clock budget for the whole job. Default 30s, max 55s. */
  budget_ms?: number
  /** Extra same-origin paths to try before the defaults. */
  extra_paths?: string[]
  /** Cap on characters returned across all pages. Default 60_000. */
  max_chars?: number
}

export interface EnrichedPage {
  url: string
  title: string
  /** Cleaned, whitespace-collapsed visible text. */
  text: string
  status: number
}

export interface EnrichScrapeResponse {
  domain: string
  pages: EnrichedPage[]
  /** Cheap regex pre-hits. The LLM refines these; it does not replace them. */
  candidate_emails: string[]
  candidate_phones: string[]
  social_links: string[]
  pages_visited: number
  pages_blocked: number
  truncated: boolean
  degraded: boolean
  scraped_at: string
}

// ---------------------------------------------------------------------
// Crawl policy
// ---------------------------------------------------------------------

/** Ordered by contact-density. High-value paths first: the budget may run out. */
const DEFAULT_PATHS = [
  "/contact",
  "/contact-us",
  "/contactus",
  "/about",
  "/about-us",
  "/team",
  "/our-team",
  "/leadership",
  "/people",
  "/",
]

const MAX_PAGES = 6
const PER_PAGE_BUDGET_MS = 9_000
const SETTLE_MS = 700
const DEFAULT_BUDGET_MS = 30_000
const MAX_BUDGET_MS = 55_000
const DEFAULT_MAX_CHARS = 60_000
const PER_PAGE_MAX_CHARS = 14_000

/** Assets that cost bandwidth and never contain a phone number. */
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font", "stylesheet"])

const EMAIL_RX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}/g

/**
 * Indian phone pre-filter. Deliberately loose — it exists to (a) tell the
 * model where to look and (b) let us skip the LLM entirely when a page
 * has no phone-shaped text at all. Authoritative parsing happens in
 * lib/enrichment/validator.ts with libphonenumber-js.
 *
 * Covers: +91 98765 43210 / 0091-98765-43210 / 9876543210 /
 *         011-2634 5678 / (022) 6789 0123 / 1800 123 4567
 */
const IN_PHONE_RX =
  /(?:(?:\+|00)?91[\s.-]?)?(?:\(0?\d{2,4}\)|0?\d{2,4})?[\s.-]?\d{3,5}[\s.-]?\d{4,6}/g

const SOCIAL_RX =
  /https?:\/\/(?:[a-z0-9-]+\.)?(?:linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|github\.com)\/[^\s"'<>)]+/gi

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------

export async function enrichScrapeHandler(
  req: FastifyRequest<{ Body: EnrichScrapeRequest }>,
  reply: FastifyReply,
) {
  const body = req.body ?? ({} as EnrichScrapeRequest)
  if (!body.domain) return reply.code(400).send({ error: "domain is required" })

  let apex: string
  try {
    apex = normalizeDomain(body.domain)
    await assertPublicHostname(apex)
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      req.log.warn({ domain: body.domain, reason: err.message }, "ssrf_blocked")
      return reply.code(422).send({ error: "domain_rejected", code: err.code })
    }
    throw err
  }

  const budgetMs = Math.min(body.budget_ms ?? DEFAULT_BUDGET_MS, MAX_BUDGET_MS)
  const maxChars = Math.min(body.max_chars ?? DEFAULT_MAX_CHARS, DEFAULT_MAX_CHARS)
  const deadline = Date.now() + budgetMs

  const paths = dedupe([...(body.extra_paths ?? []), ...DEFAULT_PATHS]).slice(0, MAX_PAGES + 4)

  let ctx: BrowserContext | null = null
  const pages: EnrichedPage[] = []
  const emails = new Set<string>()
  const phones = new Set<string>()
  const socials = new Set<string>()
  let blocked = 0
  let charCount = 0
  let truncated = false
  let degraded = false

  try {
    ctx = await newJobContext()
    await installRequestGuard(ctx, apex)

    const page = await ctx.newPage()
    page.setDefaultTimeout(PER_PAGE_BUDGET_MS)

    const disallowed = await readRobots(page, apex, deadline)

    for (const path of paths) {
      if (pages.length >= MAX_PAGES) break
      if (Date.now() > deadline - 1_500) {
        truncated = true
        break
      }
      if (charCount >= maxChars) {
        truncated = true
        break
      }
      if (disallowed.some((rule) => path.startsWith(rule))) continue

      const url = `https://${apex}${path}`
      const remaining = Math.max(1_500, Math.min(PER_PAGE_BUDGET_MS, deadline - Date.now()))

      const result = await visitPage(page, url, apex, remaining)
      if (!result.ok) {
        if (result.blocked) blocked++
        continue
      }

      const slice = result.page.text.slice(0, Math.min(PER_PAGE_MAX_CHARS, maxChars - charCount))
      if (slice.length < result.page.text.length) truncated = true

      charCount += slice.length
      pages.push({ ...result.page, text: slice })

      for (const e of slice.match(EMAIL_RX) ?? []) emails.add(e.toLowerCase())
      for (const p of slice.match(IN_PHONE_RX) ?? []) {
        const digits = p.replace(/\D/g, "")
        if (digits.length >= 8 && digits.length <= 13) phones.add(p.trim())
      }
      for (const s of result.rawHtml.match(SOCIAL_RX) ?? []) socials.add(s)
    }
  } catch (err) {
    // A partial result beats a 500: the caller can still extract from
    // whatever pages did land.
    degraded = true
    req.log.error({ err, domain: apex }, "enrich_scrape_failed")
  } finally {
    await ctx?.close().catch(() => undefined)
  }

  if (pages.length === 0 && !degraded) degraded = blocked > 0

  const result: EnrichScrapeResponse = {
    domain: apex,
    pages,
    candidate_emails: [...emails].slice(0, 100),
    candidate_phones: [...phones].slice(0, 100),
    social_links: [...socials].slice(0, 30),
    pages_visited: pages.length,
    pages_blocked: blocked,
    truncated,
    degraded,
    scraped_at: new Date().toISOString(),
  }

  return reply.send(result)
}

// ---------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------

interface VisitResult {
  ok: boolean
  blocked: boolean
  page: EnrichedPage
  rawHtml: string
}

const EMPTY_PAGE: EnrichedPage = { url: "", title: "", text: "", status: 0 }

async function visitPage(
  page: Page,
  url: string,
  apex: string,
  budgetMs: number,
): Promise<VisitResult> {
  try {
    const res = await page.goto(url, { timeout: budgetMs, waitUntil: "domcontentloaded" })
    if (!res) return { ok: false, blocked: false, page: EMPTY_PAGE, rawHtml: "" }

    const status = res.status()

    // 401/403/429 => the site is refusing us. Do not retry, do not evade.
    if (status === 401 || status === 403 || status === 429) {
      return { ok: false, blocked: true, page: EMPTY_PAGE, rawHtml: "" }
    }
    if (status >= 400) return { ok: false, blocked: false, page: EMPTY_PAGE, rawHtml: "" }

    // Redirects may have moved us; re-check where we actually landed.
    await assertNavigationAllowed(page.url(), apex)

    // Give client-rendered contact blocks a moment, but never block on
    // networkidle — ad/analytics beacons keep that pending forever.
    await page.waitForTimeout(Math.min(SETTLE_MS, Math.max(0, budgetMs - 500)))

    const [title, text, rawHtml] = await Promise.all([
      page.title().catch(() => ""),
      extractVisibleText(page),
      page.content().catch(() => ""),
    ])

    return {
      ok: text.length > 0,
      blocked: false,
      page: { url: page.url(), title, text, status },
      rawHtml,
    }
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return { ok: false, blocked: true, page: EMPTY_PAGE, rawHtml: "" }
    }
    // Timeout, DNS failure, connection reset — try the next path.
    return { ok: false, blocked: false, page: EMPTY_PAGE, rawHtml: "" }
  }
}

/**
 * Visible text with chrome stripped, plus mailto:/tel: hrefs promoted
 * into the text. Many Indian sites put the only phone number in a
 * `tel:` href and render an icon, so innerText alone misses it.
 */
async function extractVisibleText(page: Page): Promise<string> {
  return page
    .evaluate(() => {
      for (const el of Array.from(
        document.querySelectorAll("script,style,noscript,svg,iframe,template"),
      )) {
        el.remove()
      }

      const linkContacts: string[] = []
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const href = a.getAttribute("href") ?? ""
        if (href.startsWith("mailto:") || href.startsWith("tel:")) {
          linkContacts.push(decodeURIComponent(href.replace(/^(mailto|tel):/, "")))
        }
      }

      const body = (document.body?.innerText ?? "").replace(/[ \t ]+/g, " ")

      return [body, linkContacts.join("\n")]
        .join("\n")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n")
        .slice(0, 40_000)
    })
    .catch(() => "")
}

/**
 * Belt-and-braces: block every sub-resource that is off-domain, a heavy
 * asset, or pointed at a private address. Playwright's `route` fires for
 * redirects too, so this also catches a 302 into the metadata service.
 */
async function installRequestGuard(ctx: BrowserContext, apex: string): Promise<void> {
  await ctx.route("**/*", async (route: Route) => {
    const request = route.request()
    const url = request.url()

    if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) return route.abort()
    if (!isUrlStructurallyAllowed(url)) return route.abort()

    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
    const sameSite = host === apex || host.endsWith(`.${apex}`)

    // Only the target company's own hosts. Third-party JS is not needed
    // to read a contact page and is where most trackers live.
    if (!sameSite) return route.abort()

    return route.continue()
  })
}

/**
 * Minimal robots.txt reader: honours Disallow for `*` and for our UA.
 * Fetched inside the page context so it goes through the same guard.
 */
async function readRobots(page: Page, apex: string, deadline: number): Promise<string[]> {
  const budget = Math.max(1_000, Math.min(4_000, deadline - Date.now()))
  try {
    const body = await page.evaluate(
      async ([url, timeoutMs]) => {
        const controller = new AbortController()
        const t = setTimeout(() => controller.abort(), timeoutMs as number)
        try {
          const r = await fetch(url as string, { signal: controller.signal })
          return r.ok ? await r.text() : ""
        } catch {
          return ""
        } finally {
          clearTimeout(t)
        }
      },
      [`https://${apex}/robots.txt`, budget] as const,
    )

    if (!body) return []

    const rules: string[] = []
    let applies = false
    for (const rawLine of body.split("\n").slice(0, 500)) {
      const line = rawLine.split("#")[0].trim()
      if (!line) continue
      const [rawKey, ...rest] = line.split(":")
      const key = rawKey.trim().toLowerCase()
      const value = rest.join(":").trim()

      if (key === "user-agent") {
        applies = value === "*" || value.toLowerCase().includes("leadgenai")
      } else if (key === "disallow" && applies && value && value !== "/") {
        rules.push(value)
      } else if (key === "disallow" && applies && value === "/") {
        return ["/"] // Site-wide disallow: crawl nothing.
      }
    }
    return rules
  } catch {
    // robots.txt unreachable — proceed with the default path list only.
    return []
  }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((s) => s.trim()).filter(Boolean))]
}
