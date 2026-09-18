import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { decryptCredential } from "@/lib/credential-crypto";
import { createBolnaCall } from "@/lib/providers/bolna";
import { VoiceCallRefresh } from "@/app/app/leads/[id]/voice-call-refresh";
import {
  normalizeE164,
  phoneHash,
  isRetryableLocalVoiceFailure,
  withinCallingHours,
} from "@/lib/voice-compliance";
import {
  pushCustomerCrm,
  type CustomerCrmCredentials,
} from "@/lib/customer-crm";
import { persistLeadHandoff } from "@/lib/lead-handoff";
import {
  handleEnrichLead,
  handleLaunchCampaign,
} from "@/lib/agent/tool-handlers";


// Every page under /app reads the session cookie, so none of them can
// be statically prerendered. Two earlier commits in this repo exist
// only to add this line to the other dashboard routes after the
// build crashed on them; these pages arrived from SalesEngAIMVP
// without it.
export const dynamic = "force-dynamic"

const statuses = [
  "new",
  "researching",
  "ready",
  "contacted",
  "engaged",
  "qualified",
  "disqualified",
  "converted",
  "do_not_contact",
];
const actions = [
  "review",
  "research",
  "draft_email",
  "send_email",
  "call",
  "follow_up",
  "human_handoff",
  "none",
];

async function syncLeadToCrm(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? ""),
    provider = String(formData.get("provider") ?? ""),
    supabase = await createClient(),
    {
      data: { user },
    } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  try {
    const { data: connection } = await supabase
      .from("crm_connections")
      .select("id,provider,encrypted_credentials")
      .eq("provider", provider)
      .eq("status", "active")
      .maybeSingle();
    if (!connection) throw new Error(`Connect ${provider} first.`);
    const { data: lead } = await supabase
      .from("prospects")
      .select(
        "id,input_name,input_company,input_title,email,linkedin_url,source_url,research_summary,handoff_summary,qualification_bucket,lead_status,next_action",
      )
      .eq("id", id)
      .maybeSingle();
    if (!lead?.email)
      throw new Error("A valid lead email is required for CRM sync.");
    let summary = String(lead.handoff_summary ?? "");
    if (!summary)
      summary = String(
        (await persistLeadHandoff(
          supabase,
          user.id,
          id,
          "Manual CRM handoff",
        )) ?? "",
      );
    if (!summary)
      throw new Error("Qualify this lead before pushing it to CRM.");
    const credentials = JSON.parse(
      decryptCredential(String(connection.encrypted_credentials)),
    ) as CustomerCrmCredentials;
    if (credentials.provider !== provider)
      throw new Error("CRM credential/provider mismatch.");
    const name = String(lead.input_name).trim().split(/\s+/),
      result = await pushCustomerCrm(
        credentials,
        {
          email: String(lead.email),
          first_name: name.shift(),
          last_name: name.join(" ") || undefined,
          company: lead.input_company ? String(lead.input_company) : undefined,
          job_title: lead.input_title ? String(lead.input_title) : undefined,
          linkedin_url: lead.linkedin_url
            ? String(lead.linkedin_url)
            : undefined,
          source_url: lead.source_url ? String(lead.source_url) : undefined,
        },
        summary,
      );
    const { error } = await supabase.from("crm_syncs").upsert(
      {
        user_id: user.id,
        connection_id: connection.id,
        prospect_id: id,
        provider,
        status: "completed",
        provider_contact_id: result.contactId,
        provider_note_id: result.noteId,
        error_message: null,
        payload_snapshot: {
          qualification_bucket: lead.qualification_bucket,
          lead_status: lead.lead_status,
          next_action: lead.next_action,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "connection_id,prospect_id" },
    );
    if (error) throw error;
  } catch (error) {
    redirect(
      `/app/leads/${id}?crm_error=${encodeURIComponent(error instanceof Error ? error.message : "CRM sync failed")}`,
    );
  }
  redirect(`/app/leads/${id}?crm_synced=${provider}`);
}
async function updateWorkflow(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? ""),
    leadStatus = String(formData.get("lead_status") ?? ""),
    nextAction = String(formData.get("next_action") ?? "");
  if (!statuses.includes(leadStatus) || !actions.includes(nextAction)) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await supabase
    .from("prospects")
    .update({
      lead_status: leadStatus,
      next_action: nextAction,
      next_action_at: String(formData.get("next_action_at") ?? "") || null,
    })
    .eq("id", id);
  redirect(`/app/leads/${id}?saved=1`);
}
async function updateLeadDetails(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const linkedinUrl = String(formData.get("linkedin_url") ?? "").trim();

  if (!name) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase
    .from("prospects")
    .update({
      input_name: name,
      input_company: company || null,
      input_title: title || null,
      email: email || null,
      phone: phone || null,
      input_linkedin_url: linkedinUrl || null,
    })
    .eq("id", id);

  redirect(`/app/leads/${id}?saved=details`);
}
async function draftEmail(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  try {
    const res = await handleEnrichLead(
      { lead_id: id, draft_email: true },
      { userId: user.id, sessionId: `ui-${id}` },
    );
    if (res.error) {
      redirect(`/app/leads/${id}?draft_error=${encodeURIComponent(res.error)}`);
    }
  } catch (err) {
    redirect(
      `/app/leads/${id}?draft_error=${encodeURIComponent(
        err instanceof Error ? err.message : "Drafting failed",
      )}`,
    );
  }
  redirect(`/app/leads/${id}?drafted=1`);
}
async function approveAndSendEmail(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const mailboxId = String(formData.get("mailbox_id") ?? "") || undefined;
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (subject || body) {
    await supabase
      .from("prospects")
      .update({
        email_subject: subject || null,
        email_body: body || null,
      })
      .eq("id", id);
  }

  try {
    const res = await handleLaunchCampaign(
      {
        lead_id: id,
        mailbox_id: mailboxId,
        name: "Personalized Outreach",
      },
      { userId: user.id, sessionId: `ui-${id}` },
    );

    if (res.error) {
      redirect(`/app/leads/${id}?send_error=${encodeURIComponent(res.error)}`);
    }

    await supabase
      .from("prospects")
      .update({ lead_status: "contacted", next_action: "follow_up" })
      .eq("id", id);
  } catch (err) {
    redirect(
      `/app/leads/${id}?send_error=${encodeURIComponent(
        err instanceof Error ? err.message : "Send failed",
      )}`,
    );
  }
  redirect(`/app/leads/${id}?sent=1`);
}
async function deleteCurrentLead(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase.from("campaign_recipients").delete().eq("prospect_id", id);
  await supabase
    .from("lead_qualification_facts")
    .delete()
    .eq("prospect_id", id);
  await supabase.from("voice_executions").delete().eq("prospect_id", id);
  await supabase.from("crm_syncs").delete().eq("prospect_id", id);
  await supabase.from("prospects").delete().eq("id", id);

  redirect("/app/leads");
}
async function startVoiceCall(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? ""),
    consent = formData.get("voice_consent") === "on",
    supabase = await createClient(),
    {
      data: { user },
    } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!consent) redirect(`/app/leads/${id}?voice_error=consent_required`);
  const { data: lead } = await supabase
    .from("prospects")
    .select("id,input_name,input_company,input_title,phone,research_summary")
    .eq("id", id)
    .maybeSingle();
  const phone = normalizeE164(String(lead?.phone ?? ""));
  if (!lead || !phone) redirect(`/app/leads/${id}?voice_error=e164_required`);
  const { data: connection } = await supabase
    .from("voice_connections")
    .select(
      "id,encrypted_api_key,agent_id,from_phone_number,status,call_start_hour,call_end_hour,calling_timezone",
    )
    .eq("provider", "bolna")
    .eq("status", "active")
    .maybeSingle();
  if (!connection) redirect(`/app/leads/${id}?voice_error=connect_bolna`);
  if (
    !withinCallingHours(
      new Date(),
      String(connection.calling_timezone),
      Number(connection.call_start_hour),
      Number(connection.call_end_hour),
    )
  )
    redirect(`/app/leads/${id}?voice_error=outside_calling_hours`);
  const [{ data: suppressed }, { data: previous }] = await Promise.all([
    supabase
      .from("phone_suppressions")
      .select("id")
      .eq("phone_hash", phoneHash(phone))
      .in("channel", ["voice", "all"])
      .limit(1)
      .maybeSingle(),
    supabase
      .from("voice_executions")
      .select("id,status,provider_status,provider_execution_id")
      .eq("prospect_id", id)
      .limit(1)
      .maybeSingle(),
  ]);
  if (suppressed) redirect(`/app/leads/${id}?voice_error=suppressed`);
  if (previous && isRetryableLocalVoiceFailure(previous)) {
    await supabase.from("voice_executions").delete().eq("id", previous.id);
  } else if (previous) {
    redirect(`/app/leads/${id}?voice_error=no_redial`);
  }
  await supabase
    .from("prospects")
    .update({ voice_consent_status: "confirmed" })
    .eq("id", id);
  const snapshot = {
    lead_name: lead.input_name,
    company: lead.input_company,
    title: lead.input_title,
    research_summary: lead.research_summary,
    disclosure:
      "This is an AI assistant calling on behalf of the seller. Ask whether now is a good time before continuing.",
  };
  const { data: execution, error } = await supabase
    .from("voice_executions")
    .insert({
      user_id: user.id,
      connection_id: connection.id,
      prospect_id: id,
      status: "queued",
      provider_status: "local_queued",
      recipient_phone: phone,
      context_snapshot: snapshot,
    })
    .select("id")
    .single();
  if (error || !execution)
    redirect(`/app/leads/${id}?voice_error=execution_create_failed`);
  try {
    const result = await createBolnaCall({
      apiKey: decryptCredential(String(connection.encrypted_api_key)),
      agentId: String(connection.agent_id),
      recipientPhone: phone,
      fromPhone: connection.from_phone_number
        ? String(connection.from_phone_number)
        : null,
      userData: {
        customer_name: String(lead.input_name ?? ""),
        company: String(lead.input_company ?? ""),
        title: String(lead.input_title ?? ""),
        qualification_context: String(lead.research_summary ?? "").slice(
          0,
          500,
        ),
        ai_disclosure: String(snapshot.disclosure),
        salesengai_execution_id: String(execution.id),
      },
    });
    await supabase
      .from("voice_executions")
      .update({
        provider_execution_id: result.executionId,
        provider_status: result.status,
        raw_payload: result.raw,
        updated_at: new Date().toISOString(),
      })
      .eq("id", execution.id);
    await supabase
      .from("prospects")
      .update({ lead_status: "contacted", next_action: "review" })
      .eq("id", id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bolna call failed";
    await supabase
      .from("voice_executions")
      .update({
        status: "failed",
        provider_status: "request_failed",
        error_message: message,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", execution.id);
    redirect(`/app/leads/${id}?voice_error=${encodeURIComponent(message)}`);
  }
  redirect(`/app/leads/${id}?call_started=1`);
}
export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    voice_error?: string;
    call_started?: string;
    crm_error?: string;
    crm_synced?: string;
    saved?: string;
    drafted?: string;
    draft_error?: string;
    sent?: string;
    send_error?: string;
  }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("prospects")
    .select(
      "id,input_name,input_company,input_title,input_linkedin_url,email,phone,research_summary,email_subject,email_body,lead_status,next_action,next_action_at,context_version,qualification_bucket,handoff_summary,handoff_generated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!lead) notFound();
  const { data: history } = await supabase
    .from("campaign_recipients")
    .select("id,status,subject,sent_at,reply_at,thread_id")
    .eq("prospect_id", id)
    .order("created_at", { ascending: false });
  const { data: facts } = await supabase
    .from("lead_qualification_facts")
    .select("id,fact_key,fact_value,source_type,source_excerpt,confidence")
    .eq("prospect_id", id)
    .order("fact_key");
  const { data: calls } = await supabase
    .from("voice_executions")
    .select(
      "id,status,provider_status,provider_execution_id,outcome,duration_seconds,transcript,summary,recording_url,error_message,created_at,completed_at",
    )
    .eq("prospect_id", id)
    .order("created_at", { ascending: false });
  const [{ data: crmConnections }, { data: crmSyncs }, { data: mailboxes }] =
    await Promise.all([
      supabase
        .from("crm_connections")
        .select("provider,status")
        .eq("status", "active"),
      supabase
        .from("crm_syncs")
        .select("provider,status,provider_contact_id,updated_at,error_message")
        .eq("prospect_id", id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("mailboxes")
        .select("id,email_address,status")
        .eq("status", "active")
        .order("created_at", { ascending: true }),
    ]);
  const query = await searchParams;
  const hasAcceptedVoiceAttempt = (calls ?? []).some(
    (call) => !isRetryableLocalVoiceFailure(call),
  );
  return (
    <div className="p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        <header>
          <h1 className="text-xl font-semibold">{String(lead.input_name)}</h1>
          <p className="text-sm text-muted-foreground">
            {String(lead.input_title ?? "")}{" "}
            {lead.input_company ? `at ${String(lead.input_company)}` : ""}
          </p>
        </header>
        <Card>
          <CardHeader>
            <CardTitle>Lead Details</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={updateLeadDetails}
              className="grid gap-3 md:grid-cols-2"
            >
              <input type="hidden" name="id" value={id} />
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Full Name *
                </label>
                <Input
                  name="name"
                  defaultValue={String(lead.input_name ?? "")}
                  required
                  placeholder="Full Name"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Company
                </label>
                <Input
                  name="company"
                  defaultValue={String(lead.input_company ?? "")}
                  placeholder="Company"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Job Title
                </label>
                <Input
                  name="title"
                  defaultValue={String(lead.input_title ?? "")}
                  placeholder="Job Title"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Work Email
                </label>
                <Input
                  name="email"
                  type="email"
                  defaultValue={String(lead.email ?? "")}
                  placeholder="Work Email"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Phone
                </label>
                <Input
                  name="phone"
                  defaultValue={String(lead.phone ?? "")}
                  placeholder="Phone (+country code)"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  LinkedIn URL
                </label>
                <Input
                  name="linkedin_url"
                  type="url"
                  defaultValue={String(lead.input_linkedin_url ?? "")}
                  placeholder="LinkedIn URL"
                />
              </div>
              <div className="md:col-span-2 flex items-center justify-between pt-1">
                {query.saved === "details" && (
                  <p className="text-xs text-emerald-600 font-medium">
                    Lead details saved successfully.
                  </p>
                )}
                <div className="ml-auto">
                  <Button type="submit">Save details</Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Workflow</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateWorkflow} className="grid gap-3 md:grid-cols-4">
              <input type="hidden" name="id" value={id} />
              <select
                name="lead_status"
                defaultValue={String(lead.lead_status)}
                className="border rounded-md p-2 bg-card"
              >
                {statuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <select
                name="next_action"
                defaultValue={String(lead.next_action)}
                className="border rounded-md p-2 bg-card"
              >
                {actions.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
              <Input
                type="datetime-local"
                name="next_action_at"
                defaultValue={
                  lead.next_action_at
                    ? String(lead.next_action_at).slice(0, 16)
                    : ""
                }
              />
              <Button>Save next action</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Personalized Email Outreach</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {query.drafted && (
              <p className="text-xs text-emerald-600 font-medium">
                ✓ AI email draft generated using your company context &amp;
                playbook!
              </p>
            )}
            {query.draft_error && (
              <p className="text-xs text-destructive font-medium">
                ✕ Drafting failed: {decodeURIComponent(query.draft_error)}
              </p>
            )}
            {query.sent && (
              <p className="text-xs text-emerald-600 font-medium">
                ✓ Email approved and sent via your connected Gmail! Status
                updated to contacted.
              </p>
            )}
            {query.send_error && (
              <p className="text-xs text-destructive font-medium">
                ✕ Send failed: {decodeURIComponent(query.send_error)}
              </p>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Research Summary &amp; Evidence
              </label>
              <p className="border rounded-md p-3 text-xs bg-muted/20 whitespace-pre-wrap">
                {String(
                  lead.research_summary ??
                    "No research summary yet. Click Draft AI Email to research and draft.",
                )}
              </p>
            </div>

            {lead.email_subject || lead.email_body ? (
              <div className="space-y-4 pt-2">
                <form action={approveAndSendEmail} className="space-y-3">
                  <input type="hidden" name="id" value={id} />
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      Subject Line
                    </label>
                    <Input
                      name="subject"
                      defaultValue={String(lead.email_subject ?? "")}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      Email Body
                    </label>
                    <textarea
                      name="body"
                      defaultValue={String(lead.email_body ?? "")}
                      rows={6}
                      required
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground">
                        Sending Mailbox:
                      </label>
                      <select
                        name="mailbox_id"
                        className="border rounded-md p-2 text-xs bg-card"
                        disabled={!mailboxes?.length}
                      >
                        {(mailboxes ?? []).map((mb) => (
                          <option key={String(mb.id)} value={String(mb.id)}>
                            {String(mb.email_address)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      type="submit"
                      disabled={!lead.email || !mailboxes?.length}
                    >
                      Approve &amp; Send Email
                    </Button>
                  </div>
                  {!mailboxes?.length && (
                    <p className="text-xs text-amber-500">
                      Connect a Gmail account under Settings → Mailboxes to
                      send.
                    </p>
                  )}
                  {!lead.email && (
                    <p className="text-xs text-destructive">
                      Lead email is required before sending. Update it in Lead
                      Details above.
                    </p>
                  )}
                </form>

                <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                  <span>
                    Context version: {String(lead.context_version ?? "1")}
                  </span>
                  <form action={draftEmail}>
                    <input type="hidden" name="id" value={id} />
                    <Button type="submit" variant="outline" size="sm">
                      Regenerate AI Draft
                    </Button>
                  </form>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-6 text-center space-y-3">
                <p className="text-muted-foreground text-xs max-w-md mx-auto">
                  No draft yet. Click below to draft personalized cold copy
                  using your customer context and approved playbook example.
                </p>
                <form action={draftEmail}>
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit">Draft AI Email</Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              Qualification ·{" "}
              {String(lead.qualification_bucket ?? "not_determined")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2">
            {!facts?.length && (
              <p className="text-sm text-muted-foreground">
                No reply evidence yet.
              </p>
            )}
            {(facts ?? []).map((f) => (
              <div key={String(f.id)} className="border rounded-md p-3 text-sm">
                <strong>{String(f.fact_key)}</strong>: {String(f.fact_value)}
                <p className="text-xs text-muted-foreground">
                  Source: {String(f.source_type)} · Confidence:{" "}
                  {Math.round(Number(f.confidence) * 100)}%
                </p>
                {f.source_excerpt && (
                  <p className="text-xs mt-1">{String(f.source_excerpt)}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Human handoff &amp; CRM</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lead.handoff_summary ? (
              <p className="whitespace-pre-wrap text-sm border rounded-md p-3">
                {String(lead.handoff_summary)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                A sourced handoff summary is generated when an email or voice
                conversation qualifies this lead as warm or hot.
              </p>
            )}
            {query.crm_synced && (
              <p className="text-sm text-emerald-600">
                Synced to {query.crm_synced}.
              </p>
            )}
            {query.crm_error && (
              <p className="text-sm text-destructive">
                {decodeURIComponent(query.crm_error)}
              </p>
            )}
            <form action={syncLeadToCrm} className="flex gap-2">
              <input type="hidden" name="id" value={id} />
              <select
                name="provider"
                className="border rounded-md p-2 bg-card"
                disabled={!crmConnections?.length}
              >
                {(crmConnections ?? []).map((connection) => (
                  <option
                    key={String(connection.provider)}
                    value={String(connection.provider)}
                  >
                    {String(connection.provider)}
                  </option>
                ))}
              </select>
              <Button
                disabled={
                  !lead.handoff_summary ||
                  !lead.email ||
                  !crmConnections?.length
                }
              >
                Push handoff to CRM
              </Button>
            </form>
            {!crmConnections?.length && (
              <p className="text-xs text-muted-foreground">
                Connect HubSpot or Zoho under Settings → CRM connections.
              </p>
            )}
            {(crmSyncs ?? []).map((sync) => (
              <p
                key={String(sync.provider)}
                className="text-xs text-muted-foreground"
              >
                {String(sync.provider)}: {String(sync.status)} · contact{" "}
                {String(sync.provider_contact_id ?? "pending")} ·{" "}
                {String(sync.updated_at)}
              </p>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Qualification call</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {query.call_started && (
              <p className="text-sm text-emerald-600">
                Call queued with Bolna.
              </p>
            )}
            {query.voice_error && (
              <p className="text-sm text-destructive">
                Call blocked: {String(query.voice_error).replaceAll("_", " ")}
              </p>
            )}
            <form action={startVoiceCall} className="space-y-3">
              <input type="hidden" name="id" value={id} />
              <p className="text-sm">
                Recipient: {String(lead.phone ?? "No phone configured")}
              </p>
              <label className="flex gap-2 text-sm">
                <input type="checkbox" name="voice_consent" />I confirm lawful
                permission/basis for this call and that the number is not on a
                do-not-call list.
              </label>
              <Button
                type="submit"
                disabled={!lead.phone || hasAcceptedVoiceAttempt}
              >
                Start one qualification call
              </Button>
              <p className="text-xs text-muted-foreground">
                One Bolna-accepted attempt per lead. Local API failures can be
                retried. Calls are allowed only during the configured local
                calling window.
              </p>
            </form>
            {(calls ?? []).map((call) => (
              <div
                key={String(call.id)}
                className="border rounded-md p-3 text-sm"
              >
                <strong>{String(call.provider_status ?? call.status)}</strong> ·{" "}
                {String(call.outcome ?? "outcome pending")} ·{" "}
                {String(call.duration_seconds ?? 0)}s
                <p className="mt-1 text-xs text-muted-foreground">
                  Provider execution: {String(call.provider_execution_id ?? "not assigned")} · Started {new Date(String(call.created_at)).toLocaleString()}
                  {call.completed_at ? ` · Completed ${new Date(String(call.completed_at)).toLocaleString()}` : ""}
                </p>
                {call.error_message && (
                  <p className="text-destructive">
                    {String(call.error_message)}
                  </p>
                )}
                {call.transcript && (
                  <div className="mt-3">
                    <strong>Transcript</strong>
                    <p className="whitespace-pre-wrap mt-1">{String(call.transcript)}</p>
                  </div>
                )}
                {call.summary && (
                  <details className="mt-3">
                    <summary className="cursor-pointer font-medium">Extracted call details</summary>
                    <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{String(call.summary)}</pre>
                  </details>
                )}
                {call.recording_url && (
                  <p className="mt-2">
                    <a className="underline" href={String(call.recording_url)} target="_blank" rel="noreferrer">Open call recording</a>
                  </p>
                )}
                <VoiceCallRefresh
                  executionId={String(call.id)}
                  status={String(call.status)}
                  providerStatus={call.provider_status ? String(call.provider_status) : null}
                  providerExecutionId={call.provider_execution_id ? String(call.provider_execution_id) : null}
                />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Email history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!history?.length && (
              <p className="text-sm text-muted-foreground">
                No email activity yet.
              </p>
            )}
            {(history ?? []).map((h) => (
              <div key={String(h.id)} className="border rounded-md p-3 text-sm">
                <strong>{String(h.status)}</strong> ·{" "}
                {String(h.subject ?? "No subject")}
                <p className="text-xs text-muted-foreground">
                  Sent: {String(h.sent_at ?? "not sent")} · Thread:{" "}
                  {String(h.thread_id ?? "pending")}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive text-sm font-semibold">
              Danger Zone
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-foreground">
                Delete this lead
              </p>
              <p className="text-xs text-muted-foreground">
                Permanently delete this lead, research summaries, email drafts,
                and outreach history.
              </p>
            </div>
            <form action={deleteCurrentLead}>
              <input type="hidden" name="id" value={id} />
              <Button variant="destructive" size="sm" type="submit">
                Delete Lead
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
