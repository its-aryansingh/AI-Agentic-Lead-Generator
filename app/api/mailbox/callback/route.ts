import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { exchangeMailboxCode } from '@/lib/providers/gmail'
import { encryptCredential } from '@/lib/credential-crypto'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(request: Request) {
 const {origin,searchParams}=new URL(request.url)
 const settings=`${origin}/app/settings/mailboxes`
 const supabase=await createClient()
 const {data:{user}}=await supabase.auth.getUser()
 if(!user)return NextResponse.redirect(`${origin}/login`)
 const code=searchParams.get('code'), state=searchParams.get('state')??''
 if(!code)return NextResponse.redirect(`${settings}?error=no_code`)
 const [stateUserId,sig]=state.split('.')
 const secret=process.env.MAILBOX_STATE_SECRET
 if(!secret)return NextResponse.redirect(`${settings}?error=server_configuration`)
 const expected=crypto.createHmac('sha256',secret).update(stateUserId??'').digest('hex')
 const valid=stateUserId===user.id&&sig?.length===expected.length&&crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))
 if(!valid)return NextResponse.redirect(`${settings}?error=bad_state`)
 try {
  const exchanged=await exchangeMailboxCode(code)
  if(!exchanged?.refreshToken||!exchanged.email)return NextResponse.redirect(`${settings}?error=exchange_failed`)
  const admin=createAdminClient()
  const {error}=await admin.from('mailboxes').upsert({user_id:user.id,provider:'gmail',email_address:exchanged.email,
   oauth_refresh_token_encrypted:encryptCredential(exchanged.refreshToken),oauth_refresh_token:null,
   status:'active',last_verified_at:new Date().toISOString(),last_error_code:null,last_error_message:null,disconnected_at:null,
  },{onConflict:'user_id,email_address'})
  if(error)throw error
  return NextResponse.redirect(`${settings}?connected=1`)
 } catch {
  return NextResponse.redirect(`${settings}?error=exchange_failed`)
 }
}
