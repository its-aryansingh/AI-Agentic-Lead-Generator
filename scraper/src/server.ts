import Fastify from "fastify"
import { healthHandler } from "./handlers/health"
import { companySiteHandler } from "./handlers/company-site"
import { newsHandler } from "./handlers/news"
import { enrichScrapeHandler } from "./handlers/enrich"
import { closeBrowser } from "./lib/browser"

const app = Fastify({ logger: true })

app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health") return
  const key = req.headers["x-scraper-key"]
  if (!key || key !== process.env.SCRAPER_KEY) {
    return reply.code(401).send({ error: "unauthorized" })
  }
})

app.get("/health", healthHandler)
app.post<{ Body: { domain: string; target_name?: string } }>("/scrape/company", companySiteHandler)
app.post<{ Body: { company_name: string; domain?: string; max_articles?: number } }>("/scrape/news", newsHandler)

// Public-contact enrichment crawl. Returns cleaned page text + regex
// pre-hits; the LLM extraction happens in the Next.js app, not here.
app.post<{
  Body: { domain: string; budget_ms?: number; extra_paths?: string[]; max_chars?: number }
}>("/scrape/enrich", enrichScrapeHandler)

// Graceful shutdown. Without this, a redeploy SIGTERM orphans the shared
// Chromium process and the next container start is OOM-killed.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void (async () => {
      await closeBrowser()
      await app.close()
      process.exit(0)
    })()
  })
}

app.listen({ port: Number(process.env.PORT ?? 8080), host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
})
