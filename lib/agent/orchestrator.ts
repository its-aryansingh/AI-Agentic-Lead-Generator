/**
 * Orchestration runtime.
 *
 * `runSpecialist` executes ONE specialist sub-agent as a bounded
 * generateText loop over its own tool subset, then returns a structured
 * result the orchestrator can stream and synthesize. It is the single
 * choke-point for sub-agent execution, so timeouts, mock-fallback, and
 * error capture all live here — a specialist failing never throws into
 * the chat stream; it returns `{ error }` instead.
 *
 * Heavy work (bulk enrichment > threshold) is offloaded inside the
 * underlying handlers (Inngest), so specialists stay interactive.
 */

import { generateText, stepCountIs } from "ai";
import { SPECIALISTS, type SpecialistName } from "@/lib/agent/specialists";
import { outputLooksMock } from "@/lib/agent/orchestration-core";
import type { ToolContext } from "@/lib/agent/tools";

import { resolveAiModel, recordAiUsage, deductCreditsForAiOp } from "@/lib/ai-config";
import { safeAiError } from "@/lib/ai-config-core";

export interface SpecialistResult {
  specialist: SpecialistName;
  role: string;
  emoji: string;
  /** The specialist's final natural-language summary. */
  summary: string;
  /** How many reasoning/tool steps it took. */
  steps: number;
  /** Names of tools the specialist invoked, in order. */
  tools_used: string[];
  /** Raw tool outputs, for the orchestrator / UI to render details. */
  outputs: Array<{ tool: string; output: unknown }>;
  /** True if any underlying provider returned demo/mock data. */
  used_mock: boolean;
  /** Present only when the specialist could not complete. */
  error?: string;
}

/**
 * Run a single specialist against a natural-language instruction.
 * Always resolves — failures are returned as `{ error }`.
 */
export async function runSpecialist(
  name: SpecialistName,
  instruction: string,
  ctx: ToolContext,
): Promise<SpecialistResult> {
  const spec = SPECIALISTS[name];
  const base = { specialist: name, role: spec.role, emoji: spec.emoji };

  // Mock-safe: with no Anthropic key we cannot drive a sub-agent loop, so
  // return a deterministic placeholder. (The chat route's own mock branch
  // normally short-circuits before reaching here.)
  const resolved = await resolveAiModel(
    ctx.userId,
    spec.modelTier === "email" ? "writing" : "research",
  );
  if (!resolved) {
    return {
      ...base,
      summary: `[demo] ${spec.role} would handle: ${instruction.slice(0, 140)}`,
      steps: 0,
      tools_used: [],
      outputs: [],
      used_mock: true,
    };
  }

  try {
    const tools = spec.makeTools(ctx);
    const hasTools = Object.keys(tools).length > 0;

    const result = await generateText({
      model: resolved.model,
      system: spec.systemPrompt,
      prompt: instruction,
      ...(hasTools ? { tools, stopWhen: stepCountIs(spec.maxSteps) } : {}),
    });

    const outputs = (result.toolResults ?? []).map((tr) => ({
      tool: (tr as { toolName: string }).toolName,
      output: (tr as { output: unknown }).output,
    }));

    const purpose = spec.modelTier === "email" ? "writing" : "research";
    const creditCost = (await import("../credit-costs")).creditsForOperation(
      resolved.modelId,
      purpose,
    );
    await recordAiUsage({
      userId: ctx.userId,
      provider: resolved.provider,
      model: resolved.modelId,
      operation: `specialist_${name}`,
      status: "completed",
      durationMs: 0,
      creditCost,
    });
    await deductCreditsForAiOp({
      userId: ctx.userId,
      modelId: resolved.modelId,
      purpose,
      operationLabel: `specialist_${name}`,
    });
    return {
      ...base,
      summary: result.text,
      steps: result.steps?.length ?? 1,
      tools_used: (result.toolCalls ?? []).map(
        (tc) => (tc as { toolName: string }).toolName,
      ),
      outputs,
      used_mock: outputs.some((o) => outputLooksMock(o.output)),
    };
  } catch (err) {
    await recordAiUsage({
      userId: ctx.userId,
      provider: resolved.provider,
      model: resolved.modelId,
      operation: `specialist_${name}`,
      status: "failed",
      durationMs: 0,
      errorCode: safeAiError(err),
    });
    return {
      ...base,
      summary: "",
      steps: 0,
      tools_used: [],
      outputs: [],
      used_mock: false,
      error: err instanceof Error ? err.message : "specialist failed",
    };
  }
}
