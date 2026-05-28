/**
 * Orchestration registry invariants + mock detection.
 *
 * Imports only the import-free core (orchestration-core.ts) so it loads
 * under `node --test --experimental-strip-types` without "@/" alias support.
 * These guard against registry drift and the critical send-safety invariant
 * (only the Outreach specialist can reach launch_campaign).
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  SPECIALIST_META,
  SPECIALIST_NAMES,
  outputLooksMock,
} from "../lib/agent/orchestration-core.ts"

test("registry has exactly the five expected specialists", () => {
  assert.deepEqual(
    [...SPECIALIST_NAMES].sort(),
    ["compliance", "copywriter", "outreach", "prospector", "researcher"],
  )
})

test("every specialist has role, emoji, prompt, and a sane step cap", () => {
  for (const name of SPECIALIST_NAMES) {
    const meta = SPECIALIST_META[name]
    assert.ok(meta.role.length > 0, `${name} role`)
    assert.ok(meta.emoji.length > 0, `${name} emoji`)
    assert.ok(meta.systemPrompt.length > 50, `${name} prompt`)
    assert.ok(meta.maxSteps >= 1 && meta.maxSteps <= 6, `${name} maxSteps`)
  }
})

test("roles and emojis are unique across the team", () => {
  const roles = new Set(SPECIALIST_NAMES.map((n) => SPECIALIST_META[n].role))
  const emojis = new Set(SPECIALIST_NAMES.map((n) => SPECIALIST_META[n].emoji))
  assert.equal(roles.size, SPECIALIST_NAMES.length)
  assert.equal(emojis.size, SPECIALIST_NAMES.length)
})

test("reasoning-only specialists expose no tools", () => {
  assert.deepEqual(SPECIALIST_META.copywriter.toolNames, [])
  assert.deepEqual(SPECIALIST_META.compliance.toolNames, [])
})

test("tool-using specialists expose the right tool subsets", () => {
  assert.deepEqual(SPECIALIST_META.prospector.toolNames, [
    "web_search",
    "public_source_search",
    "add_named_prospects",
  ])
  assert.deepEqual(SPECIALIST_META.researcher.toolNames, ["enrich_prospect"])
  assert.deepEqual(SPECIALIST_META.outreach.toolNames, [
    "start_bulk_job",
    "launch_campaign",
    "push_to_crm",
    "draft_reply",
  ])
})

test("draft_reply is reachable by exactly one specialist (outreach)", () => {
  const owners = SPECIALIST_NAMES.filter((n) =>
    SPECIALIST_META[n].toolNames.includes("draft_reply"),
  )
  assert.deepEqual(owners, ["outreach"])
})

test("push_to_crm is reachable by exactly one specialist (outreach)", () => {
  const owners = SPECIALIST_NAMES.filter((n) =>
    SPECIALIST_META[n].toolNames.includes("push_to_crm"),
  )
  assert.deepEqual(owners, ["outreach"])
})

test("launch_campaign is reachable by exactly one specialist (outreach)", () => {
  const owners = SPECIALIST_NAMES.filter((n) =>
    SPECIALIST_META[n].toolNames.includes("launch_campaign"),
  )
  assert.deepEqual(owners, ["outreach"])
})

test("outputLooksMock detects provider demo flags and ignores real output", () => {
  assert.equal(outputLooksMock({ using_mock_data: true }), true)
  assert.equal(outputLooksMock({ sheet_is_mock: true }), true)
  assert.equal(outputLooksMock({ source: "mock" }), true)
  assert.equal(outputLooksMock({ count: 3, source: "brave" }), false)
  assert.equal(outputLooksMock(null), false)
  assert.equal(outputLooksMock("nope"), false)
  assert.equal(outputLooksMock(undefined), false)
})
