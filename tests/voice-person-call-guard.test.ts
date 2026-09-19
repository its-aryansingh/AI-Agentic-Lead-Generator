// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync("db/migrations/0004_salesengai_phase8.sql", "utf8");
const scopeGuard = readFileSync("db/migrations/0004_salesengai_phase8.sql", "utf8");
const service = readFileSync("lib/voice/start-qualification-call.ts", "utf8");
const temporalClient = readFileSync("lib/temporal/client.ts", "utf8");
// backend-python/ was not ported — Temporal is an always-on service, not
// a library, and voice_connections.temporal_enabled stays false here. The
// assertions that read the Python workflow are pointed at the direct call
// path instead, which is the one this deployment actually runs.
const pythonWorkflow = readFileSync("lib/voice/start-qualification-call.ts", "utf8");

test("default person guard is tenant-scoped and enforced by a database partial unique index", () => {
  assert.match(migration, /voice_one_default_attempt_per_person_idx/);
  assert.match(migration, /on public\.voice_executions\(user_id, recipient_phone_hash\)/);
  assert.match(migration, /counts_toward_call_limit = true and is_override = false/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /reserve_voice_execution/);
});

test("reservations are idempotent, retain local failures, and expose an owned already-called result", () => {
  assert.match(migration, /request_idempotency_key/);
  assert.match(migration, /status = 'failed' and provider_status = 'request_failed'/);
  assert.match(migration, /counts_toward_call_limit = false/);
  assert.doesNotMatch(service, /\.delete\(\)\s*\.eq\("id", previous\.id\)/);
  assert.match(service, /disposition === "already_called"/);
  assert.match(service, /\.eq\("user_id", userId\)/);
});

test("override needs a meaningful reason, a confirmed approval, and an immutable audit record", () => {
  assert.match(service, /override_reason_required/);
  assert.match(service, /override_approval_required/);
  assert.match(migration, /voice_call_override_audits/);
  assert.match(migration, /voice call override audits are immutable/);
  assert.match(migration, /confirmed_at is not null[\s\S]*consumed_at is null/);
  assert.match(migration, /override_of_execution_id/);
  assert.match(scopeGuard, /Override approval does not explicitly cover this prospect/);
});

test("override authorization evidence survives the call path", () => {
  // The original asserted this across the Temporal client AND the Python
  // workflow. backend-python/ is not ported, so the second half is
  // checked on the direct path instead — the one that actually places
  // calls here. The evidence that matters is the same: an override must
  // carry its reason and its approval id all the way to the provider,
  // never just a boolean.
  for (const field of ["allowOverride", "overrideReason", "approvalId", "idempotencyKey"]) {
    assert.match(temporalClient, new RegExp(field));
  }
  // The direct path is TypeScript, so the same fields are camelCase.
  for (const field of ["allowOverride", "overrideReason", "approvalId", "idempotencyKey"]) {
    assert.match(pythonWorkflow, new RegExp(field));
  }
  // And the stub must refuse rather than drop the call silently.
  assert.match(temporalClient, /throw new Error\(NOT_WIRED\)/);
});

test("absolute compliance checks remain before the reservation and provider credential decryption", () => {
  const reserveAt = service.indexOf('rpc("reserve_voice_execution"');
  assert.ok(service.indexOf("normalizeE164") < reserveAt);
  assert.ok(service.indexOf('from("phone_suppressions")') < reserveAt);
  assert.ok(service.indexOf("withinCallingHours") < reserveAt);
  assert.ok(service.lastIndexOf("decryptCredential") > reserveAt);
});
