/** Single display contract for lead workflow and channel status badges. */
export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: "New", researching: "New", ready: "New", queued: "Calling", calling: "Calling",
  emailed: "Emailed", contacted: "Contacted", engaged: "Engaged", hot: "Hot Lead",
  qualified: "Qualified", disqualified: "Disqualified", converted: "Converted", failed: "Failed",
  human_handoff: "Needs Handoff", human_review: "Needs Handoff",
};
export function leadStatusLabel(status: string | null | undefined, nextAction?: string | null) {
  if (nextAction === "human_handoff" || nextAction === "human_review") return LEAD_STATUS_LABELS.human_handoff;
  return LEAD_STATUS_LABELS[String(status ?? "new").toLowerCase()] ?? "New";
}