/**
 * GET /api/health/enrichment        fast, no network
 * GET /api/health/enrichment?deep=1 also calls OpenAI /models (unbilled)
 *
 * Deploy to Railway, hit this, and you know within seconds whether the
 * OPENAI_API_KEY variable actually reached the container — instead of
 * discovering it on the first lead, silently, as mock data.
 *
 * Kept separate from the existing /api/health so the Railway healthcheck
 * (which pings that one) is not coupled to third-party availability.
 * A deploy should not be marked unhealthy because OpenAI is having a bad
 * afternoon.
 */

import { NextResponse } from "next/server"

import { checkEnrichment, checkOpenAiLive } from "@/lib/enrichment/health"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1"

  const health = await checkEnrichment()
  if (deep) {
    health.components.openai_live = await checkOpenAiLive()
    if (health.components.openai_live.status === "down") health.status = "degraded"
  }

  // 200 even when degraded: this endpoint reports, it does not gate.
  // Only a dead database is a hard failure.
  return NextResponse.json(health, { status: health.status === "down" ? 503 : 200 })
}
