import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { BillingClient } from "./billing-client"
import { PlanType } from "@/lib/billing-shared"

export const metadata = {
  title: "Billing | LeadGenAI",
}

export default async function BillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: userData } = await supabase
    .from("users")
    .select("plan, credits_remaining")
    .eq("id", user.id)
    .single()

  const currentPlan = (userData?.plan || "free") as PlanType
  const creditsRemaining = userData?.credits_remaining || 0

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-medium text-white mb-2">Billing & Plans</h1>
          <p className="text-zinc-400">
            Manage your subscription and credit usage.
          </p>
        </div>

        <BillingClient 
          currentPlan={currentPlan} 
          creditsRemaining={creditsRemaining} 
        />
      </div>
    </main>
  )
}
