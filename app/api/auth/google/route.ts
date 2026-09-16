import { NextResponse } from "next/server"
import { googleAuthUrl, signOAuthState } from "@/lib/db/auth"

export const runtime = "nodejs"

function redirectUri(req: Request): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
  return `${base.replace(/\/$/, "")}/api/auth/google/callback`
}

export async function GET(req: Request) {
  const next = new URL(req.url).searchParams.get("next") ?? "/app"
  // Only relative paths: an absolute `next` is an open redirect.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app"

  try {
    const url = googleAuthUrl({
      redirectUri: redirectUri(req),
      // Signed state: CSRF protection AND the post-login destination.
      state: signOAuthState({ next: safeNext }),
      // Sheets + Gmail send, which the export and campaign features need.
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/gmail.send",
      ],
    })
    return NextResponse.redirect(url)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
