import Link from "next/link"
import { Repeat, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

interface AutomationRow {
  id: string
  name: string
  instruction: string
  schedule_frequency: "hourly" | "daily" | "weekly" | null
  schedule_hour: number
  schedule_dow: number
  status: string
  last_run_at: string | null
  next_run_at: string | null
}

interface RunRow {
  id: string
  automation_id: string
  status: "running" | "completed" | "failed"
  summary: string | null
  error: string | null
  started_at: string
  finished_at: string | null
}

function scheduleLabel(a: AutomationRow): string {
  const h = String(a.schedule_hour).padStart(2, "0")
  if (a.schedule_frequency === "hourly") return "Every hour"
  if (a.schedule_frequency === "daily") return `Daily · ${h}:00 UTC`
  if (a.schedule_frequency === "weekly") return `Weekly · ${DOW[a.schedule_dow] ?? "Mon"} ${h}:00 UTC`
  return "On schedule"
}

export default async function AutomationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: automations } = await supabase
    .from("automations")
    .select(
      "id,name,instruction,schedule_frequency,schedule_hour,schedule_dow,status,last_run_at,next_run_at",
    )
    .order("created_at", { ascending: false })

  const { data: runs } = await supabase
    .from("automation_runs")
    .select("id,automation_id,status,summary,error,started_at,finished_at")
    .order("started_at", { ascending: false })
    .limit(20)

  const list = (automations ?? []) as AutomationRow[]
  const runList = (runs ?? []) as RunRow[]
  const runsByAutomation = new Map<string, RunRow[]>()
  for (const r of runList) {
    const arr = runsByAutomation.get(r.automation_id) ?? []
    arr.push(r)
    runsByAutomation.set(r.automation_id, arr)
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Repeat className="w-6 h-6 text-primary" />
            Automations
          </h1>
          <p className="text-sm text-muted-foreground">
            Recurring jobs your AI team runs on a schedule. Create one from chat — just say{" "}
            <span className="font-mono text-foreground">
              &quot;every Monday, find 20 fintech CMOs in India and draft outreach&quot;
            </span>
            .
          </p>
        </header>

        {list.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl p-10 text-center text-sm text-muted-foreground">
            No automations yet. Open{" "}
            <Link href="/app/chat" className="text-primary hover:underline">
              chat
            </Link>{" "}
            and describe a recurring job — the orchestrator will set it up.
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {list.map((a) => {
              const recent = runsByAutomation.get(a.id) ?? []
              return (
                <li
                  key={a.id}
                  className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold">{a.name}</span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {scheduleLabel(a)}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border",
                        a.status === "active"
                          ? "border-primary/30 text-primary bg-primary/5"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {a.status}
                    </span>
                  </div>

                  <p className="text-sm text-muted-foreground line-clamp-2">{a.instruction}</p>

                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground border-t border-border/50 pt-3">
                    {a.next_run_at && (
                      <span>
                        Next run:{" "}
                        <span className="text-foreground">
                          {new Date(a.next_run_at).toLocaleString()}
                        </span>
                      </span>
                    )}
                    {a.last_run_at && (
                      <span>
                        Last run:{" "}
                        <span className="text-foreground">
                          {new Date(a.last_run_at).toLocaleString()}
                        </span>
                      </span>
                    )}
                  </div>

                  {recent.length > 0 && (
                    <ul className="flex flex-col gap-1.5 border-t border-border/50 pt-3">
                      {recent.slice(0, 3).map((r) => (
                        <li key={r.id} className="flex items-center gap-2 text-xs">
                          <RunStatusIcon status={r.status} />
                          <span className="text-muted-foreground">
                            {new Date(r.started_at).toLocaleString()}
                          </span>
                          <span className="text-foreground/80 truncate">
                            {r.error ?? r.summary ?? r.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function RunStatusIcon({ status }: { status: RunRow["status"] }) {
  if (status === "completed")
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
  if (status === "failed") return <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
  return <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />
}
