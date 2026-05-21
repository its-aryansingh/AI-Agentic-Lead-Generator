import type { FastifyRequest, FastifyReply } from "fastify"
import { chromium } from "playwright"

const TEAM_PATHS = ["/team", "/about/team", "/people", "/leadership", "/about", "/contact"]
const EMAIL_RX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

// Prevent hammering one domain: track last scrape time per domain.
const lastScrapeAt = new Map<string, number>()
const RATE_LIMIT_MS = 2_000

interface CompanySiteRequest {
  domain: string
  target_name?: string
}

interface CompanySiteResponse {
  domain: string
  emails: string[]
  matched_target: string | null
  pages_visited: number
  scraped_at: string
}

export async function companySiteHandler(
  req: FastifyRequest<{ Body: CompanySiteRequest }>,
  reply: FastifyReply,
) {
  const { domain, target_name } = req.body ?? {}
  if (!domain) return reply.code(400).send({ error: "domain is required" })

  // Per-domain rate limit: polite crawling.
  const last = lastScrapeAt.get(domain) ?? 0
  const wait = RATE_LIMIT_MS - (Date.now() - last)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastScrapeAt.set(domain, Date.now())

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (compatible; LeadGenAIBot/0.1; +https://leadgenai.app/bot)",
    viewport: { width: 1280, height: 800 },
  })

  const emails = new Set<string>()
  let matchedTitle: string | null = null
  let pagesVisited = 0

  try {
    const page = await ctx.newPage()

    for (const path of TEAM_PATHS) {
      const url = `https://${domain}${path}`
      try {
        const res = await page.goto(url, {
          timeout: 10_000,
          waitUntil: "domcontentloaded",
        })
        if (!res || res.status() >= 400) continue
        pagesVisited++

        // Brief wait for any lazy-rendered content.
        await page.waitForTimeout(1_200)

        const html = await page.content()
        const found = html.match(EMAIL_RX) ?? []
        found.forEach((e) => emails.add(e.toLowerCase()))

        // If we're looking for a specific person, scan visible text for their name.
        if (target_name && matchedTitle === null) {
          const bodyText = await page.innerText("body").catch(() => "")
          if (bodyText.toLowerCase().includes(target_name.toLowerCase())) {
            matchedTitle = extractTitleNear(bodyText, target_name)
          }
        }
      } catch {
        // Page didn't exist or timed out — try the next path.
      }
    }
  } finally {
    await browser.close()
  }

  // Filter out obviously invalid emails (noreply@, support@, info@, etc.)
  const filtered = [...emails].filter((e) => !GENERIC_LOCAL.test(e.split("@")[0]))

  const result: CompanySiteResponse = {
    domain,
    emails: filtered,
    matched_target: matchedTitle,
    pages_visited: pagesVisited,
    scraped_at: new Date().toISOString(),
  }

  return reply.send(result)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GENERIC_LOCAL = /^(noreply|no-reply|support|help|info|hello|contact|admin|sales|team|hr|careers|jobs|press|media|legal|privacy|abuse|spam|postmaster|webmaster|billing|accounts?)$/i

function extractTitleNear(text: string, name: string): string {
  // Find the name, then grab the next non-empty line(s) as a likely title.
  const idx = text.toLowerCase().indexOf(name.toLowerCase())
  if (idx === -1) return ""
  const after = text.slice(idx + name.length, idx + name.length + 200)
  const lines = after
    .split(/[\n\r|,·•–]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && l.length < 80)
  return lines[0] ?? ""
}
