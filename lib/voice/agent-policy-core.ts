export const VOICE_LLM_MODELS = [
  {
    id: "gpt-5.4-mini",
    provider: "openai",
    label: "OpenAI GPT-5.4 Mini (fast, recommended)",
    temperatureLocked: true,
  },
  {
    id: "gpt-4o",
    provider: "openai",
    label: "OpenAI GPT-4o",
    temperatureLocked: false,
  },
  {
    id: "claude-3-5-sonnet",
    provider: "anthropic",
    label: "Anthropic Claude 3.5 Sonnet",
    temperatureLocked: false,
  },
  {
    id: "llama-3.1-70b",
    provider: "groq",
    label: "Meta Llama 3.1 70B via Groq",
    temperatureLocked: false,
  },
] as const;

export const VOICE_TELEPHONY_PROVIDERS = [
  "plivo",
  "exotel",
  "twilio",
  "sip-trunk",
] as const;

export function greetingHasMandatoryDisclosure(greeting: string) {
  return (
    /\b(?:AI|artificial intelligence)\b/i.test(greeting) &&
    greeting.includes("{{seller_company}}")
  );
}

export function resolveVoiceLlm(modelId: string, temperature: number) {
  const choice = VOICE_LLM_MODELS.find((model) => model.id === modelId);
  if (!choice) throw new Error("Choose a supported voice LLM model.");
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
    throw new Error("LLM temperature must be between 0 and 1.");
  }
  return {
    model: choice.id,
    provider: choice.provider,
    temperature: choice.temperatureLocked ? 1 : temperature,
  };
}

export function isVoiceTelephonyProvider(
  value: string,
): value is (typeof VOICE_TELEPHONY_PROVIDERS)[number] {
  return VOICE_TELEPHONY_PROVIDERS.some((provider) => provider === value);
}
