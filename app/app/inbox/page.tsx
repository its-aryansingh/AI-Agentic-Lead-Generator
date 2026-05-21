import { createClient } from "@/lib/supabase/server"
import { InboxClient, type Reply } from "./inbox-client"

/**
 * /app/inbox — human-review queue for high-signal replies.
 *
 * Surfaces reply_classifications where needs_human = true and
 * handled = false: interested / question / objection. 
 */



export default async function InboxPage() {
  const supabase = await createClient()

  // RLS scopes reply_classifications to the user's own campaigns via the
  // recipient → campaign chain. We fetch classifications, then resolve
  // recipient emails in a second query — avoids embedded-select type
  // inference issues (no generated Database types in this project).
  const { data: rows } = await supabase
    .from("reply_classifications")
    .select("id,category,confidence,snippet,created_at,recipient_id")
    .eq("needs_human", true)
    .eq("handled", false)
    .order("created_at", { ascending: false })
    .limit(50)

  const classificationRows = rows ?? []

  const recipientIds = Array.from(
    new Set(classificationRows.map((r) => r.recipient_id as string).filter(Boolean)),
  )
  const emailByRecipient = new Map<string, string>()
  if (recipientIds.length > 0) {
    const { data: recipientRows } = await supabase
      .from("campaign_recipients")
      .select("id,email")
      .in("id", recipientIds)
    for (const rr of recipientRows ?? []) {
      emailByRecipient.set(rr.id as string, (rr.email as string) ?? "")
    }
  }

  const replies: Reply[] = classificationRows.map(r => ({
    id: r.id as string,
    category: r.category as string,
    confidence: r.confidence as number | null,
    snippet: r.snippet as string | null,
    created_at: r.created_at as string,
    email: emailByRecipient.get(r.recipient_id as string) ?? null
  }))

  return (
    <div className="flex-1 flex flex-col h-full bg-background/50 relative overflow-hidden">
      {/* Decorative gradient blob */}
      <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-br from-[var(--chart-violet)]/10 via-[var(--chart-sky)]/5 to-transparent blur-3xl -z-10 pointer-events-none opacity-50" />
      
      <header className="px-6 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Reply inbox</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review and handle high-signal responses from your campaigns.
          </p>
        </div>
      </header>

      <section className="flex-1 overflow-y-auto px-6">
        <InboxClient replies={replies} />
      </section>
    </div>
  )
}
