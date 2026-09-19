export type ProspectStatus =
  | "new"
  | "researching"
  | "ready"
  | "contacted"
  | "engaged"
  | "qualified"
  | "disqualified"
  | "converted"
  | "do_not_contact";
export type ProspectEvent =
  | "research_started"
  | "research_completed"
  | "email_queued"
  | "email_sent"
  | "email_replied"
  | "call_queued"
  | "call_answered"
  | "call_completed"
  | "call_failed"
  | "objection"
  | "callback_requested"
  | "meeting_requested"
  | "qualified"
  | "disqualified"
  | "unsubscribed"
  | "converted";

const terminal = new Set<ProspectStatus>([
  "qualified",
  "disqualified",
  "converted",
  "do_not_contact",
]);
export function transitionProspect(
  current: ProspectStatus,
  event: ProspectEvent,
): ProspectStatus | null {
  if (terminal.has(current) && event !== "unsubscribed") return null;
  const next: Partial<Record<ProspectEvent, ProspectStatus>> = {
    research_started: "researching",
    research_completed: "ready",
    email_queued: current === "new" ? "new" : current,
    call_queued: current === "new" ? "new" : current,
    email_sent: "contacted",
    call_answered: "engaged",
    email_replied: "engaged",
    call_completed: "contacted",
    call_failed: current,
    objection: "engaged",
    callback_requested: "engaged",
    meeting_requested: "engaged",
    qualified: "qualified",
    disqualified: "disqualified",
    unsubscribed: "do_not_contact",
    converted: "converted",
  };
  return next[event] ?? null;
}

import type { CompatClient } from "@/lib/supabase/server";

export async function applyProspectTransition(
  db: CompatClient,
  input: {
    userId: string;
    prospectId: string;
    event: ProspectEvent;
    actor: string;
    source: string;
    sourceId?: string | null;
    metadata?: Record<string, unknown>;
    nextAction?: string | null;
    nextActionAt?: string | null;
  },
) {
  const { data: lead, error: readError } = await db
    .from("prospects")
    .select("lead_status")
    .eq("id", input.prospectId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (readError || !lead)
    throw new Error(readError?.message ?? "Lead not found or unauthorized.");
  const from = String(lead.lead_status ?? "new") as ProspectStatus;
  const to = transitionProspect(from, input.event);
  const now = new Date().toISOString();
  if (to || input.nextAction !== undefined) {
    const { data: updated, error } = await db
      .from("prospects")
      .update({
        ...(to !== from ? { lead_status: to, status_updated_at: now } : {}),
        ...(input.nextAction !== undefined
          ? {
              next_action: input.nextAction,
              next_action_at: input.nextActionAt ?? null,
            }
          : {}),
      })
      .eq("id", input.prospectId)
      .eq("user_id", input.userId)
      .eq("lead_status", lead.lead_status)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated)
      throw new Error("Prospect state changed concurrently; retry the event against the current state.");
  }
  const { error: eventError } = await db.from("lead_state_events").insert({
    user_id: input.userId,
    prospect_id: input.prospectId,
    event_type: input.event,
    from_status: from,
    to_status: to,
    actor: input.actor,
    source: input.source,
    source_id: input.sourceId ?? null,
    metadata: input.metadata ?? {},
  });
  if (eventError) throw new Error(eventError.message);
  return { from, to };
}
