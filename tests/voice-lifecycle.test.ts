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
  isFinishedVoiceOutcome,
  isTerminalVoiceExecutionStatus,
} from "@/lib/voice/outcome-state";

test("completed artifacts remain retryable until qualification outcome is saved", () => {
  assert.equal(
    isFinishedVoiceOutcome({
      status: "completed",
      providerStatus: "completed",
      outcome: null,
      incomingProviderStatus: "completed",
      eventKind: "completed",
    }),
    false,
  );
  assert.equal(
    isFinishedVoiceOutcome({
      status: "completed",
      providerStatus: "completed",
      outcome: "interested",
      incomingProviderStatus: "completed",
      eventKind: "completed",
    }),
    true,
  );
});

test("UI terminal state follows app finalization, not provider completion", () => {
  assert.equal(isTerminalVoiceExecutionStatus("finalizing"), false);
  assert.equal(isTerminalVoiceExecutionStatus("completed"), true);
  assert.equal(isTerminalVoiceExecutionStatus("failed"), true);
  assert.equal(isTerminalVoiceExecutionStatus("cancelled"), true);
});

test("provider artifacts finalize before the qualification outcome becomes terminal", () => {
  const source = fs.readFileSync("lib/voice-outcome.ts", "utf8");
  assert.match(
    source,
    /if \(event\.kind === "completed"\)[\s\S]*?status: "finalizing"/,
  );
  assert.match(
    source,
    /status: "completed",\s*outcome: classification\.category/,
  );
});

test("non-terminal call-disconnected events are never discarded as duplicates", () => {
  assert.equal(
    isFinishedVoiceOutcome({
      status: "finalizing",
      providerStatus: "call-disconnected",
      outcome: null,
      incomingProviderStatus: "call-disconnected",
      eventKind: "answered",
    }),
    false,
  );
});

test("voice lifecycle migration permits finalizing and human review actions", () => {
  const sql = fs.readFileSync(
    path.join(
      process.cwd(),
      "db/migrations/0004_salesengai_phase8.sql",
    ),
    "utf8",
  );
  assert.match(sql, /'finalizing'/);
  assert.match(sql, /'review_call_outcome'/);
  assert.match(sql, /'human_review'/);
});
