# Lead Enrichment Engine — Runbook

**Status:** installed into runtime paths. Typechecked, 38 tests passing, crawler
proven against a live Playwright run. Two things remain before it can enrich a
real lead: `npm install`, and a decision about the Django proxy (§4).

---

## 1. What landed in your repo

### New files (14)

```
lib/enrichment/types.ts                  contracts, JSON schema, error taxonomy
lib/enrichment/crawler.service.ts        typed client for the scraper service
lib/enrichment/extractor.service.ts      gpt-4o-mini Structured Outputs
lib/enrichment/validator.ts              grounding + India-aware validation
lib/enrichment/run-service.ts            enrichment_runs lifecycle + ownership
inngest/functions/enrich-prospect.ts     the worker
app/api/prospects/[id]/enrich/route.ts   POST to queue, GET to poll
scraper/src/lib/ssrf.ts                  three-layer SSRF guard
scraper/src/lib/browser.ts               shared Chromium, per-job context
scraper/src/handlers/enrich.ts           POST /scrape/enrich
scraper/package-lock.json                ← your Docker build was broken without this
scraper/railway.json
tests/enrichment-validator.test.ts       18 tests
tests/enrichment-adversarial.test.ts     20 tests
supabase/migrations/00000000000020_enrichment_runs.sql
```

### Modified files (6) — review these diffs

| File | Change |
|---|---|
| `scraper/src/server.ts` | registers `/scrape/enrich`, adds SIGTERM/SIGINT shutdown, reads `process.env.PORT` |
| `scraper/package.json` | `playwright` pinned to exact `1.63.0` (was `^1.48.0`), `fastify ^4.29.1`, `engines.node >=22` |
| `scraper/Dockerfile` | base image matched to the pinned Playwright, non-root `pwuser`, healthcheck |
| `app/api/inngest/route.ts` | registers `enrichProspectFunction` alongside `bulkEnrichFunction` |
| `lib/dpdp.ts` | erasure now also clears `public_contacts` / `phone_e164` / `phone_source` and deletes the matching `enrichment_runs` |
| `docs/enrichment/` | reference copies + the architecture plan |

`git diff` these six before anything else. Nothing else in your tree was touched.

> **Do not `git commit` casually.** Your `.githooks/post-commit` auto-pushes to
> GitHub. Review first, and per your `CLAUDE.md` update `COORDINATION.md`
> §0.1/§0.2/§13 — this work touches `lib/`, `app/api/`, `inngest/`,
> `supabase/migrations/` and `tests/` (Codex owns `tests/`).

---

## 2. Install and verify (5 minutes)

```bash
# app
npm install openai@^7.10.0 libphonenumber-js@^1.13.12

# scraper — package-lock.json is now committed, so this is reproducible
cd scraper && npm install && cd ..

# verify
npm test                                   # 38 new tests + your existing suite
npx tsc --noEmit                           # app
cd scraper && npx tsc --noEmit && cd ..    # service
```

Also add to the root `package.json` — both are missing today and are why CI,
Vercel and your containers can silently resolve different Node versions:

```json
"engines": { "node": "22.x" },
"packageManager": "npm@10.9.7"
```

---

## 3. Environment

```bash
# NEW
OPENAI_API_KEY=sk-proj-...            # rotate the one pasted in chat first
OPENAI_EXTRACTION_MODEL=gpt-4o-mini   # pin; bump deliberately
USD_INR_RATE=88                       # cost accounting only

# EXISTING — already in your .env.example
SCRAPER_URL=https://<your-railway-app>.up.railway.app
SCRAPER_KEY=<shared secret>
INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=...
```

Optional, for the scraper service only:

| Variable | Purpose |
|---|---|
| `SCRAPER_ALLOW_PRIVATE_HOSTS=1` | Lets the crawler reach `127.0.0.1` for local fixture testing. **Hard-refuses to activate when `NODE_ENV=production`** — there is no way to turn this on in a production build. |
| `CHROMIUM_EXECUTABLE_PATH` | Only when the runtime supplies its own Chromium whose build number doesn't match the `playwright` package. Unset on Railway. |
| `SCRAPER_PROXY_SERVER` | Explicit `--proxy-server` for egress-restricted networks. Chromium ignores `HTTPS_PROXY`, so without this a proxied deploy returns zero pages **with no error**. |

Everything runs with **zero keys** via the mock paths (your `CLAUDE.md` hard
rule #2). No `OPENAI_API_KEY` → deterministic mock extraction. No `SCRAPER_URL`
→ a mock Indian contact page. The pipeline is exercisable end-to-end today.

---

## 4. The one blocking decision

`next.config.ts` rewrites **all** of `/api/*` to Django when
`PYTHON_BACKEND_URL` is set:

```ts
source: "/api/:path*",
destination: `${PYTHON_BACKEND_URL}/api/:path*`,
```

So in any deployment with that variable set, both `/api/prospects/:id/enrich`
and `/api/inngest` vanish. Pick one:

**(a) Narrow the rewrite — recommended, 5 minutes.** The worker is TypeScript
and needs the Inngest handler reachable regardless of which backend serves the
rest:

```ts
async rewrites() {
  return {
    beforeFiles: [],
    afterFiles: [],
    fallback: [
      { source: "/api/:path*", destination: `${PYTHON_BACKEND_URL}/api/:path*` },
    ],
  }
}
```

`fallback` only proxies paths Next.js did **not** handle itself, so any route
that exists in `app/api/` wins and everything else still reaches Django. This
also fixes the same latent problem for `/api/inngest` today.

**(b) Mirror the endpoint in Django.** More work, splits the enrichment domain
model across two languages, and the Inngest worker still has to be reachable.

---

## 5. Deploy the scraper to Railway

1. New Service → your repo → **Root Directory `scraper/`**.
2. Railway detects the `Dockerfile`. `railway.json` sets the health check.
3. Variables: `SCRAPER_KEY=<same secret as the app>`,
   `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`,
   `NODE_OPTIONS=--max-old-space-size=768`.
4. **Memory ≥ 1GB.** Railway's Playwright guide is explicit about this, and a
   shared Chromium with 4 concurrent contexts sits near it.
5. Set `SCRAPER_URL` in Vercel to the Railway domain.
6. Delete `scraper/fly.toml` once you've cut over.

Then run the migration: `npm run db:push`.

---

## 6. Using it

```bash
# queue (202 + run_id; duplicate POSTs return the same run, no second crawl)
curl -X POST https://<app>/api/prospects/<uuid>/enrich \
  -H 'Content-Type: application/json' -b "$COOKIE" \
  -d '{"domain":"bharatprecision.in"}'

# poll
curl https://<app>/api/prospects/<uuid>/enrich -b "$COOKIE"

# force a re-scan past the 30-day cache
curl -X POST ... -d '{"domain":"bharatprecision.in","force":true}'
```

`422 domain_required` means the prospect has no verified `company_domain` and
you didn't pass one. That is deliberate: `guessDomainFromCompany()` is fine for
an email-pattern guess, but crawling a guessed domain writes **another
company's** contact details onto the lead.

Results land in `prospects.public_contacts` (full surface + per-value
`page_url`), with the best email/phone projected onto `prospects.email` and
`prospects.phone`. Existing verified data is never overwritten — a scraped fact
beats `pattern_guessed` and `NULL`, and loses to `extracted`.

---

## 7. What was actually verified

| Check | Result |
|---|---|
| `tsc --noEmit`, app tsconfig (ES2017, strict, `@/*`) | clean |
| `tsc --noEmit`, `scraper/tsconfig.json` (ES2022, CommonJS, no DOM lib) | clean |
| `node --test --experimental-strip-types` | **38/38 pass** |
| Migration parsed with libpg_query | 18 valid statements |
| Scraper booted, real Playwright + Chromium | ✅ |
| Auth rejection without `x-scraper-key` | 401 ✅ |
| SSRF: `localhost`, `169.254.169.254`, `192.168.1.1` | all 422 `SSRF_BLOCKED` ✅ |
| **Live crawl**, 4 pages, robots.txt honoured | ✅ |
| `tel:` href promotion (number rendered as an icon only) | recovered `+919876543210` ✅ |
| Adversarial run: 15 hallucinations/traps | **all 15 rejected** ✅ |
| JSON schema against strict-mode rules | valid ✅ |

Bugs this found and fixed, that static review had missed:

1. **`libphonenumber-js` default export returns `undefined` from `getType()`** — every landline classified `unknown` and ranked below toll-free. Now imports `libphonenumber-js/max`.
2. **Case-sensitive grounding** — the check lower-cased the candidate but not the page text, so `Priya.Sharma@acme.in` was silently dropped. This discarded exactly the named addresses worth having. Now case-insensitive.
3. **Phone pre-filter truncated numbers** — `0120-4567890` became `0120-456789`.
4. **`page.evaluate` needed DOM types** your `scraper/tsconfig.json` doesn't include. Solved with a module-scoped `declare const document` rather than adding `"DOM"` globally, which would let server code reference `document` and still compile.
5. **Request guard aborted every request** when the apex carried a port.
6. **Chromium ignores `HTTPS_PROXY`** — a proxied deploy returned zero pages with no error at all.

**Not verified:** a live `gpt-4o-mini` call. `api.openai.com` is not in this
sandbox's egress allowlist. The schema is mechanically checked against
strict-mode rules and the error paths are exercised (the 403 was correctly
classified non-retryable), but the first real call is yours to make. Start with
one lead and read `enrichment_runs`.

---

## 8. Cost

~12k in + ~250 out ≈ **29 paise/lead** uncached, at ₹88/USD.

Your brief said ~10 paise. To get there, set `MAX_INPUT_CHARS = 16_000` in
`extractor.service.ts` (≈4k tokens ≈ 10p) — viable, because most contact pages
carry their payload in the first 3–4k characters. I left it at 48k because
recall matters more than 19 paise on your first thousand leads. With a 60%
cache hit rate the blended cost is ~12p either way.

---

## 9. Still open

- **Django proxy decision** (§4) — blocking.
- **UI.** The endpoint returns 202 + `run_id` and `GET` polls it. Wiring that into the pipeline page is separate work; `app/app/*` belongs to Antigravity per your `CLAUDE.md`.
- **Reconciliation cron.** `findStuckRuns()` in `run-service.ts` is written and unused. Add a `vercel.json` cron when you want runs that never started to be re-dispatched.
- **Migrating the old paths.** `handleEnrichProspect` and `bulk-enrich` still work unchanged. Point them at the queue once this has run against real domains.
- **Regional directories.** JustDial/IndiaMART/Sulekha prohibit automated extraction in their terms. Deliberately not implemented — it's a legal decision, and it would undercut the DPDP posture the rest of this is built on. `extra_paths` on the crawler is the hook if you get approval.
