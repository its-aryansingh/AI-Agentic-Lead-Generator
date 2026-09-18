import {NextResponse} from 'next/server'
import {createAdminClient} from '@/lib/supabase/server'
import {validVoiceWebhookSignature} from '@/lib/voice-compliance'
import {applyBolnaOutcome} from '@/lib/voice-outcome'

export const runtime='nodejs'
export async function POST(req:Request,{params}:{params:Promise<{connectionId:string}>}){
 const {connectionId}=await params,signature=new URL(req.url).searchParams.get('signature')??''
 let payload:Record<string,unknown>;try{payload=await req.json()}catch{return new NextResponse('Invalid JSON',{status:400})}
 const supabase=createAdminClient(),{data:connection}=await supabase.from('voice_connections').select('id,webhook_version').eq('id',connectionId).eq('provider','bolna').maybeSingle()
 if(!connection)return new NextResponse('Unknown connection',{status:404})
 if(!validVoiceWebhookSignature(connectionId,signature,Number(connection.webhook_version)))return new NextResponse('Forbidden',{status:403})
 const result=await applyBolnaOutcome(supabase,connectionId,payload)
 return NextResponse.json(result,{status:result.matched?200:202})
}
