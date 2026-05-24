/**
 * WhatsApp OUTREACH (Phase 3b) — pure helpers backing the inbound webhook.
 *
 * The route itself uses "@/" aliases + next/server + DB clients, so the
 * helpers live in lib/whatsapp-webhook-core.ts (import-free) and the route
 * imports them. We test the core directly so `node --test
 * --experimental-strip-types` can load it.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  isOptOutText,
  normalizeWhatsAppPayload,
  type NormalizedWhatsAppEvent,
} from "../lib/whatsapp-webhook-core.ts"

// ---------- opt-out detection ----------

test("isOptOutText: exact STOP / UNSUBSCRIBE keywords (case-insensitive)", () => {
  assert.equal(isOptOutText("STOP"), true)
  assert.equal(isOptOutText("stop"), true)
  assert.equal(isOptOutText("Stop"), true)
  assert.equal(isOptOutText("UNSUBSCRIBE"), true)
  assert.equal(isOptOutText("unsubscribe"), true)
  assert.equal(isOptOutText("optout"), true)
  assert.equal(isOptOutText("opt-out"), true)
  assert.equal(isOptOutText("opt out"), true)
  assert.equal(isOptOutText("CANCEL"), true)
  assert.equal(isOptOutText("end"), true)
  assert.equal(isOptOutText("quit"), true)
})

test("isOptOutText: STOP as first token with trailing punctuation", () => {
  assert.equal(isOptOutText("STOP."), true)
  assert.equal(isOptOutText("STOP!"), true)
  assert.equal(isOptOutText("Stop please"), true)
  assert.equal(isOptOutText("unsubscribe me"), true)
  assert.equal(isOptOutText("  STOP  "), true)
})

test("isOptOutText: ordinary replies are NOT opt-out", () => {
  assert.equal(isOptOutText("Yes interested, let's chat"), false)
  assert.equal(isOptOutText("Not now"), false)
  assert.equal(isOptOutText("Hi there"), false)
  assert.equal(isOptOutText("Tell me more"), false)
  assert.equal(isOptOutText("I will stop using this"), false) // 'stop' not first token
  assert.equal(isOptOutText(""), false)
  assert.equal(isOptOutText("   "), false)
})

// ---------- payload normalization ----------

test("normalizeWhatsAppPayload: Meta Cloud API envelope", () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: "wamid.AAA",
                  from: "+919876543210",
                  type: "text",
                  text: { body: "Hi, interested!" },
                },
              ],
              statuses: [
                {
                  id: "wamid.BBB",
                  status: "delivered",
                  recipient_id: "+919876543210",
                },
              ],
            },
          },
        ],
      },
    ],
  }
  const n: NormalizedWhatsAppEvent = normalizeWhatsAppPayload(payload)
  assert.equal(n.messages.length, 1)
  assert.equal(n.messages[0].id, "wamid.AAA")
  assert.equal(n.messages[0].from, "+919876543210")
  assert.equal(n.messages[0].text, "Hi, interested!")
  assert.equal(n.statuses.length, 1)
  assert.equal(n.statuses[0].status, "delivered")
})

test("normalizeWhatsAppPayload: flat {messages,statuses} shape", () => {
  const payload = {
    messages: [{ id: "m1", from: "919...", body: "STOP" }],
    statuses: [{ id: "m1", status: "failed", reason: "rate-limited" }],
  }
  const n = normalizeWhatsAppPayload(payload)
  assert.equal(n.messages.length, 1)
  assert.equal(n.messages[0].text, "STOP")
  assert.equal(n.statuses[0].reason, "rate-limited")
})

test("normalizeWhatsAppPayload: de-duplicates same wamid", () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                { id: "x1", from: "1", text: { body: "a" } },
                { id: "x1", from: "1", text: { body: "a" } },
              ],
            },
          },
        ],
      },
    ],
  }
  const n = normalizeWhatsAppPayload(payload)
  assert.equal(n.messages.length, 1)
})

test("normalizeWhatsAppPayload: garbage input is empty, not throw", () => {
  assert.deepEqual(normalizeWhatsAppPayload(null), { messages: [], statuses: [] })
  assert.deepEqual(normalizeWhatsAppPayload(undefined), {
    messages: [],
    statuses: [],
  })
  assert.deepEqual(normalizeWhatsAppPayload({}), { messages: [], statuses: [] })
  assert.deepEqual(normalizeWhatsAppPayload("not json"), {
    messages: [],
    statuses: [],
  })
  assert.deepEqual(
    normalizeWhatsAppPayload({ entry: "nope" }),
    { messages: [], statuses: [] },
  )
})

test("normalizeWhatsAppPayload: drops messages missing id or from", () => {
  const payload = {
    messages: [
      { id: "ok", from: "9", text: "hi" },
      { from: "9", text: "no id" },
      { id: "ok2", text: "no from" },
    ],
  }
  const n = normalizeWhatsAppPayload(payload)
  assert.equal(n.messages.length, 1)
  assert.equal(n.messages[0].id, "ok")
})
