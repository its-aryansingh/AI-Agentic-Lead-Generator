/**
 * Signal Engine — Detects buying triggers and intent signals for B2B accounts.
 *
 * Checks:
 * 1. New in Role (joined current company < 120 days ago)
 * 2. Technographic stack matches
 * 3. Company hiring and growth signals
 * 4. Recent funding rounds / capital events via real-time news check
 */

import type { ApolloPersonCandidate, BuyingSignals } from "@/lib/discovery/types";
import { searchTavily } from "@/lib/providers/search-aggregator";

const TARGET_TECH_SIGNALS = [
  "hubspot",
  "salesforce",
  "outreach",
  "salesloft",
  "apollo",
  "zoominfo",
  "stripe",
  "razorpay",
  "aws",
  "gcp",
  "snowflake",
  "segment",
];

/**
 * Calculates how many months a person has been in their current role.
 */
function checkTenure(candidate: ApolloPersonCandidate): {
  isNewInRole: boolean;
  monthsInRole?: number;
} {
  const current = candidate.employmentHistory?.find((e) => e.current);
  if (!current?.startDate) return { isNewInRole: false };

  const start = new Date(current.startDate).getTime();
  if (Number.isNaN(start)) return { isNewInRole: false };

  const now = Date.now();
  const diffMonths = Math.max(
    0,
    Math.round((now - start) / (1000 * 60 * 60 * 24 * 30.4)),
  );

  return {
    isNewInRole: diffMonths <= 4, // 120 days
    monthsInRole: diffMonths,
  };
}

/**
 * Checks for technology stack overlap from organization technologies.
 */
function checkTechStack(candidate: ApolloPersonCandidate): string[] {
  const rawTech = candidate.organization?.technologies ?? [];
  const found: string[] = [];

  for (const t of rawTech) {
    const lower = t.toLowerCase();
    for (const target of TARGET_TECH_SIGNALS) {
      if (lower.includes(target) && !found.includes(target)) {
        found.push(target);
      }
    }
  }

  return found;
}

/**
 * Extracts real-time buying signals (funding, hiring, expansion)
 * for the company using news search.
 */
export async function detectBuyingSignals(
  candidate: ApolloPersonCandidate,
): Promise<BuyingSignals> {
  const tenure = checkTenure(candidate);
  const techMatches = checkTechStack(candidate);

  let hasActiveHiring = false;
  const hiringRoles: string[] = [];
  let recentFunding: BuyingSignals["recentFunding"] = undefined;
  const signalSnippets: string[] = [];

  if (tenure.isNewInRole) {
    signalSnippets.push(
      `New in role (~${tenure.monthsInRole} mo at ${candidate.companyName})`,
    );
  }

  if (techMatches.length > 0) {
    signalSnippets.push(`Tech stack: ${techMatches.slice(0, 3).join(", ")}`);
  }

  // Check company news and funding if company name is known
  const company = candidate.companyName.trim();
  if (company && company !== "Company" && process.env.TAVILY_API_KEY) {
    try {
      const query = `"${company}" (funding OR "seed" OR "series a" OR "series b" OR "hiring" OR "raised")`;
      const searchResults = await searchTavily(query, 3);

      for (const r of searchResults) {
        const text = `${r.title} ${r.description}`.toLowerCase();

        // Check for funding mentions
        const fundingMatch = text.match(
          /\b(raised|secured|closed)\s+(\$[\d.]+\s*(?:m|million|b|billion)?|₹[\d.]+\s*(?:cr|crore)?)\b/i,
        );
        const roundMatch = text.match(
          /\b(seed|pre-seed|series\s+[a-c]|venture\s+round)\b/i,
        );

        if (fundingMatch && !recentFunding) {
          recentFunding = {
            amount: fundingMatch[2],
            round: roundMatch ? roundMatch[1].toUpperCase() : "Growth Round",
            date: "Recent",
          };
          signalSnippets.push(
            `Funding: ${recentFunding.amount} (${recentFunding.round})`,
          );
        }

        // Check for hiring mentions
        if (
          text.includes("hiring") ||
          text.includes("careers") ||
          text.includes("expanding team") ||
          text.includes("opening")
        ) {
          hasActiveHiring = true;
          if (text.includes("sales") || text.includes("sdr")) {
            hiringRoles.push("Sales / SDR");
          }
          if (text.includes("engineer") || text.includes("developer")) {
            hiringRoles.push("Engineering");
          }
        }
      }
    } catch {
      // Best-effort news detection
    }
  }

  if (hasActiveHiring && hiringRoles.length > 0) {
    signalSnippets.push(`Hiring: ${hiringRoles.join(", ")}`);
  }

  const signalSummary =
    signalSnippets.length > 0
      ? signalSnippets.join(" • ")
      : "Standard ICP profile match";

  return {
    hasActiveHiring,
    hiringRoles: hiringRoles.length > 0 ? hiringRoles : undefined,
    recentFunding,
    isNewInRole: tenure.isNewInRole,
    monthsInRole: tenure.monthsInRole,
    techStackMatches: techMatches.length > 0 ? techMatches : undefined,
    signalSummary,
  };
}
