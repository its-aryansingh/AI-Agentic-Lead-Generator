/**
 * Apollo.io API Client
 *
 * Implements:
 * 1. searchPeople (mixed_people/api_search) — zero export credits consumed.
 * 2. bulkMatchPeople (people/bulk_match) — reveals verified email and direct mobile numbers.
 */

import type {
  ApolloPersonCandidate,
  ApolloSearchFilters,
  EnrichedContactInfo,
} from "@/lib/discovery/types";

const APOLLO_BASE = "https://api.apollo.io/api/v1";

function getApolloApiKey(): string {
  return (
    process.env.APOLLO_API_KEY ||
    process.env.APOLLO_IO_API_KEY ||
    ""
  ).trim();
}

export function isApolloConfigured(): boolean {
  return Boolean(getApolloApiKey());
}

/**
 * Searches B2B people matching an ICP using Apollo's search endpoint.
 * Does NOT consume export credits.
 */
export async function searchPeople(
  filters: ApolloSearchFilters,
): Promise<{ candidates: ApolloPersonCandidate[]; total: number }> {
  const apiKey = getApolloApiKey();
  if (!apiKey) {
    return { candidates: [], total: 0 };
  }

  const url = new URL(`${APOLLO_BASE}/mixed_people/api_search`);

  // Build query parameters as expected by Apollo API
  if (filters.personTitles?.length) {
    for (const t of filters.personTitles) {
      url.searchParams.append("person_titles[]", t.trim());
    }
  }

  if (filters.personSeniorities?.length) {
    for (const s of filters.personSeniorities) {
      url.searchParams.append("person_seniorities[]", s.trim());
    }
  }

  if (filters.personLocations?.length) {
    for (const loc of filters.personLocations) {
      url.searchParams.append("person_locations[]", loc.trim());
    }
  }

  if (filters.organizationNumEmployeesRanges?.length) {
    for (const r of filters.organizationNumEmployeesRanges) {
      url.searchParams.append("organization_num_employees_ranges[]", r.trim());
    }
  }

  if (filters.qKeywords) {
    url.searchParams.set("q_keywords", filters.qKeywords.trim());
  }

  const perPage = Math.min(filters.perPage ?? 25, 50);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", String(filters.page ?? 1));

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      return { candidates: [], total: 0 };
    }

    const data = (await res.json()) as {
      people?: Array<Record<string, unknown>>;
      pagination?: { total_entries?: number };
    };

    const people = data.people ?? [];
    const candidates: ApolloPersonCandidate[] = people.map((p) => {
      const org = (p.organization as Record<string, unknown> | null) ?? {};
      const employmentHistory = Array.isArray(p.employment_history)
        ? (p.employment_history as Array<Record<string, unknown>>).map((e) => ({
            title: typeof e.title === "string" ? e.title : undefined,
            current: Boolean(e.current),
            startDate:
              typeof e.start_date === "string" ? e.start_date : undefined,
          }))
        : [];

      return {
        id: String(p.id ?? ""),
        firstName: String(p.first_name ?? ""),
        lastName: String(p.last_name ?? ""),
        name: String(p.name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim()),
        title: String(p.title ?? "Leader"),
        headline: typeof p.headline === "string" ? p.headline : undefined,
        companyName: String(org.name ?? p.company ?? "Company"),
        companyDomain:
          typeof org.primary_domain === "string"
            ? org.primary_domain
            : typeof org.website_url === "string"
              ? org.website_url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "")
              : undefined,
        companyLinkedinUrl:
          typeof org.linkedin_url === "string" ? org.linkedin_url : undefined,
        linkedinUrl: typeof p.linkedin_url === "string" ? p.linkedin_url : undefined,
        city: typeof p.city === "string" ? p.city : undefined,
        state: typeof p.state === "string" ? p.state : undefined,
        country: typeof p.country === "string" ? p.country : undefined,
        photoUrl: typeof p.photo_url === "string" ? p.photo_url : undefined,
        employmentHistory,
        organization: {
          id: typeof org.id === "string" ? org.id : undefined,
          name: typeof org.name === "string" ? org.name : undefined,
          websiteUrl: typeof org.website_url === "string" ? org.website_url : undefined,
          primaryDomain:
            typeof org.primary_domain === "string"
              ? org.primary_domain
              : undefined,
          estimatedNumEmployees:
            typeof org.estimated_num_employees === "number"
              ? org.estimated_num_employees
              : undefined,
          industry: typeof org.industry === "string" ? org.industry : undefined,
          annualRevenue:
            typeof org.annual_revenue === "string" ||
            typeof org.annual_revenue === "number"
              ? org.annual_revenue
              : undefined,
          technologies: Array.isArray(org.technologies)
            ? (org.technologies as string[])
            : undefined,
        },
      };
    });

    return {
      candidates,
      total: data.pagination?.total_entries ?? candidates.length,
    };
  } catch {
    return { candidates: [], total: 0 };
  }
}

/**
 * Enriches a batch of Apollo person IDs with verified corporate email
 * and direct mobile phone numbers.
 * Max 10 records per Apollo API batch.
 */
export async function bulkMatchPeople(
  apolloIds: string[],
  options: { revealPhone?: boolean; revealPersonalEmails?: boolean } = {},
): Promise<Map<string, EnrichedContactInfo>> {
  const apiKey = getApolloApiKey();
  const results = new Map<string, EnrichedContactInfo>();
  if (!apiKey || !apolloIds.length) return results;

  const revealPhone = options.revealPhone !== false;
  const revealPersonalEmails = Boolean(options.revealPersonalEmails);

  // Chunk into batches of 10 as required by Apollo bulk_match
  const chunks: string[][] = [];
  for (let i = 0; i < apolloIds.length; i += 10) {
    chunks.push(apolloIds.slice(i, i + 10));
  }

  for (const chunk of chunks) {
    try {
      const res = await fetch(`${APOLLO_BASE}/people/bulk_match`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Api-Key": apiKey,
        },
        body: JSON.stringify({
          details: chunk.map((id) => ({ id })),
          reveal_personal_emails: revealPersonalEmails,
          reveal_phone_number: revealPhone,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) continue;

      const data = (await res.json()) as {
        matches?: Array<Record<string, unknown>>;
      };

      for (const m of data.matches ?? []) {
        const id = String(m.id ?? "");
        if (!id) continue;

        // Parse phone numbers (prefer direct mobile or mobile type)
        let resolvedPhone: string | undefined;
        let resolvedType: EnrichedContactInfo["phoneType"] = "unknown";

        const phoneNumbers = Array.isArray(m.phone_numbers)
          ? (m.phone_numbers as Array<{
              raw_number?: string;
              sanitized_number?: string;
              type?: string;
            }>)
          : [];

        const mobile = phoneNumbers.find(
          (p) => p.type?.toLowerCase() === "mobile",
        );
        const direct = phoneNumbers.find(
          (p) =>
            p.type?.toLowerCase() === "direct_dial" ||
            p.type?.toLowerCase() === "work",
        );
        const first = phoneNumbers[0];

        const chosen = mobile || direct || first;
        if (chosen) {
          resolvedPhone = chosen.sanitized_number || chosen.raw_number;
          resolvedType =
            chosen.type?.toLowerCase() === "mobile"
              ? "mobile"
              : chosen.type?.toLowerCase() === "direct_dial"
                ? "direct_dial"
                : "work_hq";
        }

        const org = m.organization as Record<string, unknown> | null;
        const corporatePhone =
          typeof org?.primary_phone === "object" && org.primary_phone
            ? String(
                (org.primary_phone as { number?: string }).number ?? "",
              )
            : undefined;

        results.set(id, {
          apolloId: id,
          email: typeof m.email === "string" ? m.email.trim() : undefined,
          emailStatus:
            m.email_status === "verified"
              ? "verified"
              : m.email_status === "extrapolated"
                ? "extrapolated"
                : "unavailable",
          emailConfidence:
            typeof m.email_confidence === "number"
              ? m.email_confidence
              : undefined,
          phone: resolvedPhone || corporatePhone,
          phoneType: resolvedPhone ? resolvedType : "work_hq",
          corporatePhone,
          linkedinUrl:
            typeof m.linkedin_url === "string" ? m.linkedin_url : undefined,
        });
      }
    } catch {
      // Best-effort batch enrichment
    }
  }

  return results;
}
