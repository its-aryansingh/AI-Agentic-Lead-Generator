/**
 * Slack provider — POST a message to a per-user Incoming Webhook URL.
 * Used as a third notification channel alongside WhatsApp + push.
 *
 * Setup: user creates a Slack app in their workspace, enables
 * Incoming Webhooks, copies the URL into /app/settings/notifications.
 * No app-level OAuth, no shared bot — every user's webhook is
 * independent.
 *
 * Mock fallback: when the webhook URL is missing or malformed we
 * return a deterministic mock id so the calling notification path
 * never throws. The same notify-paths run identically with or without
 * Slack configured for any given user.
 */

import {
  clampSlackText,
  isValidSlackWebhookUrl,
  toSlackPayload,
  type SlackMessage,
} from "@/lib/providers/slack-core"

const REQUEST_TIMEOUT_MS = 8_000

export interface SlackResult {
  sent: boolean
  mock: boolean
  status?: number
  error?: string
}

export async function sendSlack(
  webhookUrl: string | null | undefined,
  message: SlackMessage,
): Promise<SlackResult> {
  if (!isValidSlackWebhookUrl(webhookUrl)) {
    return {
      sent: true,
      mock: true,
      status: 200,
      error: webhookUrl ? "invalid webhook URL — mock" : undefined,
    }
  }

  const payload = toSlackPayload({
    ...message,
    text: clampSlackText(message.text),
  })

  try {
    const res = await fetch(webhookUrl as string, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      return {
        sent: false,
        mock: false,
        status: res.status,
        error: `Slack ${res.status}: ${await res.text().catch(() => "")}`,
      }
    }
    return { sent: true, mock: false, status: res.status }
  } catch (err) {
    return { sent: false, mock: false, error: (err as Error).message }
  }
}
