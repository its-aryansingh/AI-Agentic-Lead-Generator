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

Return the single best category, a confidence 0-1, and one-sentence reasoning. Be conservative: only "interested" if they genuinely signal wanting to engage.`

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

function mockClassify(body: string): ReplyClassification {
  const t = body.toLowerCase()
  if (/unsubscribe|remove me|stop emailing|take me off|do not contact/.test(t)) {
    return { category: "unsubscribe", confidence: 0.95, reasoning: "Explicit removal request (mock)." }
  }
  if (/out of office|on vacation|away until|automatic reply|auto-reply/.test(t)) {
    return { category: "out_of_office", confidence: 0.95, reasoning: "Automated away message (mock)." }
  }
  if (/not interested|no thanks|we're good|pass\b|not a fit/.test(t)) {
    return { category: "not_interested", confidence: 0.8, reasoning: "Clear decline (mock)." }
  }
  if (/how much|pricing|price|cost|how does it work|tell me more|what is|can you/.test(t)) {
    return { category: "question", confidence: 0.75, reasoning: "Asking for info (mock)." }
  }
  if (/interested|let's talk|book|call|demo|sounds good|keen|happy to chat/.test(t)) {
    return { category: "interested", confidence: 0.8, reasoning: "Positive engagement signal (mock)." }
  }
  if (/already use|bad timing|not the right|wrong person|busy right now/.test(t)) {
    return { category: "objection", confidence: 0.7, reasoning: "Engaged pushback (mock)." }
  }
  return { category: "other", confidence: 0.4, reasoning: "No clear signal (mock)." }
}
