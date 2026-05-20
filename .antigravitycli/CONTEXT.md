# Antigravity CLI — Project Context
# LeadGenAI

> **Read `COORDINATION.md` (project root) before any work.**
> This file is a thin entry point. COORDINATION.md is the master.

## What Is This Project

LeadGenAI — AI-powered B2B prospecting copilot for India/Southeast Asia.
Stack: Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui + Supabase + Claude Sonnet 4.6 + Vercel AI SDK v6.

**Current state:** V0.5 MVP is feature-complete. Several pages are scaffolded (inbox, pipeline, analytics, sequences) and need real implementation.

## Your First Steps Every Session

1. Read `COORDINATION.md` in full.
2. Check **Section 3** (Current Status) — what's done vs. not done.
3. Check **Section 14** (Next Actions Queue) — pull from the top.
4. After work, add an entry to **Section 13** (Action Log) in COORDINATION.md.

## Antigravity's Primary Role in This Project

Focus on:
- **UI component work** — implementing the scaffolded pages with real UI
- **Styling and layout** — Tailwind v4 + shadcn/ui components
- **Fast iteration** on chat tool-call cards and dashboard UI

Avoid (coordinate with Claude CLI first):
- Changes to `lib/agent/` (tools, handlers, system prompt)
- Changes to `app/api/chat/route.ts`
- Database schema changes

## Rules

1. Always use `cn()` from `lib/utils.ts` for conditional classes.
2. Use `@base-ui/react` (shadcn/ui) components — don't install new UI libraries without checking first.
3. Add `"use client"` only when absolutely required (hooks, browser APIs).
4. Default to React Server Components.
5. Run `npm run lint` before committing.
6. Update COORDINATION.md Section 13 after every meaningful action.

## Workspace Commands

```bash
npm run dev    # dev server → http://localhost:3000
npm run lint   # ESLint
npm test       # Node built-in test runner
```

## Files Most Relevant to UI Work

```
app/app/
  chat/components/chat-client.tsx    ← main chat UI
  inbox/page.tsx                     ← implement reply inbox
  pipeline/page.tsx                  ← implement kanban
  analytics/page.tsx                 ← implement charts
  sequences/page.tsx                 ← implement sequence list
  components/app-shell.tsx           ← sidebar + nav shell

components/ui/                       ← shadcn/ui component library
```
