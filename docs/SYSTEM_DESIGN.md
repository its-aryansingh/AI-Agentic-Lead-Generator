# LeadGenAI System Design

**Current cut:** v0.9
**Last updated:** 2026-05-29
**Audience:** engineering agents, future maintainers, deployment operators

This document is the current system design for LeadGenAI. It reflects the shipped v0.9 product described in `README.md` and `COORDINATION.md`. Older architecture notes in `docs/ARCHITECTURE.md` are useful historical context, but this file should be treated as the compact current-state design reference.

## 1. Product Shape

LeadGenAI is an AI BDR workforce for B2B sales teams in India and Southeast Asia.

The core user flow:

1. A user describes an ICP, uploads named prospects, or asks about a single person.
2. The chat orchestrator delegates to bounded specialist agents.
3. The system discovers, enriches, drafts, exports, sends, tracks replies, and optionally pushes records to CRM.
4. High-signal replies and automation completions notify the user through the web app, Chrome extension, WhatsApp, push, and Slack depending on configured channels.

The product is mock-safe: most external providers degrade to deterministic mock behavior when credentials are absent.

## 2. Runtime Topology

```
Browser / Chrome extension / future mobile client
  |
  | cookie auth or Authorization: Bearer <supabase access token>
  v
Next.js 16 App Router on Vercel
  |
  |-- /api/chat                         AI orchestrator + tools
  |-- /api/cron/*                       scheduled workers
  |-- /api/inngest                      background function handler
  |-- /api/mailbox/*                    Gmail OAuth and mailbox connect
  |-- /api/webhooks/*                   billing, WhatsApp, provider webhooks
  |-- /api/extension/*                  extension/mobile-style bearer APIs
  |-- /api/export/*                     CSV and Google Sheets export
  |-- /api/health                       launch-readiness probe
  |
  |-- Supabase Postgres + Auth          source of truth
  |-- Inngest                           async fan-out for larger jobs
  |-- Fly.io scraper                    Playwright company/news scraping
  |-- Google APIs                       OAuth, Sheets, Gmail
  |-- Anthropic                         orchestration, drafting, classification
  |-- WhatsApp BSP                      alerts and outreach templates
  |-- Stripe/Razorpay                   billing
  |-- HubSpot/Zoho                      CRM push
```

## 3. Main Components

| Component | Location | Responsibility |
|---|---|---|
| Web app | `app/` | Marketing, authenticated dashboard, chat, jobs, inbox, pipeline, analytics, sequences, settings |
| Chat API | `app/api/chat/route.ts` | Authenticates request, persists chat messages, runs AI SDK streaming with tools |
| Agent definitions | `lib/agent/tools.ts` | Zod schemas and AI SDK tool wrappers only |
| Tool handlers | `lib/agent/tool-handlers.ts` | Business logic for discovery, enrichment, bulk jobs, sending, CRM, reply drafting |
| Specialist agents | `lib/agent/*` | Bounded sub-agent orchestration and prompts |
| Providers | `lib/providers/*` | Thin wrappers around Brave, Product Hunt, GitHub, HN, Anthropic, Google, Gmail, CRM, etc. |
| Supabase clients | `lib/supabase/*` | Browser RLS client and server/admin clients |
| Inngest | `inngest/`, `app/api/inngest/` | Async bulk enrichment and background fan-out |
| Cron workers | `app/api/cron/*` | Send due messages, detect replies, advance sequences, automations, intent polling |
| Scraper | `scraper/` | Fly.io Fastify + Playwright microservice |
| Chrome extension | `chrome-extension/` | Side-panel chat, bearer auth bridge, native alert polling |
| Deployment scripts | `scripts/` | Pre-flight, deploy, coordination helper scripts |

## 4. Auth And Request Identity

There are two supported auth paths:

1. **Browser cookie auth.** Supabase Auth session cookies are refreshed server-side. Server Components and API routes use the RLS-scoped server client unless they explicitly need admin writes.
2. **Bearer auth.** Chrome extension and future mobile clients call selected APIs with `Authorization: Bearer <supabase access token>`. `lib/api-auth.ts` validates the token with Supabase Admin and returns a narrowed auth result.

Rules:

- Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser or client bundles.
- Server Components should use the RLS-scoped Supabase server client.
- Cron, webhooks, and tool handlers may use the admin client, but must enforce user ownership in code when bypassing RLS.
- The extension and mobile-style APIs should prefer bearer auth because browser cookies do not cross from `chrome-extension://` origins.

## 5. Chat And Agent Flow

`POST /api/chat` is the product center.

```
request
  -> resolve user via cookie or bearer token
  -> resolve/create chat session
  -> persist user message
  -> run AI SDK streamText with makeTools(ctx)
  -> model may call tools
  -> tool handler writes/read DB and providers
  -> persist assistant text + tool call results
  -> return UI-message stream
```

Current tool surface:

| Tool | Purpose |
|---|---|
| `web_search` | Public web discovery through Brave/DuckDuckGo-backed provider |
| `public_source_search` | GitHub, Product Hunt, and HN Algolia style vertical discovery |
| `enrich_prospect` | Single named prospect research and draft |
| `clarify_question` | Ask focused follow-up when user intent is too vague |
| `add_named_prospects` | Stage explicitly provided names/CSV rows without search |
| `start_bulk_job` | Bulk enrichment and export, sync for small batches and Inngest for large ones |
| `launch_campaign` | Queue Gmail or WhatsApp outreach after explicit user confirmation |
| `push_to_crm` | Push enriched contacts to HubSpot or Zoho |
| `draft_reply` | Draft a contextual response to a high-signal inbound reply for user review |

Hard safety boundaries:

- `launch_campaign` must never run without explicit user confirmation to send real messages.
- `start_bulk_job` must only run after the user confirms scope.
- Mock fallbacks must remain deterministic and obvious in the UI.
- Tool context (`userId`, `sessionId`) is server-injected by `makeTools(ctx)`.

## 6. Data Model Overview

Supabase Postgres is the source of truth. The schema is migration-based under `supabase/migrations/`.

Major table groups:

| Group | Key tables | Purpose |
|---|---|---|
| Core identity/chat | `users`, `chat_sessions`, `chat_messages` | User profile, credits, voice anchor, conversation history |
| Discovery/enrichment | `prospect_candidates`, `jobs`, `prospects`, `scrape_cache`, `credit_transactions` | Staged candidates, enrichment jobs, enriched rows, cache, credit ledger |
| Sending | `mailboxes`, `sequences`, `sequence_steps`, `sequence_enrollments`, `campaigns`, `campaign_recipients`, `suppressions`, `email_events` | Gmail/WhatsApp campaign and cadence state |
| Replies/intent | `reply_classifications`, `intent_watches`, `intent_triggers` | Reply routing and intent signals |
| Automation | `automations`, `automation_runs` | Scheduled headless agent runs |
| Billing | Stripe/Razorpay customer, subscription, payment, and webhook rows | Plan and credit lifecycle |
| Notifications | `push_tokens`, WhatsApp/slack notification config fields | Alert delivery |
| Webhooks | `webhook_events` | Idempotency for third-party callbacks |

RLS is enabled for user data. Admin code must still apply ownership filters explicitly when using service-role access.

## 7. Bulk Enrichment

Bulk enrichment has two execution modes:

- **Sync path:** small jobs up to roughly 20 prospects run inside the chat/tool request for fast feedback.
- **Async path:** larger batches emit Inngest events when `INNGEST_EVENT_KEY` is configured. Inngest fans out per-prospect work with retries and bounded concurrency.

Per prospect, the system:

1. Resolves company/domain context.
2. Uses cached public search/scrape data when available.
3. Gets company/news signals through the scraper provider or mock fallback.
4. Guesses or extracts email, then applies DNS MX confidence where possible.
5. Drafts research summary, subject, body, and talking points.
6. Writes `prospects`, updates `jobs`, and produces Sheet/CSV output.

`scrape_cache` is the main cost-control lever. External search and scraping should always go through `getOrSetCache()` or an equivalent cache-aware provider path.

## 8. Sending, Replies, And Notifications

Sending is queue-based. `launch_campaign` creates campaigns and recipients. `send-due` cron dispatches due recipients while enforcing:

- mailbox warm-up ramp
- send windows
- suppression list
- unsubscribe footer and DPDP/CAN-SPAM constraints
- bounce and failure updates

Reply intake:

- Gmail replies are detected by `detect-replies` cron.
- WhatsApp inbound messages arrive through `/api/webhooks/whatsapp`.
- Claude Haiku classification assigns reply category plus high-signal routing metadata.
- High-signal replies are shown in Inbox and can trigger WhatsApp, push, Slack, and extension alerts.
- `draft_reply` generates a suggested user-reviewed response. It does not send automatically.

Notification surfaces:

| Surface | Mechanism |
|---|---|
| Web app | Inbox, pipeline, analytics, automations |
| Chrome extension | Service worker polls `/api/extension/alerts` and raises `chrome.notifications` |
| Mobile backend | Expo push token registration and push provider |
| WhatsApp alerts | BSP template/send wrapper |
| Slack | Per-user incoming webhook |

Notification failures should not break the underlying sending/reply pipeline.

## 9. External Providers

| Provider | Files | Mock behavior |
|---|---|---|
| Anthropic | `lib/providers/anthropic.ts` | Deterministic draft/research text when key absent |
| Brave/DuckDuckGo | `lib/providers/brave-search.ts` | Deterministic Indian/SEA SaaS sample candidates |
| Product Hunt | `lib/providers/producthunt.ts` | Mock makers/products when token absent |
| GitHub/HN | `lib/providers/github.ts`, `lib/providers/hn-algolia.ts` | Public/free API wrappers with graceful fallback behavior |
| Google Sheets | `lib/providers/google-sheets.ts` | Mock sheet URL/CSV when refresh token absent |
| Gmail | `lib/providers/gmail.ts` | Mock send path when mailbox/provider unavailable |
| WhatsApp | WhatsApp provider/webhook code | Mock-safe templates and inbound normalization |
| CRM | HubSpot/Zoho provider code | Mock-safe upsert/note behavior without real credentials |
| Push/Slack | notification providers | Per-channel failure isolation and mock-safe behavior |

New providers must remain thin wrappers. Product/business orchestration belongs in tool handlers or dedicated service modules, not in provider clients.

## 10. Deployment

There are three primary deployables:

| Deployable | Host | Notes |
|---|---|---|
| Next.js app | Vercel | App Router, API routes, cron routes, Inngest route |
| Scraper service | Fly.io | Playwright/Fastify service with `SCRAPER_KEY` auth |
| Chrome extension | Chrome Web Store or unpacked dev build | Side-panel chatbot and notification service worker |

Operational prerequisites:

1. Apply Supabase migrations in order.
2. Configure Supabase Google OAuth redirect URLs.
3. Set Vercel environment variables.
4. Deploy scraper and set `SCRAPER_URL`/`SCRAPER_KEY`.
5. Configure Inngest event/signing keys.
6. Configure real provider keys for production outputs.
7. Check `/api/health` for provider matrix, DB ping, cron schedule snapshot, migration visibility, and uptime.

`scripts/deploy.ps1` and POSIX script twins are the intended launch helpers.

## 11. Reliability And Failure Modes

| Failure | Expected behavior |
|---|---|
| Provider key missing | Use mock fallback where supported |
| Brave quota/rate limit | Fall back to alternate/mock discovery path |
| Scraper unavailable | Use cached/mock company data; mark confidence lower |
| Inngest not configured | Large bulk jobs should not silently exceed serverless limits |
| Gmail send failure | Mark recipient failed/bounced and continue other recipients |
| WhatsApp opt-out | Suppress future WhatsApp outreach and update recipient state |
| Notification channel fails | Log/skip channel; do not fail core workflow |
| Webhook duplicate | Use `webhook_events` idempotency |
| Credits insufficient | Refuse job before enrichment |
| DB ping failure | `/api/health` returns 503 |

## 12. Security And Compliance

Required invariants:

- No service-role keys in browser/client code.
- All user data tables use RLS where practical.
- Admin routes and cron handlers must verify secrets or authenticated user ownership.
- Webhooks must verify provider signatures or configured secrets.
- Sending actions require explicit confirmation.
- Unsubscribe and suppression paths must be respected by all sending channels.
- DPDP erasure must remove or anonymize user-owned data according to the shipped privacy flow.
- Logs should not print provider secrets, refresh tokens, access tokens, or service-role keys.

## 13. Testing And Validation

The project uses Node's built-in test runner:

```bash
npm test
npm run lint
npm run build
```

Current coordination note: `tests/*` is actively owned by Helper Agent for end-to-end validation, so other agents should avoid editing tests until that claim clears.

Validation focus areas:

- CSV parse and named-prospect staging
- email pattern and MX confidence behavior
- reply classification and `draft_reply`
- webhook normalization/idempotency
- Inngest fan-out and load behavior
- notification channel isolation
- launch-readiness health probe
- Chrome extension bearer-auth flow

## 14. Current Intentional Gaps

These are not missing-by-accident:

- Live SMTP RCPT probe: deferred because many hosts block port 25 and large providers accept-all.
- Mobile RN/Expo client: backend and spec exist; client implementation is a future/mobile-agent lane.
- CRM breadth beyond HubSpot/Zoho.
- Draft A/B testing and reply-rate analytics by variant.
- Deeper multi-channel sequence optimization.

## 15. Ownership Notes For Agents

- `COORDINATION.md` is the live source for claims and priority.
- `docs/SYSTEM_DESIGN.md` is the current compact architecture reference.
- `docs/ARCHITECTURE.md` is historical and still contains v0.5/v1 planning material.
- Do not edit `tests/*` while Helper Agent owns validation.
- Do not edit `lib/agent/*`, `app/api/chat/route.ts`, or provider internals without checking current coordination claims.
