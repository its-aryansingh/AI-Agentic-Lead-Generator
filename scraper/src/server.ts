import Fastify from "fastify"
import { healthHandler } from "./handlers/health"
import { companySiteHandler } from "./handlers/company-site"
import { newsHandler } from "./handlers/news"

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

app.listen({ port: 8080, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
})
