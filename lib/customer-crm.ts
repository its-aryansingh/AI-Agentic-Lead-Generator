import {
  contactToHubSpotProperties,
  clampNoteBody,
  type CrmContactInput,
} from "@/lib/providers/hubspot-core";
import {
  contactToZohoFields,
  noteToZohoFields,
  normalizeZohoRegion,
  zohoAccountsHost,
  zohoApiHost,
  type ZohoEnv,
} from "@/lib/providers/zoho-core";
import { buildProspectIdentity } from "@/lib/prospect-identity";

const timeout = 12_000;
async function jsonFetch(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeout),
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, json };
}
export class CustomerCrmProviderError extends Error {
  public readonly provider: "hubspot" | "zoho";
  public readonly status: number;
  constructor(
    provider: "hubspot" | "zoho",
    status: number,
    message: string,
  ) {
    super(`${provider === "hubspot" ? "HubSpot" : "Zoho"} CRM error (${status}): ${message}`);
    this.name = "CustomerCrmProviderError";
    this.provider = provider;
    this.status = status;
  }
}
function objectId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    id?: unknown;
    data?: Array<{ id?: unknown; details?: { id?: unknown } }>;
  };
  const id = row.id ?? row.data?.[0]?.id ?? row.data?.[0]?.details?.id;
  return typeof id === "string" ? id : null;
}
function message(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const row = value as {
    message?: unknown;
    data?: Array<{ message?: unknown }>;
  };
  return String(row.message ?? row.data?.[0]?.message ?? "");
}
export type CustomerCrmCredentials =
  | { provider: "hubspot"; accessToken: string }
  | {
      provider: "zoho";
      refreshToken: string;
      clientId: string;
      clientSecret: string;
      region: string;
    };

export type PullCustomerCrmOptions = {
  limit?: number;
  modifiedAfter?: Date | string;
  cursor?: string;
};

export type NormalizedCrmContact = {
  providerContactId: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  normalizedEmail: string | null;
  normalizedPhoneE164: string | null;
  emailHash: string | null;
  phoneHash: string | null;
  modifiedAt: string | null;
  rawMetadata: Record<string, unknown>;
};

const CRM_PULL_PROPERTIES = [
  "firstname", "lastname", "company", "jobtitle", "email", "phone", "hs_lastmodifieddate",
] as const;
const ZOHO_PULL_FIELDS = "id,First_Name,Last_Name,Account_Name,Title,Email,Phone,Modified_Time";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function isoDate(value: Date | string | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("modifiedAfter must be a valid date.");
  return date.toISOString();
}
function normalizedContact(input: {
  id: unknown; firstName?: unknown; lastName?: unknown; company?: unknown; jobTitle?: unknown;
  email?: unknown; phone?: unknown; modifiedAt?: unknown; rawMetadata: Record<string, unknown>;
}): NormalizedCrmContact {
  const providerContactId = text(input.id);
  if (!providerContactId) throw new Error("CRM contact is missing its provider ID.");
  const email = text(input.email);
  const phone = text(input.phone);
  const identity = buildProspectIdentity({ email, phone });
  return {
    providerContactId, firstName: text(input.firstName), lastName: text(input.lastName),
    company: text(input.company), jobTitle: text(input.jobTitle), email: identity.normalized_email,
    phone, normalizedEmail: identity.normalized_email,
    normalizedPhoneE164: identity.normalized_phone_e164, emailHash: identity.email_hash,
    phoneHash: identity.phone_hash, modifiedAt: text(input.modifiedAt), rawMetadata: input.rawMetadata,
  };
}

/** Pulls one provider page. Credentials remain server-only; callers must never serialize them. */
export async function pullCustomerCrm(
  credentials: CustomerCrmCredentials,
  options: PullCustomerCrmOptions = {},
): Promise<{ contacts: NormalizedCrmContact[]; nextCursor: string | null; hasMore: boolean }> {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 100)));
  const modifiedAfter = isoDate(options.modifiedAfter);
  if (credentials.provider === "hubspot") {
    const body: Record<string, unknown> = {
      limit, after: options.cursor, properties: CRM_PULL_PROPERTIES,
      sorts: ["hs_lastmodifieddate"],
    };
    if (modifiedAfter) body.filterGroups = [{ filters: [{ propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(new Date(modifiedAfter).getTime()) }] }];
    const result = await jsonFetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST", headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!result.ok) throw new CustomerCrmProviderError("hubspot", result.status, message(result.json) || "contact pull failed");
    const json = result.json as { results?: Array<{ id?: unknown; properties?: Record<string, unknown>; archived?: unknown }>; paging?: { next?: { after?: unknown } } };
    const nextCursor = text(json.paging?.next?.after);
    return {
      contacts: (json.results ?? []).filter((row) => !row.archived).map((row) => {
        const p = row.properties ?? {};
        return normalizedContact({ id: row.id, firstName: p.firstname, lastName: p.lastname, company: p.company, jobTitle: p.jobtitle, email: p.email, phone: p.phone, modifiedAt: p.hs_lastmodifieddate, rawMetadata: p });
      }), nextCursor, hasMore: Boolean(nextCursor),
    };
  }
  const { token, region } = await zohoAccessToken(credentials);
  const url = new URL(`${zohoApiHost(region)}/crm/v6/Contacts`);
  url.searchParams.set("fields", ZOHO_PULL_FIELDS);
  url.searchParams.set("per_page", String(limit));
  if (options.cursor) url.searchParams.set("page_token", options.cursor);
  // Zoho's list endpoint has no portable Modified_Time filter.  COQL would
  // exclude pagination tokens, so we use its supported `If-Modified-Since` header.
  const result = await jsonFetch(url.toString(), { headers: { Authorization: `Zoho-oauthtoken ${token}`, ...(modifiedAfter ? { "If-Modified-Since": modifiedAfter } : {}) } });
  if (!result.ok) throw new CustomerCrmProviderError("zoho", result.status, message(result.json) || "contact pull failed");
  const json = result.json as { data?: Array<Record<string, unknown>>; info?: { next_page_token?: unknown; more_records?: unknown } };
  const nextCursor = text(json.info?.next_page_token);
  return {
    contacts: (json.data ?? []).map((row) => normalizedContact({ id: row.id, firstName: row.First_Name, lastName: row.Last_Name, company: row.Account_Name, jobTitle: row.Title, email: row.Email, phone: row.Phone, modifiedAt: row.Modified_Time, rawMetadata: row })),
    nextCursor, hasMore: Boolean(nextCursor || json.info?.more_records),
  };
}

export async function verifyCustomerCrm(credentials: CustomerCrmCredentials) {
  if (credentials.provider === "hubspot") {
    const result = await jsonFetch(
      "https://api.hubapi.com/crm/v3/objects/contacts?limit=1",
      { headers: { Authorization: `Bearer ${credentials.accessToken}` } },
    );
    if (!result.ok)
      throw new Error(
        `HubSpot verification failed (${result.status}): ${message(result.json)}`,
      );
    return;
  }
  await zohoAccessToken(credentials);
}
async function zohoAccessToken(
  credentials: Extract<CustomerCrmCredentials, { provider: "zoho" }>,
) {
  const env: ZohoEnv = {
    refreshToken: credentials.refreshToken,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    region: credentials.region,
  };
  const region = normalizeZohoRegion(env.region),
    url = new URL(`${zohoAccountsHost(region)}/oauth/v2/token`);
  url.searchParams.set("refresh_token", credentials.refreshToken);
  url.searchParams.set("client_id", credentials.clientId);
  url.searchParams.set("client_secret", credentials.clientSecret);
  url.searchParams.set("grant_type", "refresh_token");
  const result = await jsonFetch(url.toString(), { method: "POST" });
  const token = (result.json as { access_token?: unknown }).access_token;
  if (!result.ok || typeof token !== "string")
    throw new Error(
      `Zoho verification failed (${result.status}): ${message(result.json) || "token refresh rejected"}`,
    );
  return { token, region };
}
export async function pushCustomerCrm(
  credentials: CustomerCrmCredentials,
  contact: CrmContactInput,
  noteBody: string,
) {
  if (credentials.provider === "hubspot") {
    const headers = {
      Authorization: `Bearer ${credentials.accessToken}`,
      "Content-Type": "application/json",
    };
    const properties = contactToHubSpotProperties(contact);
    let result = await jsonFetch(
      "https://api.hubapi.com/crm/v3/objects/contacts",
      { method: "POST", headers, body: JSON.stringify({ properties }) },
    );
    let contactId = objectId(result.json),
      created = true;
    if (result.status === 409) {
      result = await jsonFetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(properties.email)}?idProperty=email`,
        { headers },
      );
      contactId = objectId(result.json);
      created = false;
      if (contactId)
        result = await jsonFetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
          { method: "PATCH", headers, body: JSON.stringify({ properties }) },
        );
    }
    if (!result.ok || !contactId)
      throw new Error(
        `HubSpot contact sync failed (${result.status}): ${message(result.json)}`,
      );
    const note = await jsonFetch(
      "https://api.hubapi.com/crm/v3/objects/notes",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          properties: {
            hs_note_body: clampNoteBody(noteBody),
            hs_timestamp: new Date().toISOString(),
          },
          associations: [
            {
              to: { id: contactId },
              types: [
                {
                  associationCategory: "HUBSPOT_DEFINED",
                  associationTypeId: 202,
                },
              ],
            },
          ],
        }),
      },
    );
    const noteId = objectId(note.json);
    if (!note.ok || !noteId)
      throw new Error(
        `HubSpot note sync failed (${note.status}): ${message(note.json)}`,
      );
    return { contactId, noteId, created };
  }
  const { token, region } = await zohoAccessToken(credentials),
    headers = {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    base = zohoApiHost(region),
    fields = contactToZohoFields(contact);
  const search = await jsonFetch(
      `${base}/crm/v6/Contacts/search?email=${encodeURIComponent(fields.Email)}`,
      { headers },
    );
  let contactId = objectId(search.json);
  const created = !contactId;
  const contactResult = contactId
    ? await jsonFetch(`${base}/crm/v6/Contacts/${contactId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ data: [fields] }),
      })
    : await jsonFetch(`${base}/crm/v6/Contacts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ data: [fields] }),
      });
  contactId = contactId ?? objectId(contactResult.json);
  if (!contactResult.ok || !contactId)
    throw new Error(
      `Zoho contact sync failed (${contactResult.status}): ${message(contactResult.json)}`,
    );
  const note = await jsonFetch(`${base}/crm/v6/Notes`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        data: [noteToZohoFields(contactId, { body: noteBody })],
      }),
    }),
    noteId = objectId(note.json);
  if (!note.ok || !noteId)
    throw new Error(
      `Zoho note sync failed (${note.status}): ${message(note.json)}`,
    );
  return { contactId, noteId, created };
}
