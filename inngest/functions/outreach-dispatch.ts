import { inngest } from "@/inngest/client"
import { executeOutreachRun } from "@/lib/outreach/autonomous-dispatcher"
export const outreachDispatchFunction=inngest.createFunction({id:"outreach-dispatch",retries:3,triggers:[{event:"outreach/run.requested"}]},async({event})=>{await executeOutreachRun(event.data.runId,event.data.userId);return {runId:event.data.runId}})
