// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { assertNoSupabaseRls, assertReadOnlyForUsers, assertTenantScoped } from "./helpers/tenancy.ts"

const sql=fs.readFileSync(new URL('../db/migrations/0003_salesengai.sql',import.meta.url),'utf8').toLowerCase()

test('CRM credentials and sync records are user-isolated with RLS',()=>{
 for(const table of ['crm_connections','crm_syncs']){
  assertTenantScoped(table)
  // ownership asserted above, in lib/db/rls.ts
 }
})

test('CRM connections are unique per customer and provider',()=>{
 // 0003 reformats these tables; assert the constraint, not the spacing.
 assert.match(sql,/unique\s*\(\s*user_id\s*,\s*provider\s*\)/)
})

test('CRM sync is idempotent per connection and lead',()=>{
 assert.match(sql,/unique\s*\(\s*connection_id\s*,\s*prospect_id\s*\)/)
})

test('handoff fields are additive and push_to_crm is a valid next action',()=>{
 assert.match(sql,/add column if not exists handoff_summary/)
 assert.match(sql,/'push_to_crm'/)
})
