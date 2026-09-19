import test from "node:test"
import assert from "node:assert/strict"
import { nextScheduleOccurrence } from "@/lib/outreach/schedule"
import { transitionProspect } from "@/lib/outreach/prospect-state-machine"

test("outreach state machine rejects stale terminal transitions",()=>{
 assert.equal(transitionProspect("new","email_sent"),"contacted")
 assert.equal(transitionProspect("contacted","email_replied"),"engaged")
 assert.equal(transitionProspect("qualified","email_sent"),null)
 assert.equal(transitionProspect("engaged","unsubscribed"),"do_not_contact")
})
test("schedule occurrence honours IANA timezone and requested weekday",()=>{
 const next=nextScheduleOccurrence(new Date("2026-03-06T20:00:00.000Z"),"Asia/Kolkata","09:00",[1])
 const local=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Kolkata",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(next)
 assert.match(local,/Mon/); assert.match(local,/09:00/)
})
