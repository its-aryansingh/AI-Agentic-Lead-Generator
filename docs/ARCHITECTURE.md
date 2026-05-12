# System Architecture — Conversational AI Lead-Gen Agent

**Version:** v0.4 (free scraping pipeline)
**Status:** Pre-build, production target
**Audience:** Solo founder (you), future engineering hires

> **Change log:**
> - v0.1 — Paste-LinkedIn-URL enrichment tool
> - v0.2 — Chat-first redesign with Apollo discovery + CSV input
> - v0.3 — Apollo swapped for Proxycurl
> - **v0.4 (current)** — All paid data APIs removed. Discovery via free search APIs (Brave + DuckDuckGo). Enrichment via self-hosted Playwright scrapers on Fly.io. Email finding via on-page extraction + pattern guessing + free SMTP verification. Only recurring cost is Anthropic LLM + ~$5/mo Fly.io. Timeline: 12-13 weeks solo.

---

## 1. The mental model in one paragraph

A user opens a chat box and either (a) types a natural-language request like *"find me 50 heads of marketing at fintech startups in Singapore"*, (b) names a specific person — *"research Priya Sharma at Razorpay"*, or (c) drops a CSV of contacts into the chat. The message streams to a Claude agent that has six tools. Claude picks one (or chains several), confirms scope with the user, then either calls a free search API (Brave/DuckDuckGo) to find candidates, ingests a CSV, or dispatches Playwright scraping jobs to a worker fleet running on Fly.io. The scraping workers visit company websites (looking for `/team`, `/about`, `/contact` pages to extract emails), pull recent news/blog content for personalization, and parse search-result snippets for prospect metadata. Everything is cached aggressively in Postgres. For bulk jobs, results flow through the async Inngest pipeline and land in a Google Sheet; for single-prospect requests, results stream inline in chat.

**No paid data APIs.** The only recurring marginal cost is Anthropic LLM calls (~$0.03/prospect) and ~$5/mo of Fly.io infra.

**Sending is not in v1.** v2 spec lives in `SENDING_AGENT.md`.

---

## 2. Stack — full and defended

| Component | Choice | Why |
|---|---|---|
| Web framework | **Next.js 14 (App Router)** | One framework for UI + API. RSC + Server Actions cut boilerplate. |
| Hosting (web) | **Vercel** | Free tier handles v1. Chat streaming via SSE works natively. |
| Database | **Supabase Postgres** | Auth + DB + Storage in one. Free tier = 500MB + 50k MAU. |
| Auth | **Supabase Auth (Google OAuth)** | One provider; OAuth refresh token storage. |
| Queue / workflow | **Inngest** | Step-functions with retries, fan-out, concurrency, idempotency. |
| Chat streaming | **Vercel AI SDK** | SSE + tool-call rendering + UI message state. ~2 days saved. |
| LLM | **Anthropic Claude (Sonnet 4.6 + Haiku 4.5)** | Sonnet for orchestration + email drafting; Haiku for cheap research summaries. |
| Discovery / Search | **Brave Search API** (primary, 2000 free/mo), **DuckDuckGo** (fallback, unlimited) | LLM uses these to find candidate names + company info from public search results. |
| Public-source APIs | **GitHub** (free), **Product Hunt** (free), **HN Algolia** (free) | Vertical-specific candidate discovery — strong for SaaS/tech ICPs in India. |
| Scraping runtime | **Playwright + stealth on Fly.io** | Headless Chromium with anti-detect plugins. Fly.io free tier = 3 small VMs. |
| Content scraping | **Firecrawl OSS (self-host) + custom Playwright** | Firecrawl for clean markdown extraction from news/blog pages; custom Playwright for /team /contact pages. |
| Email verification | **In-house SMTP probe + DNS MX lookup** | Connect to recipient's MX server, ask if address exists. Free. ~70% accuracy. |
| Output | **Google Sheets API** | User-OAuth'd, `drive.file` scope. |
| Payments | **Razorpay (India) + Stripe (rest)** | INR-friendly + global. |
| Observability | **PostHog + Sentry** | Free tiers cover v1. |
| Transactional email | **Resend** | Cheap, good DX. |

**Cost summary at v1 scale (50 active users, 100 prospects/user/mo):**
- Vercel: $0 (free tier)
- Supabase: $0 (free tier)
- Inngest: $0 (free tier)
- Fly.io scraper VMs: $0-5/mo
- Brave Search: $0 (2000 free, refreshes monthly)
- Anthropic: ~$150/mo (5000 prospects × ~$0.03)
- Resend: $0 (free tier)
- **Total marginal: ~$150-160/mo for 50 users.** Revenue at $17 avg = $850. Margin healthy.

---

## 3. Repo layout

```
ai-lead-gen/
├── app/
│   ├── (marketing)/                  # public site
│   │   ├── page.tsx                  # landing
│   │   └── pricing/page.tsx
│   ├── (app)/                        # auth-gated
│   │   ├── layout.tsx
│   │   ├── chat/
│   │   │   ├── page.tsx              # main chat surface
│   │   │   ├── [sessionId]/page.tsx  # resume session
│   │   │   └── components/
│   │   │       ├── message-list.tsx
│   │   │       ├── tool-call-renderer.tsx
│   │   │       ├── candidate-preview.tsx
│   │   │       ├── cost-confirm-gate.tsx
│   │   │       └── csv-drop-zone.tsx
│   │   ├── jobs/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   └── settings/
│   │       ├── account/page.tsx
│   │       ├── voice/page.tsx        # AI voice anchor
│   │       └── billing/page.tsx
│   ├── api/
│   │   ├── auth/callback/route.ts
│   │   ├── chat/route.ts             # streaming chat endpoint
│   │   ├── jobs/[id]/route.ts
│   │   ├── upload/route.ts           # CSV upload
│   │   ├── inngest/route.ts
│   │   ├── stripe/webhook/route.ts
│   │   └── razorpay/webhook/route.ts
├── inngest/
│   ├── client.ts
│   └── functions/
│       ├── process-job.ts            # fan-out
│       ├── enrich-prospect.ts        # per-prospect: dispatches scrape tasks
│       ├── scrape-company-site.ts    # calls Fly.io worker
│       ├── scrape-news.ts
│       └── finalize-job.ts           # writes Sheet
├── lib/
│   ├── supabase/{server,client}.ts
│   ├── providers/
│   │   ├── brave-search.ts
│   │   ├── duckduckgo.ts
│   │   ├── github.ts
│   │   ├── producthunt.ts
│   │   ├── hn-algolia.ts
│   │   ├── firecrawl.ts
│   │   ├── anthropic.ts
│   │   ├── google-sheets.ts
│   │   ├── resend.ts
│   │   └── scraper-client.ts         # HTTP client to Fly.io worker
│   ├── agent/
│   │   ├── system-prompt.ts
│   │   ├── tools.ts
│   │   └── tool-handlers.ts
│   ├── prompts/
│   │   ├── research.ts
│   │   ├── email.ts
│   │   └── examples.ts
│   ├── email-verify.ts               # SMTP probe + MX lookup
│   ├── email-patterns.ts             # {first}.{last}@domain guessing
│   ├── credits.ts
│   ├── cache.ts
│   ├── billing.ts
│   └── auth.ts
├── components/ui/                    # shadcn
├── supabase/migrations/              # 0001_init.sql, etc.
├── scraper/                          # SEPARATE deployable for Fly.io
│   ├── Dockerfile
│   ├── fly.toml
│   ├── package.json
│   ├── src/
│   │   ├── server.ts                 # Fastify HTTP server
│   │   ├── handlers/
│   │   │   ├── company-site.ts       # /scrape/company
│   │   │   ├── news.ts               # /scrape/news
│   │   │   └── health.ts
│   │   ├── playwright/
│   │   │   ├── browser-pool.ts       # warm browser instances
│   │   │   ├── stealth-setup.ts      # anti-detect plugins
│   │   │   └── helpers.ts
│   │   └── extractors/
│   │       ├── emails.ts             # regex + LLM hybrid
│   │       ├── team-page.ts          # find names/titles
│   │       └── news-articles.ts
│   └── tests/
├── tests/
│   ├── e2e/
│   ├── prompts/                      # AI eval harness
│   └── scraper/                      # scraper extraction tests
├── .env.example
├── middleware.ts
└── package.json
```

**Two deployables.** The Next.js app deploys to Vercel. The `scraper/` subdirectory deploys independently to Fly.io. They communicate over HTTP (the Next.js Inngest workers POST to the scraper's endpoints with auth headers).

---

## 4. Database schema (production-grade)

```sql
-- 0001_init.sql

create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  google_refresh_token text,
  plan text not null default 'free',
  credits_remaining int not null default 25,
  credits_reset_at timestamptz not null default (now() + interval '30 days'),
  voice_anchor_text text,
  created_at timestamptz not null default now()
);

create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index on chat_sessions(user_id, last_message_at desc);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool')),
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index on chat_messages(session_id, created_at);

create table prospect_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  source text not null check (source in ('brave','duckduckgo','github','producthunt','hn','csv','named')),
  source_ref text,                    -- URL or external ID
  preview jsonb not null,             -- name, title, company, snippet
  selected boolean default false,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);
create index on prospect_candidates(session_id);

create table csv_uploads (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  row_count int,
  column_headers jsonb,
  status text not null default 'staged',
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  source_session_id uuid references chat_sessions(id),
  input_source text default 'chat' check (input_source in ('chat_search','chat_enrich','csv_upload')),
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','cancelled')),
  prospect_count int not null,
  sheet_url text,
  error_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on jobs(user_id, created_at desc);

create table prospects (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  -- input
  input_source text not null,         -- 'search', 'csv', 'named'
  input_name text,
  input_company text,
  input_linkedin_url text,
  -- enrichment
  status text not null default 'pending' check (status in ('pending','enriching','researching','drafting','completed','failed')),
  company_domain text,
  company_data jsonb,                 -- scraped from company site
  recent_news jsonb,                  -- scraped news mentions
  email text,
  email_source text check (email_source in ('extracted','pattern_guessed','none')),
  email_confidence text check (email_confidence in ('valid','risky','invalid','unknown')),
  -- AI outputs
  research_summary text,
  email_subject text,
  email_body text,
  talking_points jsonb,
  -- meta
  error_reason text,
  cost_cents int default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on prospects(job_id);
create index on prospects(status);

-- Scrape cache (the most important table for unit economics)
create table scrape_cache (
  cache_key text primary key,         -- sha256(scrape_type + normalized_url)
  scrape_type text not null,          -- 'company_site' | 'news' | 'search'
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index on scrape_cache(expires_at);

-- Credit ledger
create table credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  delta int not null,
  reason text not null,
  job_id uuid references jobs(id),
  created_at timestamptz not null default now()
);

-- Webhook idempotency
create table webhook_events (
  id text primary key,
  provider text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

-- RLS
alter table users enable row level security;
alter table jobs enable row level security;
alter table prospects enable row level security;
alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;
alter table prospect_candidates enable row level security;

create policy "own user row" on users for select using (auth.uid() = id);
create policy "own jobs" on jobs for select using (auth.uid() = user_id);
create policy "own prospects" on prospects for select
  using (exists (select 1 from jobs j where j.id = prospects.job_id and j.user_id = auth.uid()));
create policy "own sessions" on chat_sessions for select using (auth.uid() = user_id);
```

---

## 5. The chat agent — six tools

```typescript
// lib/agent/tools.ts

import { tool } from "ai";
import { z } from "zod";

export const tools = {

  // 1. Discovery via free search APIs
  web_search: tool({
    description: "Search the public web (Brave or DuckDuckGo) for prospects matching the user's ICP. Returns names, titles, companies, and source URLs. Use for 'find me X' style requests. Always preview the search query to the user before running.",
    parameters: z.object({
      query: z.string().describe("Search query, e.g. 'head of marketing fintech startup India site:linkedin.com'"),
      target_role: z.string().optional(),
      industry: z.string().optional(),
      location: z.string().optional(),
      max_results: z.number().min(5).max(50).default(20),
    }),
    execute: async (params, { sessionId, userId }) => {
      const candidates = await runSearchDiscovery(params);
      await persistCandidates({ sessionId, candidates });
      return { count: candidates.length, preview: candidates.slice(0, 10) };
    },
  }),

  // 2. Vertical-specific discovery via free public APIs
  public_source_search: tool({
    description: "Search vertical-specific public APIs (GitHub for developers, Product Hunt for makers, HN Algolia for founders). Use when the ICP fits these niches (especially Indian SaaS founders, tech CTOs, indie hackers).",
    parameters: z.object({
      source: z.enum(["github","producthunt","hn_algolia"]),
      query: z.string(),
      max_results: z.number().min(5).max(50).default(20),
    }),
    execute: async (params, { sessionId, userId }) => {
      const candidates = await runPublicSourceSearch(params);
      await persistCandidates({ sessionId, candidates });
      return { count: candidates.length, preview: candidates.slice(0, 10) };
    },
  }),

  // 3. Single-prospect enrichment (chat returns inline)
  enrich_prospect: tool({
    description: "Deeply enrich a single named prospect: scrape their company site for email + context, pull recent news, draft a personalized cold email. Returns within 20-40 seconds. Use for 'research X at Y' style requests.",
    parameters: z.object({
      name: z.string(),
      company: z.string().optional(),
      company_domain: z.string().optional(),
      linkedin_url: z.string().optional(),
    }),
    execute: async (params, { userId, sessionId }) => {
      return await enrichSingle({ ...params, sessionId, userId });
    },
  }),

  // 4. Clarification (no work, just ask)
  clarify_question: tool({
    description: "Ask the user a focused clarifying question when their request is too vague to act on. Use sparingly.",
    parameters: z.object({
      question: z.string(),
      suggested_answers: z.array(z.string()).optional(),
    }),
    execute: async (params) => ({ asked: params.question }),
  }),

  // 5. CSV import
  import_csv: tool({
    description: "Ingest a CSV file uploaded by the user. Inspect headers, preview rows, then commit to prospect_candidates. The user uploads via the chat dropzone; you get an upload_id.",
    parameters: z.object({
      upload_id: z.string().uuid(),
      column_mapping: z.object({
        name: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        email: z.string().optional(),
        company: z.string().optional(),
        title: z.string().optional(),
        linkedin_url: z.string().optional(),
        domain: z.string().optional(),
      }),
      skip_header_row: z.boolean().default(true),
      preview_only: z.boolean().default(false),
    }),
    execute: async (params, { sessionId, userId }) => {
      if (params.preview_only) return await previewCsvImport(params);
      const r = await importCsvToCandidates({ ...params, sessionId, userId });
      return { imported: r.count, duplicates_skipped: r.dupes, invalid_rows: r.invalid };
    },
  }),

  // 6. Commit to bulk enrichment + Sheet output
  start_bulk_job: tool({
    description: "Kick off bulk enrichment + email drafting for selected candidates. Output goes to Google Sheets. Only call after the user has explicitly confirmed scope and seen the candidate preview.",
    parameters: z.object({
      candidate_ids: z.array(z.string().uuid()).optional(),
      draft_email: z.boolean().default(true),
    }),
    execute: async (params, { sessionId, userId }) => {
      const job = await createJobFromCandidates({ sessionId, userId, ...params });
      return {
        job_id: job.id,
        prospect_count: job.prospect_count,
        estimated_minutes: Math.ceil(job.prospect_count / 3),  // scraping is slower than API
      };
    },
  }),
};
```

---

## 6. The Brave Search provider

```typescript
// lib/providers/brave-search.ts

const BRAVE_BASE = "https://api.search.brave.com/res/v1/web/search";

export async function braveSearch(query: string, count = 20) {
  const res = await fetch(`${BRAVE_BASE}?q=${encodeURIComponent(query)}&count=${count}&country=IN`, {
    headers: {
      "Accept": "application/json",
      "X-Subscription-Token": process.env.BRAVE_SEARCH_KEY!,
    },
  });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const data = await res.json();
  return data.web?.results ?? [];
}

export async function discoverViaBrave(params: SearchParams) {
  // 1. Have Claude formulate 2-3 search queries from the user's intent
  const queries = await formulateSearchQueries(params);

  // 2. Run them in parallel (cached)
  const allResults = await Promise.all(
    queries.map((q) => getOrSetCache(`brave:${q}`, 7 * 86400, () => braveSearch(q)))
  );

  // 3. Parse search results into candidate records
  // Search snippets typically read: "Priya Sharma - Head of Marketing at Razorpay | LinkedIn"
  // We extract name, title, company from snippets using LLM (Haiku is fine here)
  const candidates = await parseSearchResultsToCandidates(allResults.flat());

  // 4. Dedupe + return
  return dedupe(candidates);
}
```

DuckDuckGo is the fallback when Brave's 2000/mo runs out. DuckDuckGo's unofficial endpoint is rate-limited (~30 req/sec, no auth required); we use it via a thin Node client.

---

## 7. The scraper service (deployed separately to Fly.io)

### Dockerfile

```dockerfile
# scraper/Dockerfile
FROM mcr.microsoft.com/playwright:v1.45.0-jammy
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

### fly.toml

```toml
# scraper/fly.toml
app = "lead-gen-scraper"
primary_region = "sin"     # Singapore — closest to India/SEA users

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"     # stops when idle to save free hours
  auto_start_machines = true
  min_machines_running = 0
  max_machines_running = 3

[[vm]]
  memory = "1gb"
  cpu_kind = "shared"
  cpus = 1
```

Auto-stop saves Fly's free machine-hours; cold-start adds ~3s to first request after idle. Acceptable for our use case.

### The scraper HTTP server

```typescript
// scraper/src/server.ts
import Fastify from "fastify";
import { scrapeCompanySite } from "./handlers/company-site";
import { scrapeNews } from "./handlers/news";

const app = Fastify({ logger: true });

// Auth: every request must include a shared secret (HMAC of body would be better)
app.addHook("onRequest", async (req, reply) => {
  if (req.headers["x-scraper-key"] !== process.env.SCRAPER_KEY) {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

app.post("/scrape/company", async (req) => {
  return await scrapeCompanySite(req.body as any);
});

app.post("/scrape/news", async (req) => {
  return await scrapeNews(req.body as any);
});

app.get("/health", async () => ({ ok: true }));

app.listen({ port: 8080, host: "0.0.0.0" });
```

### Company site scraper

```typescript
// scraper/src/handlers/company-site.ts
import { chromium } from "playwright";

const TEAM_PATHS = ["/team", "/about/team", "/people", "/leadership", "/about", "/contact"];
const EMAIL_RX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export async function scrapeCompanySite({ domain, target_name }: { domain: string; target_name?: string }) {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (compatible; LeadGenBot/0.1; +https://yourdomain.com/bot)",
    viewport: { width: 1280, height: 800 },
  });

  try {
    const page = await ctx.newPage();
    const emails = new Set<string>();
    const namesToTitles: Record<string, string> = {};

    for (const path of TEAM_PATHS) {
      const url = `https://${domain}${path}`;
      try {
        const res = await page.goto(url, { timeout: 10_000, waitUntil: "domcontentloaded" });
        if (!res || res.status() >= 400) continue;

        // Wait briefly for JS-rendered content
        await page.waitForTimeout(1500);

        const html = await page.content();
        const found = html.match(EMAIL_RX) ?? [];
        found.forEach((e) => emails.add(e.toLowerCase()));

        // Extract team members (heuristic: look for <h2>/<h3> name + nearby title text)
        if (target_name) {
          const text = await page.innerText("body");
          if (text.toLowerCase().includes(target_name.toLowerCase())) {
            // Found the target — extract surrounding context
            namesToTitles[target_name] = extractTitleNear(text, target_name);
          }
        }
      } catch { /* page didn't exist; try next */ }
    }

    return {
      domain,
      emails: [...emails],
      matched_target: target_name ? namesToTitles[target_name] ?? null : null,
      scraped_at: new Date().toISOString(),
    };
  } finally {
    await browser.close();
  }
}
```

### Email pattern guessing (no scrape needed)

```typescript
// lib/email-patterns.ts
const PATTERNS = [
  (f: string, l: string) => `${f}.${l}`,           // priya.sharma
  (f: string, l: string) => `${f}${l}`,            // priyasharma
  (f: string, l: string) => `${f[0]}${l}`,         // psharma
  (f: string, l: string) => `${f}_${l}`,           // priya_sharma
  (f: string, l: string) => `${f}`,                 // priya
];

export function generateEmailCandidates(firstName: string, lastName: string, domain: string) {
  const f = firstName.toLowerCase();
  const l = lastName.toLowerCase();
  return PATTERNS.map((p) => `${p(f, l)}@${domain}`);
}
```

### SMTP verification (free)

```typescript
// lib/email-verify.ts
import dns from "node:dns/promises";
import net from "node:net";

export async function verifyEmail(email: string): Promise<"valid" | "invalid" | "unknown"> {
  const [, domain] = email.split("@");
  const mx = await dns.resolveMx(domain).catch(() => []);
  if (!mx.length) return "invalid";

  const top = mx.sort((a, b) => a.priority - b.priority)[0];
  const result = await smtpProbe(top.exchange, email).catch(() => "unknown");
  return result;
}

async function smtpProbe(mxHost: string, email: string): Promise<"valid" | "invalid" | "unknown"> {
  return new Promise((resolve) => {
    const sock = net.connect(25, mxHost);
    let stage = 0;
    sock.setTimeout(8000);
    sock.setEncoding("utf-8");
    sock.on("data", (d) => {
      const code = parseInt(d.slice(0, 3));
      if (stage === 0 && code === 220) { sock.write(`HELO check.local\r\n`); stage++; }
      else if (stage === 1 && code === 250) { sock.write(`MAIL FROM:<check@check.local>\r\n`); stage++; }
      else if (stage === 2 && code === 250) { sock.write(`RCPT TO:<${email}>\r\n`); stage++; }
      else if (stage === 3) {
        sock.write(`QUIT\r\n`); sock.end();
        resolve(code === 250 ? "valid" : code === 550 ? "invalid" : "unknown");
      }
    });
    sock.on("error", () => resolve("unknown"));
    sock.on("timeout", () => { sock.destroy(); resolve("unknown"); });
  });
}
```

Many providers (Google Workspace, Outlook 365) accept *every* address at the SMTP layer to defeat probes — so SMTP probe gives `unknown` for ~40% of business emails. That's the limit of free verification. Surface confidence honestly in the output Sheet.

---

## 8. The Inngest enrichment worker (now dispatches scrape jobs)

```typescript
// inngest/functions/enrich-prospect.ts

export const enrichProspect = inngest.createFunction(
  {
    id: "enrich-prospect",
    concurrency: { limit: 3, key: "event.data.jobId" },   // lower than v0.3 — scraping is slower
    retries: 2,
  },
  { event: "prospect/enrich" },
  async ({ event, step }) => {
    const { prospectId, jobId, userId, voiceAnchor } = event.data;
    const p = await loadProspect(prospectId);

    // 1. Determine company domain (from input, or derive from search snippet)
    const domain = await step.run("resolve-domain", async () => {
      return p.company_domain ?? (await resolveCompanyDomain(p.input_company));
    });

    // 2. Scrape company site for emails + team info (with cache)
    const companyScrape = await step.run("scrape-company", async () => {
      return await getOrSetCache(`company:${domain}`, 30 * 86400, () =>
        scraperClient.scrapeCompany({ domain, target_name: p.input_name })
      );
    });

    // 3. Resolve email: extracted > pattern-guessed > none
    const email = await step.run("resolve-email", async () => {
      const direct = matchEmailToName(companyScrape.emails, p.input_name);
      if (direct) return { email: direct, source: "extracted" };

      const guesses = generateEmailCandidates(p.firstName, p.lastName, domain);
      for (const guess of guesses) {
        const result = await verifyEmail(guess);
        if (result === "valid") return { email: guess, source: "pattern_guessed" };
      }
      return { email: null, source: "none" };
    });

    // 4. Scrape recent news for personalization
    const news = await step.run("scrape-news", async () => {
      return await getOrSetCache(`news:${domain}`, 7 * 86400, () =>
        scraperClient.scrapeNews({ domain, company_name: p.input_company })
      );
    });

    // 5. Persist enrichment
    await step.run("persist-enrichment", async () => {
      await supabaseAdmin.from("prospects").update({
        status: "researching",
        company_domain: domain,
        company_data: companyScrape,
        recent_news: news,
        email: email.email,
        email_source: email.source,
        email_confidence: email.email ? (email.source === "extracted" ? "valid" : "risky") : "unknown",
      }).eq("id", prospectId);
    });

    // 6. Claude Haiku: research summary
    const research = await step.run("claude-research", async () =>
      claudeResearch({ name: p.input_name, company: p.input_company, news, companyScrape })
    );

    // 7. Claude Sonnet: email + talking points
    const draft = await step.run("claude-email", async () =>
      claudeEmail({ name: p.input_name, company: p.input_company, research, voiceAnchor })
    );

    // 8. Finalize
    await step.run("finalize", async () => {
      await supabaseAdmin.from("prospects").update({
        status: "completed",
        research_summary: research,
        email_subject: draft.subject,
        email_body: draft.body,
        talking_points: draft.talkingPoints,
        cost_cents: 3,   // ~$0.03 per prospect (Claude only)
        completed_at: new Date().toISOString(),
      }).eq("id", prospectId);
    });

    return { prospectId, status: "completed" };
  },
);
```

The fan-out parent function and finalize-job function from v0.2 are unchanged.

---

## 9. Concurrency model

| Scope | Limit | Why |
|---|---|---|
| Per-user concurrent jobs | 1 | Prevent monopolization |
| Per-job concurrent prospects | 3 | Scraping is heavier than API; lower than v0.3 |
| Brave Search concurrent requests | 5 | Their published limit |
| Per-scraper-VM concurrent browsers | 2 | 1GB RAM holds 2 Chromium instances comfortably |
| Fly.io max VMs | 3 | Free tier; auto-scales 0-3 |
| Per-domain scrape rate | 1 req / 2 sec | Politeness — avoids IP bans |
| Claude concurrent requests | 50 | Anthropic rate limit |

---

## 10. Failure modes

| Failure | Behavior | User impact |
|---|---|---|
| Brave Search 429 | Fall back to DuckDuckGo | Slightly slower discovery |
| Scrape: company site returns 404 / no team page | `company_data: {emails: []}`, proceed to pattern-guess | Email confidence drops |
| Scrape: page blocked / Cloudflare challenge | Mark `failed`, retry once with fresh browser context | Some prospects fail |
| SMTP probe times out | `email_confidence: 'unknown'`, still ship email | User sees "risky" tag |
| Fly.io VM cold-start | First scrape adds 3-4s | Slight latency on first prospect |
| Fly.io all 3 VMs busy | Inngest queues; jobs wait | Job takes longer; no user-visible failure |
| DNS MX lookup fails | Email marked invalid | Prospect ships without email |
| Claude rate-limited | Inngest retries with backoff | Eventual success |
| Sheets quota | Retry with backoff up to 5x | Brief delay |

---

## 11. Cost model — per job and per user

**Per single prospect:**
| Step | Cost |
|---|---|
| Brave search (cached if repeat) | $0 (free tier) |
| Company site scrape | $0 (own infra) |
| News scrape | $0 (own infra) |
| Email verification (SMTP probe) | $0 |
| Claude Haiku research | $0.005 |
| Claude Sonnet email draft | $0.025 |
| **Total per prospect** | **~$0.03** |

**Per user / month (100 prospects/mo active user):**
- ~$3/mo in Claude
- Fly.io VM time: maybe $0.10/mo per active user (amortized across users)
- **~$3.10/mo marginal cost.** Starter at ₹999 ($12) = 75%+ gross margin. Healthy.

**Free tier reconsidered:** with $0.03/prospect, 25 free prospects = $0.75/free user. Sustainable even at high free-signup volume. Original PRD pricing of "Free 25/mo + Starter ₹999" actually *works* under this architecture, which it didn't under Apollo/Proxycurl.

---

## 12. Cache strategy (the most important file in the repo)

```typescript
// lib/cache.ts (unchanged interface; broader use)

export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cacheKey = sha256(key);
  const { data: hit } = await supabaseAdmin
    .from("scrape_cache")
    .select("payload,expires_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (hit && new Date(hit.expires_at) > new Date()) return hit.payload as T;
  const fresh = await fetcher();
  await supabaseAdmin.from("scrape_cache").upsert({
    cache_key: cacheKey,
    scrape_type: key.split(":")[0],
    payload: fresh,
    expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
  return fresh;
}
```

Cache TTLs:
- `company:<domain>` → 30 days (company sites change slowly)
- `news:<domain>` → 7 days (need fresher signals for personalization)
- `brave:<query>` → 7 days (search results shift)
- `smtp:<email>` → 14 days

**At a 30% cache hit rate after 3 months, marginal cost drops ~25% further.** And the cache becomes proprietary data — every search a user runs, every company scraped, builds toward your v3 owned-database.

---

## 13. Idempotency rules (unchanged from v0.2)

1. Every `step.run` is independently retryable.
2. Every Sheets create checks `jobs.sheet_url` first.
3. Every webhook insert is `ON CONFLICT DO NOTHING`.
4. Every credit deduction is wrapped in a transaction.
5. Tool calls have deterministic IDs that survive chat reconnects.

---

## 14. Observability

- **PostHog events:** `chat_session_started`, `tool_called` (with success/latency/cost), `confirmation_shown`, `candidates_previewed`, `bulk_job_started`, `bulk_job_completed`, `email_quality_thumb` (👍/👎 7 days post-send).
- **Sentry:** errors in chat API, Inngest workers, and scraper VMs. Tag by component.
- **Inngest dashboard:** live state of every job/step/retry.
- **Fly.io metrics:** scraper VM CPU/memory + request latency.

Most important single metric: **scrape success rate by source.** This is the leading indicator of whether scrapers are silently breaking. Alert when any source drops below 70%.

---

## 15. Risks (now scraping-centric)

| Risk | Severity | Mitigation |
|---|---|---|
| Scraper maintenance burden eats founder time | **High** | Build extraction tests with snapshot fixtures; alert on success-rate regressions; budget 4-8 hrs/month for repair work; don't promise users coverage you can't maintain |
| Quality lower than user expectations | **High** | Surface confidence explicitly in output; set expectations in onboarding ("~50-60% accuracy on contact info from public sources"); position as "research + drafting" not "find perfect emails" |
| Sites add Cloudflare / aggressive anti-bot | **Medium** | Use rotating user-agents; respect robots.txt; fall back to AI-extraction of search snippets when scraping fails; never hammer one domain |
| Free-tier API limits hit (Brave 2000/mo) | **Medium** | Cache aggressively; DuckDuckGo fallback; switch to paid Brave tier (~$5/mo) at 50+ active users |
| Legal challenge over scraping | **Medium** | Only scrape public pages, respect robots.txt + rate limits, identifying user-agent, no scraping of LinkedIn or sites that explicitly prohibit; add ToS clause where user attests permission for B2B research; consult Indian counsel before paid launch |
| AI emails feel generic (still the product risk) | **High** | Multi-step prompt; few-shot examples; voice anchor; Sonnet for email; weekly review of 20 random outputs |
| Solo founder scope creep | **High** | This is the 4th architecture version in one session — be aware of pattern; LOCK scope after this version |

---

## 16. Build sequence (12-13 weeks solo)

- **Week 1:** Project scaffolding — Next.js + Supabase + auth + Sheets OAuth end-to-end. Sign up for Brave Search, Anthropic, Fly.io. Test SMTP probe locally.
- **Week 2:** Chat UI with Vercel AI SDK; streaming Claude reply; persist sessions + messages.
- **Week 3:** Tool definitions skeleton; `clarify_question` + `enrich_prospect` (using stubbed scraper).
- **Week 4:** Scraper service skeleton — Dockerfile, Fly.io deploy, Playwright + Fastify. Company site scraper handler. Cache layer.
- **Week 5:** Email extraction + pattern guessing + SMTP probe. End-to-end single-prospect enrich working in chat.
- **Week 6:** Brave Search + DuckDuckGo provider + LLM result parser. `web_search` tool functional.
- **Week 7:** News scraper (Firecrawl OSS or custom). Public-source APIs (GitHub, ProductHunt, HN). `public_source_search` tool.
- **Week 8:** `start_bulk_job` + Inngest fan-out + Sheets writer. CSV upload + `import_csv` tool. First end-to-end bulk demo.
- **Week 9:** Slop-prevention pass — prompt engineering on test set of 50 hand-picked prospects. Voice anchor.
- **Week 10:** Billing (Razorpay + Stripe), credit gates, free-tier guardrails, observability instrumentation.
- **Week 11:** Closed beta — 5 design-partner agencies. Heavy iteration on whatever they break.
- **Week 12:** Polish: error states, empty states, mobile-responsive read view, onboarding.
- **Week 13:** Public launch (small): LinkedIn, ProductHunt, India SaaS communities.

Realistic spill: weeks 11-13 likely become weeks 12-14. Plan accordingly.

---

## 17. What's deliberately NOT in v1

- LinkedIn scraping (legal + maintenance burden — v1.5 if needed)
- Email sending / sequencer (see `SENDING_AGENT.md` for v2 spec)
- CRM push (v2)
- Chrome extension (v2)
- WhatsApp outreach (v3)
- Multi-language email drafting (v2)
- Team / multi-seat plans (v2)
- Intent signals (job changes, funding) — requires data infra (v3)
- Own contact database (v3)

---

## 18. Scope lock declaration

**This architecture is v0.4. Do not add features to v1 scope before the closed beta in week 11.** The pattern across the last four iterations has been steady scope expansion. Every addition has been individually reasonable; the cumulative impact is a build timeline that grew from 8 weeks → 13 weeks across one design session. Resist further expansion. Ship narrow, learn from real users, then decide what v1.5 looks like.

---

*End of ARCHITECTURE.md v0.4. Next deep-dive in queue: AI agent architecture (system prompt + slop prevention + eval harness).*
