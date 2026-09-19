/**
 * Pure discovery core types and scoring logic — ZERO external runtime dependencies.
 *
 * Designed to be safely imported by both Next.js app code and Node's
 * --experimental-strip-types test runner.
 */

export interface ApolloSearchFilters {
  personTitles?: string[];
  personSeniorities?: (
    | "owner"
    | "founder"
    | "c_suite"
    | "partner"
    | "vp"
    | "head"
    | "director"
    | "manager"
    | "senior"
  )[];
  personLocations?: string[];
  organizationNumEmployeesRanges?: string[];
  qKeywords?: string;
  organizationTechnologies?: string[];
  page?: number;
  perPage?: number;
}

export interface ApolloPersonCandidate {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  title: string;
  headline?: string;
  companyName: string;
  companyDomain?: string;
  companyLinkedinUrl?: string;
  linkedinUrl?: string;
  city?: string;
  state?: string;
  country?: string;
  photoUrl?: string;
  employmentHistory?: Array<{
    title?: string;
    current?: boolean;
    startDate?: string;
  }>;
  organization?: {
    id?: string;
    name?: string;
    websiteUrl?: string;
    primaryDomain?: string;
    estimatedNumEmployees?: number;
    industry?: string;
    annualRevenue?: string | number;
    technologies?: string[];
  };
}

export interface BuyingSignals {
  hasActiveHiring: boolean;
  hiringRoles?: string[];
  recentFunding?: {
    amount?: string;
    round?: string;
    date?: string;
  };
  isNewInRole?: boolean;
  monthsInRole?: number;
  techStackMatches?: string[];
  signalSummary: string;
}

export interface ScoredProspectCandidate {
  apolloId?: string;
  name: string;
  title: string;
  company: string;
  domain?: string;
  location?: string;
  linkedinUrl?: string;
  source: "apollo" | "web_signal" | "mock";
  sourceUrl?: string;
  snippet?: string;
  signals: BuyingSignals;
  convertibilityScore: number; // 0 - 100
  intentBucket: "high" | "medium" | "low";
  isDisqualified: boolean;
  disqualificationReason?: string;
  primaryTrigger: string;
  suggestedHook: string; // "Why You, Why Now"
}

export interface EnrichedContactInfo {
  apolloId: string;
  email?: string;
  emailStatus?: "verified" | "extrapolated" | "unavailable";
  emailConfidence?: number;
  phone?: string;
  phoneType?: "mobile" | "direct_dial" | "work_hq" | "unknown";
  corporatePhone?: string;
  linkedinUrl?: string;
}

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

/**
 * Extracts structured Apollo search filters from a user's natural language request.
 */
export function extractSearchFilters(
  instruction: string,
  explicitMax?: number,
): ApolloSearchFilters {
  const lower = instruction.toLowerCase();
  const filters: ApolloSearchFilters = {};

  // 1. Titles & Seniorities
  const titles: string[] = [];
  const seniorities: ApolloSearchFilters["personSeniorities"] = [];

  if (lower.includes("founder") || lower.includes("co-founder")) {
    titles.push("Founder", "Co-Founder");
    seniorities.push("founder", "owner");
  }
  if (lower.includes("ceo") || lower.includes("chief executive")) {
    titles.push("CEO", "Chief Executive Officer");
    seniorities.push("c_suite");
  }
  if (
    lower.includes("sales") ||
    lower.includes("cro") ||
    lower.includes("head of sales") ||
    lower.includes("vp sales")
  ) {
    titles.push("VP of Sales", "Head of Sales", "Chief Revenue Officer");
    seniorities.push("c_suite", "vp", "head", "director");
  }
  if (
    lower.includes("marketing") ||
    lower.includes("cmo") ||
    lower.includes("head of marketing") ||
    lower.includes("vp marketing")
  ) {
    titles.push(
      "Chief Marketing Officer",
      "VP of Marketing",
      "Head of Marketing",
    );
    seniorities.push("c_suite", "vp", "head", "director");
  }
  if (lower.includes("growth")) {
    titles.push("VP of Growth", "Head of Growth", "Growth Lead");
    seniorities.push("vp", "head", "director");
  }

  if (titles.length > 0) {
    filters.personTitles = titles;
  }
  if (seniorities.length > 0) {
    filters.personSeniorities = Array.from(new Set(seniorities));
  }

  // 2. Locations
  const locations: string[] = [];
  const locationMap: Record<string, string> = {
    bangalore: "Bengaluru, Karnataka, India",
    bengaluru: "Bengaluru, Karnataka, India",
    mumbai: "Mumbai, Maharashtra, India",
    delhi: "Delhi, India",
    gurgaon: "Gurugram, Haryana, India",
    gurugram: "Gurugram, Haryana, India",
    hyderabad: "Hyderabad, Telangana, India",
    pune: "Pune, Maharashtra, India",
    india: "India",
    "united states": "United States",
    us: "United States",
    usa: "United States",
    uk: "United Kingdom",
    london: "London, United Kingdom",
    singapore: "Singapore",
    sf: "San Francisco, California, United States",
    california: "California, United States",
    ny: "New York, United States",
  };

  for (const [key, val] of Object.entries(locationMap)) {
    if (new RegExp(`\\b${key}\\b`, "i").test(lower)) {
      if (!locations.includes(val)) locations.push(val);
    }
  }

  if (locations.length > 0) {
    filters.personLocations = locations;
  }

  // 3. Employee Range
  if (lower.includes("startup") || lower.includes("early stage")) {
    filters.organizationNumEmployeesRanges = ["1,10", "11,50"];
  } else if (lower.includes("mid market") || lower.includes("growth stage")) {
    filters.organizationNumEmployeesRanges = ["51,200", "201,500"];
  } else if (lower.includes("enterprise")) {
    filters.organizationNumEmployeesRanges = ["501,1000", "1001,5000"];
  }

  // 4. Industry Keywords
  const keywords: string[] = [];
  if (lower.includes("saas")) keywords.push("SaaS");
  if (lower.includes("b2b")) keywords.push("B2B");
  if (lower.includes("fintech")) keywords.push("Fintech");
  if (lower.includes("ai") || lower.includes("artificial intelligence"))
    keywords.push("AI");
  if (lower.includes("healthtech")) keywords.push("Healthtech");
  if (lower.includes("ecommerce") || lower.includes("e-commerce"))
    keywords.push("E-commerce");

  if (keywords.length > 0) {
    filters.qKeywords = keywords.join(" ");
  }

  // Extract count (e.g. "20 founders", "10 leads", "30 companies")
  const countMatch = lower.match(
    /\b(\d+)\s+(?:[\w\s]{0,25}\s+)?(?:founders|leads|people|candidates|contacts|prospects|companies|startups|businesses|firms)\b/i,
  );
  filters.perPage = countMatch
    ? Math.min(parseInt(countMatch[1], 10), 50)
    : explicitMax
      ? Math.min(Math.max(explicitMax, 1), 50)
      : 15;

  return filters;
}

/**
 * Evaluates candidate leads against the seller's customer_contexts.
 * Computes a Convertibility Score (0-100), intent bucket, disqualification check,
 * and a tailored "Why You, Why Now" outreach hook.
 */
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
  const disquals = (
    sellerContext?.disqualification_criteria ?? ""
  ).toLowerCase();

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
