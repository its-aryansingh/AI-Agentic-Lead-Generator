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
| Claude CLI | ✅ Active | Coordination system setup | COORDINATION.md, CLAUDE.md, .antigravitycli/CONTEXT.md, AGENTS.md, plan.md | 2026-05-21 |
| Antigravity CLI | 💤 Idle | — | — | — |
| Codex | 💤 Idle | — | — | — |

> **Status codes:** `✅ Active` / `💤 Idle` / `🔒 File Lock` / `⏸ Blocked` / `✔ Done (update log then clear)`

### 0.2 — File Claim Registry (Active Locks)

Before editing any file, add it here. Remove it when your commit is done.
**If a file you need is already listed here, STOP — wait or coordinate before touching it.**

| File | Claimed By | Reason | Claimed At |
|---|---|---|---|
| *(none currently locked)* | — | — | — |

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

---

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

---

## Section 14 — Next Actions Queue (Priority Order)

Agents pull from the top. Claim the task in Section 0 before starting.

### Immediate — v0.5 → v0.6

- [ ] **[Antigravity] Inbox page** — `app/app/inbox/page.tsx`. Pull reply threads from `prospects` + `chat_messages` (where role=reply). Display grouped by job. Spec: `docs/SENDING_AGENT.md`. Backend cron already exists at `app/api/cron/detect-replies/route.ts`.
- [ ] **[Antigravity] Pipeline page** — `app/app/pipeline/page.tsx`. Kanban board: prospects grouped by `stage` column (contacted/replied/interested/converted/unsubscribed). Drag-to-update stage via Server Action in `app/app/actions.ts`.
- [ ] **[Antigravity] Analytics page** — `app/app/analytics/page.tsx`. Charts: emails sent per day, reply rate, interested rate, credits used. Data from `jobs` + `prospects` + `credit_transactions` tables via RLS-scoped server component.
- [ ] **[Antigravity] Sequences page** — `app/app/sequences/page.tsx`. List view of saved sequences. `new/page.tsx`: step builder (subject, body, delay days). Spec: `docs/SENDING_AGENT.md`.
- [ ] **[Antigravity/Codex] CSV upload UI** — Drag-drop in `app/app/chat/components/chat-client.tsx`. Calls `add_named_prospects` tool with parsed CSV rows.

### Next Sprint — v0.6 → v0.7

- [ ] **[Claude CLI] Inngest async queue** — `inngest/functions/enrich-prospect.ts`. Fan-out bulk enrichment for jobs >20 prospects.
- [ ] **[Claude CLI] SMTP email verification** — Implement stubs in `lib/email-patterns.ts`. DNS MX lookup + SMTP RCPT TO probe.
- [ ] **[Claude CLI] Playwright scraper microservice** — `scraper/` as separate Fastify service, deploy to Fly.io.

### Post-PMF (do not build)

- [ ] Billing (Razorpay + Stripe)
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
| Synchronous bulk jobs (no Inngest yet) | Fine up to ~20; defer async complexity until post-PMF |
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
