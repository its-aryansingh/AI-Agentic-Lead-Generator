import { serve } from "inngest/next"
import { inngest } from "@/inngest/client"
import { bulkEnrichFunction } from "@/inngest/functions/bulk-enrich"
import { enrichProspectFunction } from "@/inngest/functions/enrich-prospect"

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [bulkEnrichFunction, enrichProspectFunction],
})
