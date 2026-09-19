// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

test("voice agent configuration is bounded and excludes unreviewed legal defaults", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  )
  assert.match(migration, /agent_management_mode in \('external', 'managed'\)/i)
  assert.match(migration, /default_language in \('en', 'hi', 'hinglish'\)/i)
  assert.match(migration, /max_call_seconds between 30 and 300/i)
  assert.match(migration, /max_turns between 2 and 30/i)
  assert.match(migration, /max_objection_attempts between 0 and 2/i)
  assert.doesNotMatch(migration, /recording_retention_days/i)
  assert.doesNotMatch(migration, /dlt|number_series|india.residen/i)
})

test("verified outbound caller IDs retain their Bolna inventory origin", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  )
  assert.match(migration, /from_phone_provider text/i)
  assert.match(migration, /from_phone_verified_at timestamptz/i)
  assert.match(migration, /from_phone_source in \('account', 'sip_trunk'\)/i)
})
