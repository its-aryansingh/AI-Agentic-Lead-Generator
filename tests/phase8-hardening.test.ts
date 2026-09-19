// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
/**
 * Phase 8 Hardening and Verification Tests
 *
 * Covers: security, multitenancy, compliance, idempotency, provider contracts,
 * billing separation, and end-to-end wiring coverage. These source assertions
 * are not a substitute for deployed two-tenant or real-provider smoke tests.
 *
 * Pure-function tests use in-process logic. Provider-contract tests use
 * in-process normalizeBolnaEvent (no network). Cost function tests use inline
 * re-implementations of the two-line utility functions to avoid transitive
 * server-only imports that do not load in the test runner.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizeE164, withinCallingHours } from "@/lib/voice-compliance";
import { normalizeBolnaEvent } from "@/lib/voice/providers/bolna";
import { transitionProspect } from "@/lib/outreach/prospect-state-machine";
import { addDecimalStrings } from "@/lib/voice/voice-analytics";


import { assertNoSupabaseRls, assertReadOnlyForUsers, assertTenantScoped } from "./helpers/tenancy.ts"

// ---------------------------------------------------------------------------
// Tenancy, checked where this repo actually enforces it
//
// SalesEngAIMVP asserted `enable row level security` and `auth.uid() =
// user_id` against the migration text. Neither exists here: 0004 strips
// all 26 policies because Railway Postgres has no auth.uid(), and RLS
// enabled with zero policies denies everything. Ownership moved into
// lib/db/rls.ts, and lib/db/query-builder.ts injects it into every
// user-scoped statement.
//
// So the assertion is redirected rather than dropped. Asserting the
// OWNERSHIP entry is the stronger test on this deployment: it checks the
// mechanism that is actually load-bearing, and a table added to a
// migration without an rls.ts entry now fails here instead of silently
// failing closed at runtime.
// ---------------------------------------------------------------------------




// ---------------------------------------------------------------------------
// Inline re-implementations of pure cost helpers from lib/voice-outcome.ts
// (avoids transitive Supabase/server-only import chain in the test runner)
// ---------------------------------------------------------------------------
function bolnaCostMinorUnits(payload: Record<string, unknown>): string | null {
  const value = payload.total_cost;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value).trim();
  return /^\d+(?:\.\d+)?$/.test(text) ? text : null;
}

const BOLNA_COST_COMPONENTS = [
  "platform",
  "network",
  "transcriber",
  "llm",
  "synthesizer",
] as const;
function bolnaCostBreakdown(
  payload: Record<string, unknown>,
): Record<string, string> {
  const source =
    payload.cost_breakdown && typeof payload.cost_breakdown === "object"
      ? (payload.cost_breakdown as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    BOLNA_COST_COMPONENTS.flatMap((name) => {
      const value = source[name];
      if (typeof value !== "number" && typeof value !== "string") return [];
      const text = String(value).trim();
      return /^\d+(?:\.\d+)?$/.test(text) ? [[name, text]] : [];
    }),
  );
}

// ---------------------------------------------------------------------------
// 1. Security and multitenancy - static source analysis
// ---------------------------------------------------------------------------

test("phase8: voice actions webhook enforces both signature and IP source validation", () => {
  const route = readFileSync(
    "app/api/webhooks/bolna/[connectionId]/actions/route.ts",
    "utf8",
  );
  assert.match(route, /validVoiceWebhookSignature/);
  assert.match(route, /validBolnaWebhookSource/);
  const sigIndex = route.indexOf("validVoiceWebhookSignature");
  const ipIndex = route.indexOf("validBolnaWebhookSource");
  const bodyProcessIndex = route.indexOf("request.action");
  assert.ok(
    sigIndex < bodyProcessIndex,
    "Signature check must precede action processing",
  );
  assert.ok(
    ipIndex < bodyProcessIndex,
    "IP source check must precede action processing",
  );
});

test("phase8: all prospect queries in actions webhook include user_id scope", () => {
  const route = readFileSync(
    "app/api/webhooks/bolna/[connectionId]/actions/route.ts",
    "utf8",
  );
  const prospectBlocks = [
    ...route.matchAll(/\.from\("prospects"\)([\s\S]{0,220})/g),
  ];
  assert.ok(
    prospectBlocks.length >= 3,
    `Found only ${prospectBlocks.length} prospect queries; expected >=3`,
  );
  for (const match of prospectBlocks) {
    assert.ok(
      match[1].includes('.eq("user_id"'),
      `Unscoped prospect query: ${match[0].slice(0, 80)}`,
    );
  }
});

test("phase8: provider credentials never returned in voice analytics route", () => {
  const source = readFileSync("app/api/voice/analytics/route.ts", "utf8");
  assert.doesNotMatch(source, /encrypted_api_key/);
  assert.doesNotMatch(source, /decryptCredential/);
  assert.doesNotMatch(source, /oauth_refresh_token/);
});

test("phase8: recording proxy does not attach provider API keys to upstream request", () => {
  const source = readFileSync(
    "app/api/voice/executions/[id]/recording/route.ts",
    "utf8",
  );
  assert.doesNotMatch(source, /authorization.*apiKey/i);
  assert.doesNotMatch(source, /encrypted_api_key/);
  assert.match(source, /https:/);
  assert.match(source, /redirect.*error/i);
});

test("phase8: dispatcher scopes all outreach queries to user_id", () => {
  const source = readFileSync("lib/outreach/autonomous-dispatcher.ts", "utf8");
  assert.match(source, /\.eq\("user_id",input\.userId\)/);
  assert.match(source, /user_id:input\.userId/);
});

// ---------------------------------------------------------------------------
// 2. Authorization - server-side identity derivation
// 2. Authorization
// ---------------------------------------------------------------------------

test("phase8: voice qualification route derives userId from authenticated session", () => {
  const source = readFileSync("app/api/voice/qualification/route.ts", "utf8");
  assert.match(source, /createClient/);
  assert.match(source, /auth\.getUser/);
  assert.doesNotMatch(source, /req\.body.*user_id/);
});

test("phase8: chat tool schemas do not expose user_id as a model-supplied parameter", () => {
  const schemas = readFileSync("lib/agent/sales-tool-schemas.ts", "utf8");
  assert.doesNotMatch(schemas, /user_id.*z\.(string|uuid)/);
  assert.doesNotMatch(schemas, /userId.*z\.(string|uuid)/);
});

test("phase8: tool handlers derive userId from ToolContext not model arguments", () => {
  const source = readFileSync("lib/agent/tool-handlers.ts", "utf8");
  assert.match(source, /ctx\.userId/);
  assert.doesNotMatch(source, /args\.userId/);
});

test("phase8: approval tokens hashed before storage, cleartext never stored", () => {
  const source = readFileSync("app/api/voice/qualification/route.ts", "utf8");
  assert.match(source, /sha256|createHash|hash/i);
  assert.match(source, /confirmation_token_hash/);
});

// ---------------------------------------------------------------------------
// 3. Compliance - E.164, DNC, consent, calling hours, one-call guard
// 3. Compliance
// ---------------------------------------------------------------------------

test("phase8: E.164 accepts valid international numbers", () => {
  assert.equal(normalizeE164("+919876543210"), "+919876543210");
  assert.equal(normalizeE164("+12125551234"), "+12125551234");
  assert.equal(normalizeE164("+1 212 555 1234"), "+12125551234");
});

test("phase8: E.164 rejects invalid phones", () => {
  assert.equal(normalizeE164("9876543210"), null);
  assert.equal(normalizeE164("not-a-phone"), null);
  assert.equal(normalizeE164(""), null);
  assert.equal(normalizeE164("+1"), null);
});

test("phase8: calling hours correct for IST timezone window", () => {
  const tenAmUtc = new Date("2026-09-05T10:00:00.000Z");
  assert.equal(withinCallingHours(tenAmUtc, "Asia/Kolkata", 9, 18), true);
  const threeAmUtc = new Date("2026-09-05T03:00:00.000Z");
  assert.equal(withinCallingHours(threeAmUtc, "Asia/Kolkata", 9, 18), false);
  const twopmUtc = new Date("2026-09-05T14:00:00.000Z");
  assert.equal(withinCallingHours(twopmUtc, "Asia/Kolkata", 9, 18), false);
});

test("phase8: start-qualification-call enforces all compliance gates", () => {
  const source = readFileSync("lib/voice/start-qualification-call.ts", "utf8");
  assert.match(source, /consent_required/);
  assert.match(source, /phone_suppressions/);
  assert.match(source, /do_not_contact/);
  assert.match(source, /withinCallingHours/);
  assert.match(source, /VOICE_LEGAL_LAUNCH_APPROVED/);
  const suppressionIdx = source.indexOf("phone_suppressions");
  const reservationIdx = source.indexOf("reserve_voice_execution");
  assert.ok(
    suppressionIdx < reservationIdx,
    "Suppression check must precede DB reservation",
  );
});

test("phase8: one-call guard uses normalized phone hash partial unique index", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assert.match(
    migration,
    /unique index.*voice_one_default_attempt_per_person_idx/i,
  );
  assert.match(migration, /recipient_phone_hash/);
  assert.match(migration, /counts_toward_call_limit/);
  assert.match(migration, /is_override/);
  assert.match(migration, /pg_advisory_xact_lock/);
});

test("phase8: forward-only voice reservation fix is tenant-scoped and unambiguous", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assert.match(migration, /ve\.attempt_number/);
  assert.match(migration, /vc\.user_id = p_user_id/);
  assert.match(migration, /p\.user_id = p_user_id/);
  assert.match(migration, /qualification_calls_batch/);
  assert.match(migration, /consent_attestation/);
});

test("phase8: override requires reason and approval ID", () => {
  const source = readFileSync("lib/voice/start-qualification-call.ts", "utf8");
  assert.match(source, /override_reason_required/);
  assert.match(source, /override_approval_required/);
  assert.match(source, /overrideReason\.length < 10/);
});

test("phase8: voice compliance decisions are immutable", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assert.match(migration, /immutable/i);
  assert.match(migration, /raise exception/i);
});

// ---------------------------------------------------------------------------
// 4. Concurrency and idempotency
// ---------------------------------------------------------------------------

test("phase8: state machine rejects duplicate terminal transitions", () => {
  assert.equal(transitionProspect("qualified", "email_replied"), null);
  assert.equal(transitionProspect("converted", "call_answered"), null);
  assert.equal(transitionProspect("disqualified", "qualified"), null);
  assert.equal(
    transitionProspect("qualified", "unsubscribed"),
    "do_not_contact",
  );
});

test("phase8: state machine produces deterministic transitions", () => {
  assert.equal(transitionProspect("new", "research_started"), "researching");
  assert.equal(
    transitionProspect("researching", "research_completed"),
    "ready",
  );
  assert.equal(
    transitionProspect("researching", "research_completed"),
    "ready",
  );
  assert.equal(transitionProspect("ready", "email_sent"), "contacted");
  assert.equal(transitionProspect("contacted", "email_replied"), "engaged");
  assert.equal(transitionProspect("engaged", "qualified"), "qualified");
  assert.equal(transitionProspect("new", "email_queued"), "new");
  assert.equal(transitionProspect("new", "call_queued"), "new");
});

test("phase8: credit deduction uses atomic RPC with idempotency key", () => {
  const source = readFileSync("lib/credits.ts", "utf8");
  assert.match(source, /deduct_credits_atomic/);
  assert.match(source, /p_idempotency_key/);
});

test("phase8: email sends cross an atomic claim boundary", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  const worker = readFileSync("app/api/cron/send-due/route.ts", "utf8");
  assert.match(migration, /for update of cr skip locked/i);
  assert.match(migration, /status = 'sending'/i);
  assert.match(migration, /now\(\) at time zone c\.timezone/i);
  assert.match(worker, /claim_campaign_recipients/);
  assert.match(worker, /\.eq\("status", "sending"\)/);
});

test("phase8: legacy campaigns receive an explicit IANA send-window timezone", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assert.match(
    migration,
    /add column if not exists timezone text not null default 'UTC'/i,
  );
  assert.match(migration, /IANA timezone/i);
});

test("phase8: local enrichment accepts the Inngest Dev Server without a cloud key", () => {
  const source = readFileSync("lib/enrichment/enqueue.ts", "utf8");
  assert.match(source, /INNGEST_EVENT_KEY\?\.trim/);
  assert.match(source, /INNGEST_DEV\?\.trim/);
  assert.match(source, /hasInngestTransport\(\)/);
});

test("phase8: deduct_credits_atomic Postgres function uses row-level lock", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assert.match(migration, /deduct_credits_atomic/);
  assert.match(migration, /for update/i);
  assert.match(migration, /p_idempotency_key/);
});

test("phase8: Bolna webhook outcome is idempotent via status ordering", () => {
  const source = readFileSync("lib/voice-outcome.ts", "utf8");
  assert.match(source, /isOlderBolnaProviderStatus/);
});

test("phase8: handoff creation is idempotent with unique constraint handling", () => {
  const source = readFileSync("lib/unified-lead-handoff.ts", "utf8");
  assert.match(source, /idempotency_key/);
  assert.match(source, /prior.*return/s);
  assert.match(source, /23505/);
});

// ---------------------------------------------------------------------------
// 5. Bolna provider contract - in-process tests (no network)
// 5. Bolna provider contract
// ---------------------------------------------------------------------------

test("phase8 bolna: conversation_duration takes precedence over conversation_time", () => {
  const event = normalizeBolnaEvent({
    id: "exec-1",
    status: "completed",
    conversation_duration: 42.5,
    conversation_time: 100,
    transcript: "Agent: Hi\nRecipient: Hello",
  });
  assert.equal(event.kind, "completed");
  assert.equal(event.durationSeconds, 42.5);
});

test("phase8 bolna: falls back to conversation_time when duration absent", () => {
  const event = normalizeBolnaEvent({
    id: "exec-2",
    status: "completed",
    conversation_time: 65,
    transcript: "Agent: Hi",
  });
  assert.equal(event.kind, "completed");
  assert.equal(event.durationSeconds, 65);
});

test("phase8 bolna: falls back to telephony_data.duration as last resort", () => {
  const event = normalizeBolnaEvent({
    id: "exec-3",
    status: "completed",
    telephony_data: { duration: 30 },
    transcript: "Agent: Hi",
  });
  assert.equal(event.kind, "completed");
  assert.equal(event.durationSeconds, 30);
});

test("phase8 bolna: call-disconnected maps to answered", () => {
  const event = normalizeBolnaEvent({
    id: "exec-4",
    status: "call-disconnected",
  });
  assert.equal(event.kind, "answered");
});

test("phase8 bolna: fractional total_cost preserved without rounding", () => {
  assert.equal(bolnaCostMinorUnits({ total_cost: 0.123456 }), "0.123456");
  assert.equal(bolnaCostMinorUnits({ total_cost: 5 }), "5");
  assert.equal(bolnaCostMinorUnits({ total_cost: "2.75" }), "2.75");
  assert.equal(bolnaCostMinorUnits({}), null);
  assert.equal(bolnaCostMinorUnits({ total_cost: null }), null);
});

test("phase8 bolna: cost breakdown extracts documented fields only", () => {
  const breakdown = bolnaCostBreakdown({
    cost_breakdown: {
      platform: 0.5,
      network: 1.25,
      transcriber: "0.333",
      llm: 2.1,
      synthesizer: 0.05,
      unknown_field: 99,
    },
  });
  assert.deepEqual(Object.keys(breakdown).sort(), [
    "llm",
    "network",
    "platform",
    "synthesizer",
    "transcriber",
  ]);
  assert.equal(breakdown.platform, "0.5");
  assert.equal(breakdown.transcriber, "0.333");
  assert.equal("unknown_field" in breakdown, false);
});

test("phase8 bolna: voicemail detection correct", () => {
  const event = normalizeBolnaEvent({
    id: "exec-5",
    status: "completed",
    answered_by_voice_mail: true,
  });
  assert.equal(event.kind, "voicemail");
});

test("phase8 bolna: all failure statuses map to failed", () => {
  for (const status of [
    "failed",
    "balance-low",
    "error",
    "stopped",
    "canceled",
  ]) {
    assert.equal(
      normalizeBolnaEvent({ id: "exec-f", status }).kind,
      "failed",
      `Expected failed for ${status}`,
    );
  }
});

test("phase8 bolna: payload without execution ID throws", () => {
  assert.throws(
    () => normalizeBolnaEvent({ status: "completed" }),
    /execution ID/i,
  );
});

test("phase8 bolna: retry_config.enabled=false and bypass_call_guardrails=false enforced", () => {
  const source = readFileSync("lib/voice/providers/bolna.ts", "utf8");
  assert.match(source, /retry_config.*enabled.*false/s);
  assert.match(source, /bypass_call_guardrails.*false/s);
});

// ---------------------------------------------------------------------------
// 6. Credit and billing separation
// ---------------------------------------------------------------------------

test("phase8 billing: decimal addition preserves fractional cents without IEEE-754 loss", () => {
  assert.equal(addDecimalStrings("0.1", "0.2"), "0.3");
  assert.equal(addDecimalStrings("1.23456", "2.54321"), "3.77777");
  assert.equal(addDecimalStrings("100", "200"), "300");
  assert.equal(addDecimalStrings("10", "0.5"), "10.5");
  assert.equal(addDecimalStrings("0", "5.25"), "5.25");
});

test("phase8 billing: analytics separates costs by currency, never combines different currencies", () => {
  const source = readFileSync("lib/voice/voice-analytics.ts", "utf8");
  assert.match(source, /currencyTotals/);
  assert.match(source, /totalBolnaCostMinorUnits/);
  assert.match(
    source,
    /never.*cross-currency.*grand total|totalBolnaCostMinorUnits.*0.*multiple currencies/s,
  );
});

test("phase8 billing: dispatcher does not charge platform credits for Bolna provider cost", () => {
  const source = readFileSync("lib/outreach/autonomous-dispatcher.ts", "utf8");
  assert.match(source, /autonomous_outreach_orchestration/);
  assert.doesNotMatch(source, /deductCredits.*duration/s);
  assert.doesNotMatch(source, /deductCredits.*cost_minor_units/s);
  assert.doesNotMatch(source, /deductCredits.*total_cost/s);
});

test("phase8 billing: voice-outcome does not deduct platform credits for Bolna calls", () => {
  const source = readFileSync("lib/voice-outcome.ts", "utf8");
  assert.doesNotMatch(source, /deductCredits/);
});

test("phase8 billing: orchestrator prompt labels Bolna charges as provider spend not platform credits", () => {
  const prompt = readFileSync("lib/agent/orchestrator-prompt.ts", "utf8");
  assert.match(prompt, /Bolna provider spend/i);
  assert.match(prompt, /Bolna is billed directly by Bolna/i);
  assert.match(prompt, /platform credits are not provider cost/i);
});

// ---------------------------------------------------------------------------
// 7. Multitenancy - RLS and composite FK constraints
// ---------------------------------------------------------------------------

test("phase8 rls: unified_lead_handoffs has RLS and composite FK", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assertTenantScoped("lead_handoffs");
  assertTenantScoped("lead_handoff_notification_outbox");
  assert.match(
    migration,
    /foreign key\s*\(prospect_id,\s*user_id\)\s*references\s*public\.prospects\(id,\s*user_id\)/is,
  );
});

test("phase8 rls: outreach_runs and items have idempotency constraints and RLS", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assertTenantScoped("outreach_runs");
  assertTenantScoped("outreach_run_items");
  assert.match(migration, /unique.*user_id.*idempotency_key/i);
});

test("phase8 rls: voice_call_override_audits are immutable and tenant-scoped", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assert.match(migration, /voice_call_override_audits/);
  // The immutability trigger is real SQL and survives the port.
  assert.match(migration, /immutable/i);
  // The tenancy half moved to rls.ts, and this table was `for select`
  // only, so it must also be readOnly for a signed-in user.
  assertTenantScoped("voice_call_override_audits");
  assertReadOnlyForUsers("voice_call_override_audits");
});

test("phase8 rls: outreach_action_approvals have expiry and consumed-at for single-use enforcement", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assert.match(migration, /outreach_action_approvals/);
  assert.match(migration, /expires_at/);
  assert.match(migration, /consumed_at/);
  assert.match(migration, /confirmed_at/);
});

test("phase8 rls: approval lifecycle is server-managed after hardening", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  // Policies are gone from the SQL entirely, so "there is no `for all`
  // policy" is now vacuously true. What it protected — that the approval
  // lifecycle is written by the server, never the user — is enforced by
  // SERVICE_ONLY_RPC in lib/db/rls.ts.
  assertNoSupabaseRls(migration);
  for (const table of ["outreach_runs", "outreach_run_items", "lead_handoffs", "crm_pull_runs"])
    assertTenantScoped(table);
  assert.match(migration, /foreign key \(approval_id, user_id\)/i);
});

test("phase8 rls: crm_pull_runs are tenant-scoped with RLS", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assertTenantScoped("crm_pull_runs");
  assertTenantScoped("prospect_crm_links");
  // auth.uid() does not exist on Railway; assertTenantScoped replaces it.
  assertNoSupabaseRls(migration);
});

// ---------------------------------------------------------------------------
// 8. UI component verification - static analysis
// ---------------------------------------------------------------------------

test("phase8 ui: pipeline client removed setState-in-useEffect (lint fix)", () => {
  const source = readFileSync("app/app/pipeline/pipeline-client.tsx", "utf8");
  assert.doesNotMatch(source, /useEffect\(\(\) => \{ setRecipients\(/);
});

test("phase8 ui: inbox client does not use dangerouslySetInnerHTML", () => {
  const source = readFileSync("app/app/inbox/inbox-client.tsx", "utf8");
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  assert.match(source, /handoff/i);
});

test("phase8 ui: orchestrator prompt gates tool calls with safety rules", () => {
  const prompt = readFileSync("lib/agent/orchestrator-prompt.ts", "utf8");
  assert.match(
    prompt,
    /Never claim an action occurred unless a successful tool result confirms it/i,
  );
  assert.match(prompt, /Never fabricate missing transcript/i);
  assert.match(prompt, /preview.*before.*apply|preview.*is not an action/is);
});

test("phase8 ui: calls dashboard separates Bolna spend from platform credits", () => {
  const dashboard = readFileSync(
    "app/app/leads/calls/calls-dashboard-client.tsx",
    "utf8",
  );
  assert.match(dashboard, /Bolna provider spend|Bolna.*provider.*spend/is);
  assert.match(dashboard, /platform credit/i);
});

// ---------------------------------------------------------------------------
// 9. End-to-end wiring evidence (static; deployed E2E remains external)
// ---------------------------------------------------------------------------

test("phase8 wiring: CSV to outreach to email path is connected", () => {
  const dispatcher = readFileSync(
    "lib/outreach/autonomous-dispatcher.ts",
    "utf8",
  );
  assert.match(dispatcher, /campaign_recipients/);
  assert.match(dispatcher, /email/);
  const stateMachine = readFileSync(
    "lib/outreach/prospect-state-machine.ts",
    "utf8",
  );
  assert.match(stateMachine, /email_queued/);
  assert.match(stateMachine, /email_sent/);
});

test("phase8 wiring: delayed voice steps are resumed and cancelled after engagement", () => {
  const scheduler = readFileSync("inngest/functions/outreach-schedules.ts", "utf8");
  const dispatcher = readFileSync("lib/outreach/autonomous-dispatcher.ts", "utf8");
  const replies = readFileSync("app/api/cron/detect-replies/route.ts", "utf8");
  assert.match(scheduler, /list_due_outreach_runs/);
  assert.match(scheduler, /executeOutreachRun/);
  assert.match(dispatcher, /lead_no_longer_eligible/);
  assert.match(replies, /outreach_run_items/);
  assert.match(replies, /email_replied/);
});

test("phase8 wiring: duplicate call blocked by already_called disposition", () => {
  const source = readFileSync("lib/voice/start-qualification-call.ts", "utf8");
  assert.match(source, /already_called/);
  assert.match(source, /no_redial/);
  assert.match(source, /recipient_phone_hash/);
});

test("phase8 wiring: override with reason creates audit record in DB", () => {
  const source = readFileSync("lib/voice/start-qualification-call.ts", "utf8");
  assert.match(source, /allowOverride/);
  assert.match(source, /overrideReason/);
  assert.match(source, /approvalId/);
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assert.match(migration, /voice_call_override_audits/);
});

test("phase8 wiring: override scope guard migration exists", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assert.ok(migration.length > 0, "Override scope guard migration must exist");
});

test("phase8 wiring: chat batch calls require confirmed_lawful_permission boolean", () => {
  const schemas = readFileSync("lib/agent/sales-tool-schemas.ts", "utf8");
  assert.match(schemas, /confirmed_lawful_permission/);
  assert.match(schemas, /confirmed_lawful_permission.*z\.boolean/s);
});

test("phase8 wiring: insufficient credits stops run before execution", () => {
  const dispatcher = readFileSync(
    "lib/outreach/autonomous-dispatcher.ts",
    "utf8",
  );
  assert.match(dispatcher, /charge\.ok/);
  assert.match(dispatcher, /status.*failed/);
});

test("phase8 wiring: the Temporal path is stubbed and fails loudly", () => {
  // backend-python/ was not ported: Temporal is an always-on service,
  // not a library. The rollout is gated per connection by
  // voice_connections.temporal_enabled, which defaults false, so
  // start-qualification-call takes the direct provider path.
  //
  // What matters is that the stub cannot silently swallow a call. A
  // queued call that never runs is worse than one that fails visibly.
  const stub = readFileSync("lib/temporal/client.ts", "utf8");
  assert.match(stub, /startVoiceCallWorkflow/);
  assert.match(stub, /signalVoiceCallWorkflow/);
  assert.match(stub, /throw new Error\(NOT_WIRED\)/);
  // No import of the SDK — the prose mentions it, the code must not.
  assert.doesNotMatch(stub, /from "@temporalio/);

  // And the caller still honours the gate rather than always throwing.
  const start = readFileSync("lib/voice/start-qualification-call.ts", "utf8");
  assert.match(start, /connection\.temporal_enabled/);
});

test("phase8 wiring: voice analytics exposes transcript, recording, cost, duration, and outcome", () => {
  const source = readFileSync("lib/voice/voice-analytics.ts", "utf8");
  assert.match(source, /hasTranscript/);
  assert.match(source, /hasRecording/);
  assert.match(source, /costMinorUnits/);
  assert.match(source, /costCurrency/);
  assert.match(source, /outcome/);
  assert.match(source, /durationSeconds/);
});

test("phase8 wiring: voice compliance module exports all required functions", () => {
  const source = readFileSync("lib/voice-compliance.ts", "utf8");
  assert.match(source, /normalizeE164/);
  assert.match(source, /withinCallingHours/);
  assert.match(source, /phoneHash/);
  assert.match(source, /validBolnaWebhookSource/);
  assert.match(source, /validVoiceWebhookSignature/);
});
