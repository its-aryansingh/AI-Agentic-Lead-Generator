export interface CompanyScrapeResult {
  domain: string
  emails: string[]
  matched_target: string | null
  pages_visited: number
  scraped_at: string
}

export interface NewsArticle {
  title: string
  url: string
  snippet: string
  published_at: string | null
}

export interface NewsScrapeResult {
  company_name: string
  articles: NewsArticle[]
  scraped_at: string
}

const SCRAPER_URL = process.env.SCRAPER_URL?.replace(/\/$/, "") ?? ""
const SCRAPER_KEY = process.env.SCRAPER_KEY ?? ""

function hasKey(): boolean {
  return !!SCRAPER_URL && !!SCRAPER_KEY
}

async function scraperPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SCRAPER_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-scraper-key": SCRAPER_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Scraper ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

function mockCompanyResult(domain: string, targetName?: string): CompanyScrapeResult {
  return {
    domain,
    emails: [`founders@${domain}`, `team@${domain}`],
    matched_target: targetName ? "Co-Founder & CEO" : null,
    pages_visited: 2,
    scraped_at: new Date().toISOString(),
  }
}

function mockNewsResult(companyName: string): NewsScrapeResult {
  return {
    company_name: companyName,
    articles: [
      {
        title: `${companyName} raises Series A funding`,
        url: `https://techcrunch.com/${companyName.toLowerCase().replace(/\s+/g, "-")}-series-a`,
        snippet: `${companyName} announced a new funding round to expand operations across Southeast Asia.`,
        published_at: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
      },
    ],
    scraped_at: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function scrapeCompany(params: {
  domain: string
  target_name?: string
}): Promise<CompanyScrapeResult> {
  if (!hasKey()) return mockCompanyResult(params.domain, params.target_name)
  return scraperPost<CompanyScrapeResult>("/scrape/company", params)
}

export async function scrapeNews(params: {
  company_name: string
  domain?: string
  max_articles?: number
}): Promise<NewsScrapeResult> {
  if (!hasKey()) return mockNewsResult(params.company_name)
  return scraperPost<NewsScrapeResult>("/scrape/news", params)
}
