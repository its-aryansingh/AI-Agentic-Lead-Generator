/**
 * DPDP (India Digital Personal Data Protection Act) — right to erasure.
 *
 * eraseContact removes a data subject's stored personal data (prospect
 * rows across the user's jobs), records a permanent never-contact
 * suppression, and writes an audit row. User-initiated only (a settings
 * action), never an autonomous agent tool — erasure is destructive.
 */

import { createAdminClient } from "@/lib/supabase/server"
import { sha256Email } from "@/lib/email-compliance"

export interface ErasureResult {
  erased: number
  suppressed: boolean
}

export async function eraseContact(userId: string, email: string): Promise<ErasureResult> {
  const supabase = createAdminClient()
  const clean = email.trim().toLowerCase()
  const emailHash = sha256Email(clean)

  // 1. Delete prospect rows carrying this email across the user's jobs.
  const { data: jobs } = await supabase.from("jobs").select("id").eq("user_id", userId)
  const jobIds = (jobs ?? []).map((j) => j.id as string)

  let erased = 0
  if (jobIds.length > 0) {
    const { count } = await supabase
      .from("prospects")
      .delete({ count: "exact" })
      .eq("email", clean)
      .in("job_id", jobIds)
    erased = count ?? 0

    // Enrichment stores a second copy of the contact surface in
    // public_contacts (with source URLs) and a normalized phone. Deleting
    // the row by `email` misses any prospect whose primary email differs
    // but whose enriched payload still carries this address — erasure has
    // to reach those too, or the data survives the request.
    const { data: leftovers } = await supabase
      .from("prospects")
      .select("id,public_contacts")
      .in("job_id", jobIds)
      .not("public_contacts", "is", null)

    const contaminated = (leftovers ?? [])
      .filter((row) => {
        const pc = row.public_contacts as { emails?: Array<{ value?: string }> } | null
        return (pc?.emails ?? []).some((e) => e?.value?.toLowerCase() === clean)
      })
      .map((row) => row.id as string)

    if (contaminated.length > 0) {
      await supabase
        .from("prospects")
        .update({
          public_contacts: null,
          phone_e164: null,
          phone_source: null,
          enrichment_status: null,
          enrichment_run_id: null,
          enriched_at: null,
        })
        .in("id", contaminated)
      erased += contaminated.length
    }

    // enrichment_runs holds only counters and source URLs (never contact
    // values), but the run is still linked to an erased subject.
    await supabase
      .from("enrichment_runs")
      .delete()
      .eq("user_id", userId)
      .in("prospect_id", contaminated)
  }

  // 2. Never contact again. Best-effort: the suppression row is minimal
  //    (user_id + email_hash); a duplicate is fine.
  let suppressed = false
  try {
    const { error } = await supabase
      .from("suppressions")
      .insert({ user_id: userId, email_hash: emailHash })
    suppressed = !error
  } catch {
    suppressed = false
  }

  // 3. Audit row (DPDP accountability).
  await supabase.from("data_subject_requests").insert({
    user_id: userId,
    email_hash: emailHash,
    type: "erasure",
    status: "completed",
    prospects_erased: erased,
  })

  return { erased, suppressed }
}
