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

const timeout = 12_000;
async function jsonFetch(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeout),
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, json };
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
