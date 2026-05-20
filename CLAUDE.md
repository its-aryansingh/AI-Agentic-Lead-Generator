# CLAUDE.md — Claude CLI Auto-Load Context
# LeadGenAI

> This file is auto-loaded by Claude CLI at session start.
> Read COORDINATION.md immediately after this file — it is the master context.

## Your First 3 Steps Every Session

1. **Read `COORDINATION.md`** (root of repo) — the single source of truth for all agents.
2. **Check Section 3** of COORDINATION.md for current project state before writing any code.
3. **Check Section 14** of COORDINATION.md for the priority task queue.

## Project in One Paragraph

LeadGenAI is a Next.js 16 App Router app. Users describe their ideal B2B customer in chat → Claude Sonnet 4.6 agent uses Brave Search to find prospects → enriches each with AI-drafted cold emails + talking points → exports to Google Sheets or CSV. V0.5 MVP is feature-complete. Active work is on polishing the scaffolded pages (inbox, pipeline, analytics, sequences) and building deferred features (Inngest queue, Playwright scraper, SMTP verification).

## Critical Rules for Claude CLI

- **Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser-side code.**
- **Always preserve mock fallbacks.** Every external provider must work without API keys.
- **Use `getOrSetCache()`** from `lib/cache.ts` for all external API calls — primary cost lever.
- **Server Components by default.** Add `"use client"` only for `useState`/`useChat`/browser APIs.
- **Zod for all parsing.** No `any` types. Derive types via `z.infer<typeof schema>`.
- **Update `COORDINATION.md` Section 13 (Action Log)** after every significant action.
- **Update `plan.md`** alongside every commit.

## Key Files

| File | Purpose |
|---|---|
| `COORDINATION.md` | Master context — read first, update after every action |
| `app/api/chat/route.ts` | Core streaming AI agent endpoint |
| `lib/agent/tools.ts` | 7 tool Zod schemas |
| `lib/agent/tool-handlers.ts` | 7 tool implementations |
| `lib/agent/system-prompt.ts` | Agent personality rules |
| `supabase/migrations/0001_init.sql` | Full DB schema |
| `plan.md` | Phase tracker |
| `docs/PRD.md` | Product spec |
| `docs/ARCHITECTURE.md` | Technical architecture |
| `docs/SENDING_AGENT.md` | V2 email-send spec (deferred) |

## What Was Built in Claude.ai (Cowork)

Full history in `COORDINATION.md` Section 2. Summary:
- **Foundation**: Next.js 16 scaffold, Supabase Auth + DB schema, Tailwind v4 + shadcn/ui
- **Core agent**: `/api/chat` streaming route with 7 tools, all handlers, all providers
- **Features**: Google Sheets export, CSV download, voice anchor, job history
- **Scaffolded**: Inbox, Pipeline, Analytics, Sequences (need real implementation)
- **Infra**: Credits system, email compliance, reply classifier, cron routes, mailbox management

## Running

```bash
npm run dev    # http://localhost:3000
npm test
npm run lint
```
