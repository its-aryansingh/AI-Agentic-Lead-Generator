import { createClient } from "@/lib/supabase/server"
import { AnalyticsClient, type AnalyticsData } from "./analytics-client"

function getMonthAgoIso(): string {
  return new Date(Date.now() - 30 * 86_400_000).toISOString()
}

/**
 * /app/analytics — read-only metrics dashboard.
 *
 * Aggregates over the user's existing rows.
 */
export default async function AnalyticsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const monthAgo = getMonthAgoIso()

  // Lifetime + monthly job counts.
  const { count: totalJobs } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })

  const { count: monthlyJobs } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", monthAgo)

  // Total prospects enriched.
  const { count: totalProspects } = await supabase
    .from("prospects")
    .select("id", { count: "exact", head: true })

  const { count: monthlyProspects } = await supabase
    .from("prospects")
    .select("id", { count: "exact", head: true })
    .gte("created_at", monthAgo)

  // Credits used this month (sum of negative ledger entries).
  const { data: creditTxns } = await supabase
    .from("credit_transactions")
    .select("delta")
    .lt("delta", 0)
    .gte("created_at", monthAgo)
  const creditsUsedThisMonth = (creditTxns ?? []).reduce(
    (s, r) => s + Math.abs((r.delta as number) ?? 0),
    0,
  )

  // Source mix — count prospect_candidates by source over the month.
  const { data: candidateRows } = await supabase
    .from("prospect_candidates")
    .select("source")
    .gte("created_at", monthAgo)
  const sourceMix = (candidateRows ?? []).reduce<Record<string, number>>(
    (acc, r) => {
      const k = String(r.source ?? "unknown")
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    },
    {},
  )
  const topSources = Object.entries(sourceMix)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  // Sequences + active enrollments.
  const { count: sequenceCount } = await supabase
    .from("sequences")
    .select("id", { count: "exact", head: true })

  const { count: enrolledCount } = await supabase
    .from("sequence_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")

  // Voice anchor presence.
  let hasVoiceAnchor = false
  let creditsRemaining = 0
  if (user) {
    const { data: u } = await supabase
      .from("users")
      .select("voice_anchor_text,credits_remaining")
      .eq("id", user.id)
      .maybeSingle()
    hasVoiceAnchor =
      typeof u?.voice_anchor_text === "string" &&
      (u.voice_anchor_text as string).length > 0
    creditsRemaining = (u?.credits_remaining as number) ?? 0
  }

  const avgProspectsPerJob = monthlyJobs && monthlyJobs > 0 
    ? Math.round((monthlyProspects ?? 0) / monthlyJobs)
    : 0

  const analyticsData: AnalyticsData = {
    monthlyJobs: monthlyJobs ?? 0,
    totalJobs: totalJobs ?? 0,
    monthlyProspects: monthlyProspects ?? 0,
    totalProspects: totalProspects ?? 0,
    creditsUsedThisMonth,
    creditsRemaining,
    enrolledCount: enrolledCount ?? 0,
    sequenceCount: sequenceCount ?? 0,
    topSources,
    hasVoiceAnchor,
    avgProspectsPerJob
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-background/50 relative overflow-hidden">
      {/* Decorative gradient blob */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-gradient-to-b from-[var(--chart-violet)]/10 via-[var(--chart-emerald)]/5 to-transparent blur-3xl -z-10 pointer-events-none opacity-40" />
      
      <header className="px-6 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Metrics and performance across your campaigns and sequences.
          </p>
        </div>
      </header>

      <section className="flex-1 overflow-y-auto px-6">
        <AnalyticsClient data={analyticsData} />
      </section>
    </div>
  )
}
