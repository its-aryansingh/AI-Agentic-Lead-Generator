/**
 * web-push-core — pure helper tests. The async sender + the npm
 * web-push package aren't exercised here; verification happens via
 * the build + manual smoke against a real VAPID-configured browser.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  isValidWebPushSubscription,
  parseSubscriptionJson,
  isValidVapidKey,
  isVapidConfigured,
  isValidVapidSubject,
} from "../lib/providers/web-push-core.ts"

const goodSub = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abcdef",
  keys: {
    p256dh: "BPQ1234567890abcdef-_XYZ",
    auth: "auth-token-xyz",
  },
}

// ---------- subscription validator ----------

test("isValidWebPushSubscription accepts a well-formed sub", () => {
  assert.equal(isValidWebPushSubscription(goodSub), true)
})

test("isValidWebPushSubscription rejects non-objects", () => {
  assert.equal(isValidWebPushSubscription(null), false)
  assert.equal(isValidWebPushSubscription(undefined), false)
  assert.equal(isValidWebPushSubscription("string"), false)
  assert.equal(isValidWebPushSubscription(42), false)
})

test("isValidWebPushSubscription requires https endpoint", () => {
  assert.equal(
    isValidWebPushSubscription({ ...goodSub, endpoint: "http://insecure/" }),
    false,
  )
  assert.equal(
    isValidWebPushSubscription({ ...goodSub, endpoint: "" }),
    false,
  )
})

test("isValidWebPushSubscription rejects pathological endpoint lengths", () => {
  const tooLong = "https://x/" + "a".repeat(2100)
  assert.equal(isValidWebPushSubscription({ ...goodSub, endpoint: tooLong }), false)
})

test("isValidWebPushSubscription requires both keys", () => {
  assert.equal(
    isValidWebPushSubscription({ ...goodSub, keys: { p256dh: "abc" } }),
    false,
  )
  assert.equal(
    isValidWebPushSubscription({ ...goodSub, keys: { auth: "abc" } }),
    false,
  )
  assert.equal(
    isValidWebPushSubscription({ ...goodSub, keys: { p256dh: "", auth: "x" } }),
    false,
  )
})

test("isValidWebPushSubscription rejects oversized keys (sanity cap)", () => {
  assert.equal(
    isValidWebPushSubscription({
      ...goodSub,
      keys: { p256dh: "a".repeat(300), auth: "x" },
    }),
    false,
  )
})

// ---------- subscription JSON parser ----------

test("parseSubscriptionJson round-trips a valid stored sub", () => {
  const cell = JSON.stringify(goodSub)
  const out = parseSubscriptionJson(cell)
  assert.notEqual(out, null)
  assert.equal(out!.endpoint, goodSub.endpoint)
  assert.equal(out!.keys.p256dh, goodSub.keys.p256dh)
})

test("parseSubscriptionJson returns null on malformed input", () => {
  assert.equal(parseSubscriptionJson(""), null)
  assert.equal(parseSubscriptionJson("not json"), null)
  assert.equal(parseSubscriptionJson("{}"), null)
  assert.equal(parseSubscriptionJson('{"endpoint": 1}'), null)
})

// ---------- VAPID key validator ----------

test("isValidVapidKey accepts well-shaped public keys", () => {
  const pub = "B".repeat(87)
  assert.equal(isValidVapidKey(pub, "public"), true)
})

test("isValidVapidKey accepts well-shaped private keys", () => {
  const priv = "B".repeat(43)
  assert.equal(isValidVapidKey(priv, "private"), true)
})

test("isValidVapidKey rejects wrong length / charset", () => {
  assert.equal(isValidVapidKey("short", "public"), false)
  assert.equal(isValidVapidKey("a".repeat(50), "public"), false) // too short for public
  assert.equal(isValidVapidKey("a".repeat(120), "public"), false) // too long
  assert.equal(isValidVapidKey("invalid!chars==", "private"), false)
  assert.equal(isValidVapidKey("", "public"), false)
})

test("isValidVapidKey allows base64url including hyphen + underscore", () => {
  const pub = "ABC-def_GHI" + "A".repeat(76)
  assert.equal(isValidVapidKey(pub, "public"), true)
})

// ---------- subject validator ----------

test("isValidVapidSubject accepts mailto: and https: URIs", () => {
  assert.equal(isValidVapidSubject("mailto:dev@leadgenai.com"), true)
  assert.equal(isValidVapidSubject("https://leadgenai.com"), true)
  assert.equal(isValidVapidSubject("MAILTO:DEV@X.COM"), true) // case-insensitive
})

test("isValidVapidSubject rejects other shapes", () => {
  assert.equal(isValidVapidSubject(""), false)
  assert.equal(isValidVapidSubject(undefined), false)
  assert.equal(isValidVapidSubject("http://insecure"), false)
  assert.equal(isValidVapidSubject("just-a-string"), false)
})

// ---------- isVapidConfigured ----------

test("isVapidConfigured requires all three fields", () => {
  assert.equal(
    isVapidConfigured({ publicKey: "p", privateKey: "q", subject: "mailto:x@y" }),
    true,
  )
  assert.equal(
    isVapidConfigured({ publicKey: "p", privateKey: undefined, subject: "mailto:x@y" }),
    false,
  )
  assert.equal(isVapidConfigured({ publicKey: undefined, privateKey: undefined, subject: undefined }), false)
})
