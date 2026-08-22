import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * WhatsApp alert preferences. India/SEA users get pinged on WhatsApp when
 * an automation finishes or a hot reply lands — if they opt in here.
 */

async function save(formData: FormData) {
  "use server"
  const number = String(formData.get("whatsapp_number") ?? "").trim()
  const notify = formData.get("notify") === "on"
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  await supabase
    .from("users")
    .update({ whatsapp_number: number || null, notify_whatsapp: notify })
    .eq("id", user.id)
  redirect("/app/settings/notifications?saved=1")
}

export default async function NotificationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: row } = await supabase
    .from("users")
    .select("whatsapp_number, notify_whatsapp")
    .eq("id", user.id)
    .maybeSingle()

  const { saved } = await searchParams

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-5 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <h1 className="text-xl font-semibold tracking-tight">Notifications</h1>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          <Card className="glass-card overflow-hidden shadow-sm border-primary/10">
            <CardHeader className="px-6 py-5 bg-muted/20 border-b border-border/50">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-green-500/10 text-green-600 dark:text-green-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                </div>
                WhatsApp alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground mb-4">
                Get a WhatsApp ping when an automation finishes or a hot reply
                lands. Indian SMB teams respond on WhatsApp far faster than
                email — so do you.
              </p>
              <form action={save} className="flex flex-col gap-4">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Your WhatsApp number</span>
                  <input
                    name="whatsapp_number"
                    type="tel"
                    defaultValue={(row?.whatsapp_number as string) ?? ""}
                    placeholder="+91 98765 43210"
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <span className="text-xs text-muted-foreground">
                    Include the country code. Spaces and dashes are fine.
                  </span>
                </label>

                <label className="flex items-center gap-2.5 text-sm">
                  <input
                    name="notify"
                    type="checkbox"
                    defaultChecked={Boolean(row?.notify_whatsapp)}
                    className="size-4 accent-primary"
                  />
                  <span>Send me WhatsApp alerts</span>
                </label>

                <div className="flex items-center gap-4 mt-2">
                  <Button type="submit" className="shadow-sm">Save preferences</Button>
                  {saved && (
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-500 animate-fade-in flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      Saved successfully
                    </span>
                  )}
                </div>
              </form>

              <p className="text-[11px] text-muted-foreground mt-4 border-t border-border/50 pt-3">
                Live delivery needs a WhatsApp Business API provider configured
                by the workspace admin (Gupshup / Twilio / Interakt / Meta).
                Until then alerts run in demo mode.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  )
}
