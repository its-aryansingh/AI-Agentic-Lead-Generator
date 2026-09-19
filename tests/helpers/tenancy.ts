/**
 * Tenancy assertions for a deployment with no Row Level Security.
 *
 * SalesEngAIMVP's schema tests assert `enable row level security` and
 * `auth.uid() = user_id` against the migration text. Neither can exist
 * here: Railway Postgres has no auth.uid(), and RLS enabled with zero
 * policies denies everything — a silent outage rather than a safe
 * default. db/migrations/0003 and 0004 therefore strip all 39 policies.
 *
 * The guarantee did not go away, it moved. lib/db/rls.ts holds the
 * ownership rules and lib/db/query-builder.ts injects them into every
 * user-scoped statement. These helpers point the same assertions at
 * that file, which makes them stronger here than the originals: a table
 * added to a migration without an rls.ts entry fails the suite instead
 * of silently failing closed in production.
 */

import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"

const rlsSource = readFileSync("lib/db/rls.ts", "utf8")

/** The table is owned through a user_id column, as its policy was. */
export function assertTenantScoped(table: string): void {
  assert.match(
    rlsSource,
    new RegExp(`^\\s*${table}:\\s*\\{\\s*kind:\\s*"column",\\s*column:\\s*"user_id"`, "m"),
    `${table} has no user_id ownership rule in lib/db/rls.ts — every ` +
      `user-scoped query against it would fail closed`,
  )
}

/** The table's original policy was `for select` only. */
export function assertReadOnlyForUsers(table: string): void {
  assertTenantScoped(table)
  assert.match(
    rlsSource,
    new RegExp(`^\\s*${table}:[^\\n]*readOnly:\\s*true`, "m"),
    `${table} must be marked readOnly in lib/db/rls.ts — its original ` +
      `policy was "for select", so a signed-in user must not write it`,
  )
}

/** The migration really did shed its Supabase-only constructs. */
export function assertNoSupabaseRls(migrationSql: string): void {
  // Strip -- comments first: the migration headers explain at length
  // which Supabase constructs were removed and why, and those sentences
  // necessarily contain the very phrases being asserted against.
  const sql = migrationSql.replace(/--[^\n]*/g, "")
  assert.doesNotMatch(sql, /auth\.uid\(\)/i, "auth.uid() does not exist on Railway")
  assert.doesNotMatch(sql, /create policy/i, "policies are replaced by lib/db/rls.ts")
  assert.doesNotMatch(
    sql,
    /enable row level security/i,
    "RLS with zero policies denies everything",
  )
}
