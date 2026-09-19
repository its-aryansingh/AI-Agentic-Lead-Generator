/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase has no generated schema types in this repository. */
import { createHash, randomBytes } from "node:crypto";
import { decryptCredential } from "@/lib/credential-crypto";
import {
  pullCustomerCrm,
  type CustomerCrmCredentials,
  type NormalizedCrmContact,
  type PullCustomerCrmOptions,
} from "@/lib/customer-crm";

export type CrmPullDatabase = { from: (table: string) => any; rpc: (name: string, args: Record<string, unknown>) => Promise<any> };
export type CrmProvider = "hubspot" | "zoho";
export type CrmPullSummary = {
  fetched: number; created: number; updated: number; unchanged: number;
  skipped: number; invalid: number; failed: number; nextCursor: string | null;
  hasMore: boolean; rowErrors: Array<{ providerContactId: string; error: string }>;
};

function tokenHash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function checksum(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function asCredentials(value: string, provider: CrmProvider): CustomerCrmCredentials {
  const credentials: unknown = JSON.parse(decryptCredential(value));
  if (!credentials || typeof credentials !== "object" || (credentials as { provider?: unknown }).provider !== provider) {
    throw new Error("Saved CRM credentials are invalid.");
  }
  return credentials as CustomerCrmCredentials;
}

export async function loadOwnedCrmConnection(db: CrmPullDatabase, userId: string, provider: CrmProvider) {
  const { data, error } = await db.from("crm_connections")
    .select("id,provider,status,encrypted_credentials,region,last_error")
    .eq("user_id", userId).eq("provider", provider).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active") throw new Error(`${provider === "hubspot" ? "HubSpot" : "Zoho"} is not connected. Connect it in Settings → CRM.`);
  return { id: String(data.id), credentials: asCredentials(String(data.encrypted_credentials), provider) };
}

export async function previewCrmPull(db: CrmPullDatabase, userId: string, provider: CrmProvider, options: PullCustomerCrmOptions, approvalContext?: { sessionId?: string; source?: "ui" | "chat" | "api" }) {
  const connection = await loadOwnedCrmConnection(db, userId, provider);
  const result = await pullCustomerCrm(connection.credentials, options);
  const summary = await summarize(db, userId, connection.id, result.contacts);
  const confirmationToken = randomBytes(32).toString("base64url");
  const { data: approval, error } = await db.from("outreach_action_approvals").insert({
    user_id: userId, session_id: approvalContext?.sessionId ?? null, action_kind: "crm_pull", channel: "email", source: approvalContext?.source ?? "ui", actor: "authenticated_user",
    scope: { provider, connectionId: connection.id, options: serializableOptions(options), contactIds: result.contacts.map((x) => x.providerContactId) },
    preview_summary: summary, payload_hash: checksum({ provider, options: serializableOptions(options), contactIds: result.contacts.map((x) => x.providerContactId) }),
    confirmation_token_hash: tokenHash(confirmationToken), expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  }).select("id").single();
  if (error) throw new Error(error.message);
  return { ...result, summary, confirmationToken, approvalId: String(approval.id) };
}

function serializableOptions(options: PullCustomerCrmOptions) {
  return { limit: options.limit, cursor: options.cursor, modifiedAfter: options.modifiedAfter ? new Date(options.modifiedAfter).toISOString() : undefined };
}
async function summarize(db: CrmPullDatabase, userId: string, connectionId: string, contacts: NormalizedCrmContact[]): Promise<CrmPullSummary> {
  let created = 0, updated = 0, unchanged = 0, invalid = 0;
  for (const contact of contacts) {
    if (!contact.normalizedEmail && !contact.normalizedPhoneE164) { invalid++; continue; }
    const { data: link } = await db.from("prospect_crm_links").select("prospect_id").eq("user_id", userId).eq("connection_id", connectionId).eq("provider_record_id", contact.providerContactId).maybeSingle();
    if (link) { unchanged++; continue; }
    let found = false;
    if (contact.emailHash) {
      const { data } = await db.from("prospects").select("id").eq("user_id", userId).eq("email_hash", contact.emailHash).maybeSingle(); found = Boolean(data);
    }
    if (!found && contact.phoneHash) {
      const { data } = await db.from("prospects").select("id").eq("user_id", userId).eq("phone_hash", contact.phoneHash).maybeSingle(); found = Boolean(data);
    }
    if (found) updated++; else created++;
  }
  return { fetched: contacts.length, created, updated, unchanged, skipped: 0, invalid, failed: 0, nextCursor: null, hasMore: false, rowErrors: [] };
}

export async function applyCrmPull(db: CrmPullDatabase, userId: string, input: { provider: CrmProvider; options: PullCustomerCrmOptions; confirmationToken: string }) {
  const connection = await loadOwnedCrmConnection(db, userId, input.provider);
  const { data: approval, error: approvalError } = await db.from("outreach_action_approvals")
    .select("id,scope,expires_at,consumed_at").eq("user_id", userId).eq("action_kind", "crm_pull")
    .eq("confirmation_token_hash", tokenHash(input.confirmationToken)).maybeSingle();
  if (approvalError) throw new Error(approvalError.message);
  if (!approval || approval.consumed_at || (approval.expires_at && new Date(approval.expires_at) < new Date())) throw new Error("CRM preview confirmation is invalid or has expired. Preview again.");
  const scope = approval.scope as { provider?: string; connectionId?: string; options?: unknown; contactIds?: unknown[] };
  if (scope.provider !== input.provider || scope.connectionId !== connection.id || checksum(serializableOptions(input.options)) !== checksum(scope.options)) throw new Error("CRM import differs from the preview. Preview again.");
  // Re-fetch before consuming the approval, then prove that the provider page
  // is the exact page the user previewed. A changed page requires a new preview.
  const page = await pullCustomerCrm(connection.credentials, input.options);
  const approvedContactIds = Array.isArray(scope.contactIds) ? scope.contactIds.map(String) : [];
  const fetchedContactIds = page.contacts.map((contact) => contact.providerContactId);
  if (checksum(approvedContactIds) !== checksum(fetchedContactIds))
    throw new Error("CRM provider results changed after preview. Preview again before importing.");
  const { data: begun, error: beginError } = await db.rpc("begin_crm_pull_run", {
    p_user_id: userId, p_confirmation_hash: tokenHash(input.confirmationToken), p_connection_id: connection.id,
    p_provider: input.provider, p_modified_after: serializableOptions(input.options).modifiedAfter ?? null, p_cursor: input.options.cursor ?? null,
  });
  const started = Array.isArray(begun) ? begun[0] : begun;
  if (beginError || !started?.job_id || !started?.run_id) throw new Error(beginError?.message ?? "Unable to begin CRM import.");
  const job = { id: started.job_id as string }, run = { id: started.run_id as string };
  const counts = { created: 0, updated: 0, unchanged: 0, skipped: 0, invalid: 0, failed: 0 };
  const rowErrors: CrmPullSummary["rowErrors"] = [];
  for (const contact of page.contacts) {
    if (!contact.normalizedEmail && !contact.normalizedPhoneE164) { counts.invalid++; continue; }
    try {
      const { data, error } = await db.rpc("apply_crm_pull_contact", {
        p_user_id: userId, p_connection_id: connection.id, p_job_id: job.id, p_provider: input.provider,
        p_record_id: contact.providerContactId, p_first_name: contact.firstName, p_last_name: contact.lastName,
        p_company: contact.company, p_title: contact.jobTitle, p_email: contact.email, p_phone: contact.phone,
        p_normalized_email: contact.normalizedEmail, p_normalized_phone: contact.normalizedPhoneE164,
        p_email_hash: contact.emailHash, p_phone_hash: contact.phoneHash, p_modified_at: contact.modifiedAt,
        p_checksum: checksum(contact.rawMetadata),
      });
      if (error) throw new Error(error.message);
      const outcome = Array.isArray(data) ? data[0]?.outcome : data?.outcome;
      if (outcome === "created") counts.created++; else if (outcome === "updated") counts.updated++; else if (outcome === "skipped") counts.skipped++; else counts.unchanged++;
    } catch (error) { counts.failed++; rowErrors.push({ providerContactId: contact.providerContactId, error: error instanceof Error ? error.message : "Import failed" }); }
  }
  const status = counts.failed ? (counts.created || counts.updated || counts.unchanged ? "partial" : "failed") : "completed";
  const now = new Date().toISOString();
  await db.from("crm_pull_runs").update({ status, fetched_count: page.contacts.length, inserted_count: counts.created, updated_count: counts.updated, unchanged_count: counts.unchanged, skipped_count: counts.skipped, invalid_count: counts.invalid, failed_count: counts.failed, row_errors: rowErrors, next_cursor: page.nextCursor, completed_at: now }).eq("id", run.id).eq("user_id", userId);
  await db.from("jobs").update({ status: status === "failed" ? "failed" : "completed", prospect_count: counts.created + counts.updated + counts.unchanged, completed_at: now, error_reason: counts.failed ? `${counts.failed} contact rows failed.` : null }).eq("id", job.id).eq("user_id", userId);
  return { runId: run.id as string, jobId: job.id as string, ...counts, fetched: page.contacts.length, nextCursor: page.nextCursor, hasMore: page.hasMore, rowErrors };
}
