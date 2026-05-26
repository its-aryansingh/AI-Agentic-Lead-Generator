/**
 * Expo Push provider — pure helpers. Kept import-free so
 * `node --test --experimental-strip-types` can load them directly.
 * Async HTTP layer lives in expo-push.ts.
 *
 * Expo's push token format is documented as `ExponentPushToken[xxx]`
 * or `ExpoPushToken[xxx]`. The contents inside the brackets is opaque
 * (Expo's encoded device id); we validate the wrapper only.
 *
 * For web push (VAPID), tokens are a base64url string (no wrapper) and
 * usually 100+ chars. We accept any non-empty string for web because
 * the format isn't strictly standardized at the row level.
 */

export type PushProvider = "expo" | "web"
export type PushPlatform = "ios" | "android" | "web"

const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/

export function isValidExpoToken(token: string): boolean {
  return typeof token === "string" && EXPO_TOKEN_RE.test(token)
}

export function isValidPushToken(token: string, provider: PushProvider): boolean {
  if (typeof token !== "string") return false
  const t = token.trim()
  if (!t) return false
  if (t.length > 2048) return false // sanity cap
  if (provider === "expo") return isValidExpoToken(t)
  // web: opaque string; basic sanity only.
  return t.length >= 8
}

export interface PushMessage {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  /** 'default' | 'normal' (delivery soon) | 'high' (immediate). */
  priority?: "default" | "normal" | "high"
}

/**
 * Shape a PushMessage into the JSON body Expo's batch endpoint expects.
 * Returns the message exactly as it should appear inside the request
 * array. Expo's API accepts either a single object or an array of up
 * to 100; the route in expo-push.ts wraps + chunks.
 */
export function toExpoPayload(msg: PushMessage): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    to: msg.to,
    title: msg.title.slice(0, 100),
    body: msg.body.slice(0, 240),
    sound: "default",
  }
  if (msg.data && Object.keys(msg.data).length > 0) {
    payload.data = msg.data
  }
  if (msg.priority) payload.priority = msg.priority
  return payload
}

export function chunkTokens<T>(items: T[], size = 100): T[][] {
  if (size <= 0) return [items]
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}
