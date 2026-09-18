/**
 * Credit metering — controls the free-tier budget and all AI operation costs.
 *
 * One credit powers an AI operation (research, writing, chat turn, etc.).
 * credits_remaining is denormalized on public.users for fast reads;
 * credit_transactions is the append-only ledger that lets us reconstruct
 * balance if needed.
 *
 * Used by start_bulk_job and AI route handlers to refuse runs that would
 * overdraw the user.
 */

import { createAdminClient } from "@/lib/supabase/server"
import { PLANS } from "@/lib/billing-shared"

/**
 * Plan-default monthly credit grants. Sourced from the canonical paid PLANS
 * catalog so a monthly reset grants exactly what the plan was sold for.
 */
const PLAN_CREDITS: Record<string, number> = {
  free: PLANS.free.credits,
  starter: PLANS.starter.credits,
  pro: PLANS.pro.credits,
  agency: PLANS.agency.credits,
}

/**
 * Resets credits_remaining when credits_reset_at has passed.
 *
 * Idempotent + safe to call on every request that knows the user id —
 * it skips users whose reset_at is still in the future, so the cost is
 * one read + (at most monthly) one write per active user.
 *
 * Rollover logic: carry forward up to rolloverPercent% of unused credits
 * (floor(unused * rolloverPercent / 100)). The rollover amount is stored
 * in plan_rollover_credits on users for visibility. Grant = baseGrant + rolloverAmount.
 *
 * Called from /api/chat at the top of each turn so the free tier is
 * actually renewable.
 */
export async function maybeResetCredits(userId: string): Promise<void> {
  const supabase = createAdminClient()
  const { data: row } = await supabase
    .from("users")
    .select("plan,credits_remaining,credits_reset_at")
    .eq("id", userId)
    .maybeSingle()
  if (!row) return

  const resetAt = row.credits_reset_at
    ? new Date(row.credits_reset_at as string)
    : null
  if (!resetAt || resetAt > new Date()) return

  const plan = (row.plan as string) ?? "free"
  const baseGrant = PLAN_CREDITS[plan] ?? PLAN_CREDITS.free
  const currentRemaining = (row.credits_remaining as number) ?? 0

  // Rollover: carry forward up to rolloverPercent% of unused credits.
  const rolloverPct = (PLANS as Record<string, { rolloverPercent?: number }>)[plan]?.rolloverPercent ?? 0
  const rolloverAmount =
    rolloverPct > 0 ? Math.floor(currentRemaining * (rolloverPct / 100)) : 0
  const grant = baseGrant + rolloverAmount

  const nextReset = new Date(Date.now() + 30 * 86_400_000).toISOString()

  await supabase
    .from("users")
    .update({
      credits_remaining: grant,
      credits_reset_at: nextReset,
      plan_rollover_credits: rolloverAmount,
    })
    .eq("id", userId)
    .lt("credits_reset_at", new Date().toISOString())

  // Ledger entry for visibility.
  await supabase.from("credit_transactions").insert({
    user_id: userId,
    delta: grant,
    reason: `monthly_reset_${plan}${rolloverAmount > 0 ? `_rollover_${rolloverAmount}` : ""}`,
  })
}

export interface CreditCheck {
  ok: boolean
  remaining: number
  required: number
  reason?: string
}

/**
 * Check whether the user has enough credits for `count` prospects.
 * Read-only — does NOT deduct.
 */
export async function checkCredits(
  userId: string,
  count: number,
): Promise<CreditCheck> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("users")
    .select("credits_remaining,credits_reset_at")
    .eq("id", userId)
    .maybeSingle()

  if (error || !data) {
    // If we can't read the row we fail closed — refuse, don't silently
    // grant infinite credits.
    return {
      ok: false,
      remaining: 0,
      required: count,
      reason: "Could not read credit balance.",
    }
  }

  const remaining = (data.credits_remaining as number) ?? 0
  if (remaining < count) {
    return {
      ok: false,
      remaining,
      required: count,
      reason: `Need ${count} credits; you have ${remaining}. Free tier resets monthly.`,
    }
  }
  return { ok: true, remaining, required: count }
}

/**
 * Deduct `count` credits and write a ledger entry. Atomic-ish:
 * we read+write in two roundtrips but guard against negative balances
 * by re-reading inside the update. For real-world race resilience
 * we should move this to a Postgres function — but for v0.5 single-job
 * single-user this is enough.
 *
 * @param opts.jobId  Optional — AI operations may not have a job ID.
 *                    Defaults to "system" when omitted.
 */
export async function deductCredits(opts: {
  userId: string
  count: number
  jobId?: string
  reason: string
}): Promise<{ ok: boolean; remaining: number; error?: string }> {
  const { userId, count, jobId = "system", reason } = opts
  const supabase = createAdminClient()

  // Read current.
  const { data: row } = await supabase
    .from("users")
    .select("credits_remaining")
    .eq("id", userId)
    .maybeSingle()
  const current = (row?.credits_remaining as number | undefined) ?? 0
  if (current < count) {
    return {
      ok: false,
      remaining: current,
      error: `Insufficient credits: ${current} < ${count}.`,
    }
  }

  const next = current - count

  // Conditional update — only succeeds if no concurrent run already
  // drained the balance. Without a stored procedure this is the best
  // we can do without a transaction layer.
  const { data: updated, error: updateErr } = await supabase
    .from("users")
    .update({ credits_remaining: next })
    .eq("id", userId)
    .eq("credits_remaining", current)
    .select("credits_remaining")
    .maybeSingle()

  if (updateErr || !updated) {
    return {
      ok: false,
      remaining: current,
      error: "Credit balance changed concurrently — try again.",
    }
  }

  // Best-effort ledger write — never blocks the user flow.
  await supabase.from("credit_transactions").insert({
    user_id: userId,
    delta: -count,
    reason,
    job_id: jobId,
  })

  return { ok: true, remaining: next }
}

/**
 * Add credits to a user's balance without resetting the plan cycle.
 * Used for one-time credit pack purchases and enterprise top-ups.
 * Writes a credit_transactions ledger entry for the audit trail.
 *
 * @param userId     Target user.
 * @param amount     Number of credits to add (must be > 0).
 * @param reason     Human-readable ledger reason (e.g. "credit_pack_pack_6000").
 * @param paymentId  Optional payment provider reference for traceability.
 */
export async function addCredits(
  userId: string,
  amount: number,
  reason: string,
  paymentId?: string,
): Promise<{ ok: boolean; newBalance: number; error?: string }> {
  if (amount <= 0) {
    return { ok: false, newBalance: 0, error: "Credit amount must be positive." }
  }

  const supabase = createAdminClient()

  // Read current balance.
  const { data: row, error: readErr } = await supabase
    .from("users")
    .select("credits_remaining")
    .eq("id", userId)
    .maybeSingle()

  if (readErr || !row) {
    return { ok: false, newBalance: 0, error: "Could not read credit balance." }
  }

  const current = (row.credits_remaining as number) ?? 0
  const newBalance = current + amount

  const { error: updateErr } = await supabase
    .from("users")
    .update({ credits_remaining: newBalance })
    .eq("id", userId)

  if (updateErr) {
    return {
      ok: false,
      newBalance: current,
      error: "Failed to update credit balance.",
    }
  }

  // Ledger entry — include payment reference when provided.
  await supabase.from("credit_transactions").insert({
    user_id: userId,
    delta: amount,
    reason,
    ...(paymentId ? { payment_id: paymentId } : {}),
  })

  return { ok: true, newBalance }
}
