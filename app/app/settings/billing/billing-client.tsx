"use client"

import { useState } from "react"
import { PLANS, PlanType, ENTERPRISE_PLAN } from "@/lib/billing-shared"
import { CREDIT_PACKS, CreditPackId } from "@/lib/credit-costs"
import {
  createStripeCheckoutSession,
  createRazorpayOrder,
  createRazorpaySubscriptionAction,
  purchaseCreditPackAction,
} from "@/app/app/settings/billing/actions"
import Script from "next/script"
import { useRouter } from "next/navigation"
import { Button, buttonVariants } from "@/components/ui/button"
import { Check, Sparkles, Loader2, IndianRupee, DollarSign, Zap, Building2, Mail } from "lucide-react"
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
  const router = useRouter()
  const [loadingPlan, setLoadingPlan] = useState<PlanType | null>(null)
  const [loadingPack, setLoadingPack] = useState<CreditPackId | null>(null)
  const [currency, setCurrency] = useState<"INR" | "USD">("USD")
  const [recurring, setRecurring] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleCheckout = async (plan: PlanType) => {
    setErrorMessage(null)
    setLoadingPlan(plan)
    try {
      if (currency === "USD") {
        await createStripeCheckoutSession(plan)
      } else if (recurring) {
        const sub = await createRazorpaySubscriptionAction(plan)
        if (sub.error) {
          setErrorMessage(sub.error)
          return
        }
        if (sub.mock) {
          router.push("/app/settings/billing?success=true")
          return
        }
        const options = {
          key: sub.keyId,
          subscription_id: sub.subscriptionId,
          name: "SalesEngAI",
          description: `${PLANS[plan].name} — monthly (UPI AutoPay)`,
          handler: () => router.push("/app/settings/billing?success=true"),
          prefill: {
            email: sub.userEmail,
          },
          theme: {
            color: "#6366f1",
          },
        }
        const rzp = new window.Razorpay(options)
        rzp.open()
      } else {
        const order = await createRazorpayOrder(plan)
        const options = {
          key: order.keyId,
          amount: order.amount,
          currency: order.currency,
          name: "SalesEngAI",
          description: `Upgrade to ${PLANS[plan].name}`,
          order_id: order.orderId,
          notes: {
            plan: order.plan,
            userId: order.userId,
          },
          handler: () => router.push("/app/settings/billing?success=true"),
          prefill: {
            email: order.userEmail,
          },
          theme: {
            color: "#6366f1",
          },
        }
        
        const rzp = new window.Razorpay(options)
        rzp.open()
      }
    } catch {
      setErrorMessage("Checkout failed. Please try again.")
    } finally {
      if (currency === "INR") {
        setLoadingPlan(null)
      }
    }
  }

  const handleBuyPack = async (packId: CreditPackId) => {
    setErrorMessage(null)
    setLoadingPack(packId)
    try {
      if (currency === "USD") {
        await purchaseCreditPackAction(packId, "USD")
      } else {
        const order = await purchaseCreditPackAction(packId, "INR")
        if (!order || !order.orderId) {
          throw new Error("Order creation failed")
        }
        const pack = CREDIT_PACKS.find((p) => p.id === packId)
        const options = {
          key: order.keyId,
          amount: order.amount,
          currency: order.currency,
          name: "SalesEngAI",
          description: `${pack?.label ?? "Credit Pack"} (${order.creditsToAdd.toLocaleString()} credits)`,
          order_id: order.orderId,
          notes: {
            type: "credit_pack",
            packId,
            userId: order.userId,
          },
          handler: () => router.push("/app/settings/billing?pack_success=true"),
          prefill: {
            email: order.userEmail,
          },
          theme: {
            color: "#6366f1",
          },
        }
        const rzp = new window.Razorpay(options)
        rzp.open()
      }
    } catch {
      setErrorMessage("Credit purchase failed. Please try again.")
    } finally {
      if (currency === "INR") {
        setLoadingPack(null)
      }
    }
  }

  const plans = [
    { id: "starter" as const, ...PLANS.starter },
    { id: "pro" as const, ...PLANS.pro },
    { id: "agency" as const, ...PLANS.agency },
  ]

  return (
    <div className="space-y-10">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" />

      {errorMessage && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm">
          {errorMessage}
        </div>
      )}
      
      {/* Current Balance */}
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6">
        <h2 className="text-xl font-medium text-white mb-4">Account Usage & Credits</h2>
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex-1">
            <p className="text-sm text-zinc-400 mb-1">Active Plan</p>
            <p className="text-2xl font-semibold text-white capitalize">{currentPlan}</p>
          </div>
          <div className="flex-1">
            <p className="text-sm text-zinc-400 mb-1">Credits Remaining</p>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              <p className="text-2xl font-semibold text-white">{creditsRemaining.toLocaleString()}</p>
            </div>
            <p className="text-xs text-zinc-400 mt-1">1 credit ≈ ₹1.00 of AI compute value</p>
          </div>
          <div className="flex items-center">
            {/* Currency selector */}
            <div className="flex items-center bg-zinc-800 border border-white/10 rounded-full p-1">
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
        </div>
      </div>

      {/* ── Section 1: One-Time Credit Packs ──────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-5 h-5 text-amber-400" />
          <h2 className="text-2xl font-medium text-white">One-Time Credit Packs</h2>
        </div>
        <p className="text-sm text-zinc-400 mb-6">
          Buy credits on-demand without a recurring subscription. Credits never expire and work with all configured models.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {CREDIT_PACKS.map((pack) => {
            const isLoading = loadingPack === pack.id
            const price = currency === "USD" ? pack.priceUsd : pack.priceInr
            const symbol = currency === "USD" ? "$" : "₹"

            return (
              <div
                key={pack.id}
                className={cn(
                  "relative flex flex-col p-5 bg-zinc-900/60 rounded-xl border transition-all",
                  pack.popular
                    ? "border-amber-500/50 bg-amber-500/5 shadow-[0_0_20px_rgba(245,158,11,0.1)] hover:border-amber-500/80"
                    : "border-white/10 hover:border-white/20"
                )}
              >
                {pack.popular && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 bg-amber-500 text-black text-[11px] font-semibold rounded-full">
                    Best Value
                  </div>
                )}
                
                <div className="mb-3">
                  <h3 className="text-sm font-medium text-zinc-300">{pack.label}</h3>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-2xl font-bold text-white">{symbol}{price}</span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {currency === "INR" ? `₹${pack.perCreditInr}/cr` : `$${(pack.priceUsd / pack.credits).toFixed(3)}/cr`}
                  </p>
                </div>

                <div className="flex-1 mb-4">
                  <div className="text-base font-semibold text-indigo-400">
                    +{pack.credits.toLocaleString()} credits
                  </div>
                  <p className="text-[12px] text-zinc-400 mt-1">
                    ~{Math.round(pack.credits / 8)} standard lead enrichments
                  </p>
                </div>

                <Button
                  size="sm"
                  onClick={() => handleBuyPack(pack.id)}
                  disabled={isLoading}
                  className={cn(
                    "w-full text-xs font-medium",
                    pack.popular
                      ? "bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                      : "bg-white/10 hover:bg-white/20 text-white"
                  )}
                >
                  {isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    `Buy ${symbol}${price}`
                  )}
                </Button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Section 2: Monthly Subscriptions ─────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-2xl font-medium text-white">Monthly Subscription Plans</h2>
          {currency === "INR" && (
            <label className="flex items-center gap-2 text-sm text-zinc-300 select-none">
              <input
                type="checkbox"
                checked={recurring}
                onChange={(e) => setRecurring(e.target.checked)}
                className="size-4 accent-indigo-500 rounded"
              />
              Auto-pay via UPI (AutoPay)
            </label>
          )}
        </div>
        <p className="text-sm text-zinc-400 mb-6">
          Predictable monthly allocations with credit rollover and model tier unlocks.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((p) => {
            const isCurrent = currentPlan === p.id
            const isLoading = loadingPlan === p.id
            const isPopular = p.id === "pro"
            const price = currency === "USD" ? p.priceUsd : p.priceInr
            const symbol = currency === "USD" ? "$" : "₹"

            return (
              <div
                key={p.id}
                className={cn(
                  "relative flex flex-col p-6 bg-zinc-900/50 rounded-2xl border transition-all duration-300",
                  isPopular
                    ? "border-indigo-500/50 bg-indigo-500/5 shadow-[0_0_30px_rgba(99,102,241,0.1)] hover:border-indigo-500/80"
                    : "border-white/10 hover:border-white/20"
                )}
              >
                {isPopular && (
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

                <ul className="space-y-3 mb-8 flex-1">
                  {p.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                      <span className="text-sm text-zinc-300">{feature}</span>
                    </li>
                  ))}
                  <li className="flex items-start gap-3">
                    <Check className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <span className="text-sm text-zinc-300">Unlimited searches & CSV export</span>
                  </li>
                </ul>

                <Button
                  onClick={() => handleCheckout(p.id as PlanType)}
                  disabled={isCurrent || isLoading}
                  className={cn(
                    "w-full h-11",
                    isPopular
                      ? "bg-indigo-500 hover:bg-indigo-600 text-white"
                      : "bg-white/10 hover:bg-white/20 text-white"
                  )}
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isCurrent ? (
                    "Current Plan"
                  ) : currency === "INR" && recurring ? (
                    "Subscribe"
                  ) : (
                    "Upgrade"
                  )}
                </Button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Section 3: Enterprise Plan ───────────────────────────────── */}
      <div className="bg-gradient-to-r from-zinc-900 to-indigo-950/40 border border-indigo-500/30 rounded-2xl p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-400" />
              <h3 className="text-xl font-semibold text-white">{ENTERPRISE_PLAN.name} Plan</h3>
              <span className="px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 text-xs rounded-full">
                B2B Custom
              </span>
            </div>
            <p className="text-sm text-zinc-300">
              For high-volume sales teams and enterprise pilots. Custom monthly commitments starting from ₹50,000 / $600 with dedicated support.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
              {ENTERPRISE_PLAN.features.map((feature, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs text-zinc-300">
                  <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-start md:items-end gap-2">
            <div className="text-xs text-zinc-400">Starting from</div>
            <div className="text-2xl font-bold text-white">₹50,000<span className="text-sm font-normal text-zinc-400">/mo</span></div>
            <a
              href={`mailto:${ENTERPRISE_PLAN.contactEmail}?subject=SalesEngAI%20Enterprise%20Plan%20Inquiry`}
              className={cn(buttonVariants({ variant: "default" }), "bg-indigo-600 hover:bg-indigo-700 text-white mt-2")}
            >
              <Mail className="w-4 h-4 mr-2" />
              Contact Enterprise Sales
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
