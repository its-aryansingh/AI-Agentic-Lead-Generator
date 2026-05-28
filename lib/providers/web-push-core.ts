/**
 * Web Push (VAPID) provider — pure helpers. Import-free so
 * `node --test --experimental-strip-types` can load them. The async
 * sender (web-push npm package + HTTPS POST to the browser's push
 * service) lives in web-push.ts.
 *
 * Why VAPID: lets us push to a browser's service worker without going
 * through FCM/APNs directly. The browser obtains a PushSubscription
 * (endpoint + p256dh + auth) which we store in push_tokens and use as
 * the addressable target.
 */

export interface WebPushKeys {
  p256dh: string
  auth: string
}

export interface WebPushSubscription {
  endpoint: string
  keys: WebPushKeys
  /** Optional, browser-set expiration. We don't validate it. */
  expirationTime?: number | null
}

/**
 * Validate the shape of a PushSubscription as returned by the browser
 * (after `serviceWorkerReg.pushManager.subscribe()`). Rejects empty,
 * malformed, or wrong-type fields. Does NOT verify cryptographic
 * material — the actual push attempt does that.
 */
export function isValidWebPushSubscription(s: unknown): s is WebPushSubscription {
  if (!s || typeof s !== "object") return false
  const sub = s as Record<string, unknown>
  if (typeof sub.endpoint !== "string") return false
  if (!sub.endpoint.startsWith("https://")) return false
  if (sub.endpoint.length > 2048) return false
  const keys = sub.keys
  if (!keys || typeof keys !== "object") return false
  const k = keys as Record<string, unknown>
  if (typeof k.p256dh !== "string" || k.p256dh.length === 0 || k.p256dh.length > 256) return false
  if (typeof k.auth !== "string" || k.auth.length === 0 || k.auth.length > 64) return false
  return true
}

/**
 * Parse a token cell (which we store as JSON.stringify(subscription))
 * back into a usable subscription. Returns null on any malformed input.
 */
export function parseSubscriptionJson(tokenCell: string): WebPushSubscription | null {
  if (typeof tokenCell !== "string" || tokenCell.length === 0) return null
  try {
    const parsed: unknown = JSON.parse(tokenCell)
    if (isValidWebPushSubscription(parsed)) return parsed
    return null
  } catch {
    return null
  }
}

/**
 * VAPID public/private keys are URL-safe base64 strings. The public key
 * is 65 bytes (uncompressed P-256) → 87 base64url chars. The private
 * key is 32 bytes → 43 base64url chars. We accept either form.
 */
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/

export function isValidVapidKey(key: string, kind: "public" | "private"): boolean {
  if (typeof key !== "string") return false
  const trimmed = key.trim()
  if (!trimmed) return false
  if (!BASE64URL_RE.test(trimmed)) return false
  // 32 bytes (private) → 43 chars; 65 bytes (public uncompressed) → 87 chars.
  // Some libraries pad to 88 with trailing '='; we accept ranges to be lenient.
  if (kind === "public") return trimmed.length >= 80 && trimmed.length <= 100
  return trimmed.length >= 40 && trimmed.length <= 50
}

export interface VapidEnv {
  publicKey: string | undefined
  privateKey: string | undefined
  subject: string | undefined
}

export function isVapidConfigured(env: VapidEnv): boolean {
  return Boolean(env.publicKey && env.privateKey && env.subject)
}

/**
 * VAPID subject must be a mailto: or https: URI per RFC 8292. Empty
 * is invalid; anything else is allowed (we don't dial-test).
 */
export function isValidVapidSubject(s: string | undefined): boolean {
  if (!s || typeof s !== "string") return false
  const lower = s.trim().toLowerCase()
  return lower.startsWith("mailto:") || lower.startsWith("https://")
}
