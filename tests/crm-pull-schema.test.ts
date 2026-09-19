// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertNoSupabaseRls, assertReadOnlyForUsers, assertTenantScoped } from "./helpers/tenancy.ts"

const sql = readFileSync("db/migrations/0004_salesengai_phase8.sql", "utf8");
const correctiveSql = readFileSync("db/migrations/0004_salesengai_phase8.sql", "utf8");

test("CRM pull tables are tenant-owned, RLS protected, and link provider records idempotently", () => {
  assert.match(sql, /create table if not exists public\.crm_pull_runs/i);
  assert.match(sql, /create table if not exists public\.prospect_crm_links/i);
  assert.match(sql, /unique\(connection_id, provider_record_id\)/i);
  assert.match(sql, /foreign key \(prospect_id, user_id\) references public\.prospects\(id, user_id\)/i);
  assertTenantScoped("crm_pull_runs");
  assertTenantScoped("prospect_crm_links");
  assert.match(sql, /apply_crm_pull_contact/i);
});

test("CRM import matching remains tenant scoped and preserves populated fields", () => {
  assert.match(sql, /where user_id=p_user_id and email_hash=p_email_hash/i);
  assert.match(sql, /where user_id=p_user_id and phone_hash=p_phone_hash/i);
  assert.match(sql, /input_company=coalesce\(input_company,p_company\)/i);
  assert.match(sql, /on conflict\(connection_id,provider_record_id\) do update/i);
});

test("the forward-only RPC correction qualifies the CRM link prospect ID", () => {
  assert.match(correctiveSql, /select link\.prospect_id into v_prospect from prospect_crm_links link/i);
});
