import { z } from "zod";

/** Phase 6 chat-tool contracts. Kept separate so tests can validate them without server imports. */
export const uuid = z.string().uuid();
export const isoDateTime = z.string().datetime({ offset: true });

export const leadFiltersSchema = z.object({
  query: z.string().max(200).optional(),
  call_status: z
    .enum([
      "not_called",
      "called",
      "no_answer",
      "answered",
      "busy",
      "completed",
      "failed",
      "any",
    ])
    .default("any"),
  has_phone: z.boolean().optional(),
  lead_status: z
    .enum([
      "new",
      "researching",
      "ready",
      "contacted",
      "engaged",
      "qualified",
      "disqualified",
      "converted",
      "do_not_contact",
      "any",
    ])
    .default("any"),
  availability: z
    .enum([
      "available_now",
      "available_later",
      "callback_requested",
      "has_next_action",
      "unknown",
      "any",
    ])
    .default("any"),
  time_range: z
    .enum(["today", "yesterday", "this_week", "last_30_days", "all_time"])
    .default("all_time"),
  created_after: isoDateTime.optional(),
  created_before: isoDateTime.optional(),
  qualification_bucket: z
    .enum(["hot", "warm", "nurture", "disqualified", "not_determined", "any"])
    .default("any"),
  only_with_replies: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(25),
});

export const leadSelectorObject = z.object({
  lead_ids: z.array(uuid).min(1).max(100).optional(),
  filters: leadFiltersSchema.omit({ limit: true }).optional(),
});

export const leadSelectorSchema = leadSelectorObject.refine(
  (value) => Boolean(value.lead_ids?.length) !== Boolean(value.filters),
  {
    message: "Provide exactly one of lead_ids or filters.",
  },
);

export const applySchema = z.object({
  mode: z.enum(["preview", "apply"]).default("preview"),
  confirmation_token: z.string().min(32).optional(),
});

export const voiceAgentSchema = z
  .object({
    operation: z.enum(["create", "update", "upsert"]),
    language: z.enum(["en", "hi", "hinglish"]),
    voice: z.object({
      provider: z.string().min(1).max(50),
      model: z.string().min(1).max(100),
      voice_id: z.string().min(1).max(200),
      name: z.string().min(1).max(100),
    }),
    tone: z.enum(["professional", "friendly", "consultative", "concise"]),
    welcome_message: z.string().min(20).max(500),
    prompt: z.string().min(100).max(12000),
    transfer_number: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/)
      .nullable()
      .optional(),
    max_call_seconds: z.number().int().min(30).max(300).default(180),
    max_turns: z.number().int().min(2).max(30).default(12),
  })
  .merge(applySchema);

export const qualificationBatchSchema = leadSelectorObject
  .merge(
    z.object({
      confirmed_lawful_permission: z.boolean(),
      allow_override: z.boolean().default(false),
      override_reason: z.string().min(10).max(500).optional(),
      idempotency_key: uuid,
    }),
  )
  .merge(applySchema)
  .superRefine((value, ctx) => {
    if (Boolean(value.lead_ids?.length) === Boolean(value.filters)) {
      ctx.addIssue({
        code: "custom",
        message: "Provide exactly one of lead_ids or filters.",
      });
    }
    if (value.allow_override && !value.override_reason) {
      ctx.addIssue({
        code: "custom",
        path: ["override_reason"],
        message: "Override reason is required.",
      });
    }
  });

export const followupSchema = z
  .object({
    lead_id: uuid,
    channel: z.enum(["email", "voice"]),
    scheduled_at: isoDateTime,
    timezone: z.string().min(1).max(100),
    note: z.string().max(1000).optional(),
    idempotency_key: uuid,
  })
  .merge(applySchema);

export const crmSyncSchema = z
  .object({
    provider: z.enum(["hubspot", "zoho"]),
    limit: z.number().int().min(1).max(1000).default(200),
    modified_after: isoDateTime.optional(),
  })
  .merge(applySchema);

export const callDetailsSchema = z
  .object({
    execution_id: uuid.optional(),
    lead_id: uuid.optional(),
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    include_transcript: z.boolean().default(true),
    include_recording: z.boolean().default(true),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .refine((value) => !(value.execution_id && value.lead_id), {
    message: "Use execution_id or lead_id, not both.",
  });

export const triggerOutreachSchema = leadSelectorObject
  .merge(
    z.object({
      channel_strategy: z.enum(["email", "voice", "smart_both", "sequence"]),
      sequence_id: uuid.optional(),
      confirmed_lawful_permission: z.boolean().default(false),
      allow_override: z.boolean().default(false),
      override_reason: z.string().min(10).max(500).optional(),
      idempotency_key: uuid,
    }),
  )
  .merge(applySchema)
  .superRefine((value, ctx) => {
    if (Boolean(value.lead_ids?.length) === Boolean(value.filters)) {
      ctx.addIssue({
        code: "custom",
        message: "Provide exactly one of lead_ids or filters.",
      });
    }
    if (value.allow_override && !value.override_reason) {
      ctx.addIssue({
        code: "custom",
        path: ["override_reason"],
        message: "Override reason is required.",
      });
    }
  });

export type VoiceAgentInput = z.infer<typeof voiceAgentSchema>;
export type QualificationBatchInput = z.infer<typeof qualificationBatchSchema>;
export type FollowupInput = z.infer<typeof followupSchema>;
export type CrmSyncInput = z.infer<typeof crmSyncSchema>;
export type CallDetailsInput = z.infer<typeof callDetailsSchema>;
export type TriggerOutreachInput = z.infer<typeof triggerOutreachSchema>;
