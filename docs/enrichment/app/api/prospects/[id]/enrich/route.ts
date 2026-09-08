/**
 * POST /api/prospects/[id]/enrich   — queue a public-contact enrichment
 * GET  /api/prospects/[id]/enrich   — poll the latest run
 *
 * Queues ALWAYS, even for a single lead. The existing single-lead path
 * (handleEnrichProspect) runs inside the streaming chat request, which
 * on Vercel means a hard function timeout and total loss of work if the
 * user closes the tab. A crawl is 25-40s of wall clock; it does not
 * belong in a request.
 *
 * Returns 202 + run_id. The client polls GET, or listens for the
 * `leadgen/enrichment.completed` event.
 *
 * Auth mirrors the repo convention: getUserFromRequest() accepts both
 * the browser cookie session and a Bearer token (Chrome extension).
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import { getUserFromRequest } from "@/lib/api-auth"
import { inngest } from "@/inngest/client"
import { isCrawlerConfigured } from "@/lib/enrichment/crawler.service"
import {
  buildIdempotencyKey,
  createOrGetRun,
  getLatestRunForProspect,
  loadOwnedProspect,
  normalizeCompanyDomain,
} from "@/lib/enrichment/run-service"
import { ENRICHMENT_REQUESTED } from "@/lib/enrichment/types"

export const runtime = "nodejs"

const PostBody = z
  .object({
    /** Explicit domain. Wins over prospects.company_domain. */
    domain: z.string().min(3).max(253).optional(),
    /** Bypass the 30-day crawl cache for a user-triggered re-scan. */
    force: z.boolean().optional(),
  })
  .strict()

// ---------------------------------------------------------------------
// POST — enqueue
// ---------------------------------------------------------------------

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_prospect_id" }, { status: 400 })
  }

  const auth = await getUserFromRequest(req)
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: z.infer<typeof PostBody> = {}
  if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
    let json: unknown
    try {
      json = await req.json()
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 })
    }
    const parsed = PostBody.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }
    body = parsed.data
  }

  // Ownership: prospect -> job -> user. prospects has no user_id column.
  const prospect = await loadOwnedProspect(id, auth.user.id)
  if (!prospect) return NextResponse.json({ error: "not_found" }, { status: 404 })

  // An authoritative domain is REQUIRED. guessDomainFromCompany() is
  // fine for an email pattern guess, but crawling a guessed domain
  // writes another company's contact details onto this lead.
  const domain = normalizeCompanyDomain(body.domain ?? prospect.company_domain)
  if (!domain) {
    return NextResponse.json(
      {
        error: "domain_required",
        message:
          "This prospect has no verified company domain. Pass { domain } explicitly — " +
          "a domain guessed from the company name is not safe to crawl.",
      },
      { status: 422 },
    )
  }

  // `force` gets its own idempotency bucket so a deliberate re-scan is
  // not swallowed by the day's existing run.
  const bucket = body.force ? `force:${Date.now()}` : undefined
  const idempotencyKey = buildIdempotencyKey(id, domain, bucket)

  const { run, created } = await createOrGetRun({
    userId: auth.user.id,
    prospectId: id,
    domain,
    idempotencyKey,
  })

  // Only dispatch for a genuinely new run. A duplicate POST returns the
  // in-flight run without queuing a second crawl.
  if (created) {
    await inngest.send({
      name: ENRICHMENT_REQUESTED,
      data: {
        run_id: run.id,
        user_id: auth.user.id,
        prospect_id: id,
        domain,
      },
    })
  }

  return NextResponse.json(
    {
      run_id: run.id,
      prospect_id: id,
      domain,
      status: run.status,
      queued: created,
      using_mock_data: !isCrawlerConfigured(),
      poll_url: `/api/prospects/${id}/enrich`,
    },
    { status: created ? 202 : 200 },
  )
}

// ---------------------------------------------------------------------
// GET — poll
// ---------------------------------------------------------------------

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_prospect_id" }, { status: 400 })
  }

  const auth = await getUserFromRequest(req)
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const prospect = await loadOwnedProspect(id, auth.user.id)
  if (!prospect) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const run = await getLatestRunForProspect(id, auth.user.id)
  if (!run) {
    return NextResponse.json({ prospect_id: id, status: "none", run: null })
  }

  return NextResponse.json({
    prospect_id: id,
    status: run.status,
    run: {
      id: run.id,
      domain: run.domain,
      status: run.status,
      attempt: run.attempt,
      created_at: run.created_at,
    },
  })
}
