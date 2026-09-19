const CALL_INTENT = /\b(call|dial|phone)\b/i;
const EXPLICIT_PERMISSION =
  /\b(i|we)\s+(?:hereby\s+)?confirm(?:ed)?\b.*\b(?:consent|permission|lawful|authori[sz](?:e|ed|ation))\b|\b(?:consent|permission|lawful\s+basis)\s+(?:is|has\s+been)\s+confirm(?:ed)?\b/i;

/**
 * A model-provided boolean is not evidence of permission. Require the user's
 * persisted conversation to contain both the call request and an explicit
 * permission confirmation, in that order (or together in one message).
 */
export function hasExplicitVoiceCallAuthorization(
  chronologicalUserMessages: string[],
): boolean {
  let latestCallRequest = -1;
  for (let index = 0; index < chronologicalUserMessages.length; index += 1) {
    if (CALL_INTENT.test(chronologicalUserMessages[index])) {
      latestCallRequest = index;
    }
  }
  if (latestCallRequest < 0) return false;
  return chronologicalUserMessages
    .slice(latestCallRequest)
    .some((message) => EXPLICIT_PERMISSION.test(message));
}

export function uiMessageText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const value = content as {
    text?: unknown;
    parts?: Array<{ type?: unknown; text?: unknown }>;
  };
  if (typeof value.text === "string") return value.text;
  if (!Array.isArray(value.parts)) return "";
  return value.parts
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join(" ");
}
