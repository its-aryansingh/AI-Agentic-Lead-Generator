/**
 * Application-level row security.
 *
 * WHY THIS FILE EXISTS
 *
 * On Supabase, Row Level Security was the safety net: a query that forgot
 * its ownership predicate was still filtered by a policy on auth.uid().
 * Railway Postgres has no auth.uid() and no PostgREST role switching, so
 * those policies cannot fire.
 *
 * Deleting them and hand-adding a WHERE clause to ~70 call sites would
 * mean the security of this app rests on me having found every one. I
 * did not trust that, and a real audit of the codebase proved the worry
 * justified — these queries had NO user filter at all and relied entirely
 * on RLS:
 *
 *   app/api/analytics/route.ts   .from("jobs").select(...)        → every user's jobs
 *   app/api/export/csv/route.ts  .from("prospects").eq("job_id")  → any job's leads
 *   app/api/prospects/[id]       .update({stage}).eq("id", id)    → any prospect
 *
 * So instead of patching call sites, the ownership rules below are
 * transcribed from the actual `create policy` statements in
 * supabase/migrations, and the query builder injects them into the SQL
 * for every user-scoped client. A forgotten predicate is filtered exactly
 * as RLS filtered it, and existing call sites keep working unchanged.
 *
 * RULES FOR EDITING THIS FILE
 *  - A table with no entry is DENIED to user-scoped clients. Fail closed.
 *    Service-role tables (scrape_cache, webhook_events) belong in
 *    SERVICE_ONLY, which documents the choice rather than leaving a gap.
 *  - When you add a table with a user_id column, add it here in the same
 *    commit. There is no policy engine left to catch you.
 */

export type Ownership =
  /** The row carries the owner directly: <column> = <userId>. */
  | { kind: "column"; column: string }
  /**
   * Ownership lives on a parent row:
   *   exists (select 1 from <parentTable> p
   *            where p.<parentKey> = <table>.<localKey>
   *              and p.<parentOwner> = <userId>)
   */
  | { kind: "parent"; localKey: string; parentTable: string; parentKey: string; parentOwner: string }

/**
 * Transcribed 1:1 from the RLS policies in the Supabase schema.
 * Verified against `create policy` statements, not from memory.
 */
export const OWNERSHIP: Record<string, Ownership> = {
  // auth.uid() = id
  users: { kind: "column", column: "id" },

  // auth.uid() = user_id
  jobs: { kind: "column", column: "user_id" },
  chat_sessions: { kind: "column", column: "user_id" },
  credit_transactions: { kind: "column", column: "user_id" },
  campaigns: { kind: "column", column: "user_id" },
  mailboxes: { kind: "column", column: "user_id" },
  sequences: { kind: "column", column: "user_id" },
  automations: { kind: "column", column: "user_id" },
  automation_runs: { kind: "column", column: "user_id" },
  intent_triggers: { kind: "column", column: "user_id" },
  intent_watches: { kind: "column", column: "user_id" },
  suppressions: { kind: "column", column: "user_id" },
  data_subject_requests: { kind: "column", column: "user_id" },
  push_tokens: { kind: "column", column: "user_id" },
  enrichment_runs: { kind: "column", column: "user_id" },

  // These carry BOTH a user_id column and a parent-join policy. The
  // column is the tighter, cheaper check, so use it.
  campaign_recipients: { kind: "column", column: "user_id" },
  reply_classifications: { kind: "column", column: "user_id" },
  email_events: { kind: "column", column: "user_id" },

  // Ownership via a parent row.
  prospects: {
    kind: "parent",
    localKey: "job_id",
    parentTable: "jobs",
    parentKey: "id",
    parentOwner: "user_id",
  },
  chat_messages: {
    kind: "parent",
    localKey: "session_id",
    parentTable: "chat_sessions",
    parentKey: "id",
    parentOwner: "user_id",
  },
  prospect_candidates: {
    kind: "parent",
    localKey: "session_id",
    parentTable: "chat_sessions",
    parentKey: "id",
    parentOwner: "user_id",
  },
  sequence_steps: {
    kind: "parent",
    localKey: "sequence_id",
    parentTable: "sequences",
    parentKey: "id",
    parentOwner: "user_id",
  },
  sequence_enrollments: {
    kind: "parent",
    localKey: "sequence_id",
    parentTable: "sequences",
    parentKey: "id",
    parentOwner: "user_id",
  },
}

/**
 * Tables with no RLS policy in the original schema: they were reachable
 * only by the service role. Listed explicitly so "missing" and
 * "deliberately service-only" are distinguishable.
 */
export const SERVICE_ONLY = new Set(["scrape_cache", "webhook_events"])

export class RowSecurityError extends Error {
  readonly code = "ROW_SECURITY_DENIED"
  constructor(table: string) {
    super(
      `Table "${table}" has no ownership rule in lib/db/rls.ts, so a ` +
        `user-scoped client cannot touch it. Add an OWNERSHIP entry, or use ` +
        `createAdminClient() if this is genuinely service-role-only.`,
    )
    this.name = "RowSecurityError"
  }
}

/**
 * Builds the SQL predicate that replaces the RLS policy.
 * `push` registers a parameter and returns its $n placeholder.
 */
export function ownershipPredicate(
  table: string,
  userId: string,
  push: (value: unknown) => string,
): string {
  const rule = OWNERSHIP[table]

  if (!rule) {
    // Fail closed. A table nobody thought about must not be readable.
    throw new RowSecurityError(table)
  }

  if (rule.kind === "column") {
    return `"${table}"."${rule.column}" = ${push(userId)}`
  }

  return (
    `exists (select 1 from public."${rule.parentTable}" __p ` +
    `where __p."${rule.parentKey}" = "${table}"."${rule.localKey}" ` +
    `and __p."${rule.parentOwner}" = ${push(userId)})`
  )
}

/**
 * For INSERT: the equivalent of a policy's WITH CHECK. A row whose
 * ownership column disagrees with the session user is rejected before it
 * reaches the database, and a parent-owned row is verified by a lookup.
 */
export function insertOwnershipCheck(
  table: string,
  row: Record<string, unknown>,
  userId: string,
): { ok: true; row: Record<string, unknown> } | { ok: false; reason: string } {
  const rule = OWNERSHIP[table]
  if (!rule) return { ok: false, reason: new RowSecurityError(table).message }

  if (rule.kind === "column") {
    const current = row[rule.column]
    if (current === undefined || current === null) {
      // Stamp it, exactly as a WITH CHECK policy would force you to.
      return { ok: true, row: { ...row, [rule.column]: userId } }
    }
    if (current !== userId) {
      return {
        ok: false,
        reason: `row security: ${table}.${rule.column} must be the session user`,
      }
    }
    return { ok: true, row }
  }

  // Parent-owned rows are checked by the SQL guard in the builder; the
  // local key simply has to be present.
  if (row[rule.localKey] === undefined || row[rule.localKey] === null) {
    return { ok: false, reason: `row security: ${table}.${rule.localKey} is required` }
  }
  return { ok: true, row }
}
