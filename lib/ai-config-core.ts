/**
 * AI model catalog — pure data and logic, ZERO server-only imports, ZERO external dependencies.
 * Safe to use in both server components and client components.
 */

export type ModelTier = "economy" | "standard" | "standard_plus" | "premium";
export type AiPurpose = "research" | "writing" | "chat";
export type AiProvider = "openai" | "anthropic";

export interface ModelCreditCost {
  research: number;
  writing: number;
  chat: number;
}

export interface AiModelEntry {
  id: string;
  label: string;
  provider: AiProvider;
  tier: ModelTier;
  recommended_for: string;
  why: string;
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

/** All 9 supported models, ordered economy → premium. */
export const AI_MODELS: AiModelEntry[] = [
  // ── Economy ──────────────────────────────────────────────────────────────
  {
    id: "gpt-4o-mini",
    label: "GPT-4o Mini",
    provider: "openai",
    tier: "economy",
    recommended_for: "Research & Classification",
    why: "Fastest, cheapest OpenAI model. Ideal for reply classification, bulk research, and any repetitive task where throughput matters more than prose quality.",
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    tier: "economy",
    recommended_for: "Research & Classification",
    why: "Anthropic's fastest model. Excellent at structured data extraction and concise summaries — great default for research and classify operations.",
  },
  // ── Standard ─────────────────────────────────────────────────────────────
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    tier: "standard",
    recommended_for: "Email Writing & Chat",
    why: "Best all-rounder for B2B sales outreach. Strong instruction following and natural tone for personalized, on-brand email copy.",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    tier: "standard",
    recommended_for: "Email Writing & Chat",
    why: "Best balance of quality and cost for sales copy. Produces natural, human-sounding B2B outreach. Recommended default for most teams.",
  },
  // ── Standard+ ────────────────────────────────────────────────────────────
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    provider: "openai",
    tier: "standard_plus",
    recommended_for: "Complex Research & Long Context",
    why: "1M-token context window and stronger reasoning than GPT-4o. Best for long prospect research threads or account plans that require deep context retention.",
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    provider: "anthropic",
    tier: "standard_plus",
    recommended_for: "Premium Email Writing",
    why: "Latest Sonnet model — best-in-class for nuanced B2B outreach. Understands industry context and produces polished, boardroom-ready sales writing.",
  },
  // ── Reasoning / Premium ──────────────────────────────────────────────────
  {
    id: "o4-mini",
    label: "o4-mini (Reasoning)",
    provider: "openai",
    tier: "premium",
    recommended_for: "Strategic Analysis & ICP Planning",
    why: "Thinking model that reasons step-by-step. Overkill for email drafts — use for complex multi-step qualification logic or ICP strategy definition.",
  },
  {
    id: "o3-mini",
    label: "o3-mini (Reasoning)",
    provider: "openai",
    tier: "premium",
    recommended_for: "Strategic Analysis",
    why: "Same reasoning tier as o4-mini with a different strength profile. Best for structured reasoning over long account histories or competitive analysis.",
  },
  {
    id: "claude-opus-5",
    label: "Claude Opus 5",
    provider: "anthropic",
    tier: "premium",
    recommended_for: "Enterprise-Grade Content",
    why: "Highest quality Anthropic model. Reserved for flagship enterprise accounts or high-stakes strategic content where quality is the only constraint.",
  },
];

export const DEFAULT_AI_MODELS: Record<AiProvider, Record<AiPurpose, string>> = {
  openai: {
    chat: "gpt-4o",
    research: "gpt-4o-mini",
    writing: "gpt-4o",
  },
  anthropic: {
    chat: "claude-sonnet-4-6",
    research: "claude-haiku-4-5-20251001",
    writing: "claude-sonnet-4-6",
  },
};

const ALL_MODEL_IDS = new Set(AI_MODELS.map((m) => m.id));

/** Returns true if the given model id is allowed for the given provider. */
export function allowedAiModel(provider: AiProvider, model: string): boolean {
  const entry = AI_MODELS.find((m) => m.id === model);
  return entry !== undefined && entry.provider === provider;
}

/** Returns the default model id for a provider + purpose. */
export function defaultAiModel(provider: AiProvider, purpose: AiPurpose): string {
  return DEFAULT_AI_MODELS[provider][purpose];
}

/** Returns true if the model id exists in the catalog (any provider). */
export function isKnownModel(modelId: string): boolean {
  return ALL_MODEL_IDS.has(modelId);
}

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

/** Returns credit cost metadata for a model. */
export function modelCreditInfo(modelId: string) {
  return MODEL_CREDIT_COSTS[modelId] ?? { research: 1, writing: 1, chat: 1 };
}

/** Translates safeAiError codes for display. */
export function safeAiError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/401|unauthorized|api.?key|authentication/i.test(text)) return "authentication_failed";
  if (/429|rate.?limit|quota|billing/i.test(text)) return "quota_or_rate_limit";
  if (/model/i.test(text)) return "model_unavailable";
  if (/timeout|timed out/i.test(text)) return "provider_timeout";
  return "provider_error";
}
