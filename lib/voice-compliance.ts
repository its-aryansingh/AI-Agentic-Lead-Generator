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
