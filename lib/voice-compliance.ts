import crypto from 'node:crypto'

export function normalizeE164(value:string){
 const cleaned=value.trim().replace(/[\s()-]/g,'')
 return /^\+[1-9]\d{7,14}$/.test(cleaned)?cleaned:null
}
export function phoneHash(value:string){return crypto.createHash('sha256').update(value).digest('hex')}
export function withinCallingHours(now:Date,timeZone:string,start:number,end:number){
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone,hour:'2-digit',hour12:false}).format(now).split(':')[0])%24
 return hour>=start&&hour<end
}
export function nextCallingWindow(now:Date,timeZone:string,start:number,end:number){
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||start>23||end<1||end>24||start>=end)throw new Error('Invalid calling window.')
 const formatter=new Intl.DateTimeFormat('en-US',{timeZone,hour:'2-digit',minute:'2-digit',hour12:false})
 const candidate=new Date(Math.ceil((now.getTime()+1)/60000)*60000)
 for(let minute=0;minute<=24*60+1;minute+=1){
  const parts=Object.fromEntries(formatter.formatToParts(candidate).map(part=>[part.type,part.value])),hour=Number(parts.hour)%24,localMinute=Number(parts.minute)
  if(hour===start&&localMinute===0)return candidate
  candidate.setUTCMinutes(candidate.getUTCMinutes()+1)
 }
 throw new Error('Could not calculate the next calling window.')
}
export function isRetryableLocalVoiceFailure(call:{status?:unknown;provider_status?:unknown;provider_execution_id?:unknown}){
 return call.status==='failed'&&call.provider_status==='request_failed'&&!call.provider_execution_id
}
export function voiceWebhookSignature(connectionId:string,version=1){
 const secret=process.env.BOLNA_WEBHOOK_SECRET??process.env.UNSUB_SECRET??process.env.MAILBOX_STATE_SECRET
 if(!secret)throw new Error('BOLNA_WEBHOOK_SECRET is not configured.')
 return crypto.createHmac('sha256',secret).update(`${connectionId}:${version}`).digest('base64url')
}
export function validVoiceWebhookSignature(connectionId:string,provided:string,version=1){
 const expected=voiceWebhookSignature(connectionId,version),a=Buffer.from(expected),b=Buffer.from(provided)
 return a.length===b.length&&crypto.timingSafeEqual(a,b)
}

// Bolna's current execution API documents these webhook source IPs and does
// not document an HMAC payload header. The signed query capability is
// therefore an application-level secret configured in the agent webhook URL;
// source validation is an additional provider-contract check, not a substitute.
const BOLNA_WEBHOOK_IPS = new Set([
 "13.203.39.153",
 "13.126.9.249",
 "13.202.133.53",
])
export function bolnaWebhookSourceIp(headers: Headers) {
 const value=headers.get("x-vercel-forwarded-for")??headers.get("cf-connecting-ip")??headers.get("x-forwarded-for")??""
 return value.split(",")[0].trim()
}
export function validBolnaWebhookSource(headers: Headers){
 const ip=bolnaWebhookSourceIp(headers)
 // Local/test reverse proxies frequently do not supply a verified source IP.
 // Production fails closed when its trusted edge does not forward one.
 return !ip ? process.env.NODE_ENV!=="production" : BOLNA_WEBHOOK_IPS.has(ip)
}
