/**
 * Concrete implementations of each chat tool.
 *
 * These run server-side inside the streaming /api/chat route. They use
 * the service-role Supabase client so they can write across RLS — the
 * userId is passed in from the request handler after auth.
 */

import { createAdminClient } from "@/lib/supabase/server";
import crypto from "node:crypto";
import { type ProspectCandidate } from "@/lib/providers/brave-search";
import {
  draftForProspect,
  draftReplyResponse,
} from "@/lib/providers/anthropic";
import { resolveAiModel } from "@/lib/ai-config";
import {
  createLeadHandoff,
  deliverLeadHandoffNotifications,
} from "@/lib/unified-lead-handoff";
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
import { runConvertibleDiscovery } from "@/lib/discovery/discovery-orchestrator";
import {
  isApolloConfigured,
  bulkMatchPeople,
} from "@/lib/discovery/apollo-client";
import type { ScoredProspectCandidate } from "@/lib/discovery/types";
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
import { buildProspectIdentity } from "@/lib/prospect-identity";
import { enrichmentBundleCredits } from "@/lib/credit-costs";
import {
  enqueueProspectEnrichment,
  captureEnrichmentDispatchCounts,
} from "@/lib/enrichment/enqueue";
import { enrichMultipleDomainsDirect } from "@/lib/enrichment/direct-enrichment";
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
import {
  hasExplicitVoiceCallAuthorization,
  uiMessageText,
} from "@/lib/voice/chat-call-authorization";
import {
  startQualificationCall,
  VoiceCallStartError,
} from "@/lib/voice/start-qualification-call";
import { withinCallingHours } from "@/lib/voice-compliance";
import { getVoiceAnalytics } from "@/lib/voice/voice-analytics";
import {
  applyCrmPull,
  previewCrmPull,
  type CrmProvider,
  type CrmPullDatabase,
} from "@/lib/crm-pull";
import {
  dispatchAutonomousOutreach,
  type OutreachChannel,
} from "@/lib/outreach/autonomous-dispatcher";
import {
  provisionBolnaQualificationAgent,
  updateBolnaQualificationAgent,
} from "@/lib/voice/providers/bolna";
import { voiceWebhookSignature } from "@/lib/voice-compliance";
import type {
  CallDetailsInput,
  CrmSyncInput,
  FollowupInput,
  QualificationBatchInput,
  TriggerOutreachInput,
  VoiceAgentInput,
} from "@/lib/agent/sales-tool-schemas";
import {
  filterLeadsByAvailability,
  filterLeadsByCallStatus,
  filterLeadsByPhone,
  filterLeadsByQuery,
  filterLeadsByTimeRange,
  type LeadForFiltering,
} from "@/lib/agent/lead-search-core";

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
  const fullInstruction = [
    params.query,
    params.target_role ? `role: ${params.target_role}` : "",
    params.industry ? `industry: ${params.industry}` : "",
    params.location ? `location: ${params.location}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const cacheKey = `convertible_discovery:${ctx.userId}:${params.query}:${params.target_role ?? ""}:${params.industry ?? ""}:${params.location ?? ""}:${params.max_results}`;
  const discoveryResult = await getOrSetCache(cacheKey, 7 * 86_400, () =>
    runConvertibleDiscovery(fullInstruction, ctx.userId, params.max_results),
  );

  const candidates = discoveryResult.candidates.slice(0, params.max_results);

  // Persist candidates so a later start_bulk_job or save_candidates_to_leads can reference them by ID.
  const supabase = createAdminClient();
  const inserted: Array<{ id: string; candidate: ScoredProspectCandidate }> =
    [];
  let persistenceError: string | null = null;

  if (candidates.length > 0) {
    const rows = candidates.map((c) => ({
      session_id: ctx.sessionId,
      source: c.source === "apollo" ? "serper" : c.source,
      source_ref: c.sourceUrl || c.linkedinUrl || null,
      preview: {
        name: c.name,
        title: c.title,
        company: c.company,
        location: c.location,
        source: c.source,
        source_url: c.sourceUrl || c.linkedinUrl || "",
        snippet: c.snippet || "",
        apolloId: c.apolloId,
        domain: c.domain,
        linkedinUrl: c.linkedinUrl,
        convertibilityScore: c.convertibilityScore,
        intentBucket: c.intentBucket,
        primaryTrigger: c.primaryTrigger,
        suggestedHook: c.suggestedHook,
        signals: c.signals,
      },
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
          candidate: row.preview as unknown as ScoredProspectCandidate,
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
    sourceUsed: discoveryResult.sourceUsed,
    using_mock_data: discoveryResult.sourceUsed === "mock",
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
    prospects?: Array<{
      name: string;
      company?: string;
      title?: string;
      linkedin_url?: string;
      company_domain?: string;
    }>;
    save_all_staged?: boolean;
  },
  ctx: ToolContext,
) {
  const supabase = createAdminClient();

  // Look up recent prospect_candidates in this session to match apolloId / signals / enriched data
  const { data: sessionCandidates } = await supabase
    .from("prospect_candidates")
    .select("preview, created_at")
    .eq("session_id", ctx.sessionId)
    .order("created_at", { ascending: false })
    .limit(50);

  // Candidate preview payloads are persisted JSON with provider-specific shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidateMap = new Map<string, any>();
  if (sessionCandidates) {
    for (const row of sessionCandidates) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = row.preview as any;
      if (p?.name) {
        candidateMap.set(p.name.trim().toLowerCase(), p);
      }
      if (p?.company) {
        candidateMap.set(p.company.trim().toLowerCase(), p);
      }
    }
  }

  let prospectsToSave: Array<{
    name: string;
    company?: string;
    title?: string;
    linkedin_url?: string;
    company_domain?: string;
    phone?: string | null;
    email?: string | null;
    is_enriched?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    match?: any;
  }> = [];

  if (
    params.save_all_staged ||
    !params.prospects ||
    params.prospects.length === 0
  ) {
    if (sessionCandidates && sessionCandidates.length > 0) {
      const seen = new Set<string>();
      for (const row of sessionCandidates) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = row.preview as any;
        const key = (p?.company || p?.name || "").trim().toLowerCase();
        if (key && !seen.has(key)) {
          seen.add(key);
          prospectsToSave.push({
            name: p.name || "Leadership Team",
            company: p.company,
            title: p.title,
            linkedin_url: p.linkedinUrl || p.source_url,
            company_domain: p.domain,
            phone: p.phone || null,
            email: p.email || null,
            is_enriched: Boolean(p.is_enriched || p.phone || p.email),
            match: p,
          });
        }
      }
    }
  } else {
    prospectsToSave = params.prospects.slice(0, 50).map((p) => {
      const match =
        candidateMap.get(p.name.trim().toLowerCase()) ||
        (p.company
          ? candidateMap.get(p.company.trim().toLowerCase())
          : undefined);
      return {
        name: p.name.trim(),
        company: p.company?.trim(),
        title: p.title?.trim(),
        linkedin_url: p.linkedin_url?.trim(),
        company_domain: p.company_domain?.trim() || match?.domain,
        phone: match?.phone || null,
        email: match?.email || null,
        is_enriched: Boolean(
          match?.is_enriched || match?.phone || match?.email,
        ),
        match,
      };
    });
  }

  if (prospectsToSave.length === 0) {
    return {
      error:
        "No prospect candidates found in this session or provided to save.",
      count: 0,
      leads: [],
    };
  }

  const apolloIdsToMatch: string[] = [];
  for (const p of prospectsToSave) {
    if (p.match?.apolloId) {
      apolloIdsToMatch.push(p.match.apolloId);
    }
  }

  const contactMap =
    apolloIdsToMatch.length > 0 && isApolloConfigured()
      ? await bulkMatchPeople(apolloIdsToMatch, { revealPhone: true })
      : new Map();

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      user_id: ctx.userId,
      source_session_id: ctx.sessionId,
      input_source: "chat_search",
      status: "completed",
      prospect_count: prospectsToSave.length,
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

  const rowsToInsert = prospectsToSave.map((prospect) => {
    const match = prospect.match;
    const apolloId = match?.apolloId;
    const contact = apolloId ? contactMap.get(apolloId) : undefined;
    const talkingPoints = [
      match?.primaryTrigger,
      match?.suggestedHook,
      match?.signals?.signalSummary,
    ].filter(Boolean);

    const domain =
      prospect.company_domain?.trim() ||
      match?.domain ||
      (prospect.company ? guessDomainFromCompany(prospect.company) : null);

    const email = prospect.email || contact?.email || null;
    const phone = prospect.phone || contact?.phone || null;
    const hasVerifiedContact = Boolean(prospect.is_enriched || email || phone);

    return {
      user_id: ctx.userId,
      job_id: job.id,
      input_source: "chat_search",
      input_name: prospect.name.trim(),
      input_company: prospect.company?.trim() || match?.company || null,
      input_title: prospect.title?.trim() || match?.title || null,
      input_linkedin_url:
        prospect.linkedin_url?.trim() ||
        contact?.linkedinUrl ||
        match?.linkedinUrl ||
        null,
      company_domain: domain,
      email,
      email_confidence:
        contact?.emailStatus === "verified"
          ? "valid"
          : email
            ? "valid"
            : "unknown",
      email_source: email ? "extracted" : "none",
      phone,
      ...buildProspectIdentity({
        email: email || undefined,
        phone: phone || undefined,
      }),
      status: "pending",
      lead_status: "new",
      enrichment_status: hasVerifiedContact ? "completed" : "not_started",
      qualification_bucket: match?.intentBucket === "high" ? "hot" : "warm",
      next_action: phone ? "call" : "review",
      research_summary:
        match?.snippet ||
        (match?.title ? `${match.title} at ${match.company}.` : null),
      talking_points: talkingPoints.length > 0 ? talkingPoints : null,
    };
  });

  const { data: leads, error: leadsError } = await supabase
    .from("prospects")
    .insert(rowsToInsert)
    .select(
      "id,input_name,input_company,input_title,email,phone,company_domain,enrichment_status",
    );
  if (leadsError) {
    await supabase
      .from("jobs")
      .update({ status: "failed", error_reason: leadsError.message })
      .eq("id", job.id);
    return { error: leadsError.message, count: 0, leads: [] };
  }

  let enqueuedCount = 0;
  if (process.env.PUBLIC_CONTACT_ENRICHMENT_ENABLED === "true") {
    // Only enqueue background enrichment for leads that haven't been enriched yet
    const unenrichedLeads = (leads ?? []).filter(
      (row) =>
        row.enrichment_status !== "completed" &&
        typeof row.company_domain === "string" &&
        row.company_domain,
    );
    if (unenrichedLeads.length > 0) {
      const dispatches = unenrichedLeads.map((row) =>
        enqueueProspectEnrichment({
          userId: ctx.userId,
          prospectId: row.id as string,
          domain: row.company_domain as string,
        }),
      );
      const outcomes = await Promise.allSettled(dispatches);
      const counts = captureEnrichmentDispatchCounts(outcomes);
      enqueuedCount = counts.enqueued;
    }
  }

  return {
    job_id: job.id,
    count: leads?.length ?? 0,
    enqueued_enrichment_count: enqueuedCount,
    leads: (leads ?? []).map((lead) => ({
      lead_id: lead.id,
      name: lead.input_name,
      company: lead.input_company,
      title: lead.input_title,
      email: lead.email,
      phone: lead.phone,
      company_domain: lead.company_domain,
    })),
    message:
      enqueuedCount > 0
        ? `Added ${leads?.length ?? 0} lead(s) to the Leads section and queued public contact crawler enrichment for un-enriched leads.`
        : `Added ${leads?.length ?? 0} lead(s) to the Leads section with verified contact details.`,
  };
}

export async function handleEnrichProspectsPublic(
  params: {
    enrich_staged?: boolean;
    lead_ids?: string[];
    lead_id?: string;
    domain?: string;
    query?: string;
    all_unenriched?: boolean;
    limit?: number;
  },
  ctx: ToolContext,
) {
  const supabase = createAdminClient();
  const limit = Math.min(params.limit ?? 20, 50);

  // 1. Gather candidate lead rows
  // 1. If enrich_staged is requested, or if no specific leads were requested and staged candidates exist:
  const isTargetingDbLeads = Boolean(
    (params.lead_ids && params.lead_ids.length > 0) ||
    params.lead_id ||
    params.all_unenriched ||
    params.query,
  );

  if (params.enrich_staged || !isTargetingDbLeads) {
    const { data: stagedCandidates } = await supabase
      .from("prospect_candidates")
      .select("id, preview, created_at")
      .eq("session_id", ctx.sessionId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (
      stagedCandidates &&
      stagedCandidates.length > 0 &&
      (params.enrich_staged || !isTargetingDbLeads)
    ) {
      const domainsToEnrich: string[] = [];
      const rowDomainMap = new Map<string, string>();

      for (const row of stagedCandidates) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const preview = row.preview as any;
        const resolvedDomain =
          params.domain?.trim() ||
          preview?.domain ||
          (preview?.company ? guessDomainFromCompany(preview.company) : null);
        if (resolvedDomain) {
          domainsToEnrich.push(resolvedDomain);
          rowDomainMap.set(row.id, resolvedDomain);
        }
      }

      const enrichmentMap = await enrichMultipleDomainsDirect(domainsToEnrich, {
        userId: ctx.userId,
        concurrency: 3,
      });

      let enrichedCount = 0;
      let totalPhones = 0;
      let totalEmails = 0;
      const candidatesSummary: Array<{
        name: string;
        company: string;
        domain: string | null;
        phone: string | null;
        email: string | null;
        key_contacts: Array<{ name: string; title: string }>;
        status: "enriched" | "partial" | "failed" | "no_domain";
      }> = [];

      for (const row of stagedCandidates) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const preview = row.preview as any;
        const domain = rowDomainMap.get(row.id);
        const enrichment = domain ? enrichmentMap.get(domain) : undefined;

        if (enrichment && enrichment.success) {
          const primaryPhone = enrichment.phones[0] ?? null;
          const primaryEmail = enrichment.emails[0] ?? null;
          if (primaryPhone) totalPhones++;
          if (primaryEmail) totalEmails++;
          if (
            primaryPhone ||
            primaryEmail ||
            enrichment.key_contacts.length > 0
          ) {
            enrichedCount++;
          }

          const updatedPreview = {
            ...preview,
            domain: domain || preview.domain,
            phone: primaryPhone || preview.phone || null,
            email: primaryEmail || preview.email || null,
            public_contacts: {
              phones: enrichment.phones,
              emails: enrichment.emails,
              key_contacts: enrichment.key_contacts,
              social_links: enrichment.social_links,
            },
            is_enriched: true,
          };

          await supabase
            .from("prospect_candidates")
            .update({ preview: updatedPreview })
            .eq("id", row.id);

          candidatesSummary.push({
            name: preview.name || "Leadership Team",
            company: preview.company || "Company",
            domain: domain || null,
            phone: primaryPhone,
            email: primaryEmail,
            key_contacts: enrichment.key_contacts,
            status:
              primaryPhone && primaryEmail
                ? "enriched"
                : primaryPhone || primaryEmail
                  ? "partial"
                  : "failed",
          });
        } else {
          candidatesSummary.push({
            name: preview.name || "Leadership Team",
            company: preview.company || "Company",
            domain: domain || null,
            phone: null,
            email: null,
            key_contacts: [],
            status: domain ? "failed" : "no_domain",
          });
        }
      }

      return {
        success: true,
        mode: "staged",
        total_staged: stagedCandidates.length,
        enriched_count: enrichedCount,
        phones_found: totalPhones,
        emails_found: totalEmails,
        candidates: candidatesSummary,
        message: `Extracted verified public contacts for ${enrichedCount}/${stagedCandidates.length} staged companies using web crawler. Found ${totalPhones} phone number(s) and ${totalEmails} verified business email(s).`,
      };
    }
  }

  // 2. Otherwise, gather candidate lead rows from existing database leads:
  let candidateRows: Array<{
    id: string;
    input_name: string | null;
    input_company: string | null;
    company_domain: string | null;
    enrichment_status: string | null;
  }> = [];

  if (Array.isArray(params.lead_ids) && params.lead_ids.length > 0) {
    const { data } = await supabase
      .from("prospects")
      .select(
        "id, input_name, input_company, company_domain, enrichment_status",
      )
      .eq("user_id", ctx.userId)
      .in("id", params.lead_ids.slice(0, limit));
    candidateRows = data ?? [];
  } else if (params.lead_id) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        params.lead_id.trim(),
      );
    if (isUuid) {
      const { data } = await supabase
        .from("prospects")
        .select(
          "id, input_name, input_company, company_domain, enrichment_status",
        )
        .eq("user_id", ctx.userId)
        .eq("id", params.lead_id.trim())
        .maybeSingle();
      if (data) candidateRows = [data];
    } else {
      const { data } = await supabase
        .from("prospects")
        .select(
          "id, input_name, input_company, company_domain, enrichment_status",
        )
        .eq("user_id", ctx.userId)
        .or(
          `input_name.ilike.%${params.lead_id.trim()}%,input_company.ilike.%${params.lead_id.trim()}%`,
        )
        .limit(1);
      candidateRows = data ?? [];
    }
  } else if (params.all_unenriched) {
    const { data } = await supabase
      .from("prospects")
      .select(
        "id, input_name, input_company, company_domain, enrichment_status",
      )
      .eq("user_id", ctx.userId)
      .or(
        "enrichment_status.is.null,enrichment_status.eq.not_started,enrichment_status.eq.failed",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    candidateRows = data ?? [];
  } else if (params.query) {
    const q = params.query.trim();
    const { data } = await supabase
      .from("prospects")
      .select(
        "id, input_name, input_company, company_domain, enrichment_status",
      )
      .eq("user_id", ctx.userId)
      .or(
        `input_name.ilike.%${q}%,input_company.ilike.%${q}%,company_domain.ilike.%${q}%`,
      )
      .limit(limit);
    candidateRows = data ?? [];
  } else {
    // Default fallback: take the most recent leads added that aren't completed
    const { data } = await supabase
      .from("prospects")
      .select(
        "id, input_name, input_company, company_domain, enrichment_status",
      )
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    candidateRows = data ?? [];
  }

  if (candidateRows.length === 0) {
    return {
      success: false,
      count: 0,
      message: "No matching leads found in your account to enrich.",
    };
  }

  const results: Array<{
    lead_id: string;
    name: string | null;
    company: string | null;
    domain: string | null;
    status: string;
    error?: string;
  }> = [];

  for (const row of candidateRows) {
    const resolvedDomain =
      params.domain?.trim() ||
      row.company_domain ||
      (row.input_company ? guessDomainFromCompany(row.input_company) : null);

    if (!resolvedDomain) {
      results.push({
        lead_id: row.id,
        name: row.input_name,
        company: row.input_company,
        domain: null,
        status: "skipped",
        error: "No company domain found or inferrable",
      });
      continue;
    }

    try {
      if (!row.company_domain && resolvedDomain) {
        await supabase
          .from("prospects")
          .update({ company_domain: resolvedDomain })
          .eq("id", row.id)
          .eq("user_id", ctx.userId);
      }

      const res = await enqueueProspectEnrichment({
        userId: ctx.userId,
        prospectId: row.id,
        domain: resolvedDomain,
      });

      results.push({
        lead_id: row.id,
        name: row.input_name,
        company: row.input_company,
        domain: resolvedDomain,
        status: res.status,
      });
    } catch (err: unknown) {
      results.push({
        lead_id: row.id,
        name: row.input_name,
        company: row.input_company,
        domain: resolvedDomain,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const enqueuedCount = results.filter((r) => r.status === "queued").length;
  const reusedCount = results.filter(
    (r) =>
      r.status !== "queued" && r.status !== "failed" && r.status !== "skipped",
  ).length;

  return {
    success: true,
    total_matched: candidateRows.length,
    enqueued_count: enqueuedCount,
    reused_count: reusedCount,
    results,
    message: `Queued public contact crawler enrichment for ${enqueuedCount} lead(s) (${reusedCount} already active/cached). The crawler will visit their official websites to extract phones, emails, and key leadership contacts.`,
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
    idempotencyKey: `bulk_enrichment:${job.id}`,
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
      user_id: ctx.userId,
      job_id: job.id,
      input_source: "chat_search",
      input_name: candidate.name,
      input_company: candidate.company,
      input_linkedin_url: candidate.source_url,
      status: "completed" as const,
      company_domain: domain,
      email,
      ...buildProspectIdentity({ email }),
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
    idempotencyKey: `intake_enrichment:${params.job_id}`,
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
          ...buildProspectIdentity({
            email: emailUpdate,
            phone: p.phone as string | null,
          }),
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
    call_status?:
      | "not_called"
      | "called"
      | "no_answer"
      | "answered"
      | "busy"
      | "completed"
      | "failed"
      | "any";
    time_range?:
      | "today"
      | "yesterday"
      | "this_week"
      | "last_30_days"
      | "all_time";
    created_after?: string;
    created_before?: string;
    has_phone?: boolean;
    availability?:
      | "available_now"
      | "available_later"
      | "callback_requested"
      | "has_next_action"
      | "unknown"
      | "any";
    lead_status?: string;
    qualification_bucket?: string;
    only_with_replies?: boolean;
    limit?: number;
  },
  ctx: ToolContext,
) {
  const supabase = createAdminClient();
  const limit = Math.min(params.limit ?? 25, 100);

  let q = supabase
    .from("prospects")
    .select(
      "id,job_id,input_name,input_company,input_title,email,phone,phone_hash,normalized_phone_e164,status,lead_status,qualification_bucket,next_action,email_subject,email_body,research_summary,handoff_summary,created_at",
    )
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (
    params.lead_status &&
    params.lead_status !== "any" &&
    params.lead_status !== "all"
  ) {
    q = q.eq("lead_status", params.lead_status);
  }
  if (
    params.qualification_bucket &&
    params.qualification_bucket !== "any" &&
    params.qualification_bucket !== "all"
  ) {
    q = q.eq("qualification_bucket", params.qualification_bucket);
  }

  const { data: rows, error } = await q;
  if (error) return { error: "lead_search_failed", count: 0, leads: [] };

  const prospectList = rows ?? [];
  const prospectIds = prospectList.map((p) => p.id as string);

  // 1. Fetch recipients & replies for these prospects
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

  // 2. Multi-tenant voice executions: strictly scoped to ctx.userId
  const { data: voiceExecs } =
    prospectIds.length > 0
      ? await supabase
          .from("voice_executions")
          .select(
            "id,prospect_id,recipient_phone_hash,status,provider_status,outcome,duration_seconds,counts_toward_call_limit,created_at",
          )
          .eq("user_id", ctx.userId)
          .in("prospect_id", prospectIds)
          .order("created_at", { ascending: false })
      : { data: [] };

  const prospectToCalls = new Map<
    string,
    Array<{
      id: string;
      status: string;
      provider_status: string | null;
      outcome: string | null;
      duration_seconds: number | null;
      created_at: string;
    }>
  >();
  const personToCalls = new Map<
    string,
    Array<{
      id: string;
      status: string;
      provider_status: string | null;
      outcome: string | null;
      duration_seconds: number | null;
      created_at: string;
    }>
  >();

  for (const call of voiceExecs ?? []) {
    const normalized = {
      id: call.id as string,
      status: (call.status as string) ?? "unknown",
      provider_status: (call.provider_status as string) ?? null,
      outcome: (call.outcome as string) ?? null,
      duration_seconds: (call.duration_seconds as number) ?? null,
      created_at: (call.created_at as string) ?? new Date().toISOString(),
    };
    const pId = call.prospect_id as string | null;
    if (pId) {
      const existing = prospectToCalls.get(pId) ?? [];
      existing.push(normalized);
      prospectToCalls.set(pId, existing);
    }
    const personHash = call.recipient_phone_hash as string | null;
    if (personHash && call.counts_toward_call_limit !== false) {
      const existing = personToCalls.get(personHash) ?? [];
      existing.push(normalized);
      personToCalls.set(personHash, existing);
    }
  }

  // 3. Attach replies and call history to each prospect
  let enrichedList: LeadForFiltering[] = prospectList.map((p) => {
    const reply = prospectToReply.get(p.id as string);
    const directCalls = prospectToCalls.get(p.id as string) ?? [];
    const personCalls =
      (p.phone_hash ? personToCalls.get(String(p.phone_hash)) : undefined) ??
      [];
    // Use canonical person identity if it exists. This prevents duplicate lead
    // rows for one phone number from appearing as uncalled after a prior call.
    const calls = personCalls.length ? personCalls : directCalls;
    const latestCall = calls[0] ?? null;
    return {
      ...p,
      latest_reply: reply ?? null,
      calls,
      latest_call: latestCall,
    };
  });

  if (params.only_with_replies) {
    enrichedList = enrichedList.filter((p) => Boolean(p.latest_reply));
  }

  // 4. Apply pure filters from lead-search-core
  enrichedList = filterLeadsByCallStatus(enrichedList, params.call_status);
  if (params.has_phone === true) {
    enrichedList = filterLeadsByPhone(enrichedList, true);
  } else if (
    params.has_phone === false &&
    /\b(no|without|missing)\s+phone\b/i.test(params.query ?? "")
  ) {
    enrichedList = filterLeadsByPhone(enrichedList, false);
  }
  enrichedList = filterLeadsByTimeRange(enrichedList, params.time_range);
  if (params.created_after)
    enrichedList = enrichedList.filter(
      (p) => p.created_at >= params.created_after!,
    );
  if (params.created_before)
    enrichedList = enrichedList.filter(
      (p) => p.created_at <= params.created_before!,
    );
  enrichedList = filterLeadsByAvailability(enrichedList, params.availability);
  enrichedList = filterLeadsByQuery(enrichedList, params.query);

  // Reply-oriented results naturally sort latest reply first
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
    leads: enrichedList.map((r) => {
      const calls = (r.calls as Array<{ duration_seconds?: number }>) ?? [];
      return {
        lead_id: r.id,
        job_id: (r as unknown as { job_id: string }).job_id,
        name: r.input_name,
        company: r.input_company,
        title: r.input_title,
        email: r.email,
        phone: r.phone,
        lead_status: r.lead_status,
        qualification_bucket: r.qualification_bucket ?? "not_determined",
        next_action: r.next_action ?? "none",
        created_at: r.created_at,
        call_summary: {
          call_count: calls.length,
          last_call_status: r.latest_call?.status ?? "not_called",
          last_call_outcome: r.latest_call?.outcome ?? null,
          last_call_at: r.latest_call?.created_at ?? null,
          last_duration_seconds: r.latest_call?.duration_seconds ?? null,
        },
        latest_inbound_reply: r.latest_reply?.snippet ?? null,
        reply_category: r.latest_reply?.category ?? null,
        wants_meeting: r.latest_reply?.wants_meeting ?? false,
        handoff_summary: r.handoff_summary ?? null,
        has_draft_email: Boolean(
          (r as unknown as { email_subject?: string }).email_subject &&
          (r as unknown as { email_body?: string }).email_body,
        ),
        outbound_email_subject: (r as unknown as { email_subject?: string })
          .email_subject,
        outbound_email_body: (r as unknown as { email_body?: string })
          .email_body,
      };
    }),
    message:
      enrichedList.length > 0
        ? `Found ${enrichedList.length} matching lead(s) in your account.`
        : "No matching leads found in your account.",
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
    idempotencyKey: `enrich_lead:${prospect.id}`,
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
  let lastSendError: string | null = null;
  const { data: mailbox } = await supabase
    .from("mailboxes")
    .select("id,email_address,oauth_refresh_token_encrypted,physical_address")
    .eq("id", mailboxId)
    .maybeSingle();

  if (!mailbox?.oauth_refresh_token_encrypted) {
    lastSendError =
      "Mailbox has no active OAuth credentials. Please reconnect your mailbox at Settings → Mailboxes.";
  } else if (insertedRecipients) {
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
        lastSendError = err instanceof Error ? err.message : String(err);
        console.error("Immediate send attempt failed:", err);
      }
    }
  }

  // If a single lead was targeted and immediate send failed, surface the error immediately
  if (params.lead_id && immediateSent === 0) {
    return {
      error:
        lastSendError ||
        "Immediate email delivery failed. Please check your mailbox connection.",
      campaign_id: campaign.id,
    };
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

// Guarded chat entry point into the same service used by the lead page.
// A model-provided boolean is never accepted as consent on its own.
export async function handleStartQualificationCall(
  params: {
    lead_id: string;
    confirmed_lawful_permission: boolean;
    allow_override?: boolean;
    override_reason?: string;
    approval_id?: string;
    idempotency_key?: string;
  },
  ctx: ToolContext,
) {
  if (!params.confirmed_lawful_permission) return voiceConfirmationRequired();

  const supabase = createAdminClient();
  const { data: session } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("id", ctx.sessionId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!session) return { error: "chat_session_not_found" };

  const { data: messages } = await supabase
    .from("chat_messages")
    .select("content,created_at")
    .eq("session_id", ctx.sessionId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(8);
  const userMessages = (messages ?? [])
    .slice()
    .reverse()
    .map((message) => uiMessageText(message.content))
    .filter(Boolean);
  if (!hasExplicitVoiceCallAuthorization(userMessages)) {
    return voiceConfirmationRequired();
  }

  try {
    const result = await startQualificationCall({
      userId: ctx.userId,
      leadId: params.lead_id,
      consentConfirmed: true,
      allowOverride: params.allow_override,
      overrideReason: params.override_reason,
      approvalId: params.approval_id,
      idempotencyKey: params.idempotency_key,
      source: "chat",
    });
    return {
      success: result.status !== "already_called",
      lead_id: params.lead_id,
      execution_id: result.executionId,
      orchestration: result.orchestration,
      status: result.status,
      provider_execution_id: result.providerExecutionId ?? null,
      already_called: result.alreadyCalled ?? null,
      message:
        result.status === "already_called"
          ? "A qualification call has already been reserved for this person. Use an explicitly approved Call Again override if a further attempt is justified."
          : result.status === "scheduled"
            ? "Qualification call safely scheduled in the configured calling window."
            : "Qualification call accepted by the voice provider.",
    };
  } catch (error) {
    if (error instanceof VoiceCallStartError) {
      return { error: error.code, message: error.message };
    }
    return {
      error: "voice_call_start_failed",
      message: error instanceof Error ? error.message : "Voice call failed.",
    };
  }
}

function voiceConfirmationRequired() {
  return {
    error: "confirmation_required",
    confirmation_required: true,
    message:
      'Before calling, ask the user to state: "I confirm we have lawful permission to call this lead."',
  };
}

// ---------------------------------------------------------------------
// Phase 6 autonomous sales control-plane tools
// ---------------------------------------------------------------------

type ChatApproval = {
  id: string;
  token: string;
  action: string;
  expiresAt: string;
};

function approvalHash(value: unknown) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

async function createChatApproval(
  ctx: ToolContext,
  action: string,
  channel: "email" | "voice" | "multichannel",
  scope: Record<string, unknown>,
  preview: Record<string, unknown>,
  overrideReason?: string,
): Promise<ChatApproval> {
  const db = createAdminClient();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const { data, error } = await db
    .from("outreach_action_approvals")
    .insert({
      user_id: ctx.userId,
      session_id: ctx.sessionId,
      action_kind: action,
      channel,
      scope,
      preview_summary: preview,
      payload_hash: approvalHash(scope),
      confirmation_token_hash: approvalHash(token),
      source: "chat",
      actor: "authenticated_user",
      override_reason: overrideReason ?? null,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("Unable to create an action approval.");
  return { id: String(data.id), token, action, expiresAt };
}

function cardConfirmation(
  approval: ChatApproval,
  toolName: string,
  requiresSecondConfirmation = false,
) {
  return {
    tool_name: toolName,
    approval_id: approval.id,
    confirmation_token: approval.token,
    expires_at: approval.expiresAt,
    requires_confirmation: true,
    requires_second_confirmation: requiresSecondConfirmation,
  };
}

async function resolveSelectedLeadIds(
  selector: { lead_ids?: string[]; filters?: Record<string, unknown> },
  ctx: ToolContext,
) {
  if (selector.lead_ids?.length) {
    const db = createAdminClient();
    const { data, error } = await db
      .from("prospects")
      .select("id")
      .eq("user_id", ctx.userId)
      .in("id", selector.lead_ids);
    if (error) throw new Error("Unable to resolve the selected leads.");
    const owned = (data ?? []).map((row) => String(row.id));
    return {
      ids: owned,
      missing: selector.lead_ids.filter((id) => !owned.includes(id)),
    };
  }
  const result = await handleSearchLeads(
    { ...(selector.filters ?? {}), limit: 100 },
    ctx,
  );
  if ("error" in result && result.error)
    throw new Error("Unable to resolve the selected leads.");
  const ids = (result.leads ?? []).map((lead) => String(lead.lead_id));
  return { ids, missing: [] as string[] };
}

async function callEligibilityPreview(userId: string, leadIds: string[]) {
  const db = createAdminClient();
  const [{ data: leads }, { data: connection }] = await Promise.all([
    db
      .from("prospects")
      .select("id,phone,lead_status,voice_consent_status")
      .eq("user_id", userId)
      .in("id", leadIds),
    db
      .from("voice_connections")
      .select("id,status,calling_timezone,call_start_hour,call_end_hour")
      .eq("user_id", userId)
      .eq("provider", "bolna")
      .maybeSingle(),
  ]);
  const connectionReady = Boolean(connection && connection.status === "active");
  const inWindow =
    connectionReady &&
    withinCallingHours(
      new Date(),
      String(connection?.calling_timezone ?? "UTC"),
      Number(connection?.call_start_hour ?? 9),
      Number(connection?.call_end_hour ?? 18),
    );
  const eligible: string[] = [];
  const blocked: Array<{ lead_id: string; reason: string }> = [];
  for (const lead of leads ?? []) {
    if (!connectionReady)
      blocked.push({
        lead_id: String(lead.id),
        reason: "missing_bolna_connection",
      });
    else if (!lead.phone)
      blocked.push({ lead_id: String(lead.id), reason: "missing_phone" });
    else if (lead.lead_status === "do_not_contact")
      blocked.push({ lead_id: String(lead.id), reason: "do_not_contact" });
    else if (!inWindow)
      blocked.push({
        lead_id: String(lead.id),
        reason: "outside_calling_hours",
      });
    else eligible.push(String(lead.id));
  }
  return { eligible, blocked, connectionReady, inWindow };
}

export async function handleCreateOrUpdateVoiceAgent(
  params: VoiceAgentInput,
  ctx: ToolContext,
) {
  if (params.mode === "apply")
    return {
      error: "confirmation_card_required",
      confirmation_required: true,
      message: "Use the confirmation button on this configuration preview.",
    };
  const db = createAdminClient();
  const { data: connection } = await db
    .from("voice_connections")
    .select("id,status,agent_id,agent_management_mode")
    .eq("user_id", ctx.userId)
    .eq("provider", "bolna")
    .maybeSingle();
  const preview = {
    operation: params.operation,
    language: params.language,
    voice: {
      provider: params.voice.provider,
      model: params.voice.model,
      voice_id: params.voice.voice_id,
      name: params.voice.name,
    },
    tone: params.tone,
    welcome_message: params.welcome_message,
    transfer_enabled: Boolean(params.transfer_number),
    max_call_seconds: params.max_call_seconds,
    max_turns: params.max_turns,
    connected: Boolean(connection?.status === "active"),
  };
  if (!connection || connection.status !== "active")
    return {
      error: "missing_bolna_connection",
      preview,
      message: "Connect and verify Bolna before configuring an agent.",
    };
  const approval = await createChatApproval(
    ctx,
    "voice_agent_configuration",
    "voice",
    { input: params, connectionId: String(connection.id) },
    preview,
  );
  return {
    mode: "preview",
    preview,
    confirmation: cardConfirmation(approval, "create_or_update_voice_agent"),
  };
}

export async function handleStartQualificationCallsBatch(
  params: QualificationBatchInput,
  ctx: ToolContext,
) {
  if (params.mode === "apply")
    return {
      error: "confirmation_card_required",
      confirmation_required: true,
      message: "Use the confirmation button on the exact call preview.",
    };
  if (!params.confirmed_lawful_permission) return voiceConfirmationRequired();
  const selected = await resolveSelectedLeadIds(params, ctx);
  if (params.allow_override && selected.ids.length !== 1)
    return {
      error: "single_call_override_only",
      message: "A Call Again override can only apply to one exact lead.",
    };
  const review = await callEligibilityPreview(ctx.userId, selected.ids);
  const preview = {
    requested: selected.ids.length + selected.missing.length,
    eligible_lead_ids: review.eligible,
    blocked: [
      ...review.blocked,
      ...selected.missing.map((lead_id) => ({
        lead_id,
        reason: "lead_not_found",
      })),
    ],
    estimated_bolna_provider_cost:
      "Bolna bills provider spend directly; an estimate is unavailable until the provider rates this call.",
    safety_warnings: review.blocked.length
      ? ["Blocked leads will not be called."]
      : [],
  };
  const approval = await createChatApproval(
    ctx,
    "qualification_calls_batch",
    "voice",
    {
      leadIds: review.eligible,
      idempotencyKey: params.idempotency_key,
      allowOverride: params.allow_override,
      overrideReason: params.override_reason ?? null,
    },
    preview,
    params.override_reason,
  );
  return {
    mode: "preview",
    preview,
    confirmation: cardConfirmation(
      approval,
      "start_qualification_calls_batch",
      params.allow_override,
    ),
  };
}

export async function handleScheduleLeadFollowup(
  params: FollowupInput,
  ctx: ToolContext,
) {
  if (params.mode === "apply")
    return {
      error: "confirmation_card_required",
      confirmation_required: true,
      message: "Use the confirmation button on the follow-up preview.",
    };
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: params.timezone }).format();
  } catch {
    return { error: "invalid_timezone", message: "Use a valid IANA timezone." };
  }
  if (new Date(params.scheduled_at).getTime() <= Date.now())
    return {
      error: "scheduled_time_in_past",
      message: "Choose a future follow-up time.",
    };
  const db = createAdminClient();
  const { data: lead } = await db
    .from("prospects")
    .select("id,input_name,lead_status")
    .eq("id", params.lead_id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!lead) return { error: "lead_not_found", message: "Lead not found." };
  const preview = {
    lead_id: String(lead.id),
    lead_name: lead.input_name ?? null,
    channel: params.channel,
    scheduled_at: params.scheduled_at,
    timezone: params.timezone,
    local_time: new Intl.DateTimeFormat("en-US", {
      timeZone: params.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(params.scheduled_at)),
    lead_status: lead.lead_status ?? "new",
  };
  const approval = await createChatApproval(
    ctx,
    "lead_followup",
    params.channel,
    { input: params },
    preview,
  );
  return {
    mode: "preview",
    preview,
    confirmation: cardConfirmation(approval, "schedule_lead_followup"),
  };
}

export async function handleSyncCrmLeads(
  params: CrmSyncInput,
  ctx: ToolContext,
) {
  if (params.mode === "apply")
    return {
      error: "confirmation_card_required",
      confirmation_required: true,
      message: "Use the confirmation button on the CRM sync preview.",
    };
  try {
    const result = await previewCrmPull(
      createAdminClient() as unknown as CrmPullDatabase,
      ctx.userId,
      params.provider as CrmProvider,
      { limit: params.limit, modifiedAfter: params.modified_after },
      { sessionId: ctx.sessionId, source: "chat" },
    );
    return {
      mode: "preview",
      provider: params.provider,
      estimates: result.summary,
      next_cursor: result.nextCursor,
      confirmation: {
        tool_name: "sync_crm_leads",
        approval_id: result.approvalId,
        confirmation_token: result.confirmationToken,
        requires_confirmation: true,
      },
    };
  } catch (error) {
    return {
      error: "crm_preview_failed",
      message:
        error instanceof Error
          ? error.message.replace(/Bearer\s+\S+/gi, "[redacted]")
          : "CRM preview could not be completed.",
    };
  }
}

export async function handleGetCallDetailsAndAnalytics(
  params: CallDetailsInput,
  ctx: ToolContext,
) {
  const db = createAdminClient();
  if (params.execution_id) {
    const { data: execution } = await db
      .from("voice_executions")
      .select(
        "id,prospect_id,status,provider_status,outcome,duration_seconds,answered,started_at,answered_at,completed_at,cost_minor_units,cost_currency,cost_unit,transcript,recording_url,created_at",
      )
      .eq("id", params.execution_id)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (!execution)
      return {
        error: "execution_not_found",
        message: "Call execution not found.",
      };
    return {
      execution: {
        ...execution,
        transcript: params.include_transcript
          ? (execution.transcript ?? null)
          : undefined,
        recording_available: params.include_recording
          ? Boolean(execution.recording_url)
          : false,
        recording_url: undefined,
      },
      billing: {
        bolna_provider_spend: "billed directly by Bolna",
        salesengai_platform_credits: "separate",
      },
    };
  }
  const analytics = await getVoiceAnalytics(
    ctx.userId,
    {
      from: params.from,
      to: params.to,
      prospectId: params.lead_id,
      limit: params.limit,
    },
    db,
  );
  const credits = await checkCredits(ctx.userId, 0);
  return {
    analytics,
    platform_credits_remaining: credits.remaining,
    billing: {
      bolna_provider_spend: "billed directly by Bolna",
      salesengai_platform_credits: "separate",
    },
  };
}

export async function handleTriggerOutreachRun(
  params: TriggerOutreachInput,
  ctx: ToolContext,
) {
  if (params.mode === "apply")
    return {
      error: "confirmation_card_required",
      confirmation_required: true,
      message: "Use the confirmation button on the outreach preview.",
    };
  if (params.channel_strategy === "sequence")
    return {
      error: "sequence_strategy_requires_schedule",
      message:
        "Sequence runs must be configured through the existing outreach scheduler.",
    };
  if (
    (params.channel_strategy === "voice" ||
      params.channel_strategy === "smart_both") &&
    !params.confirmed_lawful_permission
  )
    return voiceConfirmationRequired();
  const selected = await resolveSelectedLeadIds(params, ctx);
  const channel = params.channel_strategy as OutreachChannel;
  const previewResult = await dispatchAutonomousOutreach({
    userId: ctx.userId,
    requestedBy: "chat",
    channel,
    prospectIds: selected.ids,
    approvalId: "preview",
    idempotencyKey: params.idempotency_key,
    dryRun: true,
  });
  const preview = {
    ...previewResult,
    missing_lead_ids: selected.missing,
    platform_credit_label: "SalesEngAI platform credits",
    bolna_cost_label: "Bolna provider spend — billed directly by Bolna",
  };
  const approval = await createChatApproval(
    ctx,
    "autonomous_outreach",
    channel === "smart_both" ? "multichannel" : channel,
    {
      channel,
      prospectIds: selected.ids,
      filters: null,
      idempotencyKey: params.idempotency_key,
    },
    preview,
    params.override_reason,
  );
  return {
    mode: "preview",
    preview,
    confirmation: cardConfirmation(
      approval,
      "trigger_outreach_run",
      params.allow_override,
    ),
  };
}

export async function applyApprovedChatAction(input: {
  userId: string;
  sessionId: string;
  approvalId: string;
  confirmationToken: string;
  overrideConfirmed?: boolean;
}) {
  const db = createAdminClient();
  const { data: approval } = await db
    .from("outreach_action_approvals")
    .select(
      "id,action_kind,scope,expires_at,consumed_at,session_id,confirmation_token_hash,override_reason",
    )
    .eq("id", input.approvalId)
    .eq("user_id", input.userId)
    .eq("session_id", input.sessionId)
    .eq("confirmation_token_hash", approvalHash(input.confirmationToken))
    .maybeSingle();
  if (
    !approval ||
    approval.consumed_at ||
    (approval.expires_at &&
      new Date(String(approval.expires_at)).getTime() <= Date.now())
  )
    return {
      error: "approval_not_found_or_expired",
      message: "This confirmation is unavailable. Preview the action again.",
    };
  const scope = (approval.scope ?? {}) as Record<string, unknown>;
  const action = String(approval.action_kind);
  if (action === "crm_pull") {
    const provider = scope.provider as CrmProvider;
    const options = (scope.options ?? {}) as {
      limit?: number;
      modifiedAfter?: string;
      cursor?: string;
    };
    try {
      return {
        action,
        result: await applyCrmPull(
          db as unknown as CrmPullDatabase,
          input.userId,
          { provider, options, confirmationToken: input.confirmationToken },
        ),
      };
    } catch {
      return {
        error: "crm_apply_failed",
        message:
          "CRM sync could not be completed. Preview it again before retrying.",
      };
    }
  }
  if (
    action === "qualification_calls_batch" &&
    scope.allowOverride === true &&
    !input.overrideConfirmed
  )
    return {
      error: "second_confirmation_required",
      requires_second_confirmation: true,
      message:
        "Confirm Call Again once more; the recorded reason will be audited.",
    };
  const { error: confirmError } = await db
    .from("outreach_action_approvals")
    .update({
      confirmed_at: new Date().toISOString(),
      consent_attestation: {
        confirmed: true,
        source: "chat_confirmation_button",
      },
    })
    .eq("id", approval.id)
    .eq("user_id", input.userId)
    .is("consumed_at", null);
  if (confirmError)
    return {
      error: "approval_confirmation_failed",
      message: "Unable to confirm this action.",
    };
  if (action === "voice_agent_configuration")
    return applyVoiceAgentConfiguration(db, input.userId, approval.id, scope);
  if (action === "qualification_calls_batch")
    return applyQualificationBatch(db, input.userId, approval.id, scope);
  if (action === "lead_followup")
    return applyLeadFollowup(db, input.userId, approval.id, scope);
  if (action === "autonomous_outreach") {
    const result = await dispatchAutonomousOutreach({
      userId: input.userId,
      requestedBy: "chat",
      channel: scope.channel as OutreachChannel,
      prospectIds: Array.isArray(scope.prospectIds)
        ? scope.prospectIds.map(String)
        : undefined,
      approvalId: String(approval.id),
      idempotencyKey: String(scope.idempotencyKey),
    });
    return {
      action,
      result,
      status_link: result.runId ? `/app/outreach/runs/${result.runId}` : null,
    };
  }
  return {
    error: "unsupported_approval",
    message: "This action is unavailable.",
  };
}

async function applyLeadFollowup(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  approvalId: string,
  scope: Record<string, unknown>,
) {
  const params = (scope.input ?? {}) as FollowupInput;
  const { data: lead } = await db
    .from("prospects")
    .select("id,lead_status,phone,email")
    .eq("id", params.lead_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (
    !lead ||
    lead.lead_status === "do_not_contact" ||
    (params.channel === "voice" && !lead.phone) ||
    (params.channel === "email" && !lead.email)
  )
    return {
      error: "followup_no_longer_eligible",
      message: "This lead is no longer eligible for the requested follow-up.",
    };
  const insert = {
    user_id: userId,
    prospect_id: params.lead_id,
    channel: params.channel,
    scheduled_at: params.scheduled_at,
    timezone: params.timezone,
    note: params.note ?? null,
    created_by: "chat",
    idempotency_key: params.idempotency_key,
    approval_id: approvalId,
  };
  let { data, error } = await db
    .from("lead_followups")
    .insert(insert)
    .select("id,status,scheduled_at,timezone")
    .maybeSingle();
  if (error && String(error.code) === "23505") {
    const existing = await db
      .from("lead_followups")
      .select("id,status,scheduled_at,timezone")
      .eq("user_id", userId)
      .eq("idempotency_key", params.idempotency_key)
      .maybeSingle();
    data = existing.data;
    error = existing.error;
  }
  if (error || !data)
    return {
      error: "followup_create_failed",
      message: "Unable to schedule the follow-up.",
    };
  // The Phase 3 dispatcher consumes this one-use approval at the scheduled
  // execution time. Keep it current just long enough for that revalidation.
  await db
    .from("outreach_action_approvals")
    .update({
      expires_at: new Date(
        new Date(params.scheduled_at).getTime() + 24 * 60 * 60_000,
      ).toISOString(),
    })
    .eq("id", approvalId)
    .eq("user_id", userId)
    .is("consumed_at", null);
  await inngest.send({
    name: "lead/followup.scheduled",
    data: {
      followupId: String(data.id),
      userId,
      scheduledAt: params.scheduled_at,
    },
  });
  const escalationRequested =
    /\b(human|salesperson|escalat(?:e|ion)|takeover|manual review)\b/i.test(
      String(params.note ?? ""),
    );
  if (escalationRequested) {
    await createLeadHandoff(db, {
      userId,
      prospectId: String(params.lead_id),
      sourceType: "agent_tool",
      sourceId: approvalId,
      reason: "follow_up_requested",
      dueAt: params.scheduled_at,
      conversationSummary:
        params.note ?? `A ${params.channel} follow-up needs human ownership.`,
      priority: "normal",
    });
    await deliverLeadHandoffNotifications(db, 2);
  }
  return {
    action: "lead_followup",
    result: {
      followup_id: data.id,
      status: data.status,
      scheduled_at: data.scheduled_at,
      timezone: data.timezone,
    },
  };
}

async function applyQualificationBatch(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  approvalId: string,
  scope: Record<string, unknown>,
) {
  const ids = Array.isArray(scope.leadIds)
    ? scope.leadIds.map(String).slice(0, 100)
    : [];
  const key = String(scope.idempotencyKey ?? approvalId);
  const allowOverride = scope.allowOverride === true;
  const overrideReason =
    typeof scope.overrideReason === "string" ? scope.overrideReason : undefined;
  const outcomes = await Promise.all(
    ids.map(async (leadId) => {
      try {
        const call = await startQualificationCall({
          userId,
          leadId,
          consentConfirmed: true,
          allowOverride,
          overrideReason,
          approvalId: allowOverride ? approvalId : undefined,
          idempotencyKey: `${key}:${leadId}`,
          source: "chat",
        });
        return {
          lead_id: leadId,
          status: call.status,
          execution_id: call.executionId,
        };
      } catch (error) {
        return {
          lead_id: leadId,
          status: "blocked",
          error:
            error instanceof VoiceCallStartError
              ? error.code
              : "call_start_failed",
        };
      }
    }),
  );
  if (!allowOverride)
    await db
      .from("outreach_action_approvals")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", approvalId)
      .eq("user_id", userId)
      .is("consumed_at", null);
  return {
    action: "qualification_calls_batch",
    result: {
      started: outcomes.filter(
        (item) => item.status === "started" || item.status === "scheduled",
      ).length,
      blocked: outcomes.filter(
        (item) => item.status === "blocked" || item.status === "already_called",
      ).length,
      outcomes,
    },
  };
}

async function applyVoiceAgentConfiguration(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  approvalId: string,
  scope: Record<string, unknown>,
) {
  const params = (scope.input ?? {}) as VoiceAgentInput;
  const { data: connection } = await db
    .from("voice_connections")
    .select(
      "id,encrypted_api_key,agent_id,webhook_version,call_start_hour,call_end_hour,calling_timezone,max_objection_attempts,booking_link_url,agent_management_mode",
    )
    .eq("user_id", userId)
    .eq("id", String(scope.connectionId ?? ""))
    .eq("provider", "bolna")
    .eq("status", "active")
    .maybeSingle();
  if (!connection)
    return {
      error: "missing_bolna_connection",
      message: "Bolna connection is no longer active.",
    };
  // Claim before crossing the provider boundary. Bolna agent create/update has
  // no provider idempotency contract, so an ambiguous failure requires a new
  // preview instead of risking a duplicate provider-side mutation.
  const { data: claimedApproval } = await db
    .from("outreach_action_approvals")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", approvalId)
    .eq("user_id", userId)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (!claimedApproval)
    return {
      error: "approval_already_used",
      message: "This agent configuration approval was already used. Preview again before retrying.",
    };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl)
    return {
      error: "voice_agent_apply_failed",
      message:
        "A secure public application URL is required to configure Bolna webhooks.",
    };
  try {
    const origin = new URL(appUrl).origin;
    if (!origin.startsWith("https://"))
      return {
        error: "voice_agent_apply_failed",
        message:
          "A secure HTTPS application URL is required to configure Bolna webhooks.",
      };
    const signature = voiceWebhookSignature(
      String(connection.id),
      Number(connection.webhook_version ?? 1),
    );
    const config = {
      agentName: "SalesEngAI Qualification Agent",
      webhookUrl: `${origin}/api/webhooks/bolna/${connection.id}?signature=${signature}`,
      actionWebhookUrl: `${origin}/api/webhooks/bolna/${connection.id}/actions?signature=${signature}`,
      language: params.language,
      maxCallSeconds: params.max_call_seconds,
      maxTurns: params.max_turns,
      maxObjectionAttempts: Number(connection.max_objection_attempts ?? 1),
      callStartHour: Number(connection.call_start_hour ?? 9),
      callEndHour: Number(connection.call_end_hour ?? 18),
      agentWelcomeMessage: params.welcome_message,
      voiceName: params.voice.name,
      voiceId: params.voice.voice_id,
      synthesizerProvider: params.voice.provider,
      synthesizerModel: params.voice.model,
      transferEnabled: Boolean(params.transfer_number),
      transferPhone: params.transfer_number ?? undefined,
      additionalInstructions: params.prompt,
    };
    const apiKey = decryptCredential(String(connection.encrypted_api_key));
    const existingAgent =
      connection.agent_id &&
      !String(connection.agent_id).startsWith("provisioning-")
        ? String(connection.agent_id)
        : null;
    const response =
      params.operation === "create" || !existingAgent
        ? await provisionBolnaQualificationAgent(apiKey, config)
        : await updateBolnaQualificationAgent(apiKey, existingAgent, config);
    const agentId = String(
      (response as { agent_id?: string; id?: string }).agent_id ??
        (response as { id?: string }).id ??
        existingAgent,
    );
    await db
      .from("voice_connections")
      .update({
        agent_id: agentId,
        agent_management_mode: "managed",
        default_language: params.language,
        max_call_seconds: params.max_call_seconds,
        max_turns: params.max_turns,
        human_transfer_phone: params.transfer_number ?? null,
        transfer_enabled: Boolean(params.transfer_number),
        agent_options: {
          voiceName: params.voice.name,
          voiceId: params.voice.voice_id,
          synthesizerProvider: params.voice.provider,
          synthesizerModel: params.voice.model,
          agentWelcomeMessage: params.welcome_message,
          tone: params.tone,
          additionalInstructions: params.prompt,
        },
        agent_config_synced_at: new Date().toISOString(),
        agent_config_error: null,
      })
      .eq("id", connection.id)
      .eq("user_id", userId);
    return {
      action: "voice_agent_configuration",
      result: { agent_id: agentId, status: "configured" },
    };
  } catch {
    return {
      error: "voice_agent_apply_failed",
      message:
        "Bolna could not apply this configuration. Review the connection and preview again.",
    };
  }
}
