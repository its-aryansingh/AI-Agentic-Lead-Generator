/**
 * enrich-prospect.ts — the enrichment worker.
 *
 * One event per prospect, not one per batch. That is the difference
 * between "one slow domain stalls 40 leads" and "one slow domain retries
 * alone", and it lets Inngest do per-domain concurrency for us instead
 * of the in-memory Map the scraper currently uses (which resets on every
 * deploy and does not coordinate across replicas).
 *
 * Step boundaries are chosen so a retry never re-pays for work that
 * already succeeded:
 *   crawl    — cached 30 days by domain, so a retry is usually free
 *   extract  — the only token-billed step; isolated so a DB blip
 *              cannot cause a second OpenAI charge
 *   persist  — idempotent RPC; safe to replay
 *
 * Step IDs use the immutable run UUID, never a candidate's name/company
 * (the current bulk-enrich function does the latter, so two prospects
 * called "Priya Sharma at Acme" collide on replay).
 */

import { inngest } from "@/inngest/client"
import { crawlCompanySite, DEFAULT_CRAWL_BUDGET_MS } from "@/lib/enrichment/crawler.service"
import { extractContacts } from "@/lib/enrichment/extractor.service"
import {
  completeRun,
  getRun,
  markRunStarted,
} from "@/lib/enrichment/run-service"
import { pickPrimary, validateExtraction } from "@/lib/enrichment/validator"
import {
  ENRICHMENT_COMPLETED,
  ENRICHMENT_REQUESTED,
  EnrichmentError,
  type CrawlResult,
  type EnrichmentRequestedEvent,
  type Extraction,
  type ExtractionUsage,
} from "@/lib/enrichment/types"

export type { EnrichmentRequestedEvent }

export const enrichProspectFunction = inngest.createFunction(
  {
    id: "enrich-prospect",
    // Two limits, deliberately different:
    //   global  — protects the single-container scraper (1GB / ~4 pages)
    //   perhost — politeness: never two concurrent crawls of one company
    concurrency: [
      { limit: 4 },
      { key: "event.data.domain", limit: 1 },
    ],
    // Same domain + same run can only be in flight once.
    idempotency: "event.data.run_id",
    retries: 2,
    // Inngest v4 declares triggers inside the config object — this
    // matches the shape already used by inngest/functions/bulk-enrich.ts.
    triggers: [{ event: ENRICHMENT_REQUESTED }],
  },
  async ({ event, step, logger }) => {
    const { run_id, user_id, prospect_id, domain } =
      event.data as EnrichmentRequestedEvent["data"]

    // ---------------------------------------------------------------
    // 0. Guard: never re-run a run that already reached a terminal state.
    //    Protects against a replayed event and a reconciliation cron
    //    racing the original dispatch.
    // ---------------------------------------------------------------
    const state = await step.run(`start-${run_id}`, async () => {
      const run = await getRun(run_id, user_id)
      if (!run) return { proceed: false as const, reason: "run_not_found" }
      if (run.status === "succeeded" || run.status === "failed") {
        return { proceed: false as const, reason: `already_${run.status}` }
      }
      const attempt = await markRunStarted(run_id, user_id)
      return { proceed: true as const, attempt }
    })

    if (!state.proceed) {
      logger.info({ run_id, reason: state.reason }, "enrichment_skipped")
      return { run_id, skipped: true, reason: state.reason }
    }

    // Hoisted into its own const: TypeScript does not carry the
    // discriminated-union narrowing above into the `finish()` closure
    // below, and step.run() returns a Jsonify<...> union rather than the
    // raw type. One local keeps both the compiler and the reader happy.
    const attempt: number = state.attempt

    // ---------------------------------------------------------------
    // 1. Crawl
    // ---------------------------------------------------------------
    let crawl: CrawlResult
    try {
      crawl = await step.run(`crawl-${run_id}`, async () =>
        crawlCompanySite({
          domain,
          budgetMs: DEFAULT_CRAWL_BUDGET_MS,
          // A retry re-crawls: the first attempt may have been cut short.
          useCache: attempt === 1,
        }),
      )
    } catch (err) {
      return finish(err, "crawl")
    }

    if (crawl.pages.length === 0) {
      const code = crawl.pages_blocked > 0 ? "SITE_BLOCKED" : "NO_PUBLIC_PAGES"
      await step.run(`fail-nopages-${run_id}`, () =>
        completeRun({
          runId: run_id,
          userId: user_id,
          prospectId: prospect_id,
          status: "failed",
          pagesCrawled: 0,
          errorCode: code,
          errorDetail:
            code === "SITE_BLOCKED"
              ? `Site refused the crawler on ${crawl.pages_blocked} page(s)`
              : "No public contact pages responded",
        }),
      )
      return { run_id, status: "failed", error_code: code }
    }

    // ---------------------------------------------------------------
    // 2. Extract (the only token-billed step)
    // ---------------------------------------------------------------
    let extraction: Extraction
    let usage: ExtractionUsage
    try {
      const out = await step.run(`extract-${run_id}`, async () =>
        extractContacts({ domain, pages: crawl.pages }),
      )
      extraction = out.extraction
      usage = out.usage
    } catch (err) {
      return finish(err, "extract")
    }

    // ---------------------------------------------------------------
    // 3. Validate (pure, deterministic — no step needed)
    // ---------------------------------------------------------------
    const contacts = validateExtraction(extraction, crawl.pages, domain)
    const primary = pickPrimary(contacts)

    const foundNothing =
      contacts.emails.length === 0 &&
      contacts.phones.length === 0 &&
      contacts.key_contacts.length === 0

    // ---------------------------------------------------------------
    // 4. Persist
    // ---------------------------------------------------------------
    await step.run(`persist-${run_id}`, () =>
      completeRun({
        runId: run_id,
        userId: user_id,
        prospectId: prospect_id,
        // "Crawled fine, nothing published" is not a failure — it is a
        // finding, and re-queuing it tomorrow would just re-spend money.
        status: foundNothing ? "skipped" : "succeeded",
        contacts,
        primary,
        pagesCrawled: crawl.pages_visited,
        model: usage.model,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        costPaise: usage.cost_paise,
        errorCode: foundNothing ? "NOTHING_EXTRACTED" : null,
      }),
    )

    await step.sendEvent(`completed-${run_id}`, {
      name: ENRICHMENT_COMPLETED,
      data: {
        run_id,
        user_id,
        prospect_id,
        domain,
        status: foundNothing ? "skipped" : "succeeded",
        emails_found: contacts.emails.length,
        phones_found: contacts.phones.length,
        contacts_found: contacts.key_contacts.length,
        cost_paise: usage.cost_paise,
      },
    })

    logger.info(
      {
        run_id,
        domain,
        pages: crawl.pages_visited,
        emails: contacts.emails.length,
        phones: contacts.phones.length,
        cost_paise: usage.cost_paise,
      },
      "enrichment_completed",
    )

    return {
      run_id,
      status: foundNothing ? "skipped" : "succeeded",
      emails_found: contacts.emails.length,
      phones_found: contacts.phones.length,
      contacts_found: contacts.key_contacts.length,
      cost_paise: usage.cost_paise,
    }

    // ---------------------------------------------------------------
    // Terminal-vs-retryable handling
    // ---------------------------------------------------------------
    async function finish(err: unknown, phase: string) {
      const isEnrichmentError = err instanceof EnrichmentError

      // Retryable: rethrow so Inngest backs off and tries again. The run
      // row stays 'running' — the reconciliation cron sweeps it if every
      // attempt is exhausted.
      if (isEnrichmentError && err.retryable && attempt <= 2) {
        logger.warn({ run_id, phase, code: err.code }, "enrichment_retryable")
        throw err
      }

      const code = isEnrichmentError ? err.code : "CRAWLER_UNAVAILABLE"
      const detail = err instanceof Error ? err.message : String(err)

      await step.run(`fail-${phase}-${run_id}`, () =>
        completeRun({
          runId: run_id,
          userId: user_id,
          prospectId: prospect_id,
          status: "failed",
          pagesCrawled: 0,
          errorCode: code,
          errorDetail: detail,
        }),
      )

      logger.error({ run_id, phase, code }, "enrichment_failed")
      return { run_id, status: "failed" as const, error_code: code }
    }
  },
)
