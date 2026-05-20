/**
 * Gmail provider — send + read for the campaign send-leg.
 *
 * Uses googleapis with the mailbox's stored refresh token. Sending and
 * reply-reading are the only two operations the workflow needs.
 *
 * Mock fallback: when GOOGLE_CLIENT_ID is missing OR the refresh token
 * is the sentinel "mock", we simulate a successful send (returning fake
 * message/thread IDs) so the whole pipeline can be exercised in dev
 * without connecting a real inbox.
 */

import { google } from "googleapis"

function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

function oauthClient(refreshToken: string) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI ??
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/mailbox/callback`,
  )
  client.setCredentials({ refresh_token: refreshToken })
  return client
}

/** RFC 2822 message builder, base64url-encoded for the Gmail API. */
function buildRawMessage(opts: {
  to: string
  from: string
  subject: string
  body: string
}): string {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    opts.body,
  ]
  const raw = lines.join("\r\n")
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

export interface SendResult {
  messageId: string
  threadId: string
  mock: boolean
}

export async function sendGmail(opts: {
  refreshToken: string
  from: string
  to: string
  subject: string
  body: string
}): Promise<SendResult> {
  if (!googleConfigured() || opts.refreshToken === "mock") {
    // Simulated send — deterministic-ish fake IDs.
    const id = `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    return { messageId: id, threadId: id, mock: true }
  }

  const auth = oauthClient(opts.refreshToken)
  const gmail = google.gmail({ version: "v1", auth })
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: buildRawMessage({
        to: opts.to,
        from: opts.from,
        subject: opts.subject,
        body: opts.body,
      }),
    },
  })
  return {
    messageId: res.data.id!,
    threadId: res.data.threadId!,
    mock: false,
  }
}

export interface InboundMessage {
  id: string
  threadId: string
  from: string
  snippet: string
  inReplyToThread: string
  isBounce: boolean
  isAutoReply: boolean
}

/**
 * Fetch recent inbound messages for reply detection. Returns the most
 * recent messages in the inbox; the caller matches threadId against
 * sent recipients. Mock returns an empty list (nothing to detect).
 */
export async function listRecentInbound(opts: {
  refreshToken: string
  maxResults?: number
}): Promise<InboundMessage[]> {
  if (!googleConfigured() || opts.refreshToken === "mock") return []

  const auth = oauthClient(opts.refreshToken)
  const gmail = google.gmail({ version: "v1", auth })
  const list = await gmail.users.messages.list({
    userId: "me",
    q: "in:inbox newer_than:2d",
    maxResults: opts.maxResults ?? 25,
  })
  const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean)

  const out: InboundMessage[] = []
  for (const id of ids) {
    try {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "In-Reply-To", "References"],
      })
      const headers = msg.data.payload?.headers ?? []
      const get = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ""
      const from = get("From")
      const snippet = msg.data.snippet ?? ""
      out.push({
        id,
        threadId: msg.data.threadId ?? "",
        from,
        snippet,
        inReplyToThread: msg.data.threadId ?? "",
        isBounce:
          /mailer-daemon|postmaster|delivery status notification/i.test(from) ||
          /delivery has failed|undeliverable|address not found/i.test(snippet),
        isAutoReply:
          /out of office|on vacation|i am away|auto-reply|automatic reply|autoreply/i.test(
            snippet,
          ),
      })
    } catch {
      // skip messages we can't read
    }
  }
  return out
}

/**
 * Build the Google consent URL for connecting a sending mailbox.
 * Requests gmail.send + gmail.readonly so we can send and detect replies.
 */
export function mailboxConsentUrl(state: string): string | null {
  if (!googleConfigured()) return null
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI ??
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/mailbox/callback`,
  )
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    state,
  })
}

/** Exchange an auth code for tokens + the connected address. */
export async function exchangeMailboxCode(
  code: string,
): Promise<{ email: string; refreshToken: string } | null> {
  if (!googleConfigured()) return null
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI ??
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/mailbox/callback`,
  )
  const { tokens } = await client.getToken(code)
  if (!tokens.refresh_token) return null
  client.setCredentials(tokens)

  const oauth2 = google.oauth2({ version: "v2", auth: client })
  const me = await oauth2.userinfo.get()
  return {
    email: me.data.email ?? "",
    refreshToken: tokens.refresh_token,
  }
}

/**
 * The warm-up curve. A brand-new mailbox sending 50 cold emails on day
 * one lands in spam. Cap ramps over the first two weeks.
 */
export function warmupCap(warmupStartedAt: Date): number {
  const days = Math.floor(
    (Date.now() - warmupStartedAt.getTime()) / 86_400_000,
  )
  if (days <= 3) return 10
  if (days <= 7) return 20
  if (days <= 14) return 35
  return 50
}
