// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { assertNoSupabaseRls, assertReadOnlyForUsers, assertTenantScoped } from "./helpers/tenancy.ts"

const sql = readFileSync("db/migrations/0004_salesengai_phase8.sql", "utf8")

test("Phase 1 migration provides direct prospect ownership and deny-by-owner RLS", () => {
  assert.match(sql, /add column if not exists user_id uuid references public\.users/i)
  assert.match(sql, /set user_id = j\.user_id from public\.jobs/i)
  assert.match(sql, /alter column user_id set not null/i)
  assertTenantScoped("prospects")
})

test("Phase 1 migration prevents cross-user links and makes charges atomic", () => {
  assert.match(sql, /foreign key \(prospect_id, user_id\) references public\.prospects\(id, user_id\)/i)
  assert.match(sql, /for update/i)
  assert.match(sql, /credit_transactions_user_idempotency_key/i)
  assert.match(sql, /'Insufficient credits\.'/i)
})

test("approval scopes are one-use and immutable", () => {
  assert.match(sql, /create table if not exists public\.outreach_action_approvals/i)
  assert.match(sql, /confirmation_token_hash text not null/i)
  assert.match(sql, /prevent_approval_scope_mutation/i)
  assert.match(sql, /consumed_at is null or confirmed_at is not null/i)
})
