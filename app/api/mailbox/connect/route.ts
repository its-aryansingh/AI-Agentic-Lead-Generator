/**
 * GET /api/mailbox/connect
 *
 * Kicks off the dedicated Gmail-sending OAuth dance (separate from the
 * lightweight sign-in OAuth). Redirects to Google's consent screen with
 * gmail.send + gmail.readonly scopes. The `state` carries an HMAC of the
 * user id so the callback can verify the round-trip.
 */

import { NextResponse } from "next/server"
import crypto from "node:crypto"

import { createClient } from "@/lib/supabase/server"
import { mailboxConsentUrl } from "@/lib/providers/gmail"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const { origin } = new URL(request.url)
    return NextResponse.redirect(`${origin}/login`)
  }

  const { origin } = new URL(request.url)
  const secret = process.env.MAILBOX_STATE_SECRET ?? "dev-mailbox-secret"
  const sig = crypto.createHmac("sha256", secret).update(user.id).digest("hex")
  const state = `${user.id}.${sig}`

  const url = mailboxConsentUrl(state)
  if (!url) {
    // Google not configured — explain rather than dead-end.
    return NextResponse.redirect(
      `${origin}/app/settings/mailboxes?error=google_not_configured`,
    )
  }
  return NextResponse.redirect(url)
}
