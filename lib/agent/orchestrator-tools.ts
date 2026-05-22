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
import { createAutomation } from "@/lib/automations"
import { validateAutomation } from "@/lib/automation-core"

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
    create_automation: tool({
      description:
        "Create a recurring automation: the AI team runs the given instruction automatically on a schedule (hourly/daily/weekly). Use when the user wants something to happen repeatedly, e.g. 'every Monday find 20 fintech CMOs and draft outreach'. Confirm the schedule with the user before creating.",
      inputSchema: z.object({
        name: z.string().describe("Short name, e.g. 'Weekly fintech CMO push'."),
        instruction: z
          .string()
          .describe("The full job to run each time, exactly as the user would type it into chat."),
        frequency: z.enum(["hourly", "daily", "weekly"]),
        hour_utc: z
          .number()
          .int()
          .min(0)
          .max(23)
          .optional()
          .describe("UTC hour for daily/weekly runs (default 9)."),
        day_of_week: z
          .number()
          .int()
          .min(0)
          .max(6)
          .optional()
          .describe("0=Sun .. 6=Sat for weekly runs (default 1=Mon)."),
      }),
      execute: async (params) => {
        const err = validateAutomation(params)
        if (err) return { error: err }
        return createAutomation(
          {
            name: params.name,
            instruction: params.instruction,
            frequency: params.frequency,
            hourUtc: params.hour_utc,
            dayOfWeek: params.day_of_week,
          },
          ctx.userId,
        )
      },
    }),
    clarify_question: clarifyTool(ctx),
  }
}
