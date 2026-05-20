/**
 * Tests for the reply classifier's mock path + needsHuman routing.
 * (The real Claude path isn't unit-tested here; the eval harness covers
 * drafting quality, and classification accuracy is a separate offline eval.)
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import { classifyReply, needsHuman } from "../lib/reply-classify.ts"

test("classify: unsubscribe request", async () => {
  const r = await classifyReply({ body: "Please remove me from your list." })
  assert.equal(r.category, "unsubscribe")
})

test("classify: out of office", async () => {
  const r = await classifyReply({
    body: "I am out of office until Monday with limited access to email.",
  })
  assert.equal(r.category, "out_of_office")
})

test("classify: not interested", async () => {
  const r = await classifyReply({ body: "No thanks, we're good for now." })
  assert.equal(r.category, "not_interested")
})

test("classify: question about pricing", async () => {
  const r = await classifyReply({ body: "Interesting — how much does it cost?" })
  assert.equal(r.category, "question")
})

test("classify: interested", async () => {
  const r = await classifyReply({
    body: "Sounds good, happy to chat. Can you send a calendar link?",
  })
  assert.equal(r.category, "interested")
})

test("classify: objection", async () => {
  const r = await classifyReply({
    body: "We already use a competitor, bad timing right now.",
  })
  assert.equal(r.category, "objection")
})

test("classify: other / unclear", async () => {
  const r = await classifyReply({ body: "asdf qwerty zzz" })
  assert.equal(r.category, "other")
})

test("needsHuman: routes interested/question/objection to humans", () => {
  assert.equal(needsHuman("interested"), true)
  assert.equal(needsHuman("question"), true)
  assert.equal(needsHuman("objection"), true)
  assert.equal(needsHuman("unsubscribe"), false)
  assert.equal(needsHuman("out_of_office"), false)
  assert.equal(needsHuman("not_interested"), false)
  assert.equal(needsHuman("other"), false)
})
