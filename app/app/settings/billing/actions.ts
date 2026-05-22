"use server"

import { getStripe, getRazorpay, createRazorpaySubscription, PLANS, PlanType } from "@/lib/billing"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

export async function createStripeCheckoutSession(plan: PlanType) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("Unauthorized")
  }

  const planInfo = PLANS[plan]
  
  if (plan === "free") {
    throw new Error("Cannot checkout free plan")
  }

  const session = await getStripe().checkout.sessions.create({
    payment_method_types: ["card"],
    customer_email: user.email,
    client_reference_id: user.id,
    metadata: {
      plan,
      userId: user.id,
    },
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `LeadGenAI ${planInfo.name} Plan`,
            description: `${planInfo.credits} credits/month`,
          },
          unit_amount: planInfo.priceUsd * 100, // cents
        },
        quantity: 1,
      },
    ],
    mode: "payment", 
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/app/settings/billing?success=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/app/settings/billing?canceled=true`,
  })

  if (session.url) {
    redirect(session.url)
  }
}

export async function createRazorpayOrder(plan: PlanType) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("Unauthorized")
  }



  const planInfo = PLANS[plan]
  
  if (plan === "free") {
    throw new Error("Cannot checkout free plan")
  }

  const options = {
    amount: planInfo.priceInr * 100, // paise
    currency: "INR",
    receipt: `rcpt_${user.id.substring(0,8)}_${Date.now()}`,
    notes: {
      plan,
      userId: user.id,
    },
  }

  const order = await getRazorpay().orders.create(options)

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
    userId: user.id,
    userEmail: user.email,
    plan,
  }
}

export async function createRazorpaySubscriptionAction(plan: PlanType) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error("Unauthorized")
  }
  if (plan === "free") {
    throw new Error("Cannot subscribe to free plan")
  }

  const result = await createRazorpaySubscription(user.id, plan)
  return {
    subscriptionId: result.subscriptionId,
    mock: result.mock,
    error: result.error,
    keyId: process.env.RAZORPAY_KEY_ID,
    userEmail: user.email,
    plan,
  }
}
