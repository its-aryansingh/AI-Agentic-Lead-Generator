# LeadGenAI Deployment Guide

This guide details how to deploy LeadGenAI across its three core infrastructure providers: Supabase (Database + Auth), Fly.io (Scraper Microservice), and Vercel (Next.js App + Crons).

---

## 1. Supabase (Database & Auth)

Supabase hosts the PostgreSQL database, Handles Row Level Security (RLS), and manages Google OAuth.

### 1.1 Database Migrations
The Supabase CLI ships as a devDependency, so `npm install` is enough —
there is nothing separate to install.

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npm run db:push
```

**Recommended path is `npm run db:push`.** It applies all **18** files in
`supabase/migrations/`, `00000000000001_schema_init.sql` →
`00000000000019_campaign_mailbox_rotation.sql`, in version order. Every
migration is additive and idempotent, so a clean push is safe.

> **The 14-digit filenames are required, not cosmetic.** The Supabase CLI
> only recognises migrations whose names begin with a 14-digit version
> prefix. The original `0001_init.sql` style was silently skipped by
> `db push` — files were renamed in `8e6372b` to fix exactly that. Do not
> rename them back, and create new ones with `npx supabase migration new`.

If you prefer the Dashboard SQL Editor, paste
`supabase/FULL_SCHEMA_DEPLOY.sql` — it is every migration concatenated in
order and is safe to run more than once. Regenerate it with
`npm run db:bundle` after adding a migration; it is generated, so do not
edit it by hand.

*(Note: `00000000000004_sequences_sending.sql.bak` is excluded on purpose.
Its nine tables are already created by `00000000000005_sequences.sql` and
`00000000000007_sending.sql`, and the CLI ignores non-`.sql` files.)*

### 1.2 Auth & Google Setup
1. In the Supabase Dashboard, go to **Authentication > Providers > Google**.
2. Enable it and input your Google OAuth Client ID and Secret (from Google Cloud Console).
3. Ensure you have the proper Redirect URIs set in Google Cloud:
   - `https://<your-vercel-domain>/api/auth/callback`
   - `https://<your-vercel-domain>/api/mailbox/callback`

---

## 2. Fly.io (Scraper Microservice)

The Playwright web scraper runs as a separate microservice to avoid Vercel's serverless size limits.

### 2.1 Deployment
1. Install the `flyctl` CLI.
2. Authenticate: `fly auth login`.
3. Deploy the service:
```bash
cd scraper
fly deploy
```

### 2.2 Secure the Service
Generate a secure, random string (e.g., using `openssl rand -hex 32`) to act as your scraper key.
Set this as a secret in Fly:
```bash
fly secrets set SCRAPER_KEY="your_secure_random_string"
```

Save the Fly app URL and the `SCRAPER_KEY` for the Vercel environment variables.

---

## 3. Vercel (Next.js App & Crons)

Vercel hosts the Next.js App Router, API endpoints, and triggers our scheduled cron jobs.

### 3.1 Environment Variables
Before deploying, make sure you've added the following production variables in Vercel:

**Supabase**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (Important: Keep this secure!)

**Core Services**
- `ANTHROPIC_API_KEY`
- `BRAVE_SEARCH_KEY`
- `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`

**Infrastructure Wiring**
- `SCRAPER_URL` (e.g., `https://lead-gen-scraper.fly.dev`)
- `SCRAPER_KEY` (Must match the Fly.io secret)
- `CRON_SECRET` (A random string used to secure `/api/cron/*` endpoints)
- `UNSUB_SECRET` & `MAILBOX_STATE_SECRET` (Random strings for HMAC signing)

**Inngest (Async Queue)**
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`
> **Important Note:** In production, LeadGenAI enforces Inngest for bulk jobs exceeding 20 prospects. If `INNGEST_EVENT_KEY` is not provided, bulk enrichments will throw an error rather than silently falling back to Vercel's 15-second synchronous timeout limits.

### 3.2 Cron Jobs
Vercel Crons are already configured in `vercel.json` to hit:
- `/api/cron/send-due` (every 15 min)
- `/api/cron/detect-replies` (every 20 min)
- `/api/cron/poll-intent` (every hour)

These endpoints require the `CRON_SECRET` to be sent in the `Authorization: Bearer <token>` header. Vercel does this automatically if you set `CRON_SECRET` in your Vercel Environment Variables.

---

## 4. Inngest (Async Queue)

Inngest handles fan-out background jobs (like enriching 50 prospects at once) without hitting Vercel's execution time limits.

1. Go to the [Inngest Dashboard](https://app.inngest.com/).
2. Create a new environment / project.
3. Obtain your `Event Key` and `Signing Key`.
4. Add these to Vercel as `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.
5. Point the Inngest webhook to your Vercel domain: `https://<your-vercel-domain>/api/inngest`.
