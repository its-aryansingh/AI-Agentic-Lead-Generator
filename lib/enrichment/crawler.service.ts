/**
 * crawler.service.ts — typed client for the Playwright scraper service.
 *
 * Mirrors lib/providers/scraper-client.ts (same SCRAPER_URL / SCRAPER_KEY
 * env vars, same mock-when-unconfigured convention) but targets the new
 * /scrape/enrich endpoint and fixes the timeout bug in the existing
 * client: it aborts at 30s while the server's worst case is longer, so
 * the caller gives up on work the server is still doing and pays for.
 *
 * Here the client deadline is always derived from the server budget:
 *     client timeout = budget_ms + HANDSHAKE_HEADROOM_MS
 */

import { getOrSetCache } from "./cache"
import { EnrichmentError, type CrawlResult } from "./types"

/**
 * Read at CALL time, not module load.
 *
 * lib/providers/scraper-client.ts captures these into module-level consts,
 * which works in Next.js only because the runtime populates process.env
 * before the first import. Anywhere else — a test that sets env before
 * importing (ESM hoists the import above the assignment), a worker that
 * loads config asynchronously, a script using dotenv after import — the
 * consts are captured empty and the client silently serves MOCK data
 * instead of erroring. That failure is invisible: you get a plausible
 * result with no warning.
 */
function scraperUrl(): string {
  return process.env.SCRAPER_URL?.replace(/\/$/, "") ?? ""
}

function scraperKey(): string {
  return process.env.SCRAPER_KEY ?? ""
}

/** Cold start + TLS + JSON transfer of up to 60KB of page text. */
const HANDSHAKE_HEADROOM_MS = 12_000

/** Server-side wall-clock budget for the crawl itself. */
export const DEFAULT_CRAWL_BUDGET_MS = 30_000

/** Company contact surfaces change slowly; a month is safe and cheap. */
const CRAWL_CACHE_TTL_SECONDS = 30 * 86_400

export function isCrawlerConfigured(): boolean {
  return !!scraperUrl() && !!scraperKey()
}

export interface CrawlOptions {
  domain: string
  budgetMs?: number
  extraPaths?: string[]
  /** Set false to force a fresh crawl (e.g. a user-clicked "re-scan"). */
  useCache?: boolean
}

export async function crawlCompanySite(opts: CrawlOptions): Promise<CrawlResult> {
  const { domain, budgetMs = DEFAULT_CRAWL_BUDGET_MS, extraPaths, useCache = true } = opts

  if (!isCrawlerConfigured()) return mockCrawl(domain)

  const run = () => postCrawl(domain, budgetMs, extraPaths)

  if (!useCache) return run()

  // NOTE: this caches the crawl only, keyed by domain — company-level
  // public data, no per-user context. scrape_cache has no tenant column,
  // so nothing target-specific may ever be written through this path.
  return getOrSetCache<CrawlResult>(`enrich:${domain}`, CRAWL_CACHE_TTL_SECONDS, run)
}

async function postCrawl(
  domain: string,
  budgetMs: number,
  extraPaths?: string[],
): Promise<CrawlResult> {
  let res: Response
  try {
    res = await fetch(`${scraperUrl()}/scrape/enrich`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-scraper-key": scraperKey(),
      },
      body: JSON.stringify({ domain, budget_ms: budgetMs, extra_paths: extraPaths }),
      signal: AbortSignal.timeout(budgetMs + HANDSHAKE_HEADROOM_MS),
    })
  } catch (err) {
    const aborted = (err as Error).name === "TimeoutError" || (err as Error).name === "AbortError"
    throw new EnrichmentError(
      aborted ? "CRAWLER_TIMEOUT" : "CRAWLER_UNAVAILABLE",
      `Crawler request failed for ${domain}: ${(err as Error).message}`,
      true, // network-level failures are worth one retry from the queue
    )
  }

  // 422 = the crawler's SSRF policy rejected the domain. Never retry.
  if (res.status === 422) {
    throw new EnrichmentError(
      "DOMAIN_REJECTED",
      `Crawler rejected domain ${domain} (private, malformed, or non-public)`,
      false,
    )
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new EnrichmentError(
      "CRAWLER_UNAVAILABLE",
      `Crawler returned ${res.status}: ${detail.slice(0, 200)}`,
      res.status >= 500 || res.status === 429,
    )
  }

  return (await res.json()) as CrawlResult
}

// ---------------------------------------------------------------------
// Mock — keeps the pipeline runnable with no SCRAPER_URL (hard rule #2)
// ---------------------------------------------------------------------

function mockCrawl(domain: string): CrawlResult {
  const url = `https://${domain}/contact`
  const text = [
    `${domain} — Contact Us`,
    "",
    "Head Office",
    "Plot 42, Sector 62, Noida, Uttar Pradesh 201309",
    "",
    `Email: info@${domain}`,
    `Sales: sales@${domain}`,
    "Phone: +91 98765 43210",
    "Landline: 0120-4567890",
    "Toll Free: 1800 123 4567",
    "GSTIN: 09AABCU9603R1ZM",
    "",
    "Leadership",
    "Priya Sharma — Founder & CEO",
    "Rahul Verma — Head of Sales",
  ].join("\n")

  return {
    domain,
    pages: [{ url, title: `Contact — ${domain}`, text, status: 200 }],
    candidate_emails: [`info@${domain}`, `sales@${domain}`],
    candidate_phones: ["+91 98765 43210", "0120-4567890", "1800 123 4567"],
    social_links: [`https://linkedin.com/company/${domain.split(".")[0]}`],
    pages_visited: 1,
    pages_blocked: 0,
    truncated: false,
    degraded: false,
    scraped_at: new Date().toISOString(),
  }
}
