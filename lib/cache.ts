/**
 * Postgres-backed get-or-set cache.
 *
 * Used by every provider that hits external services. Cache hits are
 * the single biggest lever on per-prospect unit economics — they also
 * gradually accumulate into a proprietary data asset.
 */

import crypto from "node:crypto"

import { createAdminClient } from "@/lib/supabase/server"

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex")
}

export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cacheKey = sha256(key)
  const supabase = createAdminClient()

  try {
    const { data: hit } = await supabase
      .from("scrape_cache")
      .select("payload,expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle()

    if (hit && new Date(hit.expires_at as string) > new Date()) {
      return hit.payload as T
    }
  } catch {
    // Cache table not yet created (fresh project) — fall through to fetch.
  }

  const fresh = await fetcher()

  try {
    await supabase.from("scrape_cache").upsert({
      cache_key: cacheKey,
      scrape_type: key.split(":")[0],
      payload: fresh as Record<string, unknown>,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    })
  } catch {
    // Best-effort cache write — never let a cache failure break the user flow.
  }

  return fresh
}
