/**
 * Headless orchestrator run — drives the same orchestrator (prompt + run_*
 * delegations) as the chat route, but without a UI stream. Used by the
 * automation worker so a scheduled automation executes the full AI BDR team
 * exactly like an interactive request would.
 *
 * Mock-safe: with no Anthropic key it returns a deterministic placeholder
 * (the chat route's mock branch behaves the same way).
 */

import { generateText, stepCountIs } from "ai"

import { getChatModel } from "@/lib/providers/anthropic"
import { ORCHESTRATOR_PROMPT } from "./orchestrator-prompt"
import { makeOrchestratorTools } from "./orchestrator-tools"
import type { ToolContext } from "./tools"

export interface OrchestrationResult {
  summary: string
  steps: number
  used_mock: boolean
  error?: string
}

export async function runOrchestration(
  instruction: string,
  ctx: ToolContext,
): Promise<OrchestrationResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      summary: `[demo] Orchestrator would run: ${instruction.slice(0, 160)}`,
      steps: 0,
      used_mock: true,
    }
  }

  try {
    const result = await generateText({
      model: getChatModel(),
      system: ORCHESTRATOR_PROMPT,
      prompt: instruction,
      tools: makeOrchestratorTools(ctx),
      stopWhen: stepCountIs(10),
    })
    return {
      summary: result.text,
      steps: result.steps?.length ?? 1,
      used_mock: false,
    }
  } catch (err) {
    return {
      summary: "",
      steps: 0,
      used_mock: false,
      error: err instanceof Error ? err.message : "orchestration failed",
    }
  }
}
