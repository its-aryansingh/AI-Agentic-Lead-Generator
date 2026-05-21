/**
 * PATCH /api/prospects/[id]
 * Body: { stage: "contacted" | "replied" | "interested" | "converted" | "unsubscribed" }
 *
 * Updates a single prospect's pipeline stage. The RLS "own prospects update"
 * policy (0002_prospect_stage.sql) scopes the write to prospects whose job
 * belongs to the caller, so no manual user filter is required here.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

const STAGES = ["contacted", "replied", "interested", "converted", "unsubscribed"] as const

const PatchBody = z.object({
  stage: z.enum(STAGES),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) {
    return new NextResponse("Invalid prospect id", { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse("Unauthorized", { status: 401 })

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 })
  }

  const parsed = PatchBody.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("prospects")
    .update({ stage: parsed.data.stage })
    .eq("id", id)
    .select("id,stage")
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data) return new NextResponse("Not found", { status: 404 })

  return NextResponse.json({ id: data.id, stage: data.stage })
}