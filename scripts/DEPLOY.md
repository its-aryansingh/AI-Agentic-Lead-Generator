# DEPLOY.md — Launch the product

A one-command wrapper around the manual steps in `docs/DEPLOYMENT.md`.
The script never deploys the Next.js app itself (push to `master` does
that via Vercel); it handles the bits that aren't on the git push path:
**Supabase migrations**, the **Fly.io scraper**, and a **post-deploy
health probe**.

```
PowerShell:  pwsh ./scripts/deploy.ps1 <mode>  [flags]
POSIX:       ./scripts/deploy.sh <mode>        [flags]
```

## Modes

| Mode | What it does |
|---|---|
| `pre-flight` | Read-only audit: CLIs installed, env vars set, repo clean, latest migration. Run this first. |
| `migrations` | `supabase db push` against the linked Supabase project. Confirmation prompt. |
| `scraper` | `cd scraper && fly deploy`. Confirmation prompt. Skipped silently if `scraper/` is missing. |
| `verify` | `curl <HealthUrl>/api/health` and assert `ok: true`. |
| `all` | pre-flight → migrations → scraper → verify (each with its own prompt). Halts on first failure. |

## Flags

| PowerShell | POSIX | Meaning |
|---|---|---|
| `-HealthUrl <url>` | `--health-url <url>` | Where `verify` should probe (e.g. `https://leadgenai.vercel.app/api/health`) |
| `-Yes` | `--yes` / `-y` | Skip every confirmation prompt (CI use) |
| `-DryRun` | `--dry-run` / `-n` | Print the plan; don't execute |

## First-time launch

```bash
# 1. Audit your environment
./scripts/deploy.sh pre-flight

# 2. Fix anything pre-flight flagged (install CLIs, set env vars, etc.)

# 3. Run the full pipeline
./scripts/deploy.sh all --health-url https://<your-vercel-host>/api/health
```

## Prereqs

| CLI | Why | Install |
|---|---|---|
| `supabase` | `supabase db push` | `npm i -g supabase` or `brew install supabase/tap/supabase` |
| `flyctl`   | `fly deploy` for the scraper | https://fly.io/docs/flyctl/install/ |
| `git`      | repo state checks | https://git-scm.com |
| `npm`      | bundled with Node 20+ | https://nodejs.org |

Plus, in the linked Supabase project: run `supabase login` then
`supabase link --project-ref <ref>` once. In Fly: run `fly auth login`
once.

## Required env vars (production)

These must be set in **Vercel project settings → Environment Variables**
for the production deployment to function:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`  (server-only; **never** in NEXT_PUBLIC_*)
- `ANTHROPIC_API_KEY`
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`
- `CRON_SECRET`  (any random string; matched by the cron route's `Authorization: Bearer` check)

## Optional env vars (mock fallback if unset)

The product runs key-free for any provider whose env vars are absent —
real outputs get a `demo data` badge. Set these only if you want real
behavior:

- Discovery: `BRAVE_SEARCH_KEY`, `PRODUCTHUNT_TOKEN`, `GITHUB_TOKEN`
- Async + scraping: `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `SCRAPER_URL`, `SCRAPER_KEY`
- WhatsApp: `WHATSAPP_API_URL`, `WHATSAPP_API_KEY`, `WHATSAPP_FROM`, `WHATSAPP_WEBHOOK_SECRET`
- CRM: `HUBSPOT_API_KEY`, `ZOHO_REFRESH_TOKEN` + `ZOHO_CLIENT_ID` + `ZOHO_CLIENT_SECRET` (+ optional `ZOHO_REGION`, `in` for India accounts)
- Billing: `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`, `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` + `RAZORPAY_WEBHOOK_SECRET`
- Mobile push: `EXPO_PUSH_ACCESS_TOKEN`

## What this script does NOT do

- **Deploy the Next.js app.** That happens on `git push origin master`
  via Vercel's GitHub integration.
- **Set env vars in Vercel.** Use the Vercel dashboard or `vercel env
  add`. Setting prod env vars programmatically requires a Vercel API
  token and is intentionally out of scope.
- **Run E2E tests.** Use `npm test` (the unit suite) before pushing,
  and validate post-deploy via the `verify` mode + manual smoke.

## Cron secret bootstrap

The cron routes (`/api/cron/*`) require `Authorization: Bearer
$CRON_SECRET`. To generate one and set it everywhere:

```bash
# Generate a random secret
openssl rand -hex 32

# Set it in:
#   - Vercel project env (Production + Preview)
#   - vercel.json crons (Vercel injects it automatically as Bearer auth
#     for cron invocations once CRON_SECRET is set in env)
```

## Rollback

The deploy script has no built-in rollback for migrations — Supabase
migrations are forward-only by convention here. For an emergency
rollback:

1. `git revert <commit>` to undo the deploy commit and push (Vercel
   auto-deploys the revert).
2. For schema rollback: write a new migration (`0013_rollback_xyz.sql`)
   that undoes the change. Never drop or rewrite an applied migration
   in place — it breaks the migration-tracking checksum.

## Troubleshooting

**`supabase db push` says "no linked project"**: run `supabase link
--project-ref <ref>` first. Your ref is in the Supabase dashboard URL.

**`fly deploy` says "no app set"**: run `fly apps list` to confirm the
app exists; the scraper's `scraper/fly.toml` declares the app name. If
this is a fresh deploy, run `fly apps create <name>` first.

**`/api/health` returns 503**: the DB ping failed. Check that
`SUPABASE_SERVICE_ROLE_KEY` is set in Vercel production env and that
the project URL matches.

**Migrations fail mid-way**: Supabase migrations run in transactions
per file. A failed file rolls back; earlier files are durable. Fix the
SQL, push again — the migration tracker re-runs from the failure point.
