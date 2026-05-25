/**
 * GET /api/extension/alerts?since=<iso>
 *
 * Bearer-authed alert feed for the Chrome extension service worker to
 * poll (via chrome.alarms — service workers can't run continuously).
 *
 * Returns two alert classes merged into one chronological list:
 *   - hot_reply       : unhandled replies that need_human (Inbox surfaces)
 *   - automation_done : automation_runs that finished (success or failure)
 *
 * Capped at 20 items total to keep service-worker payloads small. The
 * `since` filter is optional — when present, only items newer than the
 * timestamp are returned (lets the extension dedupe locally).
 */

import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getUserFromBearer } from "@/lib/api-auth"

export const runtime = "nodejs"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

const MAX_ALERTS = 20
const PER_KIND = 15

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders })
}

export interface ExtensionAlert {
  kind: "hot_reply" | "automation_done"
  id: string
  ts: string
  title: string
  body: string
  meta: Record<string, unknown>
}

export async function GET(req: Request) {
  const auth = await getUserFromBearer(req)
  if (!auth.user) {
    return NextResponse.json(
      { error: "unauthorized", reason: auth.reason },
      { status: 401, headers: corsHeaders },
    )
  }
  const { user } = auth

  const url = new URL(req.url)
  const sinceParam = url.searchParams.get("since")
  const since = sinceParam ? parseIsoOrNull(sinceParam) : null

  const admin = createAdminClient()

  // Hot replies — needs_human=true & handled=false. Matches Inbox query.
  const repliesQuery = admin
    .from("reply_classifications")
    .select("id, category, snippet, created_at, recipient_id")
    .eq("user_id", user.id)
    .eq("needs_human", true)
    .eq("handled", false)
    .order("created_at", { ascending: false })
    .limit(PER_KIND)
  if (since) repliesQuery.gt("created_at", since)
  const { data: replies } = await repliesQuery

  // Automation completions — both success and failure in the last 24h
  // (or since the cursor). Failures matter to the user too.
  const runsQuery = admin
    .from("automation_runs")
    .select("id, automation_id, status, summary, error, finished_at")
    .eq("user_id", user.id)
    .not("finished_at", "is", null)
    .in("status", ["completed", "failed"])
    .order("finished_at", { ascending: false })
    .limit(PER_KIND)
  const cutoff = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  runsQuery.gt("finished_at", cutoff)
  const { data: runs } = await runsQuery

  // Hydrate automation names in one round-trip.
  const automationIds = Array.from(
    new Set((runs ?? []).map((r) => r.automation_id as string)),
  )
  const nameByAutomation = new Map<string, string>()
  if (automationIds.length > 0) {
    const { data: autos } = await admin
      .from("automations")
      .select("id, name")
      .in("id", automationIds)
    for (const a of autos ?? []) {
      nameByAutomation.set(a.id as string, (a.name as string) ?? "Automation")
    }
  }

  const alerts: ExtensionAlert[] = []

  for (const r of replies ?? []) {
    alerts.push({
      kind: "hot_reply",
      id: `reply:${r.id}`,
      ts: r.created_at as string,
      title: `New ${r.category as string} reply`,
      body: shortenSnippet((r.snippet as string | null) ?? ""),
      meta: {
        reply_id: r.id,
        recipient_id: r.recipient_id,
        category: r.category,
      },
    })
  }

  for (const run of runs ?? []) {
    const name = nameByAutomation.get(run.automation_id as string) ?? "Automation"
    const status = run.status as string
    alerts.push({
      kind: "automation_done",
      id: `run:${run.id}`,
      ts: run.finished_at as string,
      title: status === "completed" ? `${name} finished` : `${name} failed`,
      body:
        status === "completed"
          ? shortenSnippet((run.summary as string | null) ?? "Completed.")
          : shortenSnippet((run.error as string | null) ?? "Failed."),
      meta: {
        run_id: run.id,
        automation_id: run.automation_id,
        status,
      },
    })
  }

  alerts.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))

  return NextResponse.json(
    {
      alerts: alerts.slice(0, MAX_ALERTS),
      server_time: new Date().toISOString(),
    },
    { headers: corsHeaders },
  )
}

function parseIsoOrNull(s: string): string | null {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function shortenSnippet(s: string, max = 160): string {
  const trimmed = s.replace(/\s+/g, " ").trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1) + "…"
}
