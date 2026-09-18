"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  buildIntakeProspect,
  MAX_CSV_BYTES,
  parseLeadCsv,
} from "@/lib/lead-intake";

async function createIntakeJob(
  source: "manual_entry" | "csv_upload",
  rows: ReturnType<typeof buildIntakeProspect>[],
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      user_id: user.id,
      input_source: source,
      status: "completed",
      prospect_count: rows.length,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (jobError || !job)
    throw new Error(jobError?.message ?? "Could not create intake job.");
  const { error } = await supabase
    .from("prospects")
    .insert(rows.map((row) => ({ ...row, job_id: job.id })));
  if (error) {
    await supabase
      .from("jobs")
      .delete()
      .eq("id", job.id)
      .eq("user_id", user.id);
    throw new Error(error.message);
  }
  return job.id as string;
}

export async function addManualLead(formData: FormData) {
  const row = buildIntakeProspect(
    {
      name: String(formData.get("name") ?? ""),
      company: String(formData.get("company") ?? ""),
      title: String(formData.get("title") ?? ""),
      email: String(formData.get("email") ?? ""),
      linkedin_url: String(formData.get("linkedin_url") ?? ""),
      phone: String(formData.get("phone") ?? ""),
    },
    "manual",
  );
  redirect(`/app/jobs/${await createIntakeJob("manual_entry", [row])}`);
}

export async function importLeadCsv(formData: FormData) {
  const file = formData.get("csv");
  if (!(file instanceof File) || file.size === 0)
    redirect("/app/leads?error=missing_csv");
  if (file.size > MAX_CSV_BYTES) redirect("/app/leads?error=csv_too_large");
  const { rows } = parseLeadCsv(await file.text());
  if (!rows.length) redirect("/app/leads?error=no_valid_rows");
  redirect(`/app/jobs/${await createIntakeJob("csv_upload", rows)}`);
}

export async function deleteLeadAction(leadId: string) {
  if (!leadId) return { error: "Lead ID required" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: lead } = await supabase
    .from("prospects")
    .select("id, job_id")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return { error: "Lead not found" };

  if (lead.job_id) {
    const { data: job } = await supabase
      .from("jobs")
      .select("user_id")
      .eq("id", lead.job_id)
      .maybeSingle();
    if (job && job.user_id !== user.id) {
      return { error: "Unauthorized to delete this lead" };
    }
  }

  await supabase.from("campaign_recipients").delete().eq("prospect_id", leadId);
  await supabase
    .from("lead_qualification_facts")
    .delete()
    .eq("prospect_id", leadId);
  await supabase.from("voice_executions").delete().eq("prospect_id", leadId);
  await supabase.from("crm_syncs").delete().eq("prospect_id", leadId);

  const { error } = await supabase.from("prospects").delete().eq("id", leadId);
  if (error) return { error: error.message };
  return { success: true };
}
