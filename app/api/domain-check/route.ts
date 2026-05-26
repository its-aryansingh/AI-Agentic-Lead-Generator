/**
 * GET /api/domain-check?domain=<host>
 *
 * Pre-flight SPF / DKIM / DMARC checker. Useful from:
 *   - main app mailbox settings (cookie-authed)
 *   - chrome extension side panel (bearer-authed)
 *   - mobile app (bearer-authed)
 *
 * Auth: either cookie session OR Authorization: Bearer <jwt>. Cached
 * for 24h per domain via scrape_cache — DNS records change slowly
 * and the lookups are cheap, so this keeps repeat checks instant.
 */

import { NextResponse } from "next/server"

import { getUserFromRequest } from "@/lib/api-auth"
import { checkDomain } from "@/lib/domain-auth"
import { isValidDomain } from "@/lib/domain-auth-core"
import { getOrSetCache } from "@/lib/cache"

export const runtime = "nodejs"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

const CACHE_TTL_SECONDS = 24 * 60 * 60

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders })
}

export async function GET(req: Request) {
  const { user } = await getUserFromRequest(req)
  if (!user) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: corsHeaders },
    )
  }

  const url = new URL(req.url)
  const raw = (url.searchParams.get("domain") ?? "").trim().toLowerCase()
  if (!isValidDomain(raw)) {
    return NextResponse.json(
      { error: "invalid domain", domain: raw },
      { status: 400, headers: corsHeaders },
    )
  }

  // Cache key is per-domain. The report is identical for every user
  // hitting the same domain — no PII in the response — so a shared
  // cache row is correct.
  const report = await getOrSetCache(`domain-auth:${raw}`, CACHE_TTL_SECONDS, () =>
    checkDomain(raw),
  )

  return NextResponse.json(report, { headers: corsHeaders })
}
