# COORDINATION.md — Master Agent Context File
# LeadGenAI | Absolute Single Source of Truth

---

## ⛔ HARD STOP — READ BEFORE ANYTHING ELSE

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  IF YOU ARE AN AI AGENT (Claude CLI, Antigravity CLI, Codex, or any other): ║
║                                                                              ║
║  YOU ARE NOT PERMITTED TO:                                                   ║
║    • Write, edit, or delete any file                                         ║
║    • Run any command                                                          ║
║    • Make any decision                                                        ║
║    • Generate any plan                                                        ║
║                                                                              ║
║  UNTIL YOU HAVE:                                                             ║
║    1. Read this entire file top to bottom                                    ║
║    2. Read Section 0 — checked who else is working and on what               ║
║    3. Claimed your task in Section 0 (LIVE AGENT STATUS)                     ║
║    4. Confirmed no file you need is claimed by another agent                 ║
║                                                                              ║
║  ALL ACTIONS — every file edit, every command, every decision —              ║
║  MUST be recorded in Section 13 (Action Log) BEFORE moving on.              ║
║                                                                              ║
║  THIS FILE IS LAW. docs/PRD.md and docs/ARCHITECTURE.md are reference.      ║
║  Any conflict between this file and any other file: THIS FILE WINS.         ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## Section 0 — LIVE AGENT STATUS (Simultaneous Coordination)

> **This section is the real-time coordination layer.**
> All agents read it before starting. All agents write to it when claiming or finishing work.
> It is the only mechanism preventing two agents from overwriting each other.

### 0.1 — Who Is Active Right Now

Update this table when you START and when you FINISH. Format: `[AGENT] | [STATUS] | [TASK] | [FILES TOUCHED] | [STARTED]`

| Agent | Status | Current Task | Files Being Touched | Started |
|---|---|---|---|---|
| Claude CLI | ✅ Active | Chief agent (sole owner per user directive) — resuming 2026-05-22, assessing next priorities after billing shipped | — | 2026-05-22 |
| Antigravity CLI | 💤 Idle | — (Claude took over full ownership per user) | — | 2026-05-22 |
| Codex | 💤 Idle | — | — | 2026-05-21 |

> **Status codes:** `✅ Active` / `💤 Idle` / `🔒 File Lock` / `⏸ Blocked` / `✔ Done (update log then clear)`

### 0.2 — File Claim Registry (Active Locks)

Before editing any file, add it here. Remove it when your commit is done.
**If a file you need is already listed here, STOP — wait or coordinate before touching it.**

| File | Claimed By | Reason | Claimed At |
|---|---|---|---|
| _(none — all claims cleared; billing shipped, build green)_ | | | |

### 0.3 — Simultaneous Work Protocol

Three agents CAN work at the same time if they follow these rules:

**Rule 1 — Claim before touch.**
Before editing any file, write it into the File Claim Registry (0.2). If it's already there, you may NOT edit it until the other agent removes their claim.

**Rule 2 — Natural file partitioning.**
Default split to avoid conflicts without coordination:
- `Claude CLI` → `lib/agent/`, `app/api/`, `lib/providers/`, `lib/`, DB schema, COORDINATION.md
- `Antigravity CLI` → `app/app/` (UI pages), `components/`, `hooks/`, styling
- `Codex` → `tests/`, boilerplate files, `plan.md` updates, repetitive patterns

**Rule 3 — COORDINATION.md is a shared file. Handle carefully.**
When multiple agents need to update this file simultaneously:
- Each agent appends ONLY to Section 0 (their status row) and Section 13 (their log entry)
- Never rewrite sections another agent is actively using
- Append-only to Section 13. Never edit another agent's log entry.

**Rule 4 — Commit before crossing boundaries.**
Commit your work before touching a file outside your natural partition. This creates a clean checkpoint and reduces merge complexity.

**Rule 5 — Signal blockers immediately.**
If your task is blocked by another agent's in-progress work, update your status to `⏸ Blocked`, describe why in Section 13, and stop — do not work around it.

**Rule 6 — Clear your claims after commit.**
After every commit, remove your file claims from 0.2 and set your status to `💤 Idle` (or start the next task immediately and update accordingly).

---

## Section 1 — Project Identity

| Field | Value |
|---|---|
| **Product name** | LeadGenAI |
| **Tagline** | AI-powered prospecting copilot for B2B sales teams in India and Southeast Asia |
| **Version** | v0.5 MVP — Feature-complete; refinement & integration mode |
| **Owner** | Aryan Singh (arajsingh0505@gmail.com) |
| **Repo** | `its-aryansingh/AI-Agentic-Lead-Generator` |
| **Branch** | `master` (active dev), `main` (stable base) |
| **Primary docs** | `docs/PRD.md`, `docs/ARCHITECTURE.md`, `plan.md`, `AGENTS.md` |

**One-line description:** User describes ideal customer in plain English → LeadGenAI finds matching prospects → drafts personalized first-touch email per prospect → exports to Google Sheets or CSV.

---

## Section 2 — Claude.ai (Cowork) — Full Session History

Permanent record. Never delete. This is how the project reached its current state.

### Session Block 1 — Project Foundation (Commits 0198155 → 8bf26b7)
**Tool:** Claude.ai Cowork | **Dates:** ~2026-05-09 to 2026-05-12

- `0198155` — Next.js 16 (App Router) + TypeScript scaffold
- `53d3aba` — `plan.md` created as multi-agent tracker
- `3d91e66` — Tailwind v4 + shadcn/ui (`@base-ui/react`); `components.json` configured
- `e18f5c7` — Vercel AI SDK v6, Zod, `googleapis` v171, `@ai-sdk/anthropic` installed; `.env.local.example`
- `28d7027` — Supabase Auth middleware, OAuth callback route, RLS insert policies for `public.users`
- `8bf26b7` — `lib/supabase/server.ts`, `lib/supabase/client.ts`, `supabase/migrations/0001_init.sql` (full 9-table DB schema)

### Session Block 2 — Architecture Docs + Full Feature Build (Commits ae5619b → 5f40280)
**Tool:** Claude.ai Cowork | **Dates:** ~2026-05-16 to 2026-05-20

- `ae5619b` — `docs/ARCHITECTURE.md`, `docs/PRD.md`, `docs/SENDING_AGENT.md`, `docs/ARCHITECTURE_V1.md`; shadcn finalized
- `62f9e75` — **Massive feature commit:**
  - `app/api/chat/route.ts` — streaming chat (Vercel AI SDK + Claude Sonnet 4.6, session persistence, mock fallback)
  - `lib/agent/tools.ts` — 7 tool Zod schemas + AI SDK wrappers
  - `lib/agent/tool-handlers.ts` — all 7 tool implementations
  - `lib/agent/system-prompt.ts` — anti-slop agent personality
  - `lib/providers/anthropic.ts` — Claude drafting + mock
  - `lib/providers/brave-search.ts` — Brave + DuckDuckGo + mock
  - `lib/providers/google-sheets.ts` — Sheets writer + CSV + mock
  - `lib/providers/gmail.ts` — Gmail send + warm-up caps + suppression
  - `lib/providers/github.ts` — GitHub public API wrapper
  - `lib/providers/hn-algolia.ts` — HN Algolia wrapper
  - `lib/cache.ts` — Postgres-backed `getOrSetCache()`
  - `lib/credits.ts` — credit deduction + monthly free-tier reset
  - `lib/csv.ts`, `lib/csv-parse.ts` — CSV export + ingestion
  - `lib/email-compliance.ts` — CAN-SPAM / GDPR rules
  - `lib/email-patterns.ts` — email pattern guesser (STUBS)
  - `lib/reply-classify.ts` — inbound reply classifier
  - `app/app/sequences/` — sequence list, new, detail (scaffolded)
  - `app/app/inbox/page.tsx` — inbox (scaffolded)
  - `app/app/pipeline/page.tsx` — pipeline (scaffolded)
  - `app/app/analytics/page.tsx` — analytics (scaffolded)
  - `app/app/intent/page.tsx` — intent signals
  - `app/app/settings/mailboxes/page.tsx` — mailbox connect UI
  - `app/app/settings/providers/page.tsx` — provider settings
  - `app/api/cron/` — detect-replies, poll-intent, send-due cron routes
  - `app/api/mailbox/` — Gmail OAuth connect + callback
  - `app/u/[token]/page.tsx` — unsubscribe landing
  - `app/app/jobs/[id]/` — job detail + actions
  - `proxy.ts` — local dev proxy
- `5f40280` — Bug fixes: chat tool-call cards, inbox component, tool card rendering

### Session Block 3 — Universal Context Doc (Commit 1eecaf9)
**Tool:** Claude.ai Cowork | **Date:** 2026-05-21

- `1eecaf9` — `AGENTS.md` created as universal AI context document

### Session Block 4 — Switch to VS Code + CLI Tools (Commit 75ae3cf)
**Tool:** Claude CLI | **Date:** 2026-05-21

- `75ae3cf` — `COORDINATION.md` v1 created, `CLAUDE.md`, `.antigravitycli/CONTEXT.md`, `AGENTS.md` updated, `plan.md` rewritten

### Session Block 5 — Enforcement + Simultaneous Coordination (current)
**Tool:** Claude CLI | **Date:** 2026-05-21

- `COORDINATION.md` v2 — hard enforcement block, Section 0 live agent status + file claims, simultaneous work protocol, mandatory pre-work checklist
- `CLAUDE.md`, `.antigravitycli/CONTEXT.md` hardened with mandatory checklist and no-proceed gates
- `AGENTS.md` updated with mandatory checklist for Codex

---

## Section 3 — Current Project Status

```
Last updated: 2026-05-21
Updated by: Claude CLI
Phase: v0.5 complete → v0.6 (real implementations of scaffolded pages)
```

### DONE ✅ (working, committed)

| Feature | Location | Notes |
|---|---|---|
| Next.js 16 App Router scaffold | `app/` | TypeScript strict |
| Tailwind v4 + shadcn/ui | `components/ui/` | `@base-ui/react` |
| Supabase Auth + Google OAuth | `middleware.ts`, `app/api/auth/callback/` | `drive.file` scope captured upfront |
| Full DB schema (9 tables + RLS) | `supabase/migrations/0001_init.sql` | Idempotent, safe to re-run |
| `/api/chat` streaming route | `app/api/chat/route.ts` | AI SDK, Claude Sonnet 4.6, 7 tools, mock fallback |
| 7 agent tool definitions | `lib/agent/tools.ts` | Zod schemas only |
| 7 agent tool handlers | `lib/agent/tool-handlers.ts` | Full implementations |
| Agent system prompt | `lib/agent/system-prompt.ts` | Anti-slop rules |
| Brave Search + DuckDuckGo | `lib/providers/brave-search.ts` | Mock when no key |
| Claude drafting | `lib/providers/anthropic.ts` | Sonnet 4.6 + Haiku 4.5, mock |
| Google Sheets writer | `lib/providers/google-sheets.ts` | `drive.file` scope, mock |
| GitHub API wrapper | `lib/providers/github.ts` | Dev/maker ICP discovery |
| HN Algolia wrapper | `lib/providers/hn-algolia.ts` | |
| Gmail send provider | `lib/providers/gmail.ts` | Warm-up caps, suppression |
| Postgres cache | `lib/cache.ts` | `getOrSetCache()` — primary cost lever |
| Credit system | `lib/credits.ts` | Free: 25/mo, 1 credit = 1 prospect |
| Email compliance | `lib/email-compliance.ts` | CAN-SPAM + GDPR |
| Email pattern guesser (stubs) | `lib/email-patterns.ts` | SMTP probe NOT implemented |
| Reply classifier | `lib/reply-classify.ts` | interested/not/OOO/etc. |
| CSV export + parse | `lib/csv.ts`, `lib/csv-parse.ts` | |
| Chat UI (streaming) | `app/app/chat/components/chat-client.tsx` | Tool-call cards |
| Job history + detail | `app/app/jobs/` | Re-download links |
| Voice anchor settings | `app/app/settings/voice/page.tsx` | |
| Google Sheets export API | `app/api/export/sheets/route.ts` | |
| CSV download API | `app/api/export/csv/route.ts` | RLS-scoped |
| Mailbox management | `app/api/mailbox/`, `app/app/settings/mailboxes/` | Gmail OAuth |
| Provider settings | `app/app/settings/providers/page.tsx` | |
| Cron routes (3) | `app/api/cron/` | detect-replies, poll-intent, send-due |
| Sequences (scaffolded) | `app/app/sequences/` | No real logic |
| Inbox (scaffolded) | `app/app/inbox/page.tsx` | No real logic |
| Pipeline (scaffolded) | `app/app/pipeline/page.tsx` | No real logic |
| Analytics (scaffolded) | `app/app/analytics/page.tsx` | No real logic |
| Unsubscribe landing | `app/u/[token]/page.tsx` | |
| Intent page | `app/app/intent/page.tsx` | |
| Marketing landing page | `app/(marketing)/page.tsx` | Static |
| Login page | `app/login/page.tsx` | |

### NOT IMPLEMENTED ❌ (priority order)

| # | Feature | Planned Location | Notes |
|---|---|---|---|
| 1 | **Real Inbox** | `app/app/inbox/page.tsx` | Pull Gmail replies via cron, display threaded |
| 2 | **Real Pipeline/Kanban** | `app/app/pipeline/page.tsx` | Prospect stages from `prospects.stage` |
| 3 | **Real Analytics** | `app/app/analytics/page.tsx` | Charts: emails/replies/credits |
| 4 | **Real Sequences** | `app/app/sequences/` | Multi-step email builder |
| 5 | **CSV upload UI** | `app/app/chat/components/` | Drag-drop → `add_named_prospects` |
| 6 | **Inngest async queue** | `inngest/functions/` | Bulk jobs >20 |
| 7 | **Playwright scraper** | `scraper/` + Fly.io | HTTP API, separate service |
| 8 | **SMTP verification** | `lib/email-patterns.ts` | DNS MX + SMTP probe |
| 9 | **Billing** | Razorpay + Stripe | Schema hook ready in `webhook_events` |
| 10 | **Chrome extension** | post-PMF | — |
| 11 | **CRM push** | post-PMF | HubSpot + Zoho |

---

## Section 4 — System Architecture

### Request Flow

```
Browser → POST /api/chat → Supabase Auth check
                         → Session resolve/create
                         → User message persist
                         → streamText() [Vercel AI SDK]
                               ↓
                         Claude Sonnet 4.6
                               ↓ tool calls
                         makeTools(ctx)
                           ├── web_search       → brave-search.ts → scrape_cache
                           ├── enrich_prospect  → anthropic.ts + brave-search.ts
                           ├── start_bulk_job   → credits.ts → jobs table → prospects
                           ├── launch_campaign  → gmail.ts
                           ├── clarify_question → inline response
                           ├── add_named_prospects → prospect_candidates table
                           └── public_source_search → github/hn-algolia.ts
                               ↓ onFinish
                         Persist assistant message → chat_messages
                         Return UIMessageStreamResponse
```

### Cost Profile

| Metric | Value |
|---|---|
| Per enriched prospect | ~$0.03 (Anthropic only) |
| Free tier (25/mo) | ~$0.75 per free user |
| 50 users × 100 prospects/mo | ~$150 Anthropic + ~$5 Fly.io |

---

## Section 5 — Complete File Map

```
Root/
├── COORDINATION.md              ← MASTER CONTEXT. Read first. Update always.
├── AGENTS.md                    ← Codex entry point → references this file
├── CLAUDE.md                    ← Claude CLI auto-load → references this file
├── .antigravitycli/CONTEXT.md  ← Antigravity entry point → references this file
├── plan.md                      ← Phase tracker (commit-alongside updates)
├── README.md                    ← Public README
├── proxy.ts                     ← Local dev proxy helper
│
├── app/
│   ├── layout.tsx
│   ├── not-found.tsx
│   ├── (marketing)/             ← PUBLIC. Statically renderable. No auth. No DB.
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── login/page.tsx           ← Google OAuth sign-in
│   ├── u/[token]/page.tsx       ← Unsubscribe landing
│   └── app/                     ← AUTHENTICATED (/app/* guarded by middleware.ts)
│       ├── layout.tsx
│       ├── page.tsx
│       ├── actions.ts
│       ├── components/app-shell.tsx    ← Sidebar + nav
│       ├── chat/
│       │   ├── page.tsx
│       │   ├── [sessionId]/page.tsx
│       │   └── components/chat-client.tsx   ← ⭐ Main chat UI + tool cards
│       ├── jobs/
│       │   ├── page.tsx
│       │   └── [id]/{page.tsx, components/actions.tsx}
│       ├── sequences/           ← SCAFFOLDED — needs real implementation
│       │   ├── page.tsx
│       │   ├── new/page.tsx
│       │   └── [id]/page.tsx
│       ├── inbox/page.tsx       ← SCAFFOLDED — needs real implementation
│       ├── pipeline/page.tsx    ← SCAFFOLDED — needs real implementation
│       ├── analytics/page.tsx   ← SCAFFOLDED — needs real implementation
│       ├── intent/page.tsx
│       └── settings/
│           ├── voice/page.tsx
│           ├── mailboxes/page.tsx
│           └── providers/page.tsx
│
├── app/api/
│   ├── chat/route.ts            ← ⭐ Core AI agent brain. Streaming only.
│   ├── auth/callback/route.ts   ← OAuth exchange
│   ├── export/{csv,sheets}/route.ts
│   ├── cron/{detect-replies,poll-intent,send-due}/route.ts
│   ├── mailbox/{connect,callback}/route.ts
│   └── health/route.ts
│
├── lib/
│   ├── agent/
│   │   ├── tools.ts             ← ⭐ Zod schemas + tool() wrappers ONLY
│   │   ├── tool-handlers.ts     ← ⭐ All tool business logic
│   │   └── system-prompt.ts
│   ├── providers/
│   │   ├── anthropic.ts         ← Claude Sonnet 4.6 / Haiku 4.5 + mock
│   │   ├── brave-search.ts      ← Brave + DuckDuckGo + mock
│   │   ├── google-sheets.ts     ← Sheets + CSV + mock
│   │   ├── gmail.ts             ← Gmail send + warm-up + suppression
│   │   ├── github.ts
│   │   └── hn-algolia.ts
│   ├── supabase/
│   │   ├── client.ts            ← Browser only ("use client" components)
│   │   └── server.ts            ← Server Components + API routes only
│   ├── cache.ts                 ← getOrSetCache() — wrap ALL external calls
│   ├── credits.ts
│   ├── csv.ts / csv-parse.ts
│   ├── email-compliance.ts
│   ├── email-patterns.ts        ← STUBS only
│   ├── reply-classify.ts
│   └── utils.ts                 ← cn(), hasKey(), hashIndex(), sleep()
│
├── components/ui/               ← shadcn/ui components
├── hooks/
├── supabase/migrations/0001_init.sql   ← Full DB schema (idempotent)
├── tests/                       ← Node built-in test runner
├── docs/
│   ├── PRD.md                   ← Product spec (reference only)
│   ├── ARCHITECTURE.md          ← Technical architecture (reference only)
│   ├── ARCHITECTURE_V1.md       ← v0.4 reference (do not modify)
│   └── SENDING_AGENT.md         ← v2 Gmail send spec (deferred)
└── middleware.ts                 ← Auth session refresh + /app/* guard
```

---

## Section 6 — Database Schema

File: `supabase/migrations/0001_init.sql` (idempotent).

| Table | Purpose | RLS |
|---|---|---|
| `users` | Plan, credits, Google refresh token, voice_anchor_text | user owns row |
| `chat_sessions` | One per conversation thread | user owns rows |
| `chat_messages` | Message history (role: user/assistant/tool/system; content: jsonb) | via session |
| `prospect_candidates` | Discovery results, 24h TTL | user owns rows |
| `jobs` | Enrichment runs: pending→processing→completed/failed | user owns rows |
| `prospects` | One row per enriched person in a job | via job |
| `scrape_cache` | Shared key-value cache for all external calls | none (shared) |
| `credit_transactions` | Append-only credit ledger | user owns rows |
| `webhook_events` | Idempotency for Stripe/Razorpay/Gmail webhooks | service-role only |

**HARD RULE:** `supabaseAdmin` (service-role key) bypasses RLS — use only in API routes / server jobs. **Never expose the service-role key to the browser. Ever.**

---

## Section 7 — Environment Variables

```env
# Provider keys — deterministic mock fallbacks exist for all of these
ANTHROPIC_API_KEY=
BRAVE_SEARCH_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Supabase — NO mock. Required for auth to function.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # SERVER-ONLY. NEVER in browser code.
```

Template: `.env.local.example` → copy to `.env.local`.

---

## Section 8 — The 7 Agent Tools

Defined in `lib/agent/tools.ts`, implemented in `lib/agent/tool-handlers.ts`.

| Tool | Trigger | Hard Constraint |
|---|---|---|
| `web_search` | "find me X" | Show 3–5 candidates BEFORE recommending bulk |
| `public_source_search` | Dev/maker ICPs | Sources: github, producthunt, hn_algolia |
| `enrich_prospect` | "research [Name] at [Co]" | Single person, streams inline |
| `clarify_question` | ICP too vague | Use sparingly |
| `add_named_prospects` | User provides names | No search; user-provided list only |
| `start_bulk_job` | After candidate list confirmed | **Only after explicit user confirmation** |
| `launch_campaign` | "send the emails" | **NEVER without explicit "yes, send real emails"** |

---

## Section 9 — Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router, RSC) | |
| Language | TypeScript 5 strict | No `any` |
| UI | Tailwind v4 + shadcn/ui (`@base-ui/react`) | |
| DB | Supabase Postgres | RLS everywhere |
| Auth | Supabase Auth — Google OAuth | |
| AI SDK | Vercel AI SDK v6 (`ai`) | `useChat`, streaming, tool calls |
| LLM | Claude Sonnet 4.6 (drafting) + Haiku 4.5 (summaries) | |
| Discovery | Brave Search API + DuckDuckGo fallback | |
| Export | Google Sheets API (`googleapis` v171) + CSV | |
| Testing | Node.js built-in (`--experimental-strip-types`) | `npm test` |
| Hosting | Vercel | |

---

## Section 10 — Coding Conventions (Non-Negotiable)

Every agent must follow these exactly. No exceptions.

1. **Server-first RSC.** Default to React Server Components. Add `"use client"` only for `useState`/`useChat`/browser APIs.
2. **DB access pattern.** UI reads: RLS-scoped client in Server Components. Background/admin writes: `supabaseAdmin` (service-role). Never service-role in browser.
3. **Cache all external calls.** `getOrSetCache()` from `lib/cache.ts` for every scraping/search API call. Non-negotiable.
4. **Zod for all parsing.** `z.infer<typeof schema>` for types. No `any`.
5. **`cn()` for classes.** From `lib/utils.ts`. No inline `style={}`.
6. **Tool context is server-injected.** `userId` and `sessionId` come from `makeTools(ctx)`. Never trust the model to provide them.
7. **Mock fallbacks are mandatory.** Every external provider must function without API keys. Real outputs get `demo data` badge.
8. **Commit style.** Lowercase, descriptive, multi-line for context.
9. **No comments by default.** Only add a comment when the WHY is non-obvious. Never explain WHAT.
10. **Module boundaries.** `lib/agent/tools.ts` = schemas only. `lib/agent/tool-handlers.ts` = logic only. `lib/providers/*` = thin wrappers only. Do not cross.

---

## Section 11 — Module Ownership Boundaries

| Zone | Default Agent | Strict Rule |
|---|---|---|
| `app/(marketing)/*` | Any | Static only. No auth, no DB. |
| `app/app/*` | Antigravity CLI | Authenticated UI. Middleware guards `/app/*`. |
| `app/api/chat/route.ts` | Claude CLI only | Streaming only. No DB writes except via handlers. |
| `lib/agent/tools.ts` | Claude CLI only | Schemas + wrappers only. No business logic. |
| `lib/agent/tool-handlers.ts` | Claude CLI only | Business logic. Must be independently testable. |
| `lib/providers/*` | Claude CLI only | Thin wrappers. No business logic. |
| `lib/supabase/` | Claude CLI only | Never import server.ts in client components. |
| `components/ui/` | Antigravity CLI | shadcn/ui components. |
| `tests/` | Codex | All test files. |
| `plan.md` | Any | Update alongside every commit. |
| `COORDINATION.md` | All — shared | Append Section 0 + 13 only. Never rewrite another agent's entries. |

---

## Section 12 — Agent-Specific Mandatory Checklist

### Every Agent, Every Session — Pre-Work Checklist

```
[ ] 1. I have read COORDINATION.md in full (not skimmed).
[ ] 2. I have read Section 0.1 — I know what the other agents are working on.
[ ] 3. I have read Section 0.2 — I verified no file I need is claimed by another agent.
[ ] 4. I have read Section 3 — I know exactly what is done and what is not.
[ ] 5. I have read Section 14 — I know the priority task queue.
[ ] 6. I have added my row to Section 0.1 (status = ✅ Active).
[ ] 7. I have added my files to Section 0.2 (File Claims).
[ ] 8. I will record every action in Section 13 before moving to the next action.
[ ] 9. I will update Section 3 when a ❌ item becomes ✅.
[ ] 10. I will clear Section 0.2 and set Section 0.1 status to 💤 Idle after my commit.
```

**If any checkbox is unchecked: STOP. Complete it before writing any code.**

### Claude CLI — Additional Rules

- You own `lib/agent/`, `app/api/`, `lib/providers/`, DB schema, COORDINATION.md updates.
- Architecture decisions belong to you. Record the decision AND the rationale in Section 13.
- When unsure about product intent: read `docs/PRD.md` → `docs/ARCHITECTURE.md` → ask Aryan.
- You are responsible for keeping Section 2 (history), Section 3 (status), and Section 14 (queue) accurate.

### Antigravity CLI — Additional Rules

- You own `app/app/*` UI pages, `components/ui/`, `hooks/`.
- Do NOT touch `lib/agent/`, `app/api/chat/route.ts`, or DB schema without claiming and coordinating with Claude CLI.
- All components use `cn()` + shadcn/ui. No new UI libraries without Aryan approval.
- Run `npm run lint` before every commit.

### Codex — Additional Rules

- You own `tests/`, boilerplate generation, repetitive patterns.
- Do NOT make architectural decisions. If you see a design issue, record it in Section 13 and stop.
- All test files use Node.js built-in test runner (`--experimental-strip-types`). No Jest, no Vitest.
- Record every generated file in Section 13 with its purpose.

---

## Section 13 — Action Log (Append-Only)

> **Rules:** Append only. Never delete or edit another agent's entry.
> **Format:** `### [DATE] | [AGENT] | [CATEGORY] | [DETAIL]`
> **Categories:** INIT · BUILD · FIX · REFACTOR · DOCS · DECISION · BLOCKER · HANDOFF


### 2026-05-09 | Claude.ai Cowork | INIT
- Project scaffolded: Next.js 16 + TypeScript
- `plan.md` created as initial coordination tracker

### 2026-05-12 | Claude.ai Cowork | BUILD
- Tailwind v4 + shadcn/ui integrated
- AI SDK, Zod, googleapis installed
- Supabase Auth middleware + OAuth callback + RLS built
- Full DB schema (9 tables) written — `supabase/migrations/0001_init.sql`
- `lib/supabase/{server,client}.ts` created

### 2026-05-16 | Claude.ai Cowork | DOCS
- `docs/ARCHITECTURE.md` written (v0.5 full architecture)
- `docs/PRD.md` written (full product spec)
- `docs/SENDING_AGENT.md` written (v2 email-send spec, deferred)

### 2026-05-20 | Claude.ai Cowork | BUILD
- `/api/chat` streaming route built (Claude Sonnet 4.6, 7 tools, session persistence, mock)
- All 7 agent tools defined + implemented
- All 6 providers built with mock fallbacks
- Credit system, email compliance, reply classifier, CSV utils
- Sequences, Inbox, Pipeline, Analytics pages scaffolded
- Cron routes built; Mailbox management built; Unsubscribe landing built

### 2026-05-20 | Claude.ai Cowork | FIX
- Chat tool-call cards updated (chat-client.tsx)
- Inbox component improvements; tool card rendering fixes

### 2026-05-21 | Claude.ai Cowork | DOCS
- `AGENTS.md` created as universal AI context document

### 2026-05-21 | Claude CLI | DOCS
- `COORDINATION.md` v1 created — master multi-agent coordination document
- `CLAUDE.md` created — Claude CLI auto-load file
- `.antigravitycli/CONTEXT.md` created — Antigravity CLI entry point
- `AGENTS.md` header updated to reference COORDINATION.md
- `plan.md` rewritten to reflect actual phase completion

### 2026-05-21 | Claude CLI | BUILD
- `COORDINATION.md` v2 — full enforcement system:
  - Hard stop block at top
  - Section 0: Live Agent Status + File Claims + Simultaneous Work Protocol
  - Mandatory pre-work checklist (Section 12)
  - Stronger module ownership rules
  - Agent-specific rules for Claude CLI, Antigravity, Codex
- `CLAUDE.md` v2 — mandatory checklist, no-proceed gate
- `.antigravitycli/CONTEXT.md` v2 — mandatory checklist, no-proceed gate
- `AGENTS.md` v2 — mandatory checklist for Codex, harder enforcement language
- **HANDOFF:** Next priority = implement real Inbox page. Antigravity CLI should claim inbox/page.tsx in Section 0.2 and implement the reply-thread UI. Claude CLI will handle any backend work needed.

### 2026-05-21 | Codex | BLOCKER
- Refreshed `COORDINATION.md` after user asked to continue.
- Confirmed Antigravity CLI still owns the remaining immediate v0.6 page/action files.
- Ran `npm.cmd run build`; first attempt timed out after 120s while Turbopack was still compiling.
- Reran `npm.cmd run build` with a longer timeout; build failed.
- Build blocker: sandbox could not fetch Google Font `Inter` from `https://fonts.googleapis.com`, causing a `next/font` failure.
- Build blocker: `app/app/inbox/page.tsx` defines inline `"use server"` actions while being pulled into a Client Component path through `app/app/inbox/inbox-client.tsx`.
- Build blocker: that same Inbox client import path leaks `lib/supabase/server.ts` / `next/headers` into the client bundle.
- Build blocker: `app/app/sequences/[id]/page.tsx` imports `Linkedin` from `lucide-react`, but that export does not exist.
- Decision: do not patch these files because Antigravity CLI still owns the active UI/page work; Codex remains idle.

### 2026-05-21 | Codex | FIX
- Refreshed `COORDINATION.md` after user asked to continue.
- Antigravity CLI is now idle; Claude CLI only claims backend cron/system-prompt/env/vercel files.
- Claimed the UI files with lint/build blockers: analytics client, inbox page/client, sequence pages, and animated counter.
- Decision: fix only the reported UI syntax/client-boundary/icon/hook blockers and avoid Claude-claimed backend files.
- Inspected claimed UI files; escaped template literal and Inbox boundary issues were already corrected in the current worktree.
- Replaced invalid `Linkedin` lucide import in `app/app/sequences/[id]/page.tsx` with `LinkIcon`.
- Ran `npm.cmd run lint`: passing. Ran `npm.cmd test`: passing, 45/45.
- Ran `npm.cmd run build`: failed because Next.js 16 detected both `middleware.ts` and `proxy.ts`.
- Claimed `middleware.ts`; decision: remove the duplicate legacy middleware because `proxy.ts` contains the current Supabase session refresh and route gating.

### 2026-05-21 | Antigravity CLI | BLOCKER
- Attempted to start Phase 6 Inngest async queue task.
- Noticed Claude CLI is currently Active and has claimed `inngest/*`, `app/api/inngest/route.ts`, and `lib/agent/tool-handlers.ts` for this exact task.
- Reverted my file claims and marked status as Blocked per Simultaneous Work Protocol (Rule 5).
- Deleted `middleware.ts` so Next.js 16 uses `proxy.ts` only.
- Reran `npm.cmd run lint`: passing. Reran `npm.cmd test`: passing, 45/45.
- Reran `npm.cmd run build` with network approval so Google Fonts could fetch: compile succeeded, then TypeScript failed in Claude-owned `lib/agent/tool-handlers.ts`.
- Current build blocker outside Codex claim: `lib/agent/tool-handlers.ts` compares `dbConfidence === "none"` after `dbConfidence` has already been narrowed to `"unknown" | "risky" | "invalid"`.
- PowerShell profile parse error still prints during escalated shell startup, but it did not cause the build type failure.
- Updated local-only `plan.md` with the Next.js 16 proxy cleanup note.
- Attempted required `git pull --rebase origin master`; Git refused because the shared worktree has unrelated unstaged changes in Claude-owned backend files/package files.
- Decision: do not stash or alter Claude-owned files; stage and commit only Codex changes (`app/app/sequences/[id]/page.tsx`, `middleware.ts`).
- Initial sandboxed commit attempt failed because `.git/index.lock` could not be created.
- Reran the same scoped stage/commit with approval.
- Commit `8b4d97c` created: `fix next 16 ui build blockers`; post-commit hook reported push to `origin/master`.
- WARNING / coordination conflict: after commit, `COORDINATION.md` changed and Claude CLI now claims `proxy.ts` for deletion as "superseded by middleware.ts", but commit `8b4d97c` deleted `middleware.ts` because Next.js 16 build failed when both files existed. Codex will not touch Claude-claimed `proxy.ts`; Claude must resolve this before build can be considered stable.

### 2026-05-21 | Antigravity CLI | BUILD
- Upgraded the chat client tool cards with premium aesthetic polish.
- Added animated gradients, loading indicators, subtle hover borders, and layout improvements to `WebSearchCard`, `EnrichCard`, `BulkJobCard`, `LaunchCampaignCard`, and `ClarifyCard`.
- Integrated Lucide icons for quick tool recognition.
- Waiting on Claude CLI to resolve the type checker failure in `lib/agent/tool-handlers.ts`.

### 2026-05-21 | Codex | INIT
- User asked Codex to continue.
- Re-read `COORDINATION.md` and located the live status/file-claim entries after terminal encoding made the first patch attempt miss the exact row text.
- Claude CLI is active on Inngest and claims `proxy.ts`, `inngest/functions/enrich-prospect.ts`, `app/api/inngest/route.ts`, and `lib/agent/tool-handlers.ts`.
- Current priority queue points to Claude-owned backend work; Codex will verify the worktree and only claim unclaimed Codex-safe files if a narrow fix is available.
- Checked `git status --short`, root files, and test files; current dirty implementation files are Claude-owned/backend/package/Inngest/proxy changes, so Codex will not edit them.
- Decision: run lint and tests only; skip code changes unless an unclaimed Codex-owned failure appears.
- Ran `npm.cmd test`: passing, 45/45.
- Ran `npm.cmd run lint` with a 120s timeout; it timed out before producing a result, so Codex will rerun lint with a longer timeout.
- Reran `npm.cmd run lint` with a 300s timeout: passing.
- Decision: run `npm.cmd run build` once to verify whether the remaining production build failure is still in Claude-owned files.
- Ran `npm.cmd run build`; Next.js did not reach compile/typecheck because it reported another build process is already running.
- PowerShell profile parse error still appears during build startup.
- Decision: inspect active Node/Next processes before touching any lock files.
- `Get-Process` query for node/npm/next timed out before returning data; Codex will use a lighter process listing.
- `tasklist /FI "IMAGENAME eq node.exe"` also timed out with access denied.
- Decision: do not kill processes or clear lock files blindly; inspect `.next` read-only for build lock context.
- Recursive `.next` metadata inspection timed out due workspace size; Codex will check only top-level lock-like files.
- Top-level `.next` inspections also timed out, suggesting filesystem contention or an active build.
- Decision: treat production build verification as blocked by the existing Next build lock/process; do not delete `.next` artifacts or kill processes from Codex.
- Final status: no unclaimed Codex-owned code changes made. Lint passes, tests pass, build verification is blocked by Next's active/stale build-process guard before compile.
- Cleared Codex file claim and returned Codex to idle.

### 2026-05-21 | Claude CLI | FIX + BUILD — Inngest, DNS MX, middleware, TS type
- **Context on resume**: read COORDINATION.md fully; confirmed all other agents idle.
- **Staged backend changes (eb20734)**: already committed by VS Code auto-watcher — vercel.json cron config, cron GET exports, system-prompt sequences context, health version 0.6.0, env vars.
- **Lint fix (0f0df84)**: committed `fix: remove unused redirect import in inbox page`.
- **DNS MX email verification** (`lib/email-patterns.ts`): added `verifyDomainMx(domain)` using Node.js `dns.promises.resolveMx()`. In-process cache, 3s timeout. Returns `mx_verified | no_mx | unknown`. No new dependencies.
- **Wired MX into `handleStartBulkJob`**: email_confidence upgrades from "risky" to "invalid" when no MX records; stays "risky" when MX verified (still pattern-guessed); "unknown" on DNS failure.
- **Inngest async queue**: installed `inngest` package. Created `inngest/client.ts`, `inngest/functions/bulk-enrich.ts` (per-prospect steps with retry=2, concurrency=3), `app/api/inngest/route.ts`. Modified `handleStartBulkJob` to dispatch Inngest event for batches >20 when `INNGEST_EVENT_KEY` is set; falls back to sync path otherwise. Documented env vars in `.env.example`.
- **TS type fix**: removed dead `"none"` from `dbConfidence` union in `handleStartBulkJob`; comparison was always-false and caused build failure.
- **middleware.ts / proxy.ts resolution**: `proxy.ts` (committed) had wrong export name `export function proxy` — never valid Next.js middleware. `middleware.ts` existed on disk (untracked) with correct export. Rewrote `middleware.ts` with better Supabase cookie handling (mutate single response object) and added /login → /app/chat redirect for already-signed-in users. Staged proxy.ts deletion, tracked middleware.ts.
- **DECISION**: proxy.ts was never functional middleware (wrong function name). middleware.ts is the single source of truth for auth. Both Supabase cookie patterns are correct; used the single-response-mutation pattern to avoid dropped cookies.

### 2026-05-21 | Claude CLI | BUILD — Playwright scraper microservice
- Claimed: `scraper/*`, `lib/providers/scraper-client.ts`, `lib/agent/tool-handlers.ts`, `.env.example`
- **scraper/ service** (separate Fly.io deployable):
  - `scraper/Dockerfile` — `mcr.microsoft.com/playwright:v1.48.0-jammy` base, tsc build, node dist/server.js
  - `scraper/fly.toml` — Singapore region, 1GB RAM, 0-3 VMs, auto-stop when idle, max 6 concurrent requests
  - `scraper/package.json` + `tsconfig.json` — Fastify 4 + Playwright 1.48, CommonJS target
  - `scraper/src/server.ts` — Fastify server; auth hook (`x-scraper-key` header); `/health` exempt; `/scrape/company` + `/scrape/news` endpoints
  - `scraper/src/handlers/health.ts` — `GET /health` with version
  - `scraper/src/handlers/company-site.ts` — Playwright chromium; visits 6 team/about/contact paths; email regex extraction; per-target name title detection; 2s per-domain rate limit; generic email filter (noreply/support/info etc.)
  - `scraper/src/handlers/news.ts` — DuckDuckGo JSON fetch (no browser, no key); parses JSONP wrapper; returns up to 5 articles with title/url/snippet/date
- **`lib/providers/scraper-client.ts`** — typed HTTP client with 30s timeout; mock fallback when `SCRAPER_URL`/`SCRAPER_KEY` unset; `scrapeCompany()` + `scrapeNews()`
- **`lib/agent/tool-handlers.ts`** — upgraded `handleEnrichProspect`:
  - Resolves domain from `company_domain` param or `guessDomainFromCompany()`
  - Parallel `getOrSetCache`-wrapped calls to `scrapeCompany` (30d TTL) + `scrapeNews` (7d TTL)
  - Email priority: scraped+name-matched > scraped first > pattern-guessed+MX-verified > none
  - Passes news summary to `draftForProspect` for personalisation context
  - Returns full enrichment object: email/confidence/source, scraped_emails, recent_news, draft
- TypeScript: clean (exit 0). ESLint: clean. No new dependencies in main app.

### 2026-05-21 | Claude CLI | COMMIT — a1958d4
- Read full COORDINATION.md; confirmed all agents idle and no file claims active.
- Verified all staged files (inngest/client.ts, inngest/functions/bulk-enrich.ts, app/api/inngest/route.ts, lib/email-patterns.ts, lib/agent/tool-handlers.ts, .env.example, package.json) matched documented work.
- Committed and auto-pushed `a1958d4`: feat: inngest async queue, dns mx verification, ts type fix, middleware.
- Cleared file claims (Section 0.2) and set status to 💤 Idle.
### 2026-05-21 | Claude CLI | FIX + BUILD — Verify project state, fix lint errors
- Read full COORDINATION.md and confirmed project status; registered as Active.
- Ran `npm test`: 45/45 passing.
- Ran `npm run lint`: found 5 ESLint errors (3 in Antigravity-claimed billing files, 2 in webhook routes).
- Fixed webhook routes (`app/api/webhooks/{razorpay,stripe}/route.ts`): removed `catch (error: any)` antipattern, used proper error narrowing with `error instanceof Error`.
- Committed `01edaa3`: `fix: remove any types in webhook routes (razorpay, stripe)`.
- Attempted `npm run build`: blocked by stale Next.js build lock (another build already running).
- Next: clear build lock, verify build succeeds, assess v0.6 priorities.

### 2026-05-21 | Claude CLI | DECISION + BUILD — prospect stage backend (commit `5e1de73`)
- **Context on resume**: user asked to "continue the work where claude extension left". Read COORDINATION.md fully; all my prior claims already cleared from 0.2.
- **Found**: predecessor left `supabase/migrations/0002_prospect_stage.sql` + `app/api/analytics/route.ts` untracked, and a planned-but-missing `app/api/prospects/[id]/route.ts` PATCH route.
- **Architectural finding (surfaced to user)**: `prospects.stage` is a PARALLEL model to the live pipeline. Antigravity's Pipeline UI writes `campaign_recipients.status` (0004_sending.sql) via the `updateRecipientStatus` server action; the Analytics page does its own direct queries and never calls `/api/analytics`. So `prospects.stage` is written by nothing and read only by the orphaned `/api/analytics`.
- **DECISION (user-directed)**: user chose to finish the predecessor's plan as-is. Built the missing PATCH route; kept the migration + analytics route.
- **Built** `app/api/prospects/[id]/route.ts`: `PATCH` updates `prospects.stage`, zod-validated enum (contacted/replied/interested/converted/unsubscribed), RLS-scoped write via the "own prospects update" policy from 0002.
- **Verify**: `npx tsc --noEmit` → my 3 files clean (pre-existing errors only in Antigravity billing + the separate scraper service, both untouched). `eslint app/api/prospects` clean. `npm test` 45/45. origin/master in sync (0/0).
- **Committed + auto-pushed `5e1de73`** (feat: prospect stage pipeline backend, 3 files +222). Did NOT stage COORDINATION.md, package*, tsconfig, app-shell, or any Antigravity billing/webhook files.
- **NOTE for future**: `/api/analytics` + `prospects.stage` remain unwired to the UI. To make them live, wire the Pipeline/Analytics pages to this model, or have the launch/reply flows write `prospects.stage`. Left as-is per user direction.
- Set Claude CLI status to 💤 Idle.

### 2026-05-22 | Claude CLI | DECISION + FIX + BUILD — sole-agent takeover, billing shipped, prod build GREEN (commit `41ac9db`)
- **User directive**: "act as chief agent ... build full product end to end". Confirmed scope → sole-agent takeover (Antigravity/Codex set Idle in 0.1; their billing claims cleared in 0.2).
- **Health audit**: backend (my lane) is genuinely complete — chat agent + 7 tools, Inngest bulk fan-out, `send-due` worker (warm-up caps, send windows, suppression, compliance footer, real Gmail send + mock), `detect-replies`, scraper, exports. tsc clean, tests 45/45.
- **Schema finding (flagged, NOT changed)**: migrations have colliding `0002_*` prefixes; `0004_sending.sql` is dead/shadowed by `0002_sequences_sending.sql` (the `user_id`-denormalized shape, which the code matches). Works on a clean migrate (first `create table if not exists` wins). Did not rename/delete migrations — too risky if a remote DB is already migrated. Recommend a future squashed `0005_consolidate.sql`.
- **Build was failing** (a `| tail` pipe had masked the real exit code): `lib/billing.ts` constructed Stripe eagerly at module load; with no `STRIPE_SECRET_KEY` the constructor throws "Neither apiKey nor config.authenticator provided" → `next build` died collecting page data for the webhook route. **Fixed**: lazy `getStripe()` (mirrors `getRazorpay()`) + updated the 2 call sites. Also restores "works without keys".
- **webhook_events runtime bug fixed**: `upgradeUserPlan` inserted `{id, type, payload}` but the schema is `{id, provider NOT NULL, payload}`. Now inserts `{id, provider, payload:{...,type}}`, threading `provider` from each webhook ("stripe"/"razorpay"); idempotency check switched to `.maybeSingle()`.
- **Lint cleared (4 → 0)**: typed `window.Razorpay` (dropped `@ts-ignore`), removed unused `response` param, removed unused `getRazorpay` import.
- **Verify**: `tsc` clean, `eslint .` clean, `npm test` 45/45, `npm run build` GREEN (26/26 static pages; all routes incl. `/api/webhooks/{stripe,razorpay}`, `/app/settings/billing`).
- **Committed + auto-pushed `41ac9db`** (feat: billing — stripe + razorpay; 12 files +651). Did NOT stage COORDINATION.md.
- **Known follow-ups (not build-blocking)**: (1) `upgradeUserPlan` sets `users.credits_remaining` directly but writes no `credit_transactions` ledger row; (2) migration consolidation per above; (3) `/api/analytics` + `prospects.stage` still unwired to the UI (per earlier user direction).

### 2026-05-22 | Claude CLI | FIX — credit correctness + schema healing migration (commit `2a49e1a`)
- Addressed follow-ups (1) and (2) from the prior entry.
- **`supabase/migrations/0005_consolidate.sql`** (new, additive + idempotent): heals the `user_id` columns on `campaign_recipients` / `reply_classifications` / `email_events`. The shadowed `0004_sending.sql` shape omits `user_id`; a DB migrated before `0002_sequences_sending.sql` existed would break `launch_campaign` inserts, the send/reply workers, and RLS. The migration only ADDs columns, backfills from the owning campaign, and ensures the canonical `user_id` RLS policy. No drops; no-op on a healthy DB. Did NOT delete/edit existing migrations (avoids checksum/tracking drift); `0004_sending.sql` left immutable but documented as superseded. Intent tables need no healing — the code only uses columns present in both shapes.
- **`lib/billing.ts`**: `upgradeUserPlan` now writes a `credit_transactions` ledger row (`delta = planInfo.credits`, `reason = plan_upgrade_<plan>`) so credit history reflects paid grants.
- **`lib/credits.ts`**: monthly-reset grants were a divergent local constant (starter 250 / pro 1000 / agency 5000) — now sourced from the canonical `PLANS` catalog (starter 1000 / pro 5000 / agency 20000) so resets match what each plan was sold for.
- **Verify**: tsc clean, eslint clean, tests 45/45, `npm run build` GREEN (26/26). Committed + auto-pushed `2a49e1a`.
- **Remaining follow-up**: `/api/analytics` + `prospects.stage` still unwired (per earlier user direction). Migration set still has redundant `0002_sequences.sql` (subset of `0002_sequences_sending.sql`) — harmless, left in place.

### 2026-05-22 | Claude CLI | FIX — Razorpay revenue bug + upgrade plan guard (commit `3cccb39`)
- **Audited the full billing money-path** (checkout actions → webhooks → upgradeUserPlan). Confirmed `webhook_events` insert now matches schema (`id`/`provider`/`payload`, `type` folded into payload) and both webhooks verify signatures.
- **Revenue bug found + fixed**: Razorpay `createRazorpayOrder` set `notes:{plan,userId}` on the ORDER, but Razorpay does not copy order notes to the payment entity, and the `payment.captured` webhook reads `payment.notes`. The frontend checkout `options` omitted `notes`, so every INR payer was charged but never upgraded. Fixed by passing `notes:{plan,userId}` into the Razorpay checkout options (these DO propagate to the payment). `billing-client.tsx`.
- **Hardening**: `upgradeUserPlan` now validates the plan (rejects `free`/unknown) BEFORE writing the idempotency row, so a malformed/forged webhook can't mark an event processed without upgrading. `lib/billing.ts`.
- Stripe path verified correct (session `metadata` propagates to `checkout.session.completed`).
- **Verify**: tsc clean, eslint clean, `npm run build` GREEN (26/26). Committed + auto-pushed `3cccb39`.
- **Note**: full live billing E2E (real Stripe/Razorpay test keys) still unverified from here — code path is structurally correct and signature/idempotency-safe.

### 2026-05-22 | Claude CLI | DECISION + AUDIT + STATUS UPDATE
- **Resumed as sole agent** (user directive: "chief agent, build full product end to end"). Pre-work checklist completed; all agents idle, no file claims active.
- **Health audit** (tests → lint → build):
  - npm test: 45/45 passing ✅
  - npm lint: clean ✅
  - npm build: **GREEN** ✅ (2.8min compile, 2.2min TypeScript, 26/26 pages static, 17 API routes server-rendered)
- **Feature completeness audit** (spot-checked all scaffolded pages for real implementations):
  - `app/app/inbox/page.tsx` — real: fetches `reply_classifications` where `needs_human=true`, resolves recipient emails, displays threaded replies ✅
  - `app/app/pipeline/page.tsx` — real: fetches `campaign_recipients`, Kanban UI with status columns ✅
  - `app/app/analytics/page.tsx` — real: queries jobs/prospects/credit_transactions, computes monthly/lifetime metrics ✅
  - `app/app/sequences/page.tsx` — real: lists sequences with step/enrollment counts, timestamps ✅
- **Architecture assessment**: Chat agent + 7 tools (web_search, enrich_prospect, start_bulk_job, launch_campaign, etc.), Inngest async queue, Playwright scraper, DNS MX verification, Stripe + Razorpay billing, prospect stage backend, cron workers (send-due, detect-replies, poll-intent) — all present and shipping.
- **Phase 5 validation**: Plan says "COMPLETE" but was waiting on user to apply migrations to Supabase. Plan also shows Phase 6 items (Inngest, scraper, DNS MX) as deferred but they shipped. Recommend: update plan.md to current ground truth in next review.
- **Current state**: Product is feature-complete for MVP. All major user flows are implemented: sign-in → chat → enrich → send → review replies → track pipeline → billing. Database schema is comprehensive (9 tables core, 11 new for sequences/sending).
- **Next priority assessment**:
  - *Option A*: End-to-end test flows (CSV upload → enrichment → sending → reply classification → dashboard) to identify missing wiring or bugs.
  - *Option B*: Deployment readiness (environment setup, Fly.io scraper config, Vercel cron setup, Inngest event key config).
  - *Option C*: Quick wins / refinements (CSV import ergonomics, dashboard polish, performance tuning).
  - Awaiting user direction on priority.


---

## Section 14 — Next Actions Queue (Priority Order)

Agents pull from the top. Claim the task in Section 0 before starting.

### Immediate — v0.5 → v0.6

- [x] **[Antigravity] Inbox page** — `app/app/inbox/page.tsx`. Pull reply threads from `prospects` + `chat_messages` (where role=reply). Display grouped by job. Spec: `docs/SENDING_AGENT.md`. Backend cron already exists at `app/api/cron/detect-replies/route.ts`.
- [x] **[Antigravity] Pipeline page** — `app/app/pipeline/page.tsx`. Kanban board: prospects grouped by `stage` column (contacted/replied/interested/converted/unsubscribed). Drag-to-update stage via Server Action in `app/app/actions.ts`.
- [x] **[Antigravity] Analytics page** — `app/app/analytics/page.tsx`. Charts: emails sent per day, reply rate, interested rate, credits used. Data from `jobs` + `prospects` + `credit_transactions` tables via RLS-scoped server component.
- [x] **[Antigravity] Sequences page** — `app/app/sequences/page.tsx`. List view of saved sequences. `new/page.tsx`: step builder (subject, body, delay days). Spec: `docs/SENDING_AGENT.md`.
- [x] **[Antigravity/Codex] CSV upload UI** — Drag-drop in `app/app/chat/components/chat-client.tsx`. Calls `add_named_prospects` tool with parsed CSV rows.

### Next Sprint — v0.6 → v0.7

- [x] **[Claude CLI] Inngest async queue** — `inngest/functions/bulk-enrich.ts`, `inngest/client.ts`, `app/api/inngest/route.ts`. Dispatches for batches >20 when `INNGEST_EVENT_KEY` set; sync fallback otherwise.
- [x] **[Claude CLI] DNS MX email verification** — `lib/email-patterns.ts`: `verifyDomainMx()`. Upgrades confidence from "risky" → "invalid" when no MX records. Full SMTP probe still deferred (port 25 blocked in Vercel).
- [x] **[Claude CLI] Playwright scraper microservice** — `scraper/` as separate Fastify service, deploy to Fly.io.

### Post-PMF (do not build)

- [x] Billing (Razorpay + Stripe)
- [ ] Chrome extension
- [ ] CRM push (HubSpot + Zoho)

- [ ] Full multi-step sequences (v2 send agent)

---

## Section 15 — Key Design Decisions

| Decision | Rationale |
|---|---|
| Chat-first UI | Lower friction; differentiates from Apollo |
| No paid data APIs | Zero licensing cost; Brave = 2000 free/mo |
| Google Sheets as primary output | Indian/SEA SMBs live in Sheets |
| Mock fallbacks for every provider | Full demo without API keys |
| Inngest for bulk jobs >20 | Sync path for ≤20 (fast, no setup); Inngest fan-out for larger batches when `INNGEST_EVENT_KEY` is set |
| RLS on every user table | Multi-tenant safety without app-layer filtering bugs |
| `voice_anchor_text` | User pastes own email → AI matches their writing register |
| Credits system | Metered billing hook; free = 25/mo |
| `stopWhen: stepCountIs(5)` | Prevents runaway tool-call chains (in `app/api/chat/route.ts:137`) |
| `supabaseAdmin` only server-side | RLS bypass must never reach browser |

---

## Section 16 — Running the Project

```bash
npm install
cp .env.local.example .env.local   # fill Supabase keys; leave provider keys blank for mocks

npm run dev     # → http://localhost:3000
npm test        # Node built-in test runner
npm run lint    # ESLint
npm run build   # production build

# DB schema (first time)
supabase db push
# or: psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
```

**Mock mode:** Entire product runs without Anthropic/Brave/Google keys. Only Supabase required for login. Real outputs tagged `demo data`.
