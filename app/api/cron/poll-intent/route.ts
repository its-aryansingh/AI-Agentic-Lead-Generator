/**
 * POST /api/cron/poll-intent
 *
 * Scans the user's intent_watches and writes intent_triggers for any
 * recent matches. Auth: requires the CRON_SECRET header — Vercel Cron
 * (or any uptime monitor) is the only legitimate caller.
 *
 * v1.0 sources: HN Algolia + GitHub. v1.1 will add funding feeds
 * (Crunchbase/Tracxn equivalent) and press-release scrapers.
 */

import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/server"
import { searchHnUsers } from "@/lib/providers/hn-algolia"
import { searchGithubUsers } from "@/lib/providers/github"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

interface Watch {
  id: string
  user_id: string
  query: string
  sources: string[]
}

interface TriggerInsert {
  user_id: string
  trigger_type: string
  account_name: string | null
  account_domain: string | null
  payload: Record<string, unknown>
  source_url: string | null
  occurred_at: string
}

export async function POST(req: Request) {
  // Cron-secret gate. Without it anyone could DDoS the pollers.
  const auth = req.headers.get("authorization") ?? ""
  const provided = auth.replace(/^Bearer\s+/i, "")
  if (
    !process.env.CRON_SECRET ||
    provided !== process.env.CRON_SECRET
  ) {
    return new NextResponse("Forbidden", { status: 403 })
  }

  const supabase = createAdminClient()
  const { data: watchRows } = await supabase
    .from("intent_watches")
    .select("id,user_id,query,sources")
    .limit(500)

  const watches: Watch[] = (watchRows ?? []).map((r) => ({
    id: r.id as string,
    user_id: r.user_id as string,
    query: r.query as string,
    sources: (r.sources as string[] | null) ?? ["hn_algolia", "github"],
  }))

  let written = 0
  for (const w of watches) {
    const triggers: TriggerInsert[] = []

    if (w.sources.includes("hn_algolia")) {
      try {
        const hits = await searchHnUsers(w.query, 5)
        for (const h of hits) {
          triggers.push({
            user_id: w.user_id,
            trigger_type: "hn_post",
            account_name: h.name,
            account_domain: null,
            payload: { snippet: h.snippet, source: "hn" },
            source_url: h.source_url,
            occurred_at: new Date().toISOString(),
          })
        }
      } catch {
        // skip this source on error — the next one may still work
      }
    }

    if (w.sources.includes("github")) {
      try {
        const hits = await searchGithubUsers(w.query, 5)
        for (const h of hits) {
          triggers.push({
            user_id: w.user_id,
            trigger_type: "github_star_spike",
            account_name: h.name,
            account_domain: null,
            payload: {
              title: h.title,
              company: h.company,
              location: h.location,
            },
            source_url: h.source_url,
            occurred_at: new Date().toISOString(),
          })
        }
      } catch {
        // skip
      }
    }

    if (triggers.length > 0) {
      const { error } = await supabase.from("intent_triggers").insert(triggers)
      if (!error) written += triggers.length
    }
  }

  return NextResponse.json({ watches: watches.length, triggers_written: written })
}

export { POST as GET }
