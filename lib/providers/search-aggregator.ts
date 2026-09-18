/**
 * Unified Search Aggregator & Discovery Engine.
 *
 * Implements a resilient waterfall search cascade:
 * 1. Brave Search API (if BRAVE_SEARCH_KEY is set)
 * 2. Serper.dev Google Search API (if SERPER_API_KEY is set)
 * 3. Tavily AI Search API (if TAVILY_API_KEY is set)
 * 4. Exa AI Search API (if EXA_API_KEY is set)
 * 5. DuckDuckGo Public Search (zero-key fallback)
 * 6. Deterministic Mock Prospects (offline/demo fallback)
 */

import { hasKey, hashIndex } from "@/lib/utils";

export interface RawSearchResult {
  title: string;
  url: string;
  description: string;
  source: "brave" | "serper" | "tavily" | "exa" | "duckduckgo" | "mock";
}

export interface ProspectCandidate {
  name: string;
  title: string;
  company: string;
  location?: string;
  source:
    | "brave"
    | "serper"
    | "tavily"
    | "exa"
    | "duckduckgo"
    | "mock"
    | "github"
    | "hn"
    | "producthunt"
    | "named"
    | "csv";
  source_url: string;
  snippet: string;
}

const BRAVE_BASE = "https://api.search.brave.com/res/v1/web/search";
const SERPER_BASE = "https://google.serper.dev/search";
const TAVILY_BASE = "https://api.tavily.com/search";
const EXA_BASE = "https://api.exa.ai/search";

/** 1. Brave Search Provider */
export async function searchBrave(
  query: string,
  count = 20,
): Promise<RawSearchResult[]> {
  const key = process.env.BRAVE_SEARCH_KEY || process.env.BRAVE_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      `${BRAVE_BASE}?q=${encodeURIComponent(query)}&count=${count}&country=IN`,
      {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": key,
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      web?: {
        results?: Array<{ title: string; url: string; description: string }>;
      };
    };
    return (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description,
      source: "brave" as const,
    }));
  } catch {
    return [];
  }
}

/** 2. Serper.dev Google Search Provider */
export async function searchSerper(
  query: string,
  count = 20,
): Promise<RawSearchResult[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(SERPER_BASE, {
      method: "POST",
      headers: {
        "X-API-KEY": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        num: count,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      organic?: Array<{ title: string; link: string; snippet?: string }>;
    };
    return (data.organic ?? []).map((r) => ({
      title: r.title,
      url: r.link,
      description: r.snippet ?? "",
      source: "serper" as const,
    }));
  } catch {
    return [];
  }
}

/** 3. Tavily AI Search Provider */
export async function searchTavily(
  query: string,
  count = 15,
): Promise<RawSearchResult[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(TAVILY_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: count,
        search_depth: "basic",
        include_answer: false,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{ title: string; url: string; content?: string }>;
    };
    return (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      description: r.content ?? "",
      source: "tavily" as const,
    }));
  } catch {
    return [];
  }
}

/** 4. Exa.ai Semantic Search Provider */
export async function searchExa(
  query: string,
  count = 15,
): Promise<RawSearchResult[]> {
  const key = process.env.EXA_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(EXA_BASE, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        numResults: count,
        useAutoprompt: true,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{ title: string; url: string; text?: string }>;
    };
    return (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      description: r.text ?? "",
      source: "exa" as const,
    }));
  } catch {
    return [];
  }
}

/** 5. DuckDuckGo Zero-Key Public Search Fallback */
export async function searchDuckDuckGo(
  query: string,
  count = 15,
): Promise<RawSearchResult[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const results: RawSearchResult[] = [];

    // Simple snippet matcher
    const snippetMatches = Array.from(
      html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g),
    );
    const titleMatches = Array.from(
      html.matchAll(
        /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
      ),
    );

    for (let i = 0; i < Math.min(titleMatches.length, count); i++) {
      const tMatch = titleMatches[i];
      const sMatch = snippetMatches[i];
      if (tMatch) {
        const rawUrl = tMatch[1];
        // Clean uddg parameter if present
        let cleanUrl = rawUrl;
        if (rawUrl.includes("uddg=")) {
          const match = rawUrl.match(/uddg=([^&]+)/);
          if (match) cleanUrl = decodeURIComponent(match[1]);
        }
        const cleanTitle = (tMatch[2] || "").replace(/<[^>]+>/g, "").trim();
        const cleanSnippet = (sMatch?.[1] || "").replace(/<[^>]+>/g, "").trim();

        if (cleanTitle && cleanUrl.startsWith("http")) {
          results.push({
            title: cleanTitle,
            url: cleanUrl,
            description: cleanSnippet,
            source: "duckduckgo",
          });
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

/** 6. Waterfall Search Execution */
export async function executeSearchWaterfall(
  query: string,
  count = 20,
): Promise<{ results: RawSearchResult[]; providerUsed: string }> {
  // Step 1: Try Brave
  if (hasKey("brave")) {
    const res = await searchBrave(query, count);
    if (res.length > 0) return { results: res, providerUsed: "brave" };
  }

  // Step 2: Try Serper Google
  if (hasKey("serper")) {
    const res = await searchSerper(query, count);
    if (res.length > 0) return { results: res, providerUsed: "serper" };
  }

  // Step 3: Try Tavily
  if (hasKey("tavily")) {
    const res = await searchTavily(query, count);
    if (res.length > 0) return { results: res, providerUsed: "tavily" };
  }

  // Step 4: Try Exa
  if (hasKey("exa")) {
    const res = await searchExa(query, count);
    if (res.length > 0) return { results: res, providerUsed: "exa" };
  }

  // Step 5: Try Zero-key DuckDuckGo
  const ddgRes = await searchDuckDuckGo(query, count);
  if (ddgRes.length > 0) {
    return { results: ddgRes, providerUsed: "duckduckgo" };
  }

  // Step 6: Fall back to Mock
  return { results: [], providerUsed: "mock" };
}

/** Parses search result title/snippet into a structured ProspectCandidate */
export function parseProspectSnippet(
  r: RawSearchResult,
): ProspectCandidate | null {
  const cleaned = r.title
    .replace(/\s*\|\s*LinkedIn.*$/i, "")
    .replace(/\s*-\s*LinkedIn.*$/i, "")
    .trim();

  // Pattern 1: "<Name> - <Title> at <Company>"
  const m1 = cleaned.match(/^(.+?)\s+[-–—]\s+(.+?)\s+at\s+(.+?)$/i);
  if (m1) {
    return {
      name: m1[1].trim(),
      title: m1[2].trim(),
      company: m1[3].trim(),
      source: r.source,
      source_url: r.url,
      snippet: r.description,
    };
  }

  // Pattern 2: "<Name> - <Title>, <Company>"
  const m2 = cleaned.match(/^(.+?)\s+[-–—]\s+(.+?),\s+(.+?)$/i);
  if (m2) {
    return {
      name: m2[1].trim(),
      title: m2[2].trim(),
      company: m2[3].trim(),
      source: r.source,
      source_url: r.url,
      snippet: r.description,
    };
  }

  // Pattern 3: "<Name> – <Title> | <Company>"
  const m3 = cleaned.match(/^(.+?)\s+[-–—|]\s+(.+?)\s+[-–—|]\s+(.+?)$/i);
  if (m3) {
    return {
      name: m3[1].trim(),
      title: m3[2].trim(),
      company: m3[3].trim(),
      source: r.source,
      source_url: r.url,
      snippet: r.description,
    };
  }

  // Pattern 4: "<Name> - <Company>"
  const m4 = cleaned.match(/^(.+?)\s+[-–—]\s+(.+?)$/i);
  if (m4 && m4[1].length < 40) {
    return {
      name: m4[1].trim(),
      title: "Executive / Lead",
      company: m4[2].trim(),
      source: r.source,
      source_url: r.url,
      snippet: r.description,
    };
  }

  // Pattern 5: Valid Name length
  if (cleaned.length > 2 && cleaned.length < 50 && !cleaned.includes("http")) {
    return {
      name: cleaned,
      title: "Sales & Tech Leader",
      company: "Industry Leader",
      source: r.source,
      source_url: r.url,
      snippet: r.description,
    };
  }

  return null;
}

// ---------------------------------------------------------------------
// Mock Dataset for Fallback
// ---------------------------------------------------------------------

const MOCK_PEOPLE: Array<
  Omit<ProspectCandidate, "snippet" | "source" | "source_url">
> = [
  {
    name: "Priya Sharma",
    title: "Head of Marketing",
    company: "Razorpay",
    location: "Bangalore",
  },
  {
    name: "Rahul Mehta",
    title: "VP Sales",
    company: "Freshworks",
    location: "Chennai",
  },
  {
    name: "Ananya Iyer",
    title: "Director of Growth",
    company: "CRED",
    location: "Bangalore",
  },
  {
    name: "Vikram Singh",
    title: "Chief Marketing Officer",
    company: "Zerodha",
    location: "Bangalore",
  },
  {
    name: "Tanvir Ahmed",
    title: "Head of Demand Gen",
    company: "Postman",
    location: "Singapore",
  },
  {
    name: "Mira Kapoor",
    title: "Growth Lead",
    company: "Khatabook",
    location: "Mumbai",
  },
  {
    name: "Arjun Reddy",
    title: "CRO",
    company: "Chargebee",
    location: "Chennai",
  },
  {
    name: "Sneha Pillai",
    title: "Director, Product Marketing",
    company: "Hasura",
    location: "Bangalore",
  },
  {
    name: "Karthik Subramanian",
    title: "VP of Marketing",
    company: "Zoho",
    location: "Chennai",
  },
  {
    name: "Divya Nair",
    title: "Head of B2B Marketing",
    company: "MoEngage",
    location: "Bangalore",
  },
  {
    name: "Faisal Khan",
    title: "Co-founder & CEO",
    company: "Pesto Tech",
    location: "Bangalore",
  },
  {
    name: "Ritika Bose",
    title: "Marketing Lead, SEA",
    company: "Xendit",
    location: "Jakarta",
  },
  {
    name: "Aditya Bansal",
    title: "Growth Manager",
    company: "Setu",
    location: "Bangalore",
  },
  {
    name: "Lakshmi Rao",
    title: "Senior Director, Marketing",
    company: "Whatfix",
    location: "San Francisco / Bangalore",
  },
  {
    name: "Nikhil Verma",
    title: "Head of Customer Acquisition",
    company: "Slice",
    location: "Bangalore",
  },
];

export function generateMockCandidates(
  opts: { query: string },
  n: number,
): ProspectCandidate[] {
  const start = hashIndex(opts.query, MOCK_PEOPLE.length);
  const picked: ProspectCandidate[] = [];
  for (let i = 0; i < Math.min(n, MOCK_PEOPLE.length); i++) {
    const p = MOCK_PEOPLE[(start + i) % MOCK_PEOPLE.length];
    picked.push({
      ...p,
      source: "mock",
      source_url: `https://www.linkedin.com/in/${p.name.toLowerCase().replace(/\s+/g, "-")}`,
      snippet: `${p.name} - ${p.title} at ${p.company}. ${p.location ? p.location + ". " : ""}Result from mock data (set SERPER_API_KEY, BRAVE_SEARCH_KEY, or TAVILY_API_KEY for real-time results).`,
    });
  }
  return picked;
}

/**
 * Universal Discovery API: Executes waterfall search and extracts clean candidates.
 */
export async function universalDiscoverProspects(opts: {
  query: string;
  target_role?: string;
  industry?: string;
  location?: string;
  max_results?: number;
}): Promise<ProspectCandidate[]> {
  const max = opts.max_results ?? 15;
  const bias = " site:linkedin.com/in";
  const searchQuery = opts.query + bias;

  const { results, providerUsed } = await executeSearchWaterfall(
    searchQuery,
    Math.min(max, 20),
  );

  if (providerUsed === "mock" || results.length === 0) {
    return generateMockCandidates(opts, max);
  }

  const parsed = results
    .map(parseProspectSnippet)
    .filter(Boolean) as ProspectCandidate[];

  return parsed.length > 0
    ? parsed.slice(0, max)
    : generateMockCandidates(opts, max);
}
