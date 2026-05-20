# LeadGenAI

AI-powered prospecting copilot for B2B sales teams in India and Southeast Asia.

> Describe your ideal customer in plain English. LeadGenAI finds matching prospects, drafts a personalized first-touch email for each one, and drops the lot into a Google Sheet.

This repo is the **v0.5 MVP** — a mid-scope cut of the v0.4 architecture, optimized for rapid build and design-partner beta. Full product spec in [`docs/PRD.md`](./docs/PRD.md); current architecture in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md); v2 sending-agent spec (deferred) in [`docs/SENDING_AGENT.md`](./docs/SENDING_AGENT.md).

---

## What works today

- **Chat surface** at `/app/chat` — streaming Claude Sonnet 4.6 agent with five tools (`web_search`, `enrich_prospect`, `clarify_question`, `start_bulk_job`, `public_source_search` stub).
- **Bulk enrichment** — surface candidates → user confirms → AI drafts research summary + ≤60-word cold email + 3 talking points per prospect → export.
- **Outputs** — Google Sheets (user's Drive, scope `drive.file`) and direct CSV download.
- **Voice anchor** at `/app/settings/voice` — paste one of your own emails to match its register.
- **Job history** at `/app/jobs` with re-download links.
- **Google OAuth** sign-in via Supabase Auth (also captures Sheets scope upfront).

---

## Run it in five minutes (mock mode)

The app is designed to boot end-to-end without external accounts. Every paid provider has a deterministic mock fallback.

```bash
npm install
cp .env.local.example .env.local   # leave keys blank for mocks
npm run dev
```

Open <http://localhost:3000>. To actually sign in you need Supabase + Google OAuth wired (see below); once you're past auth, the rest of the product (chat, search, drafting, export) runs in mock mode out of the box. Real outputs are clearly tagged with a `demo data` badge so you can't confuse them with the real thing.

---

## Wire up real providers

Drop these into `.env.local` to flip mock → real:

| Variable | Unlocks | Get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Real Claude drafting (Sonnet 4.6 + Haiku 4.5) | <https://console.anthropic.com> |
| `BRAVE_SEARCH_KEY` | Real prospect discovery (2000 free queries/mo) | <https://search.brave.com/search/api> |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth + Sheets export | <https://console.cloud.google.com> |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Persistence + auth | <https://supabase.com> |

With all four sets configured the chat flow uses real APIs end-to-end at ~$0.03 per enriched prospect.

---

## Database

Schema lives in [`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql). Apply it once to a fresh Supabase project:

```bash
# via Supabase CLI
supabase db push

# or raw psql
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
```

Tables: `users`, `chat_sessions`, `chat_messages`, `prospect_candidates`, `jobs`, `prospects`, `scrape_cache`, `credit_transactions`, `webhook_events`. RLS is enabled on every user-data table; the service-role key bypasses it for trusted server contexts only.

---

## Architecture at a glance

```
app/
├── (marketing)/page.tsx             — landing page
├── login/page.tsx                   — Google OAuth
├── app/
│   ├── chat/page.tsx                — server entry
│   ├── chat/[sessionId]/page.tsx    — resume past chat
│   ├── chat/components/             — ChatClient + tool-call cards
│   ├── jobs/page.tsx                — history
│   └── settings/voice/page.tsx      — voice anchor
└── api/
    ├── chat/route.ts                — streaming AI SDK + 5 tools
    ├── auth/callback/route.ts       — OAuth exchange + users upsert
    └── export/
        ├── csv/route.ts             — RLS-scoped CSV stream
        └── sheets/route.ts          — push to Google Sheets

lib/
├── supabase/{client,server}.ts      — SSR + admin clients
├── providers/
│   ├── brave-search.ts              — real + mock discovery
│   ├── anthropic.ts                 — drafting + system prompt
│   └── google-sheets.ts             — sheet writer + CSV serializer
├── agent/
│   ├── system-prompt.ts             — slop prevention rules
│   ├── tools.ts                     — tool definitions
│   └── tool-handlers.ts             — concrete implementations
├── cache.ts                         — Postgres-backed getOrSet cache
└── utils.ts                         — cn, hasKey, hashIndex, sleep
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, RSC, Server Actions) |
| UI | Tailwind v4 + shadcn (`@base-ui/react`) |
| DB + Auth | Supabase Postgres + Supabase Auth (Google OAuth) |
| AI | Anthropic Claude — Sonnet 4.6 for drafting, Haiku 4.5 for cheap summaries |
| Discovery | Brave Search API (mock fallback when no key) |
| Output | Google Sheets API (`drive.file` scope) + CSV |
| Hosting | Vercel (free tier easily handles v1 scale) |

---

## What's NOT in v0.5 (deferred)

- Separate Fly.io scraper service
- Inngest queue / async bulk jobs (current path runs synchronously, fine up to ~20 prospects)
- SMTP email verification + pattern guessing
- Billing (Razorpay / Stripe)
- CSV upload flow
- Public-source search via GitHub / ProductHunt / HN Algolia
- Sending agent (Gmail integration) — separate v2 spec in [`docs/SENDING_AGENT.md`](./docs/SENDING_AGENT.md)

Why this cut? The v0.4 doc itself flagged scope creep growing the timeline 8 → 13 weeks. v0.5 keeps the chat-first wedge and the slop-prevention drafter intact while deferring everything that doesn't change the user's first-week experience.

---

## Scripts

```bash
npm run dev      # dev server with HMR
npm run build    # production build
npm run lint     # eslint
```

---

## License

Proprietary. © 2026 LeadGenAI.
