import assert from "node:assert/strict";
import { test } from "node:test";

import {
  VOICE_ACTION_KINDS,
  type NormalizedCallEvent,
  type VoiceAction,
} from "@/lib/voice/types";

test("voice agents expose exactly the seven approved bounded actions", () => {
  assert.deepEqual(VOICE_ACTION_KINDS, [
    "ASK_QUESTION",
    "ANSWER",
    "SCHEDULE_CALLBACK",
    "BOOK_MEETING",
    "TRANSFER_HUMAN",
    "SEND_INFORMATION",
    "END_CALL",
  ]);
});

test("factual voice answers carry citations", () => {
  const answer: VoiceAction = {
    kind: "ANSWER",
    text: "The approved plan supports the requested integration.",
    citations: ["knowledge:approved-plan"],
  };

  assert.equal(answer.kind, "ANSWER");
  assert.deepEqual(answer.citations, ["knowledge:approved-plan"]);
});

test("normalized call events cover provider-independent terminal outcomes", () => {
  const events: NormalizedCallEvent[] = [
    { kind: "no_answer", callId: "call-1" },
    { kind: "busy", callId: "call-2" },
    { kind: "voicemail", callId: "call-3" },
    {
      kind: "completed",
      callId: "call-4",
      transcript: [{ speaker: "recipient", text: "Please call next week." }],
      durationSeconds: 42,
    },
    { kind: "failed", callId: "call-5", reason: "provider_unavailable" },
  ];

  assert.deepEqual(
    events.map((event) => event.kind),
    ["no_answer", "busy", "voicemail", "completed", "failed"],
  );
});
