/**
 * Headless orchestrator run — drives the same orchestrator (prompt + run_*
 * delegations) as the chat route, but without a UI stream. Used by the
 * automation worker so a scheduled automation executes the full AI BDR team
 * exactly like an interactive request would.
 *
 * Mock-safe: with no Anthropic key it returns a deterministic placeholder
 * (the chat route's mock branch behaves the same way).
 */

import { generateText, stepCountIs } from "ai";

import { getChatModel } from "@/lib/providers/anthropic";
import { recordAiUsage, deductCreditsForAiOp } from "@/lib/ai-config";
import { safeAiError } from "@/lib/ai-config-core";
import { ORCHESTRATOR_PROMPT } from "@/lib/agent/orchestrator-prompt";
import { makeOrchestratorTools } from "@/lib/agent/orchestrator-tools";
import type { ToolContext } from "@/lib/agent/tools";

export interface OrchestrationResult {
  summary: string;
  steps: number;
  used_mock: boolean;
  error?: string;
}

export async function runOrchestration(
  instruction: string,
  ctx: ToolContext,
): Promise<OrchestrationResult> {
  const resolved = await getChatModel(ctx.userId);
  if (!resolved) {
    return {
      summary: `[demo] Orchestrator would run: ${instruction.slice(0, 160)}`,
      steps: 0,
      used_mock: true,
    };
  }

  try {
    const result = await generateText({
      model: resolved.model,
      system: ORCHESTRATOR_PROMPT,
      prompt: instruction,
      tools: makeOrchestratorTools(ctx),
      stopWhen: stepCountIs(10),
    });
    await recordAiUsage({
      userId: ctx.userId,
      provider: resolved.provider,
      model: resolved.modelId,
      operation: "automation_orchestration",
      status: "completed",
      durationMs: 0,
    });
    await deductCreditsForAiOp({
      userId: ctx.userId,
      modelId: resolved.modelId,
      purpose: "chat",
      operationLabel: "automation_orchestration",
    });
    return {
      summary: result.text,
      steps: result.steps?.length ?? 1,
      used_mock: false,
    };
  } catch (err) {
    await recordAiUsage({
      userId: ctx.userId,
      provider: resolved.provider,
      model: resolved.modelId,
      operation: "automation_orchestration",
      status: "failed",
      durationMs: 0,
      errorCode: safeAiError(err),
    });
    return {
      summary: "",
      steps: 0,
      used_mock: false,
      error: err instanceof Error ? err.message : "orchestration failed",
    };
  }
}
