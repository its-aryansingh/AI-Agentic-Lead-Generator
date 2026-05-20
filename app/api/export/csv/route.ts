/**
 * GET /api/export/csv?jobId=<uuid>
 *
 * Streams the prospects for a given job back as a CSV download.
 * Auth: must own the job (RLS enforces this when called with the user's
 * Supabase client).
 */

import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { rowsToCsv, type ProspectRow } from "@/lib/providers/google-sheets"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse("Unauthorized", { status: 401 })

  const url = new URL(req.url)
  const jobId = url.searchParams.get("jobId")
  if (!jobId) return new NextResponse("jobId required", { status: 400 })

  // RLS scopes this to the user's own jobs.
  const { data: prospects, error } = await supabase
    .from("prospects")
    .select(
      "input_name,input_company,input_linkedin_url,email,email_confidence,research_summary,email_subject,email_body,talking_points",
    )
    .eq("job_id", jobId)

  if (error) {
    return new NextResponse(error.message, { status: 400 })
  }

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

  const csv = rowsToCsv(rows)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leadgenai-${jobId}.csv"`,
    },
  })
}
