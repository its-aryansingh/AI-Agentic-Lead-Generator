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
test("AI credentials and preferences are isolated by RLS", () => {
  assertTenantScoped("ai_provider_connections");
  assertTenantScoped("ai_preferences");
  assertReadOnlyForUsers("ai_usage_events");
});
test("one encrypted connection exists per user and provider", () => {
  // Spacing differs from SalesEngAIMVP: 0003 reformats these tables.
  // Assert the column and its NOT NULL, not the whitespace.
  assert.match(sql, /encrypted_api_key\s+text\s+not null/);
  assert.match(sql, /unique\s*\(\s*user_id\s*,\s*provider\s*\)/);
});
test("AI usage audit excludes prompts and response bodies", () => {
  assert.match(sql, /operation\s+text\s+not null/);
  assert.match(sql, /input_tokens\s+int/);
  assert.doesNotMatch(sql, /prompt text|response_body|input_body/);
});
