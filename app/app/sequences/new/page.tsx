import { redirect } from "next/navigation"
import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Mail, Check, ArrowLeft } from "lucide-react"

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
    <div className="flex-1 flex flex-col h-full bg-background/50 relative overflow-hidden">
      {/* Decorative gradient blob */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-bl from-[var(--chart-violet)]/10 via-[var(--chart-amber)]/5 to-transparent blur-3xl -z-10 pointer-events-none opacity-40" />
      
      <header className="px-6 py-6 border-b border-border/50 flex flex-col gap-2">
        <Link
          href="/app/sequences"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 w-fit"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to sequences
        </Link>
        <h1 className="text-xl font-bold tracking-tight">New sequence</h1>
        <p className="text-sm text-muted-foreground">
          Design a multi-step outreach cadence.
        </p>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-8">
        <form action={createSequence} className="max-w-3xl mx-auto flex flex-col gap-8">
          <Card className="glass-card animate-slide-in-up">
            <CardHeader className="px-6 pt-6 pb-4 border-b border-border/50">
              <CardTitle className="text-lg">Sequence details</CardTitle>
            </CardHeader>
            <CardContent className="p-6 flex flex-col gap-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Name <span className="text-destructive">*</span>
                </label>
                <Input
                  name="name"
                  required
                  placeholder="Indian SaaS Founders — Outbound v1"
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Description <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <Textarea
                  name="description"
                  rows={2}
                  placeholder="3-touch sequence for cold outbound to SMB founders in BLR/Mumbai."
                  className="bg-background/50 resize-none"
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col relative animate-slide-in-up" style={{ animationDelay: '100ms' }}>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-6 ml-2">
              Cadence Steps
            </h3>
            
            {/* Vertical timeline connecting line */}
            <div className="absolute left-6 top-[3.5rem] bottom-8 w-px border-l-2 border-dashed border-border/60 z-0" />
            
            <div className="flex flex-col gap-6 z-10">
              {[0, 1, 2, 3, 4].map((i) => (
                <StepCard key={i} index={i} />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-4 mt-4 animate-slide-in-up" style={{ animationDelay: '500ms' }}>
            <Link href="/app/sequences">
              <Button type="button" variant="ghost">Cancel</Button>
            </Link>
            <Button type="submit" className="gap-2 bg-gradient-to-r from-primary to-primary/90 shadow-sm hover:shadow">
              <Check className="w-4 h-4" />
              Create sequence
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}

function StepCard({ index }: { index: number }) {
  const defaults =
    index === 0
      ? { day: 0, channel: "email", subjectPh: "quick question about {{company}}", title: "Initial touch" }
      : index === 1
        ? { day: 3, channel: "linkedin_dm", subjectPh: "", title: "Follow up 1" }
        : index === 2
          ? { day: 7, channel: "email", subjectPh: "re: my note from last week", title: "Follow up 2" }
          : { day: 0, channel: "email", subjectPh: "", title: `Follow up ${index}` }
          
  return (
    <div className="flex gap-4 relative group">
      {/* Timeline Node */}
      <div className="mt-6 flex flex-col items-center gap-1 min-w-[3rem]">
        <div className="w-8 h-8 rounded-full bg-background border-2 border-primary/30 flex items-center justify-center text-xs font-bold text-primary group-hover:border-primary/60 transition-colors shadow-sm">
          {index + 1}
        </div>
      </div>
      
      {/* Card */}
      <Card className="flex-1 glass-card hover:border-border/60 transition-all shadow-sm">
        <CardHeader className="px-5 py-4 border-b border-border/40 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{defaults.title}</CardTitle>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium bg-muted px-2 py-1 rounded-md">
            Optional
          </span>
        </CardHeader>
        
        <CardContent className="p-5 flex flex-col gap-5">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="w-full sm:w-1/3 space-y-1.5">
              <label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                Wait duration
              </label>
              <div className="relative">
                <Input
                  type="number"
                  name={`step_${index}_day`}
                  defaultValue={defaults.day}
                  min={0}
                  max={60}
                  className="bg-background/50 pl-14"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  Days
                </span>
              </div>
            </div>
            
            <div className="w-full sm:w-2/3 space-y-1.5">
              <label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                Channel
              </label>
              <div className="relative">
                <select
                  name={`step_${index}_channel`}
                  defaultValue={defaults.channel}
                  className="w-full h-10 rounded-md border border-input bg-background/50 px-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                >
                  <option value="email">Email</option>
                  <option value="linkedin_dm">LinkedIn DM</option>
                  <option value="task">Manual Task</option>
                </select>
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                  {/* We use CSS to show the right icon based on select value, but since it's uncontrolled in server form, we just put a generic generic icon or rely on the select label */}
                  <Mail className="w-4 h-4 opacity-50" />
                </div>
              </div>
            </div>
          </div>
          
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
              Subject template
            </label>
            <Input 
              name={`step_${index}_subject`} 
              placeholder={defaults.subjectPh} 
              className="bg-background/50 font-mono text-sm"
            />
          </div>
          
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
              Body template
            </label>
            <Textarea
              name={`step_${index}_body`}
              rows={4}
              placeholder={
                index === 0
                  ? "Leave blank to skip this step.\n\nUse {{first_name}} and {{company}} placeholders for personalization."
                  : "Leave blank to skip..."
              }
              className="bg-background/50 font-mono text-sm resize-none"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
