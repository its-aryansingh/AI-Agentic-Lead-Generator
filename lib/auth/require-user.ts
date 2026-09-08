/**
 * Auth seam for the enrichment endpoints.
 *
 * The rest of the app still authenticates through Supabase Auth. This file
 * is the one place the enrichment pipeline asks "who is calling?", so that
 * when you finish moving off Supabase you change this file and nothing
 * else in lib/enrichment/.
 *
 * Two modes, chosen by environment:
 *
 *   AUTH_JWT_SECRET set   -> Railway-native. Verifies an HS256 session JWT
 *                            you issue at login. No Supabase involved.
 *   otherwise             -> delegates to the existing Supabase helper via
 *                            dynamic import, so nothing breaks today.
 *
 * The Supabase branch is a DYNAMIC import on purpose: once AUTH_JWT_SECRET
 * is set, @supabase/supabase-js is never loaded by this path and can be
 * dropped from the dependency tree without touching the engine.
 */

import crypto from "node:crypto"

export interface AuthedUser {
  id: string
  email?: string
}

export type AuthOutcome =
  | { user: AuthedUser; source: "jwt" | "supabase" }
  | { user: null; source: null; reason: string }

// ---------------------------------------------------------------------
// Railway-native: HS256 JWT
// ---------------------------------------------------------------------

function b64urlDecode(part: string): string {
  return Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
}

/**
 * Verifies an HS256 JWT with a constant-time signature comparison.
 *
 * Deliberately hand-rolled rather than pulling a library: the only
 * algorithm accepted is HS256, read from OUR expectation and never from
 * the token header. Trusting `header.alg` is the classic JWT
 * vulnerability — a token claiming "alg":"none" must never verify.
 */
export function verifySessionJwt(token: string, secret: string): AuthedUser | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null

  const [rawHeader, rawPayload, rawSig] = parts

  let header: { alg?: string; typ?: string }
  let payload: { sub?: string; email?: string; exp?: number; nbf?: number }
  try {
    header = JSON.parse(b64urlDecode(rawHeader))
    payload = JSON.parse(b64urlDecode(rawPayload))
  } catch {
    return null
  }

  // Pin the algorithm. Never dispatch on header.alg.
  if (header.alg !== "HS256") return null

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${rawHeader}.${rawPayload}`)
    .digest("base64url")

  const a = Buffer.from(rawSig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp === "number" && payload.exp < now) return null
  if (typeof payload.nbf === "number" && payload.nbf > now) return null
  if (!payload.sub) return null

  return { id: payload.sub, email: payload.email }
}

/** Mint a session token. Use at login once Supabase Auth is gone. */
export function signSessionJwt(
  user: AuthedUser,
  secret: string,
  ttlSeconds = 60 * 60 * 24 * 7,
): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({ sub: user.id, email: user.email, iat: now, exp: now + ttlSeconds }),
  ).toString("base64url")
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url")
  return `${header}.${payload}.${sig}`
}

const SESSION_COOKIE = process.env.AUTH_COOKIE_NAME ?? "leadgen_session"

function readToken(req: Request): string | null {
  const auth = req.headers.get("authorization")
  const bearer = auth && /^Bearer\s+(.+)$/i.exec(auth.trim())
  if (bearer) return bearer[1].trim()

  const cookie = req.headers.get("cookie") ?? ""
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="))
  }
  return null
}

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------

export async function requireUser(req: Request): Promise<AuthOutcome> {
  const secret = process.env.AUTH_JWT_SECRET

  if (secret) {
    const token = readToken(req)
    if (!token) return { user: null, source: null, reason: "no session token" }
    const user = verifySessionJwt(token, secret)
    return user
      ? { user, source: "jwt" }
      : { user: null, source: null, reason: "invalid or expired session" }
  }

  // Legacy path while Supabase Auth is still live.
  try {
    const { getUserFromRequest } = await import("@/lib/api-auth")
    const result = await getUserFromRequest(req)
    if (result.user) return { user: { id: result.user.id, email: result.user.email }, source: "supabase" }
    return { user: null, source: null, reason: result.reason ?? "unauthorized" }
  } catch {
    return {
      user: null,
      source: null,
      reason:
        "No auth configured. Set AUTH_JWT_SECRET for the Railway-native path, " +
        "or keep the Supabase client available.",
    }
  }
}
