/**
 * Request-level auth helpers.
 *
 * `getUserFromBearer` — validates an `Authorization: Bearer <jwt>` header
 * against Supabase. Used by routes that must work from non-browser origins
 * (Chrome extension, native apps, server-to-server) where cookies can't
 * cross the origin boundary.
 *
 * `getUserFromRequest` — tries bearer first, falls back to cookie auth via
 * `createClient()`. Drop-in replacement for routes that previously did
 * `(await createClient()).auth.getUser()` and want to additionally accept
 * bearer-authed callers without changing browser behaviour.
 */

import type { User } from "@supabase/supabase-js"
import { createAdminClient, createClient } from "@/lib/supabase/server"
import { parseBearerToken, looksLikeJwt } from "@/lib/api-auth-core"

export interface AuthSuccess {
  user: User
  source: "bearer" | "cookie"
}

export type AuthResult = AuthSuccess | { user: null; source: null; reason: string }

export async function getUserFromBearer(req: Request): Promise<AuthResult> {
  const token = parseBearerToken(req.headers.get("authorization"))
  if (!token) return { user: null, source: null, reason: "no bearer token" }
  if (!looksLikeJwt(token)) return { user: null, source: null, reason: "malformed token" }

  const admin = createAdminClient()
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) {
    return { user: null, source: null, reason: error?.message ?? "invalid token" }
  }
  return { user: data.user, source: "bearer" }
}

export async function getUserFromRequest(req: Request): Promise<AuthResult> {
  const bearer = await getUserFromBearer(req)
  if (bearer.user) return bearer

  // Cookie fallback — the existing browser path.
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    if (data?.user) return { user: data.user, source: "cookie" }
  } catch {
    // createClient() requires the next/headers cookies() store; if
    // called from a context where that's unavailable, treat as no auth.
  }
  return { user: null, source: null, reason: bearer.reason }
}
