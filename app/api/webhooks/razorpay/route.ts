import { headers } from "next/headers"
import crypto from "crypto"
import { RAZORPAY_WEBHOOK_SECRET, upgradeUserPlan, PlanType } from "@/lib/billing"

export async function POST(req: Request) {
  const body = await req.text()
  const headerList = await headers()
  const signature = headerList.get("x-razorpay-signature")

  if (!signature) {
    return new Response("Missing signature", { status: 400 })
  }

  const expectedSignature = crypto
    .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
    .update(body)
    .digest("hex")

  if (signature !== expectedSignature) {
    return new Response("Invalid signature", { status: 400 })
  }

  try {
    const event = JSON.parse(body)
    
    // Process captured payments
    if (event.event === "payment.captured") {
      const payment = event.payload.payment.entity
      const { plan, userId } = payment.notes || {}
      
      if (plan && userId) {
        // razorpay event ids look like 'evnt_xyz'
        const idempotencyKey = event.id || payment.id
        await upgradeUserPlan(userId, plan as PlanType, idempotencyKey)
      }
    }

    return new Response("Webhook processed", { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[razorpay-webhook] Error:", message)
    return new Response(`Webhook error: ${message}`, { status: 400 })
  }
}
