/**
 * Pure helpers shared by the /api/webhooks/whatsapp route — kept import-
 * free so `node --test --experimental-strip-types` can load them directly
 * (no "@/" alias support outside Next.js).
 *
 * Mirrors the orchestration-core split. The route layers DB writes,
 * signature verification, and idempotency on top of these.
 */

const OPT_OUT_KEYWORDS = new Set([
  "stop",
  "unsubscribe",
  "optout",
  "opt-out",
  "opt out",
  "cancel",
  "end",
  "quit",
])

export interface WhatsAppInboundMessage {
  id: string
  from: string
  text: string
}

export interface WhatsAppStatus {
  id: string
  status: string
  recipient_id?: string
  reason?: string
}

export interface NormalizedWhatsAppEvent {
  messages: WhatsAppInboundMessage[]
  statuses: WhatsAppStatus[]
}

export function isOptOutText(text: string): boolean {
  const trimmed = text.trim().toLowerCase()
  if (!trimmed) return false
  if (OPT_OUT_KEYWORDS.has(trimmed)) return true
  // Match the keyword as the FIRST word of the message, ignoring trailing
  // punctuation ("STOP." / "STOP please") — common opt-out forms.
  const firstToken = trimmed.split(/[\s\W]+/)[0] ?? ""
  return OPT_OUT_KEYWORDS.has(firstToken)
}

/**
 * Coerce a BSP payload into a uniform shape. Supports the Meta Cloud API
 * envelope (entry[].changes[].value.{messages,statuses}) AND a flat
 * {messages,statuses} shape for simpler relays.
 */
export function normalizeWhatsAppPayload(raw: unknown): NormalizedWhatsAppEvent {
  const messages: WhatsAppInboundMessage[] = []
  const statuses: WhatsAppStatus[] = []
  if (!raw || typeof raw !== "object") return { messages, statuses }

  const r = raw as Record<string, unknown>
  const candidates: unknown[] = []

  const entries = Array.isArray(r.entry) ? r.entry : []
  for (const entry of entries) {
    const changes = Array.isArray((entry as Record<string, unknown>)?.changes)
      ? ((entry as Record<string, unknown>).changes as unknown[])
      : []
    for (const c of changes) {
      const value = (c as Record<string, unknown>)?.value
      if (value && typeof value === "object") candidates.push(value)
    }
  }
  candidates.push(r)

  for (const v of candidates) {
    const obj = v as Record<string, unknown>
    const msgs = Array.isArray(obj.messages) ? obj.messages : []
    for (const m of msgs) {
      const mm = m as Record<string, unknown>
      const id = typeof mm.id === "string" ? mm.id : ""
      const from = typeof mm.from === "string" ? mm.from : ""
      let text = ""
      if (typeof mm.text === "string") text = mm.text
      else if (
        mm.text &&
        typeof mm.text === "object" &&
        typeof (mm.text as Record<string, unknown>).body === "string"
      ) {
        text = (mm.text as Record<string, unknown>).body as string
      } else if (typeof mm.body === "string") {
        text = mm.body
      }
      if (id && from) messages.push({ id, from, text })
    }
    const sts = Array.isArray(obj.statuses) ? obj.statuses : []
    for (const s of sts) {
      const ss = s as Record<string, unknown>
      const id = typeof ss.id === "string" ? ss.id : ""
      const status = typeof ss.status === "string" ? ss.status : ""
      const recipient_id =
        typeof ss.recipient_id === "string" ? ss.recipient_id : undefined
      let reason: string | undefined
      if (typeof ss.reason === "string") {
        reason = ss.reason
      } else if (Array.isArray(ss.errors) && ss.errors[0]) {
        reason = JSON.stringify(ss.errors[0])
      }
      if (id && status) statuses.push({ id, status, recipient_id, reason })
    }
  }

  const seenMsg = new Set<string>()
  const dedupedMessages = messages.filter((m) => {
    if (seenMsg.has(m.id)) return false
    seenMsg.add(m.id)
    return true
  })
  const seenSt = new Set<string>()
  const dedupedStatuses = statuses.filter((s) => {
    const k = `${s.id}:${s.status}`
    if (seenSt.has(k)) return false
    seenSt.add(k)
    return true
  })

  return { messages: dedupedMessages, statuses: dedupedStatuses }
}
