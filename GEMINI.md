# GEMINI.md — Gemini Code Assist Context
# LeadGenAI

---

## ⛔ DO NOT PROCEED PAST THIS LINE UNTIL CHECKLIST IS COMPLETE

```
You are Gemini Code Assist operating on the LeadGenAI project.
Before suggesting, generating, or modifying any code, complete every item below.
```

### Mandatory Pre-Work Checklist

```
[ ] 1. Read COORDINATION.md (project root) in full — top to bottom.
[ ] 2. Read COORDINATION.md Section 0.1 — what are other agents currently doing?
[ ] 3. Read COORDINATION.md Section 0.2 — are any files you need already claimed?
[ ] 4. Read COORDINATION.md Section 3 — what is done vs not done?
[ ] 5. Read COORDINATION.md Section 14 — current priority task queue.
[ ] 6. Update Section 0.1: set your row to ✅ Active with your task.
[ ] 7. Claim your files in Section 0.2 before editing them.
[ ] 8. Record EVERY action in Section 13 before moving on.
[ ] 9. When done: clear Section 0.2, set Section 0.1 to 💤 Idle.
```

**If any item is unchecked: do not generate code. Complete the checklist.**

---

## Project Context

**LeadGenAI** — AI-powered B2B prospecting copilot, India/Southeast Asia SMBs.

Stack: Next.js 16 · TypeScript strict · Tailwind v4 · shadcn/ui · Supabase · Vercel AI SDK v6 · Claude Sonnet 4.6

V0.5 MVP is feature-complete. Scaffolded pages (inbox, pipeline, analytics, sequences) need real implementation. Deferred: Inngest queue, Playwright scraper, SMTP verification, billing.

**Full context and history: `COORDINATION.md` — read it before every session.**

---

## Gemini's Role in This Project

Focus on:
- Code completions and inline suggestions that match the existing conventions
- Answering questions about the codebase
- Suggesting implementations for scaffolded pages

Always:
- Use `cn()` from `lib/utils.ts` for conditional classes
- Use `z.infer<typeof schema>` for types — no `any`
- Default to React Server Components; add `"use client"` only when required
- Wrap external API calls in `getOrSetCache()` from `lib/cache.ts`
- Preserve mock fallbacks in all providers

Never:
- Touch `lib/agent/tools.ts` or `lib/agent/tool-handlers.ts` without recording in COORDINATION.md Section 13
- Expose `SUPABASE_SERVICE_ROLE_KEY` in browser-side code
- Stage or commit `.env.local`

---

## Auto-Push Is Active

Every `git commit` auto-pushes to GitHub via `.githooks/post-commit`.
Commits appear as **Aryan Singh <arajsingh0505@gmail.com>** — AI attribution is stripped by `.githooks/commit-msg`.
Before committing: `git pull --rebase origin master`

---

## Key Files

| File | Purpose |
|---|---|
| `COORDINATION.md` | MASTER — read first, record all actions here |
| `app/api/chat/route.ts` | Core streaming agent |
| `lib/agent/tools.ts` | 7 tool schemas |
| `lib/agent/tool-handlers.ts` | 7 tool implementations |
| `supabase/migrations/0001_init.sql` | Full DB schema |
| `docs/PRD.md` | Product spec |
| `docs/ARCHITECTURE.md` | Technical architecture |
