/**
 * run-service.ts — enrichment_runs lifecycle + ownership. Railway Postgres.
 *
 * No Supabase. Every call is SQL through lib/db.ts.
 *
 * OWNERSHIP IS NOW LOAD-BEARING IN THIS FILE.
 * Under Supabase, RLS was a second line of defence behind these queries.
 * On Railway there is no auth.uid() and no policy engine, so the WHERE
 * clauses below plus the re-check inside complete_enrichment_run() are the
 * only things preventing cross-tenant reads and writes.
 *
 * public.prospects has NO user_id column. Ownership is always
 *   prospects.job_id -> jobs.id -> jobs.user_id
 * Every statement here joins jobs. Do not add one that doesn't.
 */

import crypto from "node:crypto"

import { isUniqueViolation, query, queryOne } from "@/lib/db"
import {
  EnrichmentError,
  type EnrichmentRun,
  type EnrichmentRunStatus,
  type PublicContacts,
} from "./types"

// ---------------------------------------------------------------------
// Domain normalization
// ---------------------------------------------------------------------

export function normalizeCompanyDomain(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null

  let host: string
  try {
    host = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`).hostname
  } catch {
    return null
  }

  host = host.replace(/^www\./, "").replace(/\.$/, "")
  if (!host.includes(".") || !/^[a-z0-9.-]+$/.test(host)) return null
  if (host.length > 253) return null
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null

  return host
}

/**
 * Stable idempotency key: same prospect + domain + UTC day collapses a
 * double-clicked button, a retried webhook and the reconciliation cron
 * into one run.
 */
export function buildIdempotencyKey(prospectId: string, domain: string, bucket?: string): string {
  const day = bucket ?? new Date().toISOString().slice(0, 10)
  return crypto
    .createHash("sha256")
    .update(`${prospectId}:${domain}:${day}`)
    .digest("hex")
    .slice(0, 40)
}

// ---------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------

export interface OwnedProspect {
  id: string
  job_id: string
  company_domain: string | null
  input_company: string | null
  email: string | null
  email_source: string | null
  phone: string | null
}

/** Returns the prospect only if it belongs to `userId` via its job. */
export async function loadOwnedProspect(
  prospectId: string,
  userId: string,
): Promise<OwnedProspect | null> {
  return queryOne<OwnedProspect>(
    `select p.id, p.job_id, p.company_domain, p.input_company,
            p.email, p.email_source, p.phone
       from public.prospects p
       join public.jobs j on j.id = p.job_id
      where p.id = $1
        and j.user_id = $2`,
    [prospectId, userId],
  )
}

// ---------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------

const RUN_COLUMNS = `id, user_id, prospect_id, domain, idempotency_key,
                     status, attempt, created_at`

export interface CreateRunResult {
  run: EnrichmentRun
  /** false when an existing run was returned instead of a new one. */
  created: boolean
}

/**
 * Insert-or-return. The unique index on (user_id, idempotency_key) is the
 * concurrency control: two simultaneous requests race on the index, the
 * loser reads the winner's row, and only one crawl is ever queued.
 *
 * `on conflict do nothing` returns zero rows for the loser, which is how
 * we detect the race without a round-trip.
 */
export async function createOrGetRun(params: {
  userId: string
  prospectId: string
  domain: string
  idempotencyKey: string
}): Promise<CreateRunResult> {
  const { userId, prospectId, domain, idempotencyKey } = params

  let inserted: EnrichmentRun | null = null
  try {
    inserted = await queryOne<EnrichmentRun>(
      `insert into public.enrichment_runs
         (user_id, prospect_id, domain, idempotency_key, status)
       values ($1, $2, $3, $4, 'queued')
       on conflict (user_id, idempotency_key) do nothing
       returning ${RUN_COLUMNS}`,
      [userId, prospectId, domain, idempotencyKey],
    )
  } catch (err) {
    if (!isUniqueViolation(err)) {
      throw new EnrichmentError(
        "DB_WRITE_FAILED",
        `Could not create run: ${(err as Error).message}`,
        true,
      )
    }
  }

  if (inserted) {
    await query(
      `update public.prospects
          set enrichment_status = 'queued', enrichment_run_id = $1
        where id = $2`,
      [inserted.id, prospectId],
    )
    return { run: inserted, created: true }
  }

  const existing = await queryOne<EnrichmentRun>(
    `select ${RUN_COLUMNS} from public.enrichment_runs
      where user_id = $1 and idempotency_key = $2`,
    [userId, idempotencyKey],
  )

  if (!existing) {
    throw new EnrichmentError(
      "DB_WRITE_FAILED",
      "Run insert conflicted but no existing row was found",
      true,
    )
  }

  return { run: existing, created: false }
}

/** Marks the run running and bumps the attempt counter (retry-safe). */
export async function markRunStarted(runId: string, userId: string): Promise<number> {
  const row = await queryOne<{ attempt: number; prospect_id: string }>(
    `update public.enrichment_runs
        set status = 'running',
            attempt = attempt + 1,
            started_at = now()
      where id = $1 and user_id = $2
      returning attempt, prospect_id`,
    [runId, userId],
  )

  if (!row) {
    throw new EnrichmentError("DB_WRITE_FAILED", `Run ${runId} not found for user`, false)
  }

  await query(
    `update public.prospects
        set enrichment_status = 'running', enrichment_run_id = $1
      where id = $2`,
    [runId, row.prospect_id],
  )

  return row.attempt
}

export async function getRun(runId: string, userId: string): Promise<EnrichmentRun | null> {
  return queryOne<EnrichmentRun>(
    `select ${RUN_COLUMNS} from public.enrichment_runs where id = $1 and user_id = $2`,
    [runId, userId],
  )
}

export async function getLatestRunForProspect(
  prospectId: string,
  userId: string,
): Promise<EnrichmentRun | null> {
  return queryOne<EnrichmentRun>(
    `select ${RUN_COLUMNS} from public.enrichment_runs
      where prospect_id = $1 and user_id = $2
      order by created_at desc
      limit 1`,
    [prospectId, userId],
  )
}

// ---------------------------------------------------------------------
// Completion — the only write path onto prospects
// ---------------------------------------------------------------------

export interface CompleteRunParams {
  runId: string
  userId: string
  prospectId: string
  status: Extract<EnrichmentRunStatus, "succeeded" | "failed" | "skipped">
  contacts?: PublicContacts | null
  primary?: { email: string | null; phone: string | null; phone_e164: string | null }
  pagesCrawled?: number
  model?: string | null
  promptTokens?: number
  completionTokens?: number
  costPaise?: number
  errorCode?: string | null
  errorDetail?: string | null
}

export async function completeRun(params: CompleteRunParams): Promise<void> {
  const c = params.contacts ?? null

  try {
    await query(
      `select * from public.complete_enrichment_run(
         p_run_id            => $1,
         p_user_id           => $2,
         p_prospect_id       => $3,
         p_status            => $4,
         p_email             => $5,
         p_phone             => $6,
         p_phone_e164        => $7,
         p_public_contacts   => $8::jsonb,
         p_source_urls       => $9::jsonb,
         p_pages_crawled     => $10,
         p_emails_found      => $11,
         p_phones_found      => $12,
         p_contacts_found    => $13,
         p_model             => $14,
         p_prompt_tokens     => $15,
         p_completion_tokens => $16,
         p_cost_paise        => $17,
         p_error_code        => $18,
         p_error_detail      => $19
       )`,
      [
        params.runId,
        params.userId,
        params.prospectId,
        params.status,
        params.primary?.email ?? null,
        params.primary?.phone ?? null,
        params.primary?.phone_e164 ?? null,
        c ? JSON.stringify(c) : null,
        JSON.stringify(c?.source_urls ?? []),
        params.pagesCrawled ?? 0,
        c?.emails.length ?? 0,
        c?.phones.length ?? 0,
        c?.key_contacts.length ?? 0,
        params.model ?? null,
        params.promptTokens ?? 0,
        params.completionTokens ?? 0,
        params.costPaise ?? 0,
        params.errorCode ?? null,
        params.errorDetail?.slice(0, 500) ?? null,
      ],
    )
  } catch (err) {
    // Unlike the legacy bulk-enrich worker (which ignores its insert error
    // and can mark a job completed with zero rows), a failed write here
    // must fail the step so Inngest retries or surfaces it.
    throw new EnrichmentError(
      "DB_WRITE_FAILED",
      `complete_enrichment_run failed: ${(err as Error).message}`,
      true,
    )
  }
}

/** Reconciliation cron: runs that never started or never finished. */
export async function findStuckRuns(olderThanMinutes = 5, limit = 50): Promise<EnrichmentRun[]> {
  return query<EnrichmentRun>(
    `select ${RUN_COLUMNS} from public.enrichment_runs
      where status in ('queued','running')
        and created_at < now() - make_interval(mins => $1)
      order by created_at asc
      limit $2`,
    [olderThanMinutes, limit],
  )
}
