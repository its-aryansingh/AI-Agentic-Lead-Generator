export const TRANSFER_FALLBACKS = [
  "schedule_callback",
  "human_review",
  "end_call",
] as const;

export type TransferFallback = (typeof TRANSFER_FALLBACKS)[number];

export type TransferPolicy = {
  enabled: boolean;
  phone: string | null;
  timezone: string;
  startHour: number;
  endHour: number;
  weekdays: number[];
  fallback: TransferFallback;
};

const weekdayNumbers: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function transferFallbackInstruction(fallback: TransferFallback) {
  if (fallback === "schedule_callback") {
    return "Apologize that a human is unavailable and offer to schedule a callback. Do not claim a transfer occurred.";
  }
  if (fallback === "human_review") {
    return "Apologize that a human is unavailable, say the team will review the request, and continue only if the recipient wants to leave a short message.";
  }
  return "Apologize that a human is unavailable, offer no unsupported action, and end the call politely.";
}

export function evaluateTransferAvailability(
  policy: TransferPolicy,
  now = new Date(),
) {
  if (!policy.enabled || !policy.phone) {
    return {
      allowed: false as const,
      reason: "TRANSFER_DISABLED",
      instruction: transferFallbackInstruction(policy.fallback),
    };
  }

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: policy.timezone,
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    return {
      allowed: false as const,
      reason: "TRANSFER_TIMEZONE_INVALID",
      instruction: transferFallbackInstruction(policy.fallback),
    };
  }

  const weekday = weekdayNumbers[
    parts.find((part) => part.type === "weekday")?.value ?? ""
  ];
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const inWindow =
    Boolean(weekday) &&
    Number.isInteger(hour) &&
    policy.weekdays.includes(weekday) &&
    hour >= policy.startHour &&
    hour < policy.endHour;

  if (!inWindow) {
    return {
      allowed: false as const,
      reason: "HUMAN_UNAVAILABLE",
      instruction: transferFallbackInstruction(policy.fallback),
    };
  }

  return {
    allowed: true as const,
    reason: "AVAILABLE",
    instruction:
      "Tell the recipient you are transferring now, then invoke transfer_call exactly once. Do not read or expose the destination number.",
  };
}

type TransferEvent = {
  type?: unknown;
  tool_call_id?: unknown;
  status_code?: unknown;
  success?: unknown;
  transfer_number?: unknown;
};

export function extractBolnaTransferReceipt(payload: Record<string, unknown>) {
  const candidates = [
    payload.progression_data,
    (payload.output as Record<string, unknown> | undefined)?.progression_data,
    (payload.data as Record<string, unknown> | undefined)?.progression_data,
  ];
  const progression = candidates.find(
    (value) => value && typeof value === "object",
  ) as Record<string, unknown> | undefined;
  const events = Array.isArray(progression?.transfer_call_events)
    ? (progression.transfer_call_events as TransferEvent[])
    : [];
  const end = [...events].reverse().find((event) => event.type === "transfer_end");
  const start = [...events].reverse().find((event) => event.type === "transfer_start");
  if (!start && !end) return null;
  return {
    toolCallId: String(end?.tool_call_id ?? start?.tool_call_id ?? "") || null,
    statusCode:
      typeof end?.status_code === "number" ? end.status_code : null,
    success: typeof end?.success === "boolean" ? end.success : null,
    destinationPresent: Boolean(start?.transfer_number),
    started: Boolean(start),
    finished: Boolean(end),
  };
}

