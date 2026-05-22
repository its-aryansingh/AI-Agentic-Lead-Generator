import Stripe from "stripe"
import Razorpay from "razorpay"
import { createAdminClient } from "@/lib/supabase/server"
import { PLANS, PlanType } from "./billing-shared"

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
