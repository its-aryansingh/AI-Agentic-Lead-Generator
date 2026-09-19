"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { inngest } from "@/inngest/client";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { startQualificationCall } from "@/lib/voice/start-qualification-call";
import { applyProspectTransition } from "@/lib/outreach/prospect-state-machine";

async function ownedHandoff(id: string) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  const db = createAdminClient();
  const { data } = await db.from("lead_handoffs").select("id,prospect_id,status").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!data) throw new Error("Handoff not found or unauthorized.");
  return { db, userId: user.id, handoff: data };
}

export async function updateHandoffStatus(id: string, status: "acknowledged" | "resolved" | "dismissed") {
  const { db, userId, handoff } = await ownedHandoff(id);
  const now = new Date().toISOString();
  const { error } = await db.from("lead_handoffs").update({ status, resolution_metadata: { action: status, actor: userId }, ...(status === "resolved" || status === "dismissed" ? { resolved_at: now } : {}), updated_at: now }).eq("id", handoff.id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  await db.from("lead_state_events").insert({ user_id: userId, prospect_id: handoff.prospect_id, event_type: `handoff_${status}`, actor: "user", source: "inbox", metadata: { handoff_id: handoff.id } });
  revalidatePath("/app/inbox");
}

export async function updateLeadFromHandoff(id: string, outcome: "converted" | "disqualified") {
  const { db, userId, handoff } = await ownedHandoff(id);
  const now = new Date().toISOString();
  await applyProspectTransition(db, { userId, prospectId: String(handoff.prospect_id), event: outcome, actor: "user", source: "inbox", metadata: { handoff_id: handoff.id }, nextAction: "none" });
  await db.from("lead_handoffs").update({ status: "resolved", resolved_at: now, updated_at: now, resolution_metadata: { action: outcome, actor: userId } }).eq("prospect_id", handoff.prospect_id).eq("user_id", userId).in("status", ["open", "acknowledged"]);
  revalidatePath("/app/inbox");
}

export async function callNowFromHandoff(id: string, consentConfirmed: boolean) {
  if (!consentConfirmed) throw new Error("Confirm lawful permission before placing a call.");
  const { userId, handoff } = await ownedHandoff(id);
  // Uses the Phase 4 service and therefore retains person-level guard and all compliance gates.
  const result = await startQualificationCall({ userId, leadId: String(handoff.prospect_id), consentConfirmed, idempotencyKey: `handoff:${id}:call-now`, source: "ui" });
  revalidatePath("/app/inbox");
  return result;
}

export async function queueCustomEmailFromHandoff(id: string, subject: string, body: string) {
  const cleanSubject = subject.trim(); const cleanBody = body.trim();
  if (!cleanSubject || !cleanBody) throw new Error("A subject and message are required.");
  if (cleanSubject.length > 200 || cleanBody.length > 10_000) throw new Error("Email content exceeds the allowed length.");
  const { db, userId, handoff } = await ownedHandoff(id);
  const [{ data: lead }, { data: mailbox }] = await Promise.all([
    db.from("prospects").select("email").eq("id", handoff.prospect_id).eq("user_id", userId).maybeSingle(),
    db.from("mailboxes").select("id").eq("user_id", userId).eq("status", "active").maybeSingle(),
  ]);
  if (!lead?.email || !mailbox) throw new Error("An owned lead email and active mailbox are required.");
  const { data: campaign, error: campaignError } = await db.from("campaigns").insert({ user_id: userId, mailbox_id: mailbox.id, name: `Handoff email ${handoff.id}`, status: "active" }).select("id").single();
  if (campaignError || !campaign) throw new Error(campaignError?.message ?? "Could not queue email.");
  const { error } = await db.from("campaign_recipients").insert({ user_id: userId, campaign_id: campaign.id, prospect_id: handoff.prospect_id, email: lead.email, subject: cleanSubject, body: cleanBody, status: "scheduled", scheduled_for: new Date().toISOString() });
  if (error) throw new Error(error.message);
  await db.from("lead_state_events").insert({ user_id: userId, prospect_id: handoff.prospect_id, event_type: "email_queued", actor: "user", source: "inbox", metadata: { handoff_id: handoff.id, campaign_id: campaign.id } });
  revalidatePath("/app/inbox");
}

export async function scheduleEmailFollowupFromHandoff(id: string, scheduledAt: string, timezone: string, note: string) {
  const when = new Date(scheduledAt);
  if (!Number.isFinite(when.getTime()) || when <= new Date()) throw new Error("Choose a future follow-up time.");
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); } catch { throw new Error("Use a valid IANA timezone."); }
  const { userId, handoff } = await ownedHandoff(id);
  const db = createAdminClient();
  const key = `inbox:${handoff.id}:email:${when.toISOString()}`;
  const token = crypto.randomBytes(32).toString("base64url");
  const scope = { input: { lead_id: handoff.prospect_id, channel: "email", scheduled_at: when.toISOString(), timezone, note: note.trim().slice(0, 2000) || null, idempotency_key: key } };
  const { data: approval, error: approvalError } = await db.from("outreach_action_approvals").insert({ user_id: userId, action_kind: "lead_followup", channel: "email", scope, preview_summary: { source: "inbox", handoff_id: handoff.id }, payload_hash: crypto.createHash("sha256").update(JSON.stringify(scope)).digest("hex"), confirmation_token_hash: crypto.createHash("sha256").update(token).digest("hex"), source: "ui", actor: "user", consent_attestation: { confirmed: true, source: "inbox_followup" }, confirmed_at: new Date().toISOString(), expires_at: new Date(when.getTime() + 24 * 60 * 60_000).toISOString(), audit_metadata: { handoff_id: handoff.id } }).select("id").single();
  if (approvalError || !approval) throw new Error(approvalError?.message ?? "Could not approve the follow-up.");
  const { data: followup, error } = await db.from("lead_followups").upsert({ user_id: userId, prospect_id: handoff.prospect_id, channel: "email", scheduled_at: when.toISOString(), timezone, note: note.trim().slice(0, 2000) || null, status: "scheduled", created_by: "user", idempotency_key: key, approval_id: approval.id }, { onConflict: "user_id,idempotency_key" }).select("id").single();
  if (error) throw new Error(error.message);
  await db.from("lead_state_events").insert({ user_id: userId, prospect_id: handoff.prospect_id, event_type: "followup_scheduled", actor: "user", source: "inbox", metadata: { handoff_id: handoff.id, channel: "email", scheduled_at: when.toISOString() } });
  await inngest.send({ name: "lead/followup.scheduled", data: { followupId: String(followup?.id), userId, scheduledAt: when.toISOString() } });
  revalidatePath("/app/inbox");
}
