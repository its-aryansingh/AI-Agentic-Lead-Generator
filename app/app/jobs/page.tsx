import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

/**
 * /app/jobs — history of bulk enrichment runs.
 *
 * Server component. RLS scopes the query to the current user automatically.
 */
export default async function JobsPage() {
  const supabase = await createClient()
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id,status,prospect_count,sheet_url,created_at,completed_at")
    .order("created_at", { ascending: false })
    .limit(50)

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between">
        <h1 className="text-base font-semibold">Past jobs</h1>
        <Link
          href="/app/chat"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ← back to chat
        </Link>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-3">
          {(!jobs || jobs.length === 0) && (
            <Card size="sm">
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No jobs yet — start a chat and confirm a bulk enrichment to see
                runs here.
              </CardContent>
            </Card>
          )}
          {(jobs ?? []).map((j) => (
            <Link
              key={j.id as string}
              href={`/app/jobs/${j.id}`}
              className="block hover:opacity-90 transition-opacity"
            >
              <Card size="sm">
                <CardHeader className="px-4">
                  <CardTitle className="flex items-center gap-2">
                    Job {(j.id as string).slice(0, 8)}
                    <Badge
                      variant={
                        j.status === "completed"
                          ? "default"
                          : j.status === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {String(j.status)}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-sm">
                  <div className="text-muted-foreground">
                    {j.prospect_count as number} prospect
                    {j.prospect_count === 1 ? "" : "s"} ·{" "}
                    {new Date(j.created_at as string).toLocaleString()}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
