/**
 * Automation persistence — DB helpers over the service-role client.
 *
 * The pure scheduling math lives in automation-core.ts (test-loadable);
 * this module is the DB side, used by the create_automation chat tool and
 * the run-automations cron worker.
 */

import { createAdminClient } from "@/lib/supabase/server"
import {
  computeNextRun,
  type AutomationFrequency,
} from "@/lib/automation-core"

export interface CreateAutomationInput {
  name: string
  instruction: string
  frequency: AutomationFrequency
  hourUtc?: number
  dayOfWeek?: number
}

export interface DueAutomation {
  id: string
  user_id: string
  name: string
  instruction: string
  schedule_frequency: AutomationFrequency | null
  schedule_hour: number
  schedule_dow: number
}

export async function createAutomation(input: CreateAutomationInput, userId: string) {
  const supabase = createAdminClient()
  const nextRun = computeNextRun(
    { frequency: input.frequency, hourUtc: input.hourUtc, dayOfWeek: input.dayOfWeek },
    new Date(),
  )

  const { data, error } = await supabase
    .from("automations")
    .insert({
      user_id: userId,
      name: input.name,
      instruction: input.instruction,
      trigger_type: "schedule",
      schedule_frequency: input.frequency,
      schedule_hour: input.hourUtc ?? 9,
      schedule_dow: input.dayOfWeek ?? 1,
      status: "active",
      next_run_at: nextRun.toISOString(),
    })
    .select("id,name,schedule_frequency,next_run_at")
    .single()

  if (error) return { error: error.message }
  return { automation: data, next_run_at: nextRun.toISOString() }
}

/** Active scheduled automations whose next_run_at is due. Cron context (cross-user). */
export async function listDueAutomations(now: Date, limit = 25): Promise<DueAutomation[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("automations")
    .select("id,user_id,name,instruction,schedule_frequency,schedule_hour,schedule_dow")
    .eq("status", "active")
    .eq("trigger_type", "schedule")
    .lte("next_run_at", now.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(limit)

  if (error || !data) return []
  return data as DueAutomation[]
}

export async function startRun(
  automationId: string,
  userId: string,
  trigger = "schedule",
): Promise<string | undefined> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("automation_runs")
    .insert({ automation_id: automationId, user_id: userId, trigger, status: "running" })
    .select("id")
    .single()
  return data?.id as string | undefined
}

export async function finishRun(
  runId: string,
  result: { status: "completed" | "failed"; summary?: string; error?: string },
): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from("automation_runs")
    .update({
      status: result.status,
      summary: result.summary ?? null,
      error: result.error ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId)
}

/** Roll the schedule forward after a run (stamps last_run_at + next_run_at). */
export async function advanceSchedule(
  automation: DueAutomation,
  now: Date,
): Promise<void> {
  const supabase = createAdminClient()
  const next = computeNextRun(
    {
      frequency: automation.schedule_frequency ?? "daily",
      hourUtc: automation.schedule_hour,
      dayOfWeek: automation.schedule_dow,
    },
    now,
  )
  await supabase
    .from("automations")
    .update({
      last_run_at: now.toISOString(),
      next_run_at: next.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", automation.id)
}
