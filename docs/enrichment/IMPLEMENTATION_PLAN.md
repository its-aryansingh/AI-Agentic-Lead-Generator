# Public Lead Enrichment Agent — Implementation Plan

**Repository audited:** `C:\Users\user\OneDrive\Desktop\Projects\ai agentic lead generator` (LeadGenAI)
**Audit date:** 8 September 2026
**Method:** direct file inspection of the working tree, not inference
**Status:** code artifacts written, typechecked and unit-tested; nothing applied to runtime files

---

## ⚠️ Read this first: the uploaded plan audited a different codebase

`PUBLIC_LEAD_ENRICHMENT_AGENT_IMPLEMENTATION_PLAN 2.md` claims to have audited
`C:\Projects\Aravya\SalesEngAI` on 6 September 2026. Whatever it looked at, it was
not this repository. Its central claims do not survive contact with the files:

| The uploaded plan claims | What is actually in this repo |
|---|---|
| `prospects.user_id` is non-null; background inserts must include it | **`prospects` has no `user_id` column at all.** Ownership is `prospects.job_id → jobs.user_id`. Every query and RLS policy uses that join. |
| `lib/prospect-identity.ts` provides `normalizeE164`, SHA-256 identity hashes | **File does not exist.** No identity-hash module anywhere. |
| Migration `20260906000100_autonomous_outreach.sql` adds `normalized_phone_e164`, `email_hash`, `phone_hash`, `identity_normalization_version` | **No such migration.** Migrations run `00000000000001` → `00000000000019`. None of those columns exist. |
| `prospects` has `lead_status`, `next_action`, `stage`, `qualification_bucket`, `voice_consent_status`, `context_snapshot`, `handoff_summary` … | Only `stage` exists. The other ~20 listed fields are fabricated. |
| `app/app/leads/actions.ts` and `app/app/leads/[id]/page.tsx` are key update paths | **There is no `leads` route.** The app has `chat`, `jobs`, `pipeline`, `inbox`, `intent`, `sequences`, `analytics`, `automations`, `settings`. |
| `lib/discovery/discovery-orchestrator.ts` inserts discovery prospects | **Does not exist.** `lib/` has only `agent/`, `providers/`, `supabase/` and flat modules. |
| `backend-python/` is a Temporal worker, `temporalio==1.31.0`, voice-call workflows | **It is a Django 5.1 + ASGI backend** (`django-cors-headers`, `uvicorn`, `gunicorn`). No Temporal, no voice workflows. It is a *replacement* for `app/api/`, proxied via `PYTHON_BACKEND_URL`. |
| `lib/ai-config.ts`, `@ai-sdk/openai` 3.0.104 present | Neither exists. Only `@ai-sdk/anthropic` + `ai` v6. |
| Baseline test run: "307 passed, 0 failed" | Unverifiable and implausibly precise — 24 test files, and the runner was never executed against this tree. |
| `vercel.json` schedules voice reconciliation | 5 crons, none voice-related. |

**Do not build from that document.** Roughly a third of its Step 3/4 code references
columns, files and modules that do not exist; it would fail at `tsc` and again at
the first query. Everything below is derived from files I actually opened.

It did get four things right, and I've kept them: use a separate run table rather than
overloading `prospects.status`; the scraper `Dockerfile` is broken; the Playwright
version pin is inconsistent; and the current bulk worker never actually scrapes.

---

# STEP 1 — Codebase deep-dive and architecture audit

## 1.1 Exact stack (verified)

| Layer | Evidence | Actual |
|---|---|---|
| Framework | `package.json`, `app/`, `next.config.ts` | Next.js **16.2.6** App Router, React **19.2.4** |
| Language | `tsconfig.json` | TypeScript `^5` (5.9.3 resolved), `strict: true`, target **ES2017**, `moduleResolution: bundler`, alias `@/*` → `./*` |
| Runtime | `@types/node: ^20`; no `engines` field | **Node is unpinned.** Add `"engines": { "node": "22.x" }` before deploy or Vercel/CI/containers will drift. |
| Database | `lib/supabase/*`, `supabase/migrations/*` | Supabase Postgres, **no ORM** — direct `@supabase/supabase-js` 2.105.4. JSONB, RLS, `gen_random_uuid()`. |
| Package manager | `package-lock.json` | npm. **No `packageManager` field** — add it. |
| Secondary backend | `backend-python/` | **Django ≥5.1 + uvicorn/gunicorn**, mirrors `app/api/` routes 1:1. Activated by `PYTHON_BACKEND_URL` rewrite in `next.config.ts`. |
| AI (current) | `lib/providers/anthropic.ts` | Vercel AI SDK `ai@^6.0.182` + `@ai-sdk/anthropic@^3.0.77`, via `generateObject`. **No `openai` package.** |
| Browser service | `scraper/` | Fastify **^4.27**, Playwright **^1.48.0**, CommonJS → ES2022, port 8080 |
| Browser container | `scraper/Dockerfile`, `scraper/fly.toml` | `mcr.microsoft.com/playwright:v1.48.0-jammy`, deployed to **Fly.io** region `sin`, 1GB shared-CPU, scale-to-zero |
| Background jobs | `inngest/`, `app/api/inngest/route.ts` | Inngest **^4.4.0**, one function (`bulk-enrich`), served through the Next.js handler |
| Scheduling | `vercel.json` | 5 Vercel crons: send-due (15m), detect-replies (20m), poll-intent, advance-sequences, run-automations (hourly) |
| Tests | `package.json`, `tests/` | `node --test --experimental-strip-types` — 24 test files + `tests/evals/` |

## 1.2 Where leads live

There is no `leads`, `contacts` or `companies` table. The canonical lead is **`public.prospects`**.

```
users (id = auth.users.id)
  └── jobs (user_id NOT NULL)          ← ownership lives HERE
        └── prospects (job_id NOT NULL) ← no user_id column
```

**Effective `prospects` columns** (base DDL + migrations 2 and 14 — this is the complete list):

```
id, job_id, input_source, input_name, input_company, input_linkedin_url,
status,               -- CHECK: pending|enriching|researching|drafting|completed|failed
stage,                -- CHECK: contacted|replied|interested|converted|unsubscribed
company_domain, company_data, recent_news,
email, email_source,  -- CHECK: extracted|pattern_guessed|none
email_confidence,     -- CHECK: valid|risky|invalid|unknown
phone, whatsapp_opted_in, whatsapp_opted_out,
research_summary, email_subject, email_body, talking_points,
error_reason, cost_cents, created_at, completed_at
```

Both `status` and `stage` are CHECK-constrained. Writing a crawl state into either
throws — which is the structural reason a separate run table is not optional here.

**Write paths that touch prospects:**

| Path | What it does |
|---|---|
| `lib/agent/tool-handlers.ts:handleEnrichProspect` | Single lead. Calls `scrapeCompany` + `scrapeNews`, drafts inline. **Synchronous, inside the chat request.** |
| `lib/agent/tool-handlers.ts:handleStartBulkJob` | ≤20 candidates: `mapConcurrent(…, 3, …)` inline. >20 + `INNGEST_EVENT_KEY`: Inngest. |
| `inngest/functions/bulk-enrich.ts` | Background bulk insert |
| `app/api/prospects/[id]/route.ts` | `PATCH` pipeline stage only |
| `lib/dpdp.ts:eraseContact` | DPDP erasure — deletes by `email` across the user's `job_id`s |

`supabase/scrape_cache` (`cache_key` PK, `payload` jsonb, `expires_at`) is driven by
`getOrSetCache()` in `lib/cache.ts` — SHA-256 keyed, **no tenant column**.

## 1.3 Existing async mechanisms

**Inngest** is already wired end-to-end (`inngest/client.ts` → `app/api/inngest/route.ts`)
and is the right host for this feature: it is in the dependency graph, deployed, and
supports per-key concurrency and idempotency, which is exactly what per-domain politeness
needs. Note the v4 API shape — `triggers: [{ event }]` goes *inside* the config object.

**Vercel Cron** is right for reconciliation, wrong for the primary crawl path.

**Django backend** (`backend-python/`) is a full mirror of `app/api/`. This matters:
**a new route added only to `app/api/` disappears the moment `PYTHON_BACKEND_URL` is set**,
because `next.config.ts` rewrites `/api/:path*` wholesale. This is the single most
important integration constraint in the repo and the uploaded plan misses it entirely.

**`mapConcurrent`** (`tool-handlers.ts:567`) is a concurrency limiter, not a queue.
Request termination loses everything.

## 1.4 Bottlenecks and conflicts

| # | Finding | Impact | Fix |
|---|---|---|---|
| 1 | **Django proxy swallows new routes.** `PYTHON_BACKEND_URL` rewrites all of `/api/*`. | The new enrich endpoint 404s in any deployment using the Python backend. | Mirror the route in Django, or narrow the rewrite to exclude `/api/inngest` and `/api/prospects/:id/enrich`. **Decide before Phase 4.** |
| 2 | Single-lead and ≤20 batches run inside the streaming chat request. | Vercel function timeout; total loss of work on disconnect. | Queue every crawl, including one lead. Return 202 + `run_id`. |
| 3 | `bulk-enrich.ts` **never calls `scrapeCompany`** — it calls `guessDomainFromCompany` then `bestGuessEmail`. | "Enrichment" invents a domain and an email pattern. Nothing is site-backed. | The new worker crawls and writes only published values. |
| 4 | `bulk-enrich.ts:506` — `await supabase.from("prospects").insert(rows)` with **no error check**. | A job is marked `completed` with zero rows. | Fail the step on any DB error. |
| 5 | Step IDs are `` `enrich-${candidate.name}-${candidate.company}` ``. | Two "Priya Sharma at Acme" collide on replay. | Use immutable run UUIDs. |
| 6 | `scraper-client.ts` aborts at 30s; the server's 6 paths × (10s + 1.2s) can exceed that. | Client gives up on work the server is still doing and being billed for. | Derive the client timeout from the server budget. |
| 7 | `company-site.ts` launches and closes Chromium **per request**. | 700ms–1.5s cold start and a CPU/RAM spike per lead. On 1GB, an OOM risk. | One process, one `BrowserContext` per job. |
| 8 | Rate limiting is an in-memory `Map` (`lastScrapeAt`). | Resets on deploy, doesn't coordinate replicas, grows unbounded. | Inngest per-domain concurrency + a bounded local delay. |
| 9 | **No SSRF checks.** Caller-supplied `domain`, followed redirects. | `169.254.169.254` (cloud metadata), `127.0.0.1`, RFC1918 hosts are all reachable. | Three-layer guard: pre-flight DNS, request interception, post-redirect recheck. |
| 10 | `GENERIC_LOCAL` regex **discards** `sales@`, `info@`, `hr@`. | For an Indian SME that is usually the only published contact. The crawl returns nothing. | Keep role mailboxes; flag and rank them. |
| 11 | `guessDomainFromCompany()` feeds the crawler. | Wrong-domain crawl → another company's data written onto this lead. | Require an authoritative domain. Refuse to crawl a guess. |
| 12 | `scraper/Dockerfile` runs `npm ci`, but **`scraper/package-lock.json` does not exist**. | Clean container build fails outright. | Generate and commit the lockfile. |
| 13 | Playwright is `^1.48.0`; the image pins `v1.48.0-jammy`. | Any patch release installs a client with a different CDP protocol than the bundled browsers. | Pin both to the same exact version, bump together. |
| 14 | Service-role client bypasses RLS, and `prospects` has no `user_id`. | A query missing the `jobs` join is a cross-tenant write. | Ownership asserted in one module + rechecked in the RPC. |
| 15 | `scrape_cache` has no tenant column. | Target-specific data cached there becomes globally readable. | Cache company-level public output only. Never per-prospect context. |
| 16 | `tests/` emits `MODULE_TYPELESS_PACKAGE_JSON` warnings. | Cosmetic; adding `"type": "module"` risks the CommonJS assumptions in `scraper/`. | Out of scope. Handle separately. |

---

# STEP 2 — Integration blueprint

## 2.1 Component choices

| Concern | Choice | Why not the alternative |
|---|---|---|
| Crawler | Playwright in the existing `scraper/` service | Puppeteer/Cheerio would be a second browser stack; Cheerio alone can't render the JS-heavy contact widgets common on Indian SME sites |
| Queue | Inngest, one event per prospect | BullMQ/Redis is a new managed dependency and a new bill; the Django backend has no queue at all |
| Extraction | Official `openai` SDK, `gpt-4o-mini`, Chat Completions | The Vercel AI SDK wraps `response_format` in its own object mode — you can't express `strict: true` on a hand-written `json_schema` through it. The existing Anthropic adapters stay untouched. |
| Validation | `libphonenumber-js/max` + deterministic checks | See the note in §2.4 — the default build silently breaks phone typing |
| Persistence | `complete_enrichment_run` RPC (`SECURITY DEFINER`) | One atomic write, ownership rechecked in SQL, non-destructive merge rules encoded once |
| Cache | `getOrSetCache('enrich:<domain>', 30d)` | Reuses the existing table. Company-level only. |
| Deploy | Railway, official Playwright image | Chosen in this session; Fly config becomes dead |

**Verified against current docs (September 2026):**
`gpt-4o-mini` supports Structured Outputs; `strict: true` requires every property listed in
`required` and `additionalProperties: false` on **every** object; safety refusals surface in
`message.refusal` rather than as malformed JSON. Pricing is **$0.15 / $0.60 per 1M** in/out.

`strict: true` guarantees the JSON *shape*. It guarantees nothing about whether the
contents are true. That is what the validator is for.

## 2.2 Trigger workflow

**Manual — `POST /api/prospects/{id}/enrich`**

1. `getUserFromRequest(req)` — cookie or Bearer (the extension path).
2. `loadOwnedProspect(id, userId)` — joins `prospects → jobs` on `jobs.user_id`. 404 if not owned.
3. Resolve domain: explicit body `domain` > `prospects.company_domain`. **No guessing** — 422 if neither.
4. `createOrGetRun()` — insert with a unique `(user_id, idempotency_key)`; a conflict returns the existing run.
5. Dispatch `leadgen/enrichment.requested` **only if a row was actually created**.
6. `202 Accepted` + `run_id`. Client polls `GET` on the same path.

**Automatic** — call the same service after the insert transaction commits, from
`handleStartBulkJob` and `handleEnrichProspect`, **only where an authoritative
`company_domain` is present**. Never fire from a Postgres trigger. A reconciliation cron
re-dispatches runs still `queued` after 5 minutes (`findStuckRuns()`).

## 2.3 Data flow

```
 [Manual click]   [CSV upload]   [Chat discovery]
        |               |               |
        +---------------+---------------+
                        |
                        v
        POST /api/prospects/:id/enrich
        · getUserFromRequest (cookie | bearer)
        · loadOwnedProspect  (prospects -> jobs.user_id)
        · normalizeCompanyDomain — reject guesses
                        |
                        v
        +-------------------------------------+
        | enrichment_runs                     |
        | UNIQUE (user_id, idempotency_key)   |  <-- dedupe happens HERE
        | status = 'queued'                   |
        +-------------------------------------+
                        |
                        v            202 Accepted { run_id } ---> client polls GET
        Inngest: leadgen/enrichment.requested
        concurrency: [ {limit: 4}, {key: domain, limit: 1} ]
        idempotency: event.data.run_id  ·  retries: 2
                        |
                        v
   +----------------------------------------------------+
   |  step: crawl-<run_id>                              |
   |  Playwright service  POST /scrape/enrich           |
   |   · SSRF: DNS pre-flight + route intercept +       |
   |           post-redirect recheck                    |
   |   · robots.txt honoured                            |
   |   · shared Chromium, per-job BrowserContext        |
   |   · <=6 pages, 9s/page, 30s total, 60k char cap    |
   |   · cached 30 days by domain (attempt 1 only)      |
   +----------------------------------------------------+
                        |  { pages[], candidate_emails[], candidate_phones[] }
                        v
   +----------------------------------------------------+
   |  step: extract-<run_id>          [the only $ step] |
   |  gpt-4o-mini · temperature 0 · max_tokens 2000     |
   |  response_format: json_schema, strict: true        |
   |  input sliced to 48k chars (~12k tokens)           |
   |  refusal + finish_reason checked before JSON.parse |
   +----------------------------------------------------+
                        |  { emails, phones, key_contacts, social_links }
                        v
   +----------------------------------------------------+
   |  validator  (pure — no step, no retry cost)        |
   |  1. GROUNDING  every value must appear in the      |
   |                crawled text, or it is dropped      |
   |  2. VALIDITY   libphonenumber-js/max, region IN    |
   |                GSTIN/CIN/PAN/PIN rejected          |
   |  3. RELEVANCE  on-domain > off-domain              |
   |                named > role (role KEPT)            |
   |                mobile > landline > tollfree        |
   +----------------------------------------------------+
                        |
                        v
   +----------------------------------------------------+
   |  step: persist-<run_id>                            |
   |  RPC complete_enrichment_run (SECURITY DEFINER)    |
   |   · ownership rechecked: prospect -> job -> user   |
   |   · email: fills null / beats pattern_guessed;     |
   |            never overwrites 'extracted'            |
   |   · phone: fills null only                         |
   |   · public_contacts jsonb + source_urls            |
   +----------------------------------------------------+
                        |
                        v
        leadgen/enrichment.completed  --> UI refresh, WhatsApp/campaign hooks
```

## 2.4 Edge cases and failure strategy

### Bot protection, timeouts, HTTP errors

| Condition | Behaviour |
|---|---|
| `401` / `403` / `429` | Counted as `pages_blocked`. **No retry, no evasion.** If every page blocks → terminal `failed`, code `SITE_BLOCKED`. |
| `4xx` other | Skip that path, continue to the next. |
| Per-page timeout | 9s budget, `waitUntil: "domcontentloaded"`. **Never `networkidle`** — analytics beacons keep it pending forever. |
| JS-rendered content | 700ms settle after DOM-ready. `tel:`/`mailto:` hrefs are promoted into the text, because many Indian sites render the phone as an icon and put the number only in the href. |
| Whole-job overrun | One 30s wall-clock deadline. Partial pages are returned with `truncated: true` rather than failing. |
| Crawler unreachable / 5xx / 429 | `retryable: true` → Inngest backs off, ≤2 attempts. |
| SSRF rejection (422) | `retryable: false` → terminal immediately. Retrying a private IP is pure cost. |
| robots.txt `Disallow: /` | Crawl nothing. |

Headers are a plausible desktop Chrome + `en-IN` locale + `Asia/Kolkata` timezone.
That is enough for naive heuristics. **Anything stricter is treated as a 403, not
escalated** — evading a site that has explicitly refused you is where a compliance
story stops being defensible.

### Token boundary management

| Control | Value | Effect |
|---|---|---|
| Crawler char cap | 60k total / 14k per page | Bounded HTTP payload |
| Extractor input slice | 48k chars ≈ 12k tokens | Even budget across pages, `[...truncated]` marker |
| `max_tokens` | 2,000 | `finish_reason === "length"` is caught explicitly — a truncated response is invalid JSON by definition |
| Page ordering | `/contact` → `/about` → `/team` → `/` | Highest contact density first, so a budget overrun loses the least valuable page |
| Blocked resources | image, media, font, stylesheet | Faster loads, less memory |
| Cache | 30 days by domain | Repeat domain = ₹0 |

**Cost:** ~12k in + ~250 out ≈ $0.0033 ≈ **29 paise/lead** at ₹88/USD, before caching.

> Your brief targets ~10 paise/lead. 29p is the honest uncached figure at the
> 48k-char budget. To reach 10p, drop `MAX_INPUT_CHARS` to ~16k (≈4k tokens ≈ 10p) —
> viable, because most contact pages carry their payload in the first 3–4k chars. It is
> one constant in `extractor.service.ts`. I've left the wider default because recall
> matters more than 19 paise on the first thousand leads; tighten it once you have
> data on which pages actually produce hits. With a 60% cache hit rate the blended
> cost lands near 12p regardless.

### Idempotency and deduplication

Four layers, each covering what the one above misses:

1. **`UNIQUE (user_id, idempotency_key)`** where the key is `sha256(prospect_id:domain:YYYY-MM-DD)`. A double-clicked button, a retried webhook and the reconciliation cron all collapse into one run. Two concurrent requests race on the index; the loser reads the winner's row.
2. **Inngest `idempotency: "event.data.run_id"`** — a duplicate event is dropped at the queue.
3. **Terminal-state guard** in the worker's first step — a replayed event whose run is already `succeeded`/`failed` returns immediately.
4. **Non-destructive merge in SQL** — the RPC never overwrites a verified email or an existing phone.

`force: true` gets its own idempotency bucket so a deliberate re-scan isn't swallowed.

### The `libphonenumber-js` trap

The default export ships **"min" metadata, where `getType()` returns `undefined` for
every number**. My first test run classified every landline as `unknown` and ranked it
below toll-free. The fix is importing from `libphonenumber-js/max` (+156KB). Also:
`1860` numbers type as `SHARED_COST`, not `TOLL_FREE`, so the prefix check runs first
and metadata is the fallback. Both are encoded in `validator.ts` with tests.

### DPDP alignment

- Public business contact surfaces only — a company's own `/contact`, `/about`, `/team`. No login walls, no personal social profiles, no directory scraping without an approved terms review.
- `robots.txt` honoured; a refusal is respected, never worked around.
- **No DOM text is ever persisted.** Not in Postgres, not in Inngest payloads, not in logs. `enrichment_runs` stores counters and source URLs only.
- Every stored value carries a `page_url` — you can answer "where did you get this?" for any field, which is what an erasure or objection request will ask.
- `lib/dpdp.ts:eraseContact` already deletes by `email` across the user's jobs. **Extend it to clear `public_contacts`, `phone_e164` and `phone_source`** — otherwise erasure leaves the enriched copy behind. This is a required Phase 4 change, listed below.

---

# STEP 3 — Implementation roadmap

### Phase 0 — Decide the Django question *(blocking, ~1 hour)*

`next.config.ts` rewrites all of `/api/*` when `PYTHON_BACKEND_URL` is set. Either:

- **(a)** narrow the rewrite to exclude `/api/inngest` and `/api/prospects/:id/enrich`; or
- **(b)** mirror the endpoint in `backend-python/leadgen_backend/`.

**(a) is the lower-risk choice** — the worker is TypeScript and needs the Inngest handler
reachable regardless. Nothing else in Phase 4 is safe until this is settled.

### Phase 1 — Environment and dependencies *(~30 min)*

```bash
npm install openai@^7.10.0 libphonenumber-js@^1.13.12
cd scraper && npm install && git add package-lock.json   # fixes the broken Docker build
```

Add to `.env.example` and Vercel:

```bash
OPENAI_API_KEY=sk-proj-...
OPENAI_EXTRACTION_MODEL=gpt-4o-mini   # pin the snapshot; bump deliberately
USD_INR_RATE=88                       # cost accounting only
# SCRAPER_URL / SCRAPER_KEY / INNGEST_* already exist
```

Also add to root `package.json` (currently missing, and the cause of silent CI drift):

```json
"engines": { "node": "22.x" },
"packageManager": "npm@10.9.7"
```

### Phase 2 — Crawler module *(~1 day)*

| File | Status |
|---|---|
| `scraper/src/lib/ssrf.ts` | new — DNS pre-flight, IPv4/IPv6/v4-mapped blocklists, redirect recheck |
| `scraper/src/lib/browser.ts` | new — shared Chromium, per-job context, `disconnected` recovery |
| `scraper/src/handlers/enrich.ts` | new — `POST /scrape/enrich` |
| `scraper/src/server.ts` | **3-line edit** — register route, SIGTERM handler, `process.env.PORT` |

Leave `/scrape/company` alone; `handleEnrichProspect` still uses it.

### Phase 3 — Extraction layer *(~half day)*

| File | Purpose |
|---|---|
| `lib/enrichment/types.ts` | `EXTRACTION_JSON_SCHEMA`, Zod mirrors, error taxonomy |
| `lib/enrichment/extractor.service.ts` | `gpt-4o-mini`, `strict: true`, temperature 0, mock fallback |
| `lib/enrichment/validator.ts` | grounding + India-aware validation + ranking |
| `lib/enrichment/crawler.service.ts` | typed client, timeout derived from server budget |

### Phase 4 — Queue, DB, API *(~1 day)*

1. `supabase/migrations/00000000000020_enrichment_runs.sql` → `npm run db:push`
2. `lib/enrichment/run-service.ts`
3. `inngest/functions/enrich-prospect.ts`
4. Register it in `app/api/inngest/route.ts`:
   ```ts
   import { enrichProspectFunction } from "@/inngest/functions/enrich-prospect"
   export const { GET, POST, PUT } = serve({
     client: inngest,
     functions: [bulkEnrichFunction, enrichProspectFunction],
   })
   ```
5. `app/api/prospects/[id]/enrich/route.ts`
6. **Extend `lib/dpdp.ts:eraseContact`** to null `public_contacts`, `phone_e164`, `phone_source` on matching rows. Erasure is incomplete without it.
7. Optionally add a reconciliation cron using `findStuckRuns()`.

### Phase 5 — Containerisation and Railway *(~half day)*

1. Replace `scraper/Dockerfile`; add `scraper/railway.json`.
2. Railway → New Service → root directory `scraper/`.
3. Variables: `SCRAPER_KEY`, `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, `NODE_OPTIONS=--max-old-space-size=768`.
4. **Memory ≥ 1GB** — Railway's docs are explicit about this for Playwright, and a shared Chromium with 4 concurrent contexts will sit near it.
5. Point `SCRAPER_URL` at the Railway domain; delete `scraper/fly.toml` once cut over.

Two things that break a clean build today, both fixed in the new Dockerfile:
**`scraper/package-lock.json` is missing** (so `npm ci` fails), and the image tag must
match the `playwright` package version **exactly** — `^1.48.0` against a `v1.48.0` image
means any patch release ships a client speaking a different CDP protocol than the
bundled browsers. Both are pinned to `1.63.0`.

The image also drops to the non-root `pwuser`. Chromium with `--no-sandbox` as root is a
container-escape footgun, and the current setup does exactly that.

### Phase 6 — Verification

```bash
npm test                                    # 24 existing files + the new one
npx tsc --noEmit                            # app
cd scraper && npx tsc --noEmit              # service
```

Then a live smoke test against 10 known Indian SME domains, checking hit rate,
false-positive rate on phones, and mean cost/lead against the 29p estimate.

---

# STEP 4 — Code artifacts

All 15 files are in `docs/enrichment/`, mirroring their destination paths.

| Artifact | File | Lines |
|---|---|---|
| Migration | `migration/00000000000020_enrichment_runs.sql` | 268 |
| SSRF guard | `scraper/src/lib/ssrf.ts` | 202 |
| Browser pool | `scraper/src/lib/browser.ts` | 94 |
| **`crawler.service`** (server) | `scraper/src/handlers/enrich.ts` | 394 |
| Server wiring | `scraper/server.patch.ts` | 36 |
| Shared types | `lib/enrichment/types.ts` | 205 |
| **`crawler.service`** (client) | `lib/enrichment/crawler.service.ts` | 138 |
| **`extractor.service`** | `lib/enrichment/extractor.service.ts` | 275 |
| Validator | `lib/enrichment/validator.ts` | 387 |
| Run service | `lib/enrichment/run-service.ts` | 302 |
| **`enrichment.worker`** | `inngest/functions/enrich-prospect.ts` | 243 |
| **Controller** | `app/api/prospects/[id]/enrich/route.ts` | 176 |
| Dockerfile | `scraper/Dockerfile` | 58 |
| Railway config | `scraper/railway.json` | 15 |
| Tests | `tests/enrichment-validator.test.ts` | 199 |

**Verification performed:**
- `node --test --experimental-strip-types` → **18/18 pass** (caught the `libphonenumber-js` metadata bug)
- `tsc --noEmit` under the repo's real `tsconfig.json` (ES2017, strict, `@/*`), against the repo's **actual** `lib/cache.ts`, `lib/api-auth.ts`, `lib/supabase/server.ts` and `inngest/client.ts` → **clean** (caught a `step.run` Jsonify-union narrowing error)
- `tsc --noEmit` under `scraper/tsconfig.json` (ES2022, CommonJS) → **clean**
- Migration parsed with libpg_query → **18 statements, valid Postgres**
- Every column referenced cross-checked against `FULL_SCHEMA_DEPLOY.sql`

## 4.1 The Structured Outputs contract

From `types.ts` — note `additionalProperties: false` on **both** objects and every
property in `required`, which `strict: true` mandates:

```ts
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    emails: { type: "array", items: { type: "string" }, description: "..." },
    phones: {
      type: "array",
      description:
        "Phone numbers exactly as printed on the page, including any +91, 0 prefix, " +
        "STD code, spaces, hyphens or brackets. Do not reformat or normalize.",
      items: { type: "string" },
    },
    key_contacts: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, title: { type: "string" } },
        required: ["name", "title"],
        additionalProperties: false,
      },
    },
    social_links: { type: "array", items: { type: "string" } },
  },
  required: ["emails", "phones", "key_contacts", "social_links"],
  additionalProperties: false,
} as const
```

There are no optional fields — "nothing found" is an empty array. `strict` mode
forbids optionality.

## 4.2 The call

```ts
completion = await openai.chat.completions.create({
  model: EXTRACTION_MODEL,           // "gpt-4o-mini", pinned via env
  temperature: 0,
  top_p: 1,
  max_tokens: 2_000,
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "public_business_contacts",
      strict: true,
      schema: EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>,
    },
  },
})

// Refusals are a dedicated field, not malformed JSON — check before parsing.
if (choice?.message?.refusal) throw new EnrichmentError("MODEL_REFUSAL", ..., false)

// A truncated response is invalid JSON by definition.
if (choice?.finish_reason === "length") throw new EnrichmentError("MODEL_INVALID_JSON", ..., false)
```

The prompt's `+91` pre-filtering is instruction-level (copy exactly, never reformat,
exclude GSTIN/CIN/PAN/PIN) plus a regex pre-pass in the crawler that lets us skip the
model entirely when a page has no phone-shaped text. Normalisation is **not** the
model's job — `libphonenumber-js/max` does it deterministically afterwards.

## 4.3 The non-destructive merge

The rule that matters most, from the RPC:

```sql
email = case
  when p_email is null                        then pr.email
  when pr.email is null                       then p_email
  when pr.email_source = 'pattern_guessed'    then p_email   -- fact beats guess
  else pr.email                                              -- never clobber 'extracted'
end,
phone = case
  when p_phone is null                              then pr.phone
  when pr.phone is null or btrim(pr.phone) = ''     then p_phone
  else pr.phone                                              -- never overwrite
end
```

Plus the ownership recheck, which is the reason this is `SECURITY DEFINER` rather
than a client-side update:

```sql
select exists (
  select 1 from public.prospects pr
  join public.jobs j on j.id = pr.job_id
  where pr.id = p_prospect_id and j.user_id = p_user_id
) into v_owns;
if not v_owns then raise exception '...'; end if;
```

## 4.4 What is deliberately *not* here

- **Regional directory adapters.** JustDial, IndiaMART and Sulekha all prohibit
  automated extraction in their terms. Adding them is a legal decision, not a technical
  one, and it undercuts the DPDP posture the rest of this design is built on. The
  crawler takes `extra_paths` so an approved adapter can be added later without a
  structural change.
- **A UI.** The endpoint returns 202 + `run_id` and `GET` polls it. Wiring that into
  the pipeline page is separate work, and `app/app/*` belongs to another agent per your
  `CLAUDE.md`.
- **Migrating `handleEnrichProspect` / `bulk-enrich`.** Both keep working. Point them at
  the queue once the new path has run against real domains.

---

## Immediate next actions

1. **Decide the Django proxy question** (Phase 0) — everything in Phase 4 depends on it.
2. `cd scraper && npm install && git commit package-lock.json` — the container cannot build without it.
3. Run the migration on a Supabase branch and confirm the RPC's ownership check rejects a cross-tenant call.
4. Smoke-test the crawler against 10 known Indian SME domains before spending anything on tokens; the mock path runs end-to-end with no keys at all.
