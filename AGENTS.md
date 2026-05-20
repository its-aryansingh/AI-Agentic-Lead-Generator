# AGENTS.md — LeadGenAI (Codex / OpenAI Entry Point)

---

## ⛔ DO NOT PROCEED PAST THIS LINE UNTIL CHECKLIST IS COMPLETE

```
You are Codex (or any OpenAI-family agent) operating on the LeadGenAI project.
Before writing a single line of code, running a single command,
or making a single decision, you MUST complete every item below.
```

### Mandatory Pre-Work Checklist

```
[ ] 1. Open and read COORDINATION.md (project root) in full — top to bottom.
[ ] 2. Read COORDINATION.md Section 0.1 — what are other agents currently doing?
[ ] 3. Read COORDINATION.md Section 0.2 — are any files you need already claimed?
[ ] 4. Read COORDINATION.md Section 3 — what is done? what is not done?
[ ] 5. Read COORDINATION.md Section 14 — what is the current priority queue?
[ ] 6. Update Section 0.1 in COORDINATION.md: set your row to ✅ Active with your task.
[ ] 7. Add your files to Section 0.2 in COORDINATION.md (File Claims).
[ ] 8. Begin work — record EVERY action in Section 13 before moving on.
[ ] 9. When done: update Section 3 if anything shipped, clear Section 0.2, set 0.1 to 💤 Idle.
```

**If any item is unchecked: STOP. Do not write code. Complete the checklist.**

---

> **`COORDINATION.md` (project root) is the master context file.**
> **It supersedes this file on every conflict.**
> This file is the entry point for Codex. After completing the checklist above,
> all decisions, plans, and actions must be grounded in COORDINATION.md.

---

---

## 1. Project Identity

| Field | Value |
|---|---|
| **Product name** | LeadGenAI |
| **Tagline** | AI-powered prospecting copilot for B2B sales teams in India and Southeast Asia |
| **Current version** | v0.5 MVP |
| **Owner** | Aryan Singh |
| **Repo** | `its-aryansingh/AI-Agentic-Lead-Generator` |
| **Primary docs** | `docs/PRD.md`, `docs/ARCHITECTURE.md`, `plan.md` (phase tracker) |

**One-line description:** Describe your ideal customer in plain English → LeadGenAI finds matching prospects, drafts a personalized first-touch email for each, and exports to Google Sheets or CSV.

---

## 2. Current Status (update this section with every significant change)

```
Last updated: 2026-05-20
Current phase: v0.5 MVP — Feature-complete; refinement & bug-fix mode
```

### What is DONE and working
- ✅ Next.js 16 App Router scaffold with TypeScript
- ✅ Tailwind v4 + shadcn/ui (`@base-ui/react`) design system
- ✅ Supabase Auth with Google OAuth (captures `drive.file` scope upfront)
- ✅ Full DB schema: `users`, `chat_sessions`, `chat_messages`, `prospect_candidates`, `jobs`, `prospects`, `scrape_cache`, `credit_transactions`, `webhook_events` — all with RLS
- ✅ `/api/chat` streaming route — Vercel AI SDK + Claude Sonnet 4.6, 7 tools
- ✅ `/app/chat` — full chat UI with streaming tool-call cards
- ✅ `/app/jobs` — job history with re-download links
- ✅ `/app/settings/voice` — voice anchor (paste your own email to match register)
- ✅ `/app/analytics`, `/app/inbox`, `/app/pipeline`, `/app/sequences` — scaffolded routes
- ✅ Google Sheets export (`drive.file` scope) + CSV download
- ✅ Mock fallback for every paid provider (runs end-to-end without API keys)
- ✅ `launch_campaign` tool — Gmail sending with warm-up caps and suppression list
- ✅ Credit system (`lib/credits.ts`), email compliance (`lib/email-compliance.ts`), reply classification (`lib/reply-classify.ts`), CSV parsing (`lib/csv-parse.ts`)

### What is NOT implemented yet (deferred)
- ❌ Inngest async queue (bulk jobs currently run synchronously, fine up to ~20 prospects)
- ❌ Fly.io Playwright scraper microservice (`scraper/` dir doesn't exist yet)
- ❌ SMTP email verification + pattern guessing (stubs exist in `lib/email-patterns.ts`)
- ❌ Billing (Razorpay / Stripe) — schema hook exists in `webhook_events`
- ❌ CSV upload flow (tool stub exists; no UI)
- ❌ Public-source search via GitHub / ProductHunt / HN Algolia (stub in tools, not implemented)
- ❌ Chrome extension (post-PMF)
- ❌ CRM push — HubSpot / Zoho (post-PMF)

---

## 3. Architecture & File Map

```
Root
├── app/                         — Next.js App Router
│   ├── (marketing)/page.tsx     — Public landing page (statically renderable)
│   ├── login/page.tsx           — Google OAuth sign-in
│   ├── app/                     — Authenticated dashboard (middleware guards /app/*)
│   │   ├── layout.tsx           — Dashboard shell
│   │   ├── chat/                — Chat interface (main product surface)
│   │   │   ├── page.tsx         — New chat entry point
│   │   │   ├── [sessionId]/     — Resume a past chat session
│   │   │   └── components/      — ChatClient, tool-call cards, streaming UI
│   │   ├── jobs/page.tsx        — Enrichment job history + re-download
│   │   ├── settings/voice/      — Voice anchor settings
│   │   ├── analytics/           — (scaffolded)
│   │   ├── inbox/               — (scaffolded)
│   │   ├── pipeline/            — (scaffolded)
│   │   └── sequences/           — (scaffolded)
│   └── api/
│       ├── chat/route.ts        — ⭐ Core AI agent. Streaming, 7 tools, session persistence
│       ├── auth/callback/       — Google OAuth exchange + users upsert
│       ├── export/csv/          — RLS-scoped CSV stream
│       ├── export/sheets/       — Google Sheets writer
│       ├── cron/                — Scheduled jobs
│       ├── health/              — Health check
│       └── mailbox/             — Gmail mailbox management
│
├── lib/
│   ├── agent/
│   │   ├── tools.ts             — ⭐ 7 tool definitions (Zod schemas + AI SDK wrappers)
│   │   ├── tool-handlers.ts     — ⭐ Concrete tool implementation logic
│   │   └── system-prompt.ts     — Agent personality + writing rules
│   ├── providers/
│   │   ├── brave-search.ts      — Real Brave API + mock discovery fallback
│   │   ├── anthropic.ts         — Claude drafting + system prompt assembly
│   │   └── google-sheets.ts     — Sheets writer + CSV serializer
│   ├── supabase/
│   │   ├── client.ts            — Browser-side Supabase client
│   │   └── server.ts            — SSR + admin (service-role) Supabase clients
│   ├── cache.ts                 — Postgres-backed getOrSet cache (hits scrape_cache)
│   ├── credits.ts               — Credit deduction + plan limits
│   ├── csv-parse.ts             — CSV ingestion utilities
│   ├── csv.ts                   — CSV serialization for export
│   ├── email-compliance.ts      — CAN-SPAM / GDPR / unsubscribe rules
│   ├── email-patterns.ts        — Email pattern guesser + SMTP probe stubs
│   ├── reply-classify.ts        — Classify inbound replies (interested/not/OOO/etc.)
│   └── utils.ts                 — cn(), hasKey(), hashIndex(), sleep()
│
├── components/ui/               — shadcn/ui component library
├── hooks/                       — React hooks
├── supabase/migrations/
│   └── 0001_init.sql            — Full DB schema (idempotent, safe to re-run)
├── tests/                       — Node test runner tests (*.test.ts)
├── docs/
│   ├── PRD.md                   — Full product spec (v0.1, Aryan Singh, 2026-05-09)
│   ├── ARCHITECTURE.md          — Detailed technical architecture
│   ├── ARCHITECTURE_V1.md       — Previous architecture version (reference only)
│   └── SENDING_AGENT.md        — Gmail sending agent spec (v2 feature)
├── plan.md                      — Phase-by-phase task tracker (update on every commit)
└── AGENTS.md                    — ← YOU ARE HERE
```

---

## 4. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router, RSC, Server Actions) | |
| Language | TypeScript 5 | Strict mode |
| UI | Tailwind v4 + shadcn/ui (`@base-ui/react`) | |
| Database | Supabase Postgres | RLS on all user tables |
| Auth | Supabase Auth — Google OAuth | Also captures `drive.file` scope |
| AI SDK | Vercel AI SDK (`ai` v6) | Streaming, tool calls, `useChat` hook |
| AI Model | Anthropic Claude — Sonnet 4.6 (drafting), Haiku 4.5 (summaries) | Via `@ai-sdk/anthropic` |
| Discovery | Brave Search API | Mock fallback when `BRAVE_SEARCH_KEY` not set |
| Export | Google Sheets API (`googleapis` v171) + CSV | |
| Hosting | Vercel | |
| Testing | Node built-in test runner (`--experimental-strip-types`) | `npm test` |

---

## 5. The 7 Agent Tools

All tools are defined in `lib/agent/tools.ts` and implemented in `lib/agent/tool-handlers.ts`.

| Tool | Purpose | Key rule |
|---|---|---|
| `web_search` | Discovery — find prospects matching an ICP via Brave Search | Always show 3–5 sample candidates before suggesting bulk run |
| `public_source_search` | Vertical discovery via GitHub / ProductHunt / HN Algolia | Use for dev-focused ICPs (CTOs, indie hackers) |
| `enrich_prospect` | Deep research + cold email + 3 talking points for ONE named person | Returns inline within ~15s |
| `clarify_question` | Ask the user a focused clarifying question | Use sparingly — only when ICP is genuinely too vague |
| `add_named_prospects` | Stage a list of explicitly-named prospects for bulk enrichment | No web search; user-provided names only |
| `start_bulk_job` | Kick off bulk enrichment → Google Sheet + CSV | **Only after explicit user confirmation** |
| `launch_campaign` | Send drafted emails from completed job via connected Gmail | **Highest-stakes action. NEVER call without explicit user "yes, send real emails"** |

---

## 6. Database Schema (Quick Reference)

| Table | Purpose |
|---|---|
| `users` | App profile — plan, credits, Google refresh token, voice anchor |
| `chat_sessions` | One per conversation |
| `chat_messages` | Message history (role: user/assistant/tool/system, content: jsonb) |
| `prospect_candidates` | Short-lived discovery results (expires 24h) surfaced by agent |
| `jobs` | Committed enrichment runs (pending→processing→completed/failed) |
| `prospects` | One row per enriched person in a job |
| `scrape_cache` | Key-value cache for all external API calls (cost control) |
| `credit_transactions` | Append-only credit ledger |
| `webhook_events` | Idempotency table for Stripe/Razorpay/Gmail push webhooks |

**RLS policy:** Every user-data table uses `auth.uid()` checks. Server-side admin paths use the service-role key (bypasses RLS). Never expose the service-role key to the browser.

---

## 7. Coding Conventions (Non-Negotiable)

1. **Server-first RSC**: Use React Server Components by default. Add `"use client"` only for hooks (`useState`, `useChat`) or browser APIs.
2. **Database access pattern**:
   - UI reads: Server Components → RLS-scoped Supabase client
   - Background / admin writes: `supabaseAdmin` (service-role key)
3. **Cache everything external**: Use `getOrSetCache()` from `lib/cache.ts` for ALL scraping and search API calls. This is the primary cost-control lever.
4. **Types**: Use Zod schemas for parsing and derive types with `z.infer<typeof schema>`. Do not invent `any` types.
5. **Conditional classes**: Use the `cn()` utility from `lib/utils.ts`. Avoid inline style attributes.
6. **Tool context**: The `userId` and `sessionId` are injected server-side in `makeTools(ctx)`. Never trust the model to provide them.
7. **Mock fallback**: Every provider (`brave-search.ts`, `anthropic.ts`, `google-sheets.ts`) must have a deterministic mock that works without API keys. Real outputs get a `demo data` badge in the UI.
8. **Commit style**: Lowercase, descriptive messages. Multi-line for context. (e.g. `add /api/chat streaming route using vercel ai sdk + claude sonnet`)

---

## 8. Environment Variables

```env
# Required for real operation (mock fallbacks exist for all)
ANTHROPIC_API_KEY=          # Real Claude — Sonnet 4.6 + Haiku 4.5
BRAVE_SEARCH_KEY=           # Real prospect discovery (2000 free queries/mo)

# Required for Google OAuth + Sheets export
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Required for persistence + auth (no mocks — must set for any login)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=  # Server-only. NEVER expose to browser.
```

Full template in `.env.local.example`. Copy to `.env.local` and fill in keys.

---

## 9. Key Design Decisions & Why

| Decision | Rationale |
|---|---|
| Chat-first UI (not form upload) | Lower friction, easier to iterate agent behavior, differentiates from Apollo |
| Google Sheets as primary output | Indian/SEA SMBs live in Sheets; no new tool adoption required |
| Brave Search (not Apollo/ZoomInfo APIs) | Zero data licensing cost; 2000 free queries/month covers MVP scale |
| Mock fallback for every provider | Lets any engineer run the full product locally without paid keys |
| Synchronous bulk jobs (no Inngest yet) | Fine up to ~20 prospects; defer async queue complexity until post-PMF |
| RLS on every user table | Multi-tenant safety without application-layer filtering bugs |
| `voice_anchor_text` in users table | User pastes their own email → AI matches their writing register |
| Credits system | Metered billing hook; free plan = 25 credits; 1 credit ≈ 1 enriched prospect |

---

## 10. Module Ownership Boundaries

Follow these strictly to avoid cross-contamination:

- `app/(marketing)/*` — Public pages. Must be statically renderable (no auth, no DB).
- `app/app/*` — All authenticated routes. Middleware at `middleware.ts` guards `/app/*`.
- `app/api/chat/route.ts` — The agent brain. Streaming only. No DB writes except via handlers.
- `lib/agent/tools.ts` — Zod schema definitions + `tool()` wrappers only. No business logic.
- `lib/agent/tool-handlers.ts` — All tool business logic. Testable independently.
- `lib/providers/*` — Thin external service wrappers. No business logic here.
- `lib/supabase/server.ts` — SSR client + admin client. Import in Server Components and API routes only.
- `lib/supabase/client.ts` — Browser client. Import in `"use client"` components only.

---

## 11. Running the Project

```bash
# Install
npm install

# Set up environment
cp .env.local.example .env.local
# Edit .env.local — leave keys blank to use mock mode

# Dev server
npm run dev
# → http://localhost:3000

# Tests
npm test

# Lint
npm run lint

# Apply DB schema (requires Supabase CLI or psql)
supabase db push
# or: psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
```

> **Mock mode**: The entire product works without any API keys except Supabase (needed for auth/login). Real outputs are tagged with a `demo data` badge.

---

## 12. What to Work On Next

Check `plan.md` for the living task tracker. At time of writing:

**Immediate priorities** (based on v0.5 state):
1. Playwright scraper microservice in a `scraper/` directory deployed to Fly.io
2. Inngest async queue for bulk jobs > 20 prospects
3. SMTP email verification + pattern guessing (stubs exist in `lib/email-patterns.ts`)
4. UI polish on chat tool-call cards
5. Real billing integration (Razorpay for India, Stripe for international)

**Do NOT build yet** (post-PMF):
- Chrome extension
- HubSpot / Zoho CRM push
- Multi-step email sequences (spec in `docs/SENDING_AGENT.md`)
- CSV upload UI (stub exists in tools, no UI)

---

## 13. Codex-Specific Rules

> **All decisions and priorities come from `COORDINATION.md`. This section adds Codex-specific constraints.**

### What Codex Owns
- `tests/` — all test files, Node.js built-in test runner only (no Jest, no Vitest)
- Boilerplate generation — repetitive patterns, type stubs
- `plan.md` updates alongside commits

### What Codex Does NOT Own (coordinate first)
- `lib/agent/` — Claude CLI owns this
- `app/api/chat/route.ts` — Claude CLI owns this
- `lib/providers/` — Claude CLI owns this
- `app/app/*` UI pages — Antigravity CLI owns this

### Codex Hard Rules
1. Do NOT make architectural decisions. If you spot a design issue, record it in COORDINATION.md Section 13 and stop.
2. All test files: `import { test, describe, it, assert } from 'node:test'` — not Jest, not Vitest.
3. Check COORDINATION.md Section 0.2 (File Claims) before touching any file.
4. Record every generated file and every decision in COORDINATION.md Section 13.
5. Update COORDINATION.md Section 0.1 (your status row) when starting and finishing.
6. Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser-side code.
7. Always preserve mock fallbacks — no code hard-fails when API keys are absent.
8. When unsure about design intent: check `docs/PRD.md` → `docs/ARCHITECTURE.md` → COORDINATION.md Section 15. Do not guess.

### Codex Auto-Push & Git Rules
9. **Every `git commit` auto-pushes to GitHub** via `.githooks/post-commit`. Do NOT run `git push` separately.
10. **Before committing**, run `git pull --rebase origin master` to get other agents' latest work.
11. **Never add Co-Authored-By** lines — the `commit-msg` hook strips AI attribution automatically.
12. **Never stage `.env.local`** — the `pre-commit` hook will reject the commit.
13. **Commit author** must always be `Aryan Singh <arajsingh0505@gmail.com>`. If git identity is wrong, fix it before committing: `git config user.name "Aryan Singh" && git config user.email "arajsingh0505@gmail.com"`.

## 14. Original Agent Instruction Block (preserved)

> 1. **Acknowledge** that you have read `AGENTS.md` and `COORDINATION.md`.
> 2. **Check COORDINATION.md Section 14** for current priorities before writing any code.
> 3. **Update COORDINATION.md Section 3** whenever a major feature ships.
> 4. **Update `plan.md`** alongside every commit.
> 5. **Never remove this instruction block.**
> 6. **Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser-side code.**
> 7. **Always use mock fallbacks** — no code should hard-fail when API keys are absent.
> 8. When unsure about a design decision: `docs/PRD.md` → `docs/ARCHITECTURE.md` → COORDINATION.md Section 15.
