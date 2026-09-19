import type { CompatClient } from "@/lib/supabase/server";
import { createLeadHandoff, deliverLeadHandoffNotifications } from "@/lib/unified-lead-handoff";

export async function persistLeadHandoff(
  supabase: CompatClient,
  userId: string,
  prospectId: string,
  conversationSummary: string,
) {
  const result = await createLeadHandoff(supabase, { userId, prospectId, sourceType: "system", sourceId: `legacy:${prospectId}`, reason: "qualified", conversationSummary });
  await deliverLeadHandoffNotifications(supabase, 2);
  return result.summary;
}
