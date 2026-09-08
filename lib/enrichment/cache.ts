/**
 * Postgres-backed get-or-set cache for the enrichment pipeline.
 *
 * A Railway-native replacement for lib/cache.ts, which goes through
 * @supabase/supabase-js. Same table (public.scrape_cache), same SHA-256
 * keying, so the two can coexist while the rest of the app migrates.
 *
 * WHAT MAY BE CACHED HERE: company-level public data only, keyed by
 * domain. scrape_cache has no tenant column, so anything target-specific
 * written through this path would become readable across users.
 */

import crypto from "node:crypto"

import { query, queryOne } from "@/lib/db"

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex")
}

export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cacheKey = sha256(key)

  try {
    const hit = await queryOne<{ payload: T }>(
      `select payload from public.scrape_cache
        where cache_key = $1 and expires_at > now()`,
      [cacheKey],
    )
    if (hit) return hit.payload
  } catch {
    // Table not created yet on a fresh database — fall through and fetch.
  }

  const fresh = await fetcher()

  try {
    await query(
      `insert into public.scrape_cache (cache_key, scrape_type, payload, expires_at)
       values ($1, $2, $3::jsonb, now() + make_interval(secs => $4))
       on conflict (cache_key) do update
         set payload = excluded.payload,
             fetched_at = now(),
             expires_at = excluded.expires_at`,
      [cacheKey, key.split(":")[0], JSON.stringify(fresh), ttlSeconds],
    )
  } catch {
    // Best-effort: a cache write must never break the user flow.
  }

  return fresh
}

/** Ops helper: drop a domain's cached crawl to force a fresh one. */
export async function invalidateCache(key: string): Promise<void> {
  await query(`delete from public.scrape_cache where cache_key = $1`, [sha256(key)])
}
