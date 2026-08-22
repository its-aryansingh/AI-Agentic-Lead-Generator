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
      <header className="px-6 py-5 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <h1 className="text-xl font-semibold tracking-tight">Privacy &amp; DPDP</h1>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          <Card className="glass-card overflow-hidden shadow-sm border-destructive/20 relative">
            <div className="absolute top-0 left-0 w-1 h-full bg-destructive/50" />
            <CardHeader className="px-6 py-5 bg-destructive/5 border-b border-destructive/10">
              <CardTitle className="text-base font-medium flex items-center gap-2 text-destructive">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                Right to erasure (Danger Zone)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
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
                <div className="flex items-center gap-4 mt-2">
                  <Button type="submit" variant="destructive" className="shadow-sm">
                    Erase &amp; suppress
                  </Button>
                  {erased && (
                    <span className="text-xs font-medium text-destructive animate-fade-in flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      Erasure processed
                    </span>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="glass-card shadow-sm border-primary/10">
            <CardHeader className="px-6 py-5 bg-muted/20 border-b border-border/50">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                Recent requests
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
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
