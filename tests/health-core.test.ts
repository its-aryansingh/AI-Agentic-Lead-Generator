/**
 * health-core — pure helpers loaded directly under
 * `node --test --experimental-strip-types`. The route in
 * app/api/health/route.ts adds DB pings + filesystem reads on top.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import { getProviderMatrix, pickLatestMigration } from "../lib/health-core.ts"

test("getProviderMatrix returns false for every provider on an empty env", () => {
  const matrix = getProviderMatrix({})
  for (const v of Object.values(matrix)) assert.equal(v, false)
})

test("getProviderMatrix flips individual providers based on the right env vars", () => {
  const matrix = getProviderMatrix({
    ANTHROPIC_API_KEY: "sk-ant-xxx",
    BRAVE_SEARCH_KEY: "bs-yyy",
    NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "srv",
    HUBSPOT_API_KEY: "pat-zzz",
  })
  assert.equal(matrix.anthropic, true)
  assert.equal(matrix.brave, true)
  assert.equal(matrix.supabase, true)
  assert.equal(matrix.supabase_admin, true)
  assert.equal(matrix.hubspot, true)
  // Composite providers still false until BOTH halves are set.
  assert.equal(matrix.google, false)
  assert.equal(matrix.inngest, false)
  assert.equal(matrix.whatsapp, false)
  assert.equal(matrix.razorpay, false)
  assert.equal(matrix.stripe, false)
})

test("getProviderMatrix requires BOTH halves for composite providers", () => {
  const half = getProviderMatrix({ GOOGLE_CLIENT_ID: "id" })
  assert.equal(half.google, false)
  const both = getProviderMatrix({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" })
  assert.equal(both.google, true)
})

test("getProviderMatrix treats empty-string values as unset", () => {
  const matrix = getProviderMatrix({ ANTHROPIC_API_KEY: "" })
  assert.equal(matrix.anthropic, false)
})

test("pickLatestMigration returns null on empty input", () => {
  assert.equal(pickLatestMigration([]), null)
})

test("pickLatestMigration picks the highest numeric prefix", () => {
  const files = [
    "0001_init.sql",
    "0006_automations.sql",
    "0011_whatsapp_outreach.sql",
    "0002_sequences.sql",
    "README.md",
  ]
  assert.equal(pickLatestMigration(files), "0011_whatsapp_outreach.sql")
})

test("pickLatestMigration ignores non-.sql entries", () => {
  assert.equal(
    pickLatestMigration(["plan.md", "0001_init.sql", "0002_x.txt"]),
    "0001_init.sql",
  )
})

test("pickLatestMigration breaks ties by reverse lexicographic order", () => {
  // Same numeric prefix → pick the name that sorts later alphabetically.
  const files = ["0002_alpha.sql", "0002_omega.sql"]
  assert.equal(pickLatestMigration(files), "0002_omega.sql")
})

test("pickLatestMigration handles files without a numeric prefix", () => {
  // Files without a prefix get rank -1; any numbered file wins.
  assert.equal(
    pickLatestMigration(["readme.sql", "0001_init.sql"]),
    "0001_init.sql",
  )
})
