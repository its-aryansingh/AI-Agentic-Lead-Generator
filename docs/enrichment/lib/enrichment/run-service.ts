/**
 * run-service.ts — enrichment_runs lifecycle + ownership.
 *
 * Every function here re-derives ownership through
 * prospects.job_id -> jobs.user_id, because public.prospects has NO
 * user_id column and the worker uses the service-role client (which
 * bypasses RLS). A missing ownership predicate here is a cross-tenant
 * write, so it is asserted in one place rather than at each call site.
 */

import crypto from "node:crypto"

import { createAdminClient } from "@/lib/supabase/server"
import {
  EnrichmentError,
  type EnrichmentRun,
  type EnrichmentRunStatus,
  type PublicContacts,
} from "./types"

// ---------------------------------------------------------------------
// Domain normalization (mirrors the crawler's, without the DNS check)
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

  // Bare IPs are never a company domain.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null

  return host
}

/**
 * Stable idempotency key. The same prospect + domain + UTC day maps to
 * one run, so a double-clicked button, a retried webhook and a
 * reconciliation cron all collapse into a single crawl.
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

/**
 * Loads a prospect only if it belongs to `userId` via its job.
 * Returns null rather than throwing so callers can answer 404.
 */
export async function loadOwnedProspect(
  prospectId: string,
  userId: string,
): Promise<OwnedProspect | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("prospects")
    .select("id,job_id,company_domain,input_company,email,email_source,phone,jobs!inner(user_id)")
    .eq("id", prospectId)
    .eq("jobs.user_id", userId)
    .maybeSingle()

  if (error || !data) return null

  return {
    id: data.id as string,
    job_id: data.job_id as string,
    company_domain: (data.company_domain as string | null) ?? null,
    input_company: (data.input_company as string | null) ?? null,
    email: (data.email as string | null) ?? null,
    email_source: (data.email_source as string | null) ?? null,
    phone: (data.phone as string | null) ?? null,
  }
}

// ---------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------

export interface CreateRunResult {
  run: EnrichmentRun
  /** false when an existing run was returned instead of a new one. */
  created: boolean
}

/**
 * Insert-or-return. The unique index on (user_id, idempotency_key) is
 * the concurrency control: two simultaneous requests race on the index,
 * the loser reads the winner's row, and only one crawl is ever queued.
 */
export async function createOrGetRun(params: {
  userId: string
  prospectId: string
  domain: string
  idempotencyKey: string
}): Promise<CreateRunResult> {
  const supabase = createAdminClient()

  const { data: inserted, error } = await supabase
    .from("enrichment_runs")
    .insert({
      user_id: params.userId,
      prospect_id: params.prospectId,
      domain: params.domain,
      idempotency_key: params.idempotencyKey,
      status: "queued",
    })
    .select("id,user_id,prospect_id,domain,idempotency_key,status,attempt,created_at")
    .maybeSingle()

  if (inserted) {
    await supabase
      .from("prospects")
      .update({ enrichment_status: "queued", enrichment_run_id: inserted.id })
      .eq("id", params.prospectId)

    return { run: inserted as unknown as EnrichmentRun, created: true }
  }

  // 23505 = unique_violation on the idempotency index: someone beat us.
  if (error && error.code !== "23505") {
    throw new EnrichmentError("DB_WRITE_FAILED", `Could not create run: ${error.message}`, true)
  }

  const { data: existing } = await supabase
    .from("enrichment_runs")
    .select("id,user_id,prospect_id,domain,idempotency_key,status,attempt,created_at")
    .eq("user_id", params.userId)
    .eq("idempotency_key", params.idempotencyKey)
    .maybeSingle()

  if (!existing) {
    throw new EnrichmentError(
      "DB_WRITE_FAILED",
      "Run insert conflicted but no existing row was found",
      true,
    )
  }

  return { run: existing as unknown as EnrichmentRun, created: false }
}

/** Marks the run running and bumps the attempt counter (retry-safe). */
export async function markRunStarted(runId: string, userId: string): Promise<number> {
  const supabase = createAdminClient()

  const { data: current } = await supabase
    .from("enrichment_runs")
    .select("attempt,prospect_id")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle()

  if (!current) {
    throw new EnrichmentError("DB_WRITE_FAILED", `Run ${runId} not found for user`, false)
  }

  const attempt = ((current.attempt as number | undefined) ?? 0) + 1

  await supabase
    .from("enrichment_runs")
    .update({ status: "running", attempt, started_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("user_id", userId)

  await supabase
    .from("prospects")
    .update({ enrichment_status: "running", enrichment_run_id: runId })
    .eq("id", current.prospect_id as string)

  return attempt
}

export async function getRun(runId: string, userId: string): Promise<EnrichmentRun | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("enrichment_runs")
    .select("id,user_id,prospect_id,domain,idempotency_key,status,attempt,created_at")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle()
  return (data as unknown as EnrichmentRun) ?? null
}

export async function getLatestRunForProspect(
  prospectId: string,
  userId: string,
): Promise<EnrichmentRun | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("enrichment_runs")
    .select("id,user_id,prospect_id,domain,idempotency_key,status,attempt,created_at")
    .eq("prospect_id", prospectId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as unknown as EnrichmentRun) ?? null
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
  const supabase = createAdminClient()
  const c = params.contacts ?? null

  const { error } = await supabase.rpc("complete_enrichment_run", {
    p_run_id: params.runId,
    p_user_id: params.userId,
    p_prospect_id: params.prospectId,
    p_status: params.status,
    p_email: params.primary?.email ?? null,
    p_phone: params.primary?.phone ?? null,
    p_phone_e164: params.primary?.phone_e164 ?? null,
    p_public_contacts: c,
    p_source_urls: c?.source_urls ?? [],
    p_pages_crawled: params.pagesCrawled ?? 0,
    p_emails_found: c?.emails.length ?? 0,
    p_phones_found: c?.phones.length ?? 0,
    p_contacts_found: c?.key_contacts.length ?? 0,
    p_model: params.model ?? null,
    p_prompt_tokens: params.promptTokens ?? 0,
    p_completion_tokens: params.completionTokens ?? 0,
    p_cost_paise: params.costPaise ?? 0,
    p_error_code: params.errorCode ?? null,
    p_error_detail: params.errorDetail?.slice(0, 500) ?? null,
  })

  // Unlike the current bulk-enrich worker (which ignores its insert
  // error and can mark a job completed with zero rows), a failed write
  // here must fail the step so Inngest retries or surfaces it.
  if (error) {
    throw new EnrichmentError(
      "DB_WRITE_FAILED",
      `complete_enrichment_run failed: ${error.message}`,
      true,
    )
  }
}

/** Reconciliation cron: runs that never started or never finished. */
export async function findStuckRuns(olderThanMinutes = 5, limit = 50): Promise<EnrichmentRun[]> {
  const supabase = createAdminClient()
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString()

  const { data } = await supabase
    .from("enrichment_runs")
    .select("id,user_id,prospect_id,domain,idempotency_key,status,attempt,created_at")
    .in("status", ["queued", "running"])
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit)

  return (data as unknown as EnrichmentRun[]) ?? []
}
