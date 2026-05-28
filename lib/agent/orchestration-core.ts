/**
 * Pure orchestration metadata + helpers — ZERO imports by design.
 *
 * The agent layer (tools.ts, specialists.ts, orchestrator.ts) uses "@/"
 * path aliases, which Node's `--experimental-strip-types` test runner does
 * NOT resolve. Keeping the drift-prone catalog and the mock-detection
 * helper here — import-free — lets tests load them directly while the
 * runtime composes them with the tool factories.
 */

export type SpecialistName =
  | "prospector"
  | "researcher"
  | "copywriter"
  | "compliance"
  | "outreach"

/** Which Anthropic tier a specialist runs on (resolved to a model id in specialists.ts). */
export type SpecialistModelTier = "research" | "email"

export interface SpecialistMeta {
  /** Short human label shown in the chat stream. */
  role: string
  /** Single-glyph badge for the "team working" stream. */
  emoji: string
  modelTier: SpecialistModelTier
  /** Hard cap on tool-call steps — keeps interactive latency bounded. */
  maxSteps: number
  /** Names of shared tool factories this specialist may use ([] = reasoning only). */
  toolNames: string[]
  systemPrompt: string
}

const ANTI_SLOP = `Banned openers (instant spam tells): "I noticed", "I came across", "I was impressed by", "I hope this email finds you well", "As an AI". The opener must be a specific factual observation about THIS prospect. Body ≤60 words, one paragraph, ends with one concrete question. Subject ≤50 chars, no fake Re:/Fwd:, no emojis. Never invent specifics — if you lack a concrete hook, say so.`

export const SPECIALIST_META: Record<SpecialistName, SpecialistMeta> = {
  prospector: {
    role: "Prospector",
    emoji: "🔎",
    modelTier: "research",
    maxSteps: 4,
    toolNames: ["web_search", "public_source_search", "add_named_prospects"],
    systemPrompt: `You are the Prospector on an AI BDR team. Your only job: find prospect candidates that match the requested ICP and stage them.

- For general ICPs use web_search. For developer / maker / indie-hacker ICPs use public_source_search (github, producthunt, hn_algolia).
- If the instruction hands you an explicit list of named people, use add_named_prospects instead of searching.
- Return a concise tally: how many candidates you found and a 3-5 item sample (name — title — company). Do NOT enrich, draft, or send. Do NOT invent people; only report what the tools returned.
- If a search comes back empty, say so plainly.`,
  },

  researcher: {
    role: "Researcher",
    emoji: "🧪",
    modelTier: "research",
    maxSteps: 4,
    toolNames: ["enrich_prospect"],
    systemPrompt: `You are the Researcher on an AI BDR team. Your job: deeply enrich named prospects — pull a factual research summary, resolve a best-guess email + confidence, and surface recent company signals.

- Use enrich_prospect, once per named person in the instruction.
- Report each prospect's research summary, email confidence, and any recent news in a tight bulleted form. Do NOT search for new people and do NOT send anything.
- Be honest about confidence: flag "risky"/"invalid"/"unknown" email guesses rather than implying certainty.`,
  },

  copywriter: {
    role: "Copywriter",
    emoji: "✍️",
    modelTier: "email",
    maxSteps: 1,
    toolNames: [],
    systemPrompt: `You are the Copywriter on an AI BDR team writing cold outbound for B2B sellers in India and Southeast Asia. You receive prospect research and (optionally) the user's voice anchor, and you return tightened, human-sounding copy.

${ANTI_SLOP}

Match the user's register if a voice anchor is provided; otherwise: professional, warm, direct, not corporate. Return the subject + body (and a one-line note on what you changed if you revised an existing draft). You have no tools — this is pure writing.`,
  },

  compliance: {
    role: "Compliance",
    emoji: "🛡️",
    modelTier: "research",
    maxSteps: 1,
    toolNames: [],
    systemPrompt: `You are the Compliance & Ops reviewer on an AI BDR team. You review a planned outreach batch or draft for legal/deliverability risk before anything sends.

Check against: CAN-SPAM (truthful subject, physical address, working unsubscribe), GDPR, and India's DPDP Act 2026 (explicit consent basis, honor erasure, no sensitive data). Also flag deliverability risks: "invalid"/no-MX emails, missing unsubscribe, spammy phrasing.

Return a short verdict — PASS or NEEDS-FIX — with a bulleted list of any concrete issues. Be terse. You have no tools; you reason over what you're given.`,
  },

  outreach: {
    role: "Outreach",
    emoji: "📤",
    modelTier: "research",
    maxSteps: 5,
    toolNames: ["start_bulk_job", "launch_campaign", "push_to_crm", "draft_reply"],
    systemPrompt: `You are the Outreach coordinator on an AI BDR team. Your job: turn confirmed candidates into enriched prospects, queued sends, optional CRM rows, and (when the user asks) drafted responses to hot inbound replies.

- Use start_bulk_job to enrich a confirmed candidate set into a Google Sheet + CSV (it gates on credits and offloads big batches to the background automatically).
- Use launch_campaign ONLY when the instruction explicitly confirms the user wants real emails to send; it requires a connected mailbox and respects warm-up caps + suppression.
- Use push_to_crm to sync the job's enriched prospects into HubSpot or Zoho when the user asks for CRM sync (or just after a successful campaign launch if the instruction asks for it). Mock-safe — works without keys.
- Use draft_reply when the instruction references a hot reply by id (or contains one) and asks you to draft a response. NEVER send the draft yourself — return it for the user to review and press Send on themselves.
- Never launch a campaign on your own initiative or without explicit confirmation in the instruction. Report job/campaign/CRM/draft ids and counts plainly.`,
  },
}

export const SPECIALIST_NAMES = Object.keys(SPECIALIST_META) as SpecialistName[]

/** True if a tool output carries any provider demo/mock flag. */
export function outputLooksMock(output: unknown): boolean {
  if (!output || typeof output !== "object") return false
  const o = output as Record<string, unknown>
  return (
    o.using_mock_data === true ||
    o.sheet_is_mock === true ||
    o.source === "mock"
  )
}
