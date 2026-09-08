# Handoff prompt — Gemini 3.8 Flash (agentic CLI, repo access)

## How to use this

Paste everything below the line into your agentic CLI (Gemini CLI, Antigravity,
Cursor, Cline) with the repo open. It is written for **one task per invocation** —
Flash has a **64K output cap** and reasoning tokens bill at the output rate, so a
single "build the whole thing" turn will truncate mid-file. Run TASK 1, check the
gate, then run TASK 2, and so on.

Its Artificial Analysis **agentic** index jumped +4.9 while **coding** moved +0.2.
So the prompt leans on what it is good at — reading files, running commands,
iterating on compiler errors — and gives it exact contracts rather than asking it
to invent correct code.

---

```
You are working in the LeadGenAI repository. A public-business-contact
enrichment pipeline has already been implemented, typechecked and tested. Your
job is to finish the integration, not to rewrite it.

Work ONE TASK at a time. After each task, stop and print the verification
output. Do not start the next task until I say continue.

═══════════════════════════════════════════════════════════════════
NON-NEGOTIABLE FACTS ABOUT THIS REPO
Verify with `cat`/`grep` before you doubt any of them. Every one of these
has been confirmed against the actual files. If your instinct disagrees,
your instinct is wrong.
═══════════════════════════════════════════════════════════════════

1. `public.prospects` HAS NO `user_id` COLUMN.
   Ownership is prospects.job_id -> jobs.id -> jobs.user_id.
   Every query against prospects for a specific user MUST join jobs.
   This is the single most common mistake made in this repo. Do not
   write `.eq("user_id", userId)` against prospects.

2. `prospects.status` and `prospects.stage` are CHECK-constrained:
     status: pending|enriching|researching|drafting|completed|failed
     stage:  contacted|replied|interested|converted|unsubscribed
   Writing any other value throws. Crawl state lives in the separate
   `enrichment_runs` table, never in these columns.

3. `email_source` CHECK: extracted|pattern_guessed|none
   `email_confidence` CHECK: valid|risky|invalid|unknown

4. Inngest is v4. Triggers go INSIDE the config object:
       inngest.createFunction({ id, triggers: [{ event }], ... }, handler)
   NOT the v3 three-argument form. See inngest/functions/bulk-enrich.ts.

5. `lib/enrichment/validator.ts` imports `libphonenumber-js/max`, NOT the
   bare package. The default export ships "min" metadata where getType()
   returns undefined for every number. Do not "simplify" this import.

6. These files DO NOT EXIST, whatever any older planning document says:
   lib/prospect-identity.ts, lib/ai-config.ts,
   lib/discovery/discovery-orchestrator.ts, app/app/leads/*,
   any migration named *_autonomous_outreach.sql.
   These columns DO NOT EXIST on prospects: user_id, lead_status,
   next_action, normalized_email, normalized_phone_e164, email_hash,
   phone_hash, qualification_bucket, voice_consent_status.

7. `backend-python/` is Django 5.1 + uvicorn. It is NOT Temporal.

8. Migrations are numbered 00000000000001 .. 00000000000020.

═══════════════════════════════════════════════════════════════════
HARD RULES
═══════════════════════════════════════════════════════════════════

- DO NOT RUN `git commit` OR `git push`. The post-commit hook in
  .githooks/ auto-pushes to GitHub. Leave everything staged for human
  review. Print `git diff --stat` when you finish a task.
- DO NOT modify anything under `app/app/**` (another agent owns the UI).
- DO NOT modify `lib/agent/tool-handlers.ts`, `inngest/functions/bulk-enrich.ts`,
  or `scraper/src/handlers/company-site.ts`. The old paths keep working.
- DO NOT write secrets into any file. Env vars only.
- DO NOT delete or "clean up" files you were not asked to touch.
- Every provider must keep working with NO API keys (mock fallback).
  This is hard rule #2 in CLAUDE.md. Never remove a mock path.
- If a task is blocked, STOP and say why. Do not improvise a workaround
  that changes the database schema or the security model.

═══════════════════════════════════════════════════════════════════
TASK 1 — Install and establish a green baseline
═══════════════════════════════════════════════════════════════════

  npm install openai@^7.10.0 libphonenumber-js@^1.13.12
  cd scraper && npm install && cd ..
  npm test
  npx tsc --noEmit
  cd scraper && npx tsc --noEmit && cd ..

Then add to the ROOT package.json (both are currently missing):
  "engines": { "node": "22.x" },
  "packageManager": "npm@10.9.7"

GATE: paste the test summary line and both tsc results. Expect 38 new
tests passing (tests/enrichment-validator.test.ts,
tests/enrichment-adversarial.test.ts) plus the pre-existing suite.
If anything fails, fix it and re-run before continuing. STOP HERE.

═══════════════════════════════════════════════════════════════════
TASK 2 — Fix the /api/* rewrite that hides the new endpoint
═══════════════════════════════════════════════════════════════════

Read next.config.ts. When PYTHON_BACKEND_URL is set it rewrites ALL of
/api/:path* to Django, which makes both /api/prospects/:id/enrich and
/api/inngest unreachable.

Change the rewrite to the `fallback` form so Next.js routes that exist
win, and only unmatched paths proxy to Django:

  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [
        { source: "/api/:path*", destination: `${PYTHON_BACKEND_URL}/api/:path*` },
      ],
    }
  }

Keep the existing behaviour when PYTHON_BACKEND_URL is unset.

GATE: show the diff. Then with PYTHON_BACKEND_URL set to a dummy value,
run `npm run build` and confirm /api/prospects/[id]/enrich and
/api/inngest still appear in the route manifest. STOP HERE.

═══════════════════════════════════════════════════════════════════
TASK 3 — Reconciliation cron
═══════════════════════════════════════════════════════════════════

`findStuckRuns(olderThanMinutes, limit)` already exists in
lib/enrichment/run-service.ts and is unused. Wire it up.

Create app/api/cron/reconcile-enrichment/route.ts, following the exact
shape of the existing app/api/cron/run-automations/route.ts — read that
file first and copy its CRON_SECRET auth check verbatim.

Behaviour:
  - find runs stuck in queued/running for > 5 minutes
  - re-send `leadgen/enrichment.requested` for each (the worker's
    terminal-state guard makes this safe to replay)
  - cap at 50 per invocation
  - return { rechecked, redispatched }

Add to vercel.json crons:
  { "path": "/api/cron/reconcile-enrichment", "schedule": "*/10 * * * *" }

GATE: `npx tsc --noEmit` clean, and show the new file plus the
vercel.json diff. STOP HERE.

═══════════════════════════════════════════════════════════════════
TASK 4 — Trigger enrichment automatically after lead creation
═══════════════════════════════════════════════════════════════════

In lib/agent/tool-handlers.ts, `handleStartBulkJob` inserts prospects
around line 506 (`await supabase.from("prospects").insert(prospectInserts)`).

Two changes, minimally invasive:

(a) That insert currently ignores its error. Capture it and fail the
    job (set jobs.status='failed', error_reason) instead of silently
    completing with zero rows.

(b) AFTER the insert commits, queue enrichment for each inserted
    prospect that has an authoritative company_domain. Use
    `.select("id,company_domain")` on the insert to get the ids back.

    Reuse the existing services — do not reimplement:
      import { createOrGetRun, buildIdempotencyKey, normalizeCompanyDomain }
        from "@/lib/enrichment/run-service"
      import { ENRICHMENT_REQUESTED } from "@/lib/enrichment/types"

    CRITICAL: `company_domain` on these rows comes from
    guessDomainFromCompany() — it is a GUESS. Only queue when the domain
    was explicitly provided by the user or the candidate source. If you
    cannot tell the difference, DO NOT QUEUE and tell me. Crawling a
    guessed domain writes another company's contacts onto the lead.

GATE: `npx tsc --noEmit` clean, `npm test` still green, and explain in
two sentences how you distinguished a verified domain from a guessed
one. STOP HERE.

═══════════════════════════════════════════════════════════════════
TASK 5 — Integration test with a local fixture
═══════════════════════════════════════════════════════════════════

Write tests/enrichment-integration.test.ts that:
  - starts a fixture HTTP server on 127.0.0.1 serving a realistic Indian
    company /contact page (include a GSTIN, a CIN, a PIN code, a mobile
    behind a tel: href only, a landline with STD code, a 1800 number,
    a role email, a capitalised named email, and a vendor email)
  - sets SCRAPER_ALLOW_PRIVATE_HOSTS=1 and NODE_ENV=test
  - calls the crawler handler, then extractContacts (mock mode, no
    OPENAI_API_KEY), then validateExtraction
  - asserts the GSTIN/CIN/PIN never appear in phones, and that the
    capitalised named email survives grounding

Note: SCRAPER_ALLOW_PRIVATE_HOSTS hard-refuses when NODE_ENV=production.
That is intentional. Do not weaken it.

Playwright is a scraper/ dependency, not a root one — if the root test
runner cannot import it, put this test under scraper/ with its own
runner script instead and say so.

GATE: the test passes. Show the output. STOP HERE.
```

---

## Why the prompt is shaped this way

| Flash 3.8 trait | Prompt response |
|---|---|
| 64K output cap, thinking tokens billed as output | Five separate tasks with explicit STOP gates. No task writes more than ~200 lines. |
| Coding index flat (+0.2), agentic index +4.9 | Never asks it to invent architecture. Every task is "read this file, follow that pattern, run this command, fix the errors." |
| Knowledge cutoff March 2026 | Pins `openai@^7.10.0`, `playwright 1.63.0`, Inngest v4 signature explicitly — it cannot be assumed to know these. |
| Documented hallucination risk | The NON-NEGOTIABLE FACTS block exists because an earlier planning doc hallucinated `prospects.user_id`, a `lib/prospect-identity.ts`, and ~20 columns. Any model will reach for the obvious schema. |
| Strong tool use | Every task ends in a runnable verification, not a self-assessment. |

**The riskiest task is 4.** Distinguishing a verified domain from a
`guessDomainFromCompany()` guess needs judgement about your data, and getting it
wrong writes another company's contacts onto a lead. The prompt tells it to stop
rather than guess — check that it actually did.
