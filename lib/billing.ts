import Stripe from "stripe"
import Razorpay from "razorpay"
import { createAdminClient } from "@/lib/supabase/server"
import { PLANS, PlanType } from "@/lib/billing-shared"
import { CREDIT_PACKS, CreditPackId } from "@/lib/credit-costs"

export { PLANS, type PlanType } // Re-export for backend files

export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? ""
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? ""
export const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID ?? ""
export const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? ""
export const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? ""

let stripeClient: Stripe | null = null
export function getStripe(): Stripe {
  if (!stripeClient) {
    if (!STRIPE_SECRET_KEY) {
      throw new Error("Stripe secret key is missing")
    }
    stripeClient = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2026-04-22.dahlia",
      typescript: true,
    })
  }
  return stripeClient
}

let razorpayClient: Razorpay | null = null
export function getRazorpay() {
  if (!razorpayClient) {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      throw new Error("Razorpay keys are missing")
    }
    razorpayClient = new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET,
    })
  }
  return razorpayClient
}


/**
 * Upgrades a user's plan and allocates credits.
 * This should only be called from verified webhook endpoints.
 */
export async function upgradeUserPlan(
  userId: string,
  plan: PlanType,
  idempotencyKey: string,
  provider: "stripe" | "razorpay"
) {
  // Validate before recording anything — webhook payloads are untrusted.
  const planInfo = PLANS[plan]
  if (plan === "free" || !planInfo) {
    throw new Error(`Invalid plan for upgrade: ${plan}`)
  }

  // 1. Check idempotency
  const adminClient = createAdminClient()
  const { data: existingEvent } = await adminClient
    .from("webhook_events")
    .select("id")
    .eq("id", idempotencyKey)
    .maybeSingle()

  if (existingEvent) {
    console.log(`[billing] Webhook event ${idempotencyKey} already processed. Skipping.`)
    return
  }

  // 2. Insert idempotency record (webhook_events: id, provider, payload)
  await adminClient.from("webhook_events").insert({
    id: idempotencyKey,
    provider,
    payload: { plan, userId, type: "billing.upgrade" },
  })

  // 3. Update user
  const { error } = await adminClient
    .from("users")
    .update({
      plan,
      credits_remaining: planInfo.credits,
      // reset the billing cycle conceptually
      credits_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq("id", userId)

  if (error) {
    console.error("[billing] Failed to update user plan", error)
    throw new Error("Failed to update user plan")
  }

  // Ledger entry so the credit history reflects the paid grant.
  await adminClient.from("credit_transactions").insert({
    user_id: userId,
    delta: planInfo.credits,
    reason: `plan_upgrade_${plan}`,
  })
}

// ---------------------------------------------------------------------
// Razorpay Subscriptions / UPI AutoPay (recurring). Additive — the
// one-time order path above is unchanged.
// ---------------------------------------------------------------------

/**
 * Map a paid plan to its Razorpay subscription plan_id (created once in the
 * Razorpay dashboard), via env. Returns null when unset → the mock path.
 */
export function planToRazorpayPlanId(plan: PlanType): string | null {
  const map: Record<string, string | undefined> = {
    starter: process.env.RAZORPAY_PLAN_STARTER,
    pro: process.env.RAZORPAY_PLAN_PRO,
    agency: process.env.RAZORPAY_PLAN_AGENCY,
  }
  return map[plan] ?? null
}

export interface SubscriptionResult {
  subscriptionId: string
  mock: boolean
  error?: string
}

/**
 * Create a Razorpay subscription (UPI AutoPay-capable) and stamp it on the
 * user. Mock-safe: with no Razorpay keys or no configured plan_id it returns
 * a mock id so the flow is demoable without a live account.
 */
export async function createRazorpaySubscription(
  userId: string,
  plan: PlanType,
): Promise<SubscriptionResult> {
  if (plan === "free" || !PLANS[plan]) {
    return { subscriptionId: "", mock: true, error: "Invalid plan" }
  }

  const admin = createAdminClient()
  const planId = planToRazorpayPlanId(plan)

  // Mock path — no keys or no configured Razorpay plan_id.
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !planId) {
    const mockId = `sub_mock_${Date.now().toString(36)}`
    await admin
      .from("users")
      .update({ razorpay_subscription_id: mockId, subscription_status: "created" })
      .eq("id", userId)
    return { subscriptionId: mockId, mock: true }
  }

  try {
    const sub = await getRazorpay().subscriptions.create({
      plan_id: planId,
      total_count: 12,
      customer_notify: 1,
      notes: { plan, userId },
    })
    await admin
      .from("users")
      .update({ razorpay_subscription_id: sub.id, subscription_status: "created" })
      .eq("id", userId)
    return { subscriptionId: sub.id as string, mock: false }
  } catch (err) {
    return {
      subscriptionId: "",
      mock: false,
      error: err instanceof Error ? err.message : "subscription failed",
    }
  }
}

/** Update a subscription's status from a webhook (activated/charged/halted/…). */
export async function setSubscriptionStatus(
  subscriptionId: string,
  status: string,
): Promise<void> {
  const admin = createAdminClient()
  await admin
    .from("users")
    .update({ subscription_status: status })
    .eq("razorpay_subscription_id", subscriptionId)
}

// ---------------------------------------------------------------------
// Credit top-ups — one-time credit pack purchases and enterprise grants.
// These do NOT reset the billing cycle, only add to credits_remaining.
// ---------------------------------------------------------------------

/**
 * Add `creditsToAdd` credits to a user's current balance.
 * Writes a credit_transactions ledger entry for the audit trail.
 *
 * @param userId       Target user.
 * @param creditsToAdd Number of credits to add (must be > 0).
 * @param reason       Human-readable ledger reason (e.g. "credit_pack_pack_6000").
 * @param paymentId    Optional payment provider reference for traceability.
 */
export async function topUpCredits(
  userId: string,
  creditsToAdd: number,
  reason: string,
  paymentId?: string,
): Promise<{ ok: boolean; newBalance: number; error?: string }> {
  if (creditsToAdd <= 0) {
    return { ok: false, newBalance: 0, error: "Credits to add must be positive." }
  }

  const admin = createAdminClient()

  // Read current balance.
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("credits_remaining")
    .eq("id", userId)
    .maybeSingle()

  if (readErr || !row) {
    return { ok: false, newBalance: 0, error: "Could not read credit balance." }
  }

  const current = (row.credits_remaining as number) ?? 0
  const newBalance = current + creditsToAdd

  const { error: updateErr } = await admin
    .from("users")
    .update({ credits_remaining: newBalance })
    .eq("id", userId)

  if (updateErr) {
    console.error("[billing] topUpCredits update failed", updateErr)
    return { ok: false, newBalance: current, error: "Failed to update credit balance." }
  }

  // Ledger entry — include payment reference when provided.
  await admin.from("credit_transactions").insert({
    user_id: userId,
    delta: creditsToAdd,
    reason,
    ...(paymentId ? { payment_id: paymentId } : {}),
  })

  return { ok: true, newBalance }
}

/**
 * Purchase a one-time credit pack for a user.
 * Looks up the pack from CREDIT_PACKS, calls topUpCredits, then records
 * the purchase in the credit_packs table.
 *
 * @param userId    Target user.
 * @param packId    Pack identifier — must match a CreditPackId in CREDIT_PACKS.
 * @param provider  Payment provider ("stripe" | "razorpay").
 * @param paymentId Provider-issued payment / order ID for traceability.
 */
export async function purchaseCreditPack(
  userId: string,
  packId: CreditPackId,
  provider: "stripe" | "razorpay",
  paymentId: string,
): Promise<{ ok: boolean; creditsAdded: number; error?: string }> {
  const pack = CREDIT_PACKS.find((p) => p.id === packId)
  if (!pack) {
    return { ok: false, creditsAdded: 0, error: `Unknown pack id: ${packId}` }
  }

  const topUp = await topUpCredits(
    userId,
    pack.credits,
    `credit_pack_${packId}`,
    paymentId,
  )

  if (!topUp.ok) {
    return { ok: false, creditsAdded: 0, error: topUp.error }
  }

  // Record the pack purchase for billing history / analytics.
  const admin = createAdminClient()
  await admin.from("credit_packs").insert({
    user_id: userId,
    pack_id: packId,
    credits_added: pack.credits,
    payment_provider: provider,
    payment_id: paymentId,
  })

  return { ok: true, creditsAdded: pack.credits }
}
