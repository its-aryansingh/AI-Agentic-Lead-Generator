export const PLANS = {
  free: {
    name: "Free",
    credits: 25,
    priceInr: 0,
    priceUsd: 0,
  },
  starter: {
    name: "Starter",
    credits: 1000,
    priceInr: 2499,
    priceUsd: 29,
  },
  pro: {
    name: "Pro",
    credits: 5000,
    priceInr: 6999,
    priceUsd: 79,
  },
  agency: {
    name: "Agency",
    credits: 20000,
    priceInr: 14999,
    priceUsd: 149,
  },
} as const

export type PlanType = keyof typeof PLANS
