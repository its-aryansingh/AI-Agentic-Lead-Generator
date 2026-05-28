/**
 * slack-core — pure helper tests. The HTTP layer (lib/providers/slack.ts)
 * is verified by the build + manual smoke against a real webhook URL.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  isValidSlackWebhookUrl,
  toSlackPayload,
  clampSlackText,
} from "../lib/providers/slack-core.ts"

// ---------- URL validator ----------

test("isValidSlackWebhookUrl accepts canonical webhook URL shape", () => {
  // Short obviously-fake token so GitHub's secret scanner doesn't flag
  // this string as a real webhook. The validator accepts any
  // [A-Za-z0-9]+ token length — Slack's real tokens are 24 chars.
  assert.equal(
    isValidSlackWebhookUrl("https://hooks.slack.com/services/T0/B0/FAKE"),
    true,
  )
})

test("isValidSlackWebhookUrl rejects non-https / wrong host / wrong path", () => {
  assert.equal(
    isValidSlackWebhookUrl("http://hooks.slack.com/services/T1/B1/abc"),
    false,
  )
  assert.equal(
    isValidSlackWebhookUrl("https://example.com/services/T1/B1/abc"),
    false,
  )
  assert.equal(
    isValidSlackWebhookUrl("https://hooks.slack.com/foobar/T1/B1/abc"),
    false,
  )
  assert.equal(isValidSlackWebhookUrl(""), false)
  assert.equal(isValidSlackWebhookUrl(null), false)
  assert.equal(isValidSlackWebhookUrl(undefined), false)
})

test("isValidSlackWebhookUrl rejects malformed token segment", () => {
  // First two segments after /services/ must be all-uppercase
  // alphanumeric per Slack's id format (T123/B123 prefix). Lowercase
  // there would be a real misconfig.
  assert.equal(
    isValidSlackWebhookUrl("https://hooks.slack.com/services/team1/box1/token"),
    false,
  )
})

test("isValidSlackWebhookUrl rejects pathological length", () => {
  const big = "https://hooks.slack.com/services/T1/B1/" + "a".repeat(600)
  assert.equal(isValidSlackWebhookUrl(big), false)
})

// ---------- payload shaper ----------

test("toSlackPayload always sets text", () => {
  const p = toSlackPayload({ text: "hello" })
  assert.equal(p.text, "hello")
  assert.equal(p.blocks, undefined)
})

test("toSlackPayload prefixes emoji onto text", () => {
  const p = toSlackPayload({ text: "deploy finished", emoji: "✅" })
  assert.equal(p.text, "✅ deploy finished")
})

test("toSlackPayload emits Block Kit when a link is present", () => {
  const p = toSlackPayload({
    text: "automation done",
    link: { url: "https://example.com/runs/abc", label: "View run" },
  })
  assert.ok(p.blocks)
  assert.equal(p.blocks!.length, 2)
  const section = p.blocks![0] as { type: string; text: { type: string; text: string } }
  assert.equal(section.type, "section")
  assert.equal(section.text.text, "automation done")
  const actions = p.blocks![1] as { type: string; elements: unknown[] }
  assert.equal(actions.type, "actions")
  const button = actions.elements[0] as { type: string; url: string; text: { text: string } }
  assert.equal(button.url, "https://example.com/runs/abc")
  assert.equal(button.text.text, "View run")
})

test("toSlackPayload truncates button label to 75 chars (Slack hard limit)", () => {
  const p = toSlackPayload({
    text: "x",
    link: { url: "https://x", label: "a".repeat(200) },
  })
  const button = (p.blocks![1] as { elements: Array<{ text: { text: string } }> }).elements[0]
  assert.equal(button.text.text.length, 75)
})

// ---------- text clamping ----------

test("clampSlackText collapses whitespace + truncates past max", () => {
  const out = clampSlackText("a   b\nc\t\td", 100)
  assert.equal(out, "a b c d")
})

test("clampSlackText adds ellipsis when over limit", () => {
  const out = clampSlackText("a".repeat(1000), 800)
  assert.equal(out.length, 800)
  assert.equal(out.endsWith("…"), true)
})

test("clampSlackText leaves short text alone", () => {
  assert.equal(clampSlackText("hello"), "hello")
})
