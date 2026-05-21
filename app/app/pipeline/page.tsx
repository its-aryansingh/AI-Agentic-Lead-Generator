import { createClient } from "@/lib/supabase/server"
import { PipelineClient, type Recipient } from "./pipeline-client"

/**
 * /app/pipeline — kanban view of every campaign recipient by stage.
 *
 * Drag-to-advance kanban board. Updates recipient statuses.
 */

export default async function PipelinePage() {
  const supabase = await createClient()

  const { data: rows } = await supabase
    .from("campaign_recipients")
    .select("id,email,subject,status,sent_at,reply_at,campaign_id")
    .order("created_at", { ascending: false })
    .limit(500)

  const recipients: Recipient[] = (rows ?? []).map(r => ({
    id: r.id as string,
    email: r.email as string,
    subject: r.subject as string | null,
    status: r.status as string,
    sent_at: r.sent_at as string | null,
    campaign_id: r.campaign_id as string | null
  }))

  return (
    <div className="flex-1 flex flex-col h-full bg-background/50 relative overflow-hidden">
      {/* Decorative gradient blob */}
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-gradient-to-bl from-[var(--chart-violet)]/10 via-[var(--chart-teal)]/5 to-transparent blur-3xl -z-10 pointer-events-none opacity-50" />
      
      <header className="px-6 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track campaign recipients across all stages of outreach.
          </p>
        </div>
        <div className="bg-muted px-3 py-1.5 rounded-full text-sm font-medium">
          {recipients.length} total
        </div>
      </header>

      <section className="flex-1 overflow-x-auto px-6 hide-scrollbar cursor-grab active:cursor-grabbing">
        <PipelineClient initialRecipients={recipients} />
      </section>
    </div>
  )
}
