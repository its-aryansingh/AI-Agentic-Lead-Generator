import { notFound } from "next/navigation"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { JobDetailActions, ProspectActions } from "./components/actions"

/**
 * /app/jobs/[id] — inline view of every prospect in a bulk job.
 *
 * RLS scopes the prospects query to jobs owned by the current user.
 * Sensitive: when a job is still running this also shows pending rows.
 */
export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: job } = await supabase
    .from("jobs")
    .select("id,status,prospect_count,sheet_url,created_at,completed_at,error_reason")
    .eq("id", id)
    .maybeSingle()
  if (!job) notFound()

  const { data: prospects } = await supabase
    .from("prospects")
    .select(
      "id,input_name,input_company,input_linkedin_url,status,email,email_confidence,research_summary,email_subject,email_body,talking_points",
    )
    .eq("job_id", id)
    .order("created_at", { ascending: true })

  const rows = prospects ?? []

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/app/jobs"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            ← all jobs
          </Link>
          <h1 className="text-base font-semibold truncate">
            Job {(job.id as string).slice(0, 8)}
          </h1>
          <Badge
            variant={
              job.status === "completed"
                ? "default"
                : job.status === "failed"
                  ? "destructive"
                  : "secondary"
            }
          >
            {String(job.status)}
          </Badge>
        </div>
        <JobDetailActions
          jobId={job.id as string}
          sheetUrl={(job.sheet_url as string | null) ?? null}
        />
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-4xl mx-auto flex flex-col gap-4">
          <div className="text-xs text-muted-foreground">
            {(job.prospect_count as number) ?? rows.length} prospect
            {((job.prospect_count as number) ?? rows.length) === 1 ? "" : "s"} ·{" "}
            {new Date(job.created_at as string).toLocaleString()}
            {job.completed_at && (
              <>
                {" · completed in "}
                {Math.max(
                  1,
                  Math.round(
                    (new Date(job.completed_at as string).getTime() -
                      new Date(job.created_at as string).getTime()) /
                      1000,
                  ),
                )}
                s
              </>
            )}
          </div>

          {job.error_reason && (
            <Card size="sm">
              <CardContent className="py-3 text-sm text-destructive">
                Error: {String(job.error_reason)}
              </CardContent>
            </Card>
          )}

          {rows.length === 0 && (
            <Card size="sm">
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No prospects on this job yet.
              </CardContent>
            </Card>
          )}

          {rows.map((p) => (
            <ProspectCard key={p.id as string} prospect={p} />
          ))}
        </div>
      </section>
    </div>
  )
}

function ProspectCard({
  prospect,
}: {
  prospect: Record<string, unknown>
}) {
  const name = (prospect.input_name as string | null) ?? "(unnamed)"
  const company = (prospect.input_company as string | null) ?? ""
  const linkedin = (prospect.input_linkedin_url as string | null) ?? ""
  const email = (prospect.email as string | null) ?? null
  const emailConf =
    (prospect.email_confidence as string | null) ?? "unknown"
  const research = (prospect.research_summary as string | null) ?? ""
  const subject = (prospect.email_subject as string | null) ?? ""
  const body = (prospect.email_body as string | null) ?? ""
  const tps = (prospect.talking_points as string[] | null) ?? []
  const fullEmail = subject ? `Subject: ${subject}\n\n${body}` : ""

  return (
    <Card size="sm">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <span>
            {name}
            {company && (
              <span className="text-muted-foreground font-normal">
                {" — "}
                {company}
              </span>
            )}
          </span>
          {linkedin && (
            <a
              href={linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] underline underline-offset-2 text-muted-foreground"
            >
              source
            </a>
          )}
          {email && (
            <Badge
              variant={
                emailConf === "valid"
                  ? "default"
                  : emailConf === "invalid"
                    ? "destructive"
                    : "outline"
              }
            >
              {email}
            </Badge>
          )}
          <ProspectActions fullEmail={fullEmail} subject={subject} body={body} />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {research && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              Research
            </div>
            <div className="whitespace-pre-wrap">{research}</div>
          </div>
        )}
        {subject && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              Subject
            </div>
            <div className="whitespace-pre-wrap">{subject}</div>
          </div>
        )}
        {body && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              Email
            </div>
            <div className="whitespace-pre-wrap">{body}</div>
          </div>
        )}
        {tps.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              Talking points
            </div>
            <ul className="list-disc pl-4 flex flex-col gap-1">
              {tps.map((tp, i) => (
                <li key={i}>{tp}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
