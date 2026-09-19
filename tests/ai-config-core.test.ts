import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_MODELS,
  allowedAiModel,
  defaultAiModel,
  safeAiError,
  isKnownModel,
  modelTier,
} from "@/lib/ai-config-core";

test("AI model choices are allowlisted per provider", () => {
  assert.equal(allowedAiModel("openai", "gpt-4o"), true);
  assert.equal(allowedAiModel("openai", "gpt-4o-mini"), true);
  assert.equal(allowedAiModel("openai", "gpt-4.1"), true);
  assert.equal(allowedAiModel("openai", "o4-mini"), true);
  assert.equal(allowedAiModel("anthropic", "gpt-4o"), false);
  assert.equal(allowedAiModel("anthropic", "claude-sonnet-4-6"), true);
  assert.equal(allowedAiModel("anthropic", "claude-sonnet-5"), true);
  assert.equal(allowedAiModel("anthropic", "claude-opus-5"), true);
  assert.equal(allowedAiModel("openai", "arbitrary-expensive-model"), false);
});

test("every purpose has an allowed default", () => {
  for (const provider of ["openai", "anthropic"] as const) {
    for (const purpose of ["chat", "research", "writing"] as const) {
      assert.equal(
        allowedAiModel(provider, defaultAiModel(provider, purpose)),
        true,
      );
    }
  }
  assert.ok(AI_MODELS.length === 9, "9 models in the catalog");
  assert.ok(AI_MODELS.filter((m) => m.provider === "openai").length >= 4);
  assert.ok(AI_MODELS.filter((m) => m.provider === "anthropic").length >= 4);
});

test("isKnownModel identifies all 9 models", () => {
  assert.equal(isKnownModel("gpt-4o-mini"), true);
  assert.equal(isKnownModel("claude-opus-5"), true);
  assert.equal(isKnownModel("unknown-model-xyz"), false);
});

test("model tiers map correctly", () => {
  assert.equal(modelTier("gpt-4o-mini"), "economy");
  assert.equal(modelTier("claude-haiku-4-5-20251001"), "economy");
  assert.equal(modelTier("gpt-4o"), "standard");
  assert.equal(modelTier("claude-sonnet-4-6"), "standard");
  assert.equal(modelTier("gpt-4.1"), "standard_plus");
  assert.equal(modelTier("claude-sonnet-5"), "standard_plus");
  assert.equal(modelTier("claude-opus-5"), "premium");
  assert.equal(modelTier("o4-mini"), "premium");
});

test("provider errors are sanitized", () => {
  assert.equal(
    safeAiError(new Error("401 invalid API key sk-secret")),
    "authentication_failed",
  );
  assert.equal(
    safeAiError(new Error("429 quota reached")),
    "quota_or_rate_limit",
  );
  assert.equal(
    safeAiError(new Error("model_not_found")),
    "model_unavailable",
  );
  assert.equal(
    safeAiError(new Error("provider request timed out")),
    "provider_timeout",
  );
});
