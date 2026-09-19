import type { NormalizedCallEvent } from "@/lib/voice/types";

const terminalEventKinds = new Set<NormalizedCallEvent["kind"]>([
  "completed",
  "no_answer",
  "busy",
  "voicemail",
  "failed",
]);

export function isTerminalVoiceExecutionStatus(status: unknown) {
  return ["completed", "failed", "cancelled"].includes(
    String(status ?? "").toLowerCase(),
  );
}

export function isFinishedVoiceOutcome(input: {
  status: unknown;
  providerStatus: unknown;
  outcome: unknown;
  incomingProviderStatus: string;
  eventKind: NormalizedCallEvent["kind"];
}) {
  if (!terminalEventKinds.has(input.eventKind)) return false;
  if (String(input.providerStatus ?? "") !== input.incomingProviderStatus) {
    return false;
  }
  if (input.eventKind === "completed") {
    return (
      input.status === "completed" &&
      Boolean(input.outcome) &&
      input.outcome !== "completed"
    );
  }
  return isTerminalVoiceExecutionStatus(input.status);
}
