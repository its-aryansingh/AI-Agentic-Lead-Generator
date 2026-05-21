import type { FastifyRequest, FastifyReply } from "fastify"

interface NewsRequest {
  company_name: string
  domain?: string
  max_articles?: number
}

interface NewsArticle {
  title: string
  url: string
  snippet: string
  published_at: string | null
}

interface NewsResponse {
  company_name: string
  articles: NewsArticle[]
  scraped_at: string
}

export async function newsHandler(
  req: FastifyRequest<{ Body: NewsRequest }>,
  reply: FastifyReply,
) {
  const { company_name, domain, max_articles = 5 } = req.body ?? {}
  if (!company_name) return reply.code(400).send({ error: "company_name is required" })

  const query = domain
    ? `"${company_name}" site:${domain} OR "${company_name}" news funding announcement`
    : `"${company_name}" news funding announcement`

  const articles = await fetchDdgNews(query, max_articles)

  const result: NewsResponse = {
    company_name,
    articles,
    scraped_at: new Date().toISOString(),
  }

  return reply.send(result)
}

// ---------------------------------------------------------------------------
// DuckDuckGo news fetch — lightweight, no browser needed
// ---------------------------------------------------------------------------

async function fetchDdgNews(query: string, limit: number): Promise<NewsArticle[]> {
  // DuckDuckGo's unofficial search endpoint returns JSON-P; we strip the wrapper.
  const url =
    `https://duckduckgo.com/d.js?q=${encodeURIComponent(query)}&kl=in-en&s=0&o=json&sp=0`

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; LeadGenAIBot/0.1; +https://leadgenai.app/bot)",
        "Accept": "text/javascript, application/javascript",
      },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return []

    const text = await res.text()
    // Strip JSONP wrapper: nrj('...json...') or ddg_spice_...({...})
    const jsonMatch = text.match(/\[.*\]/s) ?? text.match(/\{.*\}/s)
    if (!jsonMatch) return []

    const data = JSON.parse(jsonMatch[0]) as Array<{
      t?: string // title
      u?: string // url
      a?: string // abstract/snippet
      da?: string // date
    }>

    return data
      .filter((r) => r.t && r.u)
      .slice(0, limit)
      .map((r) => ({
        title: r.t ?? "",
        url: r.u ?? "",
        snippet: r.a ?? "",
        published_at: r.da ?? null,
      }))
  } catch {
    return []
  }
}
