/**
 * Type definitions for the Signal-Based Convertible Lead Discovery Engine.
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
