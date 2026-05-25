/**
 * Pure auth-header parsing. Kept import-free so
 * `node --test --experimental-strip-types` can load it directly
 * (no "@/" alias resolution outside Next.js). Mirrors the
 * orchestration-core / whatsapp-webhook-core split.
 *
 * The async user-lookup that calls Supabase lives in api-auth.ts.
 */

export function parseBearerToken(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null
  const trimmed = headerValue.trim()
  if (!trimmed) return null

  // Match "Bearer <token>" case-insensitively, one or more spaces between.
  const match = /^Bearer\s+(.+)$/i.exec(trimmed)
  if (!match) return null

  const token = match[1].trim()
  if (!token) return null

  // Reject obviously malformed tokens (whitespace inside, comma-separated).
  // Real Supabase JWTs are header.payload.signature — three base64url chunks.
  if (/\s/.test(token)) return null
  return token
}

export function looksLikeJwt(token: string): boolean {
  // Three base64url segments separated by dots. Cheap structural check;
  // real validation happens server-side via Supabase.
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
}
