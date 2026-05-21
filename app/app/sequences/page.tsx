import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { ListOrdered, ListPlus, Users, ArrowRight } from "lucide-react"

/**
 * /app/sequences — list of the user's multi-step outreach sequences.
 */
export default async function SequencesPage() {
  const supabase = await createClient()
  
  const { data: rows } = await supabase
    .from("sequences")
    .select("id,name,description,is_active,created_at")
    .order("created_at", { ascending: false })
    .limit(50)

  const sequences = rows ?? []

  // Fetch step counts
  const { data: stepCounts } = await supabase
    .from("sequence_steps")
    .select("sequence_id")

  // Fetch enrollment counts
  const { data: enrollCounts } = await supabase
    .from("sequence_enrollments")
    .select("sequence_id,status")

  const stepCountBySeq = (stepCounts ?? []).reduce<Record<string, number>>((acc, row) => {
    const id = row.sequence_id as string
    acc[id] = (acc[id] ?? 0) + 1
    return acc
  }, {})

  const enrollCountBySeq = (enrollCounts ?? []).reduce<Record<string, number>>((acc, row) => {
    if (row.status === "active") {
      const id = row.sequence_id as string
      acc[id] = (acc[id] ?? 0) + 1
    }
    return acc
  }, {})

  // Relative time formatter
  const timeAgo = (dateStr: string) => {
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
    const daysDifference = Math.round(
      (new Date(dateStr).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    )
    if (daysDifference === 0) return "today"
    return rtf.format(-daysDifference, "day")
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-background/50 relative overflow-hidden">
      {/* Decorative gradient blob */}
      <div className="absolute top-0 right-0 w-[600px] h-[400px] bg-gradient-to-bl from-[var(--chart-sky)]/10 via-[var(--chart-violet)]/5 to-transparent blur-3xl -z-10 pointer-events-none opacity-40" />
      
      <header className="px-6 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Sequences</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your multi-step outreach campaigns.
          </p>
        </div>
        <Link href="/app/sequences/new">
          <Button size="sm" className="gap-2 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 transition-all shadow-sm">
            <ListPlus className="w-4 h-4" />
            New sequence
          </Button>
        </Link>
      </header>

      <section className="flex-1 overflow-y-auto px-6 pb-10">
        <div className="max-w-4xl mx-auto flex flex-col gap-4">
          {sequences.length === 0 ? (
            <EmptyState
              icon={<ListOrdered className="w-8 h-8" />}
              title="No sequences yet"
              description="Build your first multi-step cadence (e.g. D0 email → D3 LinkedIn DM → D7 followup) to enroll prospects in."
              className="py-16"
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sequences.map((s, index) => {
                const steps = stepCountBySeq[s.id as string] ?? 0
                const enrolled = enrollCountBySeq[s.id as string] ?? 0
                
                return (
                  <Link
                    key={s.id as string}
                    href={`/app/sequences/${s.id}`}
                    className="block group"
                  >
                    <Card 
                      className="glass-card h-full animate-slide-in-up hover:border-primary/30 hover:shadow-sm transition-all duration-300 relative overflow-hidden"
                      style={{ animationDelay: `${index * 80}ms` }}
                    >
                      {/* Hover gradient accent */}
                      <div className="absolute top-0 left-0 w-1 h-full bg-primary/0 group-hover:bg-primary/50 transition-colors duration-300" />
                      
                      <CardHeader className="px-5 pt-5 pb-2">
                        <div className="flex items-start justify-between">
                          <CardTitle className="text-base font-semibold leading-tight group-hover:text-primary transition-colors">
                            {s.name as string}
                          </CardTitle>
                          <div className="flex items-center gap-2">
                            {s.is_active ? (
                              <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
                                Active
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                Paused
                              </div>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="px-5 pb-5">
                        <div className="text-sm text-muted-foreground line-clamp-2 min-h-[40px] mb-4">
                          {(s.description as string | null) ?? "No description provided."}
                        </div>
                        
                        <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border/50 pt-3">
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1.5">
                              <ListOrdered className="w-3.5 h-3.5" />
                              <span className="font-medium text-foreground/80">{steps} step{steps !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Users className="w-3.5 h-3.5" />
                              <span className="font-medium text-foreground/80">{enrolled} enrolled</span>
                            </div>
                          </div>
                          <span className="flex items-center gap-1 group-hover:text-primary transition-colors">
                            Created {timeAgo(s.created_at as string)}
                            <ArrowRight className="w-3 h-3 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
