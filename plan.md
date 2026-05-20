# LeadGenAI — Phase Tracker

**Master context:** See `COORDINATION.md` for full history, architecture, and action log.  
**Last Updated:** 2026-05-21  
**Current Phase:** v0.5 MVP complete → entering v0.6 (real implementations of scaffolded pages)

---

## Phase 1 — Project Foundation (DONE)

- [x] Next.js 16 + TypeScript scaffold
- [x] `plan.md` for multi-agent coordination
- [x] Tailwind v4 + shadcn/ui design system
- [x] AI SDK, Zod, googleapis, env template
- [x] Supabase Auth middleware + OAuth callback + RLS policies
- [x] `lib/supabase/{server,client}.ts` + full DB schema (`0001_init.sql`)

## Phase 2 — Chat Surface (DONE)

- [x] `/api/chat` streaming route (Vercel AI SDK + Claude Sonnet 4.6)
- [x] `clarify_question` tool
- [x] `web_search` tool (Brave Search + mock)
- [x] Chat session + message persistence
- [x] Chat UI with streaming tool-call cards (`chat-client.tsx`)

## Phase 3 — Enrichment Pipeline (DONE)

- [x] `enrich_prospect` tool (single-prospect, sync)
- [x] `start_bulk_job` tool → synchronous enrichment (fine up to ~20)
- [x] `add_named_prospects` tool
- [x] `public_source_search` tool (GitHub, ProductHunt, HN Algolia)
- [x] `launch_campaign` tool (Gmail, warm-up caps, suppression)
- [x] Email compliance (CAN-SPAM / GDPR)
- [x] Credit system (free tier: 25/mo)
- [x] Cache layer (`lib/cache.ts` → `scrape_cache` table)
- [x] All providers with mock fallbacks

## Phase 4 — Bulk Pipeline + Exports (DONE)

- [x] Google Sheets export (`/api/export/sheets`)
- [x] CSV download (`/api/export/csv`)
- [x] Job history page (`/app/jobs`)
- [x] Job detail page (`/app/jobs/[id]`)

## Phase 5 — V2 Sending Infrastructure (SCAFFOLDED — needs real implementation)

- [x] Gmail mailbox connect + OAuth (`app/api/mailbox/`, `app/app/settings/mailboxes/`)
- [x] Cron routes scaffolded (detect-replies, poll-intent, send-due)
- [x] Sequences pages scaffolded (list, new, detail)
- [x] Inbox page scaffolded
- [x] Pipeline page scaffolded
- [x] Analytics page scaffolded
- [x] Unsubscribe landing (`/u/[token]`)
- [x] Reply classifier (`lib/reply-classify.ts`)
- [ ] **Real inbox** — pull/display Gmail replies (cron → DB → UI)
- [ ] **Real pipeline** — Kanban by prospect stage
- [ ] **Real analytics** — charts for email/reply/credit metrics
- [ ] **Real sequences** — multi-step email sequence builder
- [ ] CSV upload UI

## Phase 6 — Async + Scraper (DEFERRED)

- [ ] Inngest async queue for bulk jobs >20 prospects
- [ ] Playwright scraper microservice (`scraper/` → Fly.io)
- [ ] SMTP email verification (stubs in `lib/email-patterns.ts`)

## Phase 7 — Monetization (DEFERRED — post-PMF)

- [ ] Billing: Razorpay (India) + Stripe (international)
- [ ] Plan enforcement on credits

## Phase 8 — Extensions (POST-PMF — do not build yet)

- [ ] Chrome extension
- [ ] CRM push: HubSpot + Zoho
- [ ] Public ProductHunt / HN discovery (full implementation)

---

*(Update this file alongside every commit. Single source of truth for phase progress.
Full action log in COORDINATION.md Section 13.)*
