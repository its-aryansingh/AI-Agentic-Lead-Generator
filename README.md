# LeadGenAI

AI BDR workforce for B2B sales teams in India and Southeast Asia.

> Describe your ideal customer in plain English. A team of bounded
> specialist sub-agents — Prospector, Researcher, Copywriter,
> Compliance, Outreach — finds the prospects, drafts personalized
> outreach, sends from your Gmail (or WhatsApp), classifies replies,
> and pushes contacts to your CRM. Mobile + Chrome side-panel keep
> you in the loop.

Current cut: **v0.9**. Feature-complete across every backend lane;
deploy with `pwsh scripts/deploy.ps1 all`. Product spec in
[`docs/PRD.md`](./docs/PRD.md); architecture in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md); deployment in
[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md); mobile scope in
[`docs/MOBILE.md`](./docs/MOBILE.md).

---

## What ships in v0.8

**Multi-agent orchestration.** The chat agent (Claude Sonnet 4.6) is
an orchestrator that delegates to five bounded specialist sub-agents
(Haiku; copywriter on Sonnet). Each specialist has its own bounded
tool catalog and a hard step cap. Streams "team working" cards into
the UI so the user sees who's doing what.

**Nine agent tools** (`lib/agent/tools.ts`):
`web_search`, `public_source_search`, `enrich_prospect`,
`clarify_question`, `add_named_prospects`, `start_bulk_job`,
`launch_campaign` (email or WhatsApp), `push_to_crm` (HubSpot or
Zoho), `draft_reply` (closes the reply loop — drafts a contextual
response to a hot inbound for the user to review before sending).
All mock-safe when their providers are unconfigured.

**Outbound channels.** Email via the user's connected Gmail (warm-up
caps, send windows, suppression list, compliance footer) and
WhatsApp via any BSP (Gupshup, Twilio, Interakt, Meta Cloud API).
Both gate on explicit confirmation; nothing sends from the agent's
own initiative.

**Reply loop.** Inbound is detected via Gmail polling (`detect-replies`
cron, every 20m) and the WhatsApp webhook (`/api/webhooks/whatsapp`).
A Claude Haiku classifier sorts replies into
`interested`/`question`/`objection`/`out_of_office`/`unsubscribe`/`not_interested`/`other`
plus a separate `wants_meeting` boolean (decoupled — an objection can
still propose a call) and routes the high-signal ones into the Inbox
+ fires WhatsApp + push + Slack alerts. The `draft_reply` agent tool
turns the round-trip into one click: ask the agent, get back a tight
contextual response with a discrete next-step (book / answer-objection
/ send-info / wait / close-lost). The user always reviews and presses
Send themselves.

**Bulk async.** Batches above 20 prospects hand off to Inngest
(`bulk-enrich.ts`) with per-prospect retry and bounded concurrency.
Up to 20 still runs sync inside the chat response so small flows
feel instant.

**Sending hygiene.** Per-mailbox warm-up ramp (Instantly/Smartlead
parity): day 0 = 10/day, day 7 = 50, day 30 = 200, day 60 = 300 with
linear interpolation between checkpoints. Send windows + suppression
list + bounce-handling + CAN-SPAM footer + DPDP-compliant unsubscribe
all enforced in `app/api/cron/send-due/route.ts`. Pre-flight
deliverability check at `/api/domain-check` flags SPF/DKIM/DMARC gaps
before the first send.

**Playwright scraper microservice.** Fly.io-deployable
(`scraper/fly.toml`) — extracts emails from team/about/contact pages
and pulls recent news per company. Mock-safe locally.

**India edge** (Phase 3a-e):
- WhatsApp ALERTS — opt-in per user, fires on automation done / hot
  reply (`lib/notifications.ts`)
- WhatsApp OUTREACH — pre-approved templates, STOP/UNSUBSCRIBE
  inbound suppression, dedicated channel on `campaign_recipients`
- Vernacular drafting — Claude prompts adjust for hi/mr/ta/te/bn/gu
  on top of `voice_anchor_text`
- DPDP right-to-erasure — `/app/settings/privacy` + `/api/dpdp/erase`
- Razorpay Subscriptions + UPI AutoPay alongside one-time checkout

**Task automation engine** (Phase 2). User says
*"every Monday find 20 fintech CMOs and draft outreach"* → stored
in `automations`, hourly cron picks up due rows, runs the full
orchestrator headlessly, records the outcome in `automation_runs`,
fires WhatsApp + push notifications on completion.

**Chrome extension** (Phase 4). Side-panel chatbot that bearer-authenticates
into `/api/chat` from the `chrome-extension://[id]` origin (Supabase
cookies can't cross there). Service worker polls
`/api/extension/alerts` every minute and raises native
`chrome.notifications` for hot replies and finished automations.

**Mobile backend** (Phase 6 prereqs). `push_tokens` table +
`/api/extension/push-register` + Expo Push provider. RN/Expo client
lands next per `docs/MOBILE.md`.

**CRM push** (Phase 8). HubSpot or Zoho — upsert contact by email,
attach the research summary + drafted email as a Note. Single
`push_to_crm` tool selects the vendor.

**Deliverability.** Pre-flight SPF/DKIM/DMARC checker at
`/api/domain-check?domain=<host>` — probes 17 common DKIM selectors,
parses SPF policy + lookup count, parses DMARC tags, returns a
`good`/`fair`/`poor` grade with concrete fixes. 24h cached, bearer +
cookie auth.

**Launch-readiness probe.** `/api/health` returns the 13-provider
configuration matrix, DB ping latency, latest migration filename,
cron schedule snapshot, and uptime. Returns 503 when DB ping fails
so uptime monitors flip correctly.

**Notification channels (3).** Every alert event (hot reply,
automation completion / failure) fires across all enabled channels:
WhatsApp (BSP), push (Expo native + Web Push VAPID for the Chrome
extension), and Slack (per-user Incoming Webhook). Each is opt-in
and mock-safe individually; failure of one channel never breaks the
others.

**Billing.** Stripe (international) + Razorpay (India), both with
signature verification and idempotent webhooks. Plans:
free/starter/pro/agency with monthly credit reset.

---

## Run in five minutes (mock mode)

The whole product boots with no keys except Supabase. Real outputs
get a `demo data` badge so you can't confuse them with the real thing.

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase, leave the rest blank
npm run dev
# open http://localhost:3000
```

---

## Wire up real providers

| Variable | Unlocks |
|---|---|
| `ANTHROPIC_API_KEY` | Real Claude drafting (Sonnet 4.6 + Haiku 4.5) |
| `BRAVE_SEARCH_KEY` | Real prospect discovery (2000 free queries/mo) |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Google OAuth + Sheets export + Gmail send |
| `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` | Async bulk fan-out (>20 prospects) |
| `SCRAPER_URL` + `SCRAPER_KEY` | Real Playwright scraping (vs. mock company data) |
| `WHATSAPP_API_URL` + `WHATSAPP_API_KEY` + `WHATSAPP_FROM` | Real WhatsApp send + inbound webhook |
| `HUBSPOT_API_KEY` | Real HubSpot CRM push |
| `ZOHO_REFRESH_TOKEN` + `ZOHO_CLIENT_ID` + `ZOHO_CLIENT_SECRET` (+ `ZOHO_REGION`) | Real Zoho CRM push |
| `EXPO_PUSH_ACCESS_TOKEN` | Real mobile push notifications |
| `STRIPE_SECRET_KEY` / `RAZORPAY_KEY_ID` | Real billing |
| `CRON_SECRET` | Required in prod — Vercel cron auth |

Full catalogue in [`.env.local.example`](./.env.local.example).

With Anthropic + Brave + Google configured, the chat flow uses real
APIs end-to-end at ~$0.03 per enriched prospect.

---

## Architecture at a glance

```
Browser / Side panel / Mobile
        │ (bearer or cookie auth)
        ▼
/api/chat (orchestrator)
        ├── delegates → Prospector  (web_search, public_source_search, add_named_prospects)
        ├── delegates → Researcher  (enrich_prospect)
        ├── delegates → Copywriter  (no tools — pure writing)
        ├── delegates → Compliance  (no tools — pure review)
        └── delegates → Outreach    (start_bulk_job, launch_campaign, push_to_crm)
                                          │
            ┌─────────────────────────────┼──────────────────────────────┐
            ▼                             ▼                              ▼
        Gmail send                  WhatsApp BSP                   Inngest queue
        (warm-up,                   (templates,                    (bulk > 20)
         suppression)                opt-out)                            │
                                                                         ▼
                                                                Playwright scraper
                                                                (Fly.io)

Cron workers (every 15-60m)
  send-due           queue → Gmail / WhatsApp
  detect-replies     Gmail poll → classify → reply_classifications + push
  advance-sequences  cadence step scheduler
  run-automations    headless orchestrator runs of scheduled instructions
  poll-intent        keyword watches
```

Full breakdown in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## Database

```bash
supabase db push        # or scripts/deploy.sh migrations
```

12 migrations under [`supabase/migrations/`](./supabase/migrations/) covering:
core tables (`0001_init`), sending leg (`0002_sequences_sending`),
intent (`0003`), legacy reconcile (`0005_consolidate`), automations
(`0006`), WhatsApp notifications (`0007`), outreach language (`0008`),
DPDP (`0009`), Razorpay subscriptions (`0010`), WhatsApp outreach
(`0011`), push tokens (`0012`). All idempotent + additive — never
re-edit an applied migration in place.

RLS on every user-data table; service-role bypasses it for trusted
server contexts only (cron workers, webhook handlers, agent tool
handlers).

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, RSC, Server Actions) |
| UI | Tailwind v4 + shadcn (`@base-ui/react`) |
| DB + Auth | Supabase Postgres + Supabase Auth (Google OAuth) |
| AI | Anthropic Claude — Sonnet 4.6 (orchestrator + copywriter), Haiku 4.5 (specialist sub-agents + reply classifier) |
| Discovery | Brave Search + DuckDuckGo fallback + GitHub + ProductHunt + HN Algolia |
| Sending | Gmail OAuth + WhatsApp BSP |
| Async | Inngest |
| Scraping | Playwright on Fly.io |
| CRM | HubSpot + Zoho |
| Mobile | Expo Push (client TBD) |
| Billing | Stripe + Razorpay |
| Hosting | Vercel |
| Testing | Node built-in test runner (`--experimental-strip-types`) |

---

## Scripts

```bash
# Local dev
npm run dev                      # next dev with HMR
npm test                         # unit tests
npm run lint                     # eslint
npm run build                    # production build
npm run db:push                  # supabase db push

# Launch
pwsh ./scripts/deploy.ps1 pre-flight                                # audit env
pwsh ./scripts/deploy.ps1 all -HealthUrl https://<prod>/api/health  # full deploy

# Team coordination (private companion repo for COORDINATION.md etc.)
pwsh ./scripts/coord-init.ps1 -RepoUrl <private-coord-repo-url>
pwsh ./scripts/coord-pull.ps1     # before any agent work
pwsh ./scripts/coord-push.ps1     # share your edits with the team
```

POSIX `.sh` twins for every script. See [`scripts/DEPLOY.md`](./scripts/DEPLOY.md)
and [`scripts/COORD_SETUP.md`](./scripts/COORD_SETUP.md).

---

## What's NOT in v0.9 (intentionally deferred)

- **Mobile RN/Expo client.** Backend (push registration + push-fire +
  draft_reply) is shipped and waiting; spec in
  [`docs/MOBILE.md`](./docs/MOBILE.md).
- **Live SMTP probe (port-25 verify).** Hosts block port 25; current
  email-confidence path is DNS MX + pattern guessing + scraped real
  emails. A paid-API fallback (ZeroBounce / AbstractAPI) is a future
  option.
- **CRM beyond HubSpot + Zoho.** Salesforce / Pipedrive are
  candidates for v1.0.
- **A/B variant testing on drafts** — measure reply-rate per variant.
- **Multi-channel sequences** (email → WhatsApp → email cadence) —
  v1.0 candidate.

---

## License

Proprietary. © 2026 LeadGenAI.
