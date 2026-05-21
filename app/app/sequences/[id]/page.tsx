import { notFound } from "next/navigation"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, Mail, LinkIcon, Phone, Play, Pause, ChevronRight } from "lucide-react"

/**
 * /app/sequences/[id] — view sequence config and enrollment stats.
 */
export default async function SequenceDetailPage(props: {
  params: Promise<{ id: string }>
}) {
  const params = await props.params
  const id = params.id
  if (!id) return notFound()

  const supabase = await createClient()

  const { data: sequence } = await supabase
    .from("sequences")
    .select("*")
    .eq("id", id)
    .single()

  if (!sequence) return notFound()

  const { data: stepsRows } = await supabase
    .from("sequence_steps")
    .select("*")
    .eq("sequence_id", id)
    .order("step_order", { ascending: true })
  const steps = stepsRows ?? []

  const { data: enrollRows } = await supabase
    .from("sequence_enrollments")
    .select("status")
    .eq("sequence_id", id)
  const enrolls = enrollRows ?? []

  const enrollCount = enrolls.length
  const activeCount = enrolls.filter((e) => e.status === "active").length
  const completedCount = enrolls.filter((e) => e.status === "completed").length
  const pausedCount = enrolls.filter((e) => e.status === "paused").length
  const failedCount = enrolls.filter((e) => e.status === "failed").length

  const getStatusPct = (count: number) => {
    return enrollCount === 0 ? 0 : Math.round((count / enrollCount) * 100)
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-background/50 relative overflow-hidden">
      {/* Decorative gradient blob */}
      <div className="absolute top-0 right-1/4 w-[500px] h-[300px] bg-gradient-to-bl from-[var(--chart-emerald)]/10 via-[var(--chart-teal)]/5 to-transparent blur-3xl -z-10 pointer-events-none opacity-40" />
      
      <header className="px-6 py-6 border-b border-border/50 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">
          <Link href="/app/sequences" className="hover:text-foreground transition-colors flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" />
            Sequences
          </Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground/80 truncate max-w-[200px]">{sequence.name as string}</span>
        </div>
        
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{sequence.name as string}</h1>
              {sequence.is_active ? (
                <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2.5 py-0.5 rounded-full text-xs font-medium uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
                  Active
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2.5 py-0.5 rounded-full text-xs font-medium uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Paused
                </div>
              )}
            </div>
            {sequence.description && (
              <p className="text-sm text-muted-foreground mt-2 max-w-2xl leading-relaxed">
                {sequence.description as string}
              </p>
            )}
          </div>
          
          <button 
            disabled
            className="flex items-center gap-2 px-4 py-2 bg-muted text-muted-foreground rounded-lg text-sm font-medium border border-border/50 cursor-not-allowed opacity-80"
          >
            {sequence.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {sequence.is_active ? "Pause sequence" : "Resume sequence"}
          </button>
        </div>
      </header>

      <section className="flex-1 overflow-y-auto p-6 lg:p-8">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Content — Cadence Steps */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Cadence Timeline
            </h2>
            
            <div className="relative">
              {/* Timeline connecting line */}
              {steps.length > 1 && (
                <div className="absolute left-[1.125rem] top-8 bottom-8 w-px bg-border/60 z-0" />
              )}
              
              <div className="flex flex-col gap-6 relative z-10">
                {steps.map((step, i) => {
                  const channel = step.channel as string
                  const Icon = channel === "linkedin_dm" ? LinkIcon : channel === "task" ? Phone : Mail
                  const color = channel === "linkedin_dm" ? "var(--chart-sky)" : channel === "task" ? "var(--chart-amber)" : "var(--chart-violet)"
                  
                  return (
                    <div key={step.id as string} className="flex gap-5 group animate-slide-in-up" style={{ animationDelay: `${i * 100}ms` }}>
                      
                      {/* Timeline Node */}
                      <div className="mt-4 flex flex-col items-center">
                        <div 
                          className="w-9 h-9 rounded-full bg-background border-[3px] flex items-center justify-center relative z-10 group-hover:scale-110 transition-transform duration-300 shadow-sm"
                          style={{ borderColor: color }}
                        >
                          <Icon className="w-4 h-4" style={{ color }} />
                        </div>
                      </div>
                      
                      {/* Step Card */}
                      <Card className="flex-1 glass-card hover:border-border/60 transition-all shadow-sm relative overflow-hidden">
                        <div 
                          className="absolute left-0 top-0 bottom-0 w-1 opacity-50"
                          style={{ backgroundColor: color }}
                        />
                        <CardHeader className="px-5 py-3 border-b border-border/40 bg-muted/20">
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-sm">Step {i + 1}</span>
                            <span className="text-muted-foreground text-xs font-medium">
                              Wait {step.day_offset as number} day{(step.day_offset as number) !== 1 ? 's' : ''}
                            </span>
                            <Badge variant="outline" className="ml-auto text-[10px] uppercase font-medium bg-background">
                              {channel === 'linkedin_dm' ? 'LinkedIn' : channel === 'task' ? 'Manual Task' : 'Email'}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="p-5">
                          {step.subject_template && (
                            <div className="text-sm font-semibold mb-2 flex items-start gap-2">
                              <span className="text-muted-foreground uppercase text-[10px] tracking-wider mt-0.5">Subj:</span>
                              <span className="font-mono bg-muted/40 px-2 py-0.5 rounded">{step.subject_template as string}</span>
                            </div>
                          )}
                          <div className="text-sm text-foreground/80 whitespace-pre-wrap font-mono bg-muted/20 p-3 rounded-lg border border-border/30 max-h-40 overflow-y-auto text-xs leading-relaxed">
                            {step.body_template as string}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )
                })}

                {steps.length === 0 && (
                  <div className="p-8 text-center text-sm text-muted-foreground border-2 border-dashed border-border/50 rounded-xl">
                    No steps found for this sequence.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar — Enrollment Stats */}
          <div className="lg:col-span-1 flex flex-col gap-6">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Enrollments
            </h2>
            
            <Card className="glass-card animate-slide-in-up" style={{ animationDelay: '200ms' }}>
              <CardHeader className="px-5 pt-5 pb-2">
                <CardTitle className="text-3xl font-bold flex items-baseline gap-2">
                  {enrollCount}
                  <span className="text-sm font-medium text-muted-foreground tracking-normal">total</span>
                </CardTitle>
              </CardHeader>
              
              <CardContent className="px-5 pb-6 flex flex-col gap-6">
                
                {/* Horizontal Stacked Bar */}
                {enrollCount > 0 ? (
                  <div className="w-full h-3 flex rounded-full overflow-hidden bg-muted">
                    {activeCount > 0 && <div className="h-full animate-bar-grow bg-[var(--chart-teal)]" style={{ width: `${getStatusPct(activeCount)}%`, transformOrigin: 'left', animationDelay: '300ms' }} />}
                    {completedCount > 0 && <div className="h-full animate-bar-grow bg-[var(--chart-emerald)]" style={{ width: `${getStatusPct(completedCount)}%`, transformOrigin: 'left', animationDelay: '400ms' }} />}
                    {pausedCount > 0 && <div className="h-full animate-bar-grow bg-[var(--chart-amber)]" style={{ width: `${getStatusPct(pausedCount)}%`, transformOrigin: 'left', animationDelay: '500ms' }} />}
                    {failedCount > 0 && <div className="h-full animate-bar-grow bg-[var(--chart-rose)]" style={{ width: `${getStatusPct(failedCount)}%`, transformOrigin: 'left', animationDelay: '600ms' }} />}
                  </div>
                ) : (
                  <div className="w-full h-3 rounded-full bg-muted" />
                )}

                {/* Legend List */}
                <div className="flex flex-col gap-3">
                  <StatusRow label="Active" count={activeCount} total={enrollCount} color="var(--chart-teal)" />
                  <StatusRow label="Completed" count={completedCount} total={enrollCount} color="var(--chart-emerald)" />
                  <StatusRow label="Paused" count={pausedCount} total={enrollCount} color="var(--chart-amber)" />
                  <StatusRow label="Failed" count={failedCount} total={enrollCount} color="var(--chart-rose)" />
                </div>
                
              </CardContent>
            </Card>

            <div className="p-4 rounded-xl bg-[var(--chart-sky)]/5 border border-[var(--chart-sky)]/20 flex gap-3 animate-slide-in-up" style={{ animationDelay: '300ms' }}>
              <div className="mt-0.5 text-[var(--chart-sky)]">
                <Play className="w-4 h-4 fill-current" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground/90">Agentic execution in v1.1</h4>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  Sequences are currently read-only templates. Full background execution via Fly.io microservices arrives in the next release.
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>
    </div>
  )
}

function StatusRow({ label, count, total, color }: { label: string, count: number, total: number, color: string }) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100)
  return (
    <div className="flex items-center justify-between text-sm group">
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-sm opacity-80" style={{ backgroundColor: color }} />
        <span className="font-medium text-foreground/80">{label}</span>
      </div>
      <div className="flex items-center gap-3 font-mono text-xs">
        <span className="text-foreground">{count}</span>
        <span className="text-muted-foreground w-8 text-right">{pct}%</span>
      </div>
    </div>
  )
}
