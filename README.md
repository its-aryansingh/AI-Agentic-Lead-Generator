# LeadGenAI 🚀

> AI-powered prospect research tool for SMB sales teams in India and Southeast Asia.

## What is this?

LeadGenAI takes a natural language request like _"find me 50 heads of marketing at fintech startups in Singapore"_ and returns enriched contact data, AI-generated research notes, and personalized cold email drafts — all delivered to a Google Sheet.

It's not a database product like Apollo. It's a **workflow product** that uses AI to make outbound prospecting 10x faster.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14 (App Router) + Tailwind CSS + shadcn/ui |
| Backend | Next.js API Routes + Inngest (job queue) |
| Database | Supabase (Postgres + Auth) |
| AI | Anthropic Claude (Sonnet + Haiku) |
| Discovery | Brave Search API + DuckDuckGo |
| Scraping | Playwright on Fly.io |
| Output | Google Sheets API + CSV |
| Payments | Razorpay (India) + Stripe (International) |

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- Supabase account (free tier)
- Anthropic API key

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/your-username/ai-lead-gen.git
cd ai-lead-gen

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env.local
# Fill in your API keys in .env.local

# 4. Run database migrations
# (Instructions in supabase/migrations/README.md)

# 5. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## Project Structure

```
├── app/                    # Next.js App Router pages
│   ├── (marketing)/        # Public landing page, pricing
│   ├── (app)/              # Auth-gated app (chat, jobs, settings)
│   └── api/                # API routes
├── components/             # Reusable UI components
├── lib/                    # Business logic, providers, utilities
│   ├── agent/              # AI agent (system prompt, tools)
│   ├── providers/          # External API clients
│   └── prompts/            # Claude prompt templates
├── inngest/                # Background job functions
├── scraper/                # Fly.io scraper service (separate deploy)
├── supabase/               # Database migrations
├── docs/                   # PRD, Architecture docs
└── plan.md                 # Multi-agent coordination file
```

## Multi-Agent Coordination

This project uses a `plan.md` file at the root as a **single source of truth** for all contributors (human or AI). Read it before making any changes.

## Docs

- [PRD](./docs/PRD.md) — Product Requirements Document
- [Architecture](./docs/ARCHITECTURE.md) — System architecture (v0.4)
- [Sending Agent](./docs/SENDING_AGENT.md) — v2 email sending spec (deferred)

## License

Private — All rights reserved.
