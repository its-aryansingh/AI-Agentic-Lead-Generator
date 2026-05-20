import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

/**
 * Server-side Supabase client.
 *
 * Used in Server Components, Server Actions, and Route Handlers.
 * Reads/writes auth cookies via the Next.js cookies() store so SSR sees
 * the same session the browser does.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}

/**
 * Service-role Supabase client — bypasses RLS.
 * Use ONLY in trusted server contexts (route handlers writing to other users'
 * rows, scheduled tasks, webhooks). Never expose to client code.
 *
 * Falls back to the anon key if the service-role key isn't configured so the
 * app still boots in dev without a fully wired Supabase project.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "anon",
    { auth: { persistSession: false } },
  )
}
