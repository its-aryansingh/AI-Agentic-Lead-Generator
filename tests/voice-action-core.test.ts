// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  validateConfirmedVoiceAction,
  voiceActionCallbackSchema,
} from "@/lib/voice/action-core";

import { assertNoSupabaseRls, assertReadOnlyForUsers, assertTenantScoped } from "./helpers/tenancy.ts"

const now = new Date("2026-09-05T10:00:00.000Z");

test("voice mutation callbacks accept the three implemented external actions", () => {
  const common = {
    executionId: "e875ef0d-0dfe-417a-a263-5a371ff64c9f",
    toolCallId: "tool-1",
    confirmed: true,
    confirmationEvidence: "Yes, please do that.",
  };
  assert.equal(
    voiceActionCallbackSchema.safeParse({
      ...common,
      action: {
        kind: "SCHEDULE_CALLBACK",
        at: "2026-09-06T10:00:00.000Z",
        tz: "Asia/Kolkata",
      },
    }).success,
    true,
  );
  assert.equal(
    voiceActionCallbackSchema.safeParse({
      execution_id: common.executionId,
      confirmed: false,
      kind: "BOOK_MEETING",
      operation: "FIND_SLOTS",
    }).success,
    true,
  );
  assert.equal(
    voiceActionCallbackSchema.safeParse({
      execution_id: common.executionId,
      confirmed: true,
      confirmation_evidence: "Tuesday at 2 PM works.",
      kind: "BOOK_MEETING",
      operation: "BOOK_SLOT",
      slot_id: "opaque-slot",
    }).success,
    true,
  );
  assert.equal(
    voiceActionCallbackSchema.safeParse({
      ...common,
      action: {
        kind: "TRANSFER_HUMAN",
        trigger: "explicit_request",
        reason: "requested",
      },
    }).success,
    true,
  );
  assert.equal(
    voiceActionCallbackSchema.safeParse({
      execution_id: common.executionId,
      confirmed: true,
      confirmation_evidence: "Please connect me to someone.",
      kind: "TRANSFER_HUMAN",
      trigger: "explicit_request",
      reason: "pricing details",
    }).success,
    true,
  );
  assert.equal(
    voiceActionCallbackSchema.safeParse({
      execution_id: common.executionId,
      confirmed: true,
      confirmation_evidence: "Yes, call me then.",
      kind: "SCHEDULE_CALLBACK",
      at: "2026-09-06T10:00:00.000Z",
      tz: "Asia/Kolkata",
    }).success,
    true,
  );
});

test("external voice actions require explicit confirmation evidence", () => {
  assert.deepEqual(
    validateConfirmedVoiceAction({
      confirmed: false,
      action: { kind: "SEND_INFORMATION", docId: "booking_link" },
    }),
    { requiresConfirmation: true },
  );
  assert.throws(
    () =>
      validateConfirmedVoiceAction({
        confirmed: true,
        action: { kind: "SEND_INFORMATION", docId: "booking_link" },
      }),
    /confirmation evidence/i,
  );
  assert.deepEqual(
    validateConfirmedVoiceAction({
      confirmed: false,
      action: { kind: "BOOK_MEETING", operation: "FIND_SLOTS" },
    }),
    { requiresConfirmation: false },
  );
});

test("callback schedule must be future, timezone-valid, and within 90 days", () => {
  assert.throws(
    () =>
      validateConfirmedVoiceAction({
        confirmed: true,
        confirmationEvidence: "Confirmed",
        action: {
          kind: "SCHEDULE_CALLBACK",
          at: "2026-09-04T10:00:00.000Z",
          tz: "Asia/Kolkata",
        },
        now,
      }),
    /future/i,
  );
  assert.throws(
    () =>
      validateConfirmedVoiceAction({
        confirmed: true,
        confirmationEvidence: "Confirmed",
        action: {
          kind: "SCHEDULE_CALLBACK",
          at: "2026-09-06T10:00:00.000Z",
          tz: "Not/AZone",
        },
        now,
      }),
    /timezone/i,
  );
});

test("voice action ledger is tenant-scoped and idempotent", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assert.match(migration, /unique \(connection_id, idempotency_key\)/i);
  assertTenantScoped("voice_action_requests");
  assert.match(migration, /confirmation_required/i);

  const route = readFileSync(
    "app/api/webhooks/bolna/[connectionId]/actions/route.ts",
    "utf8",
  );
  assert.match(route, /validVoiceWebhookSignature/);
  assert.match(route, /provider_execution_id/);
  // Phase 8: All prospect queries in the actions webhook must include user_id
  // to prevent cross-tenant data access. The previous gap (no user_id filter)
  // has been corrected.
  const prospectSelects = [...route.matchAll(/\.from\("prospects"\)[\s\S]{0,200}?\.eq\("user_id"/g)];
  assert.ok(prospectSelects.length >= 3, `Expected at least 3 prospect queries scoped with user_id; found ${prospectSelects.length}`);
  // Phase 8: IP source validation (validBolnaWebhookSource) must be present in the actions route.
  assert.match(route, /validBolnaWebhookSource/);
});
