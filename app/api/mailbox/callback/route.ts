/**
 * GET /api/mailbox/callback
 *
 * Completes the Gmail-sending OAuth dance: verifies the HMAC state,
 * exchanges the code for a refresh token + connected address, and
 * upserts a mailbox row (warm-up starts now).
 */

import { NextResponse } from "next/server"
import crypto from "node:crypto"

import { createClient, createAdminClient } from "@/lib/supabase/server"
import { exchangeMailboxCode } from "@/lib/providers/gmail"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url)
  const settings = `${origin}/app/settings/mailboxes`

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  const code = searchParams.get("code")
  const state = searchParams.get("state") ?? ""
  if (!code) return NextResponse.redirect(`${settings}?error=no_code`)

  // Verify state HMAC matches this user.
  const [stateUserId, sig] = state.split(".")
  const secret = process.env.MAILBOX_STATE_SECRET ?? "dev-mailbox-secret"
  const expected = crypto
    .createHmac("sha256", secret)
    .update(stateUserId ?? "")
    .digest("hex")
  if (stateUserId !== user.id || sig !== expected) {
    return NextResponse.redirect(`${settings}?error=bad_state`)
  }

  const exchanged = await exchangeMailboxCode(code)
  if (!exchanged || !exchanged.refreshToken) {
    return NextResponse.redirect(`${settings}?error=exchange_failed`)
  }

  const admin = createAdminClient()
  await admin.from("mailboxes").upsert(
    {
      user_id: user.id,
      provider: "gmail",
      email_address: exchanged.email,
      oauth_refresh_token: exchanged.refreshToken,
      warmup_started_at: new Date().toISOString(),
      daily_send_limit: 10,
      status: "active",
    },
    { onConflict: "user_id,email_address" },
  )

  return NextResponse.redirect(`${settings}?connected=1`)
}
