import { createAdminClient } from "@/lib/supabase/server";
import { dispatchAutonomousOutreach, type OutreachChannel } from "@/lib/outreach/autonomous-dispatcher";

/** Revalidates a scheduled follow-up immediately before it enters dispatch. */
export async function executeLeadFollowup(followupId: string, userId: string) {
  const db = createAdminClient();
  const { data: followup } = await db.from("lead_followups")
    .select("id,prospect_id,channel,status,scheduled_at,approval_id")
    .eq("id", followupId).eq("user_id", userId).maybeSingle();
  if (!followup || followup.status !== "scheduled") return { status: "ignored" as const };
  if (new Date(String(followup.scheduled_at)).getTime() > Date.now()) return { status: "not_due" as const };
  const { data: lead } = await db.from("prospects").select("id,lead_status,email,phone")
    .eq("id", followup.prospect_id).eq("user_id", userId).maybeSingle();
  const channel = followup.channel as OutreachChannel;
  const ineligible = !lead || lead.lead_status === "do_not_contact" || (channel === "email" && !lead.email) || (channel === "voice" && !lead.phone) || !followup.approval_id;
  if (ineligible) {
    await db.from("lead_followups").update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", followupId).eq("user_id", userId).eq("status", "scheduled");
    return { status: "blocked" as const };
  }
  const result = await dispatchAutonomousOutreach({
    userId,
    requestedBy: "schedule",
    channel,
    prospectIds: [String(followup.prospect_id)],
    approvalId: String(followup.approval_id),
    idempotencyKey: `followup:${followupId}`,
  });
  await db.from("lead_followups").update({
    status: result.status === "failed" ? "failed" : "completed",
    completed_at: new Date().toISOString(),
  }).eq("id", followupId).eq("user_id", userId).eq("status", "scheduled");
  return { status: result.status, runId: result.runId ?? null };
}
