/**
 * GET /api/health
 *
 * Lightweight liveness probe. Returns 200 with a tiny JSON payload
 * indicating which integrations are wired (without exposing keys).
 * Safe to expose publicly — used by Vercel deploy checks and any
 * uptime monitor.
 */

import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "leadgenai",
    version: "0.5.0",
    timestamp: new Date().toISOString(),
    providers: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      brave: Boolean(process.env.BRAVE_SEARCH_KEY),
      google:
        Boolean(process.env.GOOGLE_CLIENT_ID) &&
        Boolean(process.env.GOOGLE_CLIENT_SECRET),
      supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      supabase_admin: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      github: Boolean(process.env.GITHUB_TOKEN),
    },
  })
}
