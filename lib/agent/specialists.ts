/**
 * Specialist agents — the "AI BDR team" the orchestrator delegates to.
 *
 * The catalog (roles, emojis, prompts, tool subsets, model tier) lives in
 * orchestration-core.ts so it can be unit-tested without the "@/" alias
 * chain that Node's test runner can't resolve. Here we bind that metadata
 * to the real tool factories and resolve the tier to a concrete model.
 *
 * Adding a specialist is purely additive: append an entry to the catalog.
 */

import { type ToolSet } from "ai"

import { MODEL_EMAIL, MODEL_RESEARCH } from "@/lib/providers/anthropic"
import { TOOL_FACTORIES, type ToolContext } from "./tools"
import {
  SPECIALIST_META,
  SPECIALIST_NAMES,
  type SpecialistModelTier,
  type SpecialistName,
} from "./orchestration-core"

export { SPECIALIST_NAMES }
export type { SpecialistName }

export interface Specialist {
  name: SpecialistName
  role: string
  emoji: string
  model: string
  maxSteps: number
  systemPrompt: string
  makeTools: (ctx: ToolContext) => ToolSet
}

function tierToModel(tier: SpecialistModelTier): string {
  return tier === "email" ? MODEL_EMAIL : MODEL_RESEARCH
}

export const SPECIALISTS: Record<SpecialistName, Specialist> = Object.fromEntries(
  SPECIALIST_NAMES.map((name) => {
    const meta = SPECIALIST_META[name]
    const specialist: Specialist = {
      name,
      role: meta.role,
      emoji: meta.emoji,
      model: tierToModel(meta.modelTier),
      maxSteps: meta.maxSteps,
      systemPrompt: meta.systemPrompt,
      makeTools: (ctx: ToolContext): ToolSet =>
        Object.fromEntries(meta.toolNames.map((tn) => [tn, TOOL_FACTORIES[tn](ctx)])),
    }
    return [name, specialist]
  }),
) as Record<SpecialistName, Specialist>
