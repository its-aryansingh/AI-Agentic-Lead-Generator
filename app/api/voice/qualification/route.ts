import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { startQualificationCall, VoiceCallStartError } from "@/lib/voice/start-qualification-call";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const leadId = typeof body.leadId === "string" ? body.leadId : "";
  const reason = typeof body.overrideReason === "string" ? body.overrideReason.trim() : "";
  if (!leadId || reason.length < 10) return NextResponse.json({ error: "A meaningful override reason of at least 10 characters is required." }, { status: 400 });

  const db = createAdminClient();
  if (body.mode === "preview") {
    const token = crypto.randomBytes(32).toString("base64url");
    const { data: approval, error } = await db.from("outreach_action_approvals").insert({
      user_id: user.id, action_kind: "voice_call_override", channel: "voice",
      scope: { prospectIds: [leadId], allowOverride: true },
      preview_summary: { leadId, safeguards: ["consent", "DNC/suppression", "valid E.164", "active Bolna connection", "valid transfer number", "calling hours"] },
      payload_hash: crypto.createHash("sha256").update(JSON.stringify({ leadId, reason })).digest("hex"),
      confirmation_token_hash: crypto.createHash("sha256").update(token).digest("hex"),
      source: "ui", actor: "user", override_reason: reason,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    }).select("id").single();
    if (error || !approval) return NextResponse.json({ error: error?.message ?? "Could not create override approval." }, { status: 500 });
    return NextResponse.json({ approvalId: approval.id, confirmationToken: token, restrictions: "Call Again never bypasses consent, DNC/suppression, E.164 validation, connection or transfer-number validation, or calling hours." });
  }

  const approvalId = typeof body.approvalId === "string" ? body.approvalId : "";
  const confirmationToken = typeof body.confirmationToken === "string" ? body.confirmationToken : "";
  if (body.mode !== "apply" || !approvalId || !confirmationToken) return NextResponse.json({ error: "A current override preview and confirmation are required." }, { status: 400 });
  const tokenHash = crypto.createHash("sha256").update(confirmationToken).digest("hex");
  const { data: approval } = await db.from("outreach_action_approvals").select("id,override_reason,expires_at,consumed_at").eq("id", approvalId).eq("user_id", user.id).eq("confirmation_token_hash", tokenHash).maybeSingle();
  if (!approval || approval.consumed_at || (approval.expires_at && new Date(String(approval.expires_at)) <= new Date()) || String(approval.override_reason ?? "").trim() !== reason) return NextResponse.json({ error: "Override approval is invalid, expired, already used, or does not match the reason." }, { status: 409 });
  const { error: confirmationError } = await db.from("outreach_action_approvals").update({ confirmed_at: new Date().toISOString() }).eq("id", approvalId).eq("user_id", user.id).is("consumed_at", null);
  if (confirmationError) return NextResponse.json({ error: "Could not confirm override approval." }, { status: 409 });
  try {
    const result = await startQualificationCall({ userId: user.id, leadId, consentConfirmed: true, allowOverride: true, overrideReason: reason, approvalId, idempotencyKey: `ui-override:${approvalId}`, source: "ui" });
    return NextResponse.json(result, { status: result.status === "already_called" ? 409 : 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Call Again failed.";
    return NextResponse.json({ error: error instanceof VoiceCallStartError ? error.code : "voice_call_start_failed", message }, { status: 409 });
  }
}
