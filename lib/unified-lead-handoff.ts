import type { CompatClient } from "@/lib/supabase/server";
import { generateText } from "ai";

import { deductCredits } from "@/lib/credits";
import { buildHandoffSummary, type HandoffFact } from "@/lib/handoff";
import { notifyPush, notifySlack } from "@/lib/notifications";
import { creditsForOperation } from "@/lib/credit-costs";
import { recordAiUsage, resolveAiModel } from "@/lib/ai-config";
import { applyProspectTransition, type ProspectEvent } from "@/lib/outreach/prospect-state-machine";

export type HandoffSourceType = "email_reply" | "voice_call" | "callback_request" | "meeting_request" | "agent_tool" | "system";
export type HandoffReason = "hot_reply" | "objection" | "callback_requested" | "meeting_requested" | "qualified" | "call_failed" | "transfer_failed" | "follow_up_requested";

export interface CreateLeadHandoffInput {
  userId: string; prospectId: string; sourceType: HandoffSourceType; sourceId: string;
  reason: HandoffReason; priority?: "low" | "normal" | "high" | "urgent";
  conversationSummary?: string | null; dueAt?: string | null; recommendedNextAction?: string;
}

function recommendation(reason: HandoffReason) {
  if (reason === "meeting_requested") return "Confirm a meeting time and send the calendar link.";
  if (reason === "callback_requested") return "Call the prospect at the requested time.";
  if (reason === "objection") return "Review the objection and send a tailored salesperson response.";
  if (reason === "call_failed" || reason === "transfer_failed") return "Review the call failure before attempting another contact.";
  return "Review the lead context and take ownership of the next response.";
}

/** Durable fallback. It is deliberately used if a configured model is unavailable. */
export function deterministicHandoffSummary(lead: Record<string, unknown>, facts: HandoffFact[], input: CreateLeadHandoffInput) {
  return buildHandoffSummary({
    name: String(lead.input_name ?? "Unknown lead"), company: lead.input_company as string | null,
    title: lead.input_title as string | null, bucket: String(lead.qualification_bucket ?? "not determined"),
    leadStatus: String(lead.lead_status ?? "new"), nextAction: "human_handoff",
    research: lead.research_summary as string | null, conversationSummary: input.conversationSummary ?? `Source: ${input.sourceType}; reason: ${input.reason}.`, facts,
  });
}

async function generatePersistedHandoffSummary(lead: Record<string, unknown>, facts: HandoffFact[], input: CreateLeadHandoffInput, fallback: string) {
  const resolved = await resolveAiModel(input.userId, "writing");
  if (!resolved) return { summary: fallback, creditCost: 1, model: null as string | null };
  const started = Date.now();
  try {
    const evidence = facts.filter((fact) => fact.fact_value !== "not_determined").slice(0, 8).map((fact) => `${fact.fact_key}: ${fact.fact_value}`).join("; ");
    const { text } = await generateText({ model: resolved.model, maxOutputTokens: 260, system: "Write a concise internal sales handoff brief. Include lead identity, source and request/objection, prior contact context, and a suggested human response. Do not invent facts, expose credentials, or include unbounded transcript text.", prompt: `Lead: ${String(lead.input_name ?? "Unknown")}, ${String(lead.input_title ?? "")}, ${String(lead.input_company ?? "")}.\nSource: ${input.sourceType}; reason: ${input.reason}.\nRecent interaction: ${String(input.conversationSummary ?? "No additional interaction supplied.").slice(0, 1200)}\nQualification evidence: ${evidence || "not determined"}\nRecommended action: ${input.recommendedNextAction ?? recommendation(input.reason)}` });
    const summary = text.trim().slice(0, 4000) || fallback;
    const creditCost = creditsForOperation(resolved.modelId, "writing");
    await recordAiUsage({ userId: input.userId, provider: resolved.provider, model: resolved.modelId, operation: "handoff_summary", status: "completed", durationMs: Date.now() - started, creditCost });
    return { summary, creditCost, model: resolved.modelId };
  } catch (_error) {
    await recordAiUsage({ userId: input.userId, provider: resolved.provider, model: resolved.modelId, operation: "handoff_summary", status: "failed", durationMs: Date.now() - started, errorCode: "provider_error" });
    return { summary: fallback, creditCost: creditsForOperation(resolved.modelId, "writing"), model: resolved.modelId };
  }
}

/** Creates one queue item and two outbox entries. Provider delivery never joins this write path. */
export async function createLeadHandoff(db: CompatClient, input: CreateLeadHandoffInput) {
  const [{ data: lead }, { data: factRows }] = await Promise.all([
    db.from("prospects").select("id,input_name,input_company,input_title,research_summary,qualification_bucket,lead_status").eq("id", input.prospectId).eq("user_id", input.userId).maybeSingle(),
    db.from("lead_qualification_facts").select("fact_key,fact_value,source_type,source_excerpt,confidence").eq("prospect_id", input.prospectId).eq("user_id", input.userId).order("fact_key"),
  ]);
  if (!lead) throw new Error("Lead not found or unauthorized.");
  const facts = (factRows ?? []).map((f) => ({ fact_key: String(f.fact_key), fact_value: String(f.fact_value), source_type: String(f.source_type), source_excerpt: f.source_excerpt as string | null, confidence: Number(f.confidence) }));
  const idempotencyKey = `${input.sourceType}:${input.sourceId}:${input.reason}`;
  const { data: prior } = await db.from("lead_handoffs").select("id,summary").eq("user_id", input.userId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (prior) return { id: String(prior.id), summary: String(prior.summary), created: false };
  const fallback = deterministicHandoffSummary(lead as Record<string, unknown>, facts, input);
  const generated = await generatePersistedHandoffSummary(lead as Record<string, unknown>, facts, input, fallback);
  const row = { user_id: input.userId, prospect_id: input.prospectId, source_type: input.sourceType, source_id: input.sourceId, reason: input.reason, priority: input.priority ?? "normal", summary: generated.summary, recommended_next_action: input.recommendedNextAction ?? recommendation(input.reason), due_at: input.dueAt ?? null, idempotency_key: idempotencyKey };
  let { data: handoff, error } = await db.from("lead_handoffs").insert(row).select("id,summary").maybeSingle();
  let created = !error;
  if (error && String((error as { code?: string }).code) === "23505") {
    const existing = await db.from("lead_handoffs").select("id,summary").eq("user_id", input.userId).eq("idempotency_key", idempotencyKey).maybeSingle();
    handoff = existing.data; error = existing.error;
    created = false;
  }
  if (error || !handoff) throw new Error(error?.message ?? "Could not persist handoff.");
  const eventByReason: Record<HandoffReason, ProspectEvent> = { hot_reply: "email_replied", objection: "objection", callback_requested: "callback_requested", meeting_requested: "meeting_requested", qualified: "qualified", call_failed: "call_failed", transfer_failed: "call_failed", follow_up_requested: "callback_requested" };
  await applyProspectTransition(db, { userId: input.userId, prospectId: input.prospectId, event: eventByReason[input.reason], actor: "system", source: input.sourceType, metadata: { handoff_id: handoff.id, source_id: input.sourceId }, nextAction: "human_handoff" });
  await db.from("prospects").update({ handoff_summary: handoff.summary, handoff_generated_at: new Date().toISOString() }).eq("id", input.prospectId).eq("user_id", input.userId);
  if (created) {
    // Summary generation is a platform AI operation, never a Bolna provider cost.
    await deductCredits({ userId: input.userId, count: generated.creditCost, reason: "handoff_summary", idempotencyKey: `handoff:${handoff.id}:summary` });
    await db.from("lead_handoff_notification_outbox").upsert([
      { user_id: input.userId, handoff_id: handoff.id, channel: "push", idempotency_key: `handoff:${handoff.id}:push` },
      { user_id: input.userId, handoff_id: handoff.id, channel: "slack", idempotency_key: `handoff:${handoff.id}:slack` },
    ], { onConflict: "user_id,idempotency_key" });
  }
  return { id: String(handoff.id), summary: String(handoff.summary), created };
}

/** At-most-once worker; ambiguous provider failures require manual retry. */
export async function deliverLeadHandoffNotifications(db: CompatClient, limit = 50) {
  const { data: claimed } = await db.rpc("claim_handoff_notifications", { p_limit: limit });
  const claimedRows = (claimed ?? []) as Array<{ id: string; user_id: string; handoff_id: string; channel: string; attempts: number }>;
  for (const row of claimedRows) {
    const { data: handoff } = await db.from("lead_handoffs").select("id,prospect_id,reason,priority").eq("id", row.handoff_id).eq("user_id", row.user_id).maybeSingle();
    if (!handoff) { await db.from("lead_handoff_notification_outbox").update({ last_error: "owned_handoff_missing", updated_at: new Date().toISOString() }).eq("id", row.id).eq("user_id", row.user_id); continue; }
    const title = `Lead handoff: ${String(handoff?.reason ?? "needs attention").replaceAll("_", " ")}`;
    const body = `A ${String(handoff?.priority ?? "normal")} priority handoff needs review.`; // notification policy: no transcript
    const result = row.channel === "push" ? await notifyPush(String(row.user_id), { title, body, priority: "high", data: { kind: "lead_handoff", handoff_id: row.handoff_id, prospect_id: handoff?.prospect_id } }) : await notifySlack(String(row.user_id), { emoji: "📥", text: title, link: { url: "/app/inbox", label: "Open inbox" } });
    await db.from("lead_handoff_notification_outbox").update({ ...(result.sent ? { delivered_at: new Date().toISOString(), last_error: null } : { last_error: result.skipped ?? "delivery_failed" }), updated_at: new Date().toISOString() }).eq("id", row.id).eq("user_id", row.user_id).is("delivered_at", null);
  }
}
