// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  callDetailsSchema,
  crmSyncSchema,
  followupSchema,
  leadFiltersSchema,
  qualificationBatchSchema,
  triggerOutreachSchema,
  voiceAgentSchema,
} from "@/lib/agent/sales-tool-schemas";

const id = "11111111-1111-4111-8111-111111111111";
const later = "2026-12-01T10:30:00+05:30";

test("Phase 6 tool schemas enforce bounded inputs and explicit modes", () => {
  assert.equal(leadFiltersSchema.safeParse({ limit: 101 }).success, false);
  assert.equal(leadFiltersSchema.safeParse({ time_range: "last_30_days", availability: "available_now" }).success, true);
  assert.equal(voiceAgentSchema.safeParse({ operation: "upsert", language: "en", voice: { provider: "elevenlabs", model: "m", voice_id: "v", name: "Nila" }, tone: "friendly", welcome_message: "Welcome, thanks for taking a moment today.", prompt: "x".repeat(100), transfer_number: "+919999999999", mode: "preview" }).success, true);
  assert.equal(voiceAgentSchema.safeParse({ operation: "upsert", language: "en", voice: { provider: "x", model: "m", voice_id: "v", name: "N" }, tone: "friendly", welcome_message: "short", prompt: "x".repeat(100) }).success, false);
  assert.equal(qualificationBatchSchema.safeParse({ lead_ids: [id], confirmed_lawful_permission: true, allow_override: true, idempotency_key: id, mode: "preview" }).success, false);
  assert.equal(qualificationBatchSchema.safeParse({ lead_ids: [id], confirmed_lawful_permission: true, allow_override: true, override_reason: "Prior call requested a documented callback.", idempotency_key: id, mode: "preview" }).success, true);
  assert.equal(followupSchema.safeParse({ lead_id: id, channel: "voice", scheduled_at: later, timezone: "Asia/Kolkata", idempotency_key: id, mode: "preview" }).success, true);
  assert.equal(followupSchema.safeParse({ lead_id: id, channel: "voice", scheduled_at: "2026-12-01", timezone: "Asia/Kolkata", idempotency_key: id }).success, false);
  assert.equal(crmSyncSchema.safeParse({ provider: "hubspot", limit: 1000, mode: "preview" }).success, true);
  assert.equal(crmSyncSchema.safeParse({ provider: "hubspot", limit: 1001, mode: "preview" }).success, false);
  assert.equal(callDetailsSchema.safeParse({ execution_id: id, lead_id: id }).success, false);
  assert.equal(triggerOutreachSchema.safeParse({ filters: { call_status: "not_called" }, channel_strategy: "voice", confirmed_lawful_permission: true, idempotency_key: id, mode: "preview" }).success, true);
});

test("Phase 6 uses server-side scoped confirmation rather than model apply mode", () => {
  const root = process.cwd();
  const handlers = fs.readFileSync(path.join(root, "lib/agent/tool-handlers.ts"), "utf8");
  const confirmation = fs.readFileSync(path.join(root, "app/api/chat/tool-confirmations/route.ts"), "utf8");
  const schemas = fs.readFileSync(path.join(root, "lib/agent/sales-tool-schemas.ts"), "utf8");
  assert.match(handlers, /confirmation_card_required/);
  assert.match(handlers, /eq\("user_id", input\.userId\)/);
  assert.match(handlers, /eq\("session_id", input\.sessionId\)/);
  assert.match(handlers, /second_confirmation_required/);
  assert.match(confirmation, /getUserFromRequest/);
  assert.doesNotMatch(schemas, /user_id|api[_-]?key|credential|sql/i);
});

test("Phase 6 cards and prompt keep billing labels and safe card confirmation", () => {
  const root = process.cwd();
  const ui = fs.readFileSync(path.join(root, "app/app/chat/components/chat-client.tsx"), "utf8");
  const prompt = fs.readFileSync(path.join(root, "lib/agent/orchestrator-prompt.ts"), "utf8");
  const migration = fs.readFileSync(path.join(root, "db/migrations/0004_salesengai_phase8.sql"), "utf8");
  assert.match(ui, /Bolna provider spend — billed directly by Bolna/);
  assert.match(ui, /SalesEngAI platform credits are separate/);
  assert.match(ui, /tool-confirmations/);
  assert.match(ui, /Confirm Call Again/);
  assert.match(prompt, /Never infer consent/);
  assert.match(prompt, /Never claim an action occurred/);
  assert.match(migration, /add column if not exists approval_id/i);
  assert.match(migration, /lead_followups_due_idx/);
});
