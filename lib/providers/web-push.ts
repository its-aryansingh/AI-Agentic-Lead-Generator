/**
 * Web Push (VAPID) — server-side push to a browser's service worker.
 * Wraps the `web-push` npm package with our standard mock-fallback +
 * surface-matches-other-push-providers conventions.
 *
 * Required env:
 *   VAPID_PUBLIC_KEY     — base64url, P-256 uncompressed (~87 chars)
 *   VAPID_PRIVATE_KEY    — base64url, 32 bytes (~43 chars)
 *   VAPID_SUBJECT        — mailto:you@domain OR https://your.site
 *
 * Generate the keypair once with:
 *   npx web-push generate-vapid-keys
 *
 * Mock fallback: when any of the three env vars is unset, every push
 * returns a deterministic mock result so dev flows work key-free.
 */

import webpush from "web-push"

import {
  isValidWebPushSubscription,
  isVapidConfigured,
  type VapidEnv,
  type WebPushSubscription,
} from "@/lib/providers/web-push-core"

export interface WebPushResult {
  sent: boolean
  mock: boolean
  status?: number
  error?: string
}

function readEnv(): VapidEnv {
  return {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT,
  }
}

export function isWebPushConfigured(): boolean {
  return isVapidConfigured(readEnv())
}

/**
 * Read the VAPID public key for client-side `PushManager.subscribe()`.
 * Safe to expose — the public key is meant for browsers.
 */
export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null
}

let detailsConfigured = false
function configureWebPushOnce(env: VapidEnv): void {
  if (detailsConfigured) return
  if (!isVapidConfigured(env)) return
  webpush.setVapidDetails(env.subject!, env.publicKey!, env.privateKey!)
  detailsConfigured = true
}

export interface WebPushPayload {
  title: string
  body: string
  data?: Record<string, unknown>
}

export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: WebPushPayload,
): Promise<WebPushResult> {
  if (!isValidWebPushSubscription(subscription)) {
    return { sent: false, mock: false, error: "invalid subscription" }
  }

  const env = readEnv()
  if (!isVapidConfigured(env)) {
    // Mock path — pretend we delivered so the calling flow doesn't
    // hard-fail in dev / demo.
    return { sent: true, mock: true, status: 201 }
  }

  configureWebPushOnce(env)

  try {
    const res = await webpush.sendNotification(
      subscription as unknown as webpush.PushSubscription,
      JSON.stringify({
        title: payload.title.slice(0, 100),
        body: payload.body.slice(0, 240),
        data: payload.data ?? {},
      }),
      { TTL: 60 * 60 }, // 1h — drop on the floor after that
    )
    return { sent: true, mock: false, status: res.statusCode }
  } catch (err) {
    const e = err as { statusCode?: number; message?: string; body?: unknown }
    return {
      sent: false,
      mock: false,
      status: e.statusCode,
      error: e.message ?? String(err),
    }
  }
}

/**
 * `web-push` exposes a static helper for VAPID key generation. We
 * expose a thin wrapper so an admin / CLI surface can call it without
 * pulling the dep directly. Returns base64url strings.
 */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys()
}

/** Web Push status codes that indicate the subscription is dead. */
export const GONE_STATUS_CODES: ReadonlySet<number> = new Set([404, 410])

export function isGoneStatus(status: number | undefined): boolean {
  return typeof status === "number" && GONE_STATUS_CODES.has(status)
}
