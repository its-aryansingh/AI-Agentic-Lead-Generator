/**
 * Credit Cost Engine — single source of truth for credit calculations,
 * enrichment bundles, and one-time credit packs.
 * Zero relative imports for universal loader compatibility.
 */

export type ModelTier = "economy" | "standard" | "standard_plus" | "premium";
export type AiPurpose = "research" | "writing" | "chat";

export interface ModelCreditCost {
  research: number;
  writing: number;
  chat: number;
}

/** Credit costs per model per purpose (3× platform markup). */
export const MODEL_CREDIT_COSTS: Record<string, ModelCreditCost> = {
  // ── Economy tier ─────────────────────────────────────────────────────────
  "gpt-4o-mini":               { research: 1, writing: 1,  chat: 1  },
  "claude-haiku-4-5-20251001": { research: 1, writing: 2,  chat: 2  },
  // ── Standard tier ────────────────────────────────────────────────────────
  "gpt-4o":                    { research: 1, writing: 4,  chat: 5  },
  "claude-sonnet-4-6":         { research: 1, writing: 5,  chat: 6  },
  // ── Standard+ tier ───────────────────────────────────────────────────────
  "gpt-4.1":                   { research: 1, writing: 3,  chat: 4  },
  "claude-sonnet-5":           { research: 1, writing: 4,  chat: 5  },
  // ── Reasoning / Premium tier ─────────────────────────────────────────────
  "o4-mini":                   { research: 1, writing: 2,  chat: 3  },
  "o3-mini":                   { research: 1, writing: 2,  chat: 3  },
  "claude-opus-5":             { research: 2, writing: 10, chat: 14 },
};

/** Returns the model tier for a given model ID. */
export function modelTier(modelId: string): ModelTier {
  if (
    modelId === "gpt-4o-mini" ||
    modelId === "claude-haiku-4-5-20251001"
  ) return "economy";
  if (modelId === "gpt-4.1" || modelId === "claude-sonnet-5") {
    return "standard_plus";
  }
  if (
    modelId === "claude-opus-5" ||
    modelId === "o4-mini" ||
    modelId === "o3-mini"
  ) return "premium";
  return "standard";
}

/**
 * Lead enrichment bundles: covers research + email draft in one deduction.
 * Tier is resolved from the active writing model via modelTier().
 */
export const ENRICHMENT_BUNDLE_CREDITS: Record<ModelTier, number> = {
  economy:       3,
  standard:      8,
  standard_plus: 6,
  premium:       20,
};

/** Plans that can access each model tier. */
export const PLAN_MODEL_TIER_ACCESS: Record<string, ModelTier[]> = {
  free:         ["economy"],
  starter:      ["economy", "standard"],
  pro:          ["economy", "standard"],
  agency:       ["economy", "standard"],
  professional: ["economy", "standard", "standard_plus", "premium"],
  team:         ["economy", "standard", "standard_plus", "premium"],
  enterprise:   ["economy", "standard", "standard_plus", "premium"],
};

/**
 * Returns the credit cost for a given model and purpose.
 * Falls back to 1 credit if the model is unknown (safe default).
 */
export function creditsForOperation(modelId: string, purpose: AiPurpose): number {
  return MODEL_CREDIT_COSTS[modelId]?.[purpose] ?? 1;
}

/** Returns the enrichment bundle credit cost for a given writing model. */
export function enrichmentBundleCredits(writingModelId: string): number {
  return ENRICHMENT_BUNDLE_CREDITS[modelTier(writingModelId)];
}

/** Returns true if the given plan can use the given model. */
export function planCanUseModel(plan: string, modelId: string): boolean {
  const allowedTiers = PLAN_MODEL_TIER_ACCESS[plan] ?? ["economy"];
  return allowedTiers.includes(modelTier(modelId));
}

// ─────────────────────────────────────────────────────────────────────────────
// One-time credit pack definitions
// ─────────────────────────────────────────────────────────────────────────────

export const CREDIT_PACKS = [
  {
    id: "pack_200",
    credits: 200,
    priceInr: 249,
    priceUsd: 3,
    label: "Starter Pack",
    perCreditInr: 1.25,
    popular: false,
  },
  {
    id: "pack_600",
    credits: 600,
    priceInr: 649,
    priceUsd: 8,
    label: "Growth Pack",
    perCreditInr: 1.08,
    popular: false,
  },
  {
    id: "pack_2000",
    credits: 2000,
    priceInr: 1899,
    priceUsd: 23,
    label: "Business Pack",
    perCreditInr: 0.95,
    popular: false,
  },
  {
    id: "pack_6000",
    credits: 6000,
    priceInr: 4999,
    priceUsd: 60,
    label: "Scale Pack",
    perCreditInr: 0.83,
    popular: true,
  },
  {
    id: "pack_15000",
    credits: 15000,
    priceInr: 10999,
    priceUsd: 132,
    label: "Power Pack",
    perCreditInr: 0.73,
    popular: false,
  },
] as const;

export type CreditPackId = typeof CREDIT_PACKS[number]["id"];
