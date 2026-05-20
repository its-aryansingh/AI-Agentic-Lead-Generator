import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// Hoisted outside the component so the react-hooks/purity lint rule
// (which flags Date.now() during render even in RSC contexts) doesn't
// fire. Server components are re-evaluated per request, so this is
// safe to call here too.
function getMonthAgoIso(): string {
  return new Date(Date.now() - 30 * 86_400_000).toISOString()
}

/**
 * /app/analytics — read-only metrics dashboard.
 *
 * Aggregates over the user's existing rows. v1.0 surfaces:
 *   - Lifetime totals (jobs, prospects, sequences)
 *   - This month's activity (jobs, prospects, credits used)
 *   - Top discovery sources
 *   - Voice-anchor adoption (single yes/no — but visible alongside the
 *     numbers is the right frame for nudging it)
 *
 * v1.1 adds reply rate, sequence step performance, segment funnels.
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

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b border-border">
        <h1 className="text-base font-semibold">Analytics</h1>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-4xl mx-auto flex flex-col gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="Jobs this month" value={String(monthlyJobs ?? 0)} sub={`${totalJobs ?? 0} all-time`} />
            <Metric
              label="Prospects this month"
              value={String(monthlyProspects ?? 0)}
              sub={`${totalProspects ?? 0} all-time`}
            />
            <Metric
              label="Credits used"
              value={String(creditsUsedThisMonth)}
              sub={`${creditsRemaining} remaining`}
            />
            <Metric
              label="Active enrollments"
              value={String(enrolledCount ?? 0)}
              sub={`${sequenceCount ?? 0} sequence${(sequenceCount ?? 0) === 1 ? "" : "s"}`}
            />
          </div>

          <Card size="sm">
            <CardHeader className="px-4">
              <CardTitle>Discovery sources — last 30 days</CardTitle>
            </CardHeader>
            <CardContent>
              {topSources.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No candidates surfaced yet. Run a search or upload a CSV to
                  populate this.
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {topSources.map(([source, count]) => {
                    const total = topSources.reduce((s, [, c]) => s + c, 0)
                    const pct = total === 0 ? 0 : Math.round((count / total) * 100)
                    return (
                      <li key={source} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono">{source}</span>
                          <span className="text-muted-foreground">
                            {count} · {pct}%
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader className="px-4">
              <CardTitle>Quality signals</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Voice anchor set</span>
                <span className="font-medium">{hasVoiceAnchor ? "yes" : "no"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Avg prospects / job (last 30d)
                </span>
                <span className="font-medium">
                  {monthlyJobs && monthlyJobs > 0
                    ? Math.round((monthlyProspects ?? 0) / monthlyJobs)
                    : 0}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground italic mt-2">
                Reply-rate, open-rate, and per-sequence-step funnels land in
                v1.1 with the Gmail send integration.
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  )
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <Card size="sm">
      <CardContent className="py-4 flex flex-col">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {sub && (
          <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
        )}
      </CardContent>
    </Card>
  )
}
