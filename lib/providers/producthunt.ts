/**
 * Product Hunt discovery — makers behind launches matching a query.
 *
 * With PRODUCTHUNT_TOKEN (developer API token) we query the v2 GraphQL API.
 * Without a token we return deterministic mock makers so demos work offline.
 *
 * API: https://api.producthunt.com/v2/docs
 */

import type { ProspectCandidate } from "./brave-search"
import { hashIndex } from "@/lib/utils"

const PH_GRAPHQL = "https://api.producthunt.com/v2/api/graphql"

interface PhMaker {
  name: string | null
  username: string
  headline: string | null
}

interface PhPostNode {
  name: string
  tagline: string | null
  url: string
  makers: PhMaker[]
}

const MOCK_MAKERS: Array<Omit<ProspectCandidate, "snippet" | "source" | "source_url">> = [
  { name: "Arnav Gupta", title: "Founder", company: "StackPilot", location: "Bangalore" },
  { name: "Meera Joshi", title: "Co-founder", company: "FlowDesk", location: "Mumbai" },
  { name: "Chris Tan", title: "Maker", company: "ShipFast AI", location: "Singapore" },
  { name: "Ishaan Patel", title: "CEO", company: "LedgerLoop", location: "Ahmedabad" },
  { name: "Nina Cho", title: "Founder", company: "PromptForge", location: "Seoul" },
  { name: "Leo Martins", title: "Indie hacker", company: "TinyCRM", location: "Lisbon" },
  { name: "Sara Kim", title: "Product lead", company: "NotionForms+", location: "Remote" },
  { name: "Dev Malhotra", title: "Maker", company: "ColdStart Kit", location: "Delhi" },
]

function hasProductHuntToken(): boolean {
  return Boolean(process.env.PRODUCTHUNT_TOKEN?.trim())
}

function mockProductHuntCandidates(query: string, max: number): ProspectCandidate[] {
  const start = hashIndex(query, MOCK_MAKERS.length)
  const out: ProspectCandidate[] = []
  for (let i = 0; i < Math.min(max, MOCK_MAKERS.length); i++) {
    const p = MOCK_MAKERS[(start + i) % MOCK_MAKERS.length]
    const slug = p.name.toLowerCase().replace(/\s+/g, "")
    out.push({
      ...p,
      source: "mock",
      source_url: `https://www.producthunt.com/@${slug}`,
      snippet: `${p.name} launched ${p.company} — ${p.title}. Mock Product Hunt data (set PRODUCTHUNT_TOKEN for live results).`,
    })
  }
  return out
}

/**
 * Search recent Product Hunt posts and return one prospect per unique maker.
 */
export async function searchProductHuntMakers(
  query: string,
  maxResults: number,
): Promise<ProspectCandidate[]> {
  if (!hasProductHuntToken()) {
    return mockProductHuntCandidates(query, maxResults)
  }

  const gql = `
    query RecentPosts($first: Int!) {
      posts(first: $first, order: RANKING) {
        edges {
          node {
            name
            tagline
            url
            makers {
              name
              username
              headline
            }
          }
        }
      }
    }
  `

  let res: Response
  try {
    res = await fetch(PH_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.PRODUCTHUNT_TOKEN}`,
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: gql,
        variables: { first: Math.min(maxResults * 6, 50) },
      }),
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    return mockProductHuntCandidates(query, maxResults)
  }

  if (!res.ok) {
    return mockProductHuntCandidates(query, maxResults)
  }

  const json = (await res.json()) as {
    data?: { posts?: { edges?: Array<{ node?: PhPostNode }> } }
    errors?: unknown[]
  }

  if (json.errors?.length) {
    return mockProductHuntCandidates(query, maxResults)
  }

  const edges = json.data?.posts?.edges ?? []
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
  const byUsername = new Map<string, ProspectCandidate>()

  for (const edge of edges) {
    const post = edge.node
    if (!post) continue
    const haystack = `${post.name} ${post.tagline ?? ""}`.toLowerCase()
    if (terms.length > 0 && !terms.some((t) => haystack.includes(t))) continue
    for (const maker of post.makers ?? []) {
      if (!maker.username || byUsername.has(maker.username)) continue
      const name = maker.name ?? maker.username
      byUsername.set(maker.username, {
        name,
        title: maker.headline ?? "Product Hunt maker",
        company: post.name,
        source: "producthunt",
        source_url: `https://www.producthunt.com/@${maker.username}`,
        snippet: [post.tagline, `Launched ${post.name}`].filter(Boolean).join(" — "),
      })
      if (byUsername.size >= maxResults) break
    }
    if (byUsername.size >= maxResults) break
  }

  const results = Array.from(byUsername.values())
  return results.length > 0 ? results : mockProductHuntCandidates(query, maxResults)
}
