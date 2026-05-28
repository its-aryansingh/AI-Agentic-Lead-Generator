/**
 * User notifications — multi-channel alerts for key events
 * (automation finished, hot reply). Each channel is opt-in and
 * mock-safe; nothing here ever throws into a cron/agent path.
 *
 * Channels:
 *  - notifyWhatsApp: users.whatsapp_number + users.notify_whatsapp gate
 *  - notifyPush:     all rows in public.push_tokens for the user
 */

import { createAdminClient } from "@/lib/supabase/server"
import { sendWhatsApp } from "@/lib/providers/whatsapp"
import { sendPush } from "@/lib/providers/expo-push"
import type { PushMessage } from "@/lib/providers/expo-push-core"
import { sendWebPush, isGoneStatus } from "@/lib/providers/web-push"
import { parseSubscriptionJson } from "@/lib/providers/web-push-core"

export interface NotifyResult {
  sent: boolean
  mock?: boolean
  skipped?: string
}

export async function notifyWhatsApp(userId: string, text: string): Promise<NotifyResult> {
  try {
    const supabase = createAdminClient()
    const { data: u } = await supabase
      .from("users")
      .select("whatsapp_number, notify_whatsapp")
      .eq("id", userId)
      .maybeSingle()

    const number = (u?.whatsapp_number as string | null) ?? null
    const enabled = Boolean(u?.notify_whatsapp)
    if (!enabled || !number) return { sent: false, skipped: "alerts off or no number" }

    const res = await sendWhatsApp({ to: number, text })
    return { sent: !res.error, mock: res.mock }
  } catch {
    return { sent: false, skipped: "notify failed" }
  }
}

export interface PushNotification {
  title: string
  body: string
  data?: Record<string, unknown>
  priority?: "default" | "normal" | "high"
}

/**
 * Fan out a push to every device the user has registered, across all
 * providers (Expo for native, Web Push for browsers / extension).
 * Dead web subscriptions (404/410 GONE from the push service) are
 * pruned from push_tokens so the next call doesn't retry them.
 * Silent no-op when the user has no registered tokens. Never throws.
 */
export async function notifyPush(
  userId: string,
  notification: PushNotification,
): Promise<NotifyResult> {
  try {
    const supabase = createAdminClient()
    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("id, token, provider")
      .eq("user_id", userId)

    if (!tokens || tokens.length === 0) {
      return { sent: false, skipped: "no devices registered" }
    }

    let anySent = false
    let anyMock = false
    const goneIds: string[] = []

    // Expo (native) — batch one sendPush call.
    const expoTokens = tokens.filter((t) => t.provider === "expo")
    if (expoTokens.length > 0) {
      const messages: PushMessage[] = expoTokens.map((t) => ({
        to: t.token as string,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        priority: notification.priority,
      }))
      const res = await sendPush(messages)
      if (res.accepted > 0) anySent = true
      if (res.mock) anyMock = true
    }

    // Web Push — one fetch per subscription; the protocol doesn't
    // support batching. Run in parallel to keep latency bounded.
    const webTokens = tokens.filter((t) => t.provider === "web")
    if (webTokens.length > 0) {
      const results = await Promise.all(
        webTokens.map(async (t) => {
          const sub = parseSubscriptionJson(t.token as string)
          if (!sub) return { id: t.id as string, status: 400 }
          const res = await sendWebPush(sub, {
            title: notification.title,
            body: notification.body,
            data: notification.data,
          })
          if (res.sent) anySent = true
          if (res.mock) anyMock = true
          return { id: t.id as string, status: res.status }
        }),
      )
      for (const r of results) if (isGoneStatus(r.status)) goneIds.push(r.id)
    }

    // Prune dead subscriptions in one round-trip.
    if (goneIds.length > 0) {
      await supabase.from("push_tokens").delete().in("id", goneIds)
    }

    return { sent: anySent, mock: anyMock }
  } catch {
    return { sent: false, skipped: "notify failed" }
  }
}
