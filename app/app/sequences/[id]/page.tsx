import { notFound } from "next/navigation"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * /app/sequences/[id] — read-only detail view.
 *
 * Shows the cadence (ordered steps) + current enrollment counts by
 * status. Send-side actions (pause, advance) land with Gmail OAuth.
 */
export default async function SequenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: seq } = await supabase
    .from("sequences")
    .select("id,name,description,is_active,created_at")
    .eq("id", id)
    .maybeSingle()
  if (!seq) notFound()

  const { data: stepRows } = await supabase
    .from("sequence_steps")
    .select("step_order,day_offset,channel,subject_template,body_template")
    .eq("sequence_id", id)
    .order("step_order", { ascending: true })

  const { data: enrollmentRows } = await supabase
    .from("sequence_enrollments")
    .select("status")
    .eq("sequence_id", id)

  const steps = stepRows ?? []
  const enrollments = enrollmentRows ?? []
  const countsByStatus = enrollments.reduce<Record<string, number>>(
    (acc, r) => {
      const k = String(r.status)
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    },
    {},
  )

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-center gap-3">
        <Link
          href="/app/sequences"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ← all sequences
        </Link>
        <h1 className="text-base font-semibold truncate">{seq.name as string}</h1>
        {!seq.is_active && <Badge variant="secondary">paused</Badge>}
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {seq.description && (
            <p className="text-sm text-muted-foreground">{seq.description as string}</p>
          )}

          <Card size="sm">
            <CardHeader className="px-4">
              <CardTitle>Cadence</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {steps.length === 0 && (
                <div className="text-sm text-muted-foreground">No steps yet.</div>
              )}
              {steps.map((s) => (
                <div
                  key={s.step_order as number}
                  className="border border-border rounded-md p-3"
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Badge variant="outline">
                      Day {(s.day_offset as number) ?? 0}
                    </Badge>
                    <span>· {String(s.channel)}</span>
                  </div>
                  {s.subject_template && (
                    <div className="text-sm font-medium mb-1">
                      Subject: {String(s.subject_template)}
                    </div>
                  )}
                  <div className="text-sm whitespace-pre-wrap">
                    {String(s.body_template)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader className="px-4">
              <CardTitle>Enrollments</CardTitle>
            </CardHeader>
            <CardContent>
              {enrollments.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No prospects enrolled. In a chat, ask the agent to
                  &ldquo;enroll the last bulk-job prospects in this sequence.&rdquo;
                </div>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {Object.entries(countsByStatus).map(([k, v]) => (
                    <li key={k} className="flex justify-between">
                      <span className="text-muted-foreground">{k}</span>
                      <span className="font-medium">{v}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="text-xs text-muted-foreground italic">
            Send leg lands in round 9 (Gmail OAuth). For now sequences capture
            the cadence design and prospect enrollment; emails do not actually
            ship out.
          </div>
        </div>
      </section>
    </div>
  )
}
