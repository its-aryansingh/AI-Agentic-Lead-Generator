/**
 * mailbox-rotation-core — pure selector tests.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  pickRotationMailbox,
  totalHeadroom,
} from "../lib/mailbox-rotation-core.ts"

const mk = (
  id: string,
  daily_sent: number,
  effective_cap: number,
  warmup_started_at_ms = 0,
) => ({ id, daily_sent, effective_cap, warmup_started_at_ms })

// ---------- pickRotationMailbox ----------

test("pickRotationMailbox picks the lowest-utilization mailbox", () => {
  // mailbox a: 9/10 = 90% used. mailbox b: 5/200 = 2.5%. b wins.
  const choice = pickRotationMailbox([mk("a", 9, 10), mk("b", 5, 200)])
  assert.equal(choice?.id, "b")
})

test("pickRotationMailbox skips mailboxes at or over cap", () => {
  const choice = pickRotationMailbox([
    mk("at-cap", 10, 10),
    mk("over-cap", 12, 10),
    mk("room", 0, 5),
  ])
  assert.equal(choice?.id, "room")
})

test("pickRotationMailbox returns null when nothing has headroom", () => {
  const choice = pickRotationMailbox([
    mk("a", 10, 10),
    mk("b", 200, 200),
  ])
  assert.equal(choice, null)
})

test("pickRotationMailbox returns null on empty pool", () => {
  assert.equal(pickRotationMailbox([]), null)
})

test("pickRotationMailbox skips zero-cap mailboxes (defensive)", () => {
  const choice = pickRotationMailbox([mk("zero", 0, 0), mk("ok", 0, 5)])
  assert.equal(choice?.id, "ok")
})

test("pickRotationMailbox tie-breaks on older warmup_started_at", () => {
  // Both at 0% utilization → older (smaller timestamp) wins.
  const older = mk("older", 0, 100, 1_000_000)
  const newer = mk("newer", 0, 100, 5_000_000)
  // Order shouldn't matter for the tie-break.
  assert.equal(pickRotationMailbox([newer, older])?.id, "older")
  assert.equal(pickRotationMailbox([older, newer])?.id, "older")
})

test("pickRotationMailbox prefers fractional utilization over equal sent", () => {
  // a: 5/10 = 50%; b: 5/100 = 5%. b wins despite same daily_sent.
  const choice = pickRotationMailbox([mk("a", 5, 10), mk("b", 5, 100)])
  assert.equal(choice?.id, "b")
})

// ---------- totalHeadroom ----------

test("totalHeadroom sums remaining capacity", () => {
  assert.equal(
    totalHeadroom([mk("a", 9, 10), mk("b", 0, 50), mk("c", 200, 200)]),
    1 + 50 + 0,
  )
})

test("totalHeadroom clamps overflow to 0 per mailbox", () => {
  // Over-cap mailbox contributes 0, not negative.
  assert.equal(totalHeadroom([mk("over", 15, 10)]), 0)
})

test("totalHeadroom on empty pool is 0", () => {
  assert.equal(totalHeadroom([]), 0)
})
