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
 * Fan out a push to every device the user has registered. Silent no-op
 * when the user has no registered tokens. Never throws.
 */
export async function notifyPush(
  userId: string,
  notification: PushNotification,
): Promise<NotifyResult> {
  try {
    const supabase = createAdminClient()
    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("token, provider")
      .eq("user_id", userId)

    if (!tokens || tokens.length === 0) {
      return { sent: false, skipped: "no devices registered" }
    }

    // For v1 we only address Expo tokens; web push has a different
    // delivery layer (VAPID) and lands when the PWA wrapper does.
    const expoTokens = tokens.filter((t) => t.provider === "expo")
    if (expoTokens.length === 0) {
      return { sent: false, skipped: "no expo tokens" }
    }

    const messages: PushMessage[] = expoTokens.map((t) => ({
      to: t.token as string,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      priority: notification.priority,
    }))

    const res = await sendPush(messages)
    return { sent: res.accepted > 0, mock: res.mock }
  } catch {
    return { sent: false, skipped: "notify failed" }
  }
}
