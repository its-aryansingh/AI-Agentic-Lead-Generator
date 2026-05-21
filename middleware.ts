import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

/**
 * Supabase auth middleware.
 *
 * Two jobs:
 *  1. Refresh the Supabase session on every request so cookies stay live
 *     (without this, sessions expire silently and server components see a
 *     null user even while the browser still shows the user as logged in).
 *  2. Redirect unauthenticated requests to /app/* to /login.
 *
 * Public paths (/login, /api/auth/callback, /u/[token], /api/health,
 * /api/cron/*, the marketing root) are allowed through without auth.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request: { headers: request.headers } })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Always refresh — this is the critical line that keeps sessions alive.
  const { data: { user } } = await supabase.auth.getUser()

  // Gate all /app/* routes.
  const { pathname } = request.nextUrl
  if (pathname.startsWith("/app") && !user) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  return response
}

export const config = {
  matcher: [
    // Match everything except Next.js internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
