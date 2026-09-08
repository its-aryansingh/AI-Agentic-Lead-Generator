# Railway — API key setup and deploy check

## Where the key goes

**Railway service → Variables tab → New Variable.** Nowhere else.

```
OPENAI_API_KEY = sk-proj-...
```

Railway injects Variables into the container's environment. `lib/enrichment/
extractor.service.ts` reads `process.env.OPENAI_API_KEY` **at call time**, not
at module load, so the value is picked up on every request with no restart
dance and no code change.

**Do not put the key in any file in the repo.** Your `.githooks/post-commit`
auto-pushes every commit to GitHub. A key in a tracked file is a public key
about four seconds later. `.gitignore` line 31 (`.env*.local`) protects
`.env.local` for local development only — Railway does not read that file.

### Local development

```bash
# .env.local — gitignored, never committed
OPENAI_API_KEY=sk-proj-...
```

### Paste carefully

The Railway Variables UI is where keys usually break. Three failure modes, all
of which the health endpoint below now names explicitly:

| Mistake | Symptom |
|---|---|
| Wrapped in `"quotes"` | key rejected, 401 |
| Trailing space or newline | key rejected, 401 |
| Truncated paste | key rejected, 401 |

Paste the raw value with no quotes and no trailing whitespace.

---

## Confirm it worked

```bash
# fast — no network, no billing
curl https://<your-app>.up.railway.app/api/health/enrichment

# deep — one unbilled call to OpenAI's /models
curl "https://<your-app>.up.railway.app/api/health/enrichment?deep=1"
```

Healthy looks like:

```json
{
  "status": "ok",
  "components": {
    "database":    { "status": "ok", "detail": "8ms" },
    "openai":      { "status": "ok", "detail": "sk-proj…MBIA (164 chars), model gpt-4o-mini" },
    "crawler":     { "status": "ok", "detail": "https://scraper.up.railway.app" },
    "queue":       { "status": "ok", "detail": "inngest configured" },
    "openai_live": { "status": "ok", "detail": "key valid, gpt-4o-mini available (412ms)" }
  }
}
```

The key is never logged — only a `sk-proj…MBIA (164 chars)` fingerprint, enough
to confirm the right value arrived without putting it in your logs.

### Why this endpoint exists

Every provider in this repo has a mock fallback — that is hard rule #2 in your
`CLAUDE.md`, and it is the right call. But it means a **missing key fails
silently**: enrichment reports `succeeded` and writes deterministic fake
contacts. No error, no 500, nothing in the logs. You would find out when
someone emailed `founders@<domain>` and it bounced.

`"mock": true` in the response is the flag that catches it.

`deep=1` uses `/models` rather than a completion because it is unbilled and
does not depend on model access, so it separates *"is the key valid"* from
*"does this account have gpt-4o-mini"*. Both are reported.

`/api/health/enrichment` is deliberately **separate** from `/api/health`, which
is what `railway.json` uses for the deploy healthcheck. A deploy should not be
marked unhealthy because OpenAI is having a bad afternoon.

---

## A build failure I found before you hit it

`railway.json` runs `npm ci`, which **requires `package.json` and
`package-lock.json` to be in sync**. Your lockfile predated `openai`, `pg`,
`libphonenumber-js` and `tsx`, so the build would have died with:

```
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json are in sync. Missing: openai@7.10.0 from lock file
```

Regenerated and committed. Verified by running the exact command Railway runs:
`npm ci` → **845 packages, exit 0**, all three runtime deps resolved
(`openai@7.10.0`, `pg@8.23.0`, `libphonenumber-js@1.13.12`).

---

## Full deploy order

```bash
# 1. Postgres service → copy DATABASE_URL
psql "$DATABASE_URL" -c "create extension if not exists pgcrypto;"
psql "$DATABASE_URL" -f <your de-Supabased base schema>
npm run db:migrate
DATABASE_URL="$DATABASE_URL" npm run test:integration      # 27 pass

# 2. Scraper service → root dir `scraper/`, ≥1GB RAM
#    Variables: SCRAPER_KEY, PLAYWRIGHT_BROWSERS_PATH=/ms-playwright,
#               NODE_OPTIONS=--max-old-space-size=768

# 3. App service → repo root (railway.json is there)
#    Variables: DATABASE_URL, OPENAI_API_KEY, OPENAI_EXTRACTION_MODEL=gpt-4o-mini,
#               SCRAPER_URL, SCRAPER_KEY, AUTH_JWT_SECRET,
#               INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY

# 4. Confirm
curl "https://<app>.up.railway.app/api/health/enrichment?deep=1"

# 5. First real lead
curl -X POST https://<app>.up.railway.app/api/prospects/<uuid>/enrich \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $SESSION" \
  -d '{"domain":"somerealcompany.in"}'

# 6. Read what it cost
psql "$DATABASE_URL" -c \
  "select status, pages_crawled, emails_found, phones_found, model,
          prompt_tokens, completion_tokens, cost_paise, error_code
     from enrichment_runs order by created_at desc limit 1;"
```

Step 6 is the one that tells you whether the 29-paise estimate holds on real
pages. If `cost_paise` comes back much higher, drop `MAX_INPUT_CHARS` in
`extractor.service.ts` from 48,000 to 16,000.

---

## One last time, on this key

You have now pasted `sk-proj-MIJj…MBIA` into a chat transcript twice. I have not
written it to any file, and I could not call OpenAI with it — this sandbox's
gateway refuses `api.openai.com`, and your machine's Linux workspace will not
start.

Treat it as burned. Revoke it at platform.openai.com/api-keys, create a new one,
and put that one straight into Railway Variables without it passing through a
chat window. Set a monthly spend limit on the project while you are there —
this pipeline is cheap, but a runaway loop against a paid model is not.
