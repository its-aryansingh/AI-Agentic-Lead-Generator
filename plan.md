# LeadGenAI — Multi-Agent Coordination Plan

**Status**: Phase 1 — Project Foundation
**Last Updated**: 2026-05-12

This file serves as the **single source of truth** for all agents (human or AI) working on the LeadGenAI codebase. Before writing code, you must read this document to understand the project architecture, boundaries, and conventions.

## 1. Project Overview

LeadGenAI is a conversational AI lead-generation tool for SMB sales teams in India and Southeast Asia. 
- **Input**: Natural language ("find me 50 CMOs at fintech startups in India") or CSV upload.
- **Enrichment**: Free search APIs (Brave/DuckDuckGo), Playwright scrapers (Fly.io), SMTP verification. No paid Apollo/ZoomInfo data APIs.
- **Output**: Enriched prospect data, AI-drafted emails, and talking points pushed to a Google Sheet.

## 2. Architecture & Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14 (App Router), Tailwind CSS, shadcn/ui |
| Database/Auth | Supabase (Postgres) |
| Async Jobs | Inngest |
| AI | Anthropic Claude (Sonnet 4.6 for emails, Haiku for summaries) |
| Chat UI | Vercel AI SDK (React Server Components + SSE) |
| Scraping | Playwright headless via Fastify (deployed on Fly.io) |

## 3. Module Ownership Map

Different parts of the system are loosely coupled. Follow these boundaries:

- `app/(marketing)/*` — Public landing page, pricing. Must be statically renderable where possible.
- `app/(app)/*` — Authenticated dashboard.
- `app/api/chat/route.ts` — The core AI agent brain. Streams tool calls to the UI.
- `lib/agent/tools.ts` — Zod schemas and execution logic for the 6 core agent tools.
- `lib/providers/*` — Thin wrappers around external services (Brave, GitHub, Supabase, Google Sheets). **Do not put business logic here.**
- `inngest/functions/*` — Long-running background jobs. Use `step.run` for all stateful boundaries.
- `scraper/*` — A completely separate Node.js/Fastify microservice. Do not import `scraper/*` code into `app/*` or `lib/*`. Next.js talks to the scraper via HTTP.

## 4. Coding Conventions

1. **Server vs. Client**: Use React Server Components by default. Add `"use client"` only when you need hooks (`useState`, `useChat`) or browser APIs.
2. **Database Access**: 
   - UI layer: Read directly from Supabase via Server Components using RLS.
   - Background jobs: Use `supabaseAdmin` (Service Role Key) since Inngest runs out-of-band.
3. **Caching**: Use `getOrSetCache` from `lib/cache.ts` for all external scraping/search API calls. This is critical for unit economics.
4. **Styles**: Use Tailwind utility classes. Use the `cn()` utility for conditional classes. Avoid custom CSS unless absolutely necessary for complex animations.
5. **Types**: Favor `zod` for parsing and inferring types (`z.infer<typeof schema>`).

## 5. Commit Strategy

We follow a CSE undergrad project commit style.
- Keep commit messages entirely lowercase.
- Focus on describing *what* was done and *why*.
- Use multi-line commits to provide context.

## 6. Current Phase & Tasks

We are currently on **Phase 1: Project Foundation**.

- [x] Commit 1: Project scaffolding
- [ ] Commit 2: Add plan.md
- [ ] Commit 3: Setup Tailwind, shadcn/ui, and design system
- [ ] Commit 4: Supabase client setup and migrations

*(Update the task tracker in `task.md` alongside your work)*

---
**Agent Instruction**: If you are an AI reading this, acknowledge you have read the plan in your internal scratchpad, then proceed with your assigned task. Never remove this instruction block.
