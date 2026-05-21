import { serve } from "inngest/next"
import { inngest } from "@/inngest/client"
import { bulkEnrichFunction } from "@/inngest/functions/bulk-enrich"

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [bulkEnrichFunction],
})
