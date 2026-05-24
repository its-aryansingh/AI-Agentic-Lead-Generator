/**
 * /api/webhooks/whatsapp — inbound + delivery webhook for the WhatsApp
 * OUTREACH channel (Phase 3b).
 *
 * BSP-agnostic. Accepts the Meta Cloud API shape (the format Gupshup,
 * Interakt and most BSPs forward through unchanged) plus a flat
 * fallback shape so a simple proxy/relay can post us a minimal payload.
 *
 * Auth: one of —
 *   - `x-hub-signature-256: sha256=<HMAC of raw body with WHATSAPP_WEBHOOK_SECRET>`
 *     (Meta Cloud API style)
 *   - `x-webhook-signature: <WHATSAPP_WEBHOOK_SECRET>`
 *     (static shared secret — used by most BSPs that don't HMAC)
 * If WHATSAPP_WEBHOOK_SECRET is unset we reject every POST: never accept
 * an unauthenticated callback in production.
 *
 * GET is the Meta Cloud API verification handshake:
 *   GET ?hub.mode=subscribe&hub.verify_token=<x>&hub.challenge=<y>
 * Returns `<y>` plaintext when `<x>` matches WHATSAPP_VERIFY_TOKEN.
 *
 * Behaviour:
 *   - STOP / UNSUBSCRIBE / OPTOUT (case-insensitive) → mark
 *     prospect.whatsapp_opted_out=true + suppress in-flight campaign
 *     recipients on that phone.
 *   - Other inbound text → mark the most-recent campaign_recipients row
 *     for the prospect's phone as 'replied' and insert a
 *     reply_classifications row (needs_human=true).
 *   - Delivery statuses: failed/undelivered → status='failed' +
 *     bounce_reason. Others (delivered/read/sent) are logged via
 *     webhook_events but don't downgrade an already-sent recipient.
 *   - Each inbound message id is recorded in webhook_events for
 *     idempotency — a redelivery from the BSP is a no-op.
 */

import crypto from "crypto"
import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { normalizeWhatsAppNumber } from "@/lib/providers/whatsapp"
import {
  isOptOutText,
  normalizeWhatsAppPayload,
} from "@/lib/whatsapp-webhook-core"

function verifySignature(body: string, headerList: Headers): boolean {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET
  if (!secret) return false
  // 1. Static shared secret header (most BSPs)
  const flat = headerList.get("x-webhook-signature")
  if (flat && flat === secret) return true
  // 2. HMAC-SHA256 (Meta Cloud API)
  const hub = headerList.get("x-hub-signature-256")
  if (hub) {
    const expected =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(body).digest("hex")
    try {
      const ok =
        hub.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(hub), Buffer.from(expected))
      if (ok) return true
    } catch {
      return false
    }
  }
  return false
}

export async function GET(req: Request) {
  // Meta Cloud API verification handshake.
  const url = new URL(req.url)
  const mode = url.searchParams.get("hub.mode")
  const token = url.searchParams.get("hub.verify_token")
  const challenge = url.searchParams.get("hub.challenge")
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN
  if (
    mode === "subscribe" &&
    verifyToken &&
    token === verifyToken &&
    challenge
  ) {
    return new Response(challenge, { status: 200 })
  }
  return new Response("forbidden", { status: 403 })
}

export async function POST(req: Request) {
  const body = await req.text()
  const headerList = await headers()

  if (!verifySignature(body, headerList as unknown as Headers)) {
    return new Response("Invalid signature", { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return new Response("Invalid JSON", { status: 400 })
  }

  const normalized = normalizeWhatsAppPayload(payload)
  const supabase = createAdminClient()
  let optedOut = 0
  let replies = 0
  let statusUpdates = 0

  for (const m of normalized.messages) {
    // Idempotency — replay of the same wamid is a no-op.
    const idempotencyKey = `whatsapp:msg:${m.id}`
    const { data: existing } = await supabase
      .from("webhook_events")
      .select("id")
      .eq("id", idempotencyKey)
      .maybeSingle()
    if (existing) continue
    await supabase
      .from("webhook_events")
      .insert({
        id: idempotencyKey,
        provider: "whatsapp",
        payload: m as unknown as Record<string, unknown>,
      })

    const fromDigits = normalizeWhatsAppNumber(m.from)
    if (!fromDigits) continue

    // Locate prospects with this phone. The phone column stores digits-only
    // (per provider normalisation), so an equality lookup works.
    const { data: matched } = await supabase
      .from("prospects")
      .select("id,job_id")
      .eq("phone", fromDigits)
    const prospectIds = (matched ?? []).map((p) => p.id as string)

    if (isOptOutText(m.text)) {
      if (prospectIds.length > 0) {
        await supabase
          .from("prospects")
          .update({ whatsapp_opted_out: true })
          .in("id", prospectIds)
        await supabase
          .from("campaign_recipients")
          .update({ status: "unsubscribed" })
          .in("prospect_id", prospectIds)
          .eq("channel", "whatsapp")
          .in("status", ["scheduled", "sent"])
      }
      optedOut++
      continue
    }

    // Genuine inbound → mark the most-recent whatsapp campaign_recipient
    // for any matching prospect as 'replied' and classify needs_human.
    if (prospectIds.length === 0) continue
    const { data: recipientRow } = await supabase
      .from("campaign_recipients")
      .select("id,user_id,status")
      .eq("channel", "whatsapp")
      .in("prospect_id", prospectIds)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!recipientRow) continue
    if (
      ["replied", "unsubscribed", "bounced"].includes(
        recipientRow.status as string,
      )
    ) {
      continue
    }
    await supabase
      .from("campaign_recipients")
      .update({ status: "replied", reply_at: new Date().toISOString() })
      .eq("id", recipientRow.id)
    await supabase.from("reply_classifications").insert({
      recipient_id: recipientRow.id,
      user_id: recipientRow.user_id,
      category: "other",
      confidence: 0.5,
      snippet: m.text.slice(0, 500),
      needs_human: true,
      handled: false,
    })
    replies++
  }

  for (const s of normalized.statuses) {
    const idempotencyKey = `whatsapp:status:${s.id}:${s.status}`
    const { data: existing } = await supabase
      .from("webhook_events")
      .select("id")
      .eq("id", idempotencyKey)
      .maybeSingle()
    if (existing) continue
    await supabase.from("webhook_events").insert({
      id: idempotencyKey,
      provider: "whatsapp",
      payload: s as unknown as Record<string, unknown>,
    })

    if (s.status === "failed" || s.status === "undelivered") {
      await supabase
        .from("campaign_recipients")
        .update({
          status: "failed",
          bounce_reason: (s.reason ?? s.status).slice(0, 280),
        })
        .eq("message_id", s.id)
        .eq("channel", "whatsapp")
      statusUpdates++
    }
  }

  return NextResponse.json({
    received: normalized.messages.length + normalized.statuses.length,
    opted_out: optedOut,
    replies,
    status_updates: statusUpdates,
  })
}
