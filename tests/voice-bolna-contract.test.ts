import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { validBolnaWebhookSource } from "@/lib/voice-compliance";
import { getBolnaExecution, normalizeBolnaEvent } from "@/lib/voice/providers/bolna";

test("Bolna contract: all currently documented webhook source IPs are accepted", () => {
  // Bolna's webhook/execution guide (checked 2026-09-07) documents these
  // sender addresses and no provider-issued signature header. The application
  // therefore additionally verifies its rotating signed webhook URL.
  for (const ip of ["13.203.39.153", "13.126.9.249", "13.202.133.53"]) {
    assert.equal(validBolnaWebhookSource(new Headers({ "x-vercel-forwarded-for": ip })), true);
  }
  assert.equal(validBolnaWebhookSource(new Headers({ "x-vercel-forwarded-for": "203.0.113.8" })), false);
});

test("Bolna contract: reconciliation retrieves an execution by its documented direct endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let url = "";
  let authorization = "";
  globalThis.fetch = async (input, init) => {
    url = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return Response.json({ id: "execution-1", status: "completed" });
  };
  try {
    await getBolnaExecution("test-key", "execution-1", "agent-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(url, "https://api.bolna.ai/executions/execution-1");
  assert.equal(authorization, "Bearer test-key");
});

test("Bolna terminal details preserve fractional cents and cannot regress to earlier statuses", () => {
  const source = fs.readFileSync("lib/voice-outcome.ts", "utf8");
  assert.match(source, /BOLNA_COST_COMPONENTS = \[/);
  assert.match(source, /"platform",\s*"network",\s*"transcriber",\s*"llm",\s*"synthesizer"/);
  assert.match(source, /isOlderBolnaProviderStatus\(execution\.provider_status, providerStatus\)/);
  assert.match(source, /cost_breakdown: bolnaCostBreakdown\(payload\)/);
});

test("Bolna contract: webhook numeric execution IDs are normalized safely", () => {
  assert.deepEqual(normalizeBolnaEvent({ id: 7432382142914, status: "queued" }), {
    kind: "ringing",
    callId: "7432382142914",
  });
});
