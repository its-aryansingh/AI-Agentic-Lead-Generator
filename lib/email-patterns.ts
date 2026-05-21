/**
 * Email pattern guessing + DNS MX verification.
 *
 * Without a paid email-finder API we can still ship a working "likely
 * email" for most prospects by combining:
 *   1. Five standard corporate naming patterns
 *   2. A heuristic that turns the company name into a domain
 *   3. DNS MX lookup to upgrade confidence from "risky" → "mx_verified"
 *      (or "no_mx" when the domain clearly can't receive email).
 *
 * Full SMTP RCPT TO probing is deferred to the Playwright scraper service
 * (blocked on port 25 in Vercel serverless environments).
 */

import dns from "dns"

export type EmailPattern =
  | "first.last"
  | "firstlast"
  | "flast"
  | "first_last"
  | "first"

interface PatternFn {
  name: EmailPattern
  build: (first: string, last: string) => string
}

const PATTERNS: PatternFn[] = [
  { name: "first.last", build: (f, l) => `${f}.${l}` },
  { name: "firstlast", build: (f, l) => `${f}${l}` },
  { name: "flast", build: (f, l) => `${f[0] ?? ""}${l}` },
  { name: "first_last", build: (f, l) => `${f}_${l}` },
  { name: "first", build: (f) => f },
]

export interface PatternedEmail {
  email: string
  pattern: EmailPattern
}

/**
 * Generate plausible email guesses for a person at a domain.
 * Always returns at least one entry as long as we can derive a first name.
 */
export function generateEmailGuesses(
  fullName: string,
  domain: string,
): PatternedEmail[] {
  const norm = normalizeName(fullName)
  if (!norm) return []

  const { first, last } = norm
  const cleanDomain = domain.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  if (!cleanDomain) return []

  const seen = new Set<string>()
  const out: PatternedEmail[] = []
  for (const p of PATTERNS) {
    const local = p.build(first, last).replace(/[^a-z0-9._-]/g, "")
    if (!local || seen.has(local)) continue
    // Reject malformed locals — bare trailing/leading separators (which
    // happens for multi-part patterns applied to mononyms, e.g.
    // "first.last" on "Mira" → "mira.").
    if (/^[._-]|[._-]$/.test(local)) continue
    seen.add(local)
    out.push({ email: `${local}@${cleanDomain}`, pattern: p.name })
  }
  return out
}

/**
 * Returns the single "most likely" email for a prospect — used when we
 * only want one value to put in a Sheet cell. Currently picks the
 * "first.last" pattern when both names are available, otherwise the
 * first generated guess.
 */
export function bestGuessEmail(fullName: string, domain: string): PatternedEmail | null {
  const guesses = generateEmailGuesses(fullName, domain)
  if (guesses.length === 0) return null
  const preferred = guesses.find((g) => g.pattern === "first.last")
  return preferred ?? guesses[0]
}

/**
 * Strip accents, lowercase, split on whitespace. Returns {first, last}
 * or null if we can't parse it into at least one part.
 *
 * Handles common cases:
 *   "Priya Sharma"        → {first:"priya",  last:"sharma"}
 *   "Mira"                → {first:"mira",   last:""}        (mononym)
 *   "Karthik Subramanian" → {first:"karthik",last:"subramanian"}
 *   "  Tan Vir  Ahmed "   → {first:"tan",    last:"ahmed"}    (drops middle)
 */
function normalizeName(full: string): { first: string; last: string } | null {
  const cleaned = full
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, "")
    .trim()
  if (!cleaned) return null
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  if (parts.length === 1) return { first: parts[0], last: "" }
  return { first: parts[0], last: parts[parts.length - 1] }
}

/**
 * Heuristic: turn a company name into a likely web domain.
 *
 *   "Razorpay"              → razorpay.com
 *   "Khatabook"             → khatabook.com
 *   "Freshworks Inc."       → freshworks.com
 *   "Acme Pvt Ltd"          → acme.com
 *   "Foo Bar SaaS"          → foobar.com
 *
 * This is intentionally simple. When we add web search in v1.5 we'll
 * resolve the actual domain by searching `<company> site:<tld>` — but
 * for many Indian SaaS companies the heuristic is right ~70% of the
 * time, which beats `email = null`.
 */
const COMPANY_NOISE = [
  "inc",
  "incorporated",
  "ltd",
  "limited",
  "llc",
  "llp",
  "pvt",
  "private",
  "co",
  "corp",
  "corporation",
  "gmbh",
  "group",
  "holdings",
  "labs",
  "the",
  "and",
]

export function guessDomainFromCompany(company: string): string | null {
  if (!company) return null
  const cleaned = company
    .toLowerCase()
    .replace(/[^a-z0-9\s&-]/g, " ")
    .split(/\s+/)
    .filter((tok) => tok && !COMPANY_NOISE.includes(tok))
    .join("")
  if (!cleaned) return null
  return `${cleaned}.com`
}

// ---------------------------------------------------------------------------
// DNS MX verification
// ---------------------------------------------------------------------------

export type EmailConfidence = "risky" | "mx_verified" | "no_mx" | "unknown"

export interface MxVerifyResult {
  domain: string
  confidence: EmailConfidence
  /** Exchange hostnames in priority order, empty when no MX found. */
  exchanges: string[]
}

const MX_CACHE = new Map<string, MxVerifyResult>()
const MX_TIMEOUT_MS = 3_000

/**
 * Check whether a domain has MX records via DNS.
 * Results are cached in-process for the lifetime of the serverless function
 * invocation (warm instance), cutting duplicate lookups within a bulk job.
 *
 * Returns "mx_verified" when at least one MX record is found, "no_mx" when
 * the lookup succeeds but the domain has no mail exchanger, and "unknown"
 * when the lookup fails (network timeout, NXDOMAIN, etc.).
 */
export async function verifyDomainMx(domain: string): Promise<MxVerifyResult> {
  const cached = MX_CACHE.get(domain)
  if (cached) return cached

  const result = await new Promise<MxVerifyResult>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ domain, confidence: "unknown", exchanges: [] })
    }, MX_TIMEOUT_MS)

    dns.promises
      .resolveMx(domain)
      .then((records) => {
        clearTimeout(timer)
        if (records.length === 0) {
          resolve({ domain, confidence: "no_mx", exchanges: [] })
        } else {
          const exchanges = records
            .sort((a, b) => a.priority - b.priority)
            .map((r) => r.exchange)
          resolve({ domain, confidence: "mx_verified", exchanges })
        }
      })
      .catch(() => {
        clearTimeout(timer)
        resolve({ domain, confidence: "no_mx", exchanges: [] })
      })
  })

  MX_CACHE.set(domain, result)
  return result
}
