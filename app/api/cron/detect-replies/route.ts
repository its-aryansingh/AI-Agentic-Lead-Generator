/**
 * POST /api/cron/detect-replies
 *
 * Polls each active mailbox's inbox for replies to messages we sent,
 * matching on thread_id. For each match:
 *   - bounce  → mark recipient bounced + suppress the address
 *   - auto-reply (OOO) → log only, keep cascade alive
 *   - real reply → mark replied, stop the cascade for that contact,
 *     classify via Claude, route high-signal replies to the inbox.
 *
 * Cron-secret gated. Polling is the v1.1 approach; Gmail Pub/Sub push
 * (real-time) is a v1.2 upgrade.
 */

import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/server"
import { listRecentInbound } from "@/lib/providers/gmail"
import { sha256Email } from "@/lib/email-compliance"
import { classifyReply, needsHuman } from "@/lib/reply-classify"
import { notifyPush, notifySlack } from "@/lib/notifications"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function authorized(req: Request): boolean {
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  return Boolean(process.env.CRON_SECRET) && provided === process.env.CRON_SECRET
}

export async function POST(req: Request) {
  if (!authorized(req)) return new NextResponse("Forbidden", { status: 403 })
  const supabase = createAdminClient()

  const { data: mailboxes } = await supabase
    .from("mailboxes")
    .select("id,user_id,oauth_refresh_token,status")
    .eq("status", "active")
    .limit(100)

  let processed = 0

  for (const mb of mailboxes ?? []) {
    let inbound
    try {
      inbound = await listRecentInbound({
        refreshToken: mb.oauth_refresh_token as string,
        maxResults: 25,
      })
    } catch {
      continue
    }

    for (const msg of inbound) {
      if (!msg.threadId) continue

      // Match the thread to one of our sent recipients.
      const { data: recipient } = await supabase
        .from("campaign_recipients")
        .select("id,campaign_id,prospect_id,email,status")
        .eq("thread_id", msg.threadId)
        .maybeSingle()
      if (!recipient) continue
      // Already terminal — don't reprocess.
      if (["replied", "bounced", "unsubscribed"].includes(recipient.status as string)) {
        continue
      }

      if (msg.isBounce) {
        await supabase
          .from("campaign_recipients")
          .update({ status: "bounced", bounce_reason: msg.snippet.slice(0, 280) })
          .eq("id", recipient.id)
        
        if (recipient.prospect_id) {
          await supabase
            .from("sequence_enrollments")
            .update({ status: "bounced" })
            .eq("prospect_id", recipient.prospect_id)
            .eq("status", "active")
        }
        await supabase.from("suppressions").upsert(
          {
            user_id: mb.user_id as string,
            email_hash: sha256Email(recipient.email as string),
            reason: "bounced",
          },
          { onConflict: "user_id,email_hash" },
        )
        await supabase.from("email_events").insert({
          recipient_id: recipient.id,
          user_id: mb.user_id as string,
          event_type: "bounced",
        })
        processed++
        continue
      }

      if (msg.isAutoReply) {
        // Don't stop the cascade for an OOO — just log it.
        await supabase.from("email_events").insert({
          recipient_id: recipient.id,
          user_id: mb.user_id as string,
          event_type: "auto_reply",
          payload: { snippet: msg.snippet },
        })
        continue
      }

      // Genuine reply → stop cascade, classify, route.
      await supabase
        .from("campaign_recipients")
        .update({ status: "replied", reply_at: new Date().toISOString() })
        .eq("id", recipient.id)

      if (recipient.prospect_id) {
        await supabase
          .from("sequence_enrollments")
          .update({ status: "completed" })
          .eq("prospect_id", recipient.prospect_id)
          .eq("status", "active")
      }
      await supabase.from("email_events").insert({
        recipient_id: recipient.id,
        user_id: mb.user_id as string,
        event_type: "replied",
        payload: { snippet: msg.snippet },
      })

      const classification = await classifyReply({ body: msg.snippet })

      // Auto-suppress explicit unsubscribes detected in a reply.
      if (classification.category === "unsubscribe") {
        await supabase.from("suppressions").upsert(
          {
            user_id: mb.user_id as string,
            email_hash: sha256Email(recipient.email as string),
            reason: "unsubscribed",
          },
          { onConflict: "user_id,email_hash" },
        )
      }

      const isHotReply = needsHuman(classification.category)
      await supabase.from("reply_classifications").insert({
        recipient_id: recipient.id,
        user_id: mb.user_id as string,
        category: classification.category,
        confidence: classification.confidence,
        snippet: msg.snippet.slice(0, 500),
        needs_human: isHotReply,
        handled: false,
      })

      // Fire push + Slack to the user's registered surfaces for hot
      // replies (interested / question / objection). Silent no-op for
      // users with no devices / no Slack; never throws into the cron.
      if (isHotReply) {
        await notifyPush(mb.user_id as string, {
          title: `New ${classification.category} reply`,
          body: msg.snippet.slice(0, 240),
          data: {
            kind: "hot_reply",
            recipient_id: recipient.id,
            category: classification.category,
          },
          priority: "high",
        })
        await notifySlack(mb.user_id as string, {
          emoji: "💬",
          text: `New *${classification.category}* reply from ${recipient.email}: "${msg.snippet.slice(0, 200)}"`,
          link: { url: "/app/inbox", label: "Open inbox" },
        })
      }
      processed++
    }
  }

  return NextResponse.json({ processed })
}

export { POST as GET }
