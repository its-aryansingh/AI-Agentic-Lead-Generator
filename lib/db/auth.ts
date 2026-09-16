/**
 * Authentication, replacing Supabase Auth.
 *
 * Supabase gave you: a users table with hashed passwords, Google OAuth,
 * JWT sessions, and cookie handling. All of it has to exist here now.
 *
 * WHAT CHANGED IN THE DATABASE
 * `public.users.id` used to reference `auth.users(id)`. That schema is
 * gone, so `public.users` becomes the real identity table and gains
 * `password_hash` and `google_sub`. See db/migrations/0002_auth.sql.
 *
 * PASSWORD HASHING: scrypt from node:crypto — no native build step, no
 * extra dependency, and memory-hard, unlike a bare SHA. Parameters are
 * stored in the hash string so they can be raised later without
 * invalidating existing passwords.
 *
 * Sessions are the HS256 JWT from lib/auth/require-user.ts, set as an
 * httpOnly cookie. Tokens are stateless: a signed-out token stays valid
 * until it expires, so keep the TTL modest.
 */

import crypto from "node:crypto"
import { promisify } from "node:util"

import { getPool, query, queryOne } from "@/lib/db"
import { signSessionJwt, verifySessionJwt, type AuthedUser } from "@/lib/auth/require-user"

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

// OWASP-recommended floor for scrypt at the time of writing.
const SCRYPT_N = 16384
const SCRYPT_KEYLEN = 64
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

export const SESSION_COOKIE = process.env.AUTH_COOKIE_NAME ?? "leadgen_session"

function sessionSecret(): string {
  const s = process.env.AUTH_JWT_SECRET
  if (!s || s.length < 32) {
    throw new Error("AUTH_JWT_SECRET must be set and at least 32 characters")
  }
  return s
}

// ---------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16)
  const key = await scrypt(password, salt, SCRYPT_KEYLEN)
  return `scrypt$${SCRYPT_N}$${salt.toString("base64")}$${key.toString("base64")}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$")
  if (parts.length !== 4 || parts[0] !== "scrypt") return false

  const salt = Buffer.from(parts[2], "base64")
  const expected = Buffer.from(parts[3], "base64")
  const actual = await scrypt(password, salt, expected.length)

  // Constant-time: a length check first, because timingSafeEqual throws
  // on a mismatch and that throw is itself an oracle.
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

// ---------------------------------------------------------------------
// Session cookie
// ---------------------------------------------------------------------

export function buildSessionCookie(user: AuthedUser): string {
  const token = signSessionJwt(user, sessionSecret(), SESSION_TTL_SECONDS)
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ]
  // Railway terminates TLS, so production is always https.
  if (process.env.NODE_ENV === "production") attrs.push("Secure")
  return attrs.join("; ")
}

export function buildLogoutCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export function readSessionToken(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="))
  }
  return null
}

export function userFromCookieHeader(cookieHeader: string | null | undefined): AuthedUser | null {
  const token = readSessionToken(cookieHeader)
  if (!token) return null
  try {
    return verifySessionJwt(token, sessionSecret())
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------
// Sign-up / sign-in
// ---------------------------------------------------------------------

export interface AuthResult {
  user: AuthedUser | null
  error: { message: string; code?: string } | null
  /** Set-Cookie value to attach to the response. */
  cookie?: string
}

interface UserRow {
  id: string
  email: string
  password_hash: string | null
  google_sub: string | null
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  const clean = email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    return { user: null, error: { message: "Enter a valid email address" } }
  }
  if (password.length < 8) {
    return { user: null, error: { message: "Password must be at least 8 characters" } }
  }

  const existing = await queryOne<UserRow>(`select id from public.users where email = $1`, [clean])
  if (existing) {
    return { user: null, error: { message: "An account with that email already exists" } }
  }

  const hash = await hashPassword(password)
  const row = await queryOne<UserRow>(
    `insert into public.users (id, email, password_hash)
     values (gen_random_uuid(), $1, $2)
     returning id, email, password_hash, google_sub`,
    [clean, hash],
  )
  if (!row) return { user: null, error: { message: "Could not create the account" } }

  const user: AuthedUser = { id: row.id, email: row.email }
  return { user, error: null, cookie: buildSessionCookie(user) }
}

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  const clean = email.trim().toLowerCase()
  const row = await queryOne<UserRow>(
    `select id, email, password_hash, google_sub from public.users where email = $1`,
    [clean],
  )

  // Always spend the hashing time, even when the user does not exist:
  // an early return here leaks which emails have accounts.
  const stored = row?.password_hash ?? "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAA"
  const ok = await verifyPassword(password, stored)

  if (!row || !row.password_hash || !ok) {
    return { user: null, error: { message: "Invalid email or password", code: "invalid_credentials" } }
  }

  const user: AuthedUser = { id: row.id, email: row.email }
  return { user, error: null, cookie: buildSessionCookie(user) }
}

// ---------------------------------------------------------------------
// Google OAuth — replaces signInWithOAuth + exchangeCodeForSession
// ---------------------------------------------------------------------

export function googleAuthUrl(params: {
  redirectUri: string
  state: string
  /** Extra scopes beyond identity — e.g. Sheets or Gmail. */
  scopes?: string[]
}): string {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set")

  const scopes = ["openid", "email", "profile", ...(params.scopes ?? [])]
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  u.searchParams.set("client_id", clientId)
  u.searchParams.set("redirect_uri", params.redirectUri)
  u.searchParams.set("response_type", "code")
  u.searchParams.set("scope", scopes.join(" "))
  u.searchParams.set("state", params.state)
  // offline + consent are what actually produce a refresh_token, which
  // the Sheets and Gmail integrations depend on.
  u.searchParams.set("access_type", "offline")
  u.searchParams.set("prompt", "consent")
  return u.toString()
}

interface GoogleTokens {
  access_token: string
  refresh_token?: string
  id_token: string
  expires_in: number
}

export interface GoogleIdentity {
  sub: string
  email: string
  email_verified: boolean
  name?: string
  picture?: string
}

/** Decodes an id_token. Google just issued it over TLS, so the signature
 *  is not re-verified here — but the audience is, because a token minted
 *  for a different client must never be accepted. */
function decodeIdToken(idToken: string): GoogleIdentity | null {
  const parts = idToken.split(".")
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as GoogleIdentity & { aud?: string; iss?: string; exp?: number }

    if (payload.aud !== process.env.GOOGLE_CLIENT_ID) return null
    if (!/^(https:\/\/)?accounts\.google\.com$/.test(payload.iss ?? "")) return null
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null
    if (!payload.sub || !payload.email) return null

    return payload
  } catch {
    return null
  }
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<{ identity: GoogleIdentity; tokens: GoogleTokens } | { error: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return { error: "Google OAuth is not configured" }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    return { error: `Google token exchange failed (${res.status}): ${detail.slice(0, 200)}` }
  }

  const tokens = (await res.json()) as GoogleTokens
  const identity = decodeIdToken(tokens.id_token)
  if (!identity) return { error: "Google returned an id_token this app cannot accept" }
  if (!identity.email_verified) return { error: "Your Google email is not verified" }

  return { identity, tokens }
}

/**
 * Upserts the account and returns a session.
 *
 * Matches on google_sub first, then falls back to email so an existing
 * password account is linked rather than duplicated.
 */
export async function signInWithGoogle(
  identity: GoogleIdentity,
  refreshToken?: string,
): Promise<AuthResult> {
  const email = identity.email.trim().toLowerCase()
  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query("begin")

    let row = (
      await client.query<UserRow>(
        `select id, email, password_hash, google_sub from public.users
          where google_sub = $1 or email = $2 limit 1`,
        [identity.sub, email],
      )
    ).rows[0]

    if (row) {
      await client.query(
        `update public.users
            set google_sub = $1,
                email = $2,
                google_refresh_token = coalesce($3, google_refresh_token)
          where id = $4`,
        [identity.sub, email, refreshToken ?? null, row.id],
      )
    } else {
      row = (
        await client.query<UserRow>(
          `insert into public.users (id, email, google_sub, google_refresh_token)
           values (gen_random_uuid(), $1, $2, $3)
           returning id, email, password_hash, google_sub`,
          [email, identity.sub, refreshToken ?? null],
        )
      ).rows[0]
    }

    await client.query("commit")
    const user: AuthedUser = { id: row.id, email: row.email }
    return { user, error: null, cookie: buildSessionCookie(user) }
  } catch (err) {
    await client.query("rollback").catch(() => undefined)
    return { user: null, error: { message: (err as Error).message } }
  } finally {
    client.release()
  }
}

/** Confirms the session's user still exists. */
export async function getUserById(id: string): Promise<AuthedUser | null> {
  const row = await queryOne<{ id: string; email: string }>(
    `select id, email from public.users where id = $1`,
    [id],
  )
  return row ? { id: row.id, email: row.email } : null
}

/** OAuth state parameter — HMAC-signed, so the callback can trust it. */
export function signOAuthState(payload: Record<string, string>, ttlSeconds = 600): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  ).toString("base64url")
  const sig = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url")
  return `${body}.${sig}`
}

export function verifyOAuthState(state: string): Record<string, string> | null {
  const [body, sig] = state.split(".")
  if (!body || !sig) return null

  const expected = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url")
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<
      string,
      string
    > & { exp?: number }
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

/** Ensures a user row exists — used by the legacy `users` upsert paths. */
export async function ensureUserRow(id: string, email: string): Promise<void> {
  await query(
    `insert into public.users (id, email) values ($1, $2)
     on conflict (id) do update set email = excluded.email`,
    [id, email.trim().toLowerCase()],
  )
}
