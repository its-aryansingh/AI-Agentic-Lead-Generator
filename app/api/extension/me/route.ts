/**
 * GET /api/extension/me
 *
 * Bearer-authed identity probe for the Chrome extension (and any
 * non-browser caller). Returns the signed-in user + their credit balance
 * so the extension UI can render plan state without hitting Supabase
 * directly with anon RLS (which would require duplicating auth there).
 *
 * Cookies are not attempted — extensions can't reliably carry them
 * across origins. The browser app uses /app/* server components instead.
 */

import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getUserFromBearer } from "@/lib/api-auth"

export const runtime = "nodejs"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders })
}

export async function GET(req: Request) {
  const auth = await getUserFromBearer(req)
  if (!auth.user) {
    return NextResponse.json(
      { error: "unauthorized", reason: auth.reason },
      { status: 401, headers: corsHeaders },
    )
  }
  const { user } = auth

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from("users")
    .select("plan, credits_remaining, notify_whatsapp, whatsapp_number")
    .eq("id", user.id)
    .maybeSingle()

  return NextResponse.json(
    {
      user: { id: user.id, email: user.email },
      plan: profile?.plan ?? "free",
      credits_remaining: profile?.credits_remaining ?? 0,
      notifications: {
        whatsapp_enabled: Boolean(profile?.notify_whatsapp),
        whatsapp_number: (profile?.whatsapp_number as string | null) ?? null,
      },
    },
    { headers: corsHeaders },
  )
}
