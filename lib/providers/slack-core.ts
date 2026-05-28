/**
 * Slack provider — pure helpers. Import-free so
 * `node --test --experimental-strip-types` can load them.
 *
 * We use the simplest Slack integration: per-user Incoming Webhooks.
 * Each user pastes a webhook URL from their Slack workspace; we POST
 * a `{text, blocks?}` payload to it. No OAuth, no app installation,
 * no bot tokens. Trades richness for setup simplicity.
 */

const SLACK_WEBHOOK_HOST_RE = /^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+$/

/**
 * Validate that a string looks like a Slack incoming webhook URL.
 * The shape is `https://hooks.slack.com/services/T.../B.../<token>`.
 * Conservative — false matches are far worse than false rejects here
 * (a wrong URL means notifications silently land somewhere weird).
 */
export function isValidSlackWebhookUrl(url: string | null | undefined): boolean {
  if (typeof url !== "string") return false
  const trimmed = url.trim()
  if (trimmed.length === 0 || trimmed.length > 512) return false
  return SLACK_WEBHOOK_HOST_RE.test(trimmed)
}

export interface SlackMessage {
  /** Plain text — required, used as the fallback for notifications. */
  text: string
  /** Optional emoji prefix on Slack's side; we set on `text` directly. */
  emoji?: string
  /** Optional URL the user can click to jump to the relevant app page. */
  link?: { url: string; label: string }
}

export interface SlackPayload {
  text: string
  blocks?: unknown[]
}

/**
 * Shape a SlackMessage into the JSON body Slack's webhook expects.
 * Always sets `text` (used by mobile notifications + screen-reader
 * fallback), and emits a Block Kit section for richer in-app rendering
 * when a link is provided.
 */
export function toSlackPayload(msg: SlackMessage): SlackPayload {
  const emoji = msg.emoji ? msg.emoji.trim() + " " : ""
  const text = emoji + msg.text
  const payload: SlackPayload = { text }

  if (msg.link) {
    payload.blocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: msg.link.label.slice(0, 75) },
            url: msg.link.url,
            style: "primary",
          },
        ],
      },
    ]
  }
  return payload
}

/**
 * Truncate Slack message text. Webhook accepts up to 40k chars but
 * notifications + display look terrible past ~1k. Clamp to a sensible
 * preview length.
 */
export function clampSlackText(text: string, max = 800): string {
  const trimmed = text.replace(/\s+/g, " ").trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1) + "…"
}
