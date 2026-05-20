# Antigravity CLI — Project Context
# LeadGenAI

---

## ⛔ DO NOT PROCEED PAST THIS LINE UNTIL CHECKLIST IS COMPLETE

```
You are Antigravity CLI operating on the LeadGenAI project.
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

## What This Project Is

LeadGenAI — AI-powered B2B prospecting copilot for India/Southeast Asia.
Stack: Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui + Supabase + Claude Sonnet 4.6 + Vercel AI SDK v6.

V0.5 MVP is feature-complete. Your primary job: implement the scaffolded pages (inbox, pipeline, analytics, sequences) with real UI and wire them to existing backend data.

**Full context: `COORDINATION.md` — read it now. It supersedes everything else.**

---

## Antigravity CLI's Role in This Project

You own (primary responsibility):
- `app/app/*` — all authenticated UI pages
- `components/ui/` — shadcn/ui components
- `hooks/` — React hooks

Do NOT touch without claiming in Section 0.2 and coordinating:
- `lib/agent/` — Claude CLI owns this
- `app/api/chat/route.ts` — Claude CLI owns this
- `lib/providers/` — Claude CLI owns this
- `supabase/migrations/` — Claude CLI owns this
- Any file another agent has claimed in Section 0.2

---

## Hard Rules (Non-Negotiable)

1. **Read COORDINATION.md Section 0 before touching any file.** Check claims.
2. **Use `cn()` from `lib/utils.ts`** for all conditional classes. No inline `style={}`.
3. **Use `@base-ui/react` (shadcn/ui) components.** No new UI libraries without Aryan approval.
4. **Server Components by default.** `"use client"` only when absolutely required.
5. **No DB writes from UI components.** Use Server Actions in `app/app/actions.ts`.
6. **Data reads via RLS-scoped Supabase client** in Server Components (not admin client).
7. **Run `npm run lint` before every commit.**
8. **Record every action in COORDINATION.md Section 13** before moving on.
9. **Update plan.md alongside every commit.**
10. **Update COORDINATION.md Section 3** when a scaffolded page becomes real.

## Auto-Push & Git Rules

- **Every `git commit` auto-pushes to GitHub** via `.githooks/post-commit`. Do NOT run `git push` manually.
- **Before committing**, run `git pull --rebase origin master` to get other agents' latest pushes first.
- **Never add AI attribution** in commit messages — the `commit-msg` hook strips it automatically.
- **Never stage `.env.local`** — the `pre-commit` hook will reject the commit.
- **Commit author** is always `Aryan Singh <arajsingh0505@gmail.com>`. Do not change git identity.
- The hooks live in `.githooks/` (committed to repo). If on a fresh clone: `git config core.hooksPath .githooks`.

---

## Your Priority Task Queue

Pull from the top. Full detail in COORDINATION.md Section 14.

1. **Inbox page** — `app/app/inbox/page.tsx`. Reply threads from DB. Spec: `docs/SENDING_AGENT.md`.
2. **Pipeline page** — `app/app/pipeline/page.tsx`. Kanban by `prospects.stage`.
3. **Analytics page** — `app/app/analytics/page.tsx`. Charts: emails/replies/credits.
4. **Sequences page** — `app/app/sequences/`. Step builder. Spec: `docs/SENDING_AGENT.md`.
5. **CSV upload UI** — `app/app/chat/components/chat-client.tsx`.

---

## Key Files for UI Work

```
app/app/
  chat/components/chat-client.tsx    ← main chat UI + tool cards
  inbox/page.tsx                     ← SCAFFOLDED — implement this
  pipeline/page.tsx                  ← SCAFFOLDED — implement this
  analytics/page.tsx                 ← SCAFFOLDED — implement this
  sequences/page.tsx                 ← SCAFFOLDED — implement this
  components/app-shell.tsx           ← sidebar + nav

components/ui/                       ← shadcn/ui library
lib/utils.ts                         ← cn() utility
lib/supabase/client.ts               ← browser Supabase (use client only)
lib/supabase/server.ts               ← server Supabase (server components only)
```

## Commands

```bash
npm run dev    # http://localhost:3000
npm run lint   # run before every commit
npm test
```
