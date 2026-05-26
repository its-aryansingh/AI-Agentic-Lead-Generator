/**
 * expo-push-core — pure helpers loaded directly under
 * `node --test --experimental-strip-types`. The HTTP layer
 * (lib/providers/expo-push.ts) and the /api/extension/push-register
 * route are exercised by the build + manual smoke tests.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  isValidExpoToken,
  isValidPushToken,
  toExpoPayload,
  chunkTokens,
} from "../lib/providers/expo-push-core.ts"

test("isValidExpoToken accepts both legacy and current wrapper", () => {
  assert.equal(isValidExpoToken("ExponentPushToken[xxxxxxx]"), true)
  assert.equal(isValidExpoToken("ExpoPushToken[xxxxxxx]"), true)
})

test("isValidExpoToken rejects malformed input", () => {
  assert.equal(isValidExpoToken(""), false)
  assert.equal(isValidExpoToken("xxxxxxx"), false)
  assert.equal(isValidExpoToken("ExpoPushToken[]"), false)
  assert.equal(isValidExpoToken("ExpoPushToken[abc"), false)
  assert.equal(isValidExpoToken("Bearer abc"), false)
})

test("isValidPushToken honors the provider gate", () => {
  assert.equal(isValidPushToken("ExpoPushToken[abc]", "expo"), true)
  assert.equal(isValidPushToken("ExpoPushToken[abc]", "web"), true) // length passes web check
  assert.equal(isValidPushToken("opaque-vapid-key-xx", "web"), true)
  assert.equal(isValidPushToken("opaque-vapid-key-xx", "expo"), false)
  assert.equal(isValidPushToken("", "expo"), false)
  assert.equal(isValidPushToken("   ", "expo"), false)
  // Sanity cap
  assert.equal(isValidPushToken("a".repeat(3000), "web"), false)
})

test("toExpoPayload truncates title to 100 chars and body to 240", () => {
  const payload = toExpoPayload({
    to: "ExpoPushToken[abc]",
    title: "x".repeat(150),
    body: "y".repeat(300),
  })
  assert.equal((payload.title as string).length, 100)
  assert.equal((payload.body as string).length, 240)
  assert.equal(payload.sound, "default")
})

test("toExpoPayload includes optional data + priority only when set", () => {
  const minimal = toExpoPayload({ to: "ExpoPushToken[abc]", title: "T", body: "B" })
  assert.equal("data" in minimal, false)
  assert.equal("priority" in minimal, false)

  const full = toExpoPayload({
    to: "ExpoPushToken[abc]",
    title: "T",
    body: "B",
    data: { kind: "hot_reply", id: "r1" },
    priority: "high",
  })
  assert.deepEqual(full.data, { kind: "hot_reply", id: "r1" })
  assert.equal(full.priority, "high")
})

test("toExpoPayload omits empty data object", () => {
  const payload = toExpoPayload({ to: "ExpoPushToken[abc]", title: "T", body: "B", data: {} })
  assert.equal("data" in payload, false)
})

test("chunkTokens splits into batches of <=size", () => {
  const items = Array.from({ length: 250 }, (_, i) => i)
  const chunks = chunkTokens(items, 100)
  assert.equal(chunks.length, 3)
  assert.equal(chunks[0].length, 100)
  assert.equal(chunks[1].length, 100)
  assert.equal(chunks[2].length, 50)
})

test("chunkTokens with empty input returns []", () => {
  assert.deepEqual(chunkTokens([], 100), [])
})

test("chunkTokens with size<=0 returns one big chunk", () => {
  const items = [1, 2, 3]
  assert.deepEqual(chunkTokens(items, 0), [[1, 2, 3]])
})
