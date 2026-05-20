import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * /app/sequences/new — minimal builder.
 *
 * Accepts up to 5 steps in a single form. Each step has channel +
 * day_offset + subject + body. Server action persists atomically.
 *
 * Visual drag-drop reordering and template variables ({{first_name}})
 * land in v1.1; this is the minimum-viable shape so the data model
 * has real data to drive UI off.
 */

async function createSequence(formData: FormData) {
  "use server"
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const name = String(formData.get("name") ?? "").trim()
  if (!name) redirect("/app/sequences/new?error=name_required")
  const description = String(formData.get("description") ?? "").trim() || null

  const { data: seq, error } = await supabase
    .from("sequences")
    .insert({ user_id: user.id, name, description })
    .select("id")
    .single()
  if (error || !seq) redirect("/app/sequences/new?error=create_failed")

  // Pull up to 5 steps from the form (step_0_*, step_1_*, ...)
  const steps: Array<{
    step_order: number
    day_offset: number
    channel: "email" | "linkedin_dm" | "task"
    subject_template: string | null
    body_template: string
  }> = []
  for (let i = 0; i < 5; i++) {
    const body = String(formData.get(`step_${i}_body`) ?? "").trim()
    if (!body) continue
    const channelRaw = String(formData.get(`step_${i}_channel`) ?? "email")
    const channel: "email" | "linkedin_dm" | "task" =
      channelRaw === "linkedin_dm" || channelRaw === "task" ? channelRaw : "email"
    steps.push({
      step_order: steps.length,
      day_offset: Number(formData.get(`step_${i}_day`) ?? 0) || 0,
      channel,
      subject_template:
        String(formData.get(`step_${i}_subject`) ?? "").trim() || null,
      body_template: body,
    })
  }

  if (steps.length > 0) {
    await supabase.from("sequence_steps").insert(
      steps.map((s) => ({ ...s, sequence_id: seq.id })),
    )
  }

  redirect(`/app/sequences/${seq.id}`)
}

export default function NewSequencePage() {
  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b border-border">
        <h1 className="text-base font-semibold">New sequence</h1>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <form action={createSequence} className="max-w-3xl mx-auto flex flex-col gap-4">
          <Card size="sm">
            <CardHeader className="px-4">
              <CardTitle>Sequence details</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div>
                <label className="text-xs uppercase tracking-wide text-muted-foreground mb-1 block">
                  Name
                </label>
                <Input
                  name="name"
                  required
                  placeholder="Indian SaaS Founders — Outbound v1"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted-foreground mb-1 block">
                  Description (optional)
                </label>
                <Textarea
                  name="description"
                  rows={2}
                  placeholder="3-touch sequence for cold outbound to SMB founders in BLR/Mumbai."
                />
              </div>
            </CardContent>
          </Card>

          {[0, 1, 2, 3, 4].map((i) => (
            <StepCard key={i} index={i} />
          ))}

          <div className="flex items-center justify-end gap-2">
            <Button type="submit">Create sequence</Button>
          </div>
        </form>
      </section>
    </div>
  )
}

function StepCard({ index }: { index: number }) {
  const defaults =
    index === 0
      ? { day: 0, channel: "email", subjectPh: "quick question about {{company}}" }
      : index === 1
        ? { day: 3, channel: "linkedin_dm", subjectPh: "" }
        : index === 2
          ? { day: 7, channel: "email", subjectPh: "re: my note from last week" }
          : { day: 0, channel: "email", subjectPh: "" }
  return (
    <Card size="sm">
      <CardHeader className="px-4">
        <CardTitle>Step {index + 1}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs uppercase tracking-wide text-muted-foreground mb-1 block">
              Day offset
            </label>
            <Input
              type="number"
              name={`step_${index}_day`}
              defaultValue={defaults.day}
              min={0}
              max={60}
            />
          </div>
          <div className="flex-1">
            <label className="text-xs uppercase tracking-wide text-muted-foreground mb-1 block">
              Channel
            </label>
            <select
              name={`step_${index}_channel`}
              defaultValue={defaults.channel}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="email">Email</option>
              <option value="linkedin_dm">LinkedIn DM</option>
              <option value="task">Task / call</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground mb-1 block">
            Subject template
          </label>
          <Input name={`step_${index}_subject`} placeholder={defaults.subjectPh} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground mb-1 block">
            Body template
          </label>
          <Textarea
            name={`step_${index}_body`}
            rows={4}
            placeholder={
              index === 0
                ? "Leave blank to skip this step. Otherwise: write the body. Use {{first_name}} / {{company}} placeholders."
                : ""
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}
