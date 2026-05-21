"use client"

import { useState } from "react"
import { PLANS, PlanType } from "@/lib/billing-shared"
import { createStripeCheckoutSession, createRazorpayOrder } from "./actions"
import Script from "next/script"
import { Button } from "@/components/ui/button"
import { Check, Sparkles, Loader2, IndianRupee, DollarSign } from "lucide-react"
import { cn } from "@/lib/utils"

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void }
  }
}

export function BillingClient({
  currentPlan,
  creditsRemaining,
}: {
  currentPlan: PlanType
  creditsRemaining: number
}) {
  const [loadingPlan, setLoadingPlan] = useState<PlanType | null>(null)
  const [currency, setCurrency] = useState<"INR" | "USD">("USD")

  const handleCheckout = async (plan: PlanType) => {
    setLoadingPlan(plan)
    try {
      if (currency === "USD") {
        await createStripeCheckoutSession(plan)
      } else {
        const order = await createRazorpayOrder(plan)
        const options = {
          key: order.keyId,
          amount: order.amount,
          currency: order.currency,
          name: "LeadGenAI",
          description: `Upgrade to ${PLANS[plan].name}`,
          order_id: order.orderId,
          // Razorpay does NOT copy order notes to the payment entity; the
          // payment.captured webhook reads payment.notes, so attach them here.
          notes: {
            plan: order.plan,
            userId: order.userId,
          },
          handler: function () {
            // The webhook is the source of truth for the upgrade; redirect optimistically.
            window.location.href = "/app/settings/billing?success=true"
          },
          prefill: {
            email: order.userEmail,
          },
          theme: {
            color: "#000000",
          },
        }
        
        const rzp = new window.Razorpay(options)
        rzp.open()
      }
    } catch (error) {
      console.error(error)
      alert("Checkout failed. Please try again.")
    } finally {
      if (currency === "INR") {
        setLoadingPlan(null) // Stripe redirects, but Razorpay opens a modal
      }
    }
  }

  const plans = [
    { id: "starter", ...PLANS.starter },
    { id: "pro", ...PLANS.pro, popular: true },
    { id: "agency", ...PLANS.agency },
  ] as const

  return (
    <div className="space-y-8">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" />
      
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6">
        <h2 className="text-xl font-medium text-white mb-4">Current Usage</h2>
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex-1">
            <p className="text-sm text-zinc-400 mb-1">Active Plan</p>
            <p className="text-2xl font-semibold text-white capitalize">{currentPlan}</p>
          </div>
          <div className="flex-1">
            <p className="text-sm text-zinc-400 mb-1">Credits Remaining</p>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              <p className="text-2xl font-semibold text-white">{creditsRemaining}</p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-medium text-white">Upgrade Plan</h2>
          <div className="flex items-center bg-zinc-900 border border-white/10 rounded-full p-1">
            <button
              onClick={() => setCurrency("USD")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors",
                currency === "USD" ? "bg-white text-black" : "text-zinc-400 hover:text-white"
              )}
            >
              <DollarSign className="w-4 h-4" />
              USD
            </button>
            <button
              onClick={() => setCurrency("INR")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors",
                currency === "INR" ? "bg-white text-black" : "text-zinc-400 hover:text-white"
              )}
            >
              <IndianRupee className="w-4 h-4" />
              INR
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((p) => {
            const isCurrent = currentPlan === p.id
            const isLoading = loadingPlan === p.id
            const price = currency === "USD" ? p.priceUsd : p.priceInr
            const symbol = currency === "USD" ? "$" : "₹"

            return (
              <div
                key={p.id}
                className={cn(
                  "relative flex flex-col p-6 bg-zinc-900/50 rounded-2xl border transition-all duration-300",
                  ("popular" in p && p.popular)
                    ? "border-indigo-500/50 bg-indigo-500/5 shadow-[0_0_30px_rgba(99,102,241,0.1)] hover:border-indigo-500/80 hover:shadow-[0_0_40px_rgba(99,102,241,0.2)]"
                    : "border-white/10 hover:border-white/20"
                )}
              >
                {("popular" in p && p.popular) && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-indigo-500 text-white text-xs font-medium rounded-full">
                    Most Popular
                  </div>
                )}
                
                <div className="mb-6">
                  <h3 className="text-lg font-medium text-white capitalize mb-2">{p.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-white">{symbol}{price}</span>
                    <span className="text-sm text-zinc-400">/mo</span>
                  </div>
                </div>

                <ul className="space-y-4 mb-8 flex-1">
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-indigo-400 shrink-0" />
                    <span className="text-sm text-zinc-300">{p.credits.toLocaleString()} enrichment credits</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-indigo-400 shrink-0" />
                    <span className="text-sm text-zinc-300">Unlimited searches</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-indigo-400 shrink-0" />
                    <span className="text-sm text-zinc-300">Export to CSV/Sheets</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-indigo-400 shrink-0" />
                    <span className="text-sm text-zinc-300">Automated email campaigns</span>
                  </li>
                </ul>

                <Button
                  onClick={() => handleCheckout(p.id as PlanType)}
                  disabled={isCurrent || isLoading}
                  className={cn(
                    "w-full h-11",
                    ("popular" in p && p.popular)
                      ? "bg-indigo-500 hover:bg-indigo-600 text-white"
                      : "bg-white/10 hover:bg-white/20 text-white"
                  )}
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isCurrent ? (
                    "Current Plan"
                  ) : (
                    "Upgrade"
                  )}
                </Button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
