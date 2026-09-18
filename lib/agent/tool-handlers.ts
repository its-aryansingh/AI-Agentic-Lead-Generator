/**
 * Concrete implementations of each chat tool.
 *
 * These run server-side inside the streaming /api/chat route. They use
 * the service-role Supabase client so they can write across RLS — the
 * userId is passed in from the request handler after auth.
 */

import { createAdminClient } from "@/lib/supabase/server";
import {
  discoverProspects,
  type ProspectCandidate,
} from "@/lib/providers/brave-search";
import {
  draftForProspect,
  draftReplyResponse,
} from "@/lib/providers/anthropic";
import { resolveAiModel } from "@/lib/ai-config";
import { exportToSheet, rowsToCsv } from "@/lib/providers/google-sheets";
import { searchGithubUsers } from "@/lib/providers/github";
import { searchHnUsers } from "@/lib/providers/hn-algolia";
import { searchProductHuntMakers } from "@/lib/providers/producthunt";
import { getOrSetCache } from "@/lib/cache";
import {
  bestGuessEmail,
  guessDomainFromCompany,
  verifyDomainMx,
} from "@/lib/email-patterns";
import { scrapeCompany, scrapeNews } from "@/lib/providers/scraper-client";
import { searchTavily } from "@/lib/providers/search-aggregator";
import {
  sendWhatsApp,
  sendWhatsAppTemplate,
  normalizeWhatsAppNumber,
} from "@/lib/providers/whatsapp";
import { pushContact, addNote } from "@/lib/providers/hubspot";
import { pushZohoContact, addZohoNote } from "@/lib/providers/zoho";
import { sendGmail } from "@/lib/providers/gmail";
import { decryptCredential } from "@/lib/credential-crypto";
import { checkCredits, deductCredits } from "@/lib/credits";
import { enrichmentBundleCredits } from "@/lib/credit-costs";
import {
  appendComplianceFooter,
  makeUnsubToken,
  sha256Email,
} from "@/lib/email-compliance";
import { inngest } from "@/inngest/client";
import {
  composePlaybookGuidance,
  contextSnapshot,
  type ApprovedExample,
} from "@/lib/playbook";

import type { ToolContext } from "@/lib/agent/tools";

// Batches larger than this threshold are handed off to Inngest so they run
// in the background instead of blocking the streaming chat response.
const INNGEST_THRESHOLD = 20;

async function loadApprovedDraftContext(userId: string) {
  const db = createAdminClient();
  const [{ data: context }, { data: examples }] = await Promise.all([
    db
      .from("customer_contexts")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("playbook_examples")
      .select("id,example_type,title,redacted_content,extracted_guidance")
      .eq("user_id", userId)
      .eq("is_approved", true),
  ]);
  const approved = (examples ?? [])
    .filter((e) => e.redacted_content)
    .map((e) => ({
      ...e,
      redacted_content: String(e.redacted_content),
    })) as ApprovedExample[];
  const sellerContext = context
    ? JSON.stringify({
        company_name: context.company_name,
        product_summary: context.product_summary,
        ideal_customer_profile: context.ideal_customer_profile,
        value_proposition: context.value_proposition,
        approved_claims: context.approved_claims,
        prohibited_topics: context.prohibited_topics,
      })
    : null;
  return {
    context,
    approved,
    sellerContext,
    playbookGuidance: composePlaybookGuidance(approved),
    snapshot: contextSnapshot(
      context as Record<string, unknown> | null,
      approved,
    ),
  };
}

// ---------------------------------------------------------------------
// web_search
// ---------------------------------------------------------------------

export async function handleWebSearch(
  params: {
    query: string;
    target_role?: string;
    industry?: string;
    location?: string;
    max_results: number;
  },
  ctx: ToolContext,
) {
  const cacheKey = `brave:${params.query}:${params.max_results}`;
  const candidates = await getOrSetCache(cacheKey, 7 * 86_400, () =>
    discoverProspects(params),
  );

  // Persist candidates so a later start_bulk_job can reference them by ID.
  const supabase = createAdminClient();
  const inserted: Array<{ id: string; candidate: ProspectCandidate }> = [];
  let persistenceError: string | null = null;

  if (candidates.length > 0) {
    const rows = candidates.map((c) => ({
      session_id: ctx.sessionId,
      source: c.source,
      source_ref: c.source_url,
      preview: c as unknown as Record<string, unknown>,
    }));
    const { data, error } = await supabase
      .from("prospect_candidates")
      .insert(rows)
      .select("id,preview");
    persistenceError = error?.message ?? null;
    if (!error && data) {
      for (const row of data) {
        inserted.push({
          id: row.id as string,
          candidate: row.preview as unknown as ProspectCandidate,
        });
      }
    }
  }

  return {
    count: candidates.length,
    candidates:
      inserted.length > 0
        ? inserted.map((r) => ({ id: r.id, ...r.candidate }))
        : candidates.map((c) => ({ id: null, ...c })),
    using_mock_data: candidates[0]?.source === "mock",
    persistence_error: persistenceError,
  };
}

// ---------------------------------------------------------------------
// public_source_search — vertical-specific discovery (GitHub, PH, HN).
// ---------------------------------------------------------------------

export async function handlePublicSourceSearch(
  params: { source: string; query: string; max_results: number },
  ctx: ToolContext,
) {
  let candidates: ProspectCandidate[] = [];
  let dbSource: "github" | "hn" | "producthunt" | null = null;

  if (params.source === "github") {
    dbSource = "github";
    const cacheKey = `github:${params.query}:${params.max_results}`;
    candidates = await getOrSetCache(cacheKey, 7 * 86_400, () =>
      searchGithubUsers(params.query, params.max_results),
    );
  } else if (params.source === "hn_algolia") {
    dbSource = "hn";
    const cacheKey = `hn:${params.query}:${params.max_results}`;
    candidates = await getOrSetCache(cacheKey, 1 * 86_400, () =>
      searchHnUsers(params.query, params.max_results),
    );
  } else if (params.source === "producthunt") {
    dbSource = "producthunt";
    const cacheKey = `producthunt:${params.query}:${params.max_results}`;
    candidates = await getOrSetCache(cacheKey, 1 * 86_400, () =>
      searchProductHuntMakers(params.query, params.max_results),
    );
  } else {
    return {
      count: 0,
      candidates: [],
      note: `Unknown public source "${params.source}". Use github, producthunt, or hn_algolia.`,
    };
  }

  // Persist for downstream start_bulk_job (mirrors handleWebSearch).
  const supabase = createAdminClient();
  const inserted: Array<{ id: string; candidate: ProspectCandidate }> = [];
  if (candidates.length > 0) {
    const rows = candidates.map((c) => ({
      session_id: ctx.sessionId,
      source: dbSource!,
      source_ref: c.source_url,
      preview: c as unknown as Record<string, unknown>,
    }));
    const { data } = await supabase
      .from("prospect_candidates")
      .insert(rows)
      .select("id,preview");
    if (data) {
      for (const row of data) {
        inserted.push({
          id: row.id as string,
          candidate: row.preview as unknown as ProspectCandidate,
        });
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
    using_mock_data: candidates.some((c) => c.source === "mock"),
  };
}

// ---------------------------------------------------------------------
// enrich_prospect — single named lookup, returns inline draft
// ---------------------------------------------------------------------

export async function handleEnrichProspect(
  params: {
    name: string;
    title?: string;
    company?: string;
    company_domain?: string;
    linkedin_url?: string;
  },
  ctx: ToolContext,
) {
  const supabase = createAdminClient();
  const { data: user } = await supabase
    .from("users")
    .select("voice_anchor_text, outreach_language")
    .eq("id", ctx.userId)
    .maybeSingle();

  // Resolve the domain: prefer explicitly provided, then guess from company name.
  const domain =
    params.company_domain?.replace(/^https?:\/\//, "").replace(/\/.*$/, "") ||
    (params.company ? guessDomainFromCompany(params.company) : null);

  const tavilyEnabled = Boolean(process.env.TAVILY_API_KEY);
  const scraperEnabled = Boolean(
    process.env.SCRAPER_URL && process.env.SCRAPER_KEY,
  );

  // Tavily discovery must also remain useful during follow-up enrichment.
  // When it is configured, do not mix its real results with the scraper's
  // deterministic demo data.
  const [companyScrape, newsScrape, tavilyResults] = await Promise.all([
    domain
      ? scraperEnabled || !tavilyEnabled
        ? getOrSetCache(`company:${domain}`, 30 * 86400, () =>
          scrapeCompany({ domain: domain!, target_name: params.name }),
        )
        : Promise.resolve(null)
      : Promise.resolve(null),
    params.company
      ? scraperEnabled || !tavilyEnabled
        ? getOrSetCache(`news:${domain ?? params.company}`, 7 * 86400, () =>
          scrapeNews({
            company_name: params.company!,
            domain: domain ?? undefined,
          }),
        )
        : Promise.resolve(null)
      : Promise.resolve(null),
    tavilyEnabled
      ? getOrSetCache(
          `tavily:prospect:${params.name}:${params.company ?? ""}`,
          7 * 86400,
          () =>
            searchTavily(
              `"${params.name}" "${params.company ?? ""}" role company recent news`,
              6,
            ),
        )
      : Promise.resolve([]),
  ]);

  // Email resolution: extracted from site > pattern-guessed with MX check > none.
  let email: string | null = null;
  let emailSource: "extracted" | "pattern_guessed" | "none" = "none";
  let emailConfidence: "risky" | "invalid" | "unknown" = "unknown";

  if (companyScrape && companyScrape.emails.length > 0) {
    // Try to find an email that matches the prospect's name.
    const lower = params.name.toLowerCase();
    const nameParts = lower.split(/\s+/);
    const matched =
      companyScrape.emails.find((e) =>
        nameParts.some((p) => e.startsWith(p)),
      ) ?? companyScrape.emails[0];
    email = matched;
    emailSource = "extracted";
    emailConfidence = "risky";
  } else if (domain) {
    const guess = bestGuessEmail(params.name, domain);
    if (guess) {
      const mx = await verifyDomainMx(domain);
      if (mx.confidence === "no_mx") {
        emailConfidence = "invalid";
      } else {
        email = guess.email;
        emailSource = "pattern_guessed";
        emailConfidence = mx.confidence === "unknown" ? "unknown" : "risky";
      }
    }
  }

  // Build a news summary string to pass to the drafter.
  const scraperNewsSummary =
    newsScrape && newsScrape.articles.length > 0
      ? newsScrape.articles.map((a) => `- ${a.title}: ${a.snippet}`).join("\n")
      : null;
  const tavilySummary = tavilyResults.length
    ? tavilyResults
        .map((result) => `- ${result.title}: ${result.description}`)
        .join("\n")
    : null;
  const researchSummary = [scraperNewsSummary, tavilySummary]
    .filter(Boolean)
    .join("\n");

  const candidate: ProspectCandidate = {
    name: params.name,
    title: params.title ?? companyScrape?.matched_target ?? "(unknown role)",
    company: params.company ?? "(unknown company)",
    source: tavilyResults.length
      ? "tavily"
      : params.linkedin_url
        ? "brave"
        : "mock",
    source_url: params.linkedin_url ?? tavilyResults[0]?.url ?? "",
    snippet:
      tavilyResults
        .map((result) => result.description)
        .filter(Boolean)
        .join(" ")
        .slice(0, 3000) ||
      `Named-prospect enrichment for ${params.name}${params.company ? ` at ${params.company}` : ""}.`,
  };

  const approvedContext = await loadApprovedDraftContext(ctx.userId);
  const draft = await draftForProspect({
    userId: ctx.userId,
    prospect: candidate,
    voiceAnchor: user?.voice_anchor_text ?? null,
    news: researchSummary || null,
    language: (user?.outreach_language as string | null) ?? null,
    customerContext: approvedContext.sellerContext,
    playbookGuidance: approvedContext.playbookGuidance,
  });

  return {
    prospect: candidate,
    email,
    email_source: emailSource,
    email_confidence: emailConfidence,
    company_domain: domain,
    scraped_emails: companyScrape?.emails ?? [],
    recent_news: newsScrape?.articles ?? [],
    research_sources: tavilyResults.map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.description,
    })),
    draft,
  };
}

// ---------------------------------------------------------------------
// add_named_prospects — stage an explicit list (no search) as candidates
// ---------------------------------------------------------------------

export async function handleAddNamedProspects(
  params: {
    prospects: Array<{
      name: string;
      company?: string;
      title?: string;
      linkedin_url?: string;
    }>;
  },
  ctx: ToolContext,
) {
  const supabase = createAdminClient();

  const rows = params.prospects.map((p) => {
    const candidate: ProspectCandidate = {
      name: p.name,
      title: p.title ?? "(unknown role)",
      company: p.company ?? "(unknown company)",
      source: "named",
      source_url: p.linkedin_url ?? "",
      snippet: `Named prospect — provided by user.`,
    };
    return {
      session_id: ctx.sessionId,
      source: "named" as const,
      source_ref: p.linkedin_url ?? null,
      preview: candidate as unknown as Record<string, unknown>,
    };
  });

  const { data, error } = await supabase
    .from("prospect_candidates")
    .insert(rows)
    .select("id,preview");

  if (error) {
    return { error: error.message, count: 0, candidates: [] };
  }

  return {
    count: data?.length ?? 0,
    candidates: (data ?? []).map((r) => ({
      id: r.id as string,
      ...(r.preview as unknown as ProspectCandidate),
    })),
  };
}

// ---------------------------------------------------------------------
// clarify_question — pure passthrough; the model already wrote the text
// ---------------------------------------------------------------------

export async function handleSaveCandidatesToLeads(
  params: {
    prospects: Array<{
      name: string;
      company?: string;
      title?: string;
      linkedin_url?: string;
    }>;
  },
  ctx: ToolContext,
) {
  const supabase = createAdminClient();
  const prospects = params.prospects.slice(0, 50);
  if (prospects.length === 0) {
    return { error: "No prospects were provided.", count: 0, leads: [] };
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      user_id: ctx.userId,
      source_session_id: ctx.sessionId,
      input_source: "chat_search",
      status: "completed",
      prospect_count: prospects.length,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (jobError || !job) {
    return {
      error: jobError?.message ?? "Failed to create the lead import job.",
      count: 0,
      leads: [],
    };
  }

  const { data: leads, error: leadsError } = await supabase
    .from("prospects")
    .insert(
      prospects.map((prospect) => ({
        job_id: job.id,
        input_source: "chat_search",
        input_name: prospect.name.trim(),
        input_company: prospect.company?.trim() || null,
        input_title: prospect.title?.trim() || null,
        input_linkedin_url: prospect.linkedin_url?.trim() || null,
        status: "pending",
        lead_status: "new",
        next_action: "review",
        email_source: "none",
        email_confidence: "unknown",
      })),
    )
    .select("id,input_name,input_company,input_title");
  if (leadsError) {
    await supabase
      .from("jobs")
      .update({ status: "failed", error_reason: leadsError.message })
      .eq("id", job.id);
    return { error: leadsError.message, count: 0, leads: [] };
  }

  return {
    job_id: job.id,
    count: leads?.length ?? 0,
    leads: (leads ?? []).map((lead) => ({
      lead_id: lead.id,
      name: lead.input_name,
      company: lead.input_company,
      title: lead.input_title,
    })),
    message: `Added ${leads?.length ?? 0} lead(s) to the Leads section.`,
  };
}

export async function handleClarify(params: {
  question: string;
  suggested_answers?: string[];
}) {
  return {
    question: params.question,
    suggested_answers: params.suggested_answers ?? [],
  };
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
  const supabase = createAdminClient();

  // 1. Load the candidates the user wants to enrich. If no IDs given,
  //    take every recent candidate from this session.
  const baseSelect = supabase.from("prospect_candidates").select("id,preview");
  const candidatesQuery = params.candidate_ids?.length
    ? baseSelect.in("id", params.candidate_ids)
    : baseSelect
        .eq("session_id", ctx.sessionId)
        .order("created_at", { ascending: false })
        .limit(50);

  const { data: candidateRows, error: candidatesErr } = await candidatesQuery;
  if (candidatesErr) {
    return { error: candidatesErr.message };
  }
  const candidates = (candidateRows ?? []).map(
    (r) => r.preview as unknown as ProspectCandidate,
  );
  if (candidates.length === 0) {
    return { error: "No candidates found. Run web_search first." };
  }

  // 1.2 Production Guard for Large Jobs
  if (
    candidates.length > INNGEST_THRESHOLD &&
    process.env.NODE_ENV === "production" &&
    !process.env.INNGEST_EVENT_KEY
  ) {
    return {
      error: `Inngest is required in production for bulk jobs > ${INNGEST_THRESHOLD} prospects. INNGEST_EVENT_KEY is not configured.`,
    };
  }

  // 1.4 Calculate required credits based on user model preference
  const resolvedWriting = await resolveAiModel(ctx.userId, "writing");
  const costPerLead = enrichmentBundleCredits(
    resolvedWriting?.modelId ?? "claude-sonnet-4-6",
  );
  const totalCreditsNeeded = candidates.length * costPerLead;

  // 1.5 Credit gate — refuse upfront if the user doesn't have enough.
  const gate = await checkCredits(ctx.userId, totalCreditsNeeded);
  if (!gate.ok) {
    return {
      error:
        gate.reason ??
        `Insufficient credits (${gate.remaining}/${gate.required}). Each enrichment bundle requires ${costPerLead} credits.`,
      credits_remaining: gate.remaining,
      credits_required: gate.required,
    };
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
    .single();
  if (jobErr || !job) {
    return { error: jobErr?.message ?? "Failed to create job" };
  }

  // Deduct credits now that the job row exists (so the ledger has a
  // jobId to reference). If this fails — e.g. a concurrent run drained
  // the balance — abort and refund nothing (we haven't enriched yet).
  const deduction = await deductCredits({
    userId: ctx.userId,
    count: totalCreditsNeeded,
    jobId: job.id as string,
    reason: `bulk_enrichment_${candidates.length}_leads`,
  });
  if (!deduction.ok) {
    await supabase
      .from("jobs")
      .update({
        status: "failed",
        error_reason: deduction.error ?? "credit_check_failed",
      })
      .eq("id", job.id);
    return { error: deduction.error ?? "Failed to deduct credits." };
  }

  // Load the user's voice anchor once so every draft in the batch
  // matches their register.
  const { data: userRow } = await supabase
    .from("users")
    .select("voice_anchor_text, outreach_language")
    .eq("id", ctx.userId)
    .maybeSingle();
  const voiceAnchor =
    (userRow?.voice_anchor_text as string | null | undefined) ?? null;
  const outreachLanguage =
    (userRow?.outreach_language as string | null | undefined) ?? null;
  const approvedContext = await loadApprovedDraftContext(ctx.userId);

  // Large batches: hand off to Inngest so the chat response doesn't block
  // waiting for 20+ LLM calls. Requires INNGEST_EVENT_KEY in env.
  if (candidates.length > INNGEST_THRESHOLD && process.env.INNGEST_EVENT_KEY) {
    await inngest.send({
      name: "leadgen/bulk.start",
      data: {
        job_id: job.id as string,
        user_id: ctx.userId,
        candidates,
        draft_email: params.draft_email,
        voice_anchor: voiceAnchor,
        outreach_language: outreachLanguage,
        customer_context: approvedContext.sellerContext,
        playbook_guidance: approvedContext.playbookGuidance,
        context_version: Number(approvedContext.context?.version ?? 0) || null,
        context_snapshot: approvedContext.snapshot,
        playbook_example_ids: approvedContext.approved.map((e) => e.id),
      },
    });
    return {
      job_id: job.id,
      prospect_count: candidates.length,
      queued: true,
      message:
        `Queued ${candidates.length} prospects for enrichment — running in the background. ` +
        `Check the Jobs page in a few minutes to download your Sheet and CSV.`,
      credits_remaining: deduction.remaining,
    };
  }

  // 3. Enrich each candidate in parallel (concurrency 3 = polite).
  const drafts = await mapConcurrent(candidates, 3, async (c) => {
    const draft = params.draft_email
      ? await draftForProspect({
          userId: ctx.userId,
          prospect: c,
          voiceAnchor,
          language: outreachLanguage,
          customerContext: approvedContext.sellerContext,
          playbookGuidance: approvedContext.playbookGuidance,
        })
      : null;

    const domain = guessDomainFromCompany(c.company);
    const guess = domain ? bestGuessEmail(c.name, domain) : null;

    // DNS MX check: upgrade from "risky" to a more precise confidence.
    // mx_verified → domain has mail exchangers (store as "risky", still guessed).
    // no_mx       → domain can't receive email at all   (store as "invalid").
    // unknown     → DNS timed out or failed             (store as "unknown").
    let dbConfidence: "risky" | "invalid" | "unknown" = guess
      ? "risky"
      : "unknown";
    if (domain && guess) {
      const mx = await verifyDomainMx(domain);
      if (mx.confidence === "no_mx") dbConfidence = "invalid";
      else if (mx.confidence === "unknown") dbConfidence = "unknown";
      // mx_verified stays "risky" — pattern-guessed but domain is mail-enabled
    }

    return {
      candidate: c,
      draft,
      domain,
      email: dbConfidence === "invalid" ? null : (guess?.email ?? null),
      email_source: (guess ? "pattern_guessed" : "none") as
        | "pattern_guessed"
        | "none",
      email_confidence: dbConfidence,
    };
  });

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
      context_version: Number(approvedContext.context?.version ?? 0) || null,
      context_snapshot: approvedContext.snapshot,
      playbook_example_ids: approvedContext.approved.map((e) => e.id),
      talking_points: draft?.talking_points ?? null,
      completed_at: new Date().toISOString(),
    }),
  );
  await supabase.from("prospects").insert(prospectInserts);

  // 5. Build the export rows from in-memory drafts (no second DB roundtrip).
  const rows = drafts.map(({ candidate, draft, email, email_confidence }) => ({
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
  }));

  // 6. Push to Google Sheets (or fall back to a mock URL).
  const { data: u } = await supabase
    .from("users")
    .select("google_refresh_token")
    .eq("id", ctx.userId)
    .maybeSingle();

  const title = `Aravya SalesEngAI — ${candidates.length} prospects — ${new Date().toLocaleString()}`;
  const sheet = await exportToSheet({
    refreshToken: (u?.google_refresh_token as string) ?? null,
    title,
    rows,
  });

  // 7. Stamp the CSV bytes too so the chat UI can offer a direct download.
  //    For the MVP we encode as data URL — fine up to a few hundred rows.
  const csv = rowsToCsv(rows);
  const csvDataUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      sheet_url: sheet.url,
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  return {
    job_id: job.id,
    prospect_count: candidates.length,
    sheet_url: sheet.url,
    sheet_is_mock: sheet.mock,
    csv_data_url: csvDataUrl,
    preview: rows.slice(0, 3),
    credits_remaining: deduction.remaining,
  };
}

// ---------------------------------------------------------------------
// list_intake_jobs — surfaces leads added via Lead Intake that haven't
// been enriched/drafted yet so the agent can offer to enrich them.
// ---------------------------------------------------------------------

export async function handleListIntakeJobs(ctx: ToolContext) {
  const supabase = createAdminClient();

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id,input_source,prospect_count,created_at,status")
    .eq("user_id", ctx.userId)
    .in("input_source", ["manual_entry", "csv_upload"])
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return { error: error.message, jobs: [] };
  if (!jobs?.length) {
    return {
      jobs: [],
      message: "No leads found in Lead Intake. Add leads at /app/leads first.",
    };
  }

  const jobSummaries = await Promise.all(
    jobs.map(async (job) => {
      const { count: totalCount } = await supabase
        .from("prospects")
        .select("id", { count: "exact", head: true })
        .eq("job_id", job.id);

      const { count: enrichedCount } = await supabase
        .from("prospects")
        .select("id", { count: "exact", head: true })
        .eq("job_id", job.id)
        .not("email_body", "is", null);

      const unenriched = (totalCount ?? 0) - (enrichedCount ?? 0);
      return {
        job_id: job.id as string,
        source: job.input_source as string,
        total_leads: totalCount ?? 0,
        enriched: enrichedCount ?? 0,
        needs_enrichment: unenriched,
        created_at: job.created_at as string,
      };
    }),
  );

  const needsWork = jobSummaries.filter((j) => j.needs_enrichment > 0);
  return {
    jobs: jobSummaries,
    unenriched_jobs: needsWork,
    message:
      needsWork.length > 0
        ? `Found ${needsWork.length} intake job(s) with un-enriched leads. Call enrich_intake_job with the job_id to draft emails.`
        : "All intake leads have already been enriched.",
  };
}

// ---------------------------------------------------------------------
// enrich_intake_job — enriches existing prospects from a Lead Intake job
// in-place (updates their rows with research + drafted email), so they
// can then be launched via launch_campaign.
// ---------------------------------------------------------------------

export async function handleEnrichIntakeJob(
  params: { job_id: string; draft_email?: boolean },
  ctx: ToolContext,
) {
  const supabase = createAdminClient();
  const draftEmail = params.draft_email !== false;

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id,input_source,prospect_count,status")
    .eq("id", params.job_id)
    .eq("user_id", ctx.userId)
    .maybeSingle();

  if (jobErr || !job) {
    return { error: "Job not found or does not belong to you." };
  }
  if (!["manual_entry", "csv_upload"].includes(job.input_source as string)) {
    return {
      error:
        "This job was not created via Lead Intake. Use start_bulk_job for chat-sourced candidates.",
    };
  }

  const { data: rawProspects, error: prospErr } = await supabase
    .from("prospects")
    .select(
      "id,input_name,input_company,input_title,input_linkedin_url,email,phone",
    )
    .eq("job_id", params.job_id)
    .is("email_body", null);

  if (prospErr) return { error: prospErr.message };
  if (!rawProspects?.length) {
    return {
      job_id: params.job_id,
      message:
        "All leads in this job are already enriched. Ready to launch campaign.",
      enriched_count: 0,
    };
  }

  const resolvedWriting = await resolveAiModel(ctx.userId, "writing");
  const costPerLead = enrichmentBundleCredits(
    resolvedWriting?.modelId ?? "claude-sonnet-4-6",
  );
  const totalCreditsNeeded = rawProspects.length * costPerLead;
  const gate = await checkCredits(ctx.userId, totalCreditsNeeded);
  if (!gate.ok) {
    return {
      error:
        gate.reason ??
        `Insufficient credits (${gate.remaining}/${gate.required}). Need ${costPerLead} credits per lead.`,
      credits_remaining: gate.remaining,
      credits_required: gate.required,
    };
  }

  const deduction = await deductCredits({
    userId: ctx.userId,
    count: totalCreditsNeeded,
    jobId: params.job_id,
    reason: `intake_enrichment_${rawProspects.length}_leads`,
  });
  if (!deduction.ok) {
    return { error: deduction.error ?? "Failed to deduct credits." };
  }

  await supabase
    .from("jobs")
    .update({ status: "processing" })
    .eq("id", params.job_id);

  const { data: userRow } = await supabase
    .from("users")
    .select("voice_anchor_text, outreach_language")
    .eq("id", ctx.userId)
    .maybeSingle();
  const voiceAnchor = (userRow?.voice_anchor_text as string | null) ?? null;
  const outreachLanguage =
    (userRow?.outreach_language as string | null) ?? null;
  const approvedContext = await loadApprovedDraftContext(ctx.userId);

  let enrichedCount = 0;
  await mapConcurrent(rawProspects, 3, async (p) => {
    const candidate: ProspectCandidate = {
      name: (p.input_name as string) ?? "Unknown",
      title: (p.input_title as string) ?? "(unknown role)",
      company: (p.input_company as string) ?? "(unknown company)",
      source: "named",
      source_url: (p.input_linkedin_url as string) ?? "",
      snippet: "Lead Intake prospect.",
    };

    const draft = draftEmail
      ? await draftForProspect({
          userId: ctx.userId,
          prospect: candidate,
          voiceAnchor,
          language: outreachLanguage,
          customerContext: approvedContext.sellerContext,
          playbookGuidance: approvedContext.playbookGuidance,
        })
      : null;

    let emailUpdate: string | null = (p.email as string | null) ?? null;
    let emailSource = emailUpdate ? "extracted" : "none";
    let emailConfidence: "high" | "risky" | "invalid" | "unknown" = "unknown";

    if (!emailUpdate) {
      const domain = guessDomainFromCompany(candidate.company);
      const guess = domain ? bestGuessEmail(candidate.name, domain) : null;
      if (guess) {
        const mx = await verifyDomainMx(domain!);
        emailConfidence =
          mx.confidence === "no_mx"
            ? "invalid"
            : mx.confidence === "mx_verified"
              ? "risky"
              : "unknown";
        emailUpdate = emailConfidence === "invalid" ? null : guess.email;
        emailSource = emailUpdate ? "pattern_guessed" : "none";
      }
    }

    await supabase
      .from("prospects")
      .update({
        status: "completed",
        ...(emailUpdate !== null && {
          email: emailUpdate,
          email_source: emailSource,
          email_confidence: emailConfidence,
        }),
        research_summary: draft?.research_summary ?? null,
        email_subject: draft?.email_subject ?? null,
        email_body: draft?.email_body ?? null,
        talking_points: draft?.talking_points ?? null,
        context_version: Number(approvedContext.context?.version ?? 0) || null,
        context_snapshot: approvedContext.snapshot,
        playbook_example_ids: approvedContext.approved.map((e) => e.id),
        completed_at: new Date().toISOString(),
      })
      .eq("id", p.id);

    enrichedCount++;
  });

  await supabase
    .from("jobs")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", params.job_id);

  return {
    job_id: params.job_id,
    enriched_count: enrichedCount,
    credits_remaining: deduction.remaining,
    message:
      `Enriched ${enrichedCount} lead(s) from your intake list. ` +
      (draftEmail
        ? "Emails are drafted and ready. You can now launch a campaign."
        : "Research done. Call again with draft_email=true to also draft emails."),
  };
}

// ---------------------------------------------------------------------
// Tiny parallel-map with concurrency limit. No external dep.
// ---------------------------------------------------------------------

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = next++;
          if (idx >= items.length) return;
          out[idx] = await fn(items[idx]);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// search_leads — search existing leads from user's jobs (intake or discovery)
// ---------------------------------------------------------------------

export async function handleSearchLeads(
  params: {
    query?: string;
    lead_status?: string;
    qualification_bucket?: string;
    only_with_replies?: boolean;
    limit?: number;
  },
  ctx: ToolContext,
) {
  const supabase = createAdminClient();
  const limit = Math.min(params.limit ?? 25, 50);

  const { data: userJobs } = await supabase
    .from("jobs")
    .select("id")
    .eq("user_id", ctx.userId);

  const jobIds = (userJobs ?? []).map((j) => j.id as string);
  if (!jobIds.length) {
    return {
      count: 0,
      leads: [],
      message:
        "No leads found in your account. Add leads via Lead Intake at /app/leads.",
    };
  }

  let q = supabase
    .from("prospects")
    .select(
      "id,job_id,input_name,input_company,input_title,email,phone,status,lead_status,qualification_bucket,next_action,email_subject,email_body,research_summary,handoff_summary,created_at",
    )
    .in("job_id", jobIds)
    .order("created_at", { ascending: false })
    // Apply the user-facing limit only after reply data has been attached and
    // filtered. Limiting here caused older prospects with recent replies to be
    // silently excluded from "recent replies" searches.
    .limit(1000);

  if (params.lead_status) {
    q = q.eq("lead_status", params.lead_status);
  }
  if (params.qualification_bucket) {
    q = q.eq("qualification_bucket", params.qualification_bucket);
  }

  const { data: rows, error } = await q;
  if (error) return { error: error.message, count: 0, leads: [] };

  const prospectList = rows ?? [];
  const prospectIds = prospectList.map((p) => p.id as string);

  // Fetch recipients & replies for these prospects
  const { data: recipients } =
    prospectIds.length > 0
      ? await supabase
          .from("campaign_recipients")
          .select("id,prospect_id,email,status")
          .in("prospect_id", prospectIds)
      : { data: [] };

  const recipientIds = (recipients ?? []).map((r) => r.id as string);
  const recipientToProspect = new Map<string, string>();
  for (const r of recipients ?? []) {
    if (r.prospect_id) {
      recipientToProspect.set(r.id as string, r.prospect_id as string);
    }
  }

  const { data: replies } =
    recipientIds.length > 0
      ? await supabase
          .from("reply_classifications")
          .select(
            "id,recipient_id,category,confidence,snippet,wants_meeting,created_at",
          )
          .in("recipient_id", recipientIds)
          .order("created_at", { ascending: false })
      : { data: [] };

  const prospectToReply = new Map<
    string,
    {
      id: string;
      category: string;
      confidence: number | null;
      snippet: string | null;
      wants_meeting: boolean;
      created_at: string;
    }
  >();

  for (const rep of replies ?? []) {
    const pId = recipientToProspect.get(rep.recipient_id as string);
    if (pId && !prospectToReply.has(pId)) {
      prospectToReply.set(pId, {
        id: rep.id as string,
        category: (rep.category as string) ?? "other",
        confidence: (rep.confidence as number) ?? null,
        snippet: (rep.snippet as string) ?? null,
        wants_meeting: Boolean(rep.wants_meeting),
        created_at: (rep.created_at as string) ?? new Date().toISOString(),
      });
    }
  }

  // Attach reply to each prospect
  let enrichedList = prospectList.map((p) => {
    const reply = prospectToReply.get(p.id as string);
    return {
      ...p,
      latest_reply: reply ?? null,
    };
  });

  if (params.only_with_replies) {
    enrichedList = enrichedList.filter((p) => Boolean(p.latest_reply));
  }

  // Smart Query Filter
  if (params.query?.trim()) {
    const term = params.query.trim().toLowerCase();

    const asksForQualified =
      term.includes("qualified") ||
      term.includes("hot") ||
      term.includes("warm");
    const asksForReplies =
      term.includes("reply") ||
      term.includes("replies") ||
      term.includes("inbound");

    // Compound requests require both qualification and an actual inbound
    // reply. Previously the qualified branch won and ignored "recent replies".
    if (asksForQualified) {
      enrichedList = enrichedList.filter(
        (r) =>
          (!asksForReplies || Boolean(r.latest_reply)) &&
          (r.lead_status === "qualified" ||
            r.lead_status === "engaged" ||
            r.qualification_bucket === "hot" ||
            r.qualification_bucket === "warm" ||
            r.latest_reply?.category === "interested"),
      );
    } else if (asksForReplies) {
      enrichedList = enrichedList.filter(
        (r) =>
          Boolean(r.latest_reply) ||
          r.lead_status === "replied" ||
          r.lead_status === "qualified" ||
          r.input_name?.toLowerCase().includes(term) ||
          r.input_company?.toLowerCase().includes(term),
      );
    } else {
      enrichedList = enrichedList.filter(
        (r) =>
          r.input_name?.toLowerCase().includes(term) ||
          r.input_company?.toLowerCase().includes(term) ||
          r.email?.toLowerCase().includes(term) ||
          r.input_title?.toLowerCase().includes(term) ||
          r.lead_status?.toLowerCase().includes(term) ||
          r.qualification_bucket?.toLowerCase().includes(term) ||
          r.latest_reply?.snippet?.toLowerCase().includes(term),
      );
    }
  }

  // Reply-oriented results should mean "recent replies", not merely recently
  // created prospect rows. Prospects without replies naturally sort last.
  if (
    params.only_with_replies ||
    /\b(reply|replies|inbound)\b/i.test(params.query ?? "")
  ) {
    enrichedList.sort((a, b) =>
      (b.latest_reply?.created_at ?? "").localeCompare(
        a.latest_reply?.created_at ?? "",
      ),
    );
  }

  enrichedList = enrichedList.slice(0, limit);

  return {
    count: enrichedList.length,
    leads: enrichedList.map((r) => ({
      lead_id: r.id as string,
      job_id: r.job_id as string,
      name: r.input_name,
      company: r.input_company,
      title: r.input_title,
      email: r.email,
      phone: r.phone,
      lead_status: r.lead_status,
      qualification_bucket: r.qualification_bucket ?? "not_determined",
      next_action: r.next_action ?? "none",
      latest_inbound_reply: r.latest_reply?.snippet ?? null,
      reply_category: r.latest_reply?.category ?? null,
      wants_meeting: r.latest_reply?.wants_meeting ?? false,
      handoff_summary: r.handoff_summary ?? null,
      has_draft_email: Boolean(r.email_subject && r.email_body),
      outbound_email_subject: r.email_subject,
      outbound_email_body: r.email_body,
    })),
    message:
      enrichedList.length > 0
        ? `Found ${enrichedList.length} matching lead(s) in your account.`
        : "No matching leads found.",
  };
}

// ---------------------------------------------------------------------
// enrich_lead — enrich and draft email for a single existing lead by ID or Name
// ---------------------------------------------------------------------

export async function handleEnrichLead(
  params: { lead_id?: string; name?: string; draft_email?: boolean },
  ctx: ToolContext,
) {
  const supabase = createAdminClient();
  const draftEmail = params.draft_email !== false;

  const { data: userJobs } = await supabase
    .from("jobs")
    .select("id")
    .eq("user_id", ctx.userId);
  const jobIds = (userJobs ?? []).map((j) => j.id as string);
  if (!jobIds.length) return { error: "No leads found in your account." };

  type FoundLead = {
    id: string;
    job_id: string;
    input_name: string | null;
    input_company: string | null;
    input_title: string | null;
    input_linkedin_url: string | null;
    email: string | null;
    phone: string | null;
  };
  let prospect: FoundLead | null = null;
  const isUuid = (val?: string) =>
    Boolean(
      val &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        val.trim(),
      ),
    );

  if (params.lead_id && isUuid(params.lead_id)) {
    const { data: p } = await supabase
      .from("prospects")
      .select(
        "id,job_id,input_name,input_company,input_title,input_linkedin_url,email,phone",
      )
      .eq("id", params.lead_id.trim())
      .in("job_id", jobIds)
      .maybeSingle();
    if (p) prospect = p as unknown as FoundLead;
  }

  if (!prospect) {
    const searchName = (
      params.name || (!isUuid(params.lead_id) ? params.lead_id : "")
    )?.trim();
    if (searchName) {
      const { data: rows } = await supabase
        .from("prospects")
        .select(
          "id,job_id,input_name,input_company,input_title,input_linkedin_url,email,phone",
        )
        .in("job_id", jobIds)
        .or(`input_name.ilike.%${searchName}%,email.ilike.%${searchName}%`)
        .limit(1);
      if (rows?.[0]) prospect = rows[0] as unknown as FoundLead;
    }
  }

  if (!prospect) {
    return {
      error:
        "Lead not found in your database. Use search_leads to find existing leads.",
    };
  }

  const resolvedWriting = await resolveAiModel(ctx.userId, "writing");
  const cost = enrichmentBundleCredits(
    resolvedWriting?.modelId ?? "claude-sonnet-4-6",
  );
  const gate = await checkCredits(ctx.userId, cost);
  if (!gate.ok) {
    return {
      error:
        gate.reason ??
        `Insufficient credits (${gate.remaining}/${gate.required}).`,
    };
  }

  const deduction = await deductCredits({
    userId: ctx.userId,
    count: cost,
    jobId: prospect.job_id as string,
    reason: `enrich_lead_${prospect.id}`,
  });
  if (!deduction.ok)
    return { error: deduction.error ?? "Failed to deduct credits." };

  const { data: userRow } = await supabase
    .from("users")
    .select("voice_anchor_text, outreach_language")
    .eq("id", ctx.userId)
    .maybeSingle();
  const voiceAnchor = (userRow?.voice_anchor_text as string | null) ?? null;
  const outreachLanguage =
    (userRow?.outreach_language as string | null) ?? null;
  const approvedContext = await loadApprovedDraftContext(ctx.userId);

  const candidate: ProspectCandidate = {
    name: (prospect.input_name as string) ?? "Unknown",
    title: (prospect.input_title as string) ?? "(unknown role)",
    company: (prospect.input_company as string) ?? "(unknown company)",
    source: "named",
    source_url: (prospect.input_linkedin_url as string) ?? "",
    snippet: "Database lead prospect.",
  };

  const draft = draftEmail
    ? await draftForProspect({
        userId: ctx.userId,
        prospect: candidate,
        voiceAnchor,
        language: outreachLanguage,
        customerContext: approvedContext.sellerContext,
        playbookGuidance: approvedContext.playbookGuidance,
      })
    : null;

  let emailUpdate: string | null = (prospect.email as string | null) ?? null;
  let emailSource = emailUpdate ? "extracted" : "none";
  let emailConfidence: "high" | "risky" | "invalid" | "unknown" = "unknown";

  if (!emailUpdate) {
    const domain = guessDomainFromCompany(candidate.company);
    const guess = domain ? bestGuessEmail(candidate.name, domain) : null;
    if (guess) {
      const mx = await verifyDomainMx(domain!);
      emailConfidence =
        mx.confidence === "no_mx"
          ? "invalid"
          : mx.confidence === "mx_verified"
            ? "risky"
            : "unknown";
      emailUpdate = emailConfidence === "invalid" ? null : guess.email;
      emailSource = emailUpdate ? "pattern_guessed" : "none";
    }
  }

  await supabase
    .from("prospects")
    .update({
      status: "completed",
      ...(emailUpdate !== null && {
        email: emailUpdate,
        email_source: emailSource,
        email_confidence: emailConfidence,
      }),
      research_summary: draft?.research_summary ?? null,
      email_subject: draft?.email_subject ?? null,
      email_body: draft?.email_body ?? null,
      talking_points: draft?.talking_points ?? null,
      context_version: Number(approvedContext.context?.version ?? 0) || null,
      context_snapshot: approvedContext.snapshot,
      playbook_example_ids: approvedContext.approved.map((e) => e.id),
      completed_at: new Date().toISOString(),
    })
    .eq("id", prospect.id);

  return {
    lead_id: prospect.id,
    job_id: prospect.job_id,
    name: candidate.name,
    company: candidate.company,
    email: emailUpdate,
    email_subject: draft?.email_subject ?? null,
    email_body: draft?.email_body ?? null,
    research_summary: draft?.research_summary ?? null,
    credits_remaining: deduction.remaining,
    message: `Drafted qualification email for ${candidate.name} (${candidate.company}). Email: ${emailUpdate ?? "none"}. Ready to send with launch_campaign.`,
  };
}

// launch_campaign — close the loop: turn enriched prospects into queued
// sends from a connected mailbox.
//
// v1.1 scope: schedules each prospect's already-drafted first-touch
// email immediately (the send-due cron handles throttling + warm-up +
// suppression at send time). Multi-step cadence advancement comes in
// v1.2; the sequence_id is recorded for that future expansion.
// ---------------------------------------------------------------------

export async function handleLaunchCampaign(
  params: {
    name?: string;
    job_id?: string;
    lead_id?: string;
    lead_name?: string;
    mailbox_id?: string;
    sequence_id?: string;
    channel?: "email" | "whatsapp";
    whatsapp_template?: string;
    whatsapp_language?: string;
  },
  ctx: ToolContext,
) {
  const supabase = createAdminClient();
  const channel = params.channel ?? "email";
  const campaignName = params.name?.trim() || "Outreach Campaign";

  // Resolve user's jobs
  const { data: userJobs } = await supabase
    .from("jobs")
    .select("id")
    .eq("user_id", ctx.userId);
  const userJobIds = (userJobs ?? []).map((j) => j.id as string);

  let jobId = params.job_id;
  let targetProspectRows: Array<Record<string, unknown>> | null = null;

  const isUuid = (val?: string) =>
    Boolean(
      val &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        val.trim(),
      ),
    );

  // 1. Try finding by UUID lead_id
  if (params.lead_id && isUuid(params.lead_id)) {
    const { data: singleLead } = await supabase
      .from("prospects")
      .select(
        "id,job_id,email,email_subject,email_body,context_version,context_snapshot,playbook_example_ids",
      )
      .eq("id", params.lead_id.trim())
      .maybeSingle();
    if (singleLead) {
      targetProspectRows = [singleLead as unknown as Record<string, unknown>];
      jobId = (singleLead.job_id as string) ?? jobId;
    }
  }

  // 2. Try finding by lead name or string lead_id if not UUID
  if (!targetProspectRows && userJobIds.length > 0) {
    const searchName = (
      params.lead_name || (!isUuid(params.lead_id) ? params.lead_id : "")
    )?.trim();
    if (searchName) {
      const { data: matched } = await supabase
        .from("prospects")
        .select(
          "id,job_id,input_name,email,email_subject,email_body,context_version,context_snapshot,playbook_example_ids",
        )
        .in("job_id", userJobIds)
        .or(`input_name.ilike.%${searchName}%,email.ilike.%${searchName}%`)
        .limit(1);
      if (matched?.[0]) {
        targetProspectRows = [matched[0] as unknown as Record<string, unknown>];
        jobId = (matched[0].job_id as string) ?? jobId;
      }
    }
  }

  // 3. If still no targetProspectRows and no jobId, find the most recently drafted lead
  if (!targetProspectRows && !jobId && userJobIds.length > 0) {
    const { data: recentDrafted } = await supabase
      .from("prospects")
      .select(
        "id,job_id,input_name,email,email_subject,email_body,context_version,context_snapshot,playbook_example_ids",
      )
      .in("job_id", userJobIds)
      .not("email_body", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (recentDrafted?.[0]) {
      targetProspectRows = [
        recentDrafted[0] as unknown as Record<string, unknown>,
      ];
      jobId = (recentDrafted[0].job_id as string) ?? jobId;
    }
  }

  // 4. Resolve fallback job
  if (!jobId) {
    const { data: latest } = await supabase
      .from("jobs")
      .select("id")
      .eq("user_id", ctx.userId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    jobId = (latest?.id as string | undefined) ?? undefined;
  }
  if (!jobId && !targetProspectRows) {
    return {
      error: "No completed job or lead to launch from. Run enrichment first.",
    };
  }

  if (channel === "whatsapp") {
    return launchWhatsAppCampaign(
      {
        name: campaignName,
        job_id: jobId!,
        sequence_id: params.sequence_id,
        whatsapp_template: params.whatsapp_template,
        whatsapp_language: params.whatsapp_language,
      },
      ctx,
      supabase,
    );
  }

  // ---------- EMAIL PATH (unchanged behaviour) ----------

  // Resolve the sending mailbox (validate explicit UUID against user's active mailboxes, else use user's active one).
  let mailboxId: string | undefined = undefined;
  if (params.mailbox_id && isUuid(params.mailbox_id)) {
    const { data: explicitMb } = await supabase
      .from("mailboxes")
      .select("id")
      .eq("id", params.mailbox_id.trim())
      .eq("user_id", ctx.userId)
      .eq("status", "active")
      .maybeSingle();
    if (explicitMb) {
      mailboxId = explicitMb.id as string;
    }
  }

  if (!mailboxId) {
    const { data: mb } = await supabase
      .from("mailboxes")
      .select("id,email_address,oauth_refresh_token_encrypted,physical_address")
      .eq("user_id", ctx.userId)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    mailboxId = (mb?.id as string | undefined) ?? undefined;
  }
  if (!mailboxId) {
    return {
      error:
        "No connected mailbox found. Please connect your Gmail account at Settings → Mailboxes before launching a campaign.",
    };
  }

  let prospectRows = targetProspectRows;
  if (!prospectRows && jobId) {
    const { data: rows } = await supabase
      .from("prospects")
      .select(
        "id,email,email_subject,email_body,context_version,context_snapshot,playbook_example_ids",
      )
      .eq("job_id", jobId);
    prospectRows = (rows ?? []) as unknown as Array<Record<string, unknown>>;
  }

  // Only prospects with both an email AND a drafted subject+body are sendable.
  const sendable = (prospectRows ?? []).filter(
    (p) => p.email && p.email_subject && p.email_body,
  );
  if (sendable.length === 0) {
    return {
      error:
        "No sendable prospects found (each needs an email + a drafted subject and body). Run enrich_lead or enrich_intake_job first.",
    };
  }

  // Filter out globally-suppressed addresses up front.
  const { data: suppressed } = await supabase
    .from("suppressions")
    .select("email_hash")
    .eq("user_id", ctx.userId);
  const suppressedHashes = new Set(
    (suppressed ?? []).map((s) => s.email_hash as string),
  );

  // Create the campaign.
  const validSequenceId =
    params.sequence_id && isUuid(params.sequence_id)
      ? params.sequence_id.trim()
      : null;
  const validSourceJobId = jobId && isUuid(jobId) ? jobId.trim() : null;

  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .insert({
      user_id: ctx.userId,
      mailbox_id: mailboxId,
      sequence_id: validSequenceId,
      source_job_id: validSourceJobId,
      name: campaignName,
      status: "active",
    })
    .select("id")
    .single();
  if (campErr || !campaign) {
    return { error: campErr?.message ?? "Failed to create campaign." };
  }

  // Seed recipients — frozen copy of the drafted content, scheduled now.
  const recipientInserts: Array<Record<string, unknown>> = [];
  const enrollmentInserts: Array<Record<string, unknown>> = [];
  let skipped = 0;

  for (const p of sendable) {
    const emailHash = sha256Email(p.email as string);
    if (suppressedHashes.has(emailHash)) {
      skipped++;
      continue;
    }

    recipientInserts.push({
      campaign_id: campaign.id,
      user_id: ctx.userId,
      prospect_id: p.id,
      email: p.email,
      subject: p.email_subject,
      body: p.email_body,
      context_version: p.context_version,
      context_snapshot: p.context_snapshot,
      playbook_example_ids: p.playbook_example_ids,
      channel: "email",
      status: "scheduled",
      scheduled_for: new Date().toISOString(),
    });

    if (validSequenceId) {
      enrollmentInserts.push({
        sequence_id: validSequenceId,
        prospect_id: p.id,
        status: "active",
        current_step: 0,
      });
    }
  }

  if (recipientInserts.length === 0) {
    await supabase
      .from("campaigns")
      .update({ status: "completed" })
      .eq("id", campaign.id);
    return {
      error: "All sendable prospects are on your suppression list.",
      campaign_id: campaign.id,
    };
  }

  const { data: insertedRecipients } = await supabase
    .from("campaign_recipients")
    .insert(recipientInserts)
    .select("id,email,subject,body");

  if (enrollmentInserts.length > 0) {
    await supabase.from("sequence_enrollments").insert(enrollmentInserts);
  }

  // Attempt immediate send for the inserted recipient(s) so test/single sends deliver instantly!
  let immediateSent = 0;
  const { data: mailbox } = await supabase
    .from("mailboxes")
    .select("id,email_address,oauth_refresh_token_encrypted,physical_address")
    .eq("id", mailboxId)
    .maybeSingle();

  if (mailbox?.oauth_refresh_token_encrypted && insertedRecipients) {
    for (const r of insertedRecipients) {
      try {
        const unsubToken = makeUnsubToken(r.id as string, ctx.userId);
        const bodyWithFooter = appendComplianceFooter({
          body: r.body as string,
          unsubToken,
          physicalAddress: (mailbox.physical_address as string | null) ?? null,
          appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        });

        const sent = await sendGmail({
          refreshToken: decryptCredential(
            mailbox.oauth_refresh_token_encrypted as string,
          ),
          from: mailbox.email_address as string,
          to: r.email as string,
          subject: r.subject as string,
          body: bodyWithFooter,
        });

        await supabase
          .from("campaign_recipients")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            message_id: sent.messageId,
            thread_id: sent.threadId,
          })
          .eq("id", r.id as string);

        await supabase.from("email_events").insert({
          recipient_id: r.id,
          user_id: ctx.userId,
          event_type: "sent",
          payload: { mock: sent.mock },
        });
        immediateSent++;
      } catch (err) {
        console.error("Immediate send attempt failed, queued for cron:", err);
      }
    }
  }

  if (immediateSent > 0 || recipientInserts.length > 0) {
    const leadIds = sendable.map((p) => p.id as string).filter(Boolean);
    if (leadIds.length > 0) {
      await supabase
        .from("prospects")
        .update({ lead_status: "contacted", next_action: "follow_up" })
        .in("id", leadIds);
    }
  }

  return {
    campaign_id: campaign.id,
    channel: "email" as const,
    sent_immediately: immediateSent,
    scheduled: recipientInserts.length - immediateSent,
    suppressed_skipped: skipped,
    message:
      immediateSent > 0
        ? `Email successfully sent to ${immediateSent} recipient(s) from ${mailbox?.email_address ?? "your connected Gmail"}.`
        : `Recipients queued for delivery from ${mailbox?.email_address ?? "your connected Gmail"}.`,
  };
}

// ---------------------------------------------------------------------
// WhatsApp campaign launch — separate path because the send model is
// different:
//   - cold outreach REQUIRES a pre-approved template (BSP policy)
//   - no per-account warm-up cap exposed by BSPs the way Gmail has them
//     (rate-limiting happens at the BSP), so we send immediately and
//     record the per-recipient result rather than scheduling
//   - mailboxes don't apply
//   - sendable filter is: phone present AND not opted out
//   - the template's {{1}} {{2}} placeholders are filled with the
//     prospect's first_name + company in that fixed order; users can
//     design templates to match. Body/subject columns are not used.
// ---------------------------------------------------------------------

async function launchWhatsAppCampaign(
  params: {
    name: string;
    job_id: string;
    sequence_id?: string;
    whatsapp_template?: string;
    whatsapp_language?: string;
  },
  ctx: ToolContext,
  supabase: ReturnType<typeof createAdminClient>,
) {
  if (!params.whatsapp_template) {
    return {
      error:
        "WhatsApp campaigns require a pre-approved template name. Pass whatsapp_template.",
    };
  }

  const { data: prospectRows } = await supabase
    .from("prospects")
    .select("id,phone,whatsapp_opted_out,input_name,input_company")
    .eq("job_id", params.job_id);

  const reachable = (prospectRows ?? []).filter(
    (p) =>
      typeof p.phone === "string" &&
      p.phone.trim().length > 0 &&
      p.whatsapp_opted_out !== true,
  );
  if (reachable.length === 0) {
    return {
      error:
        "No reachable prospects (each needs a phone number and must not be opted out). Capture phones during enrichment or import them via CSV.",
    };
  }

  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .insert({
      user_id: ctx.userId,
      sequence_id: params.sequence_id ?? null,
      source_job_id: params.job_id,
      name: params.name,
      status: "active",
    })
    .select("id")
    .single();
  if (campErr || !campaign) {
    return { error: campErr?.message ?? "Failed to create campaign." };
  }

  const language = params.whatsapp_language ?? "en";
  const template = params.whatsapp_template;
  let sent = 0;
  let failed = 0;
  const recipientInserts: Array<Record<string, unknown>> = [];
  let usedMock = false;

  for (const p of reachable) {
    const phone = normalizeWhatsAppNumber(p.phone as string);
    const firstName =
      typeof p.input_name === "string"
        ? (p.input_name.split(/\s+/)[0] ?? "")
        : "";
    const company = typeof p.input_company === "string" ? p.input_company : "";
    const res = await sendWhatsAppTemplate({
      to: phone,
      template,
      languageCode: language,
      params: [firstName, company],
    });
    if (res.mock) usedMock = true;
    const ok = !res.error;
    if (ok) sent++;
    else failed++;

    recipientInserts.push({
      campaign_id: campaign.id,
      user_id: ctx.userId,
      prospect_id: p.id,
      email: null,
      subject: template,
      body: `[whatsapp template] ${template} (${language})`,
      channel: "whatsapp",
      status: ok ? "sent" : "failed",
      scheduled_for: new Date().toISOString(),
      sent_at: ok ? new Date().toISOString() : null,
      message_id: ok ? res.messageId : null,
      bounce_reason: ok ? null : (res.error ?? "send_failed"),
    });
  }

  if (recipientInserts.length > 0) {
    await supabase.from("campaign_recipients").insert(recipientInserts);
  }

  return {
    campaign_id: campaign.id,
    channel: "whatsapp" as const,
    sent,
    failed,
    template,
    language,
    using_mock_data: usedMock,
    note: ok2Note(sent, failed),
  };
}

function ok2Note(sent: number, failed: number): string {
  if (sent > 0 && failed === 0) {
    return `${sent} WhatsApp message(s) dispatched. Replies will appear in Inbox; STOP/UNSUBSCRIBE replies auto-suppress further sends.`;
  }
  if (sent > 0 && failed > 0) {
    return `${sent} sent, ${failed} failed (BSP rejected — check whatsapp template approval and recipient phone format).`;
  }
  return `0 sent, ${failed} failed. Check WhatsApp template approval and that recipient phones are in international format.`;
}

// ---------------------------------------------------------------------
// send_whatsapp — single outbound WhatsApp message (India/SEA's highest-
// response channel). Mock-safe via the provider; owned by the Outreach
// specialist. Use for opted-in contacts/replies or a user-supplied number.
// ---------------------------------------------------------------------

export async function handleSendWhatsApp(
  params: { to: string; message: string },
  _ctx: ToolContext,
) {
  const res = await sendWhatsApp({ to: params.to, text: params.message });
  return {
    to: params.to,
    sent: !res.error,
    message_id: res.messageId,
    using_mock_data: res.mock,
    error: res.error,
  };
}

// ---------------------------------------------------------------------
// push_to_crm — sync a completed job's enriched prospects into HubSpot
// (upsert contact by email + optional research-summary note). Mock-safe
// via the provider; owned by the Outreach specialist. Skips prospects
// without an email or with email_confidence='invalid' (no point creating
// a dead contact). Caps at 100 per call to avoid orchestrator timeouts.
// ---------------------------------------------------------------------

const CRM_BATCH_CAP = 100;

export async function handlePushToCrm(
  params: { job_id?: string; include_note?: boolean; crm?: "hubspot" | "zoho" },
  ctx: ToolContext,
) {
  // Dispatch by CRM. Provider surfaces match by design so the rest of
  // this handler is vendor-agnostic.
  const crm = params.crm ?? "hubspot";
  const pushFn = crm === "zoho" ? pushZohoContact : pushContact;
  const noteFn = crm === "zoho" ? addZohoNote : addNote;
  const supabase = createAdminClient();

  let jobId = params.job_id;
  if (!jobId) {
    const { data: latest } = await supabase
      .from("jobs")
      .select("id")
      .eq("user_id", ctx.userId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    jobId = (latest?.id as string | undefined) ?? undefined;
  }
  if (!jobId) {
    return { error: "No completed job to push. Run a bulk enrichment first." };
  }

  // Confirm the caller owns the job before pulling prospects (we use the
  // admin client which bypasses RLS).
  const { data: job } = await supabase
    .from("jobs")
    .select("id, user_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.user_id !== ctx.userId) {
    return { error: "Job not found." };
  }

  const { data: prospects } = await supabase
    .from("prospects")
    .select(
      "id, input_name, input_company, input_linkedin_url, email, email_confidence, research_summary, email_subject, email_body, company_domain",
    )
    .eq("job_id", jobId)
    .neq("email", null)
    .neq("email_confidence", "invalid")
    .order("created_at", { ascending: true })
    .limit(CRM_BATCH_CAP);

  const rows = prospects ?? [];
  if (rows.length === 0) {
    return {
      job_id: jobId,
      pushed: 0,
      created: 0,
      updated: 0,
      failed: 0,
      errors: [],
      note: "No prospects with valid emails on this job.",
    };
  }

  const includeNote = params.include_note !== false;
  let created = 0;
  let updated = 0;
  let failed = 0;
  let anyMock = false;
  const errors: Array<{ email: string; error: string }> = [];

  for (const p of rows) {
    const email = (p.email as string | null) ?? "";
    if (!email) {
      failed++;
      continue;
    }
    const [firstName, ...rest] = ((p.input_name as string | null) ?? "")
      .trim()
      .split(/\s+/);
    const lastName = rest.join(" ").trim() || undefined;

    const contact = await pushFn({
      email,
      first_name: firstName || undefined,
      last_name: lastName,
      company: (p.input_company as string | null) ?? undefined,
      linkedin_url: (p.input_linkedin_url as string | null) ?? undefined,
      source_url: (p.company_domain as string | null) ?? undefined,
    });
    if (contact.mock) anyMock = true;
    if (!contact.ok || !contact.contact_id) {
      failed++;
      errors.push({ email, error: contact.error ?? "push failed" });
      continue;
    }
    if (contact.created) created++;
    else updated++;

    if (includeNote) {
      const noteBody = buildCrmNote(p);
      if (noteBody) {
        const noteRes = await noteFn(contact.contact_id, { body: noteBody });
        if (noteRes.mock) anyMock = true;
        if (!noteRes.ok) {
          errors.push({
            email,
            error: `note failed: ${noteRes.error ?? "unknown"}`,
          });
        }
      }
    }
  }

  return {
    job_id: jobId,
    crm,
    pushed: created + updated,
    created,
    updated,
    failed,
    errors: errors.slice(0, 10),
    using_mock_data: anyMock,
  };
}

function buildCrmNote(p: {
  input_name: string | null;
  input_company: string | null;
  research_summary: string | null;
  email_subject: string | null;
  email_body: string | null;
}): string {
  const lines: string[] = [];
  lines.push(
    `Aravya SalesEngAI enrichment — ${p.input_name ?? "Prospect"}${p.input_company ? ` @ ${p.input_company}` : ""}`,
  );
  if (p.research_summary) {
    lines.push("");
    lines.push("Research summary:");
    lines.push(p.research_summary);
  }
  if (p.email_subject || p.email_body) {
    lines.push("");
    lines.push("Drafted outreach:");
    if (p.email_subject) lines.push(`Subject: ${p.email_subject}`);
    if (p.email_body) lines.push(p.email_body);
  }
  return lines.join("\n").trim();
}

// ---------------------------------------------------------------------
// draft_reply — closes the reply loop. Given a reply_classification id,
// pulls the original outbound + the reply + the prospect, drafts a
// contextual response via Claude (mock-safe), returns it for the user
// to review/send. Does NOT auto-send — the user always presses the
// final button. Owned by the Outreach specialist.
// ---------------------------------------------------------------------

export async function handleDraftReply(
  params: { reply_classification_id: string },
  ctx: ToolContext,
) {
  const supabase = createAdminClient();

  const { data: rc } = await supabase
    .from("reply_classifications")
    .select("id, recipient_id, user_id, category, snippet")
    .eq("id", params.reply_classification_id)
    .maybeSingle();
  if (!rc || rc.user_id !== ctx.userId) {
    return { error: "reply not found" };
  }

  const { data: recipient } = await supabase
    .from("campaign_recipients")
    .select("id, prospect_id, subject, body, campaign_id")
    .eq("id", rc.recipient_id as string)
    .maybeSingle();
  if (!recipient) {
    return { error: "original outbound not found" };
  }

  const { data: prospect } = recipient.prospect_id
    ? await supabase
        .from("prospects")
        .select("input_name, input_company")
        .eq("id", recipient.prospect_id as string)
        .maybeSingle()
    : { data: null };

  const { data: profile } = await supabase
    .from("users")
    .select("voice_anchor_text, outreach_language, calendar_url")
    .eq("id", ctx.userId)
    .maybeSingle();

  const wantsMeeting = detectWantsMeeting(rc.snippet as string | null);

  const draft = await draftReplyResponse({
    userId: ctx.userId,
    prospect: {
      name: (prospect?.input_name as string | null) ?? "there",
      title: null,
      company: (prospect?.input_company as string | null) ?? null,
    },
    original_subject: (recipient.subject as string | null) ?? "",
    original_body: (recipient.body as string | null) ?? "",
    reply_snippet: (rc.snippet as string | null) ?? "",
    reply_category: rc.category as
      | "interested"
      | "question"
      | "objection"
      | "out_of_office"
      | "unsubscribe"
      | "not_interested"
      | "other",
    wants_meeting: wantsMeeting,
    voiceAnchor: (profile?.voice_anchor_text as string | null) ?? null,
    language: (profile?.outreach_language as string | null) ?? null,
    calendar_url: (profile?.calendar_url as string | null) ?? null,
  });

  return {
    reply_classification_id: rc.id,
    recipient_id: recipient.id,
    category: rc.category,
    wants_meeting: wantsMeeting,
    draft,
    using_mock_data: !(await resolveAiModel(ctx.userId, "writing")),
  };
}

/**
 * Lightweight booking-intent detector for the snippet alone — keyword
 * pass, no LLM. The reply-classifier's wants_meeting field (set on
 * insert) is the authoritative signal; this is a fallback when
 * handleDraftReply is invoked on a pre-existing row that predates
 * that field. Conservative regex; better to miss than to false-positive.
 */
function detectWantsMeeting(snippet: string | null): boolean {
  if (!snippet) return false;
  const lower = snippet.toLowerCase();
  return /\b(calendar|calendly|book.*meeting|schedule.*call|set.*up.*call|when.*free|what.*works|let.*chat|let.*talk|hop on.*call|jump on.*call|15.?min|20.?min|30.?min)\b/.test(
    lower,
  );
}
