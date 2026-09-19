import { NextResponse } from "next/server"
import crypto from "node:crypto"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { dispatchAutonomousOutreach, type OutreachChannel } from "@/lib/outreach/autonomous-dispatcher"
export const runtime="nodejs"
export async function POST(req:Request){
 const auth=await createClient(); const {data:{user}}=await auth.auth.getUser(); if(!user)return NextResponse.json({error:"Unauthorized"},{status:401})
 const body=await req.json().catch(()=>({})); const channel=body.channel as OutreachChannel; if(!["email","voice","smart_both"].includes(channel))return NextResponse.json({error:"Invalid channel"},{status:400})
 const prospectIds=Array.isArray(body.prospectIds)?body.prospectIds.filter((x:unknown)=>typeof x==="string").slice(0,100):undefined
 const preview=await dispatchAutonomousOutreach({userId:user.id,requestedBy:"ui",channel,prospectIds,filters:body.filters,dryRun:true,approvalId:"preview",idempotencyKey:"preview"})
 const db=createAdminClient(), token=crypto.randomBytes(32).toString("base64url"), hash=crypto.createHash("sha256").update(token).digest("hex")
 const {data:approval,error}=await db.from("outreach_action_approvals").insert({user_id:user.id,action_kind:"autonomous_outreach",channel:channel==="smart_both"?"multichannel":channel,scope:{channel,prospectIds:prospectIds??null,filters:body.filters??{}},preview_summary:preview,payload_hash:crypto.createHash("sha256").update(JSON.stringify({channel,prospectIds,filters:body.filters??{}})).digest("hex"),confirmation_token_hash:hash,source:"ui",actor:"user",consent_attestation:body.consentConfirmed?{confirmed:true}:null,expires_at:new Date(Date.now()+5*60_000).toISOString()}).select("id").single()
 if(error||!approval)return NextResponse.json({error:error?.message??"Could not create approval"},{status:500}); return NextResponse.json({...preview,approvalId:approval.id,confirmationToken:token})
}
