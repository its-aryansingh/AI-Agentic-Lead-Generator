/**
 * Anthropic provider — thin wrappers around @ai-sdk/anthropic.
 *
 * The chat route uses `getChatModel()`; individual enrichment helpers
 * use `getResearchModel()` (cheaper Haiku) for summaries and
 * `getEmailModel()` (Sonnet) for the customer-facing draft.
 *
 * When ANTHROPIC_API_KEY isn't set the helpers fall back to deterministic
 * mock outputs so the whole pipeline can be demoed offline.
 */

import { anthropic } from "@ai-sdk/anthropic"
import { generateObject } from "ai"
import { z } from "zod"

import type { ProspectCandidate } from "./brave-search"

// Inlined `hasKey` — duplicated from lib/utils so this file has no
// path-alias imports and is loadable directly by Node's test runner
// for the eval harness. (Node doesn't honor tsconfig path aliases.)
function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export const MODEL_CHAT = "claude-sonnet-4-6"
export const MODEL_RESEARCH = "claude-haiku-4-5-20251001"
export const MODEL_EMAIL = "claude-sonnet-4-6"

export function getChatModel() {
  return anthropic(MODEL_CHAT)
}

export const DraftSchema = z.object({
  research_summary: z
    .string()
    .describe("2-3 sentence factual summary of who this person is and what their company does. No fluff."),
  email_subject: z
    .string()
    .max(60)
    .describe("Cold email subject line. <50 chars ideal. No clickbait, no fake re: or fwd:."),
  email_body: z
    .string()
    .describe(
      "Cold email body. ≤60 words, single paragraph. Opens with a SPECIFIC observation about THIS prospect (not 'I noticed you'). Ends with one concrete question or CTA.",
    ),
  talking_points: z
    .array(z.string())
    .length(3)
    .describe("Three concrete conversation starters for a follow-up call or LinkedIn DM."),
})
export type EnrichedDraft = z.infer<typeof DraftSchema>

/**
 * Generate a full research+email+talking-points draft for one prospect.
 * Falls back to a believable mock when no API key is configured.
 */
export async function draftForProspect(opts: {
  prospect: ProspectCandidate
  voiceAnchor?: string | null
  news?: string | null
}): Promise<EnrichedDraft> {
  const { prospect, voiceAnchor, news } = opts

  if (!hasAnthropicKey()) {
    return mockDraft(prospect)
  }

  const { object } = await generateObject({
    model: anthropic(MODEL_EMAIL),
    schema: DraftSchema,
    system: SYSTEM_PROMPT_EMAIL,
    prompt: [
      `Prospect: ${prospect.name}, ${prospect.title} at ${prospect.company}.`,
      prospect.location ? `Location: ${prospect.location}.` : "",
      `Search snippet: ${prospect.snippet}`,
      news ? `Recent company news: ${news}` : "",
      voiceAnchor
        ? `Match this user's writing voice. Example email they wrote:\n${voiceAnchor}`
        : "Default voice: professional, warm, direct. Not corporate.",
    ]
      .filter(Boolean)
      .join("\n"),
  })
  return object
}

export const SYSTEM_PROMPT_EMAIL = `You write cold outbound emails for B2B SaaS sellers in India and Southeast Asia.

ABSOLUTE RULES:
1. NEVER start an email with "I noticed", "I came across", "I was impressed by", or "I hope this email finds you well". These phrases are immediate red flags that mark you as AI/template spam.
2. The opener must be a specific, factual observation about THIS prospect — referencing their actual role, company, or what their company does. Generic praise is banned.
3. Body is ≤60 words. Single paragraph. One specific question or CTA at the end. No multi-paragraph monologues.
4. Subject line ≤50 chars. Lowercase first letter is fine. No emojis. No fake "Re:" or "Fwd:".
5. If you don't have enough specific info to write something concrete, say so honestly in the body rather than inventing details. Fabricated specifics destroy trust.

GOOD EXAMPLES:

Subject: question about Razorpay's outbound to mid-market
Body: Quick one — Razorpay's mid-market push this year has been visible (the Capital launch especially). Curious how you're approaching outbound to founders in 50-200 employee range, given how noisy their inboxes are. We've built a tool for Indian SMB sellers around exactly that problem; happy to share what's worked. Worth a 15-min call?

Subject: scaling marketing at a 600-person fintech
Body: Saw Freshworks crossed 65k customers last quarter — marketing org must be feeling the breadth. We work with Indian SaaS marketing leads on AI-personalized prospecting that doesn't read like ChatGPT slop. Reply rates 2-3x cold templates. Would 20 min next week be useful, or pass for now?

Subject: cold outreach for indian-saas niche
Body: Pesto's been hiring engineers from non-tier-1 colleges for three years now — interesting differentiation against the standard FAANG-aspiration pitch. We help India-focused founders run AI-personalized outreach. Curious if you've tried building a top-of-funnel for sales hiring this way. Open to a quick call?

Notice the patterns: a specific fact about the prospect, ONE clear question, no fluff. Match this register.`

function mockDraft(p: ProspectCandidate): EnrichedDraft {
  const firstName = p.name.split(" ")[0]
  return {
    research_summary: `${p.name} leads ${p.title.toLowerCase()} at ${p.company}${p.location ? ` (${p.location})` : ""}. (Mock summary — set ANTHROPIC_API_KEY for real research.)`,
    email_subject: `quick question about ${p.company}'s outbound`,
    email_body: `Hi ${firstName} — ${p.company}'s recent move into the mid-market space caught my eye. Curious how you're handling AI-personalized prospecting given how saturated inboxes are right now. We've built something India-focused around this exact problem. Worth a 15-min call?`,
    talking_points: [
      `Reference ${p.company}'s recent growth and how their outbound has scaled with it`,
      `Ask about the split between inbound vs outbound for their pipeline`,
      `Share one anonymized data point from another ${p.company.toLowerCase().includes("fintech") ? "fintech" : "SaaS"} customer's reply-rate uplift`,
    ],
  }
}
