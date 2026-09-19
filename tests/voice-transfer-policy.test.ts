// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  evaluateTransferAvailability,
  extractBolnaTransferReceipt,
} from "@/lib/voice/transfer-policy";

const policy = {
  enabled: true,
  phone: "+919876543210",
  timezone: "Asia/Kolkata",
  startHour: 9,
  endHour: 18,
  weekdays: [1, 2, 3, 4, 5],
  fallback: "schedule_callback" as const,
};

test("human transfer is available only inside the configured local window", () => {
  assert.equal(
    evaluateTransferAvailability(
      policy,
      new Date("2026-09-07T05:00:00.000Z"),
    ).allowed,
    true,
  );
  const unavailable = evaluateTransferAvailability(
    policy,
    new Date("2026-09-06T05:00:00.000Z"),
  );
  assert.equal(unavailable.allowed, false);
  assert.equal(unavailable.reason, "HUMAN_UNAVAILABLE");
  assert.match(unavailable.instruction, /callback/i);
});

test("disabled transfer fails closed even during business hours", () => {
  const result = evaluateTransferAvailability(
    { ...policy, enabled: false },
    new Date("2026-09-07T05:00:00.000Z"),
  );
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "TRANSFER_DISABLED");
});

test("Bolna transfer progression produces a provider receipt without exposing its number", () => {
  assert.deepEqual(
    extractBolnaTransferReceipt({
      progression_data: {
        transfer_call_events: [
          {
            type: "transfer_start",
            tool_call_id: "transfer-1",
            transfer_number: "+919876543210",
          },
          {
            type: "transfer_end",
            tool_call_id: "transfer-1",
            status_code: 200,
            success: true,
          },
        ],
      },
    }),
    {
      toolCallId: "transfer-1",
      statusCode: 200,
      success: true,
      destinationPresent: true,
      started: true,
      finished: true,
    },
  );
});

test("live-transfer schema stores availability and provider outcome fields", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assert.match(migration, /transfer_enabled boolean not null default false/i);
  assert.match(migration, /transfer_weekdays int\[\]/i);
  assert.match(migration, /provider_success boolean/i);
});

