# LeadGenAI — v1.0 Architecture (Beyond MVP)

**Version:** v1.0 (full workflow)
**Status:** Re-architecture from v0.5; this round builds the foundational layer
**Audience:** Founder, future engineering hires, design-partner agencies

> **Change log:**
> - v0.1–v0.4 — successive scope iterations, see ARCHITECTURE.md
> - v0.5 (shipped) — chat-first MVP: discover → enrich → draft → export
> - **v1.0 (this doc)** — closed-loop AI workflow: discover → enrich → draft → SEQUENCE → SEND → TRACK → CLASSIFY → ROUTE → ITERATE → LEARN

---

## 1. The gap v0.5 → v1.0

v0.5 is a *research-and-draft* tool. The user finds prospects, gets emails drafted, copies them to Gmail/Lemlist/whatever, and comes back to start over. That's useful — replaceable manual research is real value — but it's not a workflow product.

A real workflow lead generator closes the loop. It owns every step from "I want more pipeline" to "Sales rep has a meeting on the calendar." Nine specific gaps make v0.5 a tool rather than a workflow:

1. **The workflow isn't closed.** No send leg. No reply detection. No follow-up.
2. **No intent signals.** User has to know who to research. The system should *suggest*.
3. **No team workflows.** Agencies (the revenue tier) need shared candidate pools, assignment, queues.
4. **No reply intelligence.** A reply lands → today, nothing happens.
5. **No sequence builder.** Single-touch emails get sub-2% replies. 3-5 touches gets 5-15%.
6. **No deliverability hygiene.** Warm-up curves, bounce monitoring, DMARC/SPF/DKIM checks.
7. **No analytics layer.** Reply rate by ICP / voice / sequence step is invisible.
8. **No proprietary data.** Everything's a free public source + LLM. No moat accumulates.
9. **No background autonomy.** Reactive only. A workflow product runs while the user sleeps.

This document specs how each gap closes.

---

## 2. The ten-stage workflow

```
[Discover] → [Enrich] → [Draft] → [Sequence] → [Send]
                                                  ↓
                          [Iterate] ← [Route] ← [Classify] ← [Track]
                                ↓
                          [Learn]  (proprietary cache grows)
```

| Stage | v0.5 | v1.0 |
|---|---|---|
| **Discover** | Brave / GitHub / HN / CSV / named | + intent triggers (funding, hires, posts) |
| **Enrich** | Pattern-guessed emails (risky) | + SMTP probe (risky → valid); + cache-as-moat |
| **Draft** | Voice-anchored single email | + A/B variants; eval harness; persona-typed |
| **Sequence** | — | Multi-step cadence (D0 email → D3 LinkedIn → D7 followup) |
| **Send** | — | Gmail OAuth; warm-up curve; suppression list; per-mailbox cap |
| **Track** | — | Reply detection (poll or Pub/Sub); bounce tracking; open pixel (optional) |
| **Classify** | — | Claude-classified: interested / objection / OOO / unsub |
| **Route** | — | Human-review inbox for high-signal; auto-suppress unsubs |
| **Iterate** | — | Funnel analytics by ICP / voice / step / time |
| **Learn** | scrape_cache exists, unused as asset | Per-vertical contact graph; reusable enrichments |

---

## 3. Architecture additions

### 3.1 New tables (migration 0002, 0003, 0004)

```sql
-- 0002_sequences.sql
create table sequences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references sequences(id) on delete cascade,
  step_order int not null,
  day_offset int not null default 0,           -- D0, D3, D7, etc
  channel text not null check (channel in ('email','linkedin_dm','task')),
  subject_template text,
  body_template text,
  created_at timestamptz not null default now()
);

create table sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references sequences(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  current_step int not null default 0,
  status text not null default 'active'
    check (status in ('active','paused','completed','replied','bounced','unsubscribed'))
);

-- 0003_intent.sql
create table intent_triggers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  trigger_type text not null check (trigger_type in (
    'funding','hiring','job_change','product_launch','press_mention',
    'github_star_spike','hn_post','tech_change'
  )),
  account_name text,
  account_domain text,
  payload jsonb not null,
  source_url text,
  surfaced boolean not null default false,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on intent_triggers(user_id, occurred_at desc);

-- 0004_sending.sql (deferred to round 9 — gates the send leg)
-- See SENDING_AGENT.md for full schema; tables: mailboxes,
-- campaigns, campaign_recipients, email_events, suppressions.
```

### 3.2 New chat tools

Add to `lib/agent/tools.ts`:

```typescript
create_sequence: tool({
  description: "Create a multi-step outreach sequence (e.g. D0 email, D3 LinkedIn DM, D7 followup email).",
  inputSchema: z.object({
    name: z.string(),
    steps: z.array(z.object({
      day_offset: z.number().int().min(0).max(60),
      channel: z.enum(["email","linkedin_dm","task"]),
      subject_template: z.string().optional(),
      body_template: z.string(),
    })).min(1).max(7),
  }),
  execute: ...
}),

enroll_in_sequence: tool({
  description: "Enroll one or more prospects in an existing sequence.",
  inputSchema: z.object({
    sequence_id: z.string().uuid(),
    prospect_ids: z.array(z.string().uuid()).min(1),
  }),
  execute: ...
}),

scan_intent_triggers: tool({
  description: "Surface recent intent triggers (funding, hires, etc) for the user's tracked ICPs.",
  inputSchema: z.object({
    trigger_types: z.array(z.string()).optional(),
    since_hours: z.number().int().min(1).max(720).default(168),
  }),
  execute: ...
}),
```

### 3.3 New routes

```
app/
├── (app)/
│   ├── sequences/
│   │   ├── page.tsx                 — list all sequences
│   │   ├── new/page.tsx             — visual builder
│   │   └── [id]/page.tsx            — detail + enrollments
│   ├── intent/
│   │   └── page.tsx                 — trigger feed
│   ├── analytics/
│   │   └── page.tsx                 — funnel + segment metrics
│   ├── inbox/                       — (v1.1) classified replies
│   │   └── page.tsx
│   └── pipeline/                    — (v1.1) kanban by stage
│       └── page.tsx
└── api/
    ├── cron/
    │   ├── poll-intent/route.ts     — daily intent scrape
    │   ├── reset-credits/route.ts   — monthly reset cron
    │   └── send-due/route.ts        — (v1.1) scheduled-send cron
    └── webhooks/
        └── gmail-push/route.ts      — (v1.1) reply pubsub
```

### 3.4 Eval harness

`tests/evals/golden.ts` — 8 hand-picked prospect inputs + qualitative expectations (e.g. "must not open with 'I noticed'", "subject ≤ 50 chars", "must reference at least one specific fact"). A grader script runs each through `draftForProspect`, scores against the rules, fails CI if regression. Run as part of `npm test`.

---

## 4. Background autonomy

The product needs a *daemon mode*: things happening while the user isn't typing.

| Job | Cadence | Implementation |
|---|---|---|
| `poll-intent` | Hourly (per user) | Vercel Cron → POST /api/cron/poll-intent → scan public sources for tracked keywords, write `intent_triggers` |
| `reset-credits` | Daily | Vercel Cron → bulk-update users whose `credits_reset_at < now()` |
| `send-due` (v1.1) | Every 15 min | Iterate `campaign_recipients` whose `scheduled_for <= now()`, send via Gmail API, respecting per-mailbox daily cap |
| `detect-replies` (v1.1) | Every 10 min | Poll Gmail inbox for replies to sent messages, or process Gmail Pub/Sub push |
| `classify-replies` (v1.1) | Per reply | Claude classifies into interested / objection / OOO / unsub; auto-action or route to inbox |

For v1.0 we ship the first two as Vercel Cron functions. The send-side jobs (4 and 5) come in round 9 when Gmail OAuth integration is wired.

---

## 5. Proprietary data — the moat

`scrape_cache` already accumulates every Brave search, every GitHub profile, every company-page hit. In v1.0 we turn it from passive cost-saver into active asset:

1. **Dedupe by canonical key** — every cached prospect normalizes to `(name, company_domain)` so two different searches that surface the same person consolidate.
2. **Verified upgrades** — when a pattern-guessed email gets confirmed (a reply lands, or SMTP probe says 'valid'), upgrade the cached confidence. Over time the cache becomes a graph of verified contacts.
3. **Cross-user reuse** — opt-in setting per user: "let other LeadGenAI users benefit from the cache, anonymized." This is the path from $0.03/prospect to ~$0/prospect at scale, and from rented data (Brave) to owned data.
4. **Vertical depth** — track which ICPs hit the cache often; the most-queried vertical (likely Indian SaaS founders) gets curated manually and becomes the v3 "Apollo for India" wedge from the original PRD.

The economics matter: at 5000 prospects/mo cached with 30% hit rate after 3 months, marginal cost drops ~25%. After a year, cache hit rate stabilizes at 60-70% in the depth vertical.

---

## 6. Quality safety net

LLM-in-the-loop products silently regress when prompts drift or upstream models change. v1.0 adds three safety nets:

1. **Eval harness** (this round) — 8 golden prospects + heuristic checks (banned phrases, length bounds, structure). Runs on every CI build. Fails the build on regression.
2. **LLM-as-judge** (v1.1) — Claude scores each draft for "would a real salesperson send this?" on a 1-5 scale. Weekly mean must stay > 4.0 against the golden set.
3. **Production sampling** — random 1% of real drafts get scored post-send. Trend dashboard surfaces drift in real time.

A prompt regression in production is the worst kind of outage — invisible until users churn. These three layers catch it before users do.

---

## 7. What v1.0 ships (this round)

- Architecture doc (this file)
- `sequences`, `sequence_steps`, `sequence_enrollments`, `intent_triggers` schema (migration 0002 + 0003)
- `/app/sequences` list + builder (data-model only; no send yet)
- `/app/intent` trigger feed
- `/app/analytics` read-only dashboard
- Eval harness with 8 golden prospects + heuristic grader, wired into `npm test`
- `POST /api/cron/poll-intent` endpoint (Vercel Cron-compatible)

## 8. What v1.1 ships (round 9)

- Gmail OAuth + mailbox warm-up
- `send-due` cron with throttling + per-mailbox cap
- Reply detection (polling first; Pub/Sub push later)
- Reply classifier (Claude)
- `/app/inbox` for human-routed replies
- `/app/pipeline` kanban
- Suppression list

## 9. What v1.2 ships (round 10)

- LinkedIn DM integration (via user's session cookie + a tasteful rate limit)
- HubSpot + Zoho push (one-click)
- Multi-seat team plans + assignment
- Stripe/Razorpay billing with plan-based credit grants

## 10. What's still v2+

- WhatsApp Business API (BSP onboarding is 4-6 weeks alone)
- Proprietary contact database with verified emails
- Chrome extension (single-page enrichment from any LinkedIn profile)
- A/B test framework for subject lines + bodies
- Mobile app (still 0% of value — defer indefinitely)

---

## 11. Cost re-estimate at v1.0 scale

Per-prospect costs are unchanged (~$0.03). The new spend categories:

- **Gmail send**: $0 (uses user's own Gmail quota, generous for cold outreach)
- **Pub/Sub push**: ~$0.10 per 10,000 messages — negligible
- **Vercel cron**: free tier covers 100 daily jobs across all users
- **Storage**: dominant cost as cache grows; ~$10/mo per 10GB on Supabase Pro

At 100 active users × 200 prospects/mo × ~$0.03 → **$600/mo Anthropic**. Revenue at $35 avg → $3,500/mo → 83% gross margin even before cache hit-rate kicks in. Healthy.

---

## 12. Risk re-assessment

The new risks v1.0 introduces over v0.5:

| New risk | Severity | Mitigation |
|---|---|---|
| Gmail OAuth complexity (multi-user, refresh-token handling, scope changes) | Medium | Use Google's reference client; encrypt tokens at rest with pgsodium; refresh proactively |
| User's domain reputation tanked by our send patterns | **High** | Warm-up curve hard-coded; bounce-rate auto-pause at 5%; explicit "use a dedicated outbound mailbox" guidance |
| Reply classifier mistakenly auto-acts on a reply | High | Conservative thresholds; require explicit user confirmation for any auto-reply; log every action |
| Intent triggers create noise (too many false positives) | Medium | User confirms before any outreach; rank triggers by signal strength; learn from user's accept/reject |
| LinkedIn cookie-based DMs detected → account banned | High | Don't ship until v1.2 and only if there's a way to do it safely; default position: stay defensive |
| Compliance (DPDP / CAN-SPAM / GDPR) on full sending leg | **High** | Required unsubscribe in every email; physical address; lawful-basis attestation per sequence; 90-day audit log |
| Cache becomes a privacy liability | Medium | Anonymize cross-user cache shares; honor right-to-be-forgotten requests; opt-in only |

---

## 13. The product positioning shifts

v0.5 positions as "AI prospecting copilot — finds leads and drafts emails." That's a feature.

v1.0 positions as "AI workflow lead generator for SMB sales teams in India + SEA." That's a category. Closer to Apollo/Outreach/Lemlist but India-first, AI-native, and Sheets-friendly. The wedge changes from "I need help researching" to "Let me hand off my entire outbound workflow."

This unlocks the agency tier from the original PRD — agencies don't want a research tool, they want to charge clients for managed outbound and need the platform to run it.

---

*End of ARCHITECTURE_V1.md. Round 8 of build = sections 7 + eval harness. Round 9 = section 8.*
