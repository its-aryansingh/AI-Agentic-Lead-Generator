/**
 * Async DNS layer for the SPF / DKIM / DMARC pre-flight check.
 * Pure parsing lives in lib/domain-auth-core.ts; this module does the
 * actual TXT lookups via Node's dns/promises with a per-lookup timeout
 * so a slow resolver can't hang the request handler.
 *
 * No external deps; all lookups are stdlib DNS.
 */

import { promises as dns } from "dns"

import {
  COMMON_DKIM_SELECTORS,
  isValidDomain,
  parseDmarcRecord,
  parseSpfRecord,
  summarizeDkim,
  summarizeOverall,
  type DkimAnalysis,
  type DkimSelectorHit,
  type DmarcAnalysis,
  type DomainAuthChecks,
  type OverallSummary,
  type SpfAnalysis,
} from "@/lib/domain-auth-core"

const LOOKUP_TIMEOUT_MS = 3_000

export interface DomainAuthReport {
  domain: string
  spf: SpfAnalysis
  dkim: DkimAnalysis
  dmarc: DmarcAnalysis
  overall: OverallSummary
  /** True if any individual lookup timed out — degrades confidence. */
  degraded: boolean
}

export async function checkDomain(rawDomain: string): Promise<DomainAuthReport> {
  const domain = rawDomain.trim().toLowerCase()
  if (!isValidDomain(domain)) {
    return notFoundReport(domain, "invalid domain")
  }

  let degraded = false

  // SPF + DMARC are single TXT lookups. DKIM is N parallel TXT lookups
  // at <selector>._domainkey.<domain>. Run all three in parallel and
  // build the report; per-lookup timeouts keep total request bounded.
  const [spf, dmarc, dkim] = await Promise.all([
    lookupSpf(domain).catch(() => {
      degraded = true
      return emptySpf()
    }),
    lookupDmarc(domain).catch(() => {
      degraded = true
      return emptyDmarc()
    }),
    lookupDkim(domain).catch(() => {
      degraded = true
      return emptyDkim()
    }),
  ])

  const checks: DomainAuthChecks = { spf, dkim, dmarc }
  const overall = summarizeOverall(checks)

  return {
    domain,
    spf,
    dkim,
    dmarc,
    overall,
    degraded,
  }
}

// ----- per-record lookups -----

async function lookupSpf(domain: string): Promise<SpfAnalysis> {
  const records = await resolveTxtWithTimeout(domain)
  for (const r of records) {
    const parsed = parseSpfRecord(r)
    if (parsed) return parsed
  }
  return emptySpf()
}

async function lookupDmarc(domain: string): Promise<DmarcAnalysis> {
  const records = await resolveTxtWithTimeout(`_dmarc.${domain}`)
  for (const r of records) {
    const parsed = parseDmarcRecord(r)
    if (parsed) return parsed
  }
  return emptyDmarc()
}

async function lookupDkim(domain: string): Promise<DkimAnalysis> {
  const checked = [...COMMON_DKIM_SELECTORS]
  const hits: DkimSelectorHit[] = []

  // One TXT lookup per selector, in parallel, each individually
  // timeout-guarded. Missing selectors are the common case — silently
  // skipped.
  const results = await Promise.all(
    checked.map(async (selector) => {
      try {
        const records = await resolveTxtWithTimeout(`${selector}._domainkey.${domain}`)
        // Pick the first record that looks like a DKIM TXT.
        const dkim = records.find((r) => /^v=DKIM1\b/i.test(r) || /p=/i.test(r))
        return dkim ? { selector, record: dkim } : null
      } catch {
        return null
      }
    }),
  )
  for (const r of results) if (r) hits.push(r)

  return summarizeDkim(checked, hits)
}

// ----- DNS helpers -----

/**
 * Resolve TXT records and join multi-string chunks per RFC 7208 §3.3
 * (SPF) and RFC 6376 §3.6.2.1 (DKIM): a single record can be split
 * into several quoted strings and must be concatenated without
 * separators before parsing.
 */
async function resolveTxtWithTimeout(host: string): Promise<string[]> {
  const txtPromise = dns.resolveTxt(host).then((chunks) =>
    chunks.map((parts) => parts.join("")),
  )
  return Promise.race([
    txtPromise,
    new Promise<string[]>((_, reject) =>
      setTimeout(() => reject(new Error("DNS timeout")), LOOKUP_TIMEOUT_MS),
    ),
  ]).catch((err) => {
    // ENOTFOUND / ENODATA mean "no record exists" — return [] so
    // callers can render "not found" instead of bubbling an error.
    const code = (err as { code?: string }).code
    if (code === "ENOTFOUND" || code === "ENODATA") return []
    throw err
  })
}

// ----- empty defaults (when nothing was found / lookup failed) -----

function emptySpf(): SpfAnalysis {
  return {
    found: false,
    record: null,
    policy: "none",
    lookup_count_estimate: 0,
    issues: ["No SPF record found — receivers can't tell who's authorized to send for this domain"],
  }
}

function emptyDmarc(): DmarcAnalysis {
  return {
    found: false,
    record: null,
    policy: null,
    subdomain_policy: null,
    pct: null,
    has_rua: false,
    has_ruf: false,
    issues: ["No DMARC record found — set _dmarc.<domain> with v=DMARC1; p=none; rua=mailto:..."],
  }
}

function emptyDkim(): DkimAnalysis {
  return {
    found: false,
    selectors_checked: [...COMMON_DKIM_SELECTORS],
    hits: [],
    issues: ["No DKIM record found at common selectors — your sending provider must publish one"],
  }
}

function notFoundReport(domain: string, reason: string): DomainAuthReport {
  const spf = emptySpf()
  const dmarc = emptyDmarc()
  const dkim = emptyDkim()
  return {
    domain,
    spf: { ...spf, issues: [reason] },
    dmarc: { ...dmarc, issues: [reason] },
    dkim: { ...dkim, issues: [reason] },
    overall: { grade: "poor", recommendations: [reason] },
    degraded: true,
  }
}
