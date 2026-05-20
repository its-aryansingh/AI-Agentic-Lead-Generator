/**
 * Hacker News search via the Algolia-hosted HN API.
 *
 * No auth, no rate limit headers worth worrying about. Useful for
 * finding founders / indie hackers / technical CEOs who post on HN.
 *
 * API docs: https://hn.algolia.com/api
 */

import type { ProspectCandidate } from "./brave-search"

const HN_SEARCH = "https://hn.algolia.com/api/v1/search"

interface HnHit {
  objectID: string
  author: string
  title: string | null
  story_title: string | null
  url: string | null
  story_url: string | null
  comment_text: string | null
  created_at: string
}

/**
 * Returns one prospect per *unique HN author* matching the query.
 * The author handle is the closest thing HN exposes to a person; we
 * use their HN profile URL as the source_url and the matched story/
 * comment snippet as their context.
 */
export async function searchHnUsers(
  query: string,
  maxResults: number,
): Promise<ProspectCandidate[]> {
  const url = `${HN_SEARCH}?query=${encodeURIComponent(query)}&hitsPerPage=${Math.min(maxResults * 3, 100)}&tags=story,comment`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  } catch {
    return []
  }
  if (!res.ok) return []
  const data = (await res.json()) as { hits?: HnHit[] }
  const hits = data.hits ?? []

  // Dedupe by author — one row per person, picking the best hit.
  const byAuthor = new Map<string, HnHit>()
  for (const h of hits) {
    if (!h.author) continue
    if (!byAuthor.has(h.author)) byAuthor.set(h.author, h)
  }

  const out: ProspectCandidate[] = []
  for (const h of Array.from(byAuthor.values()).slice(0, maxResults)) {
    const snippet =
      h.story_title ?? h.title ?? stripHtml(h.comment_text ?? "") ?? `HN activity for ${h.author}`
    out.push({
      name: h.author,
      title: "Active on Hacker News",
      company: "(independent)",
      source: "hn",
      source_url: `https://news.ycombinator.com/user?id=${encodeURIComponent(h.author)}`,
      snippet: truncate(snippet, 240),
    })
  }
  return out
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&[#\w]+;/g, " ").trim()
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…"
}
