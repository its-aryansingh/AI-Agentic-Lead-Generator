# LeadGenAI Deployment Guide

This guide details how to deploy LeadGenAI across its three core infrastructure providers: Supabase (Database + Auth), Fly.io (Scraper Microservice), and Vercel (Next.js App + Crons).

---

## 1. Supabase (Database & Auth)

Supabase hosts the PostgreSQL database, Handles Row Level Security (RLS), and manages Google OAuth.

### 1.1 Database Migrations
We have bundled a script to make applying migrations easier.
Ensure you have the Supabase CLI installed, or run it via npx:

```bash
# Push ALL local migrations to your linked remote database, in order
npm run db:push
```

**Recommended path is `npm run db:push`** — it applies every file in
`supabase/migrations/` (`0001` → `0016`) in numeric/lexical order. The
migrations are additive and idempotent (`create ... if not exists`), so a
clean push is safe.

If you prefer the Supabase Dashboard SQL Editor, apply **all** files in
`supabase/migrations/` in filename order, top to bottom — do not cherry-pick.
The set currently spans `0001_init.sql` through `0016_campaign_mailbox_rotation.sql`
and includes intent, automations, WhatsApp, DPDP, Razorpay, push tokens,
Slack, calendar, and mailbox-rotation tables. Skipping any of them leaves
features (automations, Slack alerts, sequences, etc.) without their tables.

*(Note: several `0002_*` files share the prefix and `0004_sending.sql` is
superseded by `0005_consolidate.sql`; because every migration is
idempotent, applying them all in filename order is still correct — the
first `create if not exists` wins and later ones no-op.)*

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
