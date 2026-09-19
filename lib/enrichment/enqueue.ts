/**
 * Enqueue a prospect enrichment run.
 *
 * WHY THIS FILE IS AN ADAPTER RATHER THAN A PORT
 *
 * SalesEngAIMVP and LeadGenAI each built an enrichment engine from the
 * same plan document, and they are not compatible. Their enrichment_runs
 * has input_domain / requested_at / completed / partial / blocked and a
 * foreign key on prospects(id, user_id); this repo's, from
 * db/migrations/0001, has domain / created_at / succeeded / skipped and
 * its own complete_enrichment_run() RPC, an SSRF-guarded crawler and a
 * grounding validator behind it. Keeping both would have left two
 * half-wired pipelines writing to one table.
 *
 * So LeadGenAI's engine stays, and this file reproduces exactly the
 * surface the ported SalesEngAIMVP callers expect —
 * enqueueProspectEnrichment plus the re-exports below — on top of
 * lib/enrichment/run-service.ts. Its callers
 * (app/app/leads/actions.ts, lib/agent/tool-handlers.ts,
 * lib/discovery/discovery-orchestrator.ts, the enrich route) needed no
 * edits.
 *
 * The event is the same one this repo's worker already listens for, so
 * inngest/functions/enrich-prospect.ts picks the run up unchanged.
 */

import { inngest } from "@/inngest/client"
import {
  boundedInt,
  cleanIdempotencyHint,
  computeEnrichmentIdempotencyKey,
  EnqueueError,
  normalizeCompanyDomain,
  captureEnrichmentDispatchCounts,
} from "@/lib/enrichment/enqueue-core"
import { createOrGetRun, loadOwnedProspect } from "@/lib/enrichment/run-service"
import { ENRICHMENT_REQUESTED } from "@/lib/enrichment/types"
import { query } from "@/lib/db"

export {
  EnqueueError,
  normalizeCompanyDomain,
  cleanIdempotencyHint,
  computeEnrichmentIdempotencyKey,
  captureEnrichmentDispatchCounts,
}

export interface EnqueueResult {
  run_id: string
  status: string
  reused: boolean
}

/**
 * Inngest only actually delivers when it has a transport. Without one a
 * send() silently succeeds in dev and the run sits queued forever, so
 * refuse up front rather than accepting work nothing will do.
 */
function hasInngestTransport(): boolean {
  if (process.env.INNGEST_EVENT_KEY?.trim()) return true
  const dev = process.env.INNGEST_DEV?.trim() ?? ""
  return /^(1|true|https?:\/\/)/i.test(dev)
}

export async function enqueueProspectEnrichment(input: {
  userId: string
  prospectId: string
  domain?: string | null
  idempotencyHint?: string | null
  force?: boolean
}): Promise<EnqueueResult> {
  // Same two gates SalesEngAIMVP applies, kept so the feature flag and
  // the transport check behave identically on both repos.
  if (process.env.PUBLIC_CONTACT_ENRICHMENT_ENABLED !== "true") {
    throw new EnqueueError("ENRICHMENT_DISABLED", 503)
  }
  if (!hasInngestTransport()) {
    throw new EnqueueError("INNGEST_NOT_CONFIGURED", 503)
  }

  // loadOwnedProspect joins through jobs AND checks prospects.user_id,
  // so this is the ownership boundary, not a convenience lookup.
  const prospect = await loadOwnedProspect(input.prospectId, input.userId)
  if (!prospect) throw new EnqueueError("PROSPECT_NOT_FOUND", 404)

  const maxPerHour = boundedInt(
    process.env.ENRICHMENT_MAX_RUNS_PER_USER_HOUR,
    100,
    1,
    10_000,
  )
  // created_at, not requested_at — this repo's column name.
  const recent = await query<{ n: string }>(
    `select count(*)::int as n from public.enrichment_runs
      where user_id = $1 and created_at >= now() - interval '1 hour'`,
    [input.userId],
  )
  if (Number(recent[0]?.n ?? 0) >= maxPerHour) {
    throw new EnqueueError("ENRICHMENT_RATE_LIMITED", 429)
  }

  const domain = normalizeCompanyDomain(input.domain ?? prospect.company_domain)
  if (!domain) throw new EnqueueError("DOMAIN_REQUIRED", 400)

  const idempotencyKey = computeEnrichmentIdempotencyKey({
    userId: input.userId,
    prospectId: input.prospectId,
    domain,
    idempotencyHint: input.idempotencyHint,
    force: input.force,
  })

  // createOrGetRun races on the unique index and returns the winner's
  // row to the loser, so a duplicate request never queues a second crawl.
  const { run, created } = await createOrGetRun({
    userId: input.userId,
    prospectId: input.prospectId,
    domain,
    idempotencyKey,
  })

  if (!created) {
    return { run_id: run.id, status: run.status, reused: true }
  }

  try {
    await inngest.send({
      id: `enrichment-requested:${run.id}`,
      name: ENRICHMENT_REQUESTED,
      data: {
        run_id: run.id,
        user_id: input.userId,
        prospect_id: input.prospectId,
        domain,
      },
    })
  } catch {
    // Leave the run queued, not failed: the cron backstop redispatches
    // it. Marking it failed here would lose work that is still valid.
    await query(
      `update public.enrichment_runs
          set error_code = 'EVENT_DISPATCH_PENDING'
        where id = $1 and user_id = $2`,
      [run.id, input.userId],
    )
    throw new EnqueueError("EVENT_DISPATCH_PENDING", 503)
  }

  return { run_id: run.id, status: "queued", reused: false }
}
