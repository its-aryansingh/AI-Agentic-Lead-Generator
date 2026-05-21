import { headers } from "next/headers"
import { stripe, STRIPE_WEBHOOK_SECRET, upgradeUserPlan, PlanType } from "@/lib/billing"

export async function POST(req: Request) {
  const body = await req.text()
  const headerList = await headers()
  const signature = headerList.get("stripe-signature")

  if (!signature) {
    return new Response("Missing signature", { status: 400 })
  }

  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      STRIPE_WEBHOOK_SECRET
    )

    if (event.type === "checkout.session.completed") {
      const session = event.data.object
      const { plan, userId } = session.metadata || {}
      
      if (plan && userId) {
        await upgradeUserPlan(userId, plan as PlanType, event.id)
      }
    }

    return new Response("Webhook processed", { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[stripe-webhook] Error:", message)
    return new Response(`Webhook error: ${message}`, { status: 400 })
  }
}
