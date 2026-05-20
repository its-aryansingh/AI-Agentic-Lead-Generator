/**
 * Concrete implementations of each chat tool.
 *
 * These run server-side inside the streaming /api/chat route. They use
 * the service-role Supabase client so they can write across RLS — the
 * userId is passed in from the request handler after auth.
 */

import { createAdminClient } from "@/lib/supabase/server"
import { discoverProspects, type ProspectCandidate } from "@/lib/providers/brave-search"
import { draftForProspect } from "@/lib/providers/anthropic"
import { exportToSheet, rowsToCsv } from "@/lib/providers/google-sheets"
import { searchGithubUsers } from "@/lib/providers/github"
import { searchHnUsers } from "@/lib/providers/hn-algolia"
import { getOrSetCache } from "@/lib/cache"
import { bestGuessEmail, guessDomainFromCompany } from "@/lib/email-patterns"
import { checkCredits, deductCredits } from "@/lib/credits"

import type { ToolContext } from "./tools"

// ---------------------------------------------------------------------
// web_search
// ---------------------------------------------------------------------

export async function handleWebSearch(
  params: {
    query: string
    target_role?: string
    industry?: string
    location?: string
    max_results: number
  },
  ctx: ToolContext,
) {
  const cacheKey = `brave:${params.query}:${params.max_results}`
  const candidates = await getOrSetCache(cacheKey, 7 * 86_400, () =>
    discoverProspects(params),
  )

  // Persist candidates so a later start_bulk_job can reference them by ID.
  const supabase = createAdminClient()
  const inserted: Array<{ id: string; candidate: ProspectCandidate }> = []

  if (candidates.length > 0) {
    const rows = candidates.map((c) => ({
      session_id: ctx.sessionId,
      source: c.source,
      source_ref: c.source_url,
      preview: c as unknown as Record<string, unknown>,
    }))
    const { data, error } = await supabase
      .from("prospect_candidates")
      .insert(rows)
      .select("id,preview")
    if (!error && data) {
      for (const row of data) {
        inserted.push({
          id: row.id as string,
          candidate: row.preview as unknown as ProspectCandidate,
        })
      }
    }
  }

  return {
    count: candidates.length,
    candidates: inserted.length > 0
      ? inserted.map((r) => ({ id: r.id, ...r.candidate }))
      : candidates.map((c) => ({ id: null, ...c })),
    using_mock_data: candidates[0]?.source === "mock",
  }
}

// ---------------------------------------------------------------------
// public_source_search — vertical-specific discovery.
// GitHub is implemented; ProductHunt + HN Algolia are still stubbed.
// ---------------------------------------------------------------------

export async function handlePublicSourceSearch(
  params: { source: string; query: string; max_results: number },
  ctx: ToolContext,
) {
  // Fan out to the right provider — both implementations return a
  // ProspectCandidate[] so the persistence path can stay shared.
  let candidates: ProspectCandidate[] = []
  let dbSource: "github" | "hn" | null = null

  if (params.source === "github") {
    dbSource = "github"
    const cacheKey = `github:${params.query}:${params.max_results}`
    candidates = await getOrSetCache(cacheKey, 7 * 86_400, () =>
      searchGithubUsers(params.query, params.max_results),
    )
  } else if (params.source === "hn_algolia") {
    dbSource = "hn"
    const cacheKey = `hn:${params.query}:${params.max_results}`
    candidates = await getOrSetCache(cacheKey, 1 * 86_400, () =>
      searchHnUsers(params.query, params.max_results),
    )
  } else {
    return {
      count: 0,
      candidates: [],
      note: `Public-source search via ${params.source} is on the v1.5 roadmap — only "github" and "hn_algolia" are wired up right now.`,
    }
  }

  // Persist for downstream start_bulk_job (mirrors handleWebSearch).
  const supabase = createAdminClient()
  const inserted: Array<{ id: string; candidate: ProspectCandidate }> = []
  if (candidates.length > 0) {
    const rows = candidates.map((c) => ({
      session_id: ctx.sessionId,
      source: dbSource!,
      source_ref: c.source_url,
      preview: c as unknown as Record<string, unknown>,
    }))
    const { data } = await supabase
      .from("prospect_candidates")
      .insert(rows)
      .select("id,preview")
    if (data) {
      for (const row of data) {
        inserted.push({
          id: row.id as string,
          candidate: row.preview as unknown as ProspectCandidate,
        })
      }
    }
  }

  return {
    count: candidates.length,
    candidates:
      inserted.length > 0
        ? inserted.map((r) => ({ id: r.id, ...r.candidate }))
        : candidates.map((c) => ({ id: null, ...c })),
    source: dbSource,
  }
}

// ---------------------------------------------------------------------
// enrich_prospect — single named lookup, returns inline draft
// ---------------------------------------------------------------------

export async function handleEnrichProspect(
  params: {
    name: string
    company?: string
    company_domain?: string
    linkedin_url?: string
  },
  ctx: ToolContext,
) {
  // Use the discovery candidate shape so the drafter has consistent input.
  const candidate: ProspectCandidate = {
    name: params.name,
    title: "(unknown role)",
    company: params.company ?? "(unknown company)",
    source: params.linkedin_url ? "brave" : "mock",
    source_url: params.linkedin_url ?? "",
    snippet: `Named-prospect enrichment for ${params.name}${params.company ? ` at ${params.company}` : ""}.`,
  }

  // Pull the user's voice anchor if they've set one.
  const supabase = createAdminClient()
  const { data: user } = await supabase
    .from("users")
    .select("voice_anchor_text")
    .eq("id", ctx.userId)
    .maybeSingle()

  const draft = await draftForProspect({
    prospect: candidate,
    voiceAnchor: user?.voice_anchor_text ?? null,
  })

  return {
    prospect: candidate,
    draft,
  }
}

// ---------------------------------------------------------------------
// add_named_prospects — stage an explicit list (no search) as candidates
// ---------------------------------------------------------------------

export async function handleAddNamedProspects(
  params: {
    prospects: Array<{
      name: string
      company?: string
      title?: string
      linkedin_url?: string
    }>
  },
  ctx: ToolContext,
) {
  const supabase = createAdminClient()

  const rows = params.prospects.map((p) => {
    const candidate: ProspectCandidate = {
      name: p.name,
      title: p.title ?? "(unknown role)",
      company: p.company ?? "(unknown company)",
      source: "named",
      source_url: p.linkedin_url ?? "",
      snippet: `Named prospect — provided by user.`,
    }
    return {
      session_id: ctx.sessionId,
      source: "named" as const,
      source_ref: p.linkedin_url ?? null,
      preview: candidate as unknown as Record<string, unknown>,
    }
  })

  const { data, error } = await supabase
    .from("prospect_candidates")
    .insert(rows)
    .select("id,preview")

  if (error) {
    return { error: error.message, count: 0, candidates: [] }
  }

  return {
    count: data?.length ?? 0,
    candidates: (data ?? []).map((r) => ({
      id: r.id as string,
      ...(r.preview as unknown as ProspectCandidate),
    })),
  }
}

// ---------------------------------------------------------------------
// clarify_question — pure passthrough; the model already wrote the text
// ---------------------------------------------------------------------

export async function handleClarify(params: {
  question: string
  suggested_answers?: string[]
}) {
  return {
    question: params.question,
    suggested_answers: params.suggested_answers ?? [],
  }
}

// ---------------------------------------------------------------------
// start_bulk_job — runs synchronously in MVP (no Inngest)
//
// For the 8-12 prospect range that fits Vercel function timeouts this
// works fine; v1.5 will move this to Inngest fan-out.
// ---------------------------------------------------------------------

export async function handleStartBulkJob(
  params: { candidate_ids?: string[]; draft_email: boolean },
  ctx: ToolContext,
) {
  const supabase = createAdminClient()

  // 1. Load the candidates the user wants to enrich. If no IDs given,
  //    take every recent candidate from this session.
  const baseSelect = supabase.from("prospect_candidates").select("id,preview")
  const candidatesQuery = params.candidate_ids?.length
    ? baseSelect.in("id", params.candidate_ids)
    : baseSelect
        .eq("session_id", ctx.sessionId)
        .order("created_at", { ascending: false })
        .limit(50)

  const { data: candidateRows, error: candidatesErr } = await candidatesQuery
  if (candidatesErr) {
    return { error: candidatesErr.message }
  }
  const candidates = (candidateRows ?? []).map(
    (r) => r.preview as unknown as ProspectCandidate,
  )
  if (candidates.length === 0) {
    return { error: "No candidates found. Run web_search first." }
  }

  // 1.5 Credit gate — refuse upfront if the user doesn't have enough.
  const gate = await checkCredits(ctx.userId, candidates.length)
  if (!gate.ok) {
    return {
      error:
        gate.reason ??
        `Insufficient credits (${gate.remaining}/${gate.required}).`,
      credits_remaining: gate.remaining,
      credits_required: gate.required,
    }
  }

  // 2. Create a job row + prospect rows (status pending).
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      user_id: ctx.userId,
      source_session_id: ctx.sessionId,
      input_source: "chat_search",
      status: "processing",
      prospect_count: candidates.length,
    })
    .select("id")
    .single()
  if (jobErr || !job) {
    return { error: jobErr?.message ?? "Failed to create job" }
  }

  // Deduct credits now that the job row exists (so the ledger has a
  // jobId to reference). If this fails — e.g. a concurrent run drained
  // the balance — abort and refund nothing (we haven't enriched yet).
  const deduction = await deductCredits({
    userId: ctx.userId,
    count: candidates.length,
    jobId: job.id as string,
    reason: "bulk_enrichment",
  })
  if (!deduction.ok) {
    await supabase
      .from("jobs")
      .update({ status: "failed", error_reason: deduction.error ?? "credit_check_failed" })
      .eq("id", job.id)
    return { error: deduction.error ?? "Failed to deduct credits." }
  }

  // Load the user's voice anchor once so every draft in the batch
  // matches their register.
  const { data: userRow } = await supabase
    .from("users")
    .select("voice_anchor_text")
    .eq("id", ctx.userId)
    .maybeSingle()
  const voiceAnchor =
    (userRow?.voice_anchor_text as string | null | undefined) ?? null

  // 3. Enrich each candidate in parallel (concurrency 3 = polite).
  const drafts = await mapConcurrent(candidates, 3, async (c) => {
    const draft = params.draft_email
      ? await draftForProspect({ prospect: c, voiceAnchor })
      : null
    // Email guess — domain inferred from company name, then the
    // "first.last" pattern (most common at modern SaaS companies).
    const domain = guessDomainFromCompany(c.company)
    const guess = domain ? bestGuessEmail(c.name, domain) : null
    return {
      candidate: c,
      draft,
      domain,
      email: guess?.email ?? null,
      email_source: (guess ? "pattern_guessed" : "none") as
        | "pattern_guessed"
        | "none",
      email_confidence: (guess ? "risky" : "unknown") as "risky" | "unknown",
    }
  })

  // 4. Persist prospects.
  const prospectInserts = drafts.map(
    ({ candidate, draft, domain, email, email_source, email_confidence }) => ({
      job_id: job.id,
      input_source: "chat_search",
      input_name: candidate.name,
      input_company: candidate.company,
      input_linkedin_url: candidate.source_url,
      status: "completed" as const,
      company_domain: domain,
      email,
      email_source,
      email_confidence,
      research_summary: draft?.research_summary ?? null,
      email_subject: draft?.email_subject ?? null,
      email_body: draft?.email_body ?? null,
      talking_points: draft?.talking_points ?? null,
      completed_at: new Date().toISOString(),
    }),
  )
  await supabase.from("prospects").insert(prospectInserts)

  // 5. Build the export rows from in-memory drafts (no second DB roundtrip).
  const rows = drafts.map(
    ({ candidate, draft, email, email_confidence }) => ({
      name: candidate.name,
      title: candidate.title,
      company: candidate.company,
      email,
      email_confidence,
      research_summary: draft?.research_summary ?? null,
      email_subject: draft?.email_subject ?? null,
      email_body: draft?.email_body ?? null,
      talking_points: draft?.talking_points ?? null,
      source_url: candidate.source_url,
    }),
  )

  // 6. Push to Google Sheets (or fall back to a mock URL).
  const { data: u } = await supabase
    .from("users")
    .select("google_refresh_token")
    .eq("id", ctx.userId)
    .maybeSingle()

  const title = `LeadGenAI — ${candidates.length} prospects — ${new Date().toLocaleString()}`
  const sheet = await exportToSheet({
    refreshToken: (u?.google_refresh_token as string) ?? null,
    title,
    rows,
  })

  // 7. Stamp the CSV bytes too so the chat UI can offer a direct download.
  //    For the MVP we encode as data URL — fine up to a few hundred rows.
  const csv = rowsToCsv(rows)
  const csvDataUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      sheet_url: sheet.url,
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id)

  return {
    job_id: job.id,
    prospect_count: candidates.length,
    sheet_url: sheet.url,
    sheet_is_mock: sheet.mock,
    csv_data_url: csvDataUrl,
    preview: rows.slice(0, 3),
    credits_remaining: deduction.remaining,
  }
}

// ---------------------------------------------------------------------
// Tiny parallel-map with concurrency limit. No external dep.
// ---------------------------------------------------------------------

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers: Promise<void>[] = []
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = next++
          if (idx >= items.length) return
          out[idx] = await fn(items[idx])
        }
      })(),
    )
  }
  await Promise.all(workers)
  return out
}
