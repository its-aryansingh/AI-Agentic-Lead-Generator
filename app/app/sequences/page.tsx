import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * /app/sequences — list of the user's multi-step outreach sequences.
 *
 * In v1.0 sequences are data-only: a sequence describes the cadence,
 * but actually sending is gated on the round-9 Gmail integration.
 */
export default async function SequencesPage() {
  const supabase = await createClient()
  const { data: rows } = await supabase
    .from("sequences")
    .select("id,name,description,is_active,created_at")
    .order("created_at", { ascending: false })
    .limit(50)

  const sequences = rows ?? []

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between">
        <h1 className="text-base font-semibold">Sequences</h1>
        <Link href="/app/sequences/new">
          <Button size="sm">+ New sequence</Button>
        </Link>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-3">
          {sequences.length === 0 && (
            <Card size="sm">
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No sequences yet. Build your first multi-step cadence (e.g.{" "}
                <em>D0 email → D3 LinkedIn DM → D7 followup</em>) to enroll
                prospects in.
              </CardContent>
            </Card>
          )}
          {sequences.map((s) => (
            <Link
              key={s.id as string}
              href={`/app/sequences/${s.id}`}
              className="block hover:opacity-90 transition-opacity"
            >
              <Card size="sm">
                <CardHeader className="px-4">
                  <CardTitle className="flex items-center gap-2">
                    {s.name as string}
                    {!s.is_active && <Badge variant="secondary">paused</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {(s.description as string | null) ?? "No description."}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
