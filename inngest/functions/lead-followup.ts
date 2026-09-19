import { inngest } from "@/inngest/client";
import { executeLeadFollowup } from "@/lib/outreach/followups";

export const leadFollowupFunction = inngest.createFunction(
  { id: "lead-followup", retries: 3, triggers: [{ event: "lead/followup.scheduled" }] },
  async ({ event, step }) => {
    await step.sleepUntil("wait-for-followup", new Date(event.data.scheduledAt));
    return step.run("revalidate-and-dispatch", () => executeLeadFollowup(event.data.followupId, event.data.userId));
  },
);
