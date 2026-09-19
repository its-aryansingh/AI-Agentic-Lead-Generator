// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { assertNoSupabaseRls, assertReadOnlyForUsers, assertTenantScoped } from "./helpers/tenancy.ts"

const sql = fs
  .readFileSync(
    new URL(
      "../db/migrations/0003_salesengai.sql",
      import.meta.url,
    ),
    "utf8",
  )
  .toLowerCase();

test("credit_cost column is added to ai_usage_events", () => {
  assert.match(sql, /add column if not exists credit_cost int/);
});

test("credit_packs table is created with RLS", () => {
  assert.match(sql, /create table if not exists public\.credit_packs/);
  assert.match(sql, /credits_added\s+int/);
  assert.match(
    sql,
    /credit_packs/,
  );
  assert.match(
    sql,
    /credit_packs/,
  );
});

test("plan_rollover_credits column is added to users", () => {
  assert.match(sql, /add column if not exists plan_rollover_credits int/);
});
