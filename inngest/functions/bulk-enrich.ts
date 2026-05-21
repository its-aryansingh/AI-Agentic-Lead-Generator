/**
 * Inngest background function for bulk prospect enrichment.
 *
 * Triggered by handleStartBulkJob when INNGEST_EVENT_KEY is set and the
 * candidate count exceeds SYNC_THRESHOLD (20). For smaller batches the
 * existing synchronous path continues to run inside the streaming chat
 * handler — no Inngest required.
 *
 * Each candidate is processed as an independent step so Inngest can retry
 * individual failures without restarting the whole job.
 */

import { inngest } from "@/inngest/client"
import { createAdminClient } from "@/lib/supabase/server"
import { draftForProspect } from "@/lib/providers/anthropic"
import { exportToSheet, rowsToCsv } from "@/lib/providers/google-sheets"
import { bestGuessEmail, guessDomainFromCompany, verifyDomainMx } from "@/lib/email-patterns"
import type { ProspectCandidate } from "@/lib/providers/brave-search"

export type BulkEnrichEvent = {
  name: "leadgen/bulk.start"
  data: {
    job_id: string
    user_id: string
    candidates: ProspectCandidate[]
    draft_email: boolean
    voice_anchor: string | null
  }
}

export const bulkEnrichFunction = inngest.createFunction(
  {
    id: "bulk-enrich",
    triggers: [{ event: "leadgen/bulk.start" }],
    concurrency: { limit: 3 },
    retries: 2,
  },
  async ({ event, step }) => {
    const { job_id, user_id, candidates, draft_email, voice_anchor } =
      event.data as BulkEnrichEvent["data"]
    const supabase = createAdminClient()

    const enriched: Array<{
      candidate: ProspectCandidate
      draft: Awaited<ReturnType<typeof draftForProspect>> | null
      domain: string | null
      email: string | null
      email_confidence: "risky" | "invalid" | "unknown"
    }> = []

    for (const candidate of candidates) {
      const result = await step.run(`enrich-${candidate.name}-${candidate.company}`, async () => {
        const draft = draft_email
          ? await draftForProspect({ prospect: candidate, voiceAnchor: voice_anchor })
          : null

        const domain = guessDomainFromCompany(candidate.company)
        const guess = domain ? bestGuessEmail(candidate.name, domain) : null

        let confidence: "risky" | "invalid" | "unknown" = guess ? "risky" : "unknown"
        if (domain && guess) {
          const mx = await verifyDomainMx(domain)
          if (mx.confidence === "no_mx") confidence = "invalid"
          else if (mx.confidence === "unknown") confidence = "unknown"
        }

        return {
          candidate,
          draft,
          domain,
          email: confidence === "invalid" ? null : (guess?.email ?? null),
          email_confidence: confidence,
        }
      })

      enriched.push(result)
    }

    await step.run("persist-prospects", async () => {
      const rows = enriched.map(({ candidate, draft, domain, email, email_confidence }) => ({
        job_id,
        input_source: "chat_search",
        input_name: candidate.name,
        input_company: candidate.company,
        input_linkedin_url: candidate.source_url,
        status: "completed" as const,
        company_domain: domain,
        email,
        email_source: email ? "pattern_guessed" : "none",
        email_confidence,
        research_summary: draft?.research_summary ?? null,
        email_subject: draft?.email_subject ?? null,
        email_body: draft?.email_body ?? null,
        talking_points: draft?.talking_points ?? null,
        completed_at: new Date().toISOString(),
      }))
      await supabase.from("prospects").insert(rows)
    })

    await step.run("export-and-complete", async () => {
      const { data: userRow } = await supabase
        .from("users")
        .select("google_refresh_token")
        .eq("id", user_id)
        .maybeSingle()

      const exportRows = enriched.map(({ candidate, draft, email, email_confidence }) => ({
        name: candidate.name,
        title: candidate.title,
        company: candidate.company,
        email,
        email_confidence,
        research_summary: draft?.research_summary ?? null,
        email_subject: draft?.email_subject ?? null,
        email_body: draft?.email_body ?? null,
        talking_points: draft?.talking_points ?? null,
        source_url: candidate.source_url,
      }))

      const title = `LeadGenAI — ${candidates.length} prospects — ${new Date().toLocaleString()}`
      const sheet = await exportToSheet({
        refreshToken: (userRow?.google_refresh_token as string) ?? null,
        title,
        rows: exportRows,
      })

      const csv = rowsToCsv(exportRows)

      await supabase
        .from("jobs")
        .update({
          status: "completed",
          sheet_url: sheet.url,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job_id)

      return { sheet_url: sheet.url, csv_bytes: csv.length }
    })

    return { job_id, enriched_count: enriched.length }
  },
)
