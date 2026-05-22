import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { eraseContact } from "@/lib/dpdp"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * Privacy & DPDP — right-to-erasure self-service. Enter a contact's email
 * to delete their stored data and suppress future contact, with an audit
 * trail (India DPDP Act 2026).
 */

async function erase(formData: FormData) {
  "use server"
  const email = String(formData.get("email") ?? "").trim()
  if (!email) redirect("/app/settings/privacy")
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  await eraseContact(user.id, email)
  redirect("/app/settings/privacy?erased=1")
}

interface RequestRow {
  id: string
  type: string
  status: string
  prospects_erased: number
  created_at: string
}

export default async function PrivacySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ erased?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: requests } = await supabase
    .from("data_subject_requests")
    .select("id,type,status,prospects_erased,created_at")
    .order("created_at", { ascending: false })
    .limit(10)

  const { erased } = await searchParams
  const list = (requests ?? []) as RequestRow[]

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b border-border">
        <h1 className="text-base font-semibold">Privacy &amp; DPDP</h1>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          <Card size="sm">
            <CardHeader className="px-4">
              <CardTitle>Right to erasure</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Under India&apos;s DPDP Act, a person can ask you to delete
                their data. Enter their email to permanently remove their
                prospect records and add them to your never-contact list. This
                cannot be undone.
              </p>
              <form action={erase} className="flex flex-col gap-3">
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="person@company.com"
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <div className="flex items-center gap-3">
                  <Button type="submit" variant="destructive">
                    Erase &amp; suppress
                  </Button>
                  {erased && (
                    <span className="text-xs text-muted-foreground">
                      Erasure processed.
                    </span>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader className="px-4">
              <CardTitle>Recent requests</CardTitle>
            </CardHeader>
            <CardContent>
              {list.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No erasure requests yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {list.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0 last:pb-0"
                    >
                      <span className="text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                      <span>
                        {r.type} · {r.status} ·{" "}
                        <span className="text-foreground">
                          {r.prospects_erased} record
                          {r.prospects_erased === 1 ? "" : "s"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground mt-4 border-t border-border/50 pt-3">
                Email addresses are stored only as salted hashes in this log.
                Every outbound email already carries one-click unsubscribe;
                unsubscribes and bounces are auto-suppressed.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  )
}
