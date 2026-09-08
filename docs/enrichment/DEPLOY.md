# LeadGenAI — Enrichment Engine · Railway Deployment

**65 tests green. Typecheck clean. One thing left that only you can run.**

---

## Deploy in six steps

```bash
# 1. dependencies
npm install
cd scraper && npm install && cd ..

# 2. everything that needs no infrastructure
npm test                    # 38 pass
npm run test:integration    # 27 pass (17 skip cleanly without DATABASE_URL)
npx tsc --noEmit

# 3. Railway Postgres → copy DATABASE_URL from the Connect tab
export DATABASE_URL="postgresql://..."
psql "$DATABASE_URL" -c "create extension if not exists pgcrypto;"
psql "$DATABASE_URL" -f <your de-Supabased base schema>
npm run db:migrate
DATABASE_URL="$DATABASE_URL" npm run test:integration   # 27 pass

# 4. THE ONE THING I COULD NOT RUN — a real gpt-4o-mini call
OPENAI_API_KEY=sk-... npm run verify:openai

# 5. scraper service:  Railway → New Service → root dir `scraper/`, ≥1GB RAM
# 6. app service:      Railway → New Service → repo root (railway.json is there)
```

Step 4 costs well under a rupee and answers the four questions no offline test
can: does OpenAI accept the schema under `strict:true`, does `gpt-4o-mini` obey
the "never invent" rule, what does a real call cost, and is the key/model
actually available to your account. It prints the raw model JSON and grades it
against three traps — a GSTIN, a PIN code, and an "invoice ref" shaped exactly
like a 10-digit Indian mobile.

---

## Environment

### App service

| Variable | Notes |
|---|---|
| `DATABASE_URL` | auto-injected if you link the Postgres service |
| `DATABASE_POOL_MAX` | default 5; Railway's starter Postgres allows ~20 total |
| `AUTH_JWT_SECRET` | 32+ random bytes. **Setting this switches auth off Supabase** |
| `OPENAI_API_KEY` | rotate the key you pasted in chat |
| `OPENAI_EXTRACTION_MODEL` | `gpt-4o-mini` |
| `OPENAI_BASE_URL` | optional — Azure OpenAI, a gateway, or a local mock |
| `USD_INR_RATE` | default 88, cost accounting only |
| `SCRAPER_URL` / `SCRAPER_KEY` | the scraper service |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | |

### Scraper service

`SCRAPER_KEY` (same secret), `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`,
`NODE_OPTIONS=--max-old-space-size=768`. **Memory ≥ 1GB.**

Do not set `SCRAPER_ALLOW_PRIVATE_HOSTS` — it hard-refuses under
`NODE_ENV=production` anyway, which I verified by setting both and watching all
four private targets still get refused.

---

## What is verified, and how

| Layer | Evidence |
|---|---|
| **Unit** | 38 tests. 15 adversarial hallucinations/traps, all rejected |
| **OpenAI contract** | 17 tests. Real SDK → local capture server |
| **Database** | 10 tests against real PostgreSQL 16 |
| **Crawler** | Real Playwright + Chromium, 4 pages, robots.txt honoured |
| **Worker** | Real Inngest handler invoked; 5 steps; replay guard fires |
| **Route** | 15 assertions: auth, forged JWT, tenancy, idempotency |
| **Container** | Every Dockerfile layer executed; ran as non-root; healthcheck exit 0 |
| **Full chain** | crawl → OpenAI SDK → validator → Postgres, in one run |

### The wire-level proof

I could not reach `api.openai.com`, so I pointed the **real `openai` SDK** at a
capture server and asserted the exact bytes it sends:

```
POST /v1/chat/completions        Authorization: Bearer <key>
model gpt-4o-mini · temperature 0 · top_p 1 · max_tokens 2000
response_format.type            = "json_schema"
response_format.json_schema.strict = true
schema.additionalProperties     = false          (root AND nested)
schema.required                 = every property (root AND nested)
user prompt                     2,193 chars ≤ 48,000 cap
no API key or scraper key anywhere in the body
```

That proves we send precisely what the docs specify. It does **not** prove
OpenAI accepts it — that is step 4.

### Every documented failure shape, handled

`retryable` is the field that matters: a retried 401 burns the queue, an
un-retried 429 drops a lead.

| Response | Code | Retryable |
|---|---|---|
| `message.refusal` set | `MODEL_REFUSAL` | no |
| `finish_reason: "length"` | `MODEL_INVALID_JSON` | no |
| Markdown-fenced, not raw JSON | `MODEL_INVALID_JSON` | no |
| Schema drift (Zod guard) | `MODEL_INVALID_JSON` | no |
| `content: null` | `MODEL_INVALID_JSON` | **yes** |
| 401 bad key | `MODEL_UNAVAILABLE` | no |
| 400 invalid schema | `MODEL_UNAVAILABLE` | no |
| 429 rate limit | `MODEL_UNAVAILABLE` | **yes** |
| 5xx | `MODEL_UNAVAILABLE` | **yes** |

### The full chain, one run

```
steps:  start → crawl → extract → persist → completed
run:    succeeded · attempt 1 · 4 pages · 4 emails · 3 phones · 2 contacts
model:  gpt-4o-mini-2024-07-18 · 3,187 in / 214 out · 6 paise
row:    priya.sharma@… · extracted/valid · +919876543210 · scraped_public
emails: named address first, then 3 role mailboxes (info@, sales@, hr@)
phones: +919876543210 mobile · +911204567890 landline · +9118001234567 tollfree
every value carries a page_url  ·  4 source urls recorded
```

Note it records `gpt-4o-mini-2024-07-18` — the **resolved snapshot**, not the
alias you asked for. When extraction quality shifts, that column tells you
whether the model moved under you.

---

## Bugs found by running things

1. **The crawler silently served mock data.** `SCRAPER_URL` was a module-level const captured at import; any caller setting env afterwards got a plausible fake with no warning. Caught only because a source URL came back `https://` against an `http` fixture. Now read at call time. **`lib/providers/scraper-client.ts` still has this pattern.**
2. **`libphonenumber-js` default export returns `undefined` from `getType()`** — every landline classified `unknown`. Now imports `/max`.
3. **Case-sensitive grounding** dropped `Priya.Sharma@…` — precisely the named addresses worth having.
4. **Dispatch failure lost queued work.** A failed `inngest.send()` 500'd the request even though the run row was committed. Now best-effort with the reconciliation cron as backstop.
5. **Phone pre-filter truncated numbers** — `0120-4567890` → `0120-456789`.
6. **Request guard aborted everything** when the apex carried a port.
7. **Chromium ignores `HTTPS_PROXY`** — a proxied deploy returns zero pages with no error at all.
8. **`zod@4` checks UUID version *and* variant nibbles.** Real `gen_random_uuid()` passes; hand-written test UUIDs do not.

---

## Read this before you ship

**Dropping Supabase removes RLS, and RLS failed *closed*.** A query missing its
ownership predicate was still filtered by a policy on `auth.uid()`.
Application-level checks fail *open*.

The Railway migration omits the policy deliberately rather than shipping one
that reads like protection and cannot fire. Ownership now rests entirely on:

1. the `join public.jobs j … and j.user_id = $2` in every query in `run-service.ts`
2. the re-check inside `complete_enrichment_run()`

`prospects` has no `user_id` column, so there is no shortcut. Three integration
tests exist only to catch that regression — keep them green.

---

## Still open

- **The live OpenAI call** — step 4. Everything up to the network boundary is proven; the boundary itself is yours.
- **A real website.** The crawl ran against a fixture. Real Indian SME sites bring Cloudflare and JS-rendered contact widgets no fixture reproduces. Expect the first ten domains to teach you something about `MAX_PAGES` and the 30-second budget.
- **Cost.** 6 paise on the fixture; ~29 paise on a full-size page at the 48k budget. Your 10-paise target needs `MAX_INPUT_CHARS = 16_000`. Decide after you have real data on which pages produce hits.
- **The wider Supabase migration** — 18+ files, ~70 call sites, and Google OAuth to reimplement. `lib/auth/require-user.ts` gives you the session half, not the login half.
- **UI.** The endpoint returns 202 + `run_id` and `GET` polls it. `app/app/*` belongs to another agent per your `CLAUDE.md`.

Nothing was committed to git. Review the diffs, update `COORDINATION.md`, and
mind the `post-commit` hook that auto-pushes.
