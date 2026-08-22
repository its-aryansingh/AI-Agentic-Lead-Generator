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
      <header className="px-6 py-5 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <h1 className="text-xl font-semibold tracking-tight">Voice anchor</h1>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          <Card className="glass-card shadow-sm border-primary/10">
            <CardHeader className="px-6 py-5 bg-muted/20 border-b border-border/50">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
                Match your writing voice
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
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
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  )
}
