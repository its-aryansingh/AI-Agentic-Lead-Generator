// The Supabase client is gone; lib/supabase/server.ts exposes the same
// .from() surface over Railway Postgres. Type-only import, so this
// costs nothing at runtime.
import type { CompatClient } from "@/lib/supabase/server";
import { buildHandoffSummary } from "@/lib/handoff";
import { notifyPush, notifySlack } from "@/lib/notifications";

export async function persistLeadHandoff(
  supabase: CompatClient,
  userId: string,
  prospectId: string,
  conversationSummary: string,
) {
  const [{ data: lead }, { data: facts }] = await Promise.all([
    supabase
      .from("prospects")
      .select(
        "id,input_name,input_company,input_title,research_summary,qualification_bucket,lead_status,next_action,handoff_summary",
      )
      .eq("id", prospectId)
      .maybeSingle(),
    supabase
      .from("lead_qualification_facts")
      .select("fact_key,fact_value,source_type,source_excerpt,confidence")
      .eq("prospect_id", prospectId)
      .order("fact_key"),
  ]);
  if (!lead || !["hot", "warm"].includes(String(lead.qualification_bucket)))
    return null;
  const summary = buildHandoffSummary({
    name: String(lead.input_name),
    company: lead.input_company as string | null,
    title: lead.input_title as string | null,
    bucket: String(lead.qualification_bucket),
    leadStatus: String(lead.lead_status),
    nextAction: String(lead.next_action),
    research: lead.research_summary as string | null,
    conversationSummary,
    facts: (facts ?? []).map((f) => ({
      fact_key: String(f.fact_key),
      fact_value: String(f.fact_value),
      source_type: String(f.source_type),
      source_excerpt: f.source_excerpt as string | null,
      confidence: Number(f.confidence),
    })),
  });
  const first = !lead.handoff_summary;
  await supabase
    .from("prospects")
    .update({
      handoff_summary: summary,
      handoff_generated_at: new Date().toISOString(),
    })
    .eq("id", prospectId);
  if (first) {
    await Promise.all([
      notifyPush(userId, {
        title: `${String(lead.qualification_bucket).toUpperCase()} lead ready`,
        body: `${String(lead.input_name)} · ${String(lead.next_action)}`,
        data: { kind: "lead_handoff", prospect_id: prospectId },
        priority: "high",
      }),
      notifySlack(userId, {
        emoji: "🔥",
        text: `*${String(lead.qualification_bucket)} lead*: ${String(lead.input_name)} — ${String(lead.next_action)}`,
        link: { url: `/app/leads/${prospectId}`, label: "Open lead" },
      }),
    ]);
  }
  return summary;
}
