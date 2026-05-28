/**
 * Reply classification.
 *
 * When a prospect replies, we classify the message so the system knows
 * what to do: auto-suppress unsubscribes, route interested/question
 * replies to the human inbox, and silently log not-interested ones.
 *
 * Real path uses Claude Haiku (cheap, fast — classification doesn't need
 * Sonnet). Mock path uses keyword heuristics so the pipeline works with
 * no API key.
 */

import { anthropic } from "@ai-sdk/anthropic"
import { generateObject } from "ai"
import { z } from "zod"

function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export const ReplyCategory = z.enum([
  "interested",
  "question",
  "objection",
  "out_of_office",
  "unsubscribe",
  "not_interested",
  "other",
])
export type ReplyCategoryType = z.infer<typeof ReplyCategory>

const ClassificationSchema = z.object({
  category: ReplyCategory,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  /**
   * Whether the reply contains a meeting / calendar request. Decoupled
   * from category because someone can be `interested` without yet
   * asking for a slot, or `objection` while still offering to talk.
   * Drives "Book a meeting" CTA in the Inbox + push payload.
   */
  wants_meeting: z.boolean().default(false),
})
export type ReplyClassification = z.infer<typeof ClassificationSchema>

/** Which categories a human should look at vs. auto-handle. */
export function needsHuman(category: ReplyCategoryType): boolean {
  return (
    category === "interested" ||
    category === "question" ||
    category === "objection"
  )
}

const SYSTEM = `You classify replies to cold sales emails into exactly one category:

- interested: positive, wants to talk / learn more / book a call
- question: asking for info before deciding (pricing, how it works, etc)
- objection: pushback that's still a conversation (bad timing, using competitor, not the right person but engaged)
- out_of_office: automated away/vacation message
- unsubscribe: explicit request to stop / remove / not contact again
- not_interested: clear no, but not an unsubscribe request
- other: anything that doesn't fit (spam, gibberish, forwarded internally)

You ALSO emit a separate boolean wants_meeting — true if the reply concretely proposes / asks for a call, demo, meeting, calendar slot, or specific time. This is independent of category — an "interested" reply often wants a meeting, but so can an "objection" ("happy to discuss on a 15-min call"). Conservative: only true if the booking intent is explicit.

Return: category, confidence 0-1, one-sentence reasoning, wants_meeting.`

export async function classifyReply(opts: {
  subject?: string
  body: string
}): Promise<ReplyClassification> {
  if (!hasAnthropicKey()) {
    return mockClassify(opts.body)
  }

  const { object } = await generateObject({
    model: anthropic("claude-haiku-4-5-20251001"),
    schema: ClassificationSchema,
    system: SYSTEM,
    prompt: [
      opts.subject ? `Subject: ${opts.subject}` : "",
      `Reply body:\n${opts.body}`,
    ]
      .filter(Boolean)
      .join("\n"),
  })
  return object
}

/**
 * Keyword heuristic for booking intent. Conservative — better to miss
 * than to false-positive. Same signal the real LLM path emits via
 * wants_meeting; we share it so mock and real outputs are comparable.
 */
export function detectsBookingIntent(body: string): boolean {
  if (!body) return false
  const t = body.toLowerCase()
  return /\b(calendar|calendly|cal\.com|book.{0,15}meeting|book.{0,15}call|schedule.{0,15}(call|meeting|chat)|set.{0,15}up.{0,15}(call|meeting|chat)|when.{0,15}(are|you).{0,15}free|hop.{0,15}on.{0,15}call|jump.{0,15}on.{0,15}call|quick.{0,15}call|\b(15|20|30|45)\s*-?\s*min\b|monday|tuesday|wednesday|thursday|friday|next\s+week)\b/.test(t)
}

function mockClassify(body: string): ReplyClassification {
  const t = body.toLowerCase()
  const wants_meeting = detectsBookingIntent(body)
  if (/unsubscribe|remove me|stop emailing|take me off|do not contact/.test(t)) {
    return { category: "unsubscribe", confidence: 0.95, reasoning: "Explicit removal request (mock).", wants_meeting: false }
  }
  if (/out of office|on vacation|away until|automatic reply|auto-reply/.test(t)) {
    return { category: "out_of_office", confidence: 0.95, reasoning: "Automated away message (mock).", wants_meeting: false }
  }
  if (/not interested|no thanks|we're good|pass\b|not a fit/.test(t)) {
    return { category: "not_interested", confidence: 0.8, reasoning: "Clear decline (mock).", wants_meeting: false }
  }
  if (/interested|let's talk|book|call|demo|sounds good|keen|happy to chat/.test(t)) {
    return { category: "interested", confidence: 0.8, reasoning: "Positive engagement signal (mock).", wants_meeting }
  }
  if (/how much|pricing|price|cost|how does it work|tell me more|what is|can you/.test(t)) {
    return { category: "question", confidence: 0.75, reasoning: "Asking for info (mock).", wants_meeting }
  }
  if (/already use|bad timing|not the right|wrong person|busy right now/.test(t)) {
    return { category: "objection", confidence: 0.7, reasoning: "Engaged pushback (mock).", wants_meeting }
  }
  return { category: "other", confidence: 0.4, reasoning: "No clear signal (mock).", wants_meeting }
}
