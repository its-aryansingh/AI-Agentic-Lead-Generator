import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { mailboxConsentUrl } from '@/lib/providers/gmail'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(request: Request){
 const supabase=await createClient(), {origin}=new URL(request.url)
 const {data:{user}}=await supabase.auth.getUser()
 if(!user)return NextResponse.redirect(`${origin}/login`)
 const secret=process.env.MAILBOX_STATE_SECRET
 if(!secret)return NextResponse.redirect(`${origin}/app/settings/mailboxes?error=server_configuration`)
 const sig=crypto.createHmac('sha256',secret).update(user.id).digest('hex')
 const url=mailboxConsentUrl(`${user.id}.${sig}`)
 if(!url)return NextResponse.redirect(`${origin}/app/settings/mailboxes?error=google_not_configured`)
 return NextResponse.redirect(url)
}
