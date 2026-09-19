/**
 * Drop-in replacement for the Supabase server client, backed by Railway
 * Postgres.
 *
 * The filename and the exported function names are unchanged on purpose:
 * 33 files import `createClient` / `createAdminClient` from here and none
 * of them had to be edited. What changed is underneath — `.from(...)` now
 * builds SQL through lib/db/query-builder.ts instead of HTTP to PostgREST.
 *
 * THE IMPORTANT DIFFERENCE, stated plainly:
 *
 *   createClient()       user-scoped. The ownership predicate from
 *                        lib/db/rls.ts is injected into every statement,
 *                        which is what used to be a Row Level Security
 *                        policy. This is now the ONLY thing standing
 *                        between one tenant and another.
 *
 *   createAdminClient()  service role. No predicate is injected, exactly
 *                        as the Supabase service key bypassed RLS. Every
 *                        query MUST carry its own ownership filter.
 *
 * If a table has no entry in OWNERSHIP, a user-scoped query fails closed
 * with a 42501-style error rather than returning rows.
 */

import { cookies } from "next/headers"

import { QueryBuilder } from "@/lib/db/query-builder"
import { query } from "@/lib/db"
import { getUserById, userFromCookieHeader } from "@/lib/db/auth"
import type { AuthedUser } from "@/lib/auth/require-user"

export interface CompatAuth {
  getUser(jwt?: string): Promise<{ data: { user: AuthedUser | null }; error: { message: string } | null }>
  getSession(): Promise<{ data: { session: { user: AuthedUser } | null }; error: null }>
  /** Clears the session cookie. Server Actions and Route Handlers only. */
  signOut(): Promise<{ error: { message: string } | null }>
  signUp(credentials: { email: string; password: string }): Promise<{
    data: { user: AuthedUser | null }
    error: { message: string } | null
  }>
  signInWithPassword(credentials: { email: string; password: string }): Promise<{
    data: { user: AuthedUser | null }
    error: { message: string } | null
  }>
}

export interface CompatClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from<T = any>(table: string): QueryBuilder<T>
  /**
   * supabase-js types rpc() as `any` unless the caller supplies a
   * generated Database type, and ~15 ported call sites destructure and
   * iterate the result on that basis. Defaulting to `unknown` here made
   * every one of them a compile error for no safety gain, since none of
   * them can narrow what a SQL function returns anyway.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<{ data: T | null; error: { message: string; code?: string } | null }>
  auth: CompatAuth
}

function makeRpc(userId: string | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}) {
    try {
      // Replaces the Supabase grant/revoke on these functions. See
      // SERVICE_ONLY_RPC in lib/db/rls.ts for why the database can no
      // longer enforce it.
      if (userId) {
        const { rpcDenied } = await import("@/lib/db/rls")
        const denied = rpcDenied(fn)
        if (denied) return { data: null, error: { message: denied, code: "42501" } }
      }
      const keys = Object.keys(args)
      const named = keys.map((k, i) => `${k} => $${i + 1}`).join(", ")
      const params = keys.map((k) => {
        const v = args[k]
        return v !== null && typeof v === "object" ? JSON.stringify(v) : v
      })
      const rows = await query(`select * from public.${fn}(${named})`, params)
      return { data: rows as T, error: null }
    } catch (err) {
      const e = err as { message: string; code?: string }
      return { data: null, error: { message: e.message, code: e.code } }
    }
  }
}

/**
 * Writes the session cookie from a Server Action or Route Handler.
 * Silently no-ops in a Server Component, where cookies are read-only —
 * the API routes under /api/auth set the header directly instead.
 */
async function setSessionCookie(cookie: string): Promise<void> {
  try {
    const { cookies } = await import("next/headers")
    const store = await cookies()
    const [pair, ...attrs] = cookie.split("; ")
    const eq = pair.indexOf("=")
    const name = pair.slice(0, eq)
    const value = decodeURIComponent(pair.slice(eq + 1))
    const opts: Record<string, unknown> = { path: "/", httpOnly: true, sameSite: "lax" }
    for (const a of attrs) {
      const [k, v] = a.split("=")
      if (/^max-age$/i.test(k)) opts.maxAge = Number(v)
      if (/^secure$/i.test(k)) opts.secure = true
    }
    store.set(name, value, opts)
  } catch {
    // Read-only cookie context.
  }
}

function makeClient(userId: string | null): CompatClient {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from<T = any>(table: string) {
      return new QueryBuilder<T>(table, userId)
    },
    rpc: makeRpc(userId),
    auth: {
      async getUser(jwt?: string) {
        // Bearer path: verify the token that was handed in.
        if (jwt) {
          const { verifySessionJwt } = await import("@/lib/auth/require-user")
          const secret = process.env.AUTH_JWT_SECRET
          if (!secret) return { data: { user: null }, error: { message: "AUTH_JWT_SECRET not set" } }
          const u = verifySessionJwt(jwt, secret)
          return u
            ? { data: { user: u }, error: null }
            : { data: { user: null }, error: { message: "invalid token" } }
        }
        if (!userId) return { data: { user: null }, error: { message: "no session" } }
        const u = await getUserById(userId)
        return u
          ? { data: { user: u }, error: null }
          : { data: { user: null }, error: { message: "user not found" } }
      },
      async getSession() {
        if (!userId) return { data: { session: null }, error: null }
        const u = await getUserById(userId)
        return { data: { session: u ? { user: u } : null }, error: null }
      },

      async signOut() {
        // Sessions are stateless JWTs: this deletes the cookie but cannot
        // revoke a token already copied elsewhere. Hence the 7-day TTL.
        try {
          const { cookies } = await import("next/headers")
          const store = await cookies()
          const { SESSION_COOKIE } = await import("@/lib/db/auth")
          store.delete(SESSION_COOKIE)
          return { error: null }
        } catch (err) {
          // Server Components cannot mutate cookies. Call this from a
          // Server Action or a Route Handler.
          return { error: { message: (err as Error).message } }
        }
      },

      async signUp({ email, password }: { email: string; password: string }) {
        const { signUp: doSignUp } = await import("@/lib/db/auth")
        const r = await doSignUp(email, password)
        if (r.user && r.cookie) await setSessionCookie(r.cookie)
        return { data: { user: r.user }, error: r.error }
      },

      async signInWithPassword({ email, password }: { email: string; password: string }) {
        const { signInWithPassword: doSignIn } = await import("@/lib/db/auth")
        const r = await doSignIn(email, password)
        if (r.user && r.cookie) await setSessionCookie(r.cookie)
        return { data: { user: r.user }, error: r.error }
      },
    },
  }
}

/**
 * Request-scoped client. Reads the session cookie and applies the
 * ownership predicate to every query, replacing RLS.
 *
 * Async to match the previous signature — every call site already awaits it.
 */
export async function createClient(): Promise<CompatClient> {
  let userId: string | null = null
  try {
    const store = await cookies()
    const header = store
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ")
    userId = userFromCookieHeader(header)?.id ?? null
  } catch {
    // Called outside a request context (a script, a test). No session.
  }
  return makeClient(userId)
}

/** Build a user-scoped client when the id is already known (Bearer auth). */
export function createClientForUser(userId: string): CompatClient {
  return makeClient(userId)
}

/**
 * Service-role client. Bypasses ownership injection, exactly as the
 * Supabase service key bypassed RLS.
 *
 * Never expose this to browser code, and never use it for a query whose
 * WHERE clause does not already scope to a single user.
 */
export function createAdminClient(): CompatClient {
  return makeClient(null)
}
