// The Supabase client is gone; lib/supabase/server.ts exposes the same
// .from() surface over Railway Postgres. Type-only import, so this
// costs nothing at runtime.
import type { CompatClient } from "@/lib/supabase/server";
import { classifyReply, classifyReplyHeuristically } from "@/lib/reply-classify";
import {
  extractQualificationFacts,
  qualificationBucket,
  workflowForQualification,
} from "@/lib/qualification";
import { phoneHash } from "@/lib/voice-compliance";
import { persistLeadHandoff } from "@/lib/lead-handoff";

const hardFailures = new Set([
  "no-answer",
  "busy",
  "failed",
  "canceled",
  "stopped",
  "error",
  "balance-low",
]);
export function bolnaExecutionId(payload: Record<string, unknown>) {
  return String(payload.id ?? payload.execution_id ?? "");
}
export function bolnaStatus(payload: Record<string, unknown>) {
  return String(payload.status ?? "unknown").toLowerCase();
}
export function bolnaRecording(payload: Record<string, unknown>) {
  const telephony = (payload.telephony_data ?? {}) as Record<string, unknown>;
  return String(telephony.recording_url ?? payload.recording_url ?? "") || null;
}

export async function applyBolnaOutcome(
  supabase: CompatClient,
  connectionId: string,
  payload: Record<string, unknown>,
) {
  const providerId = bolnaExecutionId(payload),
    providerStatus = bolnaStatus(payload);
  if (!providerId) return { matched: false, reason: "missing_execution_id" };
  const { data: execution } = await supabase
    .from("voice_executions")
    .select("id,user_id,prospect_id,recipient_phone,status,provider_status")
    .eq("connection_id", connectionId)
    .eq("provider_execution_id", providerId)
    .maybeSingle();
  if (!execution) return { matched: false, reason: "unknown_execution" };
  if (
    (execution.status === "completed" ||
      execution.status === "failed" ||
      execution.status === "cancelled") &&
    execution.provider_status === providerStatus
  )
    return { matched: true, duplicate: true };
  const now = new Date().toISOString(),
    transcript = String(payload.transcript ?? ""),
    duration = Number(
      payload.conversation_duration ??
        (payload.telephony_data as Record<string, unknown> | undefined)
          ?.duration ??
        0,
    ),
    cost = Math.round(Number(payload.total_cost ?? 0) * 100);
  if (providerStatus === "completed") {
    const completedPayload = {
      status: "completed",
      provider_status: providerStatus,
      transcript: transcript || null,
      summary: JSON.stringify(payload.extracted_data ?? {}),
      outcome: "completed",
      duration_seconds: duration,
      cost_minor_units: cost,
      recording_url: bolnaRecording(payload),
      raw_payload: payload,
      error_message: null,
      completed_at: now,
      updated_at: now,
    };
    const { error: persistenceError } = await supabase
      .from("voice_executions")
      .update(completedPayload)
      .eq("id", execution.id);
    if (persistenceError) throw persistenceError;

    let classification;
    try {
      classification = await classifyReply({
        userId: String(execution.user_id),
        body: transcript || "Call completed without a usable transcript.",
      });
    } catch {
      classification = classifyReplyHeuristically(transcript);
    }
    const facts = extractQualificationFacts(
        transcript,
        classification.category,
        Boolean(classification.wants_meeting),
        "voice",
      ),
      bucket = qualificationBucket(facts, classification.category);
    const { error: classificationUpdateError } = await supabase
      .from("voice_executions")
      .update({
        outcome: classification.category,
        updated_at: now,
      })
      .eq("id", execution.id);
    if (classificationUpdateError) throw classificationUpdateError;
    if (execution.prospect_id) {
      await supabase.from("lead_qualification_facts").upsert(
        facts.map((f) => ({
          ...f,
          user_id: execution.user_id,
          prospect_id: execution.prospect_id,
          source_ref: providerId,
        })),
        { onConflict: "prospect_id,fact_key" },
      );
      await supabase
        .from("prospects")
        .update({
          qualification_bucket: bucket,
          ...workflowForQualification(bucket, classification.category),
          next_action_at: null,
          voice_consent_status:
            classification.category === "unsubscribe" ? "revoked" : "confirmed",
        })
        .eq("id", execution.prospect_id);
      await persistLeadHandoff(
        supabase,
        String(execution.user_id),
        String(execution.prospect_id),
        transcript,
      );
      if (classification.category === "unsubscribe")
        await supabase
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
    }
    return { matched: true, terminal: true, outcome: classification.category };
  }
  if (hardFailures.has(providerStatus)) {
    await supabase
      .from("voice_executions")
      .update({
        status: providerStatus === "canceled" ? "cancelled" : "failed",
        provider_status: providerStatus,
        outcome: providerStatus.replaceAll("-", "_"),
        error_message: String(payload.error_message ?? "") || null,
        raw_payload: payload,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", execution.id);
    if (execution.prospect_id)
      await supabase
        .from("prospects")
        .update({
          lead_status: "contacted",
          next_action: "review",
          next_action_at: null,
        })
        .eq("id", execution.prospect_id);
    return { matched: true, terminal: true, outcome: providerStatus };
  }
  await supabase
    .from("voice_executions")
    .update({
      status: providerStatus === "in-progress" ? "in_progress" : "queued",
      provider_status: providerStatus,
      raw_payload: payload,
      updated_at: now,
    })
    .eq("id", execution.id);
  return { matched: true, terminal: false };
}
