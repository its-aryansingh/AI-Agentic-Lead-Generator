/**
 * email-warmup-core — pure ramp tests.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  dailyCapForMailbox,
  warmupDay,
  warmupLengthDays,
  isWarmupComplete,
  DEFAULT_RAMP,
} from "../lib/email-warmup-core.ts"

const DAY_MS = 86_400_000

test("dailyCapForMailbox matches DEFAULT_RAMP at every checkpoint", () => {
  const start = 0
  for (const cp of DEFAULT_RAMP) {
    const cap = dailyCapForMailbox(start, start + cp.day * DAY_MS)
    assert.equal(cap, cp.cap, `at day ${cp.day}`)
  }
})

test("dailyCapForMailbox interpolates linearly between checkpoints", () => {
  // Between day 0 (cap 10) and day 3 (cap 20): day 1.5 should be ~15.
  const cap = dailyCapForMailbox(0, 1.5 * DAY_MS)
  assert.equal(cap, 15)
})

test("dailyCapForMailbox returns checkpoint[0] for day < 0 / freshly created", () => {
  assert.equal(dailyCapForMailbox(Date.now(), Date.now()), DEFAULT_RAMP[0].cap)
  assert.equal(dailyCapForMailbox(Date.now() + 999, Date.now()), DEFAULT_RAMP[0].cap)
})

test("dailyCapForMailbox caps at the final checkpoint past 60 days", () => {
  const past = -100 * DAY_MS // 100 days ago in ms-since-epoch arithmetic
  assert.equal(dailyCapForMailbox(0, past * -1), 300)
  // Also days=120 explicitly:
  assert.equal(dailyCapForMailbox(0, 120 * DAY_MS), 300)
})

test("dailyCapForMailbox accepts Date / string / number for inputs", () => {
  const start = new Date("2026-05-01T00:00:00Z")
  const day7 = new Date("2026-05-08T00:00:00Z")
  assert.equal(dailyCapForMailbox(start, day7), 50)
  assert.equal(dailyCapForMailbox(start.toISOString(), day7.toISOString()), 50)
  assert.equal(dailyCapForMailbox(start.getTime(), day7.getTime()), 50)
})

test("dailyCapForMailbox returns the lowest cap on malformed input", () => {
  assert.equal(dailyCapForMailbox("not a date", "also not"), 10)
})

test("warmupDay floors to whole days", () => {
  assert.equal(warmupDay(0, 0), 0)
  assert.equal(warmupDay(0, 0.5 * DAY_MS), 0)
  assert.equal(warmupDay(0, 1 * DAY_MS), 1)
  assert.equal(warmupDay(0, 6.99 * DAY_MS), 6)
})

test("warmupLengthDays returns the last checkpoint day", () => {
  assert.equal(warmupLengthDays(), 60)
  assert.equal(
    warmupLengthDays([
      { day: 0, cap: 5 },
      { day: 10, cap: 50 },
    ]),
    10,
  )
})

test("isWarmupComplete flips at the final checkpoint", () => {
  assert.equal(isWarmupComplete(0, 0), false)
  assert.equal(isWarmupComplete(0, 30 * DAY_MS), false) // day 30, ramp ends day 60
  assert.equal(isWarmupComplete(0, 60 * DAY_MS), true)
  assert.equal(isWarmupComplete(0, 100 * DAY_MS), true)
})

test("DEFAULT_RAMP is monotonically non-decreasing", () => {
  for (let i = 1; i < DEFAULT_RAMP.length; i++) {
    assert.ok(
      DEFAULT_RAMP[i].day > DEFAULT_RAMP[i - 1].day,
      `day at index ${i} must increase`,
    )
    assert.ok(
      DEFAULT_RAMP[i].cap >= DEFAULT_RAMP[i - 1].cap,
      `cap at index ${i} must not decrease`,
    )
  }
})
