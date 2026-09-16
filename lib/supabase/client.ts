/**
 * Browser-side client.
 *
 * The Supabase browser SDK is gone, and nothing replaces it directly:
 * a browser cannot hold a Postgres connection, and exposing one would
 * hand every visitor the database.
 *
 * So the browser talks to the app's own API routes, which run the
 * user-scoped client server-side. The auth helpers below post to those
 * routes and let the server set an httpOnly session cookie — which is
 * also an improvement on the previous design, where the session token was
 * readable by any script on the page.
 *
 * `createClient()` is kept as a throwing stub rather than deleted, so a
 * forgotten browser-side data call fails loudly in development instead of
 * silently returning nothing.
 */

export function createClient(): never {
  throw new Error(
    "There is no browser database client. Call an API route under /api/* — " +
      "those run the user-scoped client on the server. For auth, use " +
      "signIn / signUp / signOut from this module.",
  )
}

export interface BrowserAuthResult {
  ok: boolean
  error?: string
  user?: { id: string; email?: string }
}

async function post(path: string, body: unknown): Promise<BrowserAuthResult> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Required for the server's Set-Cookie to be stored.
      credentials: "same-origin",
    })
    const json = (await res.json().catch(() => ({}))) as { error?: string; user?: { id: string; email?: string } }
    return res.ok ? { ok: true, user: json.user } : { ok: false, error: json.error ?? `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function signUp(email: string, password: string): Promise<BrowserAuthResult> {
  return post("/api/auth/signup", { email, password })
}

export function signIn(email: string, password: string): Promise<BrowserAuthResult> {
  return post("/api/auth/signin", { email, password })
}

export function signOut(): Promise<BrowserAuthResult> {
  return post("/api/auth/signout", {})
}

/** Full-page redirect into Google's consent screen. */
export function signInWithGoogle(next = "/app"): void {
  window.location.href = `/api/auth/google?next=${encodeURIComponent(next)}`
}
