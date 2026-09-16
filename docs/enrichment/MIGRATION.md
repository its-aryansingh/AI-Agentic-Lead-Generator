# Supabase → Railway Postgres: migration complete

**87 tests passing. Zero `@supabase/supabase-js` imports left. 33 call-site
files unchanged.**

---

## The approach, and why

The obvious migration is to rewrite ~70 `.from()` call sites as SQL. I didn't,
for one reason: **the security of the app would then rest on my having found
every one of them.**

An audit said that worry was justified. Three queries shipped with **no user
filter at all**, relying entirely on an RLS policy:

| File | Query | Without RLS |
|---|---|---|
| `app/api/analytics/route.ts` | `.from("jobs").select(...)` | every user's jobs |
| `app/api/export/csv/route.ts` | `.from("prospects").eq("job_id", jobId)` | pass any jobId, get that job's leads |
| `app/api/prospects/[id]/route.ts` | `.update({stage}).eq("id", id)` | change any prospect's stage |

All three carry comments saying RLS handles it. It did. It doesn't any more.

So instead of patching call sites, I transcribed the ownership rules from your
actual `create policy` statements into `lib/db/rls.ts`, and the query builder
injects them into the SQL of every user-scoped statement. **RLS moved from the
database into the data layer.** Call sites keep working, and a query that
forgets its predicate is filtered exactly as a policy filtered it.

A table with no entry **fails closed**.

---

## What was built

| File | Purpose |
|---|---|
| `lib/db.ts` | `pg` pool, Railway SSL handling |
| `lib/db/rls.ts` | Ownership map, transcribed from your 40+ RLS policies |
| `lib/db/query-builder.ts` | PostgREST-shaped builder over `pg`, with ownership injection |
| `lib/db/auth.ts` | scrypt passwords, HS256 sessions, Google OAuth |
| `lib/supabase/server.ts` | **rewritten** — same exports, `pg` underneath |
| `lib/supabase/client.ts` | **rewritten** — browser auth helpers; data calls go through API routes |
| `lib/api-auth.ts` | type-only import localised |
| `app/api/auth/{signup,signin,signout,google,google/callback}` | replaces Supabase Auth |
| `db/migrations/0002_auth.sql` | credentials on `public.users`, drops every RLS policy |
| `tests/integration/row-security.test.ts` | 22 tests — the ones that matter most |

The builder covers exactly the surface your code uses, measured by grep:
`eq`(101) `select`(71) `update`(41) `insert`(35) `maybeSingle`(34) `limit`(17)
`order`(11) `upsert`(9) `in`(9) `single`(8) `match`(5) `not` `neq` `lt` `lte`
`gt` `gte` `delete` `rpc`, plus `count:"exact"`, `head:true`, `onConflict`,
`ignoreDuplicates`.

---

## Verified

```
unit (no infra)            38 pass
openai contract            17 pass
enrichment db              10 pass
row security               22 pass
                           ── 87 pass, 0 fail
tsc --noEmit               clean, against your UNMODIFIED app files
```

The typecheck matters: `app/api/analytics/route.ts`, `app/api/export/csv/route.ts`,
`app/api/prospects/[id]/route.ts` and `lib/credits.ts` were copied in
byte-identical from your repo and compile against the new layer without a
single edit.

### The three vulnerabilities, now closed

```
✓ analytics .from("jobs") with no filter returns ONLY the caller's
✓ export/csv with another tenant's jobId returns nothing
✓ ...but the caller's own jobId still works
✓ stage PATCH on another tenant's prospect updates nothing
✓ ...and the victim row is unchanged
✓ ...while the caller can still update their own
```

Plus insert-side (`WITH CHECK`) equivalents: a row owned by someone else is
refused, an omitted `user_id` is stamped with the session user, and a child row
under another tenant's parent is rejected.

---

## Bugs found by running it

1. **UPDATE built its WHERE clause twice**, orphaning `$1..$n` — Postgres rejected it with *"could not determine data type of parameter $1"*. Caught because a passing test above it was passing for the wrong reason.
2. **A CHECK constraint I added broke three working code paths.** `check (password_hash is not null or google_sub is not null)` looked prudent, but Postgres validates the proposed tuple of an `INSERT ... ON CONFLICT DO UPDATE` before conflict resolution — so every `{id, email}` user upsert failed, and your app does that in `auth/callback`, `login`, and `chat`. Removed, with the reasoning recorded in the migration. The auth layer already guarantees credentials.
3. **`.single()` didn't narrow the result type.** Runtime was fine, types said `T[]`, so every call site reading `data.someColumn` would have failed to compile — 33 files of churn from a one-line bug.

---

## Security notes worth your attention

**Sessions are stateless JWTs.** Sign-out clears the cookie but cannot revoke a
token already copied elsewhere. That is why the TTL is a week, not a year. If
you need real logout-everywhere, add a revocation table.

**`createAdminClient()` has no safety net** — same as the Supabase service key,
but now there is no policy engine behind it at all. Every admin query must carry
its own ownership filter.

**Password hashing is scrypt** from `node:crypto` — memory-hard, no native
build. Sign-in spends the hashing time even for unknown emails, and returns the
same message either way, so the endpoint doesn't leak which addresses have
accounts.

**Google OAuth**: `state` is HMAC-signed (CSRF + post-login destination), the
`id_token` audience and issuer are verified, and `next` is restricted to
relative paths so it can't become an open redirect.

---

## Deploy

```bash
npm install && npm uninstall @supabase/supabase-js @supabase/ssr
psql "$DATABASE_URL" -c "create extension if not exists pgcrypto;"
psql "$DATABASE_URL" -f <your base schema>
psql "$DATABASE_URL" -f db/migrations/0001_enrichment_runs.sql
psql "$DATABASE_URL" -f db/migrations/0002_auth.sql
DATABASE_URL="$DATABASE_URL" npm run test:integration   # 32 must pass
npx tsc --noEmit && npm test
```

Variables — the three `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY`
entries are no longer read and can be deleted:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Railway injects it when you link the Postgres service |
| `AUTH_JWT_SECRET` | **required**, 32+ bytes — `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | existing values work |
| `NEXT_PUBLIC_APP_URL` | must be exact — OAuth redirect_uri is built from it |
| `OPENAI_API_KEY`, `SCRAPER_URL`, `SCRAPER_KEY`, `INNGEST_*` | as before |

In Google Cloud Console, add `https://<your-app>.up.railway.app/api/auth/google/callback`
to Authorised redirect URIs.

---

## What I have NOT done

**Migrated your existing data.** If the Supabase project holds real users, they
have no `password_hash` and no `google_sub` — everyone signs in with Google
once to link their account, or you run a password-reset flow. Export with
`pg_dump` from Supabase's direct connection string and load into Railway.

**Touched `app/app/*` or `app/login/page.tsx`.** Your `CLAUDE.md` assigns those
to another agent. `app/login/page.tsx` still calls
`createBrowserClient(...).auth.signInWithOAuth(...)`, which now throws — **it
must be rewired to the helpers in `lib/supabase/client.ts` before login works.**
That is the one remaining edit between you and a working deploy.

**Run anything against the real OpenAI API or a real website.** Still blocked by
this sandbox's egress. `npm run verify:openai` is one command on your side.

**Load-tested the query builder.** It is correct on 87 tests; it has never seen
production traffic. Watch `DATABASE_POOL_MAX` — Railway's starter Postgres
allows ~20 connections and each serverless instance holds its own pool.
