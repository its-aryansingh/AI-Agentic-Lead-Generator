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
      <header className="px-6 py-4 border-b border-border">
        <h1 className="text-base font-semibold">Notifications</h1>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          <Card size="sm">
            <CardHeader className="px-4">
              <CardTitle>WhatsApp alerts</CardTitle>
            </CardHeader>
            <CardContent>
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

                <div className="flex items-center gap-3">
                  <Button type="submit">Save</Button>
                  {saved && (
                    <span className="text-xs text-muted-foreground">Saved.</span>
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
