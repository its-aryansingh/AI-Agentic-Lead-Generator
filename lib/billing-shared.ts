export const PLANS = {
  free: {
    name: "Free",
    credits: 25,
    priceInr: 0,
    priceUsd: 0,
    rolloverPercent: 0,
    features: [
      "25 credits/month",
      "Economy models only",
      "1 mailbox",
      "Community support",
    ],
  },
  starter: {
    name: "Starter",
    credits: 500,
    priceInr: 799,
    priceUsd: 10,
    rolloverPercent: 0,
    features: [
      "500 credits/month",
      "Standard + Economy models",
      "1 mailbox",
      "Email support",
    ],
  },
  pro: {
    name: "Pro",
    credits: 2000,
    priceInr: 2499,
    priceUsd: 29,
    rolloverPercent: 20,
    features: [
      "2,000 credits/month + 20% rollover",
      "All models including Standard+",
      "CRM push",
      "Priority support",
    ],
  },
  agency: {
    name: "Agency",
    credits: 6000,
    priceInr: 5999,
    priceUsd: 72,
    rolloverPercent: 30,
    features: [
      "6,000 credits/month + 30% rollover",
      "All models + Premium (Opus)",
      "Unlimited mailboxes",
      "Dedicated support",
    ],
  },
} as const

export type PlanType = keyof typeof PLANS

/** Subscription plan IDs for use in checkout / webhooks. */
export const SUBSCRIPTION_PLANS = ["starter", "pro", "agency"] as const satisfies readonly PlanType[]

/** Enterprise tier — not in DB as a named plan; handled via custom contract. */
export const ENTERPRISE_PLAN = {
  name: "Enterprise",
  creditsIncluded: 60_000,
  priceInrFrom: 50_000,
  contactEmail: "enterprise@aravya.ai",
  features: [
    "60,000+ credits included",
    "All models + Premium (Opus / o4-mini)",
    "Dedicated account manager",
    "SSO + SLA guarantee",
    "Custom contract & invoicing",
  ],
} as const
