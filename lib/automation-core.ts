/**
 * Pure scheduling logic for automations — ZERO imports by design, so the
 * Node test runner can load it directly (mirrors orchestration-core.ts).
 *
 * Schedules are deliberately simple (hourly / daily / weekly + UTC hour +
 * day-of-week) so next-run computation is a pure, deterministic function —
 * no cron-parser dependency.
 */

export type AutomationFrequency = "hourly" | "daily" | "weekly"
export type AutomationTriggerType = "schedule" | "event"

export interface AutomationScheduleInput {
  frequency: AutomationFrequency
  /** 0-23, UTC. Used by daily/weekly. Defaults to 9. */
  hourUtc?: number
  /** 0 (Sun) - 6 (Sat). Used by weekly. Defaults to 1 (Mon). */
  dayOfWeek?: number
}

function clampHour(h: number | undefined): number {
  return Number.isFinite(h) ? Math.min(23, Math.max(0, Math.floor(h as number))) : 9
}

function clampDow(d: number | undefined): number {
  return Number.isFinite(d) ? (((Math.floor(d as number) % 7) + 7) % 7) : 1
}

/**
 * The next run time strictly AFTER `from`, in UTC. Deterministic.
 */
export function computeNextRun(schedule: AutomationScheduleInput, from: Date): Date {
  const next = new Date(from.getTime())

  if (schedule.frequency === "hourly") {
    next.setUTCMinutes(0, 0, 0)
    next.setUTCHours(next.getUTCHours() + 1)
    return next
  }

  const hour = clampHour(schedule.hourUtc)

  if (schedule.frequency === "daily") {
    next.setUTCHours(hour, 0, 0, 0)
    if (next.getTime() <= from.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1)
    }
    return next
  }

  // weekly
  const targetDow = clampDow(schedule.dayOfWeek)
  next.setUTCHours(hour, 0, 0, 0)
  let delta = (targetDow - next.getUTCDay() + 7) % 7
  if (delta === 0 && next.getTime() <= from.getTime()) delta = 7
  next.setUTCDate(next.getUTCDate() + delta)
  return next
}

/** True if `nextRunAt` is at or before `now`. */
export function isDue(nextRunAt: string | Date | null, now: Date): boolean {
  if (!nextRunAt) return false
  const t = typeof nextRunAt === "string" ? new Date(nextRunAt) : nextRunAt
  return t.getTime() <= now.getTime()
}

/** Validate user/agent-supplied automation input. Returns an error string or null. */
export function validateAutomation(input: {
  name?: string
  instruction?: string
  frequency?: string
}): string | null {
  if (!input.name || input.name.trim().length < 2) return "Automation needs a name."
  if (!input.instruction || input.instruction.trim().length < 8) {
    return "Automation needs a concrete instruction for the agent."
  }
  if (!input.frequency || !["hourly", "daily", "weekly"].includes(input.frequency)) {
    return "Frequency must be hourly, daily, or weekly."
  }
  return null
}
