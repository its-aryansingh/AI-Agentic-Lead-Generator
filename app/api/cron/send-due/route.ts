/**
 * POST /api/cron/send-due
 *
 * The scheduled-send worker. Runs every ~15 min via Vercel Cron.
 * For each active campaign + mailbox:
 *   1. Reset daily_sent if a new calendar day started.
 *   2. Compute the effective cap = min(warm-up curve, mailbox limit, campaign cap).
 *   3. Find scheduled recipients due now, within the send window.
 *   4. For each (up to remaining cap): suppression check → inject
 *      compliance footer → send via Gmail → record sent/message_id/thread_id.
 *
 * Cron-secret gated. Never sends to a suppressed address.
 */

import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/server"
import { sendGmail, warmupCap, classifyGmailError } from "@/lib/providers/gmail"
import { decryptCredential } from "@/lib/credential-crypto"
import {
  appendComplianceFooter,
  makeUnsubToken,
  sha256Email,
} from "@/lib/email-compliance"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function authorized(req: Request): boolean {
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  return Boolean(process.env.CRON_SECRET) && provided === process.env.CRON_SECRET
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

export async function POST(req: Request) {
  if (!authorized(req)) return new NextResponse("Forbidden", { status: 403 })
  const supabase = createAdminClient()

  // Active campaigns with their mailbox.
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select(
      "id,user_id,mailbox_id,daily_cap",
    )
    .eq("status", "active")
    .limit(100)

  let totalSent = 0
  for (const c of campaigns ?? []) {
    const { data: mailbox } = await supabase
      .from("mailboxes")
      .select(
        "id,email_address,oauth_refresh_token_encrypted,daily_send_limit,daily_sent,last_reset_at,warmup_started_at,physical_address,status",
      )
      .eq("id", c.mailbox_id as string)
      .eq("user_id", c.user_id as string)
      .maybeSingle()
    if (!mailbox || mailbox.status !== "active") continue

    const cap = Math.min(
      warmupCap(new Date(mailbox.warmup_started_at as string)),
      (mailbox.daily_send_limit as number) ?? 10,
      (c.daily_cap as number) ?? 30,
    )
    if (cap === 0) continue

    const { data: due, error: claimError } = await supabase.rpc(
      "claim_campaign_recipients",
      {
        p_user_id: c.user_id as string,
        p_campaign_id: c.id as string,
        p_daily_cap: cap,
      },
    )
    if (claimError) continue

    for (const r of due ?? []) {
      // Last-mile suppression check.
      const { data: sup } = await supabase
        .from("suppressions")
        .select("email_hash")
        .eq("user_id", c.user_id as string)
        .eq("email_hash", sha256Email(r.email as string))
        .maybeSingle()
      if (sup) {
        await supabase
          .from("campaign_recipients")
          .update({ status: "skipped" })
          .eq("id", r.id)
          .eq("user_id", c.user_id as string)
          .eq("status", "sending")
        continue
      }

      const unsubToken = makeUnsubToken(r.id as string, c.user_id as string)
      const body = appendComplianceFooter({
        body: r.body as string,
        unsubToken,
        physicalAddress: (mailbox.physical_address as string | null) ?? null,
        appUrl: APP_URL,
      })

      try {
        const sent = await sendGmail({
          refreshToken: decryptCredential(mailbox.oauth_refresh_token_encrypted as string),
          from: mailbox.email_address as string,
          to: r.email as string,
          subject: r.subject as string,
          body,
        })
        await supabase
          .from("campaign_recipients")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            message_id: sent.messageId,
            thread_id: sent.threadId,
          })
          .eq("id", r.id)
          .eq("user_id", c.user_id as string)
          .eq("status", "sending")
        await supabase.from("email_events").insert({
          recipient_id: r.id,
          user_id: c.user_id as string,
          event_type: "sent",
          payload: { mock: sent.mock },
        })
        totalSent++
      } catch (err) {
        const gmailError=classifyGmailError(err)
        if(gmailError==="auth")await supabase.from("mailboxes").update({status:"reconnect_required",last_error_code:gmailError,last_error_message:"Google authorization expired or was revoked"}).eq("id",mailbox.id).eq("user_id",c.user_id as string)
        await supabase
          .from("campaign_recipients")
          .update({
            status: "failed",
            bounce_reason: gmailError,
          })
          .eq("id", r.id)
          .eq("user_id", c.user_id as string)
          .eq("status", "sending")
        await supabase.from("email_events").insert({
          recipient_id: r.id,
          user_id: c.user_id as string,
          event_type: "failed",
        })
        if(gmailError==="auth")break
      }
    }

  }

  return NextResponse.json({ sent: totalSent })
}

// Vercel Cron always sends GET; POST is for manual/curl triggers.
export { POST as GET }
