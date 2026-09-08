# Lead Enrichment Engine — Railway Deployment

**Status:** every layer verified except two that this sandbox's network blocks.
The engine no longer imports `@supabase/supabase-js` anywhere.

---

## 1. What changed since the last handoff

You said the database moves to Railway, **not Supabase**. The enrichment engine
is now Railway-native. Your other ~30 Supabase files are untouched and still work.

### New

| File | Purpose |
|---|---|
| `lib/db.ts` | `pg` connection pool. Railway SSL handling, `query` / `queryOne` / `transaction`, `pingDatabase()` |
| `lib/auth/require-user.ts` | Auth seam. HS256 session JWT for Railway; falls back to the Supabase helper via **dynamic import** while you still have it |
| `lib/enrichment/cache.ts` | `getOrSetCache` over `pg` (replaces the Supabase `lib/cache.ts` for this pipeline only) |
| `db/migrations/0001_enrichment_runs.sql` | Railway variant — no `auth` schema, no `auth.uid()` RLS, no `service_role` grants |
| `tests/integration/enrichment-db.test.ts` | 10 tests against a real database; skips cleanly without `DATABASE_URL` |

### Rewritten

- `lib/enrichment/run-service.ts` — every Supabase call is now SQL.
- `lib/enrichment/crawler.service.ts` — uses the `pg` cache; env read lazily (see §5).
- `app/api/prospects/[id]/enrich/route.ts` — uses `requireUser`; dispatch is now best-effort.
- `next.config.ts` — the `/api/*` rewrite is fixed.
- `package.json` — `pg`, `openai`, `libphonenumber-js` added; `engines`, `packageManager`, two scripts.

---

## 2. The security change you must understand

Under Supabase, RLS was a real safety net: a query missing its ownership
predicate still got filtered by a policy on `auth.uid()`.

**On Railway there is no `auth.uid()` and no PostgREST role switching, so RLS
cannot fire.** The Railway migration omits the policy deliberately rather than
shipping one that looks like protection and isn't.

Ownership is now enforced in exactly two places:

1. the `join public.jobs j on j.id = p.job_id ... and j.user_id = $2` in every query in `run-service.ts`
2. the re-check inside `complete_enrichment_run()`

A forgotten join is a cross-tenant leak with nothing behind it. `prospects` has
no `user_id` column, so there is no shortcut. Three integration tests exist
solely to catch that regression.

---

## 3. Deploy

### 3a. Postgres

Railway → New → Database → PostgreSQL. Then:

```bash
export DATABASE_URL="<Connect tab → Postgres Connection URL>"
psql "$DATABASE_URL" -c "create extension if not exists pgcrypto;"
psql "$DATABASE_URL" -f <your base schema>          # users, jobs, prospects, scrape_cache …
npm run db:migrate                                   # 0001_enrichment_runs.sql
DATABASE_URL="$DATABASE_URL" npm run test:integration # 10 tests must pass
```

Your base schema needs de-Supabasing first: drop `references auth.users(id)`,
and drop every `enable row level security` / `create policy` that calls
`auth.uid()`. I verified the enrichment migration applies cleanly to a database
with no `auth` schema and none of the Supabase roles.

### 3b. Scraper service

Railway → New Service → your repo → **Root Directory `scraper/`**.

| Variable | Value |
|---|---|
| `SCRAPER_KEY` | a shared secret, same value as the app |
| `PLAYWRIGHT_BROWSERS_PATH` | `/ms-playwright` |
| `NODE_OPTIONS` | `--max-old-space-size=768` |

**Memory ≥ 1GB.** Do not set `SCRAPER_ALLOW_PRIVATE_HOSTS` — and it would not
work anyway (§4).

### 3c. App

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Railway injects it if you link the Postgres service |
| `DATABASE_POOL_MAX` | default 5. Raise only if Railway's connection limit allows |
| `AUTH_JWT_SECRET` | 32+ random bytes. **Setting this switches auth off Supabase entirely** |
| `AUTH_COOKIE_NAME` | default `leadgen_session` |
| `OPENAI_API_KEY` | rotate the key you pasted in chat |
| `OPENAI_EXTRACTION_MODEL` | `gpt-4o-mini` |
| `SCRAPER_URL` / `SCRAPER_KEY` | the scraper service |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | |

Issue the session cookie at login with `signSessionJwt(user, secret)` from
`lib/auth/require-user.ts`.

---

## 4. What was verified, and how

Every line below is something I executed, not reasoned about.

### Database — real PostgreSQL 16

- Your `FULL_SCHEMA_DEPLOY.sql` loaded: **24 tables, 0 errors**
- Migration applied clean, then **re-applied with 0 errors** (idempotent)
- Applied again to a **fresh database with no `auth` schema and no Supabase roles** — clean
- `complete_enrichment_run` executed with real rows:

| Case | Result |
|---|---|
| Cross-tenant write | **raises**, victim row untouched |
| NULL email | filled, marked `extracted`/`valid` |
| `pattern_guessed` | overwritten by the scraped fact |
| `extracted`/`valid` | **not** overwritten |
| Existing phone | **not** overwritten |
| Invalid terminal status | raises |
| Duplicate idempotency key | unique violation |

### Data layer — 21 assertions, real Postgres, no Supabase

Includes **10 concurrent `createOrGetRun` callers → exactly 1 insert won, all 10
resolved to the same run id.**

### Crawler — real Playwright + Chromium

- 4 pages crawled, robots.txt honoured
- 401 without `x-scraper-key`
- SSRF: `localhost`, `169.254.169.254`, `192.168.1.1`, `10.0.0.5` → all `422 SSRF_BLOCKED`
- **Production hard-stop:** with `SCRAPER_ALLOW_PRIVATE_HOSTS=1` *and* `NODE_ENV=production`, all four still refused
- `tel:` href promotion recovered a number rendered only as an icon

### Worker — the real Inngest handler, invoked

```
steps: start → crawl → extract → persist → completed
event: leadgen/enrichment.completed
run:   succeeded, attempt 1, pages 4, emails 5, phones 1
row:   email=priya.sharma@…, phone_e164=+919876543210, phone_source=scraped_public
replay same event → {"skipped":true,"reason":"already_succeeded"}
```

### Route — 15 assertions

No token / garbage / expired / **forged signature** → 401. Bad UUID → 400.
Unknown body field → 400. Another tenant's prospect → 404. Missing domain → 422.
First POST → 202 + `run_id`; duplicate → 200, same `run_id`, still exactly one row.
Poll → 200; another tenant polling → 404.

### Container — every Dockerfile layer executed

`npm ci` from the committed lockfile → `npm run build` → `npm prune --omit=dev`
(playwright kept, typescript dropped) → ran as non-root `pwuser` → the exact
`HEALTHCHECK` command exited 0.

The base image itself could not be pulled: `mcr.microsoft.com` and Docker Hub are
both blocked here. I confirmed against Playwright's docs that `:v1.63.0` is the
Noble-based tag, and the docs state the exact failure my version pin prevents:
*"If the Playwright version in your Docker image does not match the version in
your project, Playwright will be unable to locate browser executables."*

### Test suites

```
npm test              38 pass   (no infrastructure)
npm run test:integration  10 pass   (needs DATABASE_URL; skips cleanly without)
npx tsc --noEmit      clean      app
cd scraper && npx tsc --noEmit    clean      service
```

---

## 5. Bugs this round found

1. **`crawler.service.ts` silently served mock data.** `SCRAPER_URL`/`SCRAPER_KEY` were module-level consts, captured at import. Any caller that sets env after import got a plausible fake result with no warning. Now read at call time. **`lib/providers/scraper-client.ts` still has this pattern** — worth the same fix.
2. **Dispatch failure lost queued work.** If `inngest.send()` threw, the route 500'd even though the run row was committed. Now best-effort: the row is the durable record, the response carries `dispatched: false`, and the reconciliation cron picks it up. Proper outbox semantics.
3. **`zod@4` rejects non-RFC-4122 UUIDs** — the version *and* variant nibbles are checked. Real `gen_random_uuid()` output passes, so production is unaffected, but hand-written test UUIDs will fail the route's guard.
4. **`node --test --experimental-strip-types` cannot resolve `@/*`.** Type-only imports get erased so it appears to work, then breaks on the first value import. Integration tests run via `node --import tsx --test`.

---

## 6. Still not verified

**A real `gpt-4o-mini` call.** `api.openai.com` is not in this sandbox's egress
allowlist. The schema is mechanically checked against strict-mode rules, and the
error path was exercised — the 403 was correctly classified non-retryable — but
the first live call is yours. Do one lead, then read the `enrichment_runs` row:
`model`, `prompt_tokens`, `cost_paise` tell you whether the estimate holds.

**A real external website.** Every registry and site is blocked here, so the
crawl ran against a fixture I wrote. Real Indian SME sites bring Cloudflare,
JS-rendered contact widgets, and markup no fixture reproduces. Expect the first
ten real domains to teach you something — most likely about `MAX_PAGES` and the
30-second budget.

---

## 7. Migrating the rest of the app

Not started, and much larger than the engine. From the files I sampled:

- **18+ files import Supabase**, ~70 `.from()` / `.rpc()` call sites
- **`users` is the hottest table** (18 references), then `prospects` and `jobs` (8 each)
- **Auth is the hard part**: `signInWithOAuth`, `exchangeCodeForSession`, `getUser`, `signOut`. Google OAuth must be reimplemented — `lib/auth/require-user.ts` gives you the session half, not the login half
- **Every RLS policy dies.** Each one becomes an explicit predicate in application code. That is where the risk is: RLS failed closed, a missing WHERE clause fails open

Suggested order: `lib/db.ts` is already there → port `lib/cache.ts` → port
`lib/credits.ts` and `lib/dpdp.ts` → replace auth → work outward through
`app/api/`. Keep `npm run test:integration` green at each step.

Ask when you want that scoped properly — it is a multi-day job, and doing it
piecemeal while both clients are live is how tenants get crossed.
