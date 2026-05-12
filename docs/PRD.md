# PRD: AI Prospect Research Tool (Working title: TBD)

**Author:** Aryan Singh
**Date:** 2026-05-09
**Status:** v0.1 — Discovery complete, ready for build
**Audience:** Founder (you), future engineering hires, prospective agency channel partners

---

## 1. Executive Summary

We are building an **AI prospect-research tool for SMB sales teams in India and Southeast Asia**. The product takes a LinkedIn profile URL or company domain as input and returns enriched contact data, AI-generated research notes, a personalized outbound email draft, and conversation-starter talking points. Output is delivered to a Google Sheet (or CSV) so users can run it in batches over their existing prospecting workflow.

This is **not** a direct Apollo competitor in v1. Apollo is a database product; we are a workflow product. We sit on top of third-party data APIs and add an AI personalization layer that Apollo's bolted-on AI does not match. Long-term, after we validate willingness-to-pay and identify a sticky workflow, we layer our own data infrastructure underneath — turning into "Apollo for India/SEA + AI on top."

**v1 timeline:** 8–10 weeks, solo build.
**v1 success criterion:** One signed reseller/agency partner using the product with their SMB clients within 12 weeks of launch.

---

## 2. Why This, Why Now

Apollo, ZoomInfo, and Lusha dominate the developed-market lead gen space. Their data quality in India, Indonesia, Vietnam, the Philippines, and Bangladesh is materially worse than in the US/EU — incomplete profiles, stale job titles, missing emails. Yet SMBs in these markets are the fastest-growing segment of B2B SaaS buyers in 2026, and most still rely on manual LinkedIn prospecting + spreadsheets.

Three forces converge:

1. **AI personalization is now cheap.** Claude and GPT-4 can deliver per-prospect research at $0.02–0.05 a pop. Two years ago this required a human researcher.
2. **Apollo and ZoomInfo are upmarket-focused.** Their pricing ($99–500/seat/month) and data gaps make them a poor fit for Indian SMBs, who buy at $10–30/seat/month or as one-off services.
3. **India/SEA SMBs prefer Sheets over SaaS dashboards.** Forcing them into another tool is friction. Meeting them in their existing workflow (Google Sheets) is differentiation, not concession.

The wedge is therefore not "AI-native" alone — it is **"AI personalization + India/SEA data quality + Sheets-native workflow."** Each of those three is defensible; together they're hard to copy.

---

## 3. Target Customer (ICP)

**Primary ICP: SMB sales teams (1–50 reps) in India and Southeast Asia doing outbound prospecting.**

Concrete persona examples:
- **Priya, Co-founder & Sales Lead at a 20-person SaaS in Bangalore.** Sells HR software to mid-market Indian companies. Spends 3–4 hours/week prospecting on LinkedIn manually. Pays $0 for tools; uses Sheets, Gmail, and free LinkedIn.
- **Rahul, Agency Owner running a 6-person outbound-as-a-service shop in Pune.** Runs campaigns for 8 SaaS clients. Pays for one Apollo seat reluctantly; complains about Indian data quality. Would pay $200–400/month for a tool that lets him scale to 15 clients.
- **Tanvir, BDR at a 50-person fintech in Singapore.** Prospects across SEA. Has Apollo but uses it as a contact lookup; does AI personalization manually with ChatGPT.

Out of scope for v1: enterprise sales orgs, US/EU markets, recruiting/HR-tech use cases (similar tools but different buyer).

The agency segment (Rahul) is the most attractive v1 wedge because one agency = many SMB end-customers via reseller deals.

---

## 4. Job To Be Done

**Primary JTBD:** "When I have a list of LinkedIn profiles or company domains I want to outreach to, help me research each one and draft a personalized first-touch email so my reply rates go up without me spending an hour per lead."

Secondary JTBD (post-v1): "Help me find new leads matching my ICP."

The ordering matters. v1 helps users do their *existing* prospecting better. v2+ replaces parts of their prospecting funnel.

---

## 5. Product Scope by Version

### v1 (8–10 weeks, this PRD)

The simplest possible useful product. One workflow:

1. User uploads or pastes a list of LinkedIn URLs or company domains (CSV, Sheet link, or paste-in textarea).
2. System enriches each row using third-party APIs.
3. AI agent researches each prospect (recent posts, company news, role context).
4. AI drafts a personalized cold email (300 chars, one paragraph).
5. AI generates 3 talking points / icebreakers per prospect.
6. Output written to a new Google Sheet or downloadable CSV.

That's it. No dashboard, no in-app sequencer, no CRM, no Chrome extension.

### v2 (months 4–6, post-PMF signal)

- Chrome extension that runs the same enrichment on a single LinkedIn page
- Save lists, history, re-run on update
- HubSpot + Zoho CRM push (one-click)
- Email sequencer (multi-step, basic)
- Saved AI prompt templates (per-user "voice")

### v3 (months 6–12, post-revenue traction)

- Proprietary contact database (start with one vertical: Indian SaaS founders)
- Search & filter UI (Apollo-like)
- Intent signals: funding, hiring, job changes
- WhatsApp Business API integration for outreach (high-leverage in India/SEA)
- Team plans, role-based access, usage analytics

The point of staging v2/v3 is that each layer is only worth building if v1 produces revenue.

---

## 6. v1 Feature Specification

### 6.1 Input

- **Input modes:** (a) paste LinkedIn URLs or domains into a textarea (one per line, up to 100 in v1); (b) upload CSV; (c) paste a Google Sheet share-link with column mapping.
- **Validation:** strip whitespace, dedupe, validate URL/domain format, reject obvious garbage.
- **Limits:** v1 caps at 100 prospects per run. Users can run multiple jobs.

### 6.2 Enrichment

For each LinkedIn URL or domain, fetch:

- Person: name, current role, company, location, work history, top 3 recent posts (titles + dates), profile summary
- Company: name, domain, industry, size band, location, funding stage if available, top 3 recent news items, tech stack hints
- Email: best-guess work email + verification status (`valid`, `risky`, `invalid`, `unknown`)

Sources (recommended):
- **Proxycurl** for LinkedIn person + company data
- **Hunter.io** or **Snov.io** for email finder + verification
- **Anthropic Claude (Haiku for cost / Sonnet for quality)** for research synthesis and email drafting
- Optional: **Apollo API** as a fallback if a Proxycurl lookup misses

Costs per prospect (rough): $0.05–0.15 enrichment + $0.02–0.05 AI = **$0.08–0.20 per prospect.**

### 6.3 AI Research & Email Generation

The AI step uses a multi-step agent prompt:

1. **Summarize** the person's role, tenure, and recent activity in 2 sentences.
2. **Identify** a personalization hook from their recent posts, company news, or role transition.
3. **Draft** a cold email:
   - Subject line ≤ 50 chars
   - Body ≤ 60 words, one paragraph
   - Opens with the personalization hook (NOT "I noticed you...")
   - One specific question or CTA
   - Voice matches user's saved tone (if provided; default = professional-warm)
4. **Generate** 3 talking points for a follow-up call/LinkedIn DM.

Quality bar: **must not feel like ChatGPT slop.** This is the #1 product risk per Aryan's flag.

Mitigations:
- Use Claude Sonnet 4.6 not Haiku for the email generation step (Haiku for the cheap research summary)
- Retrieve actual recent post content, not just titles, before drafting
- Forbid stock phrases ("I came across your profile", "I was impressed by your work") via system prompt
- Include 5–10 example *good* emails in the prompt as few-shot
- Allow user to provide one example of their own past email as voice anchor

### 6.4 Output

- Default: write to a new Google Sheet in the user's Drive (OAuth scope: `drive.file` only — narrow, doesn't see other files)
- Fallback: downloadable CSV
- Output columns: `linkedin_url, name, title, company, email, email_status, research_summary, email_subject, email_body, talking_point_1, talking_point_2, talking_point_3, processed_at`

### 6.5 Account & Auth

- Sign up with Google OAuth (also gives Sheets permission upfront)
- No password-based auth in v1 (security simplification)
- Free tier: 25 prospects/month
- Paid: tiered, see §10

### 6.6 What is NOT in v1

Cut for scope:
- No Chrome extension
- No CRM integrations
- No email sending or sequencer (we generate the email; user sends it themselves)
- No team/multi-seat plans
- No own contact database
- No intent signals
- No mobile app
- No saved searches or lists
- No analytics dashboard

---

## 7. Technical Architecture (Recommended)

### 7.1 Stack

- **Frontend:** Next.js 14 (App Router) + Tailwind + shadcn/ui. Hosted on Vercel.
- **Backend:** Next.js API routes for thin endpoints; long-running enrichment jobs in a queue worker (Inngest or Trigger.dev — both have generous free tiers, no server to run).
- **Database:** Postgres via Supabase. Stores users, jobs, prospects, output rows.
- **Auth:** Supabase Auth with Google OAuth provider.
- **AI:** Anthropic Claude API. Sonnet for email drafting, Haiku for summaries.
- **Data APIs:** Proxycurl + Hunter.io + Anthropic.
- **File output:** Google Sheets API; CSV via `papaparse`.
- **Observability:** PostHog (events) + Sentry (errors). Free tiers sufficient for v1.
- **Payments:** Stripe (or Razorpay for India-first).

Why this stack: solo dev, 8-week timeline, no devops capacity. Vercel + Supabase + Inngest = zero infra to manage. Everything has a free tier that supports v1 scale (~50 users, ~10k prospects/month).

### 7.2 High-level flow

1. User submits a job (list of URLs).
2. API route validates input, creates a `Job` row + N `Prospect` rows (status `pending`), enqueues an Inngest job.
3. Inngest worker fans out: for each prospect, in parallel (with concurrency limit ~5), calls Proxycurl → Hunter → Claude. Updates row status.
4. When all prospects finish, worker writes the output Sheet via Google Sheets API and emails the user a link.
5. Failed rows are retried once; if still failing, marked `failed` with reason.

### 7.3 Data model (sketch)

- `users` (id, email, google_refresh_token, plan, credits_used, created_at)
- `jobs` (id, user_id, status, prospect_count, sheet_url, created_at, completed_at)
- `prospects` (id, job_id, input_url, status, enrichment_json, ai_email_subject, ai_email_body, talking_points_json, error_reason)

### 7.4 Build sequence (8-week plan)

- **Week 1:** Auth + Google OAuth + Sheets write end-to-end with hardcoded data. Prove the boring plumbing.
- **Week 2:** Proxycurl integration + Hunter integration. Single-prospect enrichment working in dev.
- **Week 3:** Inngest job pipeline + retry logic + concurrency limits. Submit-a-job → see-rows-process flow.
- **Week 4:** Claude integration: research summary + email draft + talking points. Iterate on prompt quality with 50 hand-picked test prospects.
- **Week 5:** Output to Google Sheets; full happy-path flow polished. Sign up → upload → wait → Sheet appears in Drive.
- **Week 6:** UI polish, error states, free-tier credit metering, Stripe paid plans.
- **Week 7:** Closed beta with 5–10 hand-picked users. Fix what breaks.
- **Week 8:** Public launch (small): Product Hunt, LinkedIn, India SaaS communities.

This is aggressive. Realistically week 7–8 spills into week 9–10. Build in slack.

---

## 8. Data Strategy

**v1: licensed APIs, no own scraping.** This is the right call. Building reliable scraping infrastructure (proxy management, anti-bot, captcha handling, dedup, freshness) is 3–6 months of full-time work. Not feasible solo + 8 weeks. Proxycurl + Hunter cover ~80% of what we need at acceptable cost.

**v2: opportunistic enrichment.** Cache every Proxycurl/Hunter response in Postgres. After 3–6 months of users, we'll have a meaningful warm cache that reduces API spend and starts becoming proprietary.

**v3: build vertical-first.** Pick one niche (e.g., Indian SaaS founders, ~50k people) and build a curated, hand-verified database for it. This is the moat. Don't try to compete with Apollo on breadth — beat them on depth in one slice.

**Legal note on scraping:** When (if) we scrape directly, LinkedIn ToS prohibits it but enforcement against small actors is uneven. *hiQ Labs v. LinkedIn* (US) limits LinkedIn's ability to block public-data scraping but does not authorize ToS violations. India DPDP Act (2023) applies to personal data of Indian residents — get a privacy policy and DPO contact in place before scraping begins. Don't scrape until v3 and don't scrape from your primary domain.

---

## 9. Integrations

v1 integrations:
- **Google OAuth + Sheets** (must)
- **Stripe / Razorpay** (must, for payments)
- **PostHog + Sentry** (internal)

Deferred to v2:
- HubSpot, Zoho, Pipedrive (CRMs)
- Gmail / Outlook (for sending generated emails)
- Slack (for daily digests)

Deferred to v3:
- WhatsApp Business API
- Salesforce
- Custom webhooks

---

## 10. Pricing & Monetization

Recommended v1 pricing:

| Plan | Price | Prospects/month | AI quality | Sheets export |
|---|---|---|---|---|
| Free | ₹0 / $0 | 25 | Haiku-only | ✓ |
| Starter | ₹999 / $12 | 250 | Sonnet | ✓ |
| Pro | ₹2,999 / $35 | 1,000 | Sonnet | ✓ |
| Agency | ₹9,999 / $120 | 5,000 + multi-client folders | Sonnet | ✓ |

Pricing rationale:
- Free tier exists to let agencies trial before reseller conversation, not as a PLG funnel
- Indian rupee pricing matters; double-pricing in INR + USD is standard for SEA SaaS
- "Agency" tier is the actual revenue tier; Starter and Pro exist mostly for credibility ("we have multiple plans") and individual users
- Unit economics: at $0.15/prospect cost, Pro ($35 for 1,000) gives 76% gross margin *only if* utilization is < 60%. Heavy users will burn margin. Add hard cap at 1,000 + $0.05 per overage prospect.

**Caveat on free tier vs unit economics:** with 25 free prospects × $0.15 = $3.75 in cost per free signup. Acceptable as a sales tool for converting agency partners; problematic if free signups balloon. Add credit card requirement on free signup or aggressive throttling if free abuse appears.

---

## 11. Go-to-Market

**v1 GTM (months 0–3): founder-led, agency-anchored.**

The 12-week success goal is one anchor reseller / agency partner. That sets the GTM:

1. **Weeks 1–4 (during build):** Make a list of 50 outbound agencies in India serving SMB SaaS clients. Sources: LinkedIn Sales Navigator (15-day trial), Twitter, /r/IndiaSaaS, Sales Hacker India.
2. **Weeks 5–7:** Reach out to all 50 founders personally via LinkedIn DM and email. Share a 2-minute Loom of the product. Offer free Agency-tier access to first 5 design partners in exchange for weekly feedback calls.
3. **Weeks 8–10:** Onboard 3–5 design partner agencies. They use it on real client work. Iterate on their feedback.
4. **Weeks 11–12:** Convert one design partner to paid Agency plan. Use them as case study + reference.

Why not PLG yet: a free tier with self-built unit economics on third-party data APIs is fragile. PLG works at scale with very low CAC; we don't have either yet. PLG is a v2 motion once we have product and case study.

Why not content/SEO yet: 6–12 month payback. We don't have 6 months of runway for SEO before validating the product works.

**v2+ GTM:** Add PLG (Chrome extension is the wedge) and content. Reseller motion continues but becomes one of three channels.

**Marketing collateral needed at launch:**
- 90-second product video showing one job end-to-end
- Landing page with clear "for SMB sales teams in India + SEA" positioning
- 5 case-study quotes from design partners (even unpaid)
- Pricing page with INR + USD
- Comparison table vs Apollo (focus on India data quality + Sheets workflow)

---

## 12. Success Metrics

**v1 north star: number of Sheets exported per active user per week.**

This is the workflow-completion metric. A user who exports 3 Sheets/week is genuinely using the product; a user who exports 0 has churned mentally.

Supporting metrics:

| Metric | v1 target (week 12) |
|---|---|
| Signed paying agency partners | 1 |
| Free-tier signups | 100–250 |
| Activated users (≥1 export) | 40% of signups |
| Power users (≥3 exports/week, sustained 3 weeks) | 5–10 |
| MRR | ₹10,000 / $120+ |
| Email reply rate uplift (self-reported) | ≥ 2× user's pre-tool baseline |
| Email "feels personal" rating (in-app NPS) | ≥ 7/10 |

The reply-rate uplift is the most important *outcome* metric but hardest to measure (requires user self-reporting since we don't send emails in v1). Add a simple in-app "did this email work?" 👍/👎 after 7 days.

---

## 13. Risks & Mitigations

| Risk | Severity | Probability | Mitigation |
|---|---|---|---|
| AI emails feel generic / ChatGPT slop | **High** | High | Multi-step agent prompt; few-shot examples; user-provided voice anchor; Sonnet-not-Haiku for emails; weekly prompt-quality review against test set |
| Proxycurl / Hunter API price hikes or rate limits | High | Medium | Cache aggressively; build provider abstraction layer (swap to Apollo API or PDL in 1 week if needed) |
| Email accuracy too low → users churn | High | Medium | Surface email confidence score visibly; auto-skip `invalid` emails from output Sheet; integrate second verifier (NeverBounce) as fallback |
| LinkedIn ToS / legal action | Medium | Low (v1) | Don't scrape directly in v1. All LinkedIn data is via Proxycurl which is their problem. Re-evaluate at v3. |
| Distribution failure (can't find users) | High | Medium | Reseller motion mitigates; one agency = N end-users. Founder-led outbound is high-effort but high-signal. |
| Free-tier abuse blowing up unit economics | Medium | Medium | Credit card required; daily/weekly throttle; phone OTP for India signups; ban detection |
| Solo founder burnout / scope creep | High | High | Hard 8-week scope freeze; weekly Friday review; cut features ruthlessly; ship ugly |
| Indian payments friction (Razorpay onboarding) | Medium | Medium | Set up Razorpay business account in week 1, not week 7. KYC takes time. |

---

## 14. Open Questions / Decisions Still Needed

1. **Product name.** Not picked. Suggest 3–5 candidates by week 2; check domain + Indian trademarks.
2. **Razorpay vs Stripe for v1?** If primary buyers are Indian businesses, Razorpay is friendlier. If equal mix India/SEA, Stripe (with India support) may be simpler.
3. **Voice-anchor input format.** Should the user paste one example email, or fill in a structured form ("tone: warm; persona: technical buyer; my company sells X")? Test both with first 5 users.
4. **Free-tier guardrails.** Phone OTP? Credit card on file? Domain blacklist (no Gmail-only signups)? Decide before public launch.
5. **Sheets vs in-app preview.** v1 says Sheets-only output. Should we *also* show results in-app immediately so the user can scan before opening Drive? Probably yes — adds 1 week. Worth it.
6. **Confidence display.** How visible should the "this email might be wrong" signal be in the Sheet output? Strongly visible reduces churn but also reduces perceived value.
7. **Anchor vertical for v3 database.** Indian SaaS founders? Indian D2C marketing leaders? SEA fintech buyers? Decide by month 4 based on which segment showed up most in v1 paying users.

---

## 15. Appendix: What we explicitly de-scoped and why

| De-scoped | Why |
|---|---|
| Own contact database | 3–6 months of work alone; pre-PMF |
| Chrome extension | High-leverage but adds 3+ weeks; v2 |
| Email sequencer | Different product; deliverability infra is a separate beast |
| CRM integrations | One CRM = 1–2 weeks of work each; defer until users ask |
| Intent signals | Requires data infrastructure we don't have |
| WhatsApp outreach | Massive in India but BSP onboarding alone is 4–6 weeks |
| Multi-seat / team plans | Adds permission complexity; v2 |
| Mobile app | 0% of value; never |
| Real-time dashboard | Sheets-native is the wedge; don't undermine it |

---

*End of PRD v0.1. Next step: confirm pricing in INR, lock product name, start Week 1 build.*
