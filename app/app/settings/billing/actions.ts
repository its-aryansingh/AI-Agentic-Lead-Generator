"use server";

import {
  getStripe,
  getRazorpay,
  createRazorpaySubscription,
  PLANS,
  PlanType,
} from "@/lib/billing";
import { CREDIT_PACKS, CreditPackId } from "@/lib/credit-costs";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function createStripeCheckoutSession(plan: PlanType) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  const planInfo = PLANS[plan];

  if (plan === "free") {
    throw new Error("Cannot checkout free plan");
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
            name: `Aravya SalesEngAI ${planInfo.name} Plan`,
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
  });

  if (session.url) {
    redirect(session.url);
  }
}

export async function createRazorpayOrder(plan: PlanType) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  const planInfo = PLANS[plan];

  if (plan === "free") {
    throw new Error("Cannot checkout free plan");
  }

  const options = {
    amount: planInfo.priceInr * 100, // paise
    currency: "INR",
    receipt: `rcpt_${user.id.substring(0, 8)}_${Date.now()}`,
    notes: {
      plan,
      userId: user.id,
    },
  };

  const order = await getRazorpay().orders.create(options);

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
    userId: user.id,
    userEmail: user.email,
    plan,
  };
}

export async function createRazorpaySubscriptionAction(plan: PlanType) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  if (plan === "free") {
    throw new Error("Cannot subscribe to free plan");
  }

  const result = await createRazorpaySubscription(user.id, plan);
  return {
    subscriptionId: result.subscriptionId,
    mock: result.mock,
    error: result.error,
    keyId: process.env.RAZORPAY_KEY_ID,
    userEmail: user.email,
    plan,
  };
}

/**
 * Server action to purchase a one-time credit pack.
 *
 * - currency === "USD"  → creates a Stripe Checkout session and redirects.
 * - currency === "INR"  → creates a Razorpay order and returns metadata for
 *                         the client to open the Razorpay modal.
 */
export async function purchaseCreditPackAction(
  packId: CreditPackId,
  currency: "INR" | "USD",
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  if (!pack) {
    throw new Error(`Unknown credit pack: ${packId}`);
  }

  if (currency === "USD") {
    const session = await getStripe().checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: user.email,
      client_reference_id: user.id,
      metadata: {
        type: "credit_pack",
        packId,
        userId: user.id,
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `SalesEngAI ${pack.label}`,
              description: `${pack.credits.toLocaleString()} credits (one-time)`,
            },
            unit_amount: pack.priceUsd * 100, // cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/app/settings/billing?pack_success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/app/settings/billing?pack_canceled=true`,
    });

    if (session.url) {
      redirect(session.url);
    }
  }

  // INR — create a Razorpay order and return details for the client modal.
  const order = await getRazorpay().orders.create({
    amount: pack.priceInr * 100, // paise
    currency: "INR",
    receipt: `rcpt_pack_${user.id.substring(0, 8)}_${Date.now()}`,
    notes: {
      type: "credit_pack",
      packId,
      userId: user.id,
    },
  });

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
    userId: user.id,
    userEmail: user.email,
    packId,
    creditsToAdd: pack.credits,
  };
}
