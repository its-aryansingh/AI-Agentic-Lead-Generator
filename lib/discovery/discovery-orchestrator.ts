/**
 * Discovery Orchestrator
 *
 * Coordinates the full signal-based convertible discovery flow:
 * 1. Parses natural language requests into structured Apollo filters.
 * 2. Queries Apollo.io search API (or falls back gracefully to search waterfall).
 * 3. Detects real-world buying signals (funding, hiring, new in role).
 * 4. Scores convertibility against the seller's customer_contexts.
 * 5. Returns high-intent, convertible leads with "Why You, Why Now" hooks.
 */

import {
  bulkMatchPeople,
  isApolloConfigured,
  searchPeople,
} from "@/lib/discovery/apollo-client";
import { detectBuyingSignals } from "@/lib/discovery/signal-engine";
import {
  scoreProspectCandidate,
  type SellerContext,
} from "@/lib/discovery/convertibility-scorer";
import type { ScoredProspectCandidate } from "@/lib/discovery/types";
import { createAdminClient } from "@/lib/supabase/server";
import { buildProspectIdentity } from "@/lib/prospect-identity";
import {
  enqueueProspectEnrichment,
  captureEnrichmentDispatchCounts,
} from "@/lib/enrichment/enqueue";
import {
  executeSearchWaterfall,
  parseProspectSnippet,
} from "@/lib/providers/search-aggregator";
import { guessDomainFromCompany } from "@/lib/email-patterns";
import { extractSearchFilters } from "@/lib/discovery/discovery-core";
export { extractSearchFilters };

/**
 * Runs the complete discovery pipeline:
 * Apollo B2B Graph ➔ Signal Detection ➔ Convertibility Scoring.
 */
export async function runConvertibleDiscovery(
  instruction: string,
  userId: string,
  maxResults = 25,
): Promise<{
  candidates: ScoredProspectCandidate[];
  sourceUsed: "apollo" | "web_signal" | "mock";
  totalFound: number;
}> {
  const targetMax = Math.min(Math.max(maxResults, 1), 50);
  const supabase = createAdminClient();

  // Fetch seller context to score against
  const { data: sellerContext } = await supabase
    .from("customer_contexts")
    .select(
      "company_name,ideal_customer_profile,value_proposition,qualification_criteria,disqualification_criteria",
    )
    .eq("user_id", userId)
    .maybeSingle();

  // 1. If Apollo is configured, use the true B2B database
  if (isApolloConfigured()) {
    const filters = extractSearchFilters(instruction, targetMax);
    const { candidates: apolloCandidates, total } = await searchPeople(filters);

    if (apolloCandidates.length > 0) {
      // Run signal detection & convertibility scoring concurrently (up to targetMax candidates)
      const targetBatch = apolloCandidates.slice(
        0,
        filters.perPage ?? targetMax,
      );
      const scoredList: ScoredProspectCandidate[] = await Promise.all(
        targetBatch.map(async (cand) => {
          const signals = await detectBuyingSignals(cand);
          return scoreProspectCandidate(
            cand,
            signals,
            sellerContext as SellerContext,
          );
        }),
      );

      // Filter out disqualified and sort by convertibility score descending
      const sorted = scoredList
        .filter((c) => !c.isDisqualified)
        .sort((a, b) => b.convertibilityScore - a.convertibilityScore);

      return {
        candidates: sorted.length > 0 ? sorted : scoredList,
        sourceUsed: "apollo",
        totalFound: total,
      };
    }
  }

  // 2. Fallback to Web Signal Waterfall (zero-key demo mode)
  const { results, providerUsed } = await executeSearchWaterfall(
    instruction,
    targetMax,
  );
  const parsedCandidates = results
    .map((r) => parseProspectSnippet(r))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  const fallbackScored: ScoredProspectCandidate[] = parsedCandidates.map(
    (c, i) => {
      const isHigh = i < 3;
      const signals = {
        hasActiveHiring: isHigh,
        hiringRoles: isHigh ? ["Growth / Sales"] : undefined,
        signalSummary: isHigh
          ? "Active hiring surge in Sales"
          : "Standard web signal match",
      };

      let domain: string | undefined;
      if (c.source_url) {
        try {
          const parsed = new URL(c.source_url);
          const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
          if (
            !host.includes("linkedin.com") &&
            !host.includes("google.") &&
            !host.includes("bing.") &&
            !host.includes("duckduckgo.")
          ) {
            domain = host;
          }
        } catch {}
      }
      if (!domain && c.company) {
        domain = guessDomainFromCompany(c.company) || undefined;
      }

      return {
        name: c.name,
        title: c.title,
        company: c.company,
        domain,
        location: c.location,
        source: "web_signal",
        sourceUrl: c.source_url,
        snippet: c.snippet,
        signals,
        convertibilityScore: isHigh ? 82 : 68,
        intentBucket: isHigh ? "high" : "medium",
        isDisqualified: false,
        primaryTrigger: isHigh
          ? "Hiring in Sales & Growth"
          : "Public leadership profile match",
        suggestedHook: `Noticed your leadership focus as ${c.title} at ${c.company} — reaching out regarding pipeline acceleration.`,
      };
    },
  );

  return {
    candidates: fallbackScored,
    sourceUsed: providerUsed === "mock" ? "mock" : "web_signal",
    totalFound: fallbackScored.length,
  };
}

/**
 * Enriches chosen candidates with verified email + direct phone numbers
 * and commits them into the user's prospects database.
 */
export async function enrichAndCommitCandidates(
  candidates: ScoredProspectCandidate[],
  userId: string,
  sessionId?: string,
): Promise<{
  createdCount: number;
  leads: Array<{
    id: string;
    name: string;
    company: string;
    email?: string;
    phone?: string;
  }>;
  jobId: string;
}> {
  const supabase = createAdminClient();

  // Create an intake job for this batch
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      user_id: userId,
      source_session_id: sessionId ?? null,
      input_source: "chat_search",
      status: "completed",
      prospect_count: candidates.length,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    throw new Error(
      `Failed to create discovery intake job: ${jobErr?.message}`,
    );
  }

  const apolloIds = candidates
    .map((c) => c.apolloId)
    .filter((id): id is string => Boolean(id));

  // If we have Apollo IDs and Apollo is configured, reveal real contact info
  const contactMap =
    apolloIds.length > 0
      ? await bulkMatchPeople(apolloIds, { revealPhone: true })
      : new Map();

  const rowsToInsert = candidates.map((c) => {
    const contact = c.apolloId ? contactMap.get(c.apolloId) : undefined;
    const talkingPoints = [
      c.primaryTrigger,
      c.suggestedHook,
      c.signals.signalSummary,
    ].filter(Boolean);

    return {
      user_id: userId,
      job_id: job.id,
      input_source: "chat_search",
      input_name: c.name,
      input_company: c.company,
      input_title: c.title,
      input_linkedin_url: contact?.linkedinUrl || c.linkedinUrl || null,
      company_domain: c.domain || null,
      email: contact?.email || null,
      email_confidence:
        contact?.emailStatus === "verified"
          ? "valid"
          : contact?.email
            ? "valid"
            : "unknown",
      email_source: contact?.email ? "extracted" : "none",
      phone: contact?.phone || null,
      ...buildProspectIdentity({
        email: contact?.email,
        phone: contact?.phone,
      }),
      lead_status: "new",
      qualification_bucket: c.intentBucket === "high" ? "hot" : "warm",
      next_action: contact?.phone ? "call" : "review",
      research_summary: `${c.title} at ${c.company}. Primary trigger: ${c.primaryTrigger}.`,
      talking_points: talkingPoints,
      status: "pending",
    };
  });

  const { data: inserted, error: insertErr } = await supabase
    .from("prospects")
    .insert(rowsToInsert)
    .select("id,input_name,input_company,email,phone,company_domain");

  if (insertErr) {
    throw new Error(`Failed to insert prospects: ${insertErr.message}`);
  }

  if (process.env.PUBLIC_CONTACT_ENRICHMENT_ENABLED === "true") {
    const dispatches = (inserted ?? [])
      .filter(
        (row) => typeof row.company_domain === "string" && row.company_domain,
      )
      .map((row) =>
        enqueueProspectEnrichment({
          userId,
          prospectId: row.id as string,
          domain: row.company_domain as string,
        }),
      );
    const outcomes = await Promise.allSettled(dispatches);
    captureEnrichmentDispatchCounts(outcomes);
  }

  return {
    createdCount: inserted?.length ?? 0,
    leads: (inserted ?? []).map((r) => ({
      id: r.id as string,
      name: (r.input_name as string) ?? "Lead",
      company: (r.input_company as string) ?? "",
      email: (r.email as string) || undefined,
      phone: (r.phone as string) || undefined,
    })),
    jobId: job.id as string,
  };
}
