import crypto from "node:crypto"
import { NextResponse } from "next/server"

import { nextScheduleOccurrence } from "@/lib/outreach/autonomous-dispatcher"
import { createAdminClient, createClient } from "@/lib/supabase/server"

export async function GET() {
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { data, error } = await db.from("outreach_schedules").select("*")
    .eq("user_id", user.id).order("created_at", { ascending: false })
  return NextResponse.json({ schedules: data ?? [], error: error?.message })
}

export async function POST(req: Request) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const db = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const validWeekdays = Array.isArray(body.weekdays) && body.weekdays.length > 0 &&
    body.weekdays.every((day: unknown) => Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 7)
  if (!body.consentConfirmed || typeof body.confirmationToken !== "string" ||
      typeof body.approvalId !== "string" || typeof body.name !== "string" ||
      typeof body.timezone !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.localTime)) ||
      !validWeekdays) {
    return NextResponse.json({ error: "Explicit consent and a confirmed preview are required." }, { status: 400 })
  }

  const tokenHash = crypto.createHash("sha256").update(body.confirmationToken).digest("hex")
  const { data: approval } = await db.from("outreach_action_approvals")
    .select("id,action_kind,channel,scope,consumed_at,confirmed_at,expires_at")
    .eq("id", body.approvalId).eq("user_id", user.id)
    .eq("confirmation_token_hash", tokenHash).maybeSingle()
  const expectedChannel = body.channel === "smart_both" ? "multichannel" : body.channel
  if (!approval || approval.consumed_at || approval.action_kind !== "autonomous_outreach" ||
      approval.channel !== expectedChannel ||
      Boolean(approval.expires_at && new Date(approval.expires_at).getTime() <= Date.now())) {
    return NextResponse.json({ error: "Preview confirmation is invalid, expired, or already used." }, { status: 409 })
  }
  const scope = approval.scope as { channel?: string; prospectIds?: string[]; filters?: unknown }
  if (scope.channel !== body.channel)
    return NextResponse.json({ error: "Schedule differs from its preview." }, { status: 409 })

  let next: Date
  try {
    next = nextScheduleOccurrence(new Date(), body.timezone, body.localTime, body.weekdays)
  } catch {
    return NextResponse.json({ error: "Invalid IANA timezone or local time." }, { status: 400 })
  }
  const { data: confirmed } = await db.from("outreach_action_approvals").update({
    confirmed_at: approval.confirmed_at ?? new Date().toISOString(),
    consent_attestation: { confirmed: true, source: "ui_schedule" },
  }).eq("id", approval.id).eq("user_id", user.id).is("consumed_at", null).select("id").maybeSingle()
  if (!confirmed)
    return NextResponse.json({ error: "Preview confirmation could not be recorded." }, { status: 409 })

  const { data, error } = await db.from("outreach_schedules").insert({
    user_id: user.id,
    name: body.name.slice(0, 200),
    timezone: body.timezone,
    local_time: body.localTime,
    weekdays: body.weekdays,
    channel_strategy: body.channel,
    lead_filter: scope.filters ?? {},
    sequence: { prospectIds: scope.prospectIds ?? null },
    approval_id: body.approvalId,
    idempotency_seed: crypto.randomUUID(),
    next_run_at: next.toISOString(),
  }).select("*").single()
  return NextResponse.json({ schedule: data, error: error?.message }, { status: error ? 400 : 201 })
}

export async function PATCH(req: Request) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const db = createAdminClient()
  const body = await req.json().catch(() => ({}))
  if (typeof body.id !== "string")
    return NextResponse.json({ error: "Schedule id required" }, { status: 400 })
  const protectedFields = ["lead_filter", "local_time", "timezone", "weekdays", "channel_strategy", "sequence", "approval_id"]
  if (protectedFields.some((key) => body[key] !== undefined))
    return NextResponse.json({ error: "Changing an approved schedule's audience, channel, or time requires a new preview and approval." }, { status: 409 })
  const changes: Record<string, unknown> = {}
  if (typeof body.name === "string") changes.name = body.name.slice(0, 200)
  if (body.status !== undefined) {
    if (!["active", "paused", "disabled"].includes(body.status))
      return NextResponse.json({ error: "Invalid schedule status." }, { status: 400 })
    changes.status = body.status
  }
  if (Object.keys(changes).length === 0)
    return NextResponse.json({ error: "No supported changes supplied." }, { status: 400 })
  changes.updated_at = new Date().toISOString()
  const { data, error } = await db.from("outreach_schedules").update(changes)
    .eq("id", body.id).eq("user_id", user.id).select("*").single()
  return NextResponse.json({ schedule: data, error: error?.message }, { status: error ? 400 : 200 })
}

export async function DELETE(req: Request) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "Schedule id required" }, { status: 400 })
  const { error } = await createAdminClient().from("outreach_schedules").delete()
    .eq("id", id).eq("user_id", user.id)
  return NextResponse.json({ ok: !error, error: error?.message }, { status: error ? 400 : 200 })
}
