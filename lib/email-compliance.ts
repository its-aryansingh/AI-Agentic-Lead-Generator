/**
 * Email compliance — non-negotiable for any cold-outbound product.
 *
 * Every sent email MUST carry: a working one-click unsubscribe link, a
 * physical sender address (CAN-SPAM), and an honest from/subject. This
 * module owns the unsubscribe token scheme + footer injection +
 * suppression checks.
 *
 * Token = base64url(recipientId.userId).hmac — verifiable without a DB
 * lookup, and the handler suppresses by user+email so an unsub from any
 * campaign suppresses globally for that sender.
 */

import crypto from "node:crypto"

function secret(): string {
  return process.env.UNSUB_SECRET ?? "dev-unsub-secret"
}

export function sha256Email(email: string): string {
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex")
}

export function makeUnsubToken(recipientId: string, userId: string): string {
  const payload = Buffer.from(`${recipientId}.${userId}`).toString("base64url")
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url")
  return `${payload}.${sig}`
}

export function verifyUnsubToken(
  token: string,
): { recipientId: string; userId: string } | null {
  const [payload, sig] = token.split(".")
  if (!payload || !sig) return null
  const expected = crypto
    .createHmac("sha256", secret())
    .update(payload)
    .digest("base64url")
  // Constant-time comparison.
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null
  }
  const decoded = Buffer.from(payload, "base64url").toString("utf-8")
  const [recipientId, userId] = decoded.split(".")
  if (!recipientId || !userId) return null
  return { recipientId, userId }
}

/**
 * Append the legally-required footer to an email body.
 * physicalAddress is captured at mailbox-connection time.
 */
export function appendComplianceFooter(opts: {
  body: string
  unsubToken: string
  physicalAddress?: string | null
  appUrl: string
}): string {
  const unsubUrl = `${opts.appUrl}/u/${opts.unsubToken}`
  const addr = opts.physicalAddress?.trim()
  const footerLines = [
    "",
    "—",
    `Don't want these emails? Unsubscribe: ${unsubUrl}`,
  ]
  if (addr) footerLines.push(addr)
  return `${opts.body}\n${footerLines.join("\n")}`
}
