import assert from "node:assert/strict"
import { test } from "node:test"

import {
  hasExplicitVoiceCallAuthorization,
  uiMessageText,
} from "@/lib/voice/chat-call-authorization"

test("chat calling requires both call intent and explicit permission", () => {
  assert.equal(
    hasExplicitVoiceCallAuthorization([
      "Call Jane now.",
      "I confirm we have lawful permission to call this lead.",
    ]),
    true,
  )
  assert.equal(
    hasExplicitVoiceCallAuthorization([
      "I confirm consent and authorize you to dial Jane now.",
    ]),
    true,
  )
})

test("chat calling rejects vague approval and inferred consent", () => {
  assert.equal(hasExplicitVoiceCallAuthorization(["Call Jane now."]), false)
  assert.equal(
    hasExplicitVoiceCallAuthorization(["Call Jane now.", "Yes, proceed."]),
    false,
  )
  assert.equal(
    hasExplicitVoiceCallAuthorization([
      "Jane replied and asked for a demo.",
      "Please follow up.",
    ]),
    false,
  )
})

test("permission stated before a later call request is not reusable", () => {
  assert.equal(
    hasExplicitVoiceCallAuthorization([
      "We confirmed permission for last week's campaign.",
      "Call Jane now.",
    ]),
    false,
  )
  assert.equal(
    hasExplicitVoiceCallAuthorization([
      "Call Jane now.",
      "I confirm we have lawful permission to call this lead.",
      "Actually, call Bob instead.",
    ]),
    false,
  )
})

test("persisted UI messages expose only user text parts", () => {
  assert.equal(
    uiMessageText({
      role: "user",
      parts: [
        { type: "text", text: "Call Jane." },
        { type: "file", url: "https://example.test" },
        { type: "text", text: "I confirm lawful permission." },
      ],
    }),
    "Call Jane. I confirm lawful permission.",
  )
  assert.equal(uiMessageText({ text: "legacy content" }), "legacy content")
  assert.equal(uiMessageText(null), "")
})
