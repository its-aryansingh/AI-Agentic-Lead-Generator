/**
 * POST /api/extension/replies/[id]/handle
 *
 * Bearer-authed dismiss action for the Chrome extension. Flips
 * reply_classifications.handled = true so the alerts feed stops
 * surfacing that row. Scoped to the bearer-user via `user_id =
 * user.id` on the update, since we use the admin client (RLS-bypass)
 * and must enforce ownership in the query itself.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/server"
import { getUserFromBearer } from "@/lib/api-auth"

export const runtime = "nodejs"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getUserFromBearer(req)
  if (!auth.user) {
    return NextResponse.json(
      { error: "unauthorized", reason: auth.reason },
      { status: 401, headers: corsHeaders },
    )
  }
  const { user } = auth

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json(
      { error: "invalid reply id" },
      { status: 400, headers: corsHeaders },
    )
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("reply_classifications")
    .update({ handled: true })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, handled")
    .maybeSingle()

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 400, headers: corsHeaders },
    )
  }
  if (!data) {
    return NextResponse.json(
      { error: "reply not found" },
      { status: 404, headers: corsHeaders },
    )
  }

  return NextResponse.json(
    { ok: true, id: data.id, handled: data.handled },
    { headers: corsHeaders },
  )
}
