/**
 * AI configuration — server-only.
 *
 * Key change from Day 8: Aravya's platform API keys (env vars) are ALWAYS
 * used. Customer-supplied keys (ai_provider_connections) are no longer read.
 * The ai_provider_connections table is kept in the DB but the UI no longer
 * writes to it.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createAdminClient } from "@/lib/supabase/server";
import {
  allowedAiModel,
  defaultAiModel,
  type AiProvider,
  type AiPurpose,
} from "@/lib/ai-config-core";
import { creditsForOperation } from "@/lib/credit-costs";
import { deductCredits } from "@/lib/credits";
import { generateText } from "ai";

export interface ResolvedAiModel {
  provider: AiProvider;
  modelId: string;
  model:
    | ReturnType<ReturnType<typeof createAnthropic>>
    | ReturnType<ReturnType<typeof createOpenAI>>;
}

/** Constructs an AI SDK model instance using Aravya's platform key. */
export function createAiModel(
  provider: AiProvider,
  apiKey: string,
  modelId: string,
) {
  return provider === "openai"
    ? createOpenAI({ apiKey })(modelId)
    : createAnthropic({ apiKey })(modelId);
}

/**
 * Resolves the AI model to use for a given user and purpose.
 *
 * Priority:
 *   1. User's model preference from ai_preferences (provider + per-purpose model)
 *   2. Default model for the env-configured provider
 *
 * API key: ALWAYS Aravya's platform key from env — never decrypted from DB.
 */
export async function resolveAiModel(
  userId: string,
  purpose: AiPurpose,
): Promise<ResolvedAiModel | null> {
  let preference: Record<string, unknown> | null = null;
  if (userId) {
    try {
      const admin = createAdminClient();
      const { data } = await admin
        .from("ai_preferences")
        .select("active_provider,chat_model,research_model,writing_model")
        .eq("user_id", userId)
        .maybeSingle();
      preference = data;
    } catch {}
  }

  // Determine provider: preference → env fallback
  const provider = (preference?.active_provider ??
    (process.env.ANTHROPIC_API_KEY
      ? "anthropic"
      : process.env.OPENAI_API_KEY
        ? "openai"
        : null)) as AiProvider | null;
  if (!provider) return null;

  // Always Aravya's platform key
  const apiKey =
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const purposeKey = `${purpose}_model` as
    | "chat_model"
    | "research_model"
    | "writing_model";
  const selected = String(preference?.[purposeKey] ?? "");
  const modelId = allowedAiModel(provider, selected)
    ? selected
    : defaultAiModel(provider, purpose);

  const model = createAiModel(provider, apiKey, modelId);
  return { provider, modelId, model };
}

/**
 * Deducts credits for a completed AI operation.
 * Looks up the credit cost from credit-costs.ts for the given model + purpose.
 * Best-effort: never throws or blocks the caller.
 */
export async function deductCreditsForAiOp(opts: {
  userId: string;
  modelId: string;
  purpose: AiPurpose;
  jobId?: string;
  operationLabel?: string;
}): Promise<void> {
  const { userId, modelId, purpose, jobId, operationLabel } = opts;
  const credits = creditsForOperation(modelId, purpose);
  if (credits <= 0) return;
  try {
    await deductCredits({
      userId,
      count: credits,
      jobId: jobId ?? "system",
      reason: operationLabel ?? `ai_op_${purpose}_${modelId}`,
    });
  } catch {}
}

/**
 * Quick verification that the platform key resolves and the model responds.
 * Used from the readiness dashboard only.
 */
export async function verifyPlatformKey(
  provider: AiProvider,
): Promise<boolean> {
  const apiKey =
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return false;
  try {
    const modelId =
      provider === "openai" ? "gpt-4o-mini" : "claude-haiku-4-5-20251001";
    await generateText({
      model: createAiModel(provider, apiKey, modelId),
      prompt: "Reply with exactly OK.",
      maxOutputTokens: 8,
    });
    return true;
  } catch {
    return false;
  }
}

/** Records an AI operation in the usage audit table. */
export async function recordAiUsage(input: {
  userId: string;
  provider: AiProvider;
  model: string;
  operation: string;
  status: "completed" | "failed";
  inputTokens?: number;
  outputTokens?: number;
  requestId?: string;
  durationMs: number;
  errorCode?: string;
  creditCost?: number;
}) {
  try {
    await createAdminClient()
      .from("ai_usage_events")
      .insert({
        user_id: input.userId,
        provider: input.provider,
        model: input.model,
        operation: input.operation,
        status: input.status,
        input_tokens: input.inputTokens ?? null,
        output_tokens: input.outputTokens ?? null,
        provider_request_id: input.requestId ?? null,
        duration_ms: input.durationMs,
        error_code: input.errorCode ?? null,
      });
  } catch {}
}
