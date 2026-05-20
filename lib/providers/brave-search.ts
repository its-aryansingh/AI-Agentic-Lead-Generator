/**
 * Brave Search provider.
 *
 * Returns search results — when BRAVE_SEARCH_KEY is set we hit the real
 * API; otherwise we emit deterministic mock results so the rest of the
 * pipeline can be developed and demoed without an API account.
 *
 * Mock results are seeded by the query string so the same query always
 * returns the same prospects (helpful for testing).
 */

import { hasKey, hashIndex } from "@/lib/utils"

const BRAVE_BASE = "https://api.search.brave.com/res/v1/web/search"

export interface BraveResult {
  title: string
  url: string
  description: string
}

export interface ProspectCandidate {
  name: string
  title: string
  company: string
  location?: string
  source: "brave" | "duckduckgo" | "mock" | "github" | "hn" | "producthunt" | "named" | "csv"
  source_url: string
  snippet: string
}

export async function braveSearchRaw(
  query: string,
  count = 20,
): Promise<BraveResult[]> {
  if (!hasKey("brave")) return []
  const res = await fetch(
    `${BRAVE_BASE}?q=${encodeURIComponent(query)}&count=${count}&country=IN`,
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": process.env.BRAVE_SEARCH_KEY!,
      },
      // Brave is fast but we don't want a hung Vercel function
      signal: AbortSignal.timeout(10_000),
    },
  )
  if (!res.ok) {
    throw new Error(`Brave Search ${res.status}: ${await res.text()}`)
  }
  const data = (await res.json()) as {
    web?: { results?: BraveResult[] }
  }
  return data.web?.results ?? []
}

/**
 * High-level discovery: takes a natural-language ICP description and
 * returns prospect candidates. Pure mock when no API key; real Brave
 * search + heuristic parse otherwise.
 */
export async function discoverProspects(opts: {
  query: string
  target_role?: string
  industry?: string
  location?: string
  max_results?: number
}): Promise<ProspectCandidate[]> {
  const max = opts.max_results ?? 15

  if (!hasKey("brave")) {
    return mockCandidates(opts, max)
  }

  // Bias toward LinkedIn snippets — they parse cleanly into role + company.
  const bias = " site:linkedin.com/in"
  const results = await braveSearchRaw(opts.query + bias, Math.min(max, 20))
  return results.slice(0, max).map(parseLinkedInSnippet).filter(Boolean) as ProspectCandidate[]
}

/**
 * Parses a Brave/Google result snippet of the form
 *   "Priya Sharma - Head of Marketing at Razorpay | LinkedIn"
 * into a structured ProspectCandidate. Returns null if it can't parse —
 * the caller filters those out.
 */
function parseLinkedInSnippet(r: BraveResult): ProspectCandidate | null {
  const cleaned = r.title.replace(/\s*\|\s*LinkedIn.*$/i, "").trim()
  // Pattern: "<Name> - <Title> at <Company>"  (most common)
  const m = cleaned.match(/^(.+?)\s+[-–—]\s+(.+?)\s+at\s+(.+?)$/i)
  if (m) {
    return {
      name: m[1].trim(),
      title: m[2].trim(),
      company: m[3].trim(),
      source: "brave",
      source_url: r.url,
      snippet: r.description,
    }
  }
  // Pattern: "<Name> - <Title>, <Company>"
  const m2 = cleaned.match(/^(.+?)\s+[-–—]\s+(.+?),\s+(.+?)$/i)
  if (m2) {
    return {
      name: m2[1].trim(),
      title: m2[2].trim(),
      company: m2[3].trim(),
      source: "brave",
      source_url: r.url,
      snippet: r.description,
    }
  }
  // Pattern: "<Name>" only — better than dropping
  if (cleaned.length > 0 && cleaned.length < 80) {
    return {
      name: cleaned,
      title: "(role unclear from snippet)",
      company: "(company unclear)",
      source: "brave",
      source_url: r.url,
      snippet: r.description,
    }
  }
  return null
}

// ---------------------------------------------------------------------
// Mock data — used when BRAVE_SEARCH_KEY is missing.
// ---------------------------------------------------------------------

const MOCK_PEOPLE: Array<Omit<ProspectCandidate, "snippet" | "source" | "source_url">> = [
  { name: "Priya Sharma", title: "Head of Marketing", company: "Razorpay", location: "Bangalore" },
  { name: "Rahul Mehta", title: "VP Sales", company: "Freshworks", location: "Chennai" },
  { name: "Ananya Iyer", title: "Director of Growth", company: "CRED", location: "Bangalore" },
  { name: "Vikram Singh", title: "Chief Marketing Officer", company: "Zerodha", location: "Bangalore" },
  { name: "Tanvir Ahmed", title: "Head of Demand Gen", company: "Postman", location: "Singapore" },
  { name: "Mira Kapoor", title: "Growth Lead", company: "Khatabook", location: "Mumbai" },
  { name: "Arjun Reddy", title: "CRO", company: "Chargebee", location: "Chennai" },
  { name: "Sneha Pillai", title: "Director, Product Marketing", company: "Hasura", location: "Bangalore" },
  { name: "Karthik Subramanian", title: "VP of Marketing", company: "Zoho", location: "Chennai" },
  { name: "Divya Nair", title: "Head of B2B Marketing", company: "MoEngage", location: "Bangalore" },
  { name: "Faisal Khan", title: "Co-founder & CEO", company: "Pesto Tech", location: "Bangalore" },
  { name: "Ritika Bose", title: "Marketing Lead, SEA", company: "Xendit", location: "Jakarta" },
  { name: "Aditya Bansal", title: "Growth Manager", company: "Setu", location: "Bangalore" },
  { name: "Lakshmi Rao", title: "Senior Director, Marketing", company: "Whatfix", location: "San Francisco / Bangalore" },
  { name: "Nikhil Verma", title: "Head of Customer Acquisition", company: "Slice", location: "Bangalore" },
]

function mockCandidates(opts: { query: string }, n: number): ProspectCandidate[] {
  const start = hashIndex(opts.query, MOCK_PEOPLE.length)
  const picked: ProspectCandidate[] = []
  for (let i = 0; i < Math.min(n, MOCK_PEOPLE.length); i++) {
    const p = MOCK_PEOPLE[(start + i) % MOCK_PEOPLE.length]
    picked.push({
      ...p,
      source: "mock",
      source_url: `https://www.linkedin.com/in/${p.name.toLowerCase().replace(/\s+/g, "-")}`,
      snippet: `${p.name} - ${p.title} at ${p.company}. ${p.location ? p.location + ". " : ""}Result from mock data (set BRAVE_SEARCH_KEY for real results).`,
    })
  }
  return picked
}
