"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { enqueueProspectEnrichment } from "@/lib/enrichment/enqueue";
import { guessDomainFromCompany } from "@/lib/email-patterns";
import {
  buildIntakeProspect,
  MAX_CSV_BYTES,
  parseLeadCsv,
  prepareConfirmedDuplicateProspect,
} from "@/lib/lead-intake";

type ManualLeadValues = {
  name: string;
  company: string;
  title: string;
  email: string;
  linkedin_url: string;
  phone: string;
};

export type AddManualLeadState = {
  status: "idle" | "duplicate" | "error";
  message?: string;
  values?: ManualLeadValues;
  duplicatePhoneValue?: string;
  duplicateEmailValue?: string;
};

class IntakeInsertError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "IntakeInsertError";
  }
}

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
    throw new IntakeInsertError(
      jobError?.message ?? "Could not create intake job.",
      jobError?.code,
    );
  const { error } = await supabase
    .from("prospects")
    .insert(rows.map((row) => ({ ...row, job_id: job.id, user_id: user.id })));
  if (error) {
    await supabase
      .from("jobs")
      .delete()
      .eq("id", job.id)
      .eq("user_id", user.id);
    throw new IntakeInsertError(error.message, error.code);
  }
  return job.id as string;
}

export async function addManualLead(
  _previousState: AddManualLeadState,
  formData: FormData,
): Promise<AddManualLeadState> {
  const values: ManualLeadValues = {
    name: String(formData.get("name") ?? ""),
    company: String(formData.get("company") ?? ""),
    title: String(formData.get("title") ?? ""),
    email: String(formData.get("email") ?? ""),
    linkedin_url: String(formData.get("linkedin_url") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  };

  let row: ReturnType<typeof buildIntakeProspect>;
  try {
    row = buildIntakeProspect(values, "manual");
  } catch {
    return { status: "error", message: "Enter a valid lead name.", values };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [phoneMatch, emailMatch] = await Promise.all([
    row.normalized_phone_e164
      ? supabase
          .from("prospects")
          .select("id")
          .eq("user_id", user.id)
          .eq("normalized_phone_e164", row.normalized_phone_e164)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    row.normalized_email
      ? supabase
          .from("prospects")
          .select("id")
          .eq("user_id", user.id)
          .eq("normalized_email", row.normalized_email)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (phoneMatch.error || emailMatch.error) {
    return {
      status: "error",
      message: "Could not check this lead for duplicates. Please try again.",
      values,
    };
  }

  const duplicatePhone = Boolean(phoneMatch.data && row.phone_hash);
  const duplicateEmail = Boolean(emailMatch.data && row.email_hash);
  const confirmedPhoneValue = String(
    formData.get("duplicate_phone_confirmation") ?? "",
  );
  const confirmedEmailValue = String(
    formData.get("duplicate_email_confirmation") ?? "",
  );
  const phoneConfirmed =
    duplicatePhone && confirmedPhoneValue === row.normalized_phone_e164;
  const emailConfirmed =
    duplicateEmail && confirmedEmailValue === row.normalized_email;

  if (
    (duplicatePhone && !phoneConfirmed) ||
    (duplicateEmail && !emailConfirmed)
  ) {
    const message =
      duplicatePhone && duplicateEmail
        ? "This phone number and email already exist. Do you still want to add this lead?"
        : duplicatePhone
          ? "This phone number already exists. Do you still want to add a lead with this number?"
          : "This email address already exists. Do you still want to add a lead with this email?";
    return {
      status: "duplicate",
      message,
      values,
      duplicatePhoneValue: duplicatePhone
        ? row.normalized_phone_e164!
        : undefined,
      duplicateEmailValue: duplicateEmail ? row.normalized_email! : undefined,
    };
  }

  const insertRow = prepareConfirmedDuplicateProspect(row, {
    phone: duplicatePhone,
    email: duplicateEmail,
  });

  try {
    redirect(
      `/app/jobs/${await createIntakeJob("manual_entry", [insertRow])}`,
    );
  } catch (error) {
    if (
      error instanceof IntakeInsertError &&
      error.code === "23505" &&
      /prospects_user_(phone|email)_hash_key/.test(error.message)
    ) {
      return {
        status: "duplicate",
        message:
          "This contact was added concurrently. Review the duplicate warning and confirm if you still want another lead row.",
        values,
        duplicatePhoneValue: row.normalized_phone_e164 ?? undefined,
        duplicateEmailValue: row.normalized_email ?? undefined,
      };
    }
    throw error;
  }
}

export async function importLeadCsv(formData: FormData) {
  const file = formData.get("csv");
  if (!(file instanceof File) || file.size === 0)
    redirect("/app/leads?error=missing_csv");
  if (file.size > MAX_CSV_BYTES) redirect("/app/leads?error=csv_too_large");
  const { rows } = parseLeadCsv(await file.text());
  if (!rows.length) redirect("/app/leads?error=no_valid_rows");
  try {
    redirect(`/app/jobs/${await createIntakeJob("csv_upload", rows)}`);
  } catch (error) {
    if (error instanceof IntakeInsertError && error.code === "23505") {
      redirect("/app/leads?error=duplicate_contacts");
    }
    throw error;
  }
}

async function deleteOwnedLeads(leadIds: string[]) {
  const uniqueIds = [...new Set(leadIds.filter(Boolean))];
  if (!uniqueIds.length) {
    return { success: false as const, deletedIds: [], skippedIds: [], error: "Select at least one lead." };
  }
  if (uniqueIds.length > 100) {
    return { success: false as const, deletedIds: [], skippedIds: [], error: "Delete up to 100 leads at a time." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: ownedLeads, error: ownershipError } = await supabase
    .from("prospects")
    .select("id")
    .eq("user_id", user.id)
    .in("id", uniqueIds);
  if (ownershipError) {
    return { success: false as const, deletedIds: [], skippedIds: [], error: "Could not verify the selected leads." };
  }

  const ownedIds = (ownedLeads ?? []).map((lead) => String(lead.id));
  if (!ownedIds.length) {
    return { success: false as const, deletedIds: [], skippedIds: [], error: "No matching leads were found." };
  }

  // Call history is the database-backed one-call-per-person guard. Never erase
  // an accepted attempt through lead deletion; doing so would permit a re-add
  // to bypass that safety control.
  const { data: protectedExecutions, error: historyError } = await supabase
    .from("voice_executions")
    .select("prospect_id")
    .eq("user_id", user.id)
    .eq("counts_toward_call_limit", true)
    .in("prospect_id", ownedIds);
  if (historyError) {
    return { success: false as const, deletedIds: [], skippedIds: [], error: "Could not verify call history for the selected leads." };
  }

  const skippedIds = [...new Set((protectedExecutions ?? []).map((row) => String(row.prospect_id)))];
  const skipped = new Set(skippedIds);
  const deletableIds = ownedIds.filter((id) => !skipped.has(id));

  if (deletableIds.length) {
    const { error } = await supabase
      .from("prospects")
      .delete()
      .eq("user_id", user.id)
      .in("id", deletableIds);
    if (error) {
      return { success: false as const, deletedIds: [], skippedIds, error: "Could not delete the selected leads." };
    }
  }

  revalidatePath("/app/leads");
  return { success: true as const, deletedIds: deletableIds, skippedIds };
}

export async function deleteLeadAction(leadId: string) {
  return deleteOwnedLeads([leadId]);
}

export async function deleteLeadsAction(leadIds: string[]) {
  return deleteOwnedLeads(leadIds);
}

export async function enrichLeadsAction(leadIds: string[]) {
  if (!leadIds || !leadIds.length) {
    return { success: false, error: "No leads selected for enrichment" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rows } = await supabase
    .from("prospects")
    .select("id, input_company, company_domain")
    .in("id", leadIds.slice(0, 50))
    .eq("user_id", user.id);

  if (!rows || rows.length === 0) {
    return { success: false, error: "No matching leads found" };
  }

  const results: Array<{ id: string; status: string; error?: string }> = [];

  for (const row of rows) {
    const domain =
      row.company_domain ||
      (row.input_company ? guessDomainFromCompany(row.input_company) : null);

    if (!domain) {
      results.push({
        id: row.id,
        status: "skipped",
        error: "Missing company domain",
      });
      continue;
    }

    try {
      if (!row.company_domain && domain) {
        await supabase
          .from("prospects")
          .update({ company_domain: domain })
          .eq("id", row.id)
          .eq("user_id", user.id);
      }

      const res = await enqueueProspectEnrichment({
        userId: user.id,
        prospectId: row.id,
        domain,
      });
      results.push({ id: row.id, status: res.status });
    } catch (e: unknown) {
      results.push({
        id: row.id,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  revalidatePath("/app/leads");
  return {
    success: true,
    enqueued: results.filter((r) => r.status === "queued").length,
    results,
  };
}
