import { serve } from "inngest/next"
import { inngest } from "@/inngest/client"
import { bulkEnrichFunction } from "@/inngest/functions/bulk-enrich"
// LeadGenAI's enrichment worker, NOT SalesEngAIMVP's
// publicContactEnrichmentFunction. Both listen for
// leadgen/enrichment.requested; registering both would run two engines
// against one run row. See lib/enrichment/enqueue.ts for why this repo
// keeps its own.
import { enrichProspectFunction } from "@/inngest/functions/enrich-prospect"
import { outreachSchedulesFunction } from "@/inngest/functions/outreach-schedules"
import { outreachDispatchFunction } from "@/inngest/functions/outreach-dispatch"
import { leadFollowupFunction } from "@/inngest/functions/lead-followup"

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    bulkEnrichFunction,
    enrichProspectFunction,
    outreachSchedulesFunction,
    outreachDispatchFunction,
    leadFollowupFunction,
  ],
})
