import { z } from "zod";

const scheduleCallbackSchema = z.object({
  kind: z.literal("SCHEDULE_CALLBACK"),
  at: z.string().datetime({ offset: true }),
  tz: z.string().trim().min(1).max(80),
});

const sendInformationSchema = z.object({
  kind: z.literal("SEND_INFORMATION"),
  docId: z.literal("booking_link"),
});

const transferHumanSchema = z.object({
  kind: z.literal("TRANSFER_HUMAN"),
  trigger: z.enum(["explicit_request", "accepted_offer"]),
  reason: z.string().trim().min(1).max(240),
});

const bookMeetingSchema = z
  .object({
    kind: z.literal("BOOK_MEETING"),
    operation: z.enum(["FIND_SLOTS", "BOOK_SLOT"]),
    slotId: z.string().trim().min(1).max(300).optional(),
  })
  .superRefine((value, context) => {
    if (value.operation === "BOOK_SLOT" && !value.slotId) {
      context.addIssue({
        code: "custom",
        path: ["slotId"],
        message: "A verified slot ID is required.",
      });
    }
  });

export const executableVoiceActionSchema = z.discriminatedUnion("kind", [
  scheduleCallbackSchema,
  sendInformationSchema,
  transferHumanSchema,
  bookMeetingSchema,
]);

const canonicalVoiceActionCallbackSchema = z.object({
  executionId: z.string().uuid(),
  toolCallId: z.string().trim().min(1).max(200).optional(),
  confirmed: z.boolean(),
  confirmationEvidence: z.string().trim().max(300).optional(),
  action: executableVoiceActionSchema,
});

export const voiceActionCallbackSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || "action" in value) return value;
  const flat = value as Record<string, unknown>;
  const executionId = flat.execution_id ?? flat.executionId;
  const toolCallId = flat.tool_call_id ?? flat.toolCallId;
  const confirmationEvidence =
    flat.confirmation_evidence ?? flat.confirmationEvidence;
  if (flat.kind === "SCHEDULE_CALLBACK") {
    return {
      executionId,
      toolCallId,
      confirmed: flat.confirmed,
      confirmationEvidence,
      action: { kind: flat.kind, at: flat.at, tz: flat.tz },
    };
  }
  if (flat.kind === "SEND_INFORMATION") {
    return {
      executionId,
      toolCallId,
      confirmed: flat.confirmed,
      confirmationEvidence,
      action: { kind: flat.kind, docId: flat.doc_id ?? flat.docId },
    };
  }
  if (flat.kind === "TRANSFER_HUMAN") {
    return {
      executionId,
      toolCallId,
      confirmed: flat.confirmed,
      confirmationEvidence,
      action: {
        kind: flat.kind,
        trigger: flat.trigger,
        reason: flat.reason,
      },
    };
  }
  if (flat.kind === "BOOK_MEETING") {
    return {
      executionId,
      toolCallId,
      confirmed: flat.confirmed,
      confirmationEvidence,
      action: {
        kind: flat.kind,
        operation: flat.operation,
        slotId: flat.slot_id ?? flat.slotId,
      },
    };
  }
  return value;
}, canonicalVoiceActionCallbackSchema);

export type ExecutableVoiceAction = z.infer<
  typeof executableVoiceActionSchema
>;

export function validateConfirmedVoiceAction(input: {
  confirmed: boolean;
  confirmationEvidence?: string;
  action: ExecutableVoiceAction;
  now?: Date;
}) {
  if (
    input.action.kind === "BOOK_MEETING" &&
    input.action.operation === "FIND_SLOTS"
  ) {
    return { requiresConfirmation: false as const };
  }
  if (!input.confirmed) return { requiresConfirmation: true as const };
  if (!input.confirmationEvidence?.trim()) {
    throw new Error("Confirmation evidence is required before execution.");
  }
  if (input.action.kind === "SCHEDULE_CALLBACK") {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.action.tz }).format();
    } catch {
      throw new Error("Callback timezone is invalid.");
    }
    const at = new Date(input.action.at);
    const now = input.now ?? new Date();
    if (at.getTime() <= now.getTime()) {
      throw new Error("Callback time must be in the future.");
    }
    if (at.getTime() > now.getTime() + 90 * 24 * 60 * 60 * 1000) {
      throw new Error("Callback time cannot be more than 90 days away.");
    }
  }
  return { requiresConfirmation: false as const };
}
