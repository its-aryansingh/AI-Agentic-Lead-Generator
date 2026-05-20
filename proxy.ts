import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Auth proxy (Next.js 16 replaces the `middleware` convention with `proxy`).
 *
 * Refreshes the Supabase session cookie on every matched request, and
 * enforces gates:
 *   - /app/*  → must be signed in (redirect to /login)
 *   - /login  → must be signed out (redirect to /app/chat)
 *
 * Follows Supabase's documented SSR pattern: read cookies from the
 * incoming request, set them back on a single response we mutate
 * in-place. Replacing supabaseResponse mid-call can drop cookies in
 * edge cases where multiple writes happen in one pass.
 */
export async function proxy(request: NextRequest) {
  const supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // IMPORTANT: getUser() must run between client creation and any
  // redirect logic — otherwise the session refresh races the redirect.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname

  if (!user && path.startsWith('/app')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (user && path === '/login') {
    return NextResponse.redirect(new URL('/app/chat', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match everything except:
     *   - Next.js internals (_next/static, _next/image)
     *   - favicon and static image extensions
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
