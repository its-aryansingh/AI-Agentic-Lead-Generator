import { NextResponse, type NextRequest } from 'next/server'

/**
 * Auth proxy (Next.js 16 replaces the `middleware` convention with `proxy`).
 *
 * Gates:
 *   - /app/*  → must be signed in (redirect to /login)
 *   - /login  → must be signed out (redirect to /app/chat)
 *
 * WHY THIS IS HAND-ROLLED RATHER THAN IMPORTING lib/auth/require-user:
 *
 * That module verifies the HS256 signature with node:crypto. This file runs
 * on every matched request and Next compiles it for the proxy runtime, where
 * `crypto.createHmac` is not available. So the same verification is done here
 * with Web Crypto, which exists in both runtimes. The rules are identical:
 * the algorithm is pinned to HS256 from OUR expectation and never read from
 * `header.alg`, and `exp` / `nbf` are enforced.
 *
 * This is a UX gate, not the security boundary. Every route and server action
 * re-checks the session itself — see lib/auth/require-user.ts. If
 * AUTH_JWT_SECRET is missing the gate fails CLOSED for /app: an unconfigured
 * deployment redirects to /login rather than serving the dashboard.
 */

const SESSION_COOKIE = process.env.AUTH_COOKIE_NAME ?? 'leadgen_session'

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function b64urlToString(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s))
}

/** Constant-time byte comparison. Length is not secret; content is. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

async function verifySession(token: string, secret: string): Promise<boolean> {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [rawHeader, rawPayload, rawSig] = parts

  let header: { alg?: string }
  let payload: { sub?: string; exp?: number; nbf?: number }
  try {
    header = JSON.parse(b64urlToString(rawHeader))
    payload = JSON.parse(b64urlToString(rawPayload))
  } catch {
    return false
  }

  // Pin the algorithm. Never dispatch on header.alg — a token claiming
  // "alg":"none" must not verify.
  if (header.alg !== 'HS256') return false

  let actual: Uint8Array
  try {
    actual = b64urlToBytes(rawSig)
  } catch {
    return false
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${rawHeader}.${rawPayload}`)),
  )

  if (!timingSafeEqual(actual, expected)) return false

  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp === 'number' && payload.exp < now) return false
  if (typeof payload.nbf === 'number' && payload.nbf > now) return false
  return Boolean(payload.sub)
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname

  // Only two routes are gated. Everything else the matcher lets through
  // costs nothing — no client construction, no crypto, no await.
  const guardsApp = path.startsWith('/app')
  const guardsLogin = path === '/login'
  if (!guardsApp && !guardsLogin) return NextResponse.next()

  const token = request.cookies.get(SESSION_COOKIE)?.value ?? null
  const secret = process.env.AUTH_JWT_SECRET
  const signedIn = Boolean(token && secret) && (await verifySession(token!, secret!))

  if (!signedIn && guardsApp) {
    const to = new URL('/login', request.url)
    // Preserve where they were headed so login can send them back.
    if (path !== '/app') to.searchParams.set('next', path + request.nextUrl.search)
    return NextResponse.redirect(to)
  }
  if (signedIn && guardsLogin) {
    return NextResponse.redirect(new URL('/app/chat', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/app/:path*', '/login'],
}
