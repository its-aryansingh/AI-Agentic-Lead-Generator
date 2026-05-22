/**
 * WhatsApp provider — outbound messages via a BSP (Gupshup / Twilio /
 * Interakt / Meta Cloud API). WhatsApp is the highest-response B2B channel
 * in India/SEA, so it's a first-class outreach + alerting surface here.
 *
 * BSP-agnostic: a single HTTP POST configured by env —
 *   WHATSAPP_API_URL   — BSP send endpoint
 *   WHATSAPP_API_KEY   — bearer token / API key
 *   WHATSAPP_FROM      — sender phone-number id / channel id
 *
 * Mock fallback: when those are unset (or the recipient is the sentinel
 * "mock") we simulate a successful send with a deterministic-ish id, so the
 * whole flow works without a BSP account — matching every other provider.
 *
 * Note on policy: business-INITIATED WhatsApp messages must use a
 * pre-approved template (sendWhatsAppTemplate). Free-form sendWhatsApp is
 * valid only inside the 24h customer-service window (e.g. replies). The
 * caller decides which to use; both mock cleanly.
 */

export function whatsappConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_API_URL &&
      process.env.WHATSAPP_API_KEY &&
      process.env.WHATSAPP_FROM,
  )
}

export interface WhatsAppResult {
  messageId: string
  mock: boolean
  error?: string
}

function mockId(): string {
  return `wamid.mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Normalise a phone number to digits + leading country code (no +, spaces, dashes). */
export function normalizeWhatsAppNumber(raw: string): string {
  return raw.replace(/[^\d]/g, "")
}

async function postToBsp(payload: Record<string, unknown>): Promise<WhatsAppResult> {
  try {
    const res = await fetch(process.env.WHATSAPP_API_URL as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) {
      return { messageId: "", mock: false, error: `WhatsApp BSP ${res.status}` }
    }
    const json = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>
      id?: string
    }
    const id = json.messages?.[0]?.id ?? json.id ?? `wa-${Date.now().toString(36)}`
    return { messageId: id, mock: false }
  } catch (err) {
    return {
      messageId: "",
      mock: false,
      error: err instanceof Error ? err.message : "WhatsApp send failed",
    }
  }
}

/**
 * Free-form text message (valid inside the 24h reply window — e.g. replies
 * and alert notifications to the user's own number).
 */
export async function sendWhatsApp(opts: {
  to: string
  text: string
}): Promise<WhatsAppResult> {
  const to = normalizeWhatsAppNumber(opts.to)
  if (!whatsappConfigured() || !to || opts.to === "mock") {
    return { messageId: mockId(), mock: true }
  }
  return postToBsp({
    messaging_product: "whatsapp",
    from: process.env.WHATSAPP_FROM,
    to,
    type: "text",
    text: { body: opts.text },
  })
}

/**
 * Template message — required for business-initiated outreach (cold first
 * touch). `params` fill the template's {{1}}, {{2}}, … placeholders.
 */
export async function sendWhatsAppTemplate(opts: {
  to: string
  template: string
  params?: string[]
  languageCode?: string
}): Promise<WhatsAppResult> {
  const to = normalizeWhatsAppNumber(opts.to)
  if (!whatsappConfigured() || !to || opts.to === "mock") {
    return { messageId: mockId(), mock: true }
  }
  return postToBsp({
    messaging_product: "whatsapp",
    from: process.env.WHATSAPP_FROM,
    to,
    type: "template",
    template: {
      name: opts.template,
      language: { code: opts.languageCode ?? "en" },
      components: opts.params?.length
        ? [
            {
              type: "body",
              parameters: opts.params.map((text) => ({ type: "text", text })),
            },
          ]
        : [],
    },
  })
}
