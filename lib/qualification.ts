import type {ReplyCategoryType} from './reply-classify'

export const qualificationKeys=['interest','need','timeline','authority','budget','meeting_intent'] as const
export type QualificationKey=typeof qualificationKeys[number]
export type QualificationSource='reply'|'voice'|'research'|'not_determined'
export interface QualificationFact {fact_key:QualificationKey;fact_value:string;source_type:QualificationSource;source_excerpt:string|null;confidence:number}
export type QualificationBucket='hot'|'warm'|'nurture'|'disqualified'|'not_determined'

function found(key:QualificationKey,value:string,body:string,confidence:number,source:QualificationSource):QualificationFact{return {fact_key:key,fact_value:value,source_type:source,source_excerpt:body.slice(0,280),confidence}}
function unknown(key:QualificationKey):QualificationFact{return {fact_key:key,fact_value:'not_determined',source_type:'not_determined',source_excerpt:null,confidence:0}}

export function extractQualificationFacts(body:string,category:ReplyCategoryType,wantsMeeting:boolean,source:QualificationSource='reply'):QualificationFact[]{
 const text=body.toLowerCase(),facts=new Map<QualificationKey,QualificationFact>()
 if(category==='interested'||category==='question'||category==='objection')facts.set('interest',found('interest',category==='interested'?'positive':'engaged',body,.85,source))
 if(category==='not_interested'||category==='unsubscribe')facts.set('interest',found('interest','negative',body,.95,source))
 if(/need|looking for|want to|trying to|problem|challenge|improve|help with/.test(text))facts.set('need',found('need','stated',body,.7,source))
 if(/this week|next week|this month|next month|quarter|q[1-4]|urgent|asap|immediately|later|not now/.test(text))facts.set('timeline',found('timeline','stated',body,.75,source))
 if(/i decide|decision maker|my team|our team|my manager|my boss|leadership|procurement/.test(text))facts.set('authority',found('authority','indicated',body,.65,source))
 if(/budget|price|pricing|cost|\$|usd|inr|afford/.test(text))facts.set('budget',found('budget','discussed',body,.7,source))
 if(wantsMeeting)facts.set('meeting_intent',found('meeting_intent','requested',body,.9,source))
 return qualificationKeys.map(key=>facts.get(key)??unknown(key))
}
export function qualificationBucket(facts:QualificationFact[],category:ReplyCategoryType):QualificationBucket{
 if(category==='unsubscribe'||category==='not_interested')return 'disqualified'
 const values=new Map(facts.map(f=>[f.fact_key,f.fact_value]))
 if(values.get('interest')==='positive'&&values.get('meeting_intent')==='requested')return 'hot'
 if(values.get('interest')==='positive'||category==='question'||category==='objection')return 'warm'
 if(category==='out_of_office')return 'nurture'
 return 'not_determined'
}
export function workflowForQualification(bucket:QualificationBucket,category:ReplyCategoryType){
 if(category==='unsubscribe')return {lead_status:'do_not_contact',next_action:'none'} as const
 if(bucket==='disqualified')return {lead_status:'disqualified',next_action:'none'} as const
 if(bucket==='hot')return {lead_status:'qualified',next_action:'human_handoff'} as const
 if(bucket==='warm')return {lead_status:'engaged',next_action:'follow_up'} as const
 return {lead_status:'contacted',next_action:'review'} as const
}
