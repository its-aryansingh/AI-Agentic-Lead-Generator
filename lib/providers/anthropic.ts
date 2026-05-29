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
  language?: string | null
}): Promise<EnrichedDraft> {
  const { prospect, voiceAnchor, news, language } = opts

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
      language && language.toLowerCase() !== "english"
        ? `Write the subject and email body in ${language}. Keep it natural and native — not a literal translation. Talking points may stay in English.`
        : "",
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

export const ReplyDraftSchema = z.object({
  subject: z.string().max(80).describe("Reply subject. Usually 'Re: <original subject>'."),
  body: z
    .string()
    .describe(
      "Reply body. Acknowledge what they said in ONE sentence, then advance the conversation with one concrete next step (often a calendar offer or one targeted question). ≤80 words. Match the user's voice anchor.",
    ),
  next_step: z
    .enum(["book_meeting", "answer_objection", "send_info", "wait_for_them", "close_lost"])
    .describe("The intent of this reply — what we're trying to move the conversation toward."),
})
export type ReplyDraft = z.infer<typeof ReplyDraftSchema>

/**
 * Draft a contextual response to a hot inbound reply.
 * Falls back to a believable mock when no API key is configured.
 */
export async function draftReplyResponse(opts: {
  prospect: { name: string; title?: string | null; company?: string | null }
  original_subject: string
  original_body: string
  reply_snippet: string
  reply_category:
    | "interested"
    | "question"
    | "objection"
    | "out_of_office"
    | "unsubscribe"
    | "not_interested"
    | "other"
  wants_meeting?: boolean
  voiceAnchor?: string | null
  language?: string | null
  /** User's calendar booking URL (Calendly / Cal.com / SavvyCal). When
   * present + wants_meeting=true, the draft pastes the real URL
   * instead of the [calendar link] placeholder. */
  calendar_url?: string | null
}): Promise<ReplyDraft> {
  const {
    prospect,
    original_subject,
    original_body,
    reply_snippet,
    reply_category,
    wants_meeting,
    voiceAnchor,
    language,
    calendar_url,
  } = opts

  if (!hasAnthropicKey()) {
    return mockReplyDraft(opts)
  }

  const { object } = await generateObject({
    model: anthropic(MODEL_EMAIL),
    schema: ReplyDraftSchema,
    system: SYSTEM_PROMPT_REPLY,
    prompt: [
      `Prospect: ${prospect.name}${prospect.title ? `, ${prospect.title}` : ""}${prospect.company ? ` at ${prospect.company}` : ""}.`,
      `\nOriginal outbound:\nSubject: ${original_subject}\n${original_body}`,
      `\nTheir reply (snippet): ${reply_snippet}`,
      `\nClassifier category: ${reply_category}${wants_meeting ? " (wants a meeting)" : ""}`,
      calendar_url && wants_meeting
        ? `\nUser's booking link (paste verbatim when offering a slot): ${calendar_url}`
        : "",
      language && language.toLowerCase() !== "english"
        ? `\nReply in ${language}. Natural register, not a literal translation.`
        : "",
      voiceAnchor
        ? `\nMatch this user's writing voice. Example:\n${voiceAnchor}`
        : "\nDefault voice: warm, direct, concrete. Not corporate. No filler.",
    ]
      .filter(Boolean)
      .join("\n"),
  })
  return object
}

export const SYSTEM_PROMPT_REPLY = `You draft replies to prospect responses on a B2B cold-outbound thread.

ABSOLUTE RULES:
1. NEVER open with "Thanks for the reply", "Appreciate you getting back", "I'm so glad", or any other transactional pleasantry. Jump straight to value or the next step.
2. Acknowledge what they actually said in ONE sentence — referencing the specific thing they wrote, not generic "thanks for sharing".
3. ONE next step. Don't multi-prong. If they sound interested, propose a 15-min slot. If they have a question, answer it tightly. If they object, address THAT objection.
4. ≤80 words. One paragraph or two short ones. No multi-paragraph monologues.
5. Calendar offers are best as a concrete proposal ("Wed or Thu 3-5pm IST?") not "let me know what works".
6. For "not_interested" / "unsubscribe" replies: do NOT draft a counter — return a polite acknowledgement that closes the loop. The next_step should be "close_lost".
7. For "out_of_office": next_step is "wait_for_them" and the body is a one-line "no rush, will follow up when you're back".

GOOD EXAMPLES:

Subject: Re: question about Razorpay's outbound
Body: Makes sense — the founder-segment noise is real, especially in Q4. We've handled exactly that with a Bangalore fintech last year (3 to 8 booked calls/wk by switching to event-triggered outreach). Wed or Thu 3-5pm IST for a 15-min walkthrough?
next_step: book_meeting

Subject: Re: scaling marketing at a 600-person fintech
Body: Fair question on the per-rep cost — it's ~$80/mo at your volume, undercut by reply-rate uplift in our beta. Happy to show the math on the call. Does Thursday 4pm IST work, or pick a slot here: [link].
next_step: answer_objection

Subject: Re: cold outreach for indian-saas niche
Body: No worries — not the right time is fine. I'll loop back in Q2; if priorities shift sooner, my line stays open.
next_step: close_lost

Notice: specific acknowledgement, one move, no fluff. Match this register.`

function mockReplyDraft(opts: {
  prospect: { name: string; company?: string | null }
  original_subject: string
  reply_category: string
  wants_meeting?: boolean
  calendar_url?: string | null
}): ReplyDraft {
  const firstName = opts.prospect.name.split(" ")[0]
  const cat = opts.reply_category
  const calendarLink = opts.calendar_url ? opts.calendar_url : "[calendar link]"
  if (cat === "not_interested" || cat === "unsubscribe") {
    return {
      subject: `Re: ${opts.original_subject}`,
      body: `Understood, ${firstName} — no worries. I'll loop back in a few months; if anything shifts sooner, easy to reach me here. (Mock draft — set ANTHROPIC_API_KEY for real.)`,
      next_step: "close_lost",
    }
  }
  if (cat === "out_of_office") {
    return {
      subject: `Re: ${opts.original_subject}`,
      body: `No rush, ${firstName} — will follow up when you're back. (Mock draft — set ANTHROPIC_API_KEY for real.)`,
      next_step: "wait_for_them",
    }
  }
  if (cat === "objection") {
    return {
      subject: `Re: ${opts.original_subject}`,
      body: `Fair point — happy to dig into that specifically on a quick call. Pick a slot here: ${calendarLink} or Wed/Thu 3-5pm IST works too. (Mock draft — set ANTHROPIC_API_KEY for real.)`,
      next_step: "answer_objection",
    }
  }
  // interested / question / other — default to a meeting offer.
  return {
    subject: `Re: ${opts.original_subject}`,
    body: `Great, ${firstName} — easiest is a 15-min walkthrough. Grab a slot here: ${calendarLink} (or Wed/Thu 3-5pm IST). (Mock draft — set ANTHROPIC_API_KEY for real.)`,
    next_step: "book_meeting",
  }
}

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
