import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * /app/pipeline — kanban view of every campaign recipient by stage.
 *
 * Columns mirror the recipient lifecycle. Pure read view in v1.1;
 * drag-to-advance and bulk actions land in v1.2.
 */

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: "scheduled", label: "Scheduled" },
  { key: "sent", label: "Sent" },
  { key: "opened", label: "Opened" },
  { key: "replied", label: "Replied" },
  { key: "bounced", label: "Bounced" },
  { key: "unsubscribed", label: "Unsubscribed" },
]

export default async function PipelinePage() {
  const supabase = await createClient()

  const { data: rows } = await supabase
    .from("campaign_recipients")
    .select("id,email,subject,status,sent_at,reply_at,campaign_id")
    .order("created_at", { ascending: false })
    .limit(500)

  const recipients = rows ?? []
  const byStatus = COLUMNS.reduce<Record<string, typeof recipients>>(
    (acc, col) => {
      acc[col.key] = recipients.filter((r) => r.status === col.key)
      return acc
    },
    {},
  )

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between">
        <h1 className="text-base font-semibold">Pipeline</h1>
        <span className="text-xs text-muted-foreground">
          {recipients.length} recipient{recipients.length === 1 ? "" : "s"}
        </span>
      </header>

      <section className="flex-1 overflow-x-auto px-6 py-6">
        {recipients.length === 0 ? (
          <Card size="sm" className="max-w-md">
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No campaign recipients yet. Build a sequence, connect a mailbox,
              and launch a campaign to populate the pipeline.
            </CardContent>
          </Card>
        ) : (
          <div className="flex gap-4 min-w-max">
            {COLUMNS.map((col) => {
              const items = byStatus[col.key] ?? []
              return (
                <div key={col.key} className="w-64 flex flex-col gap-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {col.label}
                    </span>
                    <Badge variant="outline">{items.length}</Badge>
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.slice(0, 50).map((r) => (
                      <Card key={r.id as string} size="sm">
                        <CardHeader className="px-3">
                          <CardTitle className="text-xs truncate">
                            {(r.email as string) ?? "(no email)"}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="px-3 text-[11px] text-muted-foreground truncate">
                          {(r.subject as string) ?? ""}
                        </CardContent>
                      </Card>
                    ))}
                    {items.length === 0 && (
                      <div className="text-[11px] text-muted-foreground px-1">
                        —
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
