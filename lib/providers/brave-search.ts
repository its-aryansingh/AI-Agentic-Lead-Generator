/**
 * Brave Search & Universal Discovery provider.
 *
 * Exposes discovery functions backed by the resilient search waterfall
 * in `search-aggregator.ts` (Brave -> Serper -> Tavily -> Exa -> DuckDuckGo -> Mock).
 */

import {
  type ProspectCandidate,
  type RawSearchResult as BraveResult,
  searchBrave,
  universalDiscoverProspects,
} from "@/lib/providers/search-aggregator";

export type { ProspectCandidate, BraveResult };

/** Raw Brave search API wrapper */
export async function braveSearchRaw(
  query: string,
  count = 20,
): Promise<BraveResult[]> {
  return searchBrave(query, count);
}

/**
 * Universal Discovery API: Searches for prospects matching an ICP via
 * waterfall provider strategy with graceful fallbacks.
 */
export async function discoverProspects(opts: {
  query: string;
  target_role?: string;
  industry?: string;
  location?: string;
  max_results?: number;
}): Promise<ProspectCandidate[]> {
  return universalDiscoverProspects(opts);
}
