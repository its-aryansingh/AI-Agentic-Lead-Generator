# COORDINATION.md — Master Agent Context File
# LeadGenAI | Single Source of Truth for All AI Agents

> **MANDATORY FOR ALL AI AGENTS (Claude CLI, Antigravity CLI, Codex / OpenAI):**
>
> 1. Read this entire file before touching any code.
> 2. Acknowledge internally that you have read it.
> 3. Work ONLY within the scope defined here.
> 4. Record every significant action in the **Action Log** (Section 13).
> 5. Update Section 3 (Current Status) whenever a feature ships or changes.
> 6. Never remove or overwrite another agent's log entries.
> 7. This file supersedes all other context files. When in conflict, this file wins.

---

## 1. Project Identity

| Field | Value |
|---|---|
| **Product name** | LeadGenAI |
| **Tagline** | AI-powered prospecting copilot for B2B sales teams in India and Southeast Asia |
| **Version** | v0.5 MVP — Feature-complete; refinement & integration mode |
| **Owner** | Aryan Singh (arajsingh0505@gmail.com) |
| **Repo** | `its-aryansingh/AI-Agentic-Lead-Generator` |
| **Branch** | `master` (active dev), `main` (stable base) |
| **Primary docs** | `docs/PRD.md`, `docs/ARCHITECTURE.md`, `plan.md`, `AGENTS.md` |

**One-line description:** User describes their ideal customer in plain English → LeadGenAI finds matching prospects, drafts a personalized first-touch email per prospect, exports to Google Sheets or CSV.

---

## 2. Claude.ai (Cowork) — Full Session History

This section records everything built during Claude.ai cowork sessions before the switch to VS Code + CLI tools. Do not delete — this is the permanent history.

### Session History (Chronological)

#### Session Block 1 — Project Foundation (Commits 0198155 → 8bf26b7)
**Tool:** Claude.ai Cowork  
**Date range:** ~2026-05-09 to 2026-05-12

What was built:
- `0198155` — Next.js 16 (App Router) + TypeScript project scaffold
- `53d3aba` — `plan.md` created as multi-agent coordination tracker
- `3d91e66` — Tailwind v4 + shadcn/ui (`@base-ui/react`) design system wired in; `components.json` configured
- `e18f5c7` — Vercel AI SDK (`ai` v6), Zod, `googleapis` v171, `@ai-sdk/anthropic` installed; `.env.local.example` created
- `28d7027` — Supabase Auth middleware (`middleware.ts`), OAuth callback route (`app/api/auth/callback/route.ts`), RLS insert policies for `public.users`
- `8bf26b7` — `lib/supabase/server.ts` (SSR + admin client), `lib/supabase/client.ts` (browser client), `supabase/migrations/0001_init.sql` (full DB schema)

#### Session Block 2 — Architecture Docs + Full Feature Build (Commits ae5619b → 5f40280)
**Tool:** Claude.ai Cowork  
**Date range:** ~2026-05-16 to 2026-05-20

What was built:
- `ae5619b` — `docs/ARCHITECTURE.md` (full v0.5 architecture), `docs/ARCHITECTURE_V1.md` (v0.4 reference), `docs/PRD.md` (product spec), `docs/SENDING_AGENT.md` (v2 email-send spec); shadcn/ui config finalized
- `62f9e75` — **Massive feature commit.** Built in one batch:
  - `app/api/chat/route.ts` — streaming chat endpoint (Vercel AI SDK + Claude Sonnet 4.6, session persistence, mock fallback)
  - `lib/agent/tools.ts` — 7 tool definitions with Zod schemas
  - `lib/agent/tool-handlers.ts` — all 7 tool handler implementations
  - `lib/agent/system-prompt.ts` — agent personality + anti-slop writing rules
  - `lib/providers/anthropic.ts` — Claude drafting wrapper + mock
  - `lib/providers/brave-search.ts` — Brave Search + DuckDuckGo fallback + mock
  - `lib/providers/google-sheets.ts` — Sheets writer + CSV serializer
  - `lib/providers/github.ts` — GitHub public API wrapper
  - `lib/providers/hn-algolia.ts` — HN Algolia API wrapper
  - `lib/providers/gmail.ts` — Gmail send + warm-up caps + suppression
  - `lib/cache.ts` — Postgres-backed `getOrSetCache()`
  - `lib/credits.ts` — credit deduction + free-tier reset
  - `lib/csv.ts` — CSV serialization
  - `lib/csv-parse.ts` — CSV ingestion
  - `lib/email-compliance.ts` — CAN-SPAM/GDPR unsubscribe rules
  - `lib/email-patterns.ts` — email pattern guesser stubs
  - `lib/reply-classify.ts` — inbound reply classification
  - `app/app/sequences/` — sequence builder pages (list, new, detail)
  - `app/app/inbox/page.tsx` — inbox scaffolded
  - `app/app/pipeline/page.tsx` — pipeline scaffolded
  - `app/app/analytics/page.tsx` — analytics scaffolded
  - `app/app/intent/page.tsx` — intent signals page
  - `app/app/settings/mailboxes/page.tsx` — mailbox connection UI
  - `app/app/settings/providers/page.tsx` — provider settings UI
  - `app/api/cron/` — 3 cron routes (detect-replies, poll-intent, send-due)
  - `app/api/mailbox/` — mailbox connect + OAuth callback
  - `app/u/[token]/page.tsx` — unsubscribe landing
  - `app/app/jobs/[id]/` — individual job detail + actions
  - `proxy.ts` — local dev proxy helper
- `5f40280` — Bug fixes and polish: updated agent tool-call cards in `chat-client.tsx`, inbox improvements, tool card rendering fixes

#### Session Block 3 — Universal Context Document (Commit 1eecaf9)
**Tool:** Claude.ai Cowork  
**Date range:** 2026-05-21

What was built:
- `1eecaf9` — `AGENTS.md` created as the universal context doc for all AI assistants

#### Session Block 4 — Switch to VS Code + CLI Tools
**Tool:** Claude CLI (Terminal), Antigravity CLI, Codex  
**Date:** 2026-05-21 (current)

- This `COORDINATION.md` file created as the master multi-agent coordination document
- `CLAUDE.md` created for Claude CLI auto-load
- `.antigravitycli/CONTEXT.md` created for Antigravity CLI

---

## 3. Current Project Status

```
Last updated: 2026-05-21
Updated by: Claude CLI
Current phase: v0.5 MVP — feature-complete, entering refinement + deferred-feature phase
Active branch: master
```

### DONE (working, committed)

| Feature | Location | Notes |
|---|---|---|
| Next.js 16 App Router scaffold | `app/` | TypeScript strict mode |
| Tailwind v4 + shadcn/ui | `components/ui/` | `@base-ui/react` |
| Supabase Auth + Google OAuth | `app/api/auth/callback/`, `middleware.ts` | Captures `drive.file` scope |
| Full DB schema (9 tables + RLS) | `supabase/migrations/0001_init.sql` | All user tables have RLS |
| `/api/chat` streaming route | `app/api/chat/route.ts` | Vercel AI SDK, Claude Sonnet 4.6, 7 tools, session persistence, mock fallback |
| 7 agent tools (definitions) | `lib/agent/tools.ts` | Zod schemas + AI SDK wrappers |
| 7 agent tool handlers | `lib/agent/tool-handlers.ts` | Concrete implementations |
| Agent system prompt | `lib/agent/system-prompt.ts` | Anti-slop writing rules |
| Brave Search + DuckDuckGo | `lib/providers/brave-search.ts` | Mock fallback when no key |
| Claude drafting wrapper | `lib/providers/anthropic.ts` | Sonnet 4.6 + Haiku 4.5, mock fallback |
| Google Sheets writer | `lib/providers/google-sheets.ts` | `drive.file` scope, mock fallback |
| GitHub public API | `lib/providers/github.ts` | For dev/maker ICP discovery |
| HN Algolia API | `lib/providers/hn-algolia.ts` | For HN-active ICP discovery |
| Gmail send provider | `lib/providers/gmail.ts` | Warm-up caps, suppression list |
| Postgres cache layer | `lib/cache.ts` | `getOrSetCache()` — key cost control |
| Credit system | `lib/credits.ts` | Free tier: 25/mo, 1 credit = 1 enriched prospect |
| Email compliance | `lib/email-compliance.ts` | CAN-SPAM + GDPR rules |
| Email pattern guesser (stubs) | `lib/email-patterns.ts` | SMTP probe logic NOT implemented |
| Reply classifier | `lib/reply-classify.ts` | interested/not-interested/OOO/etc. |
| CSV serialization + parsing | `lib/csv.ts`, `lib/csv-parse.ts` | Export + ingestion |
| Chat UI (streaming) | `app/app/chat/components/chat-client.tsx` | Tool-call cards, streaming |
| Job history | `app/app/jobs/page.tsx`, `[id]/` | Re-download links |
| Voice anchor settings | `app/app/settings/voice/page.tsx` | Paste own email to match register |
| Google Sheets export API | `app/api/export/sheets/route.ts` | Pushes job → new Sheet |
| CSV download API | `app/api/export/csv/route.ts` | RLS-scoped stream |
| Sequences (scaffolded) | `app/app/sequences/` | list, new, detail pages |
| Inbox (scaffolded) | `app/app/inbox/page.tsx` | Reply inbox UI skeleton |
| Pipeline (scaffolded) | `app/app/pipeline/page.tsx` | Kanban skeleton |
| Analytics (scaffolded) | `app/app/analytics/page.tsx` | Dashboard skeleton |
| Cron jobs (3 routes) | `app/api/cron/` | detect-replies, poll-intent, send-due |
| Mailbox management | `app/api/mailbox/`, `app/app/settings/mailboxes/` | Gmail OAuth flow |
| Provider settings | `app/app/settings/providers/page.tsx` | API key management UI |
| Unsubscribe landing | `app/u/[token]/page.tsx` | One-click unsubscribe |
| Intent page | `app/app/intent/page.tsx` | Intent signals |
| Health check | `app/api/health/route.ts` | |
| Marketing landing page | `app/(marketing)/page.tsx` | Statically renderable |
| Google login page | `app/login/page.tsx` | |

### NOT IMPLEMENTED (deferred — priority order)

| # | Feature | Location (planned) | Blocking? |
|---|---|---|---|
| 1 | **Inngest async queue** for bulk jobs >20 | `inngest/functions/` | No — sync works up to ~20 |
| 2 | **Playwright scraper microservice** | `scraper/` dir + Fly.io | No — mock fallback exists |
| 3 | **SMTP email verification** | `lib/email-patterns.ts` stubs | No — pattern guessing only |
| 4 | **Billing** | Razorpay (India) + Stripe | No — credits schema ready |
| 5 | **CSV upload UI** | tool stub exists, no UI | No |
| 6 | **Public-source search** (GitHub/ProductHunt/HN) | stub in tools | Partial — handlers return mock |
| 7 | **Real reply inbox** (full Gmail pull) | `app/app/inbox/` skeleton | No |
| 8 | **Real pipeline/kanban** | `app/app/pipeline/` skeleton | No |
| 9 | **Real analytics dashboard** | `app/app/analytics/` skeleton | No |
| 10 | **Chrome extension** | post-PMF | Post-PMF |
| 11 | **CRM push** (HubSpot/Zoho) | post-PMF | Post-PMF |
| 12 | **Multi-step email sequences** | `docs/SENDING_AGENT.md` spec | Post-PMF |

---

## 4. Full System Architecture

### Mental Model

User types a natural-language ICP description → Claude Sonnet 4.6 agent picks and chains tools → Brave Search finds candidate names → tool-handlers enrich each candidate (company research, email guess, AI-drafted cold email + talking points) → results land in Google Sheet + CSV download → optionally launch Gmail campaign.

**No paid data APIs.** Only Anthropic LLM calls (~$0.03/prospect) + Brave Search (2000 free/mo).

### Request Flow

```
Browser  →  POST /api/chat  →  Supabase Auth check
                            →  Session resolve/create
                            →  Message persist
                            →  streamText() [Vercel AI SDK]
                                  ↓
                            Claude Sonnet 4.6
                                  ↓  tool calls
                            makeTools(ctx)
                              ├── web_search → brave-search.ts → scrape_cache
                              ├── enrich_prospect → anthropic.ts → google-sheets.ts
                              ├── start_bulk_job → credits.ts → jobs table
                              ├── launch_campaign → gmail.ts
                              ├── clarify_question → inline response
                              ├── add_named_prospects → prospect_candidates table
                              └── public_source_search → github/hn-algolia.ts
                                  ↓  onFinish
                            Persist assistant message → chat_messages
                            Return UIMessageStreamResponse
```

### Data Flow (Bulk Job)

```
web_search → prospect_candidates (24h TTL)
           → user confirms in chat
           → start_bulk_job → jobs row (pending)
                            → enrich each candidate:
                              ├── brave-search (company info)
                              ├── email-patterns (guess email)
                              ├── anthropic (draft email + talking points)
                              └── prospects row (per person)
                            → jobs row (completed)
                            → google-sheets.ts → new Sheet
                            → CSV available at /api/export/csv?jobId=
```

### Cost Profile

| Scale | Monthly cost |
|---|---|
| 50 users × 100 prospects/mo | ~$150 Anthropic + ~$5 Fly.io |
| Per enriched prospect | ~$0.03 |
| Free tier (25 prospects/mo) | ~$0.75 per free user |

---

## 5. File Map (Complete)

```
Root/
├── COORDINATION.md              ← YOU ARE HERE. Master context for all agents.
├── AGENTS.md                    ← Universal context (legacy, still valid, references this file)
├── CLAUDE.md                    ← Auto-loaded by Claude CLI. Summarizes + references this file.
├── plan.md                      ← Phase tracker (update alongside commits)
├── README.md                    ← Public README
├── proxy.ts                     ← Local dev proxy helper
│
├── app/
│   ├── layout.tsx               ← Root layout (fonts, metadata)
│   ├── not-found.tsx            ← 404 page
│   ├── (marketing)/             ← Public pages (statically renderable, no auth)
│   │   ├── layout.tsx
│   │   └── page.tsx             ← Landing page
│   ├── login/page.tsx           ← Google OAuth sign-in
│   ├── u/[token]/page.tsx       ← Unsubscribe landing
│   ├── app/                     ← Authenticated dashboard (/app/* guarded by middleware)
│   │   ├── layout.tsx           ← Dashboard shell
│   │   ├── page.tsx             ← Dashboard home redirect
│   │   ├── actions.ts           ← Server actions
│   │   ├── components/
│   │   │   └── app-shell.tsx    ← Sidebar + top nav shell
│   │   ├── chat/
│   │   │   ├── page.tsx         ← New chat entry
│   │   │   ├── [sessionId]/page.tsx  ← Resume past chat
│   │   │   └── components/
│   │   │       └── chat-client.tsx   ← ⭐ Main chat UI (streaming + tool cards)
│   │   ├── jobs/
│   │   │   ├── page.tsx         ← Job history list
│   │   │   └── [id]/
│   │   │       ├── page.tsx     ← Job detail
│   │   │       └── components/actions.tsx
│   │   ├── sequences/
│   │   │   ├── page.tsx         ← Sequence list (scaffolded)
│   │   │   ├── new/page.tsx     ← Create sequence (scaffolded)
│   │   │   └── [id]/page.tsx    ← Sequence detail (scaffolded)
│   │   ├── inbox/page.tsx       ← Reply inbox (scaffolded)
│   │   ├── pipeline/page.tsx    ← Kanban pipeline (scaffolded)
│   │   ├── analytics/page.tsx   ← Analytics dashboard (scaffolded)
│   │   ├── intent/page.tsx      ← Intent signals (scaffolded)
│   │   └── settings/
│   │       ├── voice/page.tsx   ← Voice anchor settings (working)
│   │       ├── mailboxes/page.tsx  ← Gmail mailbox connect (working)
│   │       └── providers/page.tsx  ← Provider API key settings
│   └── api/
│       ├── chat/route.ts        ← ⭐ Core AI agent. POST only. Streaming.
│       ├── auth/callback/route.ts  ← Google OAuth exchange + users upsert
│       ├── export/
│       │   ├── csv/route.ts     ← RLS-scoped CSV stream (GET)
│       │   └── sheets/route.ts  ← Push job → Google Sheet (POST)
│       ├── cron/
│       │   ├── detect-replies/route.ts
│       │   ├── poll-intent/route.ts
│       │   └── send-due/route.ts
│       ├── mailbox/
│       │   ├── connect/route.ts
│       │   └── callback/route.ts
│       └── health/route.ts
│
├── lib/
│   ├── agent/
│   │   ├── tools.ts             ← ⭐ 7 tool definitions (Zod schemas + tool() wrappers ONLY)
│   │   ├── tool-handlers.ts     ← ⭐ All tool business logic (testable independently)
│   │   └── system-prompt.ts     ← Agent personality + anti-slop writing rules
│   ├── providers/
│   │   ├── anthropic.ts         ← Claude Sonnet 4.6 / Haiku 4.5 + mock
│   │   ├── brave-search.ts      ← Brave Search + DuckDuckGo fallback + mock
│   │   ├── google-sheets.ts     ← Sheets writer + CSV serializer + mock
│   │   ├── gmail.ts             ← Gmail send + warm-up + suppression
│   │   ├── github.ts            ← GitHub public API
│   │   └── hn-algolia.ts        ← HN Algolia API
│   ├── supabase/
│   │   ├── client.ts            ← Browser-side client (use client only)
│   │   └── server.ts            ← SSR client + admin client (server/API routes only)
│   ├── cache.ts                 ← getOrSetCache() — Postgres-backed, ALL external calls
│   ├── credits.ts               ← Credit deduction + free-tier monthly reset
│   ├── csv.ts                   ← CSV export serialization
│   ├── csv-parse.ts             ← CSV ingestion
│   ├── email-compliance.ts      ← CAN-SPAM / GDPR / unsubscribe rules
│   ├── email-patterns.ts        ← Email pattern guesser + SMTP probe (STUBS only)
│   ├── reply-classify.ts        ← Classify inbound replies
│   └── utils.ts                 ← cn(), hasKey(), hashIndex(), sleep()
│
├── components/ui/               ← shadcn/ui component library
├── hooks/                       ← React hooks
├── supabase/migrations/
│   └── 0001_init.sql            ← Full DB schema (idempotent, safe to re-run)
├── tests/                       ← Node built-in test runner (*.test.ts)
├── docs/
│   ├── PRD.md                   ← Full product spec
│   ├── ARCHITECTURE.md          ← Detailed technical architecture
│   ├── ARCHITECTURE_V1.md       ← v0.4 reference (do not modify)
│   └── SENDING_AGENT.md         ← v2 Gmail sending agent spec (deferred)
├── public/                      ← Static assets
│
├── .antigravitycli/
│   └── CONTEXT.md               ← Antigravity CLI context (references this file)
├── .env.example
├── .env.local.example           ← Copy to .env.local, fill keys
├── next.config.ts
├── tsconfig.json
├── package.json
└── middleware.ts                 ← Supabase Auth session refresh + /app/* guard
```

---

## 6. Database Schema

Applied via `supabase/migrations/0001_init.sql` (idempotent).

| Table | Purpose | RLS |
|---|---|---|
| `users` | App profile — plan, credits, Google refresh token, voice_anchor_text | user owns row |
| `chat_sessions` | One per conversation thread | user owns rows |
| `chat_messages` | Full message history (role: user/assistant/tool/system; content: jsonb) | via session |
| `prospect_candidates` | Short-lived discovery results (24h TTL) surfaced by agent | user owns rows |
| `jobs` | Committed enrichment runs (pending→processing→completed/failed) | user owns rows |
| `prospects` | One row per enriched person in a job | via job |
| `scrape_cache` | Key-value cache for all external API calls (TTL controlled per entry) | none (shared) |
| `credit_transactions` | Append-only credit ledger | user owns rows |
| `webhook_events` | Idempotency table for Stripe/Razorpay/Gmail push webhooks | service-role only |

**Admin client rule:** `supabaseAdmin` (service-role key) bypasses RLS. Only use it in API routes and server-side background jobs. **Never expose the service-role key to the browser.**

---

## 7. Environment Variables

```env
# Required for real operation (deterministic mock fallbacks exist for all provider keys)
ANTHROPIC_API_KEY=          # Claude Sonnet 4.6 + Haiku 4.5
BRAVE_SEARCH_KEY=           # Brave Search (2000 free queries/mo)

# Required for Google OAuth + Sheets export
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Required for persistence + auth (NO mock exists — must set for any login)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=  # SERVER-ONLY. NEVER expose to browser.
```

Full template in `.env.local.example`. Copy → `.env.local`, fill in keys.  
Mock mode: leave provider keys blank. Only Supabase keys are required for auth to work.

---

## 8. The 7 Agent Tools

All defined in `lib/agent/tools.ts`, implemented in `lib/agent/tool-handlers.ts`.

| Tool | Trigger | Key constraint |
|---|---|---|
| `web_search` | "find me X" style requests | Always surface 3–5 sample candidates BEFORE recommending bulk |
| `public_source_search` | Dev/maker/indie-hacker ICPs | Sources: github, producthunt, hn_algolia |
| `enrich_prospect` | "research [Name] at [Company]" | Single person, streams inline, ~15s with real keys |
| `clarify_question` | ICP too vague to search | Use sparingly — only when genuinely unclear |
| `add_named_prospects` | User provides explicit names | No web search; stages user-provided list |
| `start_bulk_job` | After user confirms candidate list | **Only after explicit confirmation** |
| `launch_campaign` | "send the emails" | **HIGHEST STAKES. Never without explicit "yes, send real emails"** |

---

## 9. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router, RSC, Server Actions) | 16 |
| Language | TypeScript (strict mode) | 5 |
| UI | Tailwind v4 + shadcn/ui (`@base-ui/react`) | v4 |
| Database | Supabase Postgres | latest |
| Auth | Supabase Auth — Google OAuth | — |
| AI SDK | Vercel AI SDK | v6 (`ai`) |
| AI Model | Anthropic Claude Sonnet 4.6 (drafting) + Haiku 4.5 (summaries) | — |
| Discovery | Brave Search API + DuckDuckGo fallback | — |
| Export | Google Sheets API (`googleapis` v171) + CSV | — |
| Testing | Node.js built-in test runner (`--experimental-strip-types`) | — |
| Hosting | Vercel | — |

---

## 10. Coding Conventions (Non-Negotiable)

1. **Server-first RSC**: Default to React Server Components. Add `"use client"` only for hooks (`useState`, `useChat`) or browser APIs.
2. **DB access**: UI reads via RLS-scoped Supabase client in Server Components. Background/admin writes via `supabaseAdmin` (service-role key). Never expose service-role key to browser.
3. **Cache everything external**: Use `getOrSetCache()` from `lib/cache.ts` for ALL scraping and search API calls. Primary cost-control lever.
4. **Types**: Use Zod schemas for parsing. Derive types with `z.infer<typeof schema>`. No `any` types.
5. **Conditional classes**: Use `cn()` from `lib/utils.ts`. No inline style attributes.
6. **Tool context**: `userId` and `sessionId` are injected server-side in `makeTools(ctx)`. Never trust the model to provide them.
7. **Mock fallbacks**: Every external provider must have a deterministic mock that works without API keys. Real outputs get a `demo data` badge.
8. **Commit style**: Lowercase, descriptive. Multi-line for context. e.g. `add /api/chat streaming route using vercel ai sdk + claude sonnet`
9. **Module boundaries**: Respect the ownership map in Section 5 — no cross-boundary imports.
10. **No comments by default**: Only add a comment when the WHY is non-obvious (hidden constraint, subtle invariant, workaround for a specific bug). Never explain WHAT the code does.

---

## 11. Module Ownership Boundaries

| Zone | Owner | Rule |
|---|---|---|
| `app/(marketing)/*` | Any agent | Must be statically renderable. No auth, no DB calls. |
| `app/app/*` | Any agent | All authenticated routes. Middleware guards `/app/*`. |
| `app/api/chat/route.ts` | Agent brain — treat as read-only unless fixing a bug | Streaming only. No DB writes except via handlers. |
| `lib/agent/tools.ts` | Any agent | Zod schemas + `tool()` wrappers ONLY. No business logic. |
| `lib/agent/tool-handlers.ts` | Any agent | All tool business logic. Must be testable independently. |
| `lib/providers/*` | Any agent | Thin external service wrappers. No business logic. |
| `lib/supabase/server.ts` | Read-only for context | SSR + admin clients. Import in Server Components and API routes only. |
| `lib/supabase/client.ts` | Read-only for context | Browser client. Import in `"use client"` components only. |

---

## 12. Agent Coordination Protocol

### Which Agent Does What

| Agent | Primary Responsibility | Avoid |
|---|---|---|
| **Claude CLI** (this session) | Architecture decisions, complex multi-file features, bug fixes requiring deep context, updating COORDINATION.md | Don't duplicate work Antigravity/Codex is doing |
| **Antigravity CLI** | UI component work, styling, scaffolded page implementations, fast iteration | Don't touch `lib/agent/` or `app/api/chat/` without coordination |
| **Codex (OpenAI)** | Boilerplate generation, test writing, repetitive pattern implementations | Don't make architectural decisions without recording in Action Log |

### Rules All Agents Must Follow

1. **Read COORDINATION.md first.** Every session. No exceptions.
2. **Check Section 3 (Current Status)** before starting any work — another agent may have already done it.
3. **Update the Action Log (Section 13)** after every significant action.
4. **Update Section 3** when a "NOT IMPLEMENTED" item ships.
5. **Update `plan.md`** alongside every commit.
6. **Never commit without updating the action log here.**
7. **If unsure about design**: check `docs/PRD.md` → `docs/ARCHITECTURE.md` → Section 9 Key Decisions. Then ask Aryan.
8. **If another agent's work conflicts with yours**: stop, record the conflict in Section 13, surface to Aryan.
9. **Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser-side code.**
10. **Always preserve mock fallbacks** — every external provider call must work without API keys.

### Handoff Protocol

When finishing a work block:
1. Commit with a descriptive message
2. Update Section 3 (Current Status) in this file
3. Add an entry to Section 13 (Action Log)
4. Note any blockers or open questions for the next agent

---

## 13. Action Log

> **All agents:** Append entries here. Never delete entries. Format: `[DATE] [AGENT] [ACTION] — [DETAIL]`

---

### 2026-05-09 | Claude.ai Cowork | INIT
- Project scaffolded: Next.js 16 + TypeScript
- `plan.md` created as initial coordination tracker

### 2026-05-12 | Claude.ai Cowork | FOUNDATION
- Tailwind v4 + shadcn/ui integrated
- AI SDK, Zod, googleapis installed
- Supabase Auth middleware + OAuth callback built
- Full DB schema (`0001_init.sql`) with 9 tables and RLS written
- `lib/supabase/{server,client}.ts` created

### 2026-05-16 | Claude.ai Cowork | DOCS
- `docs/ARCHITECTURE.md` written (v0.5 full architecture)
- `docs/PRD.md` written (full product spec)
- `docs/SENDING_AGENT.md` written (v2 email-send spec, deferred)

### 2026-05-20 | Claude.ai Cowork | FEATURE BATCH
- `/api/chat` streaming route built (Claude Sonnet 4.6, 7 tools, session persistence, mock fallback)
- All 7 agent tools defined + implemented (web_search, enrich_prospect, clarify_question, start_bulk_job, launch_campaign, add_named_prospects, public_source_search)
- All providers built: Anthropic, Brave Search, Google Sheets, Gmail, GitHub, HN Algolia
- Credit system, email compliance, reply classifier, CSV utils built
- Sequences, Inbox, Pipeline, Analytics pages scaffolded
- Cron routes built (detect-replies, poll-intent, send-due)
- Mailbox management UI + API built

### 2026-05-20 | Claude.ai Cowork | POLISH
- Chat tool-call cards updated (chat-client.tsx)
- Inbox component improvements
- Agent tool card rendering fixes

### 2026-05-21 | Claude.ai Cowork | CONTEXT DOC
- `AGENTS.md` created as universal AI context document

### 2026-05-21 | Claude CLI | COORDINATION SETUP
- `COORDINATION.md` created (this file) — master multi-agent coordination document
- `CLAUDE.md` created — Claude CLI auto-load file
- `.antigravitycli/CONTEXT.md` created — Antigravity CLI context
- Memory system initialized at `~/.claude/projects/.../memory/`
- **Next priority:** Review scaffolded pages (inbox, pipeline, analytics, sequences) and implement real functionality per PRD; then Inngest async queue

---

## 14. Next Actions Queue (Priority Order)

Update this section as tasks complete. Agents pull from the top.

### Immediate (v0.5 → v0.6)

- [ ] **[ANY AGENT] Implement real Inbox page** — pull Gmail replies via `app/api/cron/detect-replies/`, display threaded in `app/app/inbox/page.tsx`. Spec in `docs/SENDING_AGENT.md`.
- [ ] **[ANY AGENT] Implement real Pipeline page** — Kanban board showing prospects by stage (contacted/replied/interested/converted). Data from `prospects` table, `stage` column.
- [ ] **[ANY AGENT] Implement real Analytics page** — charts for: emails sent per day, reply rate, interested rate, credit usage. Data from `jobs` + `prospects` + `credit_transactions`.
- [ ] **[ANY AGENT] Implement Sequences page** — multi-step email sequence builder. Spec in `docs/SENDING_AGENT.md`.
- [ ] **[ANY AGENT] CSV upload UI** — drag-drop file upload in chat that calls the `add_named_prospects` tool. UI in `app/app/chat/components/`.

### Next Sprint (v0.6 → v0.7)

- [ ] **[CLAUDE CLI] Inngest async queue** — replace synchronous bulk enrichment with Inngest fan-out for jobs >20 prospects. `inngest/functions/enrich-prospect.ts`
- [ ] **[CLAUDE CLI] SMTP email verification** — implement the stubs in `lib/email-patterns.ts`. DNS MX lookup + SMTP probe. ~70% accuracy.
- [ ] **[CLAUDE CLI] Playwright scraper microservice** — `scraper/` directory as a separate Fastify/Node.js service, deployable to Fly.io. HTTP API that Next.js calls.

### Post-PMF (do not build yet)

- [ ] Billing: Razorpay (India) + Stripe (international). Schema hook in `webhook_events` is ready.
- [ ] Chrome extension
- [ ] CRM push: HubSpot + Zoho
- [ ] Multi-step sequences (full v2 send agent)

---

## 15. Key Design Decisions

| Decision | Rationale | Reference |
|---|---|---|
| Chat-first UI | Lower friction; differentiates from Apollo | PRD §2 |
| No paid data APIs | Zero licensing cost; Brave = 2000 free/mo | ARCHITECTURE §2 |
| Google Sheets as primary output | Indian/SEA SMBs live in Sheets | PRD §4 |
| Mock fallbacks for every provider | Full demo without API keys | ARCHITECTURE §0 |
| Synchronous bulk jobs (no Inngest yet) | Fine up to ~20 prospects; defer async complexity | AGENTS.md §9 |
| RLS on every user table | Multi-tenant safety without app-layer bugs | DB schema |
| `voice_anchor_text` in users | User pastes own email → AI matches register | PRD §6 |
| Credits system | Metered billing hook; free = 25/mo | credits.ts |
| Vercel AI SDK v6 | SSE streaming + tool-call rendering + useChat hook | ARCHITECTURE §2 |
| `stopWhen: stepCountIs(5)` | Prevents runaway tool-call chains | chat/route.ts:137 |

---

## 16. Running the Project

```bash
# Install
npm install

# Environment setup
cp .env.local.example .env.local
# Edit .env.local — leave provider keys blank for mock mode
# Only SUPABASE keys are needed for auth to work

# Dev server
npm run dev
# → http://localhost:3000

# Tests
npm test

# Lint
npm run lint

# Apply DB schema (first time only)
supabase db push
# or: psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
```

**Mock mode:** Full product demos without Anthropic/Brave/Google keys. Only Supabase required for login. Real outputs tagged with `demo data` badge.
