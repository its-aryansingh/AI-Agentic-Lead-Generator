'use server'

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redactPii } from "@/lib/playbook";

async function auth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function saveContext(formData: FormData) {
  const { supabase, user } = await auth();
  const value = (name: string, max = 5000) =>
    String(formData.get(name) ?? "")
      .trim()
      .slice(0, max) || null;
  const { data: existing } = await supabase
    .from("customer_contexts")
    .select("version")
    .eq("user_id", user.id)
    .maybeSingle();
  const { error } = await supabase.from("customer_contexts").upsert(
    {
      user_id: user.id,
      company_name: value("company_name", 200),
      website_url: value("website_url", 1000),
      product_summary: value("product_summary"),
      ideal_customer_profile: value("ideal_customer_profile"),
      value_proposition: value("value_proposition"),
      qualification_criteria: value("qualification_criteria"),
      disqualification_criteria: value("disqualification_criteria"),
      approved_claims: value("approved_claims"),
      prohibited_topics: value("prohibited_topics"),
      default_language: value("default_language", 100) ?? "English",
      version: Number(existing?.version ?? 0) + 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
  revalidatePath("/app/settings/context");
  redirect("/app/settings/context?saved=1");
}

export async function addExample(formData: FormData) {
  const { supabase, user } = await auth();
  const exampleType = String(formData.get("example_type") ?? "");
  if (!["email", "call_transcript"].includes(exampleType)) return;
  const title = String(formData.get("title") ?? "")
    .trim()
    .slice(0, 200);
  const content = String(formData.get("content") ?? "")
    .trim()
    .slice(0, 20000);
  if (!title || !content) return;
  const { error } = await supabase.from("playbook_examples").insert({
    user_id: user.id,
    example_type: exampleType,
    title,
    content,
    redacted_content: redactPii(content),
    is_approved: false,
    outcome:
      String(formData.get("outcome") ?? "")
        .trim()
        .slice(0, 500) || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/app/settings/context");
  redirect("/app/settings/context?example_added=1");
}

export async function approveExample(formData: FormData) {
  const { supabase, user } = await auth();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { data: example } = await supabase
    .from("playbook_examples")
    .select("content,redacted_content")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  const redacted =
    example?.redacted_content ||
    (example?.content ? redactPii(example.content) : "");
  const { error } = await supabase
    .from("playbook_examples")
    .update({
      is_approved: true,
      redacted_content: redacted || null,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/app/settings/context");
  redirect("/app/settings/context?approved=1");
}

export async function deleteExample(formData: FormData) {
  const { supabase, user } = await auth();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase
    .from("playbook_examples")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/app/settings/context");
  redirect("/app/settings/context");
}
