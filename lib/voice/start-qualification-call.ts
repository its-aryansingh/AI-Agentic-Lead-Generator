import crypto from "node:crypto";
import { decryptCredential } from "@/lib/credential-crypto";
import { createBolnaCall } from "@/lib/providers/bolna";
import { createAdminClient } from "@/lib/supabase/server";
import { startVoiceCallWorkflow } from "@/lib/temporal/client";
import { normalizeE164, phoneHash, withinCallingHours } from "@/lib/voice-compliance";

export type VoiceCallStartCode = "consent_required" | "lead_not_found" | "e164_required" | "connect_bolna" | "transfer_number_invalid" | "outside_calling_hours" | "suppressed" | "legal_launch_not_approved" | "no_redial" | "override_reason_required" | "override_approval_required" | "execution_create_failed" | "temporal_start_failed" | "provider_start_failed";
export class VoiceCallStartError extends Error { constructor(readonly code: VoiceCallStartCode, message: string) { super(message); this.name = "VoiceCallStartError"; } }

export type VoiceCallStartResult = {
  executionId: string; orchestration: "temporal" | "direct" | null; status: "scheduled" | "started" | "already_called"; providerExecutionId?: string;
  alreadyCalled?: { executionId: string; status: string; providerStatus: string | null; attemptedAt: string };
};
/** Backwards-compatible input boundary used by UI, chat, dispatcher, and Temporal launch. */
export type StartQualificationCallInput = {
  userId: string; leadId: string; consentConfirmed: boolean; scheduledFor?: string; idempotencyKey?: string;
  allowOverride?: boolean; overrideReason?: string; approvalId?: string;
  source?: "ui" | "chat" | "api" | "dispatcher" | "temporal";
};
type Reservation = { disposition: "reserved" | "idempotent" | "already_called"; execution_id: string | null; prior_execution_id: string | null; attempt_number: number | null };

export async function startQualificationCall(input: StartQualificationCallInput): Promise<VoiceCallStartResult> {
  const overrideReason = input.overrideReason?.trim();
  if (!input.consentConfirmed) throw new VoiceCallStartError("consent_required", "Explicit lawful permission must be confirmed before a call.");
  if (input.allowOverride && (!overrideReason || overrideReason.length < 10)) throw new VoiceCallStartError("override_reason_required", "Call Again requires a meaningful override reason of at least 10 characters.");
  if (input.allowOverride && !input.approvalId) throw new VoiceCallStartError("override_approval_required", "Call Again requires an explicit, confirmed approval for this lead.");

  const supabase = createAdminClient();
  const { data: lead, error: leadError } = await supabase.from("prospects").select("id,input_name,input_company,input_title,phone,phone_hash,normalized_phone_e164,research_summary,voice_consent_status,lead_status").eq("id", input.leadId).eq("user_id", input.userId).maybeSingle();
  if (leadError) throw leadError;
  if (!lead) throw new VoiceCallStartError("lead_not_found", "Lead not found.");
  const phone = normalizeE164(String(lead.phone ?? ""));
  if (!phone) throw new VoiceCallStartError("e164_required", "The lead needs a valid E.164 phone number before calling.");
  const canonicalPhoneHash = await resolveCanonicalPhoneHash(supabase, input.userId, phone, lead.phone_hash ? String(lead.phone_hash) : null);

  const { data: connection, error: connectionError } = await supabase.from("voice_connections").select("id,encrypted_api_key,agent_id,from_phone_number,status,call_start_hour,call_end_hour,calling_timezone,temporal_enabled,default_language,max_call_seconds,max_turns,max_objection_attempts,human_transfer_phone").eq("user_id", input.userId).eq("provider", "bolna").eq("status", "active").maybeSingle();
  if (connectionError) throw connectionError;
  if (!connection) throw new VoiceCallStartError("connect_bolna", "Connect and verify Bolna before calling.");
  if (connection.human_transfer_phone && !normalizeE164(String(connection.human_transfer_phone))) throw new VoiceCallStartError("transfer_number_invalid", "The configured human-transfer number must be valid E.164 before calling.");

  const [{ data: suppressed, error: suppressionError }, { data: sellerContext }] = await Promise.all([
    supabase.from("phone_suppressions").select("id").eq("user_id", input.userId).eq("phone_hash", canonicalPhoneHash).in("channel", ["voice", "all"]).limit(1).maybeSingle(),
    supabase.from("customer_contexts").select("company_name").eq("user_id", input.userId).maybeSingle(),
  ]);
  if (suppressionError) throw suppressionError;
  if (suppressed || lead.lead_status === "do_not_contact") throw new VoiceCallStartError("suppressed", "This phone number is suppressed from voice calls.");
  if (!withinCallingHours(new Date(), String(connection.calling_timezone), Number(connection.call_start_hour), Number(connection.call_end_hour))) throw new VoiceCallStartError("outside_calling_hours", "The lead is outside the configured calling window.");
  if (process.env.VOICE_LEGAL_LAUNCH_APPROVED !== "true") throw new VoiceCallStartError("legal_launch_not_approved", "Voice calling is not enabled until the legal launch gate is approved.");

  if (input.source === "dispatcher") {
    if (!input.approvalId) throw new VoiceCallStartError("consent_required", "Dispatcher calls require a persisted outreach approval.");
    const { data: approval } = await supabase.from("outreach_action_approvals")
      .select("action_kind,channel,scope,confirmed_at,consent_attestation")
      .eq("id", input.approvalId).eq("user_id", input.userId).maybeSingle();
    const attestation = (approval?.consent_attestation ?? {}) as { confirmed?: boolean };
    if (!approval || approval.action_kind !== "autonomous_outreach" || !["voice", "multichannel"].includes(String(approval.channel)) || !approval.confirmed_at || !attestation.confirmed)
      throw new VoiceCallStartError("consent_required", "Dispatcher call approval is missing, unconfirmed, or not valid for voice.");
  }

  // An authenticated caller's consent is recorded; no override can change a DNC, phone, connection, transfer, or hours decision.
  if (lead.voice_consent_status !== "confirmed") {
    const { error } = await supabase.from("prospects").update({ voice_consent_status: "confirmed" }).eq("id", input.leadId).eq("user_id", input.userId);
    if (error) throw error;
  }
  const snapshot = { lead_name: lead.input_name, company: lead.input_company, title: lead.input_title, research_summary: lead.research_summary, seller_company: sellerContext?.company_name, disclosure: "This is an AI assistant calling on behalf of the seller. Ask whether now is a good time before continuing.", override: input.allowOverride ? { reason: overrideReason, approval_id: input.approvalId } : null };
  const requestIdempotencyKey = input.idempotencyKey?.trim() || crypto.randomUUID();
  let reservation: Reservation;
  try {
    const { data, error } = await supabase.rpc("reserve_voice_execution", { p_user_id: input.userId, p_connection_id: connection.id, p_prospect_id: input.leadId, p_recipient_phone: phone, p_recipient_phone_hash: canonicalPhoneHash, p_request_idempotency_key: requestIdempotencyKey, p_context_snapshot: snapshot, p_is_override: input.allowOverride === true, p_override_reason: input.allowOverride ? overrideReason : null, p_approval_id: input.allowOverride ? input.approvalId : null, p_source: input.source ?? "api", p_actor: "user" });
    if (error) {
      if (error.message.toLowerCase().includes("override approval") || error.message.toLowerCase().includes("override requires")) throw new VoiceCallStartError("override_approval_required", error.message);
      throw error;
    }
    reservation = (data?.[0] ?? null) as Reservation;
    if (!reservation?.disposition) throw new Error("Voice execution reservation returned no result.");
  } catch (error) {
    if (error instanceof VoiceCallStartError) throw error;
    throw new VoiceCallStartError("execution_create_failed", error instanceof Error ? error.message : "Could not reserve the call execution.");
  }
  if (reservation.disposition === "already_called") {
    const prior = await safeExecution(supabase, input.userId, reservation.prior_execution_id);
    if (!prior) throw new VoiceCallStartError("no_redial", "A qualification call already exists for this person.");
    return { executionId: prior.id, orchestration: null, status: "already_called", alreadyCalled: { executionId: prior.id, status: prior.status, providerStatus: prior.provider_status ? String(prior.provider_status) : null, attemptedAt: String(prior.created_at) } };
  }
  const executionId = String(reservation.execution_id);
  if (reservation.disposition === "idempotent") {
    const existing = await safeExecution(supabase, input.userId, executionId);
    if (!existing || (!existing.provider_execution_id && !existing.temporal_workflow_id && ["failed", "request_failed", "temporal_start_failed"].includes(String(existing.provider_status ?? existing.status))))
      throw new VoiceCallStartError("provider_start_failed", "The prior provider start failed; its idempotency key will not launch a second ambiguous call.");
    return { executionId, orchestration: existing?.temporal_workflow_id ? "temporal" : "direct", status: existing?.temporal_workflow_id ? "scheduled" : "started", providerExecutionId: existing?.provider_execution_id ? String(existing.provider_execution_id) : undefined };
  }
  if (connection.temporal_enabled) {
    try {
      const temporal = await startVoiceCallWorkflow({ workspaceId: input.userId, leadId: input.leadId, voiceExecutionId: executionId, scheduledFor: input.scheduledFor, allowOverride: input.allowOverride === true, overrideReason: input.allowOverride ? overrideReason : undefined, approvalId: input.allowOverride ? input.approvalId : undefined, idempotencyKey: requestIdempotencyKey });
      const { error } = await supabase.from("voice_executions").update({ temporal_workflow_id: temporal.workflowId, temporal_run_id: temporal.runId ?? null, provider_status: temporal.alreadyStarted ? "temporal_already_started" : "temporal_scheduled", reservation_state: "temporal_started", updated_at: new Date().toISOString() }).eq("id", executionId).eq("user_id", input.userId);
      if (error) throw error;
      return { executionId, orchestration: "temporal", status: "scheduled" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Temporal workflow start failed";
      await markStartFailure(supabase, input.userId, executionId, "temporal_start_failed", message);
      throw new VoiceCallStartError("temporal_start_failed", message);
    }
  }
  try {
    const result = await createBolnaCall({ apiKey: decryptCredential(String(connection.encrypted_api_key)), agentId: String(connection.agent_id), recipientPhone: phone, fromPhone: connection.from_phone_number ? String(connection.from_phone_number) : null, userData: callUserData(lead, sellerContext, connection, snapshot, executionId, requestIdempotencyKey) });
    const { error } = await supabase.from("voice_executions").update({ provider_execution_id: result.executionId, provider_status: result.status, raw_payload: result.raw, reservation_state: "provider_started", updated_at: new Date().toISOString() }).eq("id", executionId).eq("user_id", input.userId);
    if (error) throw error;
    return { executionId, orchestration: "direct", status: "started", providerExecutionId: result.executionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bolna call failed";
    await markStartFailure(supabase, input.userId, executionId, "request_failed", message);
    throw new VoiceCallStartError("provider_start_failed", message);
  }
}

async function resolveCanonicalPhoneHash(supabase: ReturnType<typeof createAdminClient>, userId: string, phone: string, leadHash: string | null) {
  if (leadHash) return leadHash;
  const { data } = await supabase.from("prospects").select("phone_hash").eq("user_id", userId).eq("normalized_phone_e164", phone).not("phone_hash", "is", null).limit(1).maybeSingle();
  return data?.phone_hash ? String(data.phone_hash) : phoneHash(phone);
}
async function safeExecution(supabase: ReturnType<typeof createAdminClient>, userId: string, executionId: string | null) {
  if (!executionId) return null;
  const { data } = await supabase.from("voice_executions").select("id,status,provider_status,provider_execution_id,temporal_workflow_id,created_at").eq("id", executionId).eq("user_id", userId).maybeSingle();
  return data;
}
function callUserData(lead: Record<string, unknown>, sellerContext: { company_name?: unknown } | null, connection: Record<string, unknown>, snapshot: Record<string, unknown>, executionId: string, idempotencyKey: string) {
  return { customer_name: String(lead.input_name ?? ""), company: String(lead.input_company ?? ""), title: String(lead.input_title ?? ""), seller_company: String(sellerContext?.company_name ?? "SalesEngAI customer"), qualification_context: String(lead.research_summary ?? "").slice(0, 500), default_language: String(connection.default_language ?? "en"), max_call_seconds: String(connection.max_call_seconds ?? 180), max_turns: String(connection.max_turns ?? 12), max_objection_attempts: String(connection.max_objection_attempts ?? 1), human_transfer_phone: String(connection.human_transfer_phone ?? ""), ai_disclosure: String(snapshot.disclosure ?? ""), salesengai_execution_id: executionId, idempotency_key: idempotencyKey };
}
async function markStartFailure(supabase: ReturnType<typeof createAdminClient>, userId: string, executionId: string, providerStatus: string, message: string) {
  await supabase.from("voice_executions").update({ status: "failed", provider_status: providerStatus, reservation_state: "failed", counts_toward_call_limit: false, error_message: message, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", executionId).eq("user_id", userId);
}
