import { z } from "zod";

import type { VoiceProvider, PlaceCallRequest } from "@/lib/voice/provider";
import type { NormalizedCallEvent, TranscriptSegment } from "@/lib/voice/types";

const BASE_URL = "https://api.bolna.ai";

const bolnaAgentSummarySchema = z
  .object({
    id: z.string().uuid(),
    agent_name: z.string(),
    agent_status: z.enum(["seeding", "processed"]),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

const bolnaPhoneNumberSchema = z
  .object({
    phone_number: z.string(),
    telephony_provider: z.string(),
    rented: z.boolean().optional(),
  })
  .passthrough();

const bolnaAccountVoiceSchema = z
  .object({
    voice_id: z.string(),
    provider: z.string(),
    name: z.string(),
    model: z.string(),
    accent: z.string().nullish(),
  })
  .passthrough();

const bolnaTtsCatalogSchema = z
  .object({
    providers: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          is_supported: z.boolean(),
          models: z.array(
            z
              .object({
                id: z.string(),
                model_id: z.string(),
                display_name: z.string(),
                is_supported: z.boolean(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const bolnaPagedVoicesSchema = z
  .object({
    items: z.array(
      z
        .object({
          voice_id: z.string(),
          name: z.string(),
          accent: z.string().nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const bolnaCredentialProviderSchema = z
  .object({
    provider_name: z.string(),
  })
  .passthrough();

const bolnaSipTrunkSchema = z
  .object({
    is_active: z.boolean(),
    phone_numbers: z
      .array(
        z
          .object({
            phone_number: z.string(),
            telephony_provider: z.string().default("sip-trunk"),
            deleted: z.boolean().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

const managedAgentConfigSchema = z.object({
  agentName: z.string().trim().min(1).max(80),
  webhookUrl: z.string().url(),
  language: z.enum(["en", "hi", "hinglish"]),
  maxCallSeconds: z.number().int().min(30).max(300),
  maxTurns: z.number().int().min(2).max(30),
  maxObjectionAttempts: z.number().int().min(0).max(2),
  callStartHour: z.number().int().min(0).max(23),
  callEndHour: z.number().int().min(1).max(24),
  // Extended configurable options with backwards-compatible defaults:
  agentWelcomeMessage: z.string().max(300).optional(),
  // User-authored operating instructions are bounded and are appended to the
  // managed safety prompt; they cannot replace the non-bypassable guardrails.
  additionalInstructions: z.string().min(100).max(12000).optional(),
  synthesizerProvider: z.string().default("elevenlabs").optional(),
  voiceId: z.string().default("V9LCAAi4tTlqe9JadbCo").optional(),
  voiceName: z.string().default("Nila").optional(),
  synthesizerModel: z.string().default("eleven_turbo_v2_5").optional(),
  llmProvider: z.string().default("openai").optional(),
  llmModel: z.string().default("gpt-5.4-mini").optional(),
  temperature: z.number().min(0).max(1).default(1).optional(),
  transcriberProvider: z.string().default("deepgram").optional(),
  transcriberModel: z.string().default("nova-3").optional(),
  endpointingMs: z.number().int().min(100).max(1000).default(250).optional(),
  ambientNoise: z.boolean().default(false).optional(),
  ambientNoiseTrack: z
    .enum(["office", "coffee-shop", "call-center"])
    .default("office")
    .optional(),
  interruptionWords: z.number().int().min(1).max(10).default(2).optional(),
  silenceHangupSeconds: z.number().int().min(3).max(60).default(10).optional(),
  telephonyProvider: z.string().default("plivo").optional(),
  actionWebhookUrl: z.string().url().optional(),
  bookingLinkEnabled: z.boolean().default(false).optional(),
  calendarBookingEnabled: z.boolean().default(false).optional(),
  transferEnabled: z.boolean().default(false).optional(),
  transferPhone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  transferTimezone: z.string().max(80).default("Asia/Kolkata").optional(),
  transferStartHour: z.number().int().min(0).max(23).default(9).optional(),
  transferEndHour: z.number().int().min(1).max(24).default(18).optional(),
  transferWeekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .default([1, 2, 3, 4, 5])
    .optional(),
  transferFallback: z
    .enum(["schedule_callback", "human_review", "end_call"])
    .default("schedule_callback")
    .optional(),
});

export type ManagedBolnaAgentConfig = z.infer<typeof managedAgentConfigSchema>;

async function requestBolna(apiKey: string, path: string, init?: RequestInit) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      String(
        (data as { message?: unknown }).message ??
          `BOLNA_HTTP_${response.status}`,
      ),
    );
  }
  return data as Record<string, unknown>;
}

export async function verifyBolnaConnection(apiKey: string, agentId: string) {
  const data = await requestBolna(
    apiKey,
    `/v2/agent/${encodeURIComponent(agentId)}`,
  );
  const id = String(data.agent_id ?? data.id ?? "");
  if (id && id !== agentId) {
    throw new Error("Bolna agent does not belong to this connection.");
  }
  if (
    typeof data.agent_status === "string" &&
    data.agent_status !== "processed"
  ) {
    throw new Error(
      "Bolna is still processing this agent. Try verification again shortly.",
    );
  }
  return data;
}

export async function listBolnaAgents(apiKey: string) {
  const data = await requestBolna(apiKey, "/v2/agent/all");
  return z.array(bolnaAgentSummarySchema).parse(data);
}

export async function verifyBolnaApiKey(apiKey: string) {
  await listBolnaAgents(apiKey);
}

export type BolnaVoiceChoice = {
  voiceId: string;
  name: string;
  provider: string;
  model: string;
  accent: string | null;
};

function providerSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function listBolnaAccountVoices(
  apiKey: string,
): Promise<BolnaVoiceChoice[]> {
  try {
    const legacy = z
      .array(bolnaAccountVoiceSchema)
      .parse(await requestBolna(apiKey, "/me/voices"));
    return legacy.map((voice) => ({
      voiceId: voice.voice_id,
      name: voice.name,
      provider: voice.provider,
      model: voice.model,
      accent: voice.accent ?? null,
    }));
  } catch {
    const catalog = bolnaTtsCatalogSchema.parse(
      await requestBolna(apiKey, "/api/v1/voice-config/tts"),
    );
    const supported = catalog.providers.flatMap((provider) =>
      provider.is_supported
        ? provider.models
            .filter((model) => model.is_supported)
            .map((model) => ({ provider, model }))
        : [],
    );
    const results = await Promise.allSettled(
      supported.map(async ({ provider, model }) => {
        const query = new URLSearchParams({
          provider_id: provider.id,
          model_id: model.id,
          page_size: "100",
        });
        const voices = bolnaPagedVoicesSchema.parse(
          await requestBolna(
            apiKey,
            `/api/v1/voice-config/tts/voices?${query.toString()}`,
          ),
        );
        return voices.items.map((voice) => ({
          voiceId: voice.voice_id,
          name: voice.name,
          provider: providerSlug(provider.name),
          model: model.model_id,
          accent: voice.accent ?? null,
        }));
      }),
    );
    return results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
  }
}

export async function verifyBolnaVoiceChoice(
  apiKey: string,
  expected: Omit<BolnaVoiceChoice, "accent">,
) {
  const voices = await listBolnaAccountVoices(apiKey);
  const match = voices.find(
    (voice) =>
      voice.voiceId === expected.voiceId &&
      providerSlug(voice.provider) === providerSlug(expected.provider) &&
      voice.model === expected.model,
  );
  if (!match) {
    throw new Error(
      "Selected voice is not available in this Bolna account. Refresh settings and choose an available voice.",
    );
  }
  return match;
}

export async function listBolnaCredentialProviders(apiKey: string) {
  const providers = z
    .array(bolnaCredentialProviderSchema)
    .parse(await requestBolna(apiKey, "/providers"));
  return providers.map((provider) => provider.provider_name.toUpperCase());
}

export type BolnaOutboundNumber = {
  phoneNumber: string;
  telephonyProvider: string;
  source: "account" | "sip_trunk";
};

function comparablePhone(value: string) {
  return value.replace(/[^0-9]/g, "");
}

export async function listBolnaOutboundNumbers(
  apiKey: string,
): Promise<BolnaOutboundNumber[]> {
  const [accountResult, trunkResult] = await Promise.allSettled([
    requestBolna(apiKey, "/phone-numbers/all"),
    requestBolna(apiKey, "/sip-trunks/trunks?is_active=true"),
  ]);
  if (accountResult.status === "rejected" && trunkResult.status === "rejected") {
    throw accountResult.reason;
  }

  const accountNumbers =
    accountResult.status === "fulfilled"
      ? z.array(bolnaPhoneNumberSchema).parse(accountResult.value)
      : [];
  const trunks =
    trunkResult.status === "fulfilled"
      ? z.array(bolnaSipTrunkSchema).parse(trunkResult.value)
      : [];
  const numbers: BolnaOutboundNumber[] = [
    ...accountNumbers.map((entry) => ({
      phoneNumber: entry.phone_number,
      telephonyProvider: entry.telephony_provider,
      source: "account" as const,
    })),
    ...trunks.flatMap((trunk) =>
      trunk.is_active
        ? trunk.phone_numbers
            .filter((entry) => entry.deleted !== true)
            .map((entry) => ({
              phoneNumber: entry.phone_number,
              telephonyProvider: entry.telephony_provider,
              source: "sip_trunk" as const,
            }))
        : [],
    ),
  ];

  return numbers.filter(
    (entry, index) =>
      numbers.findIndex(
        (candidate) =>
          comparablePhone(candidate.phoneNumber) ===
          comparablePhone(entry.phoneNumber),
      ) === index,
  );
}

export async function verifyBolnaOutboundNumber(
  apiKey: string,
  phoneNumber: string,
) {
  const numbers = await listBolnaOutboundNumbers(apiKey);
  const match = numbers.find(
    (entry) => comparablePhone(entry.phoneNumber) === comparablePhone(phoneNumber),
  );
  if (!match) {
    throw new Error(
      "Outbound caller ID was not found in this Bolna account. Add or purchase the number in Bolna, or attach it to an active SIP trunk, then verify again.",
    );
  }
  return match;
}

export function buildManagedBolnaAgentPayload(
  rawConfig: ManagedBolnaAgentConfig,
) {
  const config = managedAgentConfigSchema.parse(rawConfig);
  if (config.callEndHour <= config.callStartHour) {
    throw new Error("Call end hour must be later than call start hour.");
  }
  if (config.transferEnabled && !config.transferPhone) {
    throw new Error("Live transfer requires a fixed E.164 destination.");
  }
  if (
    config.transferEnabled &&
    Number(config.transferEndHour) <= Number(config.transferStartHour)
  ) {
    throw new Error("Transfer end hour must be later than its start hour.");
  }
  const transcriptionLanguage =
    config.language === "hinglish" ? "multi-hi" : config.language;
  const languageInstruction =
    config.language === "en"
      ? "Speak concise Indian English."
      : config.language === "hi"
        ? "Speak concise Hindi, switching to English only when the recipient does."
        : "Speak natural Hinglish and follow the recipient's English/Hindi code-switching.";
  const prompt = [
    "You are an AI assistant calling on behalf of {{seller_company}}.",
    "Keep every response to one or two sentences.",
    languageInstruction,
    "Your bounded objective is to qualify interest and arrange a human follow-up; never negotiate, promise pricing, or invent facts.",
    "Ask concise questions using the supplied {{qualification_context}}.",
    `End after at most ${config.maxTurns} turns and do not retry an objection more than ${config.maxObjectionAttempts} time(s).`,
    "If the recipient opts out, clearly declines, or asks to stop, acknowledge and end immediately.",
    "Every factual answer must use only supplied grounded context.",
    config.additionalInstructions
      ? `Additional approved campaign guidance:\n${config.additionalInstructions}`
      : "",
    config.actionWebhookUrl
      ? "Use schedule_sales_callback only after repeating the exact date, time, and timezone and receiving explicit confirmation."
      : "Do not claim that a callback was scheduled; offer a human follow-up instead.",
    config.actionWebhookUrl && config.bookingLinkEnabled
      ? "Use email_booking_link only after the recipient asks for the link, confirms email as the destination, and confirms sending now."
      : "Do not claim that information or a booking link was sent.",
    config.actionWebhookUrl && config.calendarBookingEnabled
      ? "For direct booking, call find_meeting_slots first and offer only returned slots. After the recipient explicitly confirms one exact slot, call book_confirmed_meeting with that returned slot ID and confirmation evidence. Never invent a slot or claim booking before a success receipt."
      : "Direct calendar booking is unavailable; you may offer the approved booking link if its tool is present.",
    config.transferEnabled
      ? "For live transfer: only after the recipient explicitly requests a human or explicitly accepts your offer to connect one, call check_human_transfer_availability. Call transfer_call exactly once only when that tool returns result.allowed=true. Follow result.instruction when result.allowed=false. Never reveal the destination number or claim success before the provider completes the transfer."
      : "Human transfer is unavailable. Never claim a transfer occurred.",
    "Live calendar booking is unavailable unless a corresponding provider tool is present. Never claim any action succeeded without its tool receipt.",
    "Lead: {{customer_name}}; company: {{company}}; title: {{title}}; context: {{qualification_context}}.",
  ].join("\n");

  const defaultWelcome =
    "Hello {{customer_name}}, I am an AI assistant calling on behalf of {{seller_company}}. Is now a good time for a brief conversation?";
  const welcomeMessage = config.agentWelcomeMessage?.trim() || defaultWelcome;

  const synthesizerProvider = config.synthesizerProvider || "elevenlabs";
  const voiceId = config.voiceId || "V9LCAAi4tTlqe9JadbCo";
  const voiceName = config.voiceName || "Nila";
  const synthesizerModel = config.synthesizerModel || "eleven_turbo_v2_5";
  const llmProvider = config.llmProvider || "openai";
  const llmModel = config.llmModel || "gpt-5.4-mini";
  const temperature = config.temperature ?? 1;
  const transcriberProvider = config.transcriberProvider || "deepgram";
  const transcriberModel = config.transcriberModel || "nova-3";
  const endpointing = config.endpointingMs ?? 250;
  const ambientNoise = Boolean(config.ambientNoise);
  const ambientNoiseTrack = config.ambientNoiseTrack || "office";
  const interruptionWords = config.interruptionWords ?? 2;
  const silenceHangup = config.silenceHangupSeconds ?? 10;
  const telephonyProvider = config.telephonyProvider || "plivo";
  const apiTools = config.actionWebhookUrl
    ? buildSalesEngAiApiTools(
        config.actionWebhookUrl,
        Boolean(config.bookingLinkEnabled),
        config.transferEnabled && config.transferPhone
          ? {
              phone: config.transferPhone,
              timezone: config.transferTimezone ?? "Asia/Kolkata",
              startHour: config.transferStartHour ?? 9,
              endHour: config.transferEndHour ?? 18,
              weekdays: config.transferWeekdays ?? [1, 2, 3, 4, 5],
              fallback: config.transferFallback ?? "schedule_callback",
            }
          : undefined,
        Boolean(config.calendarBookingEnabled),
      )
    : undefined;

  return {
    agent_config: {
      agent_name: config.agentName,
      agent_welcome_message: welcomeMessage,
      agent_type: "other",
      webhook_url: config.webhookUrl,
      calling_guardrails: {
        call_start_hour: config.callStartHour,
        call_end_hour: config.callEndHour,
      },
      ...(telephonyProvider === "sip-trunk"
        ? { telephony_provider: "sip-trunk" }
        : {}),
      tasks: [
        {
          task_type: "conversation",
          toolchain: {
            execution: "sequential",
            pipelines: [["transcriber", "llm", "synthesizer"]],
          },
          tools_config: {
            ...(apiTools ? { api_tools: apiTools } : {}),
            llm_agent: {
              agent_type: "simple_llm_agent",
              agent_flow_type: "streaming",
              llm_config: {
                provider: llmProvider,
                model: llmModel,
                max_tokens: 150,
                temperature,
              },
            },
            synthesizer: {
              provider: synthesizerProvider,
              provider_config: {
                voice: voiceName,
                voice_id: voiceId,
                model: synthesizerModel,
              },
              stream: true,
              buffer_size: 250,
              audio_format: "wav",
            },
            transcriber: {
              provider: transcriberProvider,
              model: transcriberModel,
              language: transcriptionLanguage,
              stream: true,
              encoding: "linear16",
              sampling_rate: 16000,
              endpointing,
            },
            input: { provider: telephonyProvider, format: "wav" },
            output: { provider: telephonyProvider, format: "wav" },
          },
          task_config: {
            call_terminate: config.maxCallSeconds,
            hangup_after_silence: silenceHangup,
            hangup_after_LLMCall: false,
            number_of_words_for_interruption: interruptionWords,
            auto_reschedule: false,
            voicemail: false,
            ambient_noise: ambientNoise,
            ...(ambientNoise ? { ambient_noise_track: ambientNoiseTrack } : {}),
          },
        },
      ],
    },
    agent_prompts: {
      task_1: { system_prompt: prompt },
    },
  };
}

export function buildSalesEngAiApiTools(
  actionWebhookUrl: string,
  bookingLinkEnabled: boolean,
  transfer?: {
    phone: string;
    timezone: string;
    startHour: number;
    endHour: number;
    weekdays: number[];
    fallback: "schedule_callback" | "human_review" | "end_call";
  },
  calendarBookingEnabled = false,
) {
  const tools: Array<Record<string, unknown>> = [
    {
      type: "function",
      function: {
        name: "schedule_sales_callback",
        description:
          "Schedule a sales callback only after the recipient chooses an exact future date/time and explicitly confirms that exact callback. Never call this while proposing or clarifying a time.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            at: {
              type: "string",
              description:
                "Confirmed future timestamp in ISO 8601 format with UTC offset.",
            },
            tz: {
              type: "string",
              description: "Confirmed IANA timezone, for example Asia/Kolkata.",
            },
            confirmation_evidence: {
              type: "string",
              description:
                "The recipient's short verbatim confirmation of the exact callback.",
            },
          },
          required: ["at", "tz", "confirmation_evidence"],
          additionalProperties: false,
        },
      },
    },
  ];
  const toolsParams: Record<string, Record<string, unknown>> = {
    schedule_sales_callback: {
      url: actionWebhookUrl,
      method: "POST",
      headers: { "content-type": "application/json" },
      pre_call_message: "I will save that callback time now.",
      param: {
        execution_id: "{salesengai_execution_id}",
        confirmed: true,
        confirmation_evidence: "%(confirmation_evidence)s",
        kind: "SCHEDULE_CALLBACK",
        at: "%(at)s",
        tz: "%(tz)s",
      },
    },
  };

  if (bookingLinkEnabled) {
    tools.push({
      type: "function",
      function: {
        name: "email_booking_link",
        description:
          "Email the workspace's approved booking link only after the recipient explicitly asks for it, confirms email as the destination, and confirms sending now.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            confirmation_evidence: {
              type: "string",
              description:
                "The recipient's short verbatim confirmation to email the booking link now.",
            },
          },
          required: ["confirmation_evidence"],
          additionalProperties: false,
        },
      },
    });
    toolsParams.email_booking_link = {
      url: actionWebhookUrl,
      method: "POST",
      headers: { "content-type": "application/json" },
      pre_call_message: "I will email the approved booking link now.",
      param: {
        execution_id: "{salesengai_execution_id}",
        confirmed: true,
        confirmation_evidence: "%(confirmation_evidence)s",
        kind: "SEND_INFORMATION",
        doc_id: "booking_link",
      },
    };
  }

  if (transfer) {
    tools.push(
      {
        type: "function",
        function: {
          name: "check_human_transfer_availability",
          description:
            "Check whether a human can receive this call. Use only after the recipient explicitly asks for a human or explicitly accepts an offered transfer. You must follow the returned instruction.",
          strict: true,
          parameters: {
            type: "object",
            properties: {
              trigger: {
                type: "string",
                enum: ["explicit_request", "accepted_offer"],
              },
              reason: {
                type: "string",
                description: "Concise reason the recipient wants a human.",
              },
              confirmation_evidence: {
                type: "string",
                description:
                  "The recipient's short verbatim request or acceptance of a human transfer.",
              },
            },
            required: ["trigger", "reason", "confirmation_evidence"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "transfer_call",
          description:
            "Transfer to the fixed configured human destination. Invoke exactly once and only immediately after check_human_transfer_availability returned result.allowed=true.",
          strict: true,
          parameters: {
            type: "object",
            properties: {
              reason: {
                type: "string",
                description: "Concise transfer reason for the audit receipt.",
              },
            },
            required: ["reason"],
            additionalProperties: false,
          },
        },
      },
    );
    toolsParams.check_human_transfer_availability = {
      url: actionWebhookUrl,
      method: "POST",
      headers: { "content-type": "application/json" },
      param: {
        execution_id: "{salesengai_execution_id}",
        confirmed: true,
        confirmation_evidence: "%(confirmation_evidence)s",
        kind: "TRANSFER_HUMAN",
        trigger: "%(trigger)s",
        reason: "%(reason)s",
      },
    };
    // `transfer_call` is a reserved Bolna tool. Omitting `url` makes Bolna use
    // its provider-owned telephony transfer endpoint; the destination is never
    // supplied by the model.
    toolsParams.transfer_call = {
      method: "POST",
      pre_call_message: "I will connect you with a human now. Please hold.",
      param: {
        call_transfer_number: transfer.phone,
        transfer_timezone: transfer.timezone,
        transfer_start_hour: transfer.startHour,
        transfer_end_hour: transfer.endHour,
        transfer_weekdays: transfer.weekdays,
        transfer_fallback: transfer.fallback,
      },
    };
  }

  if (calendarBookingEnabled) {
    tools.push(
      {
        type: "function",
        function: {
          name: "find_meeting_slots",
          description:
            "Retrieve up to three real free slots from the connected calendar. Use before offering any direct meeting time.",
          strict: true,
          parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "book_confirmed_meeting",
          description:
            "Book one exact slot previously returned by find_meeting_slots, only after the recipient repeats or clearly confirms that slot.",
          strict: true,
          parameters: {
            type: "object",
            properties: {
              slot_id: {
                type: "string",
                description: "Opaque slot ID returned by find_meeting_slots.",
              },
              confirmation_evidence: {
                type: "string",
                description:
                  "The recipient's short verbatim confirmation of the exact slot.",
              },
            },
            required: ["slot_id", "confirmation_evidence"],
            additionalProperties: false,
          },
        },
      },
    );
    toolsParams.find_meeting_slots = {
      url: actionWebhookUrl,
      method: "POST",
      headers: { "content-type": "application/json" },
      param: {
        execution_id: "{salesengai_execution_id}",
        confirmed: false,
        kind: "BOOK_MEETING",
        operation: "FIND_SLOTS",
      },
    };
    toolsParams.book_confirmed_meeting = {
      url: actionWebhookUrl,
      method: "POST",
      headers: { "content-type": "application/json" },
      pre_call_message: "I will book that exact time now.",
      param: {
        execution_id: "{salesengai_execution_id}",
        confirmed: true,
        confirmation_evidence: "%(confirmation_evidence)s",
        kind: "BOOK_MEETING",
        operation: "BOOK_SLOT",
        slot_id: "%(slot_id)s",
      },
    };
  }

  return { tools, tools_params: toolsParams };
}

export async function provisionBolnaQualificationAgent(
  apiKey: string,
  config: ManagedBolnaAgentConfig,
) {
  const data = await requestBolna(apiKey, "/v2/agent", {
    method: "POST",
    body: JSON.stringify(buildManagedBolnaAgentPayload(config)),
  });
  return z
    .object({
      agent_id: z.string().uuid(),
      state: z.string(),
    })
    .passthrough()
    .parse(data);
}

export async function updateBolnaQualificationAgent(
  apiKey: string,
  agentId: string,
  config: ManagedBolnaAgentConfig,
) {
  const data = await requestBolna(
    apiKey,
    `/v2/agent/${encodeURIComponent(agentId)}`,
    {
      method: "PUT",
      body: JSON.stringify(buildManagedBolnaAgentPayload(config)),
    },
  );
  return z
    .object({
      agent_id: z.string().uuid().optional(),
      id: z.string().uuid().optional(),
      state: z.string().optional(),
      status: z.string().optional(),
    })
    .refine((value) => Boolean(value.agent_id ?? value.id), {
      message: "Bolna update response is missing the agent ID.",
    })
    .passthrough()
    .parse(data);
}

export async function createBolnaCall(options: {
  apiKey: string;
  agentId: string;
  recipientPhone: string;
  fromPhone?: string | null;
  userData: Record<string, string>;
}) {
  const body: Record<string, unknown> = {
    agent_id: options.agentId,
    recipient_phone_number: options.recipientPhone,
    user_data: options.userData,
    retry_config: { enabled: false },
    bypass_call_guardrails: false,
  };
  if (options.fromPhone) body.from_phone_number = options.fromPhone;
  const data = await requestBolna(options.apiKey, "/call", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const executionId = String(data.execution_id ?? "");
  if (!executionId) throw new Error("Bolna did not return an execution ID.");
  return {
    executionId,
    status: String(data.status ?? "queued"),
    raw: data,
  };
}

export async function getBolnaExecution(
  apiKey: string,
  executionId: string,
  _agentId?: string | null,
) {
  // The current provider contract retrieves an execution directly by ID.
  // Agent-scoped execution endpoints are list endpoints, not single-call
  // retrieval endpoints.
  return requestBolna(apiKey, `/executions/${encodeURIComponent(executionId)}`);
}

const bolnaExecutionSchema = z
  .object({
    // The current execution reference documents UUID strings, while the
    // webhook status guide also shows numeric IDs in an example payload.
    id: z.union([z.string(), z.number()]).transform(String).optional(),
    execution_id: z.union([z.string(), z.number()]).transform(String).optional(),
    status: z.string(),
    error_message: z.string().nullish(),
    answered_by_voice_mail: z.boolean().nullish(),
    transcript: z.string().nullish(),
    conversation_duration: z.coerce.number().nonnegative().nullish(),
    conversation_time: z.coerce.number().nonnegative().nullish(),
    total_cost: z.union([z.string(), z.number()]).nullish(),
    cost_breakdown: z.record(z.string(), z.union([z.string(), z.number()])).nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
    telephony_data: z
      .object({
        duration: z.coerce.number().nonnegative().nullish(),
        recording_url: z.preprocess(
          (value) => (value === "" ? undefined : value),
          z.string().url().nullish(),
        ),
        hangup_reason: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export interface BolnaVoiceProviderOptions {
  apiKey: string;
  agentId: string;
}

function executionId(payload: z.infer<typeof bolnaExecutionSchema>) {
  const id = payload.id ?? payload.execution_id;
  if (!id) throw new Error("Bolna event is missing its execution ID.");
  return id;
}

function transcriptSegments(
  transcript: string | null | undefined,
): TranscriptSegment[] {
  if (!transcript) return [];

  return transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line): TranscriptSegment[] => {
      const match =
        /^(assistant|agent|ai|user|recipient|human|customer)\s*:\s*(.+)$/i.exec(
          line,
        );
      if (!match) return [];
      return [
        {
          speaker: /^(assistant|agent|ai)$/i.test(match[1])
            ? "agent"
            : "recipient",
          text: match[2].trim(),
        },
      ];
    });
}

export class BolnaVoiceProvider implements VoiceProvider {
  private readonly options: BolnaVoiceProviderOptions;

  constructor(options: BolnaVoiceProviderOptions) {
    this.options = options;
  }

  async placeCall(request: PlaceCallRequest): Promise<{ callId: string }> {
    const result = await createBolnaCall({
      apiKey: this.options.apiKey,
      agentId: this.options.agentId,
      recipientPhone: request.to,
      fromPhone: request.from,
      userData: {
        agent_prompt: request.agentPrompt,
        knowledge: JSON.stringify(request.knowledge),
        bounded_actions: JSON.stringify(request.boundedActions),
        hard_limits: JSON.stringify(request.hardLimits),
        idempotency_key: request.idempotencyKey,
        compliance_decision_id: request.decisionId,
      },
    });
    return { callId: result.executionId };
  }

  onEvent(raw: unknown): NormalizedCallEvent {
    return normalizeBolnaEvent(raw);
  }
}

export function normalizeBolnaEvent(raw: unknown): NormalizedCallEvent {
  const payload = bolnaExecutionSchema.parse(raw);
  const callId = executionId(payload);
  const status = payload.status.toLowerCase();

  if (
    ["scheduled", "queued", "rescheduled", "initiated", "ringing"].includes(
      status,
    )
  ) {
    return { kind: "ringing", callId };
  }
  if (["in-progress", "call-disconnected"].includes(status)) {
    return {
      kind: "answered",
      callId,
      at: payload.updated_at ?? payload.created_at ?? "",
    };
  }
  if (status === "no-answer") return { kind: "no_answer", callId };
  if (status === "busy") return { kind: "busy", callId };
  if (status === "completed") {
    if (payload.answered_by_voice_mail) return { kind: "voicemail", callId };
    return {
      kind: "completed",
      callId,
      transcript: transcriptSegments(payload.transcript),
      durationSeconds:
        payload.conversation_duration ??
        payload.conversation_time ??
        payload.telephony_data?.duration ??
        0,
      recordingRef: payload.telephony_data?.recording_url ?? undefined,
    };
  }
  if (
    ["balance-low", "canceled", "failed", "stopped", "error"].includes(status)
  ) {
    return {
      kind: "failed",
      callId,
      reason:
        payload.error_message ??
        payload.telephony_data?.hangup_reason ??
        status,
    };
  }

  throw new Error(`Unsupported Bolna execution status: ${payload.status}`);
}
