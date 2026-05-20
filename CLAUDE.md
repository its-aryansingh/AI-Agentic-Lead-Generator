# CLAUDE.md — Claude CLI Auto-Load Context
# LeadGenAI

---

## ⛔ DO NOT PROCEED PAST THIS LINE UNTIL CHECKLIST IS COMPLETE

```
You are Claude CLI operating on the LeadGenAI project.
Before writing a single line of code, running a single command,
or making a single decision, you MUST complete every item below.
This is not optional. This is not a suggestion.
```

### Mandatory Pre-Work Checklist

```
[ ] 1. Open and read COORDINATION.md in full — top to bottom.
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

## What This Project Is

LeadGenAI — Next.js 16 App Router, TypeScript strict, Tailwind v4 + shadcn/ui, Supabase, Claude Sonnet 4.6 via Vercel AI SDK v6. Users describe B2B prospects in chat → AI finds them via Brave Search → enriches each with cold email + talking points → exports to Google Sheets or CSV.

**v0.5 MVP is feature-complete.** Scaffolded pages (inbox, pipeline, analytics, sequences) need real implementation. Deferred: Inngest queue, Playwright scraper, SMTP verification, billing.

**Full context: `COORDINATION.md` — read it now if you haven't.**

---

## Claude CLI's Role in This Project

You own (primary responsibility):
- `lib/agent/` — tools, handlers, system prompt
- `app/api/` — all API routes including `/api/chat`
- `lib/providers/` — all external provider wrappers
- `lib/` — utilities, cache, credits, compliance
- `supabase/migrations/` — DB schema changes
- `COORDINATION.md` — keeping it accurate and up to date

Do NOT touch without coordination:
- `app/app/*` UI pages (Antigravity CLI owns these)
- `tests/` (Codex owns these)
- Any file another agent has claimed in Section 0.2

---

## Hard Rules (Non-Negotiable)

1. **Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser-side code.**
2. **Always preserve mock fallbacks.** Every provider must work without API keys.
3. **`getOrSetCache()`** from `lib/cache.ts` for ALL external API calls.
4. **Server Components by default.** `"use client"` only for `useState`/`useChat`/browser APIs.
5. **Zod for all parsing.** No `any` types. `z.infer<typeof schema>` for types.
6. **`cn()` from `lib/utils.ts`** for conditional classes. No inline `style={}`.
7. **`lib/agent/tools.ts` = schemas only.** Zero business logic there.
8. **Record every action in COORDINATION.md Section 13** before moving on.
9. **Check Section 0.2 before touching any file.** If claimed by another agent, stop.
10. **Update plan.md alongside every commit.**

## Auto-Push & Git Rules

- **Every `git commit` auto-pushes to GitHub** via `.githooks/post-commit`. Do NOT run `git push` manually.
- **Before committing**, run `git pull --rebase origin master` to get other agents' latest pushes.
- **Never add `Co-Authored-By`** in commit messages — the `commit-msg` hook strips it, but don't add it at all.
- **Never stage `.env.local`** — pre-commit hook will block the commit.
- **Commit author** is always `Aryan Singh <arajsingh0505@gmail.com>` — never change `user.name` or `user.email`.
- **GitHub MCP** is active in `.claude/settings.json`. Set `GITHUB_TOKEN` env var to use GitHub API tools (create PRs, read issues, etc.).

---

## Key Files

| File | Purpose |
|---|---|
| `COORDINATION.md` | MASTER — read first, update always |
| `app/api/chat/route.ts` | Core streaming agent endpoint |
| `lib/agent/tools.ts` | 7 tool Zod schemas + wrappers |
| `lib/agent/tool-handlers.ts` | 7 tool implementations |
| `lib/agent/system-prompt.ts` | Agent personality + anti-slop rules |
| `supabase/migrations/0001_init.sql` | Full DB schema |
| `plan.md` | Phase tracker |
| `docs/PRD.md` | Product spec |
| `docs/ARCHITECTURE.md` | Technical architecture |
| `docs/SENDING_AGENT.md` | V2 email-send spec (deferred) |

## Running

```bash
npm run dev    # http://localhost:3000
npm test
npm run lint
```
