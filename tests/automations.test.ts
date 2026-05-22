/**
 * Automation scheduling math (pure core). Loads only automation-core.ts,
 * so it runs under `node --test --experimental-strip-types` without the
 * "@/" alias chain.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  computeNextRun,
  isDue,
  validateAutomation,
} from "../lib/automation-core.ts"

test("hourly schedule returns the top of the next hour", () => {
  const from = new Date("2026-05-23T10:15:30.000Z")
  const next = computeNextRun({ frequency: "hourly" }, from)
  assert.equal(next.toISOString(), "2026-05-23T11:00:00.000Z")
})

test("daily schedule returns today at the target hour when still ahead", () => {
  const from = new Date("2026-05-23T08:00:00.000Z")
  const next = computeNextRun({ frequency: "daily", hourUtc: 9 }, from)
  assert.equal(next.toISOString(), "2026-05-23T09:00:00.000Z")
})

test("daily schedule rolls to tomorrow once the hour has passed", () => {
  const from = new Date("2026-05-23T10:00:00.000Z")
  const next = computeNextRun({ frequency: "daily", hourUtc: 9 }, from)
  assert.equal(next.toISOString(), "2026-05-24T09:00:00.000Z")
})

test("weekly schedule lands on the requested day-of-week, in the future, at the hour", () => {
  const from = new Date("2026-05-23T10:00:00.000Z")
  const next = computeNextRun({ frequency: "weekly", hourUtc: 9, dayOfWeek: 1 }, from)
  assert.equal(next.getUTCDay(), 1, "is Monday")
  assert.equal(next.getUTCHours(), 9, "at 09:00 UTC")
  assert.ok(next.getTime() > from.getTime(), "strictly in the future")
})

test("isDue compares next_run_at against now", () => {
  const now = new Date("2026-05-23T12:00:00.000Z")
  assert.equal(isDue("2026-05-23T11:00:00.000Z", now), true)
  assert.equal(isDue("2026-05-23T13:00:00.000Z", now), false)
  assert.equal(isDue(null, now), false)
})

test("validateAutomation rejects thin input and accepts a real one", () => {
  assert.ok(validateAutomation({ name: "x", instruction: "find leads", frequency: "daily" }))
  assert.ok(validateAutomation({ name: "Weekly fintech", instruction: "go", frequency: "daily" }))
  assert.ok(validateAutomation({ name: "Weekly fintech", instruction: "find 20 fintech CMOs", frequency: "yearly" }))
  assert.equal(
    validateAutomation({
      name: "Weekly fintech push",
      instruction: "find 20 fintech CMOs in India and draft outreach",
      frequency: "weekly",
    }),
    null,
  )
})
