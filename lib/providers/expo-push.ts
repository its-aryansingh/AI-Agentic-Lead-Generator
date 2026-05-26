/**
 * Expo Push provider — fan-out alerts to mobile devices via Expo's
 * push service. Read by future hot-reply / automation-completion
 * paths once the mobile client lands (Phase 6 implementation).
 *
 * Auth: Expo's basic push endpoint is open (rate-limited by token
 * ownership), but a project-level access token unlocks higher rate
 * limits and delivery receipts. We read it from EXPO_PUSH_ACCESS_TOKEN
 * when set; mock cleanly when unset (matching every other provider).
 *
 * API reference: https://docs.expo.dev/push-notifications/sending-notifications/
 *   POST https://exp.host/--/api/v2/push/send
 *   Body: PushMessage | PushMessage[]   (up to 100 per batch)
 */

import {
  chunkTokens,
  toExpoPayload,
  type PushMessage,
} from "@/lib/providers/expo-push-core"

const API_URL = "https://exp.host/--/api/v2/push/send"
const REQUEST_TIMEOUT_MS = 12_000

export interface PushDelivery {
  /** Total messages attempted (one per recipient token). */
  attempted: number
  /** Messages Expo accepted (no transport error). */
  accepted: number
  /** Per-message tickets from Expo, in input order. */
  tickets: PushTicket[]
  mock: boolean
  error?: string
}

export interface PushTicket {
  status: "ok" | "error"
  id?: string
  message?: string
  details?: Record<string, unknown>
}

export function isExpoPushConfigured(): boolean {
  // The endpoint itself works without a token, but operationally we
  // treat "no token" as mock mode so dev environments don't hit a
  // public-but-rate-limited endpoint unintentionally.
  return Boolean(process.env.EXPO_PUSH_ACCESS_TOKEN)
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" }
  const tok = process.env.EXPO_PUSH_ACCESS_TOKEN
  if (tok) h.Authorization = `Bearer ${tok}`
  return h
}

export async function sendPush(messages: PushMessage[]): Promise<PushDelivery> {
  const attempted = messages.length
  if (attempted === 0) {
    return { attempted: 0, accepted: 0, tickets: [], mock: false }
  }

  if (!isExpoPushConfigured()) {
    return {
      attempted,
      accepted: attempted,
      tickets: messages.map((m, i) => ({
        status: "ok",
        id: `mock-push-${Date.now().toString(36)}-${i}`,
        details: { mock: true, to: m.to },
      })),
      mock: true,
    }
  }

  const tickets: PushTicket[] = []
  let accepted = 0
  let firstError: string | undefined

  for (const batch of chunkTokens(messages, 100)) {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(batch.map(toExpoPayload)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const json = (await res.json().catch(() => ({}))) as {
        data?: PushTicket[]
        errors?: Array<{ message?: string }>
      }
      if (!res.ok) {
        const msg = json.errors?.[0]?.message ?? `Expo Push ${res.status}`
        if (!firstError) firstError = msg
        for (const _ of batch) {
          tickets.push({ status: "error", message: msg })
        }
        continue
      }
      const batchTickets = json.data ?? []
      for (let i = 0; i < batch.length; i++) {
        const t = batchTickets[i] ?? { status: "ok" }
        tickets.push(t)
        if (t.status === "ok") accepted++
      }
    } catch (err) {
      const msg = (err as Error).message
      if (!firstError) firstError = msg
      for (const _ of batch) {
        tickets.push({ status: "error", message: msg })
      }
    }
  }

  return { attempted, accepted, tickets, mock: false, error: firstError }
}
