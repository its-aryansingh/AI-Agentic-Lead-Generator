import type { BusyPeriod } from "@/lib/providers/google-calendar";

const weekdays: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export type CalendarPolicy = {
  timezone: string;
  startHour: number;
  endHour: number;
  weekdays: number[];
  durationMinutes: number;
  incrementMinutes: number;
  bufferMinutes: number;
};

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  return {
    weekday: weekdays[parts.find((part) => part.type === "weekday")?.value ?? ""],
    hour: Number(parts.find((part) => part.type === "hour")?.value),
    minute: Number(parts.find((part) => part.type === "minute")?.value),
  };
}

export function findAvailableMeetingSlots(options: {
  policy: CalendarPolicy;
  busy: BusyPeriod[];
  now?: Date;
  limit?: number;
  horizonDays?: number;
}) {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 3, 1), 8);
  const horizon = new Date(
    now.getTime() + Math.min(options.horizonDays ?? 14, 30) * 86_400_000,
  );
  const scanStepMs = 15 * 60_000;
  let cursor = new Date(
    Math.ceil((now.getTime() + 60 * 60_000) / scanStepMs) * scanStepMs,
  );
  const durationMs = options.policy.durationMinutes * 60_000;
  const bufferMs = options.policy.bufferMinutes * 60_000;
  const parsedBusy = options.busy.map((period) => ({
    start: new Date(period.start).getTime() - bufferMs,
    end: new Date(period.end).getTime() + bufferMs,
  }));
  const slots: Array<{ id: string; start: string; end: string; label: string }> = [];

  while (cursor < horizon && slots.length < limit) {
    const end = new Date(cursor.getTime() + durationMs);
    const startLocal = localParts(cursor, options.policy.timezone);
    const endLocal = localParts(end, options.policy.timezone);
    const endsAtNextMidnight =
      options.policy.endHour === 24 &&
      endLocal.weekday === (startLocal.weekday % 7) + 1 &&
      endLocal.hour === 0 &&
      endLocal.minute === 0;
    const startsInWindow =
      options.policy.weekdays.includes(startLocal.weekday) &&
      startLocal.minute % options.policy.incrementMinutes === 0 &&
      startLocal.hour >= options.policy.startHour &&
      (startLocal.hour < options.policy.endHour ||
        (startLocal.hour === options.policy.endHour && startLocal.minute === 0));
    const endsInWindow =
      (endLocal.weekday === startLocal.weekday || endsAtNextMidnight) &&
      (endLocal.hour < options.policy.endHour ||
        (endLocal.hour === options.policy.endHour && endLocal.minute === 0));
    const overlaps = parsedBusy.some(
      (period) => cursor.getTime() < period.end && end.getTime() > period.start,
    );
    if (startsInWindow && endsInWindow && !overlaps) {
      const start = cursor.toISOString();
      slots.push({
        id: createSlotId(start, end.toISOString()),
        start,
        end: end.toISOString(),
        label: new Intl.DateTimeFormat("en-IN", {
          timeZone: options.policy.timezone,
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit",
        }).format(cursor),
      });
    }
    cursor = new Date(cursor.getTime() + scanStepMs);
  }
  return slots;
}

export function meetingSlotAllowed(options: {
  policy: CalendarPolicy;
  busy: BusyPeriod[];
  start: Date;
  end: Date;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  if (
    options.start.getTime() < now.getTime() + 30 * 60_000 ||
    options.start.getTime() > now.getTime() + 30 * 86_400_000 ||
    options.end.getTime() - options.start.getTime() !==
      options.policy.durationMinutes * 60_000
  ) {
    return false;
  }
  const startLocal = localParts(options.start, options.policy.timezone);
  const endLocal = localParts(options.end, options.policy.timezone);
  const endsAtNextMidnight =
    options.policy.endHour === 24 &&
    endLocal.weekday === (startLocal.weekday % 7) + 1 &&
    endLocal.hour === 0 &&
    endLocal.minute === 0;
  const inWindow =
    options.policy.weekdays.includes(startLocal.weekday) &&
    startLocal.minute % options.policy.incrementMinutes === 0 &&
    startLocal.hour >= options.policy.startHour &&
    (endLocal.weekday === startLocal.weekday || endsAtNextMidnight) &&
    (endLocal.hour < options.policy.endHour ||
      (endLocal.hour === options.policy.endHour && endLocal.minute === 0));
  const bufferMs = options.policy.bufferMinutes * 60_000;
  const overlaps = options.busy.some(
    (period) =>
      options.start.getTime() < new Date(period.end).getTime() + bufferMs &&
      options.end.getTime() > new Date(period.start).getTime() - bufferMs,
  );
  return inWindow && !overlaps;
}

export function createSlotId(start: string, end: string) {
  return Buffer.from(`${start}|${end}`, "utf8").toString("base64url");
}

export function parseSlotId(slotId: string) {
  try {
    const [start, end] = Buffer.from(slotId, "base64url").toString("utf8").split("|");
    if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) {
      return null;
    }
    return { start, end };
  } catch {
    return null;
  }
}
