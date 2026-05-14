import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  // Persist the user row and google refresh token so the export route can use it
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user) {
    await supabase.from('users').upsert(
      {
        id: session.user.id,
        email: session.user.email!,
        google_refresh_token: session.provider_refresh_token ?? null,
      },
      { onConflict: 'id' }
    )
  }

  return NextResponse.redirect(`${origin}/app/chat`)
}
