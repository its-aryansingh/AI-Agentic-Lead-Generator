/**
 * POST /api/cron/advance-sequences
 *
 * Scans for active sequence enrollments and schedules the next email
 * in the cadence if the wait duration has elapsed and no reply was received.
 */

import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { hydrateTemplate } from "@/lib/sequence-utils"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function authorized(req: Request): boolean {
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  return Boolean(process.env.CRON_SECRET) && provided === process.env.CRON_SECRET
}

export async function POST(req: Request) {
  if (!authorized(req)) return new NextResponse("Forbidden", { status: 403 })
  const supabase = createAdminClient()

  // 1. Get all active enrollments with their prospect details
  const { data: enrollments, error: enrollmentsErr } = await supabase
    .from("sequence_enrollments")
    .select(`
      id,
      sequence_id,
      prospect_id,
      current_step,
      enrolled_at,
      prospects (
        id,
        name,
        company,
        title,
        email
      )
    `)
    .eq("status", "active")
    .limit(100) // Batch processing

  if (enrollmentsErr || !enrollments || enrollments.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  let processedCount = 0

  for (const enrollment of enrollments) {
    const prospect = enrollment.prospects as unknown as {
      id: string
      name: string | null
      company: string | null
      title: string | null
      email: string | null
    } | null
    if (!prospect) continue

    // 2. Fetch the sequence steps for this sequence
    const { data: steps } = await supabase
      .from("sequence_steps")
      .select("*")
      .eq("sequence_id", enrollment.sequence_id as string)
      .order("step_order", { ascending: true })

    if (!steps || steps.length === 0) continue

    const nextStepOrder = (enrollment.current_step as number) + 1
    const nextStep = steps.find(s => s.step_order === nextStepOrder)

    // If there is no next step, mark enrollment as completed
    if (!nextStep) {
      await supabase
        .from("sequence_enrollments")
        .update({ status: "completed" })
        .eq("id", enrollment.id as string)
      continue
    }

    // 3. Find the campaign this prospect is in for this sequence.
    // We look at campaign_recipients joined with campaigns.
    const { data: lastRecipientRow } = await supabase
      .from("campaign_recipients")
      .select(`
        id,
        campaign_id,
        user_id,
        status,
        sent_at,
        scheduled_for,
        campaigns!inner (
          sequence_id
        )
      `)
      .eq("prospect_id", prospect.id as string)
      .eq("campaigns.sequence_id", enrollment.sequence_id as string)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!lastRecipientRow) continue

    // If the last step is still pending, skip
    if (lastRecipientRow.status === "scheduled") continue

    // If the last step failed or bounced, maybe we should halt?
    if (["bounced", "unsubscribed", "failed"].includes(lastRecipientRow.status as string)) {
      await supabase
        .from("sequence_enrollments")
        .update({ status: lastRecipientRow.status === "failed" ? "paused" : lastRecipientRow.status })
        .eq("id", enrollment.id as string)
      continue
    }

    // Has the wait duration elapsed since the last step was sent (or since step 0)?
    // User requested "no wait" in interpretation -> we interpret day_offset as days since Step 0 (enrolled_at).
    // Or days since last sent? Usually it's days since enrollment. Let's do days since enrolled_at.
    const referenceDate = new Date(enrollment.enrolled_at as string)
    const targetDate = new Date(referenceDate.getTime() + (nextStep.day_offset as number) * 24 * 60 * 60 * 1000)
    
    if (new Date() < targetDate) {
      continue // Not time yet
    }

    // 4. Generate the email and schedule it
    const subject = hydrateTemplate(nextStep.subject_template as string || "", prospect)
    const body = hydrateTemplate(nextStep.body_template as string, prospect)

    await supabase.from("campaign_recipients").insert({
      campaign_id: lastRecipientRow.campaign_id,
      user_id: lastRecipientRow.user_id,
      prospect_id: prospect.id,
      email: prospect.email,
      subject: subject || `Following up with ${prospect.company || "you"}`,
      body: body,
      status: "scheduled",
      scheduled_for: new Date().toISOString(),
    })

    // 5. Update the enrollment
    await supabase
      .from("sequence_enrollments")
      .update({ current_step: nextStepOrder })
      .eq("id", enrollment.id as string)

    processedCount++
  }

  return NextResponse.json({ processed: processedCount })
}

export { POST as GET }
