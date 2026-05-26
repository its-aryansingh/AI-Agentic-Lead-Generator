import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

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
      <header className="px-6 py-5 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Past jobs</h1>
        <Link
          href="/app/chat"
          className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors bg-muted/50 px-3 py-1.5 rounded-full"
        >
          ← Back to chat
        </Link>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-4 relative z-10">
          {(!jobs || jobs.length === 0) && (
            <Card className="glass-card border-dashed">
              <CardContent className="py-12 flex flex-col items-center justify-center text-center gap-2 text-sm text-muted-foreground">
                <div className="size-10 rounded-full bg-muted flex items-center justify-center mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
                </div>
                No jobs yet.<br/>Start a chat and confirm a bulk enrichment to see runs here.
              </CardContent>
            </Card>
          )}
          {(jobs ?? []).map((j, index) => (
            <Link
              key={j.id as string}
              href={`/app/jobs/${j.id}`}
              className="block group"
            >
              <Card className="glass-card animate-slide-in-up hover:border-primary/30 hover:shadow-[0_8px_24px_oklch(0_0_0/4%)] transition-all duration-300 relative overflow-hidden" style={{ animationDelay: `${index * 50}ms` }}>
                {j.status === "completed" && (
                  <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary to-transparent" />
                )}
                {j.status === "failed" && (
                  <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-destructive to-transparent" />
                )}
                {j.status === "processing" && (
                  <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-blue-500 to-transparent animate-pulse" />
                )}
                <CardHeader className="px-5 py-4 border-b border-border/50 bg-muted/10">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="font-medium tracking-tight">Job {(j.id as string).slice(0, 8)}</span>
                    <Badge
                      variant={
                        j.status === "completed"
                          ? "default"
                          : j.status === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                      className={cn("uppercase tracking-wider text-[10px]", j.status === "processing" && "animate-pulse")}
                    >
                      {String(j.status)}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 py-4 flex items-center justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="text-lg font-semibold">{j.prospect_count as number}</span>
                    <span className="text-xs uppercase tracking-widest text-muted-foreground">Prospect{j.prospect_count === 1 ? "" : "s"}</span>
                  </div>
                  <div className="text-xs text-muted-foreground font-medium bg-muted/30 px-2 py-1 rounded border border-border/50">
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
