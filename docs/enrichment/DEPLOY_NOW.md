# Deploy to Railway — build green

**`next build` passes. 48 routes compiled. 87 tests green.**

I ran the actual build rather than guessing at your errors. Four were real.

---

## The four errors, fixed

| # | Error | Cause | Fix |
|---|---|---|---|
| 1 | `Property 'exchangeCodeForSession' does not exist` in `app/api/auth/callback/route.ts` | Old Supabase OAuth callback | Rewritten to use `lib/db/auth.ts`. Kept the path — Google Console may still list it as an authorised redirect URI |
| 2 | `Type 'TriggerInsert[]' is not assignable... Index signature is missing` in `app/api/cron/poll-intent/route.ts` | My `insert()` demanded `Record<string, unknown>`; a declared interface has no index signature | `insert`/`update`/`upsert` now take `<R extends object>`, like supabase-js |
| 3 | `Property 'signOut' does not exist` in `app/app/actions.ts` | Compat auth was missing methods | Added `signOut`, `signUp`, `signInWithPassword` — grepped for the full surface first rather than fixing one per build |
| 4 | `Property 'auth' does not exist on type 'never'` in `app/login/page.tsx` | The browser client now throws | Rewired to the server-backed helpers |

A fifth failure was **this sandbox only**: `next/font/google` cannot reach
`fonts.googleapis.com` from here. I stubbed it to get past it and **restored the
real import** — it will work on Railway. Nothing stubbed was committed.

---

## What changed in the login page

- Google sign-in is a full-page redirect to `/api/auth/google`, which builds the consent URL **server-side**. The client never holds the OAuth secret, and `state` is HMAC-signed there for CSRF.
- Email sign-in keeps the same "try sign-in, else sign-up" behaviour, but both go through `/api/auth/*` routes that set an **httpOnly** cookie. The session token is no longer readable by page scripts — an improvement on the Supabase browser client.
- Minimum password raised 6 → 8 to match the server, which was already enforcing 8. The old bar produced a confusing round-trip failure.
- The browser-side `users.upsert` is gone; the server creates the row during sign-up.
- A failed sign-up on an existing email now reports "Invalid email or password" rather than "account already exists" — the old wording confirmed which addresses have accounts.

---

## Deploy

```bash
npm install                        # lockfile is already in sync
npm uninstall @supabase/supabase-js @supabase/ssr

psql "$DATABASE_URL" -c "create extension if not exists pgcrypto;"
psql "$DATABASE_URL" -f <your base schema>
psql "$DATABASE_URL" -f db/migrations/0001_enrichment_runs.sql
psql "$DATABASE_URL" -f db/migrations/0002_auth.sql

npm run build                                            # must pass
DATABASE_URL="$DATABASE_URL" npm run test:integration     # 49 must pass
```

### Railway services

**Postgres** → New → Database → PostgreSQL.

**Scraper** → New Service → root directory `scraper/`, **memory ≥ 1GB**
`SCRAPER_KEY`, `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, `NODE_OPTIONS=--max-old-space-size=768`

**App** → New Service → repo root (`railway.json` is there)

| Variable | Notes |
|---|---|
| `DATABASE_URL` | auto-injected when you link Postgres |
| `AUTH_JWT_SECRET` | **required** — `openssl rand -hex 32` |
| `SCRAPER_KEY` | same value as the scraper service |
| `SCRAPER_URL` | the scraper's Railway domain |
| `OPENAI_API_KEY` | rotate the one from chat |
| `OPENAI_EXTRACTION_MODEL` | `gpt-4o-mini` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | existing values |
| `NEXT_PUBLIC_APP_URL` | exact — OAuth `redirect_uri` is built from it |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | |
| `CRON_SECRET`, `UNSUB_SECRET`, `RAZORPAY_*`, `RESEND_API_KEY` | as before |

Delete `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` — nothing reads them.

**Google Cloud Console** → Authorised redirect URIs, add both:
```
https://<app>.up.railway.app/api/auth/google/callback
https://<app>.up.railway.app/api/auth/callback
```

### Confirm

```bash
curl "https://<app>.up.railway.app/api/health/enrichment?deep=1"
OPENAI_API_KEY=sk-... npm run verify:openai
```

---

## Two things that will bite on first run

**Your existing Supabase users cannot sign in.** They have no
`password_hash` and no `google_sub`. Each signs in with Google once to link, or
they use the email form — which will create the account fresh. If the Supabase
project holds data you need, `pg_dump` it from Supabase's direct connection
string before you switch.

**Vercel Cron is not Railway Cron.** `vercel.json` schedules five jobs
(`send-due`, `detect-replies`, `poll-intent`, `advance-sequences`,
`run-automations`). Railway ignores that file. Add a Railway cron service, or
point an external scheduler at those endpoints with the `CRON_SECRET` header —
otherwise sending, reply detection and sequence advancement silently never run.

---

## Still unverified

The live `gpt-4o-mini` call and a crawl of a real website. Both blocked by this
sandbox's egress, both one command on your side. Everything up to the network
boundary is tested.
