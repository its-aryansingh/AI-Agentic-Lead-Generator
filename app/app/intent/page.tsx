import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

/**
 * /app/intent — intent-trigger feed + tracked-keyword management.
 *
 * Watches are user-defined keyword queries; the cron poller
 * (POST /api/cron/poll-intent) scans HN + GitHub for each watch every
 * hour and writes intent_triggers when a match lands.
 */

async function addWatch(formData: FormData) {
  "use server"
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const query = String(formData.get("query") ?? "").trim()
  if (!query) redirect("/app/intent?error=missing_query")
  await supabase.from("intent_watches").insert({ user_id: user.id, query })
  redirect("/app/intent")
}

async function deleteWatch(formData: FormData) {
  "use server"
  const id = String(formData.get("id") ?? "")
  if (!id) return
  const supabase = await createClient()
  await supabase.from("intent_watches").delete().eq("id", id)
  redirect("/app/intent")
}

async function dismissTrigger(formData: FormData) {
  "use server"
  const id = String(formData.get("id") ?? "")
  if (!id) return
  const supabase = await createClient()
  await supabase
    .from("intent_triggers")
    .update({ dismissed: true })
    .eq("id", id)
  redirect("/app/intent")
}

export default async function IntentPage() {
  const supabase = await createClient()
  const { data: watches } = await supabase
    .from("intent_watches")
    .select("id,query,sources,created_at")
    .order("created_at", { ascending: false })

  const { data: triggers } = await supabase
    .from("intent_triggers")
    .select(
      "id,trigger_type,account_name,account_domain,payload,source_url,occurred_at,dismissed",
    )
    .eq("dismissed", false)
    .order("occurred_at", { ascending: false })
    .limit(40)

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b border-border">
        <h1 className="text-base font-semibold">Intent triggers</h1>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          <Card size="sm">
            <CardHeader className="px-4">
              <CardTitle>Tracked watches</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <form action={addWatch} className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-xs uppercase tracking-wide text-muted-foreground mb-1 block">
                    Add a keyword to watch
                  </label>
                  <Input
                    name="query"
                    placeholder="e.g. fintech founder India, AI agents YC"
                    required
                  />
                </div>
                <Button type="submit" size="sm">
                  Add
                </Button>
              </form>
              {(watches ?? []).length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No watches yet. Add one — the cron will scan public sources
                  every hour and surface matches below.
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {(watches ?? []).map((w) => (
                    <li
                      key={w.id as string}
                      className="flex items-center justify-between text-sm border-b border-border last:border-b-0 py-1.5"
                    >
                      <span className="font-mono text-xs">
                        {w.query as string}
                      </span>
                      <form action={deleteWatch}>
                        <input
                          type="hidden"
                          name="id"
                          value={w.id as string}
                        />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="xs"
                        >
                          Remove
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader className="px-4">
              <CardTitle>Recent triggers</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {(triggers ?? []).length === 0 ? (
                <div className="text-sm text-muted-foreground py-2">
                  No triggers yet. Once the cron has run for an hour,
                  matching signals will appear here.
                </div>
              ) : (
                (triggers ?? []).map((t) => {
                  const payload =
                    (t.payload as Record<string, unknown> | null) ?? {}
                  return (
                    <div
                      key={t.id as string}
                      className="border border-border rounded-md p-3 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">{String(t.trigger_type)}</Badge>
                        {t.account_name && (
                          <span className="text-sm font-medium">
                            {String(t.account_name)}
                          </span>
                        )}
                        {t.source_url && (
                          <a
                            href={t.source_url as string}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] underline underline-offset-2 text-muted-foreground"
                          >
                            source
                          </a>
                        )}
                        <span className="text-[11px] text-muted-foreground ml-auto">
                          {new Date(t.occurred_at as string).toLocaleString()}
                        </span>
                      </div>
                      {typeof payload.snippet === "string" && (
                        <div className="text-sm whitespace-pre-wrap">
                          {payload.snippet}
                        </div>
                      )}
                      {typeof payload.title === "string" && (
                        <div className="text-sm text-muted-foreground">
                          {payload.title as string}
                          {typeof payload.company === "string" &&
                            ` · ${payload.company}`}
                        </div>
                      )}
                      <form action={dismissTrigger} className="self-end">
                        <input
                          type="hidden"
                          name="id"
                          value={t.id as string}
                        />
                        <Button type="submit" variant="ghost" size="xs">
                          Dismiss
                        </Button>
                      </form>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  )
}
