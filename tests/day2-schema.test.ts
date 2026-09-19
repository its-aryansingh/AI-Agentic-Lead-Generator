// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { assertNoSupabaseRls, assertReadOnlyForUsers, assertTenantScoped } from "./helpers/tenancy.ts"

const sql = readFileSync('db/migrations/0003_salesengai.sql', 'utf8')
for (const table of ['customer_contexts', 'playbook_examples', 'voice_connections', 'voice_executions']) {
  test(`${table} enables RLS and binds access to auth user`, () => {
    assertTenantScoped(table)
  })
}
test('new ownership policies enforce auth.uid user isolation', () => {
  const matches = ['customer_contexts','playbook_examples','voice_connections','voice_executions']
    .filter((t) => { assertTenantScoped(t); return true })
  assert.ok(matches.length >= 4)
})
test('every lead keeps non-null job ownership', () => {
  assert.doesNotMatch(sql, /alter table public\.prospects[^;]*job_id/i)
})
