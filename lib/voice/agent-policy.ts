import { normalizeE164 } from "@/lib/voice-compliance";
import {
  greetingHasMandatoryDisclosure,
  isVoiceTelephonyProvider,
  resolveVoiceLlm,
  VOICE_TELEPHONY_PROVIDERS,
} from "@/lib/voice/agent-policy-core";
import {
  TRANSFER_FALLBACKS,
  type TransferFallback,
} from "@/lib/voice/transfer-policy";

export { greetingHasMandatoryDisclosure } from "@/lib/voice/agent-policy-core";

export type VoicePolicy = {
  timezone: string;
  startHour: number;
  endHour: number;
  language: "en" | "hi" | "hinglish";
  maxCallSeconds: number;
  maxTurns: number;
  maxObjectionAttempts: number;
  humanTransferPhone: string | null;
  transferEnabled: boolean;
  transferStartHour: number;
  transferEndHour: number;
  transferTimezone: string;
  transferWeekdays: number[];
  transferFallback: TransferFallback;
  bookingLinkUrl: string | null;
  agentOptions: {
    agentWelcomeMessage?: string;
    voiceName: string;
    voiceId: string;
    synthesizerProvider: string;
    synthesizerModel: string;
    llmProvider: string;
    llmModel: string;
    temperature: number;
    ambientNoise: boolean;
    ambientNoiseTrack: "office" | "coffee-shop" | "call-center";
    interruptionWords: number;
    silenceHangupSeconds: number;
    telephonyProvider: (typeof VOICE_TELEPHONY_PROVIDERS)[number];
  };
};

function integer(formData: FormData, name: string) {
  const raw = String(formData.get(name) ?? "").trim();
  const value = Number(raw);
  if (!raw || !Number.isInteger(value)) {
    throw new Error(`${name.replaceAll("_", " ")} must be a whole number.`);
  }
  return value;
}

export function parseVoicePolicy(formData: FormData): VoicePolicy {
  const startHour = integer(formData, "start_hour");
  const endHour = integer(formData, "end_hour");
  if (
    startHour < 0 ||
    startHour > 23 ||
    endHour < 1 ||
    endHour > 24 ||
    endHour <= startHour
  ) {
    throw new Error(
      "Calling hours must be whole hours with the end later than the start.",
    );
  }

  const timezone = String(formData.get("timezone") ?? "").trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error("Enter a valid IANA timezone, such as Asia/Kolkata.");
  }

  const language = String(formData.get("language") ?? "en");
  if (!(["en", "hi", "hinglish"] as const).includes(language as never)) {
    throw new Error("Choose a supported call language.");
  }

  const maxCallSeconds = integer(formData, "max_call_seconds");
  const maxTurns = integer(formData, "max_turns");
  const maxObjectionAttempts = integer(formData, "max_objection_attempts");
  if (maxCallSeconds < 30 || maxCallSeconds > 300) {
    throw new Error("Call duration must be between 30 and 300 seconds.");
  }
  if (maxTurns < 2 || maxTurns > 30) {
    throw new Error("Maximum turns must be between 2 and 30.");
  }
  if (maxObjectionAttempts < 0 || maxObjectionAttempts > 2) {
    throw new Error("Objection attempts must be between 0 and 2.");
  }

  const transfer = String(formData.get("human_transfer_phone") ?? "").trim();
  const humanTransferPhone = transfer ? normalizeE164(transfer) : null;
  if (transfer && !humanTransferPhone) {
    throw new Error(
      "Human transfer number must use E.164 format, such as +919876543210.",
    );
  }
  const transferEnabled = formData.get("transfer_enabled") === "on";
  if (transferEnabled && !humanTransferPhone) {
    throw new Error("Enable live transfer only after entering a transfer phone number.");
  }
  const transferStartHour = integer(formData, "transfer_start_hour");
  const transferEndHour = integer(formData, "transfer_end_hour");
  if (
    transferStartHour < 0 ||
    transferStartHour > 23 ||
    transferEndHour < 1 ||
    transferEndHour > 24 ||
    transferEndHour <= transferStartHour
  ) {
    throw new Error(
      "Transfer hours must be whole hours with the end later than the start.",
    );
  }
  const transferTimezone = String(
    formData.get("transfer_timezone") ?? timezone,
  ).trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: transferTimezone }).format(
      new Date(),
    );
  } catch {
    throw new Error("Enter a valid transfer-team IANA timezone.");
  }
  const transferWeekdays = formData
    .getAll("transfer_weekdays")
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
  if (transferWeekdays.length === 0) {
    throw new Error("Select at least one day when the transfer team is available.");
  }
  const transferFallback = String(
    formData.get("transfer_fallback") ?? "schedule_callback",
  );
  if (!TRANSFER_FALLBACKS.includes(transferFallback as TransferFallback)) {
    throw new Error("Choose a supported unavailable-team fallback.");
  }
  const bookingLink = String(formData.get("booking_link_url") ?? "").trim();
  let bookingLinkUrl: string | null = null;
  if (bookingLink) {
    try {
      const parsed = new URL(bookingLink);
      if (parsed.protocol !== "https:") throw new Error();
      bookingLinkUrl = parsed.toString();
    } catch {
      throw new Error("Booking link must be a valid HTTPS URL.");
    }
  }

  const agentWelcomeMessage = String(
    formData.get("agent_welcome_message") ?? "",
  ).trim();
  if (agentWelcomeMessage.length > 300) {
    throw new Error("Custom greeting must be 300 characters or fewer.");
  }
  if (
    agentWelcomeMessage &&
    !greetingHasMandatoryDisclosure(agentWelcomeMessage)
  ) {
    throw new Error(
      "Custom greeting must identify the caller as AI and include {{seller_company}}.",
    );
  }

  const voiceName = String(formData.get("custom_voice_name") ?? "Nila").trim();
  const voiceId = String(
    formData.get("custom_voice_id") ?? "V9LCAAi4tTlqe9JadbCo",
  ).trim();
  const synthesizerProvider = String(
    formData.get("synthesizer_provider") ?? "elevenlabs",
  ).trim();
  const synthesizerModel = String(
    formData.get("synthesizer_model") ?? "eleven_turbo_v2_5",
  ).trim();
  if (!voiceName || !voiceId || !synthesizerProvider || !synthesizerModel) {
    throw new Error("Choose a complete voice provider, model, and voice.");
  }

  const llmModel = String(
    formData.get("llm_model") ?? "gpt-5.4-mini",
  ).trim();
  const parsedTemperature = Number(
    String(formData.get("temperature") ?? "1").trim(),
  );
  const llm = resolveVoiceLlm(llmModel, parsedTemperature);

  const rawAmbientTrack = String(
    formData.get("ambient_noise_track") ?? "office",
  );
  const ambientNoiseTrack = (
    ["office", "coffee-shop", "call-center"].includes(rawAmbientTrack)
      ? rawAmbientTrack
      : "office"
  ) as VoicePolicy["agentOptions"]["ambientNoiseTrack"];
  const interruptionWords = integer(formData, "interruption_words");
  const silenceHangupSeconds = integer(formData, "silence_hangup_seconds");
  if (interruptionWords < 1 || interruptionWords > 5) {
    throw new Error("Interruption threshold must be between 1 and 5 words.");
  }
  if (silenceHangupSeconds < 5 || silenceHangupSeconds > 30) {
    throw new Error("Silence timeout must be between 5 and 30 seconds.");
  }

  const telephonyProvider = String(
    formData.get("telephony_provider") ?? "plivo",
  );
  if (!isVoiceTelephonyProvider(telephonyProvider)) {
    throw new Error("Choose a supported telephony route.");
  }

  return {
    timezone,
    startHour,
    endHour,
    language: language as VoicePolicy["language"],
    maxCallSeconds,
    maxTurns,
    maxObjectionAttempts,
    humanTransferPhone,
    transferEnabled,
    transferStartHour,
    transferEndHour,
    transferTimezone,
    transferWeekdays: [...new Set(transferWeekdays)].sort((a, b) => a - b),
    transferFallback: transferFallback as TransferFallback,
    bookingLinkUrl,
    agentOptions: {
      agentWelcomeMessage: agentWelcomeMessage || undefined,
      voiceName,
      voiceId,
      synthesizerProvider,
      synthesizerModel,
      llmProvider: llm.provider,
      llmModel: llm.model,
      temperature: llm.temperature,
      ambientNoise: formData.get("ambient_noise") === "on",
      ambientNoiseTrack,
      interruptionWords,
      silenceHangupSeconds,
      telephonyProvider,
    },
  };
}
