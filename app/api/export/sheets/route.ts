/**
 * POST /api/export/sheets
 * Body: { jobId: string }
 *
 * Pushes a job's prospects to a new Google Sheet in the user's Drive
 * (scope drive.file). Returns the URL. If Google isn't connected, returns
 * a deterministic mock URL so the rest of the UI flow still completes.
 */

import { NextResponse } from "next/server"

import { createClient, createAdminClient } from "@/lib/supabase/server"
import { exportToSheet, type ProspectRow } from "@/lib/providers/google-sheets"

export const runtime = "nodejs"
export const maxDuration = 30

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse("Unauthorized", { status: 401 })

  let body: { jobId?: string }
  try {
    body = await req.json()
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 })
  }
  if (!body.jobId) return new NextResponse("jobId required", { status: 400 })

  // Load prospects via the user's client so RLS enforces ownership.
  const { data: prospects, error } = await supabase
    .from("prospects")
    .select(
      "input_name,input_company,input_linkedin_url,email,email_confidence,research_summary,email_subject,email_body,talking_points",
    )
    .eq("job_id", body.jobId)
  if (error) return new NextResponse(error.message, { status: 400 })

  // Refresh token lives on the public.users row (set at OAuth callback).
  const { data: userRow } = await supabase
    .from("users")
    .select("google_refresh_token")
    .eq("id", user.id)
    .maybeSingle()

  const rows: ProspectRow[] = (prospects ?? []).map((p) => {
    const tp = p.talking_points as string[] | null
    return {
      name: (p.input_name as string) ?? "",
      title: "",
      company: (p.input_company as string) ?? "",
      email: (p.email as string) ?? null,
      email_confidence: (p.email_confidence as string) ?? null,
      research_summary: (p.research_summary as string) ?? null,
      email_subject: (p.email_subject as string) ?? null,
      email_body: (p.email_body as string) ?? null,
      talking_points: tp,
      source_url: (p.input_linkedin_url as string) ?? null,
    }
  })

  const sheet = await exportToSheet({
    refreshToken: (userRow?.google_refresh_token as string) ?? null,
    title: `LeadGenAI — Job ${body.jobId.slice(0, 8)} — ${new Date().toLocaleString()}`,
    rows,
  })

  // Update the job row with the sheet URL — service-role bypasses RLS.
  const admin = createAdminClient()
  await admin
    .from("jobs")
    .update({ sheet_url: sheet.url })
    .eq("id", body.jobId)
    .eq("user_id", user.id)

  return NextResponse.json({ url: sheet.url, mock: sheet.mock })
}
