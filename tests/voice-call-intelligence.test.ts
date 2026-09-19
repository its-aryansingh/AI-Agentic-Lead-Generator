// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { validBolnaWebhookSource } from "@/lib/voice-compliance";
import { aggregateVoiceAnalytics, addDecimalStrings } from "@/lib/voice/voice-analytics";

test("Bolna fractional cost keeps documented cents without rounding", () => {
  const outcome = fs.readFileSync(path.join(process.cwd(), "lib/voice-outcome.ts"), "utf8");
  assert.match(outcome, /return \/\^\\d\+\(\?:\\\.\\d\+\)\?\$\/.test\(text\) \? text : null/);
  assert.doesNotMatch(outcome, /Math\.round\(Number\(payload\.total_cost/);
  assert.equal(addDecimalStrings("0.125", "0.875"), "1");
});

test("analytics keeps currencies separate and uses all provider accepted calls as denominator", () => {
  const result = aggregateVoiceAnalytics([
    { answered: true, duration_seconds: 60, cost_currency: "USD", cost_minor_units: "1.25" },
    { answered: false, duration_seconds: 0, cost_currency: "USD", cost_minor_units: "0.75" },
    { answered_at: "2026-09-06T00:00:00Z", duration_seconds: 30, cost_currency: "INR", cost_minor_units: "2.5" },
  ]);
  assert.equal(result.totalCalls, 3);
  assert.equal(result.answeredCalls, 2);
  assert.equal(result.answerRate, 2 / 3);
  assert.equal(result.totalDurationSeconds, 90);
  assert.deepEqual(result.currencyTotals, [
    { currency: "USD", costMinorUnits: "2" },
    { currency: "INR", costMinorUnits: "2.5" },
  ]);
  assert.equal(result.totalBolnaCostMinorUnits, "0");
});

test("webhook provider-source contract rejects an unexpected documented source", () => {
  assert.equal(validBolnaWebhookSource(new Headers({ "x-vercel-forwarded-for": "13.203.39.153" })), true);
  assert.equal(validBolnaWebhookSource(new Headers({ "x-vercel-forwarded-for": "203.0.113.8" })), false);
});

test("Phase 5 migration, API routes, and dashboard preserve tenant boundaries and billing labels", () => {
  const root = process.cwd();
  const migration = fs.readFileSync(path.join(root, "db/migrations/0004_salesengai_phase8.sql"), "utf8");
  assert.match(migration, /numeric\(20, 6\)/);
  assert.match(migration, /provider_metadata jsonb/);
  const details = fs.readFileSync(path.join(root, "app/api/voice/executions/[id]/route.ts"), "utf8");
  const recording = fs.readFileSync(path.join(root, "app/api/voice/executions/[id]/recording/route.ts"), "utf8");
  const dashboard = fs.readFileSync(path.join(root, "app/app/leads/calls/calls-dashboard-client.tsx"), "utf8");
  assert.match(details, /\.eq\("user_id", user\.id\)/);
  assert.match(recording, /\.eq\("user_id", user\.id\)/);
  assert.match(dashboard, /Bolna provider spend — billed directly by Bolna/);
  assert.match(dashboard, /SalesEngAI platform credits/);
});
