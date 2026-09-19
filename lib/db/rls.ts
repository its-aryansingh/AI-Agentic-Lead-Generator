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

type OwnershipShape =
  /** The row carries the owner directly: <column> = <userId>. */
  | { kind: "column"; column: string }
  /**
   * Ownership lives on a parent row:
   *   exists (select 1 from <parentTable> p
   *            where p.<parentKey> = <table>.<localKey>
   *              and p.<parentOwner> = <userId>)
   */
  | { kind: "parent"; localKey: string; parentTable: string; parentKey: string; parentOwner: string }

export type Ownership = OwnershipShape & {
  /**
   * The original policy was `for select` only — the owner may read the
   * row but never write it, because the rows are produced by
   * server-side code holding the service client (a webhook, a cron, a
   * usage meter). Dropping this distinction would silently let a
   * signed-in user forge their own audit trail.
   *
   * Enforced in lib/db/query-builder.ts, which refuses
   * insert/upsert/update/delete on a read-only table for any
   * user-scoped client. createAdminClient() is unaffected, which is
   * exactly how the service role behaved under RLS.
   */
  readOnly?: true
}

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

  // prospects USED to be parent-owned through jobs. db/migrations/
  // 0004_salesengai_phase8.sql adds prospects.user_id, backfills it from
  // jobs and makes it NOT NULL, because the composite key
  // prospects(id, user_id) is what pins every child row — voice
  // executions, qualification facts, CRM syncs, campaign recipients — to
  // one tenant in the database rather than in application code.
  //
  // So ownership moves to the column: tighter, one less join per query,
  // and exactly what that migration's own `create policy "own prospects"`
  // declared. The two changed in the same commit and must stay together —
  // reverting one without the other is a cross-tenant leak.
  prospects: { kind: "column", column: "user_id" },

  // Ownership via a parent row.
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

  // -------------------------------------------------------------------
  // Ported from SalesEngAIMVP — transcribed from the `create policy`
  // statements in its Supabase migrations, which db/migrations/
  // 0003_salesengai.sql drops. Every one of them was
  // `auth.uid() = user_id`; the three marked readOnly were
  // `for select` rather than `for all`.
  // -------------------------------------------------------------------

  // own_customer_context — for all using(auth.uid()=user_id)
  // user_id is the primary key here, not just a column.
  customer_contexts: { kind: "column", column: "user_id" },

  // own_playbook_examples — for all
  playbook_examples: { kind: "column", column: "user_id" },

  // own_voice_connections — for all. Holds encrypted_api_key, so a
  // missing predicate here leaks a customer's Bolna credentials.
  voice_connections: { kind: "column", column: "user_id" },

  // own_voice_executions — for all. Holds call transcripts.
  voice_executions: { kind: "column", column: "user_id" },

  // "own gmail inbound events" — for SELECT only. Written by the
  // detect-replies cron through the service client.
  gmail_inbound_events: { kind: "column", column: "user_id", readOnly: true },

  // "own qualification facts" — for all
  lead_qualification_facts: { kind: "column", column: "user_id" },

  // own_phone_suppressions — for all. A do-not-call list: treat a leak
  // here as a compliance incident, not a data one.
  phone_suppressions: { kind: "column", column: "user_id" },

  // own_crm_connections — for all. Holds encrypted_credentials.
  crm_connections: { kind: "column", column: "user_id" },

  // own_crm_syncs — for all
  crm_syncs: { kind: "column", column: "user_id" },

  // own_ai_provider_connections — for all. Holds encrypted_api_key.
  ai_provider_connections: { kind: "column", column: "user_id" },

  // own_ai_preferences — for all. user_id is the primary key.
  ai_preferences: { kind: "column", column: "user_id" },

  // own_ai_usage_events — for SELECT only. This is the billing audit
  // trail; the meter writes it with the service client.
  ai_usage_events: { kind: "column", column: "user_id", readOnly: true },

  // own_credit_packs — for SELECT only. Purchase history is written by
  // the Stripe/Razorpay webhook, never by the signed-in user.
  credit_packs: { kind: "column", column: "user_id", readOnly: true },

  // -------------------------------------------------------------------
  // Ported from the SalesEngAIMVP voice-lifecycle, autonomous-outreach,
  // CRM-pull and Phase 8 work — transcribed from the 26 `create policy`
  // statements that db/migrations/0004_salesengai_phase8.sql drops. All
  // were `auth.uid() = user_id`; the two marked readOnly were `for
  // select` only.
  // -------------------------------------------------------------------

  // own_outreach_schedules / _runs / _run_items — for all
  outreach_schedules: { kind: "column", column: "user_id" },
  outreach_runs: { kind: "column", column: "user_id" },
  outreach_run_items: { kind: "column", column: "user_id" },

  // own_outreach_action_approvals — for all. An approval is what
  // authorises an autonomous send or call, so a forged row here is the
  // whole safety gate.
  outreach_action_approvals: { kind: "column", column: "user_id" },

  // own_lead_state_events / own_lead_followups — for all
  lead_state_events: { kind: "column", column: "user_id" },
  lead_followups: { kind: "column", column: "user_id" },

  // own_lead_handoffs / own_lead_handoff_notification_outbox — for all
  lead_handoffs: { kind: "column", column: "user_id" },
  lead_handoff_notification_outbox: { kind: "column", column: "user_id" },

  // own_crm_pull_runs / own_prospect_crm_links — for all
  crm_pull_runs: { kind: "column", column: "user_id" },
  prospect_crm_links: { kind: "column", column: "user_id" },

  // own_voice_action_requests — for all
  voice_action_requests: { kind: "column", column: "user_id" },

  // own_calendar_connections — for all. Holds OAuth credentials.
  calendar_connections: { kind: "column", column: "user_id" },

  // own_voice_compliance_decisions_select — for SELECT only. This is the
  // record of why a call was allowed or refused; the compliance code
  // writes it with the service client. A user who could insert here
  // could manufacture their own consent trail.
  voice_compliance_decisions: { kind: "column", column: "user_id", readOnly: true },

  // own_voice_call_override_audits — for SELECT only, and the migration
  // additionally installs a trigger making the rows immutable. This is
  // the record of a human overriding a calling restriction.
  voice_call_override_audits: { kind: "column", column: "user_id", readOnly: true },
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

/**
 * For a user-scoped client, is this table write-protected?
 *
 * Returns the refusal message when the table's original policy was
 * `for select` only, and null when writing is allowed. Unknown tables
 * are handled by ownershipPredicate / insertOwnershipCheck, which fail
 * closed on their own.
 */
export function writeDenied(table: string): string | null {
  const rule = OWNERSHIP[table]
  if (!rule?.readOnly) return null
  return (
    `row security: ${table} is read-only for a signed-in user (the ` +
    `original policy was "for select"). Write it with createAdminClient().`
  )
}

/**
 * Functions a user-scoped client may not call.
 *
 * On Supabase these carried
 *     revoke all on function ... from public, anon, authenticated;
 *     grant execute on function ... to service_role;
 * so PostgREST refused them to a signed-in user. 0004 strips those
 * statements because anon/authenticated/service_role do not exist on
 * Railway — but what they expressed still holds. These functions move
 * credits, claim queue work and reserve outbound calls; every one is
 * reached from server-side code that legitimately holds the admin
 * client, and none should be callable with a session cookie.
 *
 * Railway runs every query as one database user, so the database cannot
 * make this distinction any more. lib/supabase/server.ts enforces it
 * instead: createClient().rpc() refuses these, createAdminClient().rpc()
 * does not. Add a service-role function to a migration and add it here
 * in the same commit.
 */
export const SERVICE_ONLY_RPC = new Set([
  "apply_crm_pull_contact",
  "begin_crm_pull_run",
  "claim_campaign_recipients",
  "claim_handoff_notifications",
  "claim_outreach_items",
  "deduct_credits_atomic",
  "list_due_outreach_runs",
  "reserve_voice_execution",
])

/** Refusal message when a user-scoped client calls a service-only function. */
export function rpcDenied(fn: string): string | null {
  if (!SERVICE_ONLY_RPC.has(fn)) return null
  return (
    `row security: public.${fn}() is service-role only (it was revoked ` +
    `from "authenticated" under Supabase). Call it with createAdminClient().`
  )
}
