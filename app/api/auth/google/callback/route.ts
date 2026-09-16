import { NextResponse } from "next/server"
import { exchangeGoogleCode, signInWithGoogle, verifyOAuthState } from "@/lib/db/auth"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? url.origin).replace(/\/$/, "")
  const fail = (reason: string) =>
    NextResponse.redirect(`${base}/login?error=${encodeURIComponent(reason)}`)

  if (url.searchParams.get("error")) return fail(url.searchParams.get("error")!)

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!code || !state) return fail("missing_code")

  // Verify state BEFORE spending a token exchange on it.
  const claims = verifyOAuthState(state)
  if (!claims) return fail("invalid_state")

  const exchanged = await exchangeGoogleCode(code, `${base}/api/auth/google/callback`)
  if ("error" in exchanged) return fail(exchanged.error)

  const session = await signInWithGoogle(exchanged.identity, exchanged.tokens.refresh_token)
  if (!session.user || !session.cookie) return fail(session.error?.message ?? "signin_failed")

  const next = claims.next?.startsWith("/") && !claims.next.startsWith("//") ? claims.next : "/app"
  const res = NextResponse.redirect(`${base}${next}`)
  res.headers.set("Set-Cookie", session.cookie)
  return res
}
