/**
 * Convertibility Scorer
 *
 * Evaluates candidate leads against the seller's customer_contexts (ICP,
 * qualification criteria, value proposition, disqualification criteria).
 *
 * Computes a Convertibility Score (0-100), intent bucket, disqualification check,
 * and a tailored "Why You, Why Now" outreach hook.
 */

import type {
  ApolloPersonCandidate,
  BuyingSignals,
  ScoredProspectCandidate,
} from "@/lib/discovery/types";

export interface SellerContext {
  company_name?: string | null;
  ideal_customer_profile?: string | null;
  value_proposition?: string | null;
  qualification_criteria?: string | null;
  disqualification_criteria?: string | null;
}

const HIGH_INTENT_TITLES = [
  "founder",
  "co-founder",
  "ceo",
  "chief executive",
  "head of sales",
  "vp of sales",
  "vp sales",
  "director of sales",
  "head of growth",
  "vp of growth",
  "vp growth",
  "chief revenue officer",
  "cro",
  "sales lead",
  "revops",
];

export function scoreProspectCandidate(
  candidate: ApolloPersonCandidate,
  signals: BuyingSignals,
  sellerContext?: SellerContext | null,
): ScoredProspectCandidate {
  let score = 0;
  let isDisqualified = false;
  let disqualificationReason: string | undefined = undefined;

  const titleLower = candidate.title.toLowerCase();
  const companyLower = candidate.companyName.toLowerCase();
  const industryLower = (candidate.organization?.industry ?? "").toLowerCase();
  const disquals = (sellerContext?.disqualification_criteria ?? "").toLowerCase();

  // 1. Disqualification Filter
  if (disquals) {
    if (
      disquals.includes("b2c") &&
      (industryLower.includes("consumer") ||
        industryLower.includes("retail") ||
        titleLower.includes("consumer"))
    ) {
      isDisqualified = true;
      disqualificationReason = "Matched seller B2C disqualification criteria";
    }

    if (
      disquals.includes("freelance") &&
      (titleLower.includes("freelance") || companyLower.includes("freelance"))
    ) {
      isDisqualified = true;
      disqualificationReason = "Freelancer / non-corporate profile";
    }
  }

  if (isDisqualified) {
    return {
      apolloId: candidate.id,
      name: candidate.name,
      title: candidate.title,
      company: candidate.companyName,
      domain: candidate.companyDomain,
      location: [candidate.city, candidate.state, candidate.country]
        .filter(Boolean)
        .join(", "),
      linkedinUrl: candidate.linkedinUrl,
      source: "apollo",
      sourceUrl: candidate.linkedinUrl || candidate.companyDomain,
      snippet: candidate.headline || candidate.organization?.industry,
      signals,
      convertibilityScore: 0,
      intentBucket: "low",
      isDisqualified: true,
      disqualificationReason,
      primaryTrigger: "Disqualified profile",
      suggestedHook: "",
    };
  }

  // 2. Persona Fit Score (0-35)
  const isKeyDecisionMaker = HIGH_INTENT_TITLES.some((t) =>
    titleLower.includes(t),
  );
  if (isKeyDecisionMaker) {
    score += 25;
  } else if (
    titleLower.includes("manager") ||
    titleLower.includes("lead") ||
    titleLower.includes("head")
  ) {
    score += 15;
  } else {
    score += 10;
  }

  const numEmployees = candidate.organization?.estimatedNumEmployees ?? 0;
  if (numEmployees >= 10 && numEmployees <= 500) {
    score += 10; // Prime sweet-spot for B2B tools
  } else if (numEmployees > 0) {
    score += 5;
  }

  // 3. Buying Signals & Intent Score (0-45)
  if (signals.recentFunding) {
    score += 15; // Fresh budget & expansion mandate
  }

  if (signals.hasActiveHiring) {
    score += 15; // Active growth pain points
  }

  if (signals.isNewInRole) {
    score += 10; // 90-day vendor evaluation window
  }

  if (signals.techStackMatches && signals.techStackMatches.length > 0) {
    score += 5; // Established tooling budget
  }

  // 4. Reachability & Data Integrity (0-20)
  if (candidate.companyDomain) score += 10;
  if (candidate.linkedinUrl) score += 10;

  // Clamp 0-100
  const convertibilityScore = Math.min(100, Math.max(0, score));

  // Determine intent bucket
  const intentBucket: "high" | "medium" | "low" =
    convertibilityScore >= 80
      ? "high"
      : convertibilityScore >= 60
        ? "medium"
        : "low";

  // Synthesize primary trigger
  const triggerParts: string[] = [];
  if (signals.recentFunding) {
    triggerParts.push(
      `Recent ${signals.recentFunding.amount || ""} ${signals.recentFunding.round || "funding"}`.trim(),
    );
  }
  if (signals.hasActiveHiring) {
    triggerParts.push(
      signals.hiringRoles
        ? `Hiring in ${signals.hiringRoles.join(" & ")}`
        : "Active hiring surge",
    );
  }
  if (signals.isNewInRole) {
    triggerParts.push(
      `New in role (~${signals.monthsInRole ?? 1} mo at ${candidate.companyName})`,
    );
  }

  const primaryTrigger =
    triggerParts.length > 0
      ? triggerParts.join(" + ")
      : `Established ${candidate.title} at ${candidate.companyName}`;

  // Generate "Why You, Why Now" hook
  let suggestedHook = "";
  if (signals.recentFunding) {
    suggestedHook = `Saw ${candidate.companyName}'s recent funding round — congratulations. Reaching out as scaling sales teams often hit pipeline bottlenecks at this stage.`;
  } else if (signals.hasActiveHiring) {
    suggestedHook = `Noticed ${candidate.companyName} is expanding its team — teams hiring right now often look for ways to accelerate outreach without compounding SDR headcount.`;
  } else if (signals.isNewInRole) {
    suggestedHook = `Congrats on the new role leading at ${candidate.companyName}. Reaching out to see how you're approaching your initial outbound and pipeline setup.`;
  } else {
    suggestedHook = `Noticed your focus as ${candidate.title} at ${candidate.companyName} — wanted to share how similar teams are driving higher qualified meeting volume.`;
  }

  return {
    apolloId: candidate.id,
    name: candidate.name,
    title: candidate.title,
    company: candidate.companyName,
    domain: candidate.companyDomain,
    location: [candidate.city, candidate.state, candidate.country]
      .filter(Boolean)
      .join(", "),
    linkedinUrl: candidate.linkedinUrl,
    source: "apollo",
    sourceUrl: candidate.linkedinUrl || candidate.companyDomain,
    snippet: `${candidate.title} at ${candidate.companyName} • ${signals.signalSummary}`,
    signals,
    convertibilityScore,
    intentBucket,
    isDisqualified,
    primaryTrigger,
    suggestedHook,
  };
}
