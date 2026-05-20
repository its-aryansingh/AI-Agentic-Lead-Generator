import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * /app/inbox — human-review queue for high-signal replies.
 *
 * Surfaces reply_classifications where needs_human = true and
 * handled = false: interested / question / objection. The detector
 * already stopped the cascade and auto-suppressed unsubscribes, so this
 * inbox is only the replies a salesperson actually wants to action.
 */

async function markHandled(formData: FormData) {
  "use server"
  const id = String(formData.get("id") ?? "")
  if (!id) return
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  await supabase
    .from("reply_classifications")
    .update({ handled: true })
    .eq("id", id)
  redirect("/app/inbox")
}

const CATEGORY_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  interested: "default",
  question: "outline",
  objection: "secondary",
}

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

  const replies = rows ?? []

  const recipientIds = Array.from(
    new Set(replies.map((r) => r.recipient_id as string).filter(Boolean)),
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

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b border-border">
        <h1 className="text-base font-semibold">Reply inbox</h1>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-3">
          {replies.length === 0 && (
            <Card size="sm">
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No replies waiting on you. When a prospect responds with
                interest, a question, or an objection, it&apos;ll surface here —
                unsubscribes and out-of-office replies are auto-handled.
              </CardContent>
            </Card>
          )}
          {replies.map((r) => {
            const email = emailByRecipient.get(r.recipient_id as string)
            return (
              <Card key={r.id as string} size="sm">
                <CardHeader className="px-4">
                  <CardTitle className="flex items-center gap-2 flex-wrap">
                    <Badge variant={CATEGORY_VARIANT[String(r.category)] ?? "outline"}>
                      {String(r.category)}
                    </Badge>
                    {email && <span className="text-sm">{email}</span>}
                    <span className="text-[11px] text-muted-foreground ml-auto">
                      {new Date(r.created_at as string).toLocaleString()}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="text-sm whitespace-pre-wrap">
                    {(r.snippet as string | null) ?? "(no preview)"}
                  </div>
                  <form action={markHandled} className="self-end">
                    <input type="hidden" name="id" value={r.id as string} />
                    <Button type="submit" size="sm" variant="outline">
                      Mark handled
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>
    </div>
  )
}
