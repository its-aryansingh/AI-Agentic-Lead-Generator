/**
 * Legacy Google OAuth callback.
 *
 * This used to call Supabase's exchangeCodeForSession. Supabase Auth is
 * gone, but the path is kept because it may still be registered in Google
 * Cloud Console as an authorised redirect URI, and because existing
 * bookmarks and in-flight consent screens point at it.
 *
 * It now performs the same exchange through lib/db/auth.ts. The canonical
 * route is /api/auth/google/callback; both behave identically.
 *
 * Once Google Console lists only /api/auth/google/callback, this file can
 * be deleted.
 */

import { NextResponse } from "next/server"

import { exchangeGoogleCode, signInWithGoogle, verifyOAuthState } from "@/lib/db/auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? url.origin).replace(/\/$/, "")
  const fail = (reason: string) =>
    NextResponse.redirect(`${base}/login?error=${encodeURIComponent(reason)}`)

  if (url.searchParams.get("error")) return fail(url.searchParams.get("error")!)

  const code = url.searchParams.get("code")
  if (!code) return fail("no_code")

  // State is optional here: a consent screen opened before the migration
  // will not carry one. When present it is still verified — an invalid
  // state must never be treated as "no state".
  const state = url.searchParams.get("state")
  let next = "/app/chat"
  if (state) {
    const claims = verifyOAuthState(state)
    if (!claims) return fail("invalid_state")
    if (claims.next?.startsWith("/") && !claims.next.startsWith("//")) next = claims.next
  }

  // The redirect_uri sent to Google must match this exact path.
  const exchanged = await exchangeGoogleCode(code, `${base}/api/auth/callback`)
  if ("error" in exchanged) return fail("auth_failed")

  // signInWithGoogle upserts the user row and stores the refresh token
  // that the Sheets export and Gmail send paths depend on.
  const session = await signInWithGoogle(exchanged.identity, exchanged.tokens.refresh_token)
  if (!session.user || !session.cookie) return fail("auth_failed")

  const res = NextResponse.redirect(`${base}${next}`)
  res.headers.set("Set-Cookie", session.cookie)
  return res
}
