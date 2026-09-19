/**
 * Synchronous enrichment for a handful of domains.
 *
 * The queued path (lib/enrichment/enqueue.ts → the Inngest worker) is
 * the right one for bulk work. This is the agent's path: when a chat
 * tool has just discovered five companies and wants their public
 * contacts in the same turn, waiting on a queue round-trip would make
 * the conversation feel broken.
 *
 * Like enqueue.ts this is an adapter, not a port. SalesEngAIMVP's
 * version calls its own extractor and validator; this one drives
 * LeadGenAI's — crawlCompanySite (SSRF-guarded, robots-aware),
 * extractContacts (gpt-4o-mini with strict Structured Outputs) and
 * validateExtraction (every value must be grounded in crawled text).
 * The returned shape is SalesEngAIMVP's, so lib/agent/tool-handlers.ts
 * needed no edit.
 *
 * Flattening note: the agent wants plain strings, while this repo's
 * validator returns ValidatedEmail / ValidatedPhone carrying the page
 * each value came from. The provenance is not discarded — the queued
 * path still writes it to prospects.public_contacts — it is just not
 * what this caller asked for.
 */

import { recordAiUsage } from "@/lib/ai-config"
import { crawlCompanySite } from "@/lib/enrichment/crawler.service"
import { extractContacts } from "@/lib/enrichment/extractor.service"
import { normalizeCompanyDomain } from "@/lib/enrichment/enqueue-core"
import { validateExtraction } from "@/lib/enrichment/validator"

export interface DirectEnrichmentResult {
  domain: string
  phones: string[]
  emails: string[]
  key_contacts: Array<{ name: string; title: string }>
  social_links: string[]
  source_urls: string[]
  from_cache: boolean
  success: boolean
  error?: string
}

function empty(domain: string, error?: string): DirectEnrichmentResult {
  return {
    domain,
    phones: [],
    emails: [],
    key_contacts: [],
    social_links: [],
    source_urls: [],
    from_cache: false,
    success: false,
    error,
  }
}

export async function enrichCompanyDomainDirect(
  rawDomain: string,
  userId?: string,
): Promise<DirectEnrichmentResult> {
  const domain = normalizeCompanyDomain(rawDomain)
  if (!domain) return empty(rawDomain, "INVALID_DOMAIN")

  const started = Date.now()
  try {
    const crawl = await crawlCompanySite({ domain })
    if (crawl.pages.length === 0) {
      return empty(domain, "NO_PUBLIC_PAGES")
    }

    const { extraction, usage } = await extractContacts({ domain, pages: crawl.pages })
    const contacts = validateExtraction(extraction, crawl.pages, domain)

    if (userId) {
      // Best-effort: a missing usage row must never fail an enrichment.
      try {
        await recordAiUsage({
          userId,
          provider: "openai",
          model: usage.model,
          operation: "public_contact_enrichment",
          status: "completed",
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          durationMs: Date.now() - started,
        })
      } catch {}
    }

    return {
      domain,
      emails: contacts.emails.map((e) => e.value),
      phones: contacts.phones.map((p) => p.e164 ?? p.raw),
      key_contacts: contacts.key_contacts.map((c) => ({ name: c.name, title: c.title })),
      social_links: contacts.social_links,
      source_urls: contacts.source_urls,
      // This repo's CrawlResult does not surface a cache hit — the
      // cache lives inside crawler.service and is invisible here.
      // Reported false rather than guessed; the field exists only
      // because SalesEngAIMVP's callers read it.
      from_cache: false,
      success: true,
    }
  } catch (err) {
    const e = err as { code?: string; message?: string }
    return empty(domain, e.code ?? e.message ?? "ENRICHMENT_FAILED")
  }
}

export async function enrichMultipleDomainsDirect(
  domains: string[],
  options?: { userId?: string; concurrency?: number },
): Promise<Map<string, DirectEnrichmentResult>> {
  // Capped at 6: each one is a headless browser session, and the
  // scraper service runs on ~1GB.
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 3, 6))
  const results = new Map<string, DirectEnrichmentResult>()

  const unique = Array.from(
    new Set(domains.map((d) => normalizeCompanyDomain(d)).filter((d): d is string => Boolean(d))),
  )

  let index = 0
  async function worker() {
    for (;;) {
      const i = index++
      if (i >= unique.length) return
      const d = unique[i]
      results.set(d, await enrichCompanyDomainDirect(d, options?.userId))
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker))
  return results
}
