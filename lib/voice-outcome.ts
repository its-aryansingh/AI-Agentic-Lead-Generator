import type { CompatClient } from "@/lib/supabase/server";

import { createLeadHandoff, deliverLeadHandoffNotifications } from "@/lib/unified-lead-handoff";
import { phoneHash } from "@/lib/voice-compliance";
import { isFinishedVoiceOutcome } from "@/lib/voice/outcome-state";
import { normalizeBolnaEvent } from "@/lib/voice/providers/bolna";
import { extractBolnaTransferReceipt } from "@/lib/voice/transfer-policy";
import type { NormalizedCallEvent } from "@/lib/voice/types";
import {
  extractQualificationFacts,
  qualificationBucket,
  workflowForQualification,
} from "@/lib/qualification";
import { classifyReply, classifyReplyHeuristically } from "@/lib/reply-classify";

export function bolnaExecutionId(payload: Record<string, unknown>) {
  return normalizeBolnaEvent(payload).callId;
}

export function bolnaStatus(payload: Record<string, unknown>) {
  return String(payload.status ?? "unknown").toLowerCase();
}

export function bolnaRecording(payload: Record<string, unknown>) {
  const event = normalizeBolnaEvent(payload);
  return event.kind === "completed" ? (event.recordingRef ?? null) : null;
}

/** Bolna documents total_cost as a float in cents. Keep its decimal text; never
 * round it to integer cents before PostgreSQL numeric stores it. */
export function bolnaCostMinorUnits(payload: Record<string, unknown>) {
  const value = payload.total_cost;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value).trim();
  return /^\d+(?:\.\d+)?$/.test(text) ? text : null;
}

const BOLNA_COST_COMPONENTS = [
  "platform",
  "network",
  "transcriber",
  "llm",
  "synthesizer",
] as const;

// Preserve the provider's decimal text while retaining only documented cost
// fields. This keeps diagnostic metadata useful without turning it into an
// unbounded copy of a webhook payload.
export function bolnaCostBreakdown(payload: Record<string, unknown>) {
  const source =
    payload.cost_breakdown && typeof payload.cost_breakdown === "object"
      ? (payload.cost_breakdown as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    BOLNA_COST_COMPONENTS.flatMap((name) => {
      const value = source[name];
      if (typeof value !== "number" && typeof value !== "string") return [];
      const text = String(value).trim();
      return /^\d+(?:\.\d+)?$/.test(text) ? [[name, text]] : [];
    }),
  );
}

const BOLNA_STATUS_ORDER: Record<string, number> = {
  scheduled: 10,
  queued: 20,
  rescheduled: 20,
  initiated: 30,
  ringing: 40,
  "in-progress": 50,
  "call-disconnected": 60,
  completed: 100,
  "no-answer": 100,
  busy: 100,
  canceled: 100,
  failed: 100,
  stopped: 100,
  error: 100,
  "balance-low": 100,
};

export function isOlderBolnaProviderStatus(
  currentStatus: string | null | undefined,
  incomingStatus: string,
) {
  const current = BOLNA_STATUS_ORDER[String(currentStatus ?? "").toLowerCase()] ?? 0;
  const incoming = BOLNA_STATUS_ORDER[incomingStatus.toLowerCase()] ?? 0;
  return current > 0 && incoming > 0 && current > incoming;
}

function providerEventAt(payload: Record<string, unknown>) {
  const candidate = payload.updated_at ?? payload.created_at;
  if (typeof candidate !== "string" || Number.isNaN(Date.parse(candidate))) return null;
  return candidate;
}

// Raw webhooks can contain user_data, phones, recordings and transcripts. The
// sensitive artifacts have dedicated owned fields, so the diagnostic blob is a
// deliberately small allowlist and is never returned by public API routes.
function safeProviderMetadata(payload: Record<string, unknown>) {
  const telephony =
    payload.telephony_data && typeof payload.telephony_data === "object"
      ? (payload.telephony_data as Record<string, unknown>)
      : {};
  return {
    id: payload.id ?? payload.execution_id ?? null,
    agent_id: payload.agent_id ?? null,
    batch_id: payload.batch_id ?? null,
    status: payload.status ?? null,
    created_at: payload.created_at ?? null,
    updated_at: payload.updated_at ?? null,
    error_message: payload.error_message ?? null,
    answered_by_voice_mail: payload.answered_by_voice_mail ?? null,
    telephony: {
      duration: telephony.duration ?? null,
      provider: telephony.provider ?? null,
      call_type: telephony.call_type ?? null,
      ring_duration: telephony.ring_duration ?? null,
      post_dial_delay: telephony.post_dial_delay ?? null,
      hangup_by: telephony.hangup_by ?? null,
      hangup_reason: telephony.hangup_reason ?? null,
      hangup_provider_code: telephony.hangup_provider_code ?? null,
    },
  };
}

function recordingMetadata(payload: Record<string, unknown>, recordingUrl: string | null) {
  const telephony =
    payload.telephony_data && typeof payload.telephony_data === "object"
      ? (payload.telephony_data as Record<string, unknown>)
      : {};
  return recordingUrl
    ? {
        available: true,
        provider: telephony.provider ?? null,
        provider_call_id: telephony.provider_call_id ?? null,
      }
    : { available: false };
}

function recipientTranscript(event: NormalizedCallEvent, rawTranscript: string) {
  if (event.kind !== "completed") return rawTranscript;
  const recipientText = event.transcript
    .filter((segment) => segment.speaker === "recipient")
    .map((segment) => segment.text)
    .join("\n")
    .trim();
  return recipientText || rawTranscript;
}

async function setLeadNextAction(
  supabase: CompatClient,
  prospectId: unknown,
  userId: unknown,
  nextAction: "review_call_outcome" | "human_review",
) {
  if (!prospectId) return;
  const { error } = await supabase
    .from("prospects")
    .update({ next_action: nextAction, next_action_at: null })
    .eq("id", prospectId)
    .eq("user_id", userId);
  if (error) throw error;
}

async function persistTransferReceipt(
  supabase: CompatClient,
  executionId: string,
  userId: string,
  payload: Record<string, unknown>,
) {
  const receipt = extractBolnaTransferReceipt(payload);
  if (!receipt) return null;
  const { data: action } = await supabase
    .from("voice_action_requests")
    .select("id,result")
    .eq("execution_id", executionId)
    .eq("user_id", userId)
    .eq("action_kind", "TRANSFER_HUMAN")
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const priorResult =
    action?.result && typeof action.result === "object"
      ? (action.result as Record<string, unknown>)
      : {};
  if (!action || priorResult.allowed !== true) return receipt;

  const status = receipt.finished
    ? receipt.success === true
      ? "succeeded"
      : "failed"
    : "executing";
  const { error } = await supabase
    .from("voice_action_requests")
    .update({
      status,
      result: { ...priorResult, providerTransfer: receipt },
      provider_tool_call_id: receipt.toolCallId,
      provider_status_code: receipt.statusCode,
      provider_success: receipt.success,
      failure_reason:
        receipt.finished && receipt.success !== true
          ? receipt.success === false
            ? "PROVIDER_TRANSFER_FAILED"
            : "PROVIDER_TRANSFER_UNCONFIRMED"
          : null,
      started_at: receipt.started ? new Date().toISOString() : undefined,
      completed_at: receipt.finished ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", action.id)
    .eq("user_id", userId);
  if (error) throw error;
  return receipt;
}

export async function applyBolnaOutcome(
  supabase: CompatClient,
  connectionId: string,
  payload: Record<string, unknown>,
  expectedUserId?: string,
) {
  const event = normalizeBolnaEvent(payload);
  const providerId = event.callId;
  const providerStatus = bolnaStatus(payload);
  let executionQuery = supabase
    .from("voice_executions")
    .select(
      "id,user_id,prospect_id,recipient_phone,status,provider_status,outcome,provider_event_at,started_at,answered_at,voice_connections(billing_currency)",
    )
    .eq("connection_id", connectionId)
    .eq("provider_execution_id", providerId);
  if (expectedUserId) executionQuery = executionQuery.eq("user_id", expectedUserId);
  const { data: execution, error: lookupError } = await executionQuery.maybeSingle();
  if (lookupError) throw lookupError;
  if (!execution) return { matched: false, reason: "unknown_execution" };

  const incomingEventAt = providerEventAt(payload);
  if (
    incomingEventAt &&
    execution.provider_event_at &&
    new Date(incomingEventAt).getTime() < new Date(String(execution.provider_event_at)).getTime()
  ) {
    return { matched: true, duplicate: true, stale: true, terminal: false };
  }
  // Some webhook events omit updated_at. The documented status lifecycle is
  // still monotonic, so do not let a late lower-status event undo finalization.
  if (isOlderBolnaProviderStatus(execution.provider_status, providerStatus)) {
    return { matched: true, duplicate: true, stale: true, terminal: false };
  }

  const transferReceipt = await persistTransferReceipt(
    supabase,
    String(execution.id),
    String(execution.user_id),
    payload,
  );

  if (
    isFinishedVoiceOutcome({
      status: execution.status,
      providerStatus: execution.provider_status,
      outcome: execution.outcome,
      incomingProviderStatus: providerStatus,
      eventKind: event.kind,
    })
  ) {
    return { matched: true, duplicate: true, terminal: true };
  }

  const now = new Date().toISOString();
  const rawTranscript = String(payload.transcript ?? "");
  const totalCostMinorUnits = bolnaCostMinorUnits(payload);
  const connection = execution.voice_connections as unknown as
    | { billing_currency?: string | null }
    | Array<{ billing_currency?: string | null }>
    | null;
  const billingCurrency = Array.isArray(connection)
    ? connection[0]?.billing_currency ?? null
    : connection?.billing_currency ?? null;
  const common = {
    provider_metadata: safeProviderMetadata(payload),
    provider_event_at: incomingEventAt,
  };
  // Bolna documents cost, recording, transcript and extracted data as final
  // execution artifacts. Do not persist a transient zero/partial value from
  // queued, ringing, or disconnected events.
  const terminalCost = {
    ...(totalCostMinorUnits !== null ? { cost_minor_units: totalCostMinorUnits } : {}),
    ...(billingCurrency ? { cost_currency: billingCurrency } : {}),
    cost_unit: "cent",
    cost_breakdown: bolnaCostBreakdown(payload),
  };

  if (event.kind === "completed") {
    const { error: artifactError } = await supabase
      .from("voice_executions")
      .update({
        status: "finalizing",
        provider_status: providerStatus,
        transcript: rawTranscript || null,
        summary: typeof payload.summary === "string" ? payload.summary : JSON.stringify(payload.extracted_data ?? {}),
        outcome_data: {
          extracted_data:
            payload.extracted_data && typeof payload.extracted_data === "object"
              ? payload.extracted_data
              : {},
          answered_by_voice_mail: payload.answered_by_voice_mail === true,
        },
        duration_seconds: event.durationSeconds,
        recording_url: event.recordingRef ?? null,
        recording_metadata: recordingMetadata(payload, event.recordingRef ?? null),
        raw_payload: safeProviderMetadata(payload),
        ...common,
        ...terminalCost,
        error_message: null,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", execution.id)
      .eq("user_id", execution.user_id);
    if (artifactError) throw artifactError;

    const textForQualification = recipientTranscript(event, rawTranscript);
    let classification;
    try {
      classification = await classifyReply({
        userId: String(execution.user_id),
        body:
          textForQualification ||
          "Call completed without a usable recipient transcript.",
      });
    } catch {
      classification = classifyReplyHeuristically(textForQualification);
    }
    const facts = extractQualificationFacts(
      textForQualification,
      classification.category,
      Boolean(classification.wants_meeting),
      "voice",
    );
    const bucket = qualificationBucket(facts, classification.category);

    if (execution.prospect_id) {
      const { error: factsError } = await supabase
        .from("lead_qualification_facts")
        .upsert(
          facts.map((fact) => ({
            ...fact,
            user_id: execution.user_id,
            prospect_id: execution.prospect_id,
            source_ref: providerId,
          })),
          { onConflict: "prospect_id,fact_key" },
        );
      if (factsError) throw factsError;

      const { error: leadError } = await supabase
        .from("prospects")
        .update({
          qualification_bucket: bucket,
          ...workflowForQualification(bucket, classification.category),
          next_action_at: null,
          voice_consent_status:
            classification.category === "unsubscribe"
              ? "revoked"
              : "confirmed",
        })
        .eq("id", execution.prospect_id)
        .eq("user_id", execution.user_id);
      if (leadError) throw leadError;

      if (classification.category === "objection" || classification.wants_meeting || ["hot", "warm"].includes(bucket)) {
        await createLeadHandoff(supabase, { userId: String(execution.user_id), prospectId: String(execution.prospect_id), sourceType: classification.wants_meeting ? "meeting_request" : "voice_call", sourceId: String(execution.id), reason: classification.wants_meeting ? "meeting_requested" : classification.category === "objection" ? "objection" : "qualified", conversationSummary: textForQualification, priority: classification.wants_meeting || bucket === "hot" ? "urgent" : "high" });
        await deliverLeadHandoffNotifications(supabase, 2);
      }

      if (classification.category === "unsubscribe") {
        const { error: suppressionError } = await supabase
          .from("phone_suppressions")
          .upsert(
            {
              user_id: execution.user_id,
              phone_hash: phoneHash(String(execution.recipient_phone)),
              channel: "voice",
              reason: "do_not_call",
            },
            { onConflict: "user_id,phone_hash,channel" },
          );
        if (suppressionError) throw suppressionError;
      }
    }

    const { error: outcomeError } = await supabase
      .from("voice_executions")
      .update({
        status: "completed",
        outcome: classification.category,
        answered: event.durationSeconds > 0,
        answered_at: event.durationSeconds > 0 ? execution.answered_at ?? incomingEventAt ?? now : null,
        updated_at: now,
      })
      .eq("id", execution.id)
      .eq("user_id", execution.user_id);
    if (outcomeError) throw outcomeError;
    if (
      transferReceipt?.finished &&
      transferReceipt.success !== true &&
      execution.prospect_id
    ) {
      await createLeadHandoff(supabase, { userId: String(execution.user_id), prospectId: String(execution.prospect_id), sourceType: "voice_call", sourceId: String(execution.id), reason: "transfer_failed", conversationSummary: "The requested live transfer did not complete.", priority: "urgent" });
      await deliverLeadHandoffNotifications(supabase, 2);
    }
    return { matched: true, terminal: true, outcome: classification.category };
  }

  if (["no_answer", "busy", "voicemail"].includes(event.kind)) {
    await setLeadNextAction(
      supabase,
      execution.prospect_id,
      execution.user_id,
      "review_call_outcome",
    );
    const { error } = await supabase
      .from("voice_executions")
      .update({
        status: event.kind === "voicemail" ? "completed" : "failed",
        provider_status: providerStatus,
        outcome: event.kind,
        duration_seconds:
          event.kind === "voicemail"
            ? Number(payload.conversation_duration ?? payload.conversation_time ?? 0)
            : 0,
        answered: event.kind === "voicemail",
        answered_at: event.kind === "voicemail" ? incomingEventAt ?? now : null,
        raw_payload: safeProviderMetadata(payload),
        ...common,
        ...terminalCost,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", execution.id)
      .eq("user_id", execution.user_id);
    if (error) throw error;
    return { matched: true, terminal: true, outcome: event.kind };
  }

  if (event.kind === "failed") {
    if (execution.prospect_id) {
      await createLeadHandoff(supabase, { userId: String(execution.user_id), prospectId: String(execution.prospect_id), sourceType: "voice_call", sourceId: String(execution.id), reason: "call_failed", conversationSummary: event.reason ?? "The voice provider reported a material call failure.", priority: "high" });
      await deliverLeadHandoffNotifications(supabase, 2);
    }
    const { error } = await supabase
      .from("voice_executions")
      .update({
        status: providerStatus === "canceled" ? "cancelled" : "failed",
        provider_status: providerStatus,
        outcome: providerStatus.replaceAll("-", "_"),
        error_message: event.reason,
        raw_payload: safeProviderMetadata(payload),
        ...common,
        ...terminalCost,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", execution.id)
      .eq("user_id", execution.user_id);
    if (error) throw error;
    return { matched: true, terminal: true, outcome: providerStatus };
  }

  const status =
    event.kind === "answered"
      ? providerStatus === "call-disconnected"
        ? "finalizing"
        : "in_progress"
      : "queued";
  const { error } = await supabase
    .from("voice_executions")
    .update({
      status,
      provider_status: providerStatus,
      started_at:
        providerStatus === "initiated" ? execution.started_at ?? incomingEventAt ?? now : execution.started_at,
      answered: event.kind === "answered" || Boolean(execution.answered_at),
      answered_at: event.kind === "answered" ? execution.answered_at ?? incomingEventAt ?? now : execution.answered_at,
      raw_payload: safeProviderMetadata(payload),
      ...common,
      updated_at: now,
    })
    .eq("id", execution.id)
    .eq("user_id", execution.user_id);
  if (error) throw error;
  return { matched: true, terminal: false, status };
}
