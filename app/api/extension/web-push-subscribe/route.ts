/**
 * POST /api/extension/web-push-subscribe
 *
 * Bearer-authed registration of a Web Push subscription returned from
 * the browser's `pushManager.subscribe()`. Stored as
 * `JSON.stringify(subscription)` in push_tokens.token with
 * provider='web' — the unique (user_id, token) constraint dedupes
 * re-registrations of the same endpoint.
 *
 * Companion to /api/extension/push-register (which handles Expo
 * tokens for the mobile app).
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/server"
import { getUserFromBearer } from "@/lib/api-auth"
import { isValidWebPushSubscription } from "@/lib/providers/web-push-core"

export const runtime = "nodejs"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

const Body = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(2048),
    keys: z.object({
      p256dh: z.string().min(1).max(256),
      auth: z.string().min(1).max(64),
    }),
    expirationTime: z.number().nullable().optional(),
  }),
  platform: z.enum(["ios", "android", "web"]).optional(),
  device_id: z.string().max(256).optional(),
})

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders })
}

export async function POST(req: Request) {
  const auth = await getUserFromBearer(req)
  if (!auth.user) {
    return NextResponse.json(
      { error: "unauthorized", reason: auth.reason },
      { status: 401, headers: corsHeaders },
    )
  }
  const { user } = auth

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: "invalid JSON" },
      { status: 400, headers: corsHeaders },
    )
  }

  const parsed = Body.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400, headers: corsHeaders },
    )
  }

  const { subscription, platform, device_id } = parsed.data
  if (!isValidWebPushSubscription(subscription)) {
    return NextResponse.json(
      { error: "invalid subscription shape" },
      { status: 400, headers: corsHeaders },
    )
  }

  const token = JSON.stringify({
    endpoint: subscription.endpoint,
    keys: subscription.keys,
  })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("push_tokens")
    .upsert(
      {
        user_id: user.id,
        token,
        provider: "web",
        platform: platform ?? "web",
        device_id: device_id ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "user_id,token" },
    )
    .select("id, created_at, last_seen_at")
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "upsert failed" },
      { status: 500, headers: corsHeaders },
    )
  }

  const created = sameTimestamp(data.created_at as string, data.last_seen_at as string)
  return NextResponse.json(
    { ok: true, id: data.id, created },
    { headers: corsHeaders },
  )
}

function sameTimestamp(a: string, b: string): boolean {
  const da = Date.parse(a)
  const db = Date.parse(b)
  if (Number.isNaN(da) || Number.isNaN(db)) return false
  return Math.abs(db - da) < 1000
}
