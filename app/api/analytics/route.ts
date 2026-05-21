/**
 * GET /api/analytics
 *
 * Returns aggregated stats for the authenticated user's analytics dashboard.
 * Uses the RLS-scoped client so every query is automatically restricted to
 * the calling user's data — no manual user_id filter required on most tables.
 */

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return new NextResponse("Unauthorized", { status: 401 })

  // Run all independent queries in parallel.
  const [
    jobsResult,
    prospectsResult,
    creditsResult,
    userResult,
    emailsPerDayResult,
  ] = await Promise.all([
    // Total jobs + completion breakdown
    supabase.from("jobs").select("id,status,prospect_count,created_at,completed_at,sheet_url"),

    // All prospects with email + stage for funnel metrics
    supabase
      .from("prospects")
      .select("id,email,stage,status,created_at")
      .eq("status", "completed"),

    // Credit consumption in the last 30 days
    supabase
      .from("credit_transactions")
      .select("delta,created_at")
      .lt("delta", 0)
      .gte("created_at", new Date(Date.now() - 30 * 86400 * 1000).toISOString()),

    // Current credit balance
    supabase
      .from("users")
      .select("credits_remaining,plan")
      .eq("id", user.id)
      .single(),

    // Emails sent per day — last 30 days (prospects with email, grouped by date)
    supabase
      .from("prospects")
      .select("created_at")
      .not("email", "is", null)
      .eq("status", "completed")
      .gte("created_at", new Date(Date.now() - 30 * 86400 * 1000).toISOString()),
  ])

  const jobs = jobsResult.data ?? []
  const prospects = prospectsResult.data ?? []
  const creditTxns = creditsResult.data ?? []
  const userData = userResult.data

  // --- Summary metrics ---
  const totalProspects = prospects.length
  const emailsSent = prospects.filter((p) => p.email).length

  const stageBreakdown = {
    contacted: 0,
    replied: 0,
    interested: 0,
    converted: 0,
    unsubscribed: 0,
  }
  for (const p of prospects) {
    const s = p.stage as keyof typeof stageBreakdown | null
    if (s && s in stageBreakdown) stageBreakdown[s]++
  }

  const replied = stageBreakdown.replied + stageBreakdown.interested + stageBreakdown.converted
  const interested = stageBreakdown.interested + stageBreakdown.converted

  const replyRate = emailsSent > 0 ? replied / emailsSent : 0
  const interestedRate = emailsSent > 0 ? interested / emailsSent : 0
  const creditsUsed30d = creditTxns.reduce((sum, t) => sum + Math.abs(t.delta), 0)

  // --- Emails sent per day (last 30 days) ---
  const dailyMap = new Map<string, number>()
  for (const p of emailsPerDayResult.data ?? []) {
    const date = (p.created_at as string).slice(0, 10)
    dailyMap.set(date, (dailyMap.get(date) ?? 0) + 1)
  }
  const emailsPerDay = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }))

  // --- Recent jobs (last 10) ---
  const recentJobs = jobs
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10)
    .map((j) => ({
      id: j.id,
      status: j.status,
      prospect_count: j.prospect_count,
      created_at: j.created_at,
      completed_at: j.completed_at,
      sheet_url: j.sheet_url,
    }))

  return NextResponse.json({
    summary: {
      total_prospects: totalProspects,
      emails_sent: emailsSent,
      reply_rate: Math.round(replyRate * 1000) / 1000,
      interested_rate: Math.round(interestedRate * 1000) / 1000,
      credits_remaining: userData?.credits_remaining ?? 0,
      credits_used_30d: creditsUsed30d,
      plan: userData?.plan ?? "free",
    },
    stage_breakdown: stageBreakdown,
    emails_per_day: emailsPerDay,
    recent_jobs: recentJobs,
  })
}
