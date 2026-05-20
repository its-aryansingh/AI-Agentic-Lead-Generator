/**
 * GitHub public-source discovery.
 *
 * GitHub's REST search API is free and reachable without auth at
 * 60 req/hr per IP. With a personal-access token in `GITHUB_TOKEN` we
 * get 5000 req/hr — strongly recommended for production, but the path
 * works either way.
 *
 * We hit /search/users to find people matching the query, then look up
 * each user's profile for bio/company/location so the chat agent can
 * preview real candidates instead of just usernames.
 */

import type { ProspectCandidate } from "./brave-search"

const SEARCH_URL = "https://api.github.com/search/users"
const USER_URL = "https://api.github.com/users"

interface GhSearchHit {
  login: string
  html_url: string
}

interface GhUser {
  login: string
  name: string | null
  bio: string | null
  company: string | null
  location: string | null
  blog: string | null
  html_url: string
}

function authHeaders(): HeadersInit {
  const base: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "leadgenai/0.5",
  }
  if (process.env.GITHUB_TOKEN) {
    return { ...base, Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
  }
  return base
}

export async function searchGithubUsers(
  query: string,
  maxResults: number,
): Promise<ProspectCandidate[]> {
  // GitHub's search-user query syntax: keyword + qualifiers
  // Example: "founder location:bangalore" finds users whose profile
  // mentions "founder" and lives in Bangalore.
  const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&per_page=${Math.min(maxResults, 30)}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return []
  }
  if (!res.ok) return []
  const data = (await res.json()) as { items?: GhSearchHit[] }
  const hits = data.items?.slice(0, maxResults) ?? []

  // Fetch full profiles in parallel (3 at a time — be polite).
  const profiles = await mapConcurrent(hits, 3, async (h) => {
    try {
      const r = await fetch(`${USER_URL}/${h.login}`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(8_000),
      })
      if (!r.ok) return null
      return (await r.json()) as GhUser
    } catch {
      return null
    }
  })

  const out: ProspectCandidate[] = []
  for (const p of profiles) {
    if (!p) continue
    out.push({
      name: p.name ?? p.login,
      title: p.bio ?? "GitHub user",
      company: (p.company ?? "").replace(/^@/, "") || "(independent)",
      location: p.location ?? undefined,
      source: "github",
      source_url: p.html_url,
      snippet: [p.bio, p.location, p.company]
        .filter(Boolean)
        .join(" · ") || `GitHub profile @${p.login}`,
    })
  }
  return out
}

// Tiny concurrency-limited map — duplicated here so the provider has
// no internal cross-import on the agent layer.
async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers: Promise<void>[] = []
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = next++
          if (idx >= items.length) return
          out[idx] = await fn(items[idx])
        }
      })(),
    )
  }
  await Promise.all(workers)
  return out
}
