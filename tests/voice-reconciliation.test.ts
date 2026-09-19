// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  decideVoiceReconciliation,
  shouldAlertVoiceReconciliation,
  reconciliationBackoffMs,
  VOICE_RECONCILIATION_ORPHAN_MS,
} from "@/lib/voice/reconciliation-core";

const now = new Date("2026-09-05T12:00:00.000Z");

function execution(overrides: Record<string, unknown> = {}) {
  return {
    provider_execution_id: "provider-1",
    temporal_workflow_id: null,
    status: "in_progress" as const,
    created_at: "2026-09-05T11:50:00.000Z",
    ...overrides,
  };
}

test("provider-backed stale calls are polled", () => {
  assert.equal(decideVoiceReconciliation(execution(), now), "poll_provider");
});

test("Temporal-owned calls without a provider ID are not falsely failed", () => {
  assert.equal(
    decideVoiceReconciliation(
      execution({
        provider_execution_id: null,
        temporal_workflow_id: "voice-workflow-1",
        status: "queued",
      }),
      now,
    ),
    "skip_workflow",
  );
});

test("recent terminal executions reconcile once, then stop polling", () => {
  assert.equal(
    decideVoiceReconciliation(
      execution({ status: "completed", reconciliation_attempts: 0 }),
      now,
    ),
    "poll_provider",
  );
  assert.equal(
    decideVoiceReconciliation(
      execution({
        status: "completed",
        reconciliation_attempts: 0,
        last_reconciled_at: "2026-09-05T11:00:00.000Z",
        reconciliation_error: null,
      }),
      now,
    ),
    "skip_terminal",
  );
});

test("old direct requests without a provider ID become operational orphans", () => {
  assert.equal(
    decideVoiceReconciliation(
      execution({
        provider_execution_id: null,
        status: "queued",
        created_at: new Date(
          now.getTime() - VOICE_RECONCILIATION_ORPHAN_MS,
        ).toISOString(),
      }),
      now,
    ),
    "fail_orphan",
  );
});

test("provider failures alert once after three consecutive attempts", () => {
  assert.equal(shouldAlertVoiceReconciliation(2, null), false);
  assert.equal(shouldAlertVoiceReconciliation(3, null), true);
  assert.equal(
    shouldAlertVoiceReconciliation(4, "2026-09-05T11:00:00.000Z"),
    false,
  );
});

test("reconciliation uses bounded exponential backoff before polling again", () => {
  assert.equal(reconciliationBackoffMs(0), 30_000);
  assert.equal(reconciliationBackoffMs(100), 30 * 60 * 1000);
  assert.equal(
    decideVoiceReconciliation(
      execution({
        last_reconciled_at: "2026-09-05T11:59:45.000Z",
        reconciliation_attempts: 0,
      }),
      now,
    ),
    "wait",
  );
});

test("reconciliation migration and cron schedule are registered", () => {
  const migration = fs.readFileSync(
    path.join(
      process.cwd(),
      "db/migrations/0004_salesengai_phase8.sql",
    ),
    "utf8",
  );
  assert.match(migration, /reconciliation_attempts/);
  assert.match(migration, /status in \('queued', 'in_progress', 'finalizing'\)/);

  const vercel = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
  ) as { crons: Array<{ path: string; schedule: string }> };
  assert.ok(
    vercel.crons.some(
      (cron) => cron.path === "/api/cron/reconcile-voice-calls",
    ),
  );
});
