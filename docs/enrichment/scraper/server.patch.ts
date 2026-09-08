/**
 * scraper/src/server.ts — the three lines to add.
 *
 * Shown as a patch rather than a full file so it does not clobber
 * whatever else has landed in server.ts since this was written.
 */

// 1. import
import { enrichScrapeHandler } from "./handlers/enrich"
import { closeBrowser } from "./lib/browser"

// 2. route registration, next to the existing /scrape/company route
app.post<{
  Body: { domain: string; budget_ms?: number; extra_paths?: string[]; max_chars?: number }
}>("/scrape/enrich", enrichScrapeHandler)

// 3. graceful shutdown — without this, Railway's SIGTERM leaves the
//    shared Chromium process orphaned and the container is OOM-killed
//    on the next deploy instead of restarting cleanly.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void (async () => {
      await closeBrowser()
      await app.close()
      process.exit(0)
    })()
  })
}

// 4. bind to Railway's injected PORT rather than a hardcoded 8080
app.listen({ port: Number(process.env.PORT ?? 8080), host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
})
