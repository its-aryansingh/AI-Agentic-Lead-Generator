import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODEL_CREDIT_COSTS,
  CREDIT_PACKS,
  creditsForOperation,
  enrichmentBundleCredits,
  planCanUseModel,
} from "@/lib/credit-costs";

test("credit costs are defined and positive for all models across all purposes", () => {
  const modelIds = Object.keys(MODEL_CREDIT_COSTS);
  assert.ok(modelIds.length >= 9, "at least 9 models configured");

  for (const modelId of modelIds) {
    const costs = MODEL_CREDIT_COSTS[modelId];
    assert.ok(costs.research >= 1, `${modelId} research credit cost >= 1`);
    assert.ok(costs.writing >= 1, `${modelId} writing credit cost >= 1`);
    assert.ok(costs.chat >= 1, `${modelId} chat credit cost >= 1`);

    // Writing/chat should be >= research cost for that model
    assert.ok(costs.writing >= costs.research);
    assert.ok(costs.chat >= costs.research);
  }
});

test("economy models have 1 credit cost for research and 1-2 for writing", () => {
  assert.equal(creditsForOperation("gpt-4o-mini", "research"), 1);
  assert.equal(creditsForOperation("gpt-4o-mini", "writing"), 1);
  assert.equal(creditsForOperation("gpt-4o-mini", "chat"), 1);

  assert.equal(creditsForOperation("claude-haiku-4-5-20251001", "research"), 1);
  assert.equal(creditsForOperation("claude-haiku-4-5-20251001", "writing"), 2);
  assert.equal(creditsForOperation("claude-haiku-4-5-20251001", "chat"), 2);
});

test("standard and premium models have higher credit costs matching LLM pricing", () => {
  assert.equal(creditsForOperation("claude-sonnet-4-6", "writing"), 5);
  assert.equal(creditsForOperation("gpt-4o", "writing"), 4);
  assert.equal(creditsForOperation("claude-opus-5", "writing"), 10);
  assert.equal(creditsForOperation("claude-opus-5", "chat"), 14);
});

test("enrichment bundle credits scale with model tier", () => {
  assert.equal(enrichmentBundleCredits("gpt-4o-mini"), 3);
  assert.equal(enrichmentBundleCredits("claude-haiku-4-5-20251001"), 3);
  assert.equal(enrichmentBundleCredits("claude-sonnet-4-6"), 8);
  assert.equal(enrichmentBundleCredits("gpt-4o"), 8);
  assert.equal(enrichmentBundleCredits("claude-sonnet-5"), 6);
  assert.equal(enrichmentBundleCredits("claude-opus-5"), 20);
});

test("plan access checks enforce model tiers", () => {
  // Free plan: economy only
  assert.equal(planCanUseModel("free", "gpt-4o-mini"), true);
  assert.equal(planCanUseModel("free", "claude-haiku-4-5-20251001"), true);
  assert.equal(planCanUseModel("free", "claude-sonnet-4-6"), false);
  assert.equal(planCanUseModel("free", "claude-opus-5"), false);

  // Starter plan: economy + standard
  assert.equal(planCanUseModel("starter", "gpt-4o-mini"), true);
  assert.equal(planCanUseModel("starter", "claude-sonnet-4-6"), true);
  assert.equal(planCanUseModel("starter", "claude-opus-5"), false);

  // Pro & Team & Enterprise: all models
  assert.equal(planCanUseModel("professional", "claude-opus-5"), true);
  assert.equal(planCanUseModel("team", "claude-opus-5"), true);
  assert.equal(planCanUseModel("enterprise", "claude-opus-5"), true);
});

test("credit pack pricing is consistent and provides volume discounts", () => {
  assert.equal(CREDIT_PACKS.length, 5);

  let prevPerCredit = Infinity;
  for (const pack of CREDIT_PACKS) {
    assert.ok(pack.credits > 0);
    assert.ok(pack.priceInr > 0);
    assert.ok(pack.priceUsd > 0);
    // Larger packs should have lower or equal per-credit rate
    assert.ok(
      pack.perCreditInr <= prevPerCredit,
      `Volume discount on ${pack.id}`,
    );
    prevPerCredit = pack.perCreditInr;
  }
});
