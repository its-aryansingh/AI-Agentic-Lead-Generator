/**
 * POST /api/cron/run-automations
 *
 * Scans active scheduled automations whose next_run_at is due, then runs
 * each headlessly through the orchestrator (the full AI BDR team) under a
 * fresh chat session, recording the outcome in automation_runs.
 *
 * The schedule is advanced BEFORE the run so a slow/failed execution can't
 * cause the same automation to be re-picked on the next tick.
 */

import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/server"
import {
  advanceSchedule,
  finishRun,
  listDueAutomations,
  startRun,
} from "@/lib/automations"
import { runOrchestration } from "@/lib/agent/run-orchestration"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function authorized(req: Request): boolean {
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  return Boolean(process.env.CRON_SECRET) && provided === process.env.CRON_SECRET
}

export async function POST(req: Request) {
  if (!authorized(req)) return new NextResponse("Forbidden", { status: 403 })

  const admin = createAdminClient()
  const now = new Date()
  const due = await listDueAutomations(now, 10)

  let processed = 0
  for (const automation of due) {
    // Advance first: a slow/failed run must not get re-picked next tick.
    await advanceSchedule(automation, now)

    // A real session keeps the orchestrator's session-scoped tool writes
    // valid (and gives the user a viewable transcript of the run).
    const { data: session } = await admin
      .from("chat_sessions")
      .insert({ user_id: automation.user_id, title: `⏱ ${automation.name}` })
      .select("id")
      .single()
    const sessionId = (session?.id as string | undefined) ?? automation.id

    const runId = await startRun(automation.id, automation.user_id, "schedule")
    const result = await runOrchestration(automation.instruction, {
      userId: automation.user_id,
      sessionId,
    })
    if (runId) {
      await finishRun(runId, {
        status: result.error ? "failed" : "completed",
        summary: result.summary,
        error: result.error,
      })
    }
    processed++
  }

  return NextResponse.json({ processed })
}

export { POST as GET }
