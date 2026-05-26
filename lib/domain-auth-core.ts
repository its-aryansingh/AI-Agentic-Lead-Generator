/**
 * Pure SPF / DKIM / DMARC parsers. Kept import-free so
 * `node --test --experimental-strip-types` can load them. The async
 * DNS lookup layer (lib/domain-auth.ts) wraps these with TXT/MX
 * resolution and produces the final report.
 *
 * Why this matters: cold outbound emails land in spam when any of
 * SPF / DKIM / DMARC are misconfigured. Surfacing the gap before the
 * first send saves the user a deliverability disaster.
 */

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

export function isValidDomain(s: string): boolean {
  if (typeof s !== "string") return false
  const trimmed = s.trim().toLowerCase()
  if (!trimmed) return false
  if (trimmed.length > 253) return false
  return DOMAIN_RE.test(trimmed)
}

// ---------- SPF ----------

export type SpfPolicy = "pass" | "soft_fail" | "hard_fail" | "neutral" | "none"

export interface SpfAnalysis {
  found: boolean
  record: string | null
  policy: SpfPolicy
  /** Number of `include:` / `redirect=` mechanisms. */
  lookup_count_estimate: number
  issues: string[]
}

/**
 * Parse a single SPF TXT record string. Returns null if the record
 * doesn't begin with the SPF version marker — callers can use that to
 * filter candidates when multiple TXT records are returned.
 */
export function parseSpfRecord(record: string): SpfAnalysis | null {
  if (typeof record !== "string") return null
  const r = record.trim()
  if (!/^v=spf1\b/i.test(r)) return null

  const mechanisms = r.split(/\s+/).slice(1) // drop "v=spf1"
  const issues: string[] = []
  let policy: SpfPolicy = "none"
  for (const m of mechanisms) {
    if (/^([+~?-]?)all$/i.test(m)) {
      const prefix = m[0]
      if (prefix === "-") policy = "hard_fail"
      else if (prefix === "~") policy = "soft_fail"
      else if (prefix === "?") policy = "neutral"
      else policy = "pass" // "+all" or just "all"
    }
  }

  if (policy === "none") {
    issues.push("SPF record has no `all` mechanism — receivers have no instruction for unauthorized senders")
  } else if (policy === "pass") {
    issues.push("SPF policy is `+all` — accepts mail from anywhere; effectively no protection")
  } else if (policy === "neutral") {
    issues.push("SPF policy is `?all` (neutral) — explicitly does not assert pass/fail")
  }

  // Cheap lookup-count estimate. RFC 7208 limits to 10; over that and
  // receivers may PermError the whole record.
  const lookupCount = mechanisms.filter((m) =>
    /^(include:|a:|mx:|ptr:|exists:|redirect=)/i.test(m),
  ).length
  if (lookupCount > 10) {
    issues.push(`SPF record has ${lookupCount} lookups (> RFC 7208 limit of 10) — may PermError`)
  }

  return {
    found: true,
    record: r,
    policy,
    lookup_count_estimate: lookupCount,
    issues,
  }
}

// ---------- DMARC ----------

export type DmarcPolicy = "none" | "quarantine" | "reject" | null

export interface DmarcAnalysis {
  found: boolean
  record: string | null
  policy: DmarcPolicy
  subdomain_policy: DmarcPolicy
  pct: number | null
  has_rua: boolean
  has_ruf: boolean
  issues: string[]
}

const DMARC_TAG_RE = /([a-z]+)=([^;]+)/gi

export function parseDmarcRecord(record: string): DmarcAnalysis | null {
  if (typeof record !== "string") return null
  const r = record.trim()
  if (!/^v=DMARC1\b/i.test(r)) return null

  const tags: Record<string, string> = {}
  let m: RegExpExecArray | null
  DMARC_TAG_RE.lastIndex = 0
  while ((m = DMARC_TAG_RE.exec(r)) !== null) {
    tags[m[1].toLowerCase()] = m[2].trim()
  }

  const policy = normalizeDmarcPolicy(tags["p"])
  const subPolicy = normalizeDmarcPolicy(tags["sp"]) ?? policy
  let pct: number | null = null
  if (tags["pct"]) {
    const n = Number.parseInt(tags["pct"], 10)
    if (!Number.isNaN(n) && n >= 0 && n <= 100) pct = n
  }
  const hasRua = Boolean(tags["rua"])
  const hasRuf = Boolean(tags["ruf"])

  const issues: string[] = []
  if (!policy) {
    issues.push("DMARC record has no `p=` tag — receivers default to `none` (monitor-only)")
  } else if (policy === "none") {
    issues.push("DMARC policy is `none` — failures are reported but not blocked; tighten to `quarantine` after monitoring")
  }
  if (!hasRua) {
    issues.push("No `rua=` reporting address — you're flying blind on auth failures")
  }
  if (pct !== null && pct < 100) {
    issues.push(`DMARC pct=${pct} — only ${pct}% of mail is enforced; ramp to 100 once stable`)
  }

  return {
    found: true,
    record: r,
    policy,
    subdomain_policy: subPolicy,
    pct,
    has_rua: hasRua,
    has_ruf: hasRuf,
    issues,
  }
}

function normalizeDmarcPolicy(s: string | undefined): DmarcPolicy {
  if (!s) return null
  const lower = s.trim().toLowerCase()
  if (lower === "none" || lower === "quarantine" || lower === "reject") return lower
  return null
}

// ---------- DKIM selector list ----------

/**
 * Selectors we probe by default. Covers the major sending stacks:
 * Google Workspace, Microsoft 365, Mailgun, SendGrid, Amazon SES,
 * Postmark, Zoho, and the common `default` / `selector1` / `s1`
 * defaults that show up everywhere.
 *
 * Probing is cheap (one DNS TXT per selector) but capped — adding
 * fifty selectors here would slow every domain check.
 */
export const COMMON_DKIM_SELECTORS: readonly string[] = Object.freeze([
  "google",       // Google Workspace
  "selector1",    // Microsoft 365
  "selector2",    // Microsoft 365 secondary
  "default",      // generic
  "mail",         // many providers
  "k1",           // Mailchimp / Mandrill
  "k2",
  "mxvault",      // MXroute
  "smtpapi",      // SendGrid
  "scph0922",     // SendGrid alt
  "s1",           // generic numeric
  "s2",
  "pm",           // Postmark
  "amazonses",    // AWS SES
  "zoho",         // Zoho Mail
  "mandrill",     // Mandrill
  "mailgun",      // Mailgun
])

export interface DkimSelectorHit {
  selector: string
  record: string
}

export interface DkimAnalysis {
  found: boolean
  selectors_checked: string[]
  hits: DkimSelectorHit[]
  issues: string[]
}

/**
 * Combine selector-probe results into a single analysis. Caller does
 * the actual DNS lookups and feeds the results in.
 */
export function summarizeDkim(
  checked: string[],
  hits: DkimSelectorHit[],
): DkimAnalysis {
  const issues: string[] = []
  if (hits.length === 0) {
    issues.push(
      "No DKIM record found at common selectors — emails will fail DKIM and lose deliverability. Set up DKIM in your sending provider.",
    )
  }
  for (const h of hits) {
    if (!/^v=DKIM1\b/i.test(h.record)) {
      issues.push(`DKIM record at ${h.selector} doesn't start with v=DKIM1 (may be misformatted)`)
    }
    if (/p=\s*(;|$)/i.test(h.record)) {
      issues.push(`DKIM selector ${h.selector} has an empty public key (key revoked)`)
    }
  }
  return {
    found: hits.length > 0,
    selectors_checked: checked,
    hits,
    issues,
  }
}

// ---------- overall summary ----------

export type OverallGrade = "good" | "fair" | "poor"

export interface DomainAuthChecks {
  spf: SpfAnalysis
  dkim: DkimAnalysis
  dmarc: DmarcAnalysis
}

export interface OverallSummary {
  grade: OverallGrade
  recommendations: string[]
}

/**
 * Heuristic grade. The thresholds are chosen so a fresh domain with
 * "SPF -all + DKIM working + DMARC quarantine/reject" lands in "good",
 * and a domain with any one missing piece lands in "fair" at best.
 */
export function summarizeOverall(checks: DomainAuthChecks): OverallSummary {
  const recs: string[] = []
  let score = 0

  // SPF: 0-2 points
  if (checks.spf.found) {
    if (checks.spf.policy === "hard_fail") score += 2
    else if (checks.spf.policy === "soft_fail") score += 1
    else recs.push("Tighten SPF to `-all` (hard fail) once your sending IPs are stable")
  } else {
    recs.push("Add an SPF record — it tells receivers which servers may send for your domain")
  }

  // DKIM: 0-2 points
  if (checks.dkim.found) score += 2
  else recs.push("Enable DKIM in your sending provider — without it your mail fails alignment")

  // DMARC: 0-2 points
  if (checks.dmarc.found) {
    if (checks.dmarc.policy === "reject" || checks.dmarc.policy === "quarantine") {
      score += 2
    } else {
      score += 1
      recs.push("Move DMARC from p=none to p=quarantine after a week of monitoring")
    }
    if (!checks.dmarc.has_rua) {
      recs.push("Add a DMARC `rua=` reporting address (e.g. mailto:dmarc@yourdomain.com)")
    }
  } else {
    recs.push("Add a DMARC record — it ties SPF + DKIM together and tells receivers what to do on failure")
  }

  let grade: OverallGrade
  if (score >= 5) grade = "good"
  else if (score >= 3) grade = "fair"
  else grade = "poor"

  return { grade, recommendations: recs }
}
