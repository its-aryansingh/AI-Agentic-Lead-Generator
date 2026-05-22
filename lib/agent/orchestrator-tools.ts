/**
 * Orchestrator tool set — specialist delegations.
 *
 * Each run_* tool wraps `runSpecialist`. Because they are real AI SDK
 * tools, every delegation surfaces in the chat as a streamed tool-call
 * card — which is exactly the "team working" UX. clarify_question stays a
 * direct tool (a UX primitive, not a specialist task).
 */

import { tool, type ToolSet } from "ai"
import { z } from "zod"

import { runSpecialist } from "./orchestrator"
import type { SpecialistName } from "./specialists"
import { clarifyTool, type ToolContext } from "./tools"

const instructionSchema = z.object({
  instruction: z
    .string()
    .describe(
      "A clear, self-contained instruction for the specialist: what to do, for whom, with any specifics (ICP, named people, and the user's confirmation status).",
    ),
})

function delegationTool(
  name: SpecialistName,
  ctx: ToolContext,
  description: string,
) {
  return tool({
    description,
    inputSchema: instructionSchema,
    execute: async ({ instruction }) => runSpecialist(name, instruction, ctx),
  })
}

export function makeOrchestratorTools(ctx: ToolContext): ToolSet {
  return {
    run_prospector: delegationTool(
      "prospector",
      ctx,
      "Delegate to the Prospector to FIND prospect candidates matching an ICP (or stage a user-provided named list). Returns a count + sample. Use for any 'find me X' discovery.",
    ),
    run_researcher: delegationTool(
      "researcher",
      ctx,
      "Delegate to the Researcher to deeply ENRICH named prospects (research summary, best-guess email + confidence, recent signals).",
    ),
    run_copywriter: delegationTool(
      "copywriter",
      ctx,
      "Delegate to the Copywriter to write or tighten cold-email copy in the user's voice. Pass the prospect research and any voice guidance in the instruction.",
    ),
    run_compliance: delegationTool(
      "compliance",
      ctx,
      "Delegate to the Compliance reviewer to check a draft or planned batch for CAN-SPAM / GDPR / India DPDP and deliverability risk BEFORE sending.",
    ),
    run_outreach: delegationTool(
      "outreach",
      ctx,
      "Delegate to the Outreach coordinator to run bulk enrichment (Sheet + CSV) or, ONLY with explicit user confirmation, queue a real email campaign. State the confirmation status in the instruction.",
    ),
    clarify_question: clarifyTool(ctx),
  }
}
