import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * Voice anchor — the user pastes one example of an email they wrote so
 * the drafter can match their register. Persisted to public.users.
 */

async function save(formData: FormData) {
  "use server"
  const text = String(formData.get("voice") ?? "").trim()
  const language = String(formData.get("language") ?? "English").trim() || "English"
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  await supabase
    .from("users")
    .update({ voice_anchor_text: text || null, outreach_language: language })
    .eq("id", user.id)
  redirect("/app/settings/voice?saved=1")
}

export default async function VoiceSettingsPage({
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
    .select("voice_anchor_text, outreach_language")
    .eq("id", user.id)
    .maybeSingle()

  const { saved } = await searchParams

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b border-border">
        <h1 className="text-base font-semibold">Voice anchor</h1>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          <Card size="sm">
            <CardHeader className="px-4">
              <CardTitle>Match your writing voice</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Paste one example of an outbound email you&apos;ve written that
                you&apos;re proud of. We&apos;ll mirror its tone, length, and
                cadence in the drafts we generate.
              </p>
              <form action={save} className="flex flex-col gap-3">
                <Textarea
                  name="voice"
                  defaultValue={(row?.voice_anchor_text as string) ?? ""}
                  rows={10}
                  placeholder="Hey [Name] —&#10;&#10;Saw your post on..."
                />
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Outbound language</span>
                  <select
                    name="language"
                    defaultValue={(row?.outreach_language as string) ?? "English"}
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    {[
                      "English",
                      "Hindi",
                      "Hinglish",
                      "Tamil",
                      "Telugu",
                      "Bengali",
                      "Marathi",
                      "Kannada",
                      "Gujarati",
                      "Bahasa Indonesia",
                    ].map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted-foreground">
                    Drafts (subject + body) are written in this language; talking points stay in English.
                  </span>
                </label>
                <div className="flex items-center gap-3">
                  <Button type="submit">Save</Button>
                  {saved && (
                    <span className="text-xs text-muted-foreground">Saved.</span>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  )
}
