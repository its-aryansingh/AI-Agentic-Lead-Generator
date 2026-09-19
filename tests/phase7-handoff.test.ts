// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildHandoffSummary } from "@/lib/handoff";
import { transitionProspect } from "@/lib/outreach/prospect-state-machine";
import { leadStatusLabel } from "@/lib/lead-status";

import { assertNoSupabaseRls, assertReadOnlyForUsers, assertTenantScoped } from "./helpers/tenancy.ts"

const migration = fs.readFileSync(new URL("../db/migrations/0004_salesengai_phase8.sql", import.meta.url), "utf8").toLowerCase();
const service = fs.readFileSync(new URL("../lib/unified-lead-handoff.ts", import.meta.url), "utf8");
const actions = fs.readFileSync(new URL("../app/app/inbox/handoff-actions.ts", import.meta.url), "utf8");
const cards = fs.readFileSync(new URL("../app/app/inbox/handoff-cards.tsx", import.meta.url), "utf8");
const retryCron = fs.readFileSync(new URL("../app/api/cron/deliver-handoff-notifications/route.ts", import.meta.url), "utf8");
const vercel = fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8");
const stateMachine = fs.readFileSync(new URL("../lib/outreach/prospect-state-machine.ts", import.meta.url), "utf8");
const calls = fs.readFileSync(new URL("../app/app/leads/calls/calls-dashboard-client.tsx", import.meta.url), "utf8");
const leads = fs.readFileSync(new URL("../app/app/leads/leads-table-client.tsx", import.meta.url), "utf8");
const pipeline = fs.readFileSync(new URL("../app/app/pipeline/pipeline-client.tsx", import.meta.url), "utf8");
const tools = fs.readFileSync(new URL("../lib/agent/tool-handlers.ts", import.meta.url), "utf8");
const aiConfig = fs.readFileSync(new URL("../lib/ai-config.ts", import.meta.url), "utf8");

test("Phase 7 handoffs are tenant-owned, deduplicated, indexed, and RLS protected", () => {
  assert.match(migration, /create table if not exists public\.lead_handoffs/);
  assert.match(migration, /foreign key \(prospect_id,user_id\) references public\.prospects\(id,user_id\)/);
  assert.match(migration, /unique \(user_id,idempotency_key\)/);
  assert.match(migration, /lead_handoffs_source_reason_dedupe_idx/);
  assertTenantScoped("lead_handoffs");
  assertTenantScoped("lead_handoff_notification_outbox");
});

test("handoff summaries are deterministic, evidence-backed, and XSS-safe React text", () => {
  const summary = buildHandoffSummary({ name: "<img src=x>", bucket: "warm", leadStatus: "engaged", nextAction: "human_handoff", conversationSummary: "<script>alert(1)</script>", facts: [] });
  assert.match(summary, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(cards, /dangerouslySetInnerHTML/);
  assert.match(cards, /whitespace-pre-wrap/);
});

test("duplicate events use one handoff and one platform-credit idempotency reference", () => {
  assert.match(service, /const idempotencyKey = `\$\{input\.sourceType\}:\$\{input\.sourceId\}:\$\{input\.reason\}`/);
  assert.match(service, /idempotencyKey: `handoff:\$\{handoff\.id\}:summary`/);
  assert.match(service, /lead_handoff_notification_outbox/);
  assert.match(service, /never a Bolna provider cost/);
  assert.match(service, /generateText/);
  assert.match(service, /resolveAiModel\(input\.userId, "writing"\)/);
  assert.match(service, /deterministicHandoffSummary/);
  assert.match(service, /recordAiUsage/);
  assert.match(aiConfig, /credit_cost: input\.creditCost/);
});

test("Inbox mutations are authenticated, tenant scoped, audited, and preserve call guard", () => {
  assert.match(actions, /auth\.getUser\(\)/);
  assert.match(actions, /\.eq\("user_id", user\.id\)/);
  assert.match(actions, /from\("lead_state_events"\)\.insert/);
  assert.match(actions, /startQualificationCall/);
  assert.match(actions, /idempotencyKey: `handoff:\$\{id\}:call-now`/);
  assert.match(actions, /if \(!consentConfirmed\) throw new Error/);
  assert.match(cards, /I confirm I have lawful permission to call this prospect/);
  assert.match(actions, /campaign_recipients/);
  assert.match(actions, /lead_followups/);
  assert.match(actions, /outreach_action_approvals/);
});

test("pending handoff notifications have a scheduled bounded retry worker", () => {
  assert.match(retryCron, /deliverLeadHandoffNotifications\(createAdminClient\(\), 50\)/);
  assert.match(retryCron, /CRON_SECRET/);
  assert.match(vercel, /deliver-handoff-notifications/);
});

test("terminal lead outcomes resolve obsolete handoffs and polling cleanup is bounded", () => {
  assert.match(actions, /\.in\("status", \["open", "acknowledged"\]\)/);
  assert.match(cards, /setInterval\(\(\) => router\.refresh\(\), 30_000\)/);
  assert.match(cards, /clearInterval/);
  assert.equal(transitionProspect("engaged", "converted"), "converted");
  assert.equal(transitionProspect("engaged", "disqualified"), "disqualified");
  assert.match(stateMachine, /applyProspectTransition/);
  assert.match(service, /applyProspectTransition/);
  assert.match(calls, /setInterval/);
  assert.match(calls, /clearInterval/);
  assert.match(leads, /setInterval/);
  assert.match(leads, /clearInterval/);
  assert.match(pipeline, /setInterval/);
  assert.match(pipeline, /clearInterval/);
  assert.match(tools, /escalationRequested/);
});

test("central status labels cover workflow and handoff visibility", () => {
  assert.equal(leadStatusLabel("new"), "New");
  assert.equal(leadStatusLabel("engaged"), "Engaged");
  assert.equal(leadStatusLabel("qualified", "human_handoff"), "Needs Handoff");
  assert.equal(leadStatusLabel("failed"), "Failed");
});