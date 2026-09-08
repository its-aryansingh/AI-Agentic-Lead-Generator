/**
 * extractor.service.ts — gpt-4o-mini Structured Outputs layer.
 *
 * Uses the official `openai` SDK directly rather than the Vercel AI SDK
 * that this repo uses for chat/drafting. Reason: the AI SDK abstracts
 * `response_format` behind its own object mode, and this pipeline needs
 * the exact `json_schema` + `strict: true` contract so a malformed
 * payload is impossible by construction rather than by retry. The AI SDK
 * adapters in lib/providers/anthropic.ts are untouched.
 *
 * Cost shape (gpt-4o-mini, $0.15 / 1M in, $0.60 / 1M out):
 *   ~12k input tokens + ~250 output tokens per lead
 *   ≈ $0.0033 ≈ 29 paise at ₹88/USD, before caching.
 * The 30-day scrape_cache means repeat domains cost ₹0.
 *
 * MOCK FALLBACK: like every provider in this repo, this module returns
 * deterministic mock data when OPENAI_API_KEY is unset, so the app still
 * runs end-to-end without keys (CLAUDE.md hard rule #2).
 */

import OpenAI from "openai"

import {
  EXTRACTION_JSON_SCHEMA,
  EnrichmentError,
  ExtractionSchema,
  type CrawledPage,
  type Extraction,
  type ExtractionUsage,
} from "./types"

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------

/**
 * Pinned snapshot. An unpinned alias can change under you mid-quarter
 * and silently shift extraction behaviour; pin it and bump deliberately.
 */
export const EXTRACTION_MODEL = process.env.OPENAI_EXTRACTION_MODEL ?? "gpt-4o-mini"

/** USD per 1M tokens. Update alongside the model pin. */
const PRICE_IN_PER_M = 0.15
const PRICE_OUT_PER_M = 0.6
const USD_TO_INR = Number(process.env.USD_INR_RATE ?? 88)

/**
 * Token budget. gpt-4o-mini's context is 128k, but paying for 128k of
 * boilerplate per lead is how a ₹0.10 target becomes ₹3. Contact pages
 * carry their payload in the first few thousand characters; 48k chars
 * (~12k tokens) is generous and caps worst-case spend.
 */
const MAX_INPUT_CHARS = 48_000
const CHARS_PER_TOKEN = 4 // conservative for Latin-script business copy

let client: OpenAI | null = null

function getClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  if (!client) {
    client = new OpenAI({
      apiKey: key,
      timeout: 30_000,
      maxRetries: 2, // network/5xx only; the SDK does not retry 4xx
    })
  }
  return client
}

export function isExtractorConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY
}

// ---------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------

const SYSTEM_PROMPT = `You extract published business contact details from the text of a company's own public web pages.

You are reading pages from ONE Indian company. Return only what is literally printed in the text provided.

RULES
1. Never invent, complete, correct, or infer a value. If a phone number is partially printed, skip it. If an email is obfuscated ("info [at] example [dot] com"), reconstruct it ONLY if every character is present in the text.
2. Copy phone numbers EXACTLY as printed, including the +91 or 0 prefix, STD code, brackets, spaces and hyphens. Do not reformat. Downstream code normalises them.
3. Include role mailboxes (info@, sales@, hr@, careers@, accounts@) — for Indian businesses these are usually the published contact point. Also include named addresses.
4. EXCLUDE: personal addresses on free consumer domains that are not the company's own (gmail.com, yahoo.in, rediffmail.com, hotmail.com) UNLESS the page presents it as the official business contact; addresses belonging to website vendors, agencies, analytics or CMS tooling; placeholder or example values.
5. EXCLUDE anything that is not a phone number even if it looks like digits: GSTIN, CIN, PAN, PIN codes, registration or licence numbers, years, prices, plot/door numbers, bank accounts, IFSC codes.
6. key_contacts: only people the page NAMES as a company contact or team member, with the job title shown beside the name. Do not guess a title. If no titled people are named, return an empty array.
7. social_links: absolute URLs of the company's own profiles only.
8. Every array may be empty. An empty array is a correct answer and is strongly preferred over a guess.`

function buildUserPrompt(domain: string, pages: CrawledPage[]): string {
  const header =
    `Company domain: ${domain}\n` +
    `Pages fetched: ${pages.length}\n\n` +
    `Extract the published business contact details from the page text below.\n`

  const budget = MAX_INPUT_CHARS - header.length
  const perPage = Math.max(1_000, Math.floor(budget / Math.max(1, pages.length)))

  const body = pages
    .map((p) => {
      const text = p.text.length > perPage ? `${p.text.slice(0, perPage)}\n[...truncated]` : p.text
      return `\n===== PAGE: ${p.url} =====\n${p.title ? `TITLE: ${p.title}\n` : ""}${text}`
    })
    .join("\n")

  return `${header}${body}`.slice(0, MAX_INPUT_CHARS)
}

// ---------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------

export interface ExtractionResult {
  extraction: Extraction
  usage: ExtractionUsage
  using_mock_data: boolean
}

export async function extractContacts(params: {
  domain: string
  pages: CrawledPage[]
}): Promise<ExtractionResult> {
  const { domain, pages } = params

  if (pages.length === 0) {
    throw new EnrichmentError("NO_PUBLIC_PAGES", "No pages were crawled", false)
  }

  const openai = getClient()
  if (!openai) return mockExtraction(domain, pages)

  const userPrompt = buildUserPrompt(domain, pages)

  let completion: OpenAI.Chat.Completions.ChatCompletion
  try {
    completion = await openai.chat.completions.create({
      model: EXTRACTION_MODEL,
      temperature: 0,
      top_p: 1,
      max_tokens: 2_000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "public_business_contacts",
          strict: true,
          schema: EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    })
  } catch (err) {
    const status = (err as { status?: number }).status
    // 429 and 5xx are worth another attempt from the queue; 400/401/404
    // mean the request or the key is wrong and retrying is pure cost.
    const retryable = status === 429 || (typeof status === "number" && status >= 500)
    throw new EnrichmentError(
      "MODEL_UNAVAILABLE",
      `OpenAI request failed (${status ?? "network"}): ${(err as Error).message}`,
      retryable,
    )
  }

  const choice = completion.choices[0]

  // Structured Outputs surfaces safety refusals in a dedicated field
  // rather than as malformed JSON — check it before parsing.
  if (choice?.message?.refusal) {
    throw new EnrichmentError("MODEL_REFUSAL", `Model refused: ${choice.message.refusal}`, false)
  }

  // A truncated response is invalid JSON by definition.
  if (choice?.finish_reason === "length") {
    throw new EnrichmentError(
      "MODEL_INVALID_JSON",
      "Response hit max_tokens before completing the JSON object",
      false,
    )
  }

  const content = choice?.message?.content
  if (!content) {
    throw new EnrichmentError("MODEL_INVALID_JSON", "Empty completion content", true)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new EnrichmentError("MODEL_INVALID_JSON", "Completion was not valid JSON", false)
  }

  // Belt and braces: strict mode should make this unreachable, but a
  // schema drift or a proxy rewriting the body would land here.
  const validated = ExtractionSchema.safeParse(parsed)
  if (!validated.success) {
    throw new EnrichmentError(
      "MODEL_INVALID_JSON",
      `Response did not match schema: ${validated.error.issues.map((i) => i.path.join(".")).join(", ")}`,
      false,
    )
  }

  const promptTokens = completion.usage?.prompt_tokens ?? estimateTokens(userPrompt)
  const completionTokens = completion.usage?.completion_tokens ?? estimateTokens(content)

  return {
    extraction: validated.data,
    usage: {
      model: completion.model ?? EXTRACTION_MODEL,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_paise: costInPaise(promptTokens, completionTokens),
    },
    using_mock_data: false,
  }
}

// ---------------------------------------------------------------------
// Cost + helpers
// ---------------------------------------------------------------------

export function costInPaise(promptTokens: number, completionTokens: number): number {
  const usd =
    (promptTokens / 1_000_000) * PRICE_IN_PER_M +
    (completionTokens / 1_000_000) * PRICE_OUT_PER_M
  return Math.ceil(usd * USD_TO_INR * 100)
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN)
}

/**
 * Deterministic mock. Echoes back the regex pre-hits the crawler already
 * found so the pipeline behaves sensibly end-to-end without a key —
 * the validator then applies the same grounding rules it would in prod.
 */
function mockExtraction(domain: string, pages: CrawledPage[]): ExtractionResult {
  const haystack = pages.map((p) => p.text).join("\n")

  const allEmails = [
    ...new Set(haystack.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}/g) ?? []),
  ].map((e) => e.toLowerCase())

  // Prefer the company's own domain, mirroring how the real prompt ranks.
  const apex = domain.toLowerCase().replace(/^www\./, "")
  const emails = [
    ...allEmails.filter((e) => e.endsWith(`@${apex}`)),
    ...allEmails.filter((e) => !e.endsWith(`@${apex}`)),
  ]

  const phones = [...new Set(haystack.match(/(?:\+91[\s.-]?)?\d{5}[\s.-]?\d{5}/g) ?? [])]

  return {
    extraction: {
      emails: emails.slice(0, 10),
      phones: phones.slice(0, 10),
      key_contacts: [],
      social_links: [],
    },
    usage: {
      model: `${EXTRACTION_MODEL} (mock)`,
      prompt_tokens: 0,
      completion_tokens: 0,
      cost_paise: 0,
    },
    using_mock_data: true,
  }
}
