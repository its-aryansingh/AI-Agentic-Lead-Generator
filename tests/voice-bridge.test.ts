// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { nextCallingWindow } from "@/lib/voice-compliance";
import { validTemporalBridgeAuthorization } from "@/lib/voice/bridge-auth";

test("Temporal bridge authentication fails closed and compares bearer secrets", () => {
  const secret = "a-secure-test-secret-with-32-characters";
  assert.equal(validTemporalBridgeAuthorization(`Bearer ${secret}`, secret), true);
  assert.equal(validTemporalBridgeAuthorization("Bearer wrong", secret), false);
  assert.equal(validTemporalBridgeAuthorization(null, secret), false);
  assert.equal(validTemporalBridgeAuthorization("Bearer short", "short"), false);
});

test("next calling window uses the configured recipient timezone", () => {
  const now = new Date("2026-09-03T00:10:05.000Z"); // 05:40 Asia/Kolkata
  assert.equal(
    nextCallingWindow(now, "Asia/Kolkata", 9, 18).toISOString(),
    "2026-09-03T03:30:00.000Z",
  );
  const afterHours = new Date("2026-09-03T14:00:00.000Z"); // 19:30
  assert.equal(
    nextCallingWindow(afterHours, "Asia/Kolkata", 9, 18).toISOString(),
    "2026-09-04T03:30:00.000Z",
  );
});

test("Temporal voice cutover is disabled by default and decisions are immutable", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assert.match(migration, /temporal_enabled boolean not null default false/i);
  assert.match(migration, /voice_compliance_decisions/i);
  assert.match(migration, /before update or delete/i);
  assert.match(migration, /unique\(voice_execution_id, check_sequence\)/i);
});

// REMOVED during the SalesEngAIMVP port, for two reasons.
//
// It read app/api/internal/voice/activities/[activityName]/route.ts, the
// Temporal worker's callback into Next, which was not ported with the
// rest of the Temporal stack.
//
// More importantly the assertion is now false by design: it checked that
// the bridge never queries prospects.user_id BECAUSE that column did not
// exist. db/migrations/0004_salesengai_phase8.sql adds it, backfills it
// and makes it NOT NULL, and lib/db/rls.ts now owns prospects through
// exactly that column. Restoring this test would assert the opposite of
// what the schema guarantees.

test("direct and Temporal call paths pass seller and bounded policy context", () => {
  const direct = readFileSync("lib/voice/start-qualification-call.ts", "utf8");
  // app/api/internal/voice/activities/ is the Temporal worker's callback
  // into Next and was not ported with the rest of the Temporal stack.
  // The assertion holds for the direct path, which is the one that
  // places calls on this deployment.
  for (const source of [direct]) {
    assert.match(source, /\.from\("customer_contexts"\)/);
    assert.match(source, /seller_company:/);
    assert.match(source, /max_call_seconds:/);
    assert.match(source, /max_turns:/);
    assert.match(source, /max_objection_attempts:/);
    assert.match(source, /human_transfer_phone:/);
  }
});
