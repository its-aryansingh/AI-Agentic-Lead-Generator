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
import { sendGmail, warmupCap } from "@/lib/providers/gmail"
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
      "id,user_id,mailbox_id,daily_cap,send_window_start_hour,send_window_end_hour",
    )
    .eq("status", "active")
    .limit(100)

  let totalSent = 0
  const nowHour = new Date().getUTCHours() // simplification; campaign tz refinement in v1.2

  for (const c of campaigns ?? []) {
    // Send window check (coarse — UTC hour). v1.2 will honor campaign timezone.
    const startH = (c.send_window_start_hour as number) ?? 9
    const endH = (c.send_window_end_hour as number) ?? 17
    if (nowHour < startH || nowHour >= endH) continue

    const { data: mailbox } = await supabase
      .from("mailboxes")
      .select(
        "id,email_address,oauth_refresh_token,daily_send_limit,daily_sent,last_reset_at,warmup_started_at,physical_address,status",
      )
      .eq("id", c.mailbox_id as string)
      .maybeSingle()
    if (!mailbox || mailbox.status !== "active") continue

    // Reset daily_sent at the start of a new UTC day.
    let dailySent = (mailbox.daily_sent as number) ?? 0
    const lastReset = new Date(mailbox.last_reset_at as string)
    if (lastReset.toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
      dailySent = 0
      await supabase
        .from("mailboxes")
        .update({ daily_sent: 0, last_reset_at: new Date().toISOString() })
        .eq("id", mailbox.id)
    }

    const cap = Math.min(
      warmupCap(new Date(mailbox.warmup_started_at as string)),
      (mailbox.daily_send_limit as number) ?? 10,
      (c.daily_cap as number) ?? 30,
    )
    const remaining = Math.max(0, cap - dailySent)
    if (remaining === 0) continue

    const { data: due } = await supabase
      .from("campaign_recipients")
      .select("id,email,subject,body")
      .eq("campaign_id", c.id as string)
      .eq("status", "scheduled")
      .lte("scheduled_for", new Date().toISOString())
      .limit(remaining)

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
          refreshToken: mailbox.oauth_refresh_token as string,
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
        await supabase.from("email_events").insert({
          recipient_id: r.id,
          event_type: "sent",
          payload: { mock: sent.mock },
        })
        dailySent++
        totalSent++
      } catch (err) {
        await supabase
          .from("campaign_recipients")
          .update({
            status: "failed",
            bounce_reason: err instanceof Error ? err.message : "send_failed",
          })
          .eq("id", r.id)
        await supabase.from("email_events").insert({
          recipient_id: r.id,
          event_type: "failed",
        })
      }
    }

    // Persist the incremented counter.
    await supabase
      .from("mailboxes")
      .update({ daily_sent: dailySent })
      .eq("id", mailbox.id)
  }

  return NextResponse.json({ sent: totalSent })
}
