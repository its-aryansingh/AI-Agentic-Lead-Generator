/**
 * Shared contracts for the public-contact enrichment pipeline.
 *
 * Import-light on purpose (zod only) so `node --test
 * --experimental-strip-types` can load it directly, matching the
 * existing *-core.ts convention in this repo.
 */

import { z } from "zod"

// ---------------------------------------------------------------------
// Crawler wire format (mirrors scraper/src/handlers/enrich.ts)
// ---------------------------------------------------------------------

export interface CrawledPage {
  url: string
  title: string
  text: string
  status: number
}

export interface CrawlResult {
  domain: string
  pages: CrawledPage[]
  candidate_emails: string[]
  candidate_phones: string[]
  social_links: string[]
  pages_visited: number
  pages_blocked: number
  truncated: boolean
  degraded: boolean
  scraped_at: string
}

// ---------------------------------------------------------------------
// LLM output — must match the json_schema sent to gpt-4o-mini exactly
// ---------------------------------------------------------------------

export const KeyContactSchema = z.object({
  name: z.string(),
  title: z.string(),
})

export const ExtractionSchema = z.object({
  emails: z.array(z.string()),
  phones: z.array(z.string()),
  key_contacts: z.array(KeyContactSchema),
  social_links: z.array(z.string()),
})

export type KeyContact = z.infer<typeof KeyContactSchema>
export type Extraction = z.infer<typeof ExtractionSchema>

/**
 * The JSON Schema handed to OpenAI. Structured Outputs with
 * `strict: true` requires, on EVERY object:
 *   - additionalProperties: false
 *   - every property listed in `required`
 * There are no optional fields; model "nothing found" as an empty array.
 */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    emails: {
      type: "array",
      description:
        "Business email addresses published on the page. Include role addresses " +
        "(info@, sales@, careers@) as well as named ones. Lower-case, no mailto:.",
      items: { type: "string" },
    },
    phones: {
      type: "array",
      description:
        "Phone numbers exactly as printed on the page, including any +91, 0 prefix, " +
        "STD code, spaces, hyphens or brackets. Do not reformat or normalize.",
      items: { type: "string" },
    },
    key_contacts: {
      type: "array",
      description:
        "Named people presented publicly as company contacts, with the job title " +
        "shown next to the name. Empty array if none are named.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          title: { type: "string" },
        },
        required: ["name", "title"],
        additionalProperties: false,
      },
    },
    social_links: {
      type: "array",
      description: "Absolute URLs of the company's own social profiles.",
      items: { type: "string" },
    },
  },
  required: ["emails", "phones", "key_contacts", "social_links"],
  additionalProperties: false,
} as const

// ---------------------------------------------------------------------
// Validated / normalized output written to the database
// ---------------------------------------------------------------------

export interface ValidatedEmail {
  value: string
  /** true when the mailbox is a role account (info@, sales@, hr@ ...). */
  role: boolean
  /** true when the domain matches the crawled company domain. */
  on_domain: boolean
  page_url: string | null
}

export type IndianPhoneType = "mobile" | "landline" | "tollfree" | "unknown"

export interface ValidatedPhone {
  /** +91XXXXXXXXXX when we could prove it is Indian, else null. */
  e164: string | null
  /** As printed on the page. */
  raw: string
  type: IndianPhoneType
  page_url: string | null
}

export interface PublicContacts {
  emails: ValidatedEmail[]
  phones: ValidatedPhone[]
  key_contacts: Array<KeyContact & { page_url: string | null }>
  social_links: string[]
  source_urls: string[]
  extracted_at: string
}

export interface ExtractionUsage {
  model: string
  prompt_tokens: number
  completion_tokens: number
  /** Rounded up to whole paise. */
  cost_paise: number
}

// ---------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------

export type EnrichmentRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"

export interface EnrichmentRun {
  id: string
  user_id: string
  prospect_id: string
  domain: string
  idempotency_key: string
  status: EnrichmentRunStatus
  attempt: number
  created_at: string
}

export const ENRICHMENT_REQUESTED = "leadgen/enrichment.requested" as const
export const ENRICHMENT_COMPLETED = "leadgen/enrichment.completed" as const

export interface EnrichmentRequestedEvent {
  name: typeof ENRICHMENT_REQUESTED
  data: {
    run_id: string
    user_id: string
    prospect_id: string
    domain: string
  }
}

/**
 * Error taxonomy. `retryable: false` errors must be returned as a
 * terminal `failed` run rather than thrown, so Inngest does not burn
 * retries on a domain that will never resolve.
 */
export type EnrichmentErrorCode =
  | "DOMAIN_REJECTED"
  | "CRAWLER_UNAVAILABLE"
  | "CRAWLER_TIMEOUT"
  | "NO_PUBLIC_PAGES"
  | "SITE_BLOCKED"
  | "MODEL_REFUSAL"
  | "MODEL_INVALID_JSON"
  | "MODEL_UNAVAILABLE"
  | "NOTHING_EXTRACTED"
  | "DB_WRITE_FAILED"

export class EnrichmentError extends Error {
  constructor(
    readonly code: EnrichmentErrorCode,
    message: string,
    readonly retryable: boolean = false,
  ) {
    super(message)
    this.name = "EnrichmentError"
  }
}
