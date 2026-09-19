import { inngest } from "@/inngest/client"
import { createAdminClient } from "@/lib/supabase/server"
import {
  dispatchAutonomousOutreach,
  executeOutreachRun,
  nextScheduleOccurrence,
  type OutreachChannel,
} from "@/lib/outreach/autonomous-dispatcher"

export const outreachSchedulesFunction = inngest.createFunction(
  { id: "outreach-schedules", triggers: [{ cron: "*/5 * * * *" }] },
  async () => {
    const db = createAdminClient()
    const now = new Date()
    const { data: schedules } = await db.from("outreach_schedules").select("*")
      .eq("status", "active").lte("next_run_at", now.toISOString()).limit(100)
    let fired = 0
    for (const schedule of schedules ?? []) {
      const occurrence = String(schedule.next_run_at)
      const { data: locked } = await db.from("outreach_schedules").update({
        last_run_at: now.toISOString(),
        last_occurrence_key: occurrence,
        next_run_at: nextScheduleOccurrence(now, String(schedule.timezone), String(schedule.local_time).slice(0, 5), schedule.weekdays as number[]).toISOString(),
        updated_at: now.toISOString(),
      }).eq("id", schedule.id).eq("user_id", schedule.user_id).eq("status", "active")
        .neq("last_occurrence_key", occurrence).select("id").maybeSingle()
      if (!locked) continue
      const sequence = schedule.sequence as { prospectIds?: string[] } | null
      await dispatchAutonomousOutreach({
        userId: String(schedule.user_id),
        requestedBy: "schedule",
        channel: schedule.channel_strategy as OutreachChannel,
        prospectIds: sequence?.prospectIds,
        filters: schedule.lead_filter as never,
        scheduleId: String(schedule.id),
        approvalId: String(schedule.approval_id),
        idempotencyKey: `schedule:${schedule.id}:${occurrence}`,
      })
      fired++
    }

    // Resume delayed smart-routing items. The RPC exposes only owned run/user
    // pairs; execution revalidates the pair before claiming any item.
    const { data: dueRuns } = await db.rpc("list_due_outreach_runs", { p_limit: 100 })
    for (const due of dueRuns ?? [])
      await executeOutreachRun(String(due.run_id), String(due.user_id))
    return { fired, resumed: dueRuns?.length ?? 0 }
  },
)
