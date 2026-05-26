/**
 * POST /api/extension/push-register
 *
 * Bearer-authed registration of a device push token. Called once on
 * mobile-app first-launch (after permission grant) and again whenever
 * the device's token rotates (Expo refresh, OS reinstall).
 *
 * Body:
 *   { token: string, provider: 'expo'|'web', platform?: 'ios'|'android'|'web', device_id?: string }
 *
 * Behaviour:
 *   - Upserts on (user_id, token) — same device re-registering bumps
 *     last_seen_at instead of creating a duplicate row.
 *   - Validates token shape per provider (rejects malformed before DB).
 *   - Returns the row id + whether it was a fresh insert.
 *
 * The actual push-firing (insert into push_tokens consumers like
 * reply_classifications + automation_runs paths) lands when the
 * mobile client lands. This endpoint is the prerequisite.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/server"
import { getUserFromBearer } from "@/lib/api-auth"
import { isValidPushToken, type PushProvider } from "@/lib/providers/expo-push-core"

export const runtime = "nodejs"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

const Body = z.object({
  token: z.string().min(1).max(2048),
  provider: z.enum(["expo", "web"]),
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

  const { token, provider, platform, device_id } = parsed.data
  if (!isValidPushToken(token, provider as PushProvider)) {
    return NextResponse.json(
      { error: "invalid push token format for provider" },
      { status: 400, headers: corsHeaders },
    )
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("push_tokens")
    .upsert(
      {
        user_id: user.id,
        token,
        provider,
        platform: platform ?? null,
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
    {
      ok: true,
      id: data.id,
      created,
    },
    { headers: corsHeaders },
  )
}

function sameTimestamp(a: string, b: string): boolean {
  // The upsert sets last_seen_at to now() on every call but only sets
  // created_at on the initial insert. If they match within ~1s, this
  // call was the first registration.
  const da = Date.parse(a)
  const db = Date.parse(b)
  if (Number.isNaN(da) || Number.isNaN(db)) return false
  return Math.abs(db - da) < 1000
}
