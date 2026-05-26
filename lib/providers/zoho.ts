/**
 * Zoho CRM provider — OAuth refresh-token flow + Contact upsert +
 * Notes attach. Mirrors the surface of lib/providers/hubspot.ts so
 * the agent handler can dispatch on a `crm` param without per-vendor
 * branches in every call site.
 *
 * Auth requires three env vars, all from a Zoho Self Client (one-time
 * setup in Zoho's Developer Console):
 *   ZOHO_CLIENT_ID
 *   ZOHO_CLIENT_SECRET
 *   ZOHO_REFRESH_TOKEN
 * Plus optional ZOHO_REGION (default 'com'; use 'in' for India accounts).
 *
 * Mock fallback: when any of the three creds is unset, every operation
 * returns a deterministic mock result so dev/demo flows work key-free.
 */

import {
  computeTokenExpiry,
  contactToZohoFields,
  hasZohoCreds,
  isTokenFresh,
  mockZohoContactId,
  mockZohoNoteId,
  normalizeZohoRegion,
  noteToZohoFields,
  zohoAccountsHost,
  zohoApiHost,
  type ZohoEnv,
  type ZohoRegion,
} from "@/lib/providers/zoho-core"
import { isValidEmail } from "@/lib/providers/hubspot-core"
import type {
  AddNoteResult,
  PushContactResult,
} from "@/lib/providers/hubspot"
import type { CrmContactInput, CrmNoteInput } from "@/lib/providers/hubspot-core"

const REQUEST_TIMEOUT_MS = 12_000

interface TokenCache {
  accessToken: string
  expiresAtMs: number
  region: ZohoRegion
}

// Module-level cache. Serverless cold starts will re-refresh on first
// request; warm invocations re-use the access token until ~60s before
// expiry. Cheap enough that we don't need Redis.
let cached: TokenCache | null = null

function readEnv(): ZohoEnv {
  return {
    refreshToken: process.env.ZOHO_REFRESH_TOKEN,
    clientId: process.env.ZOHO_CLIENT_ID,
    clientSecret: process.env.ZOHO_CLIENT_SECRET,
    region: process.env.ZOHO_REGION,
  }
}

export function isZohoConfigured(): boolean {
  return hasZohoCreds(readEnv())
}

async function getAccessToken(env: ZohoEnv): Promise<{ token: string; region: ZohoRegion } | { error: string }> {
  const region = normalizeZohoRegion(env.region)
  if (cached && cached.region === region && isTokenFresh(cached.expiresAtMs, Date.now())) {
    return { token: cached.accessToken, region }
  }

  const url = new URL(`${zohoAccountsHost(region)}/oauth/v2/token`)
  url.searchParams.set("refresh_token", env.refreshToken!)
  url.searchParams.set("client_id", env.clientId!)
  url.searchParams.set("client_secret", env.clientSecret!)
  url.searchParams.set("grant_type", "refresh_token")

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string
      expires_in?: number
      error?: string
    }
    if (!res.ok || !json.access_token) {
      return { error: json.error ?? `Zoho token refresh ${res.status}` }
    }
    cached = {
      accessToken: json.access_token,
      expiresAtMs: computeTokenExpiry(json.expires_in ?? 3500, Date.now()),
      region,
    }
    return { token: json.access_token, region }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

async function zohoFetch(
  region: ZohoRegion,
  accessToken: string,
  path: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  try {
    const res = await fetch(`${zohoApiHost(region)}${path}`, {
      ...init,
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    // 204 (no content) is a normal "no match" response on /search.
    const json = res.status === 204 ? {} : await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, json }
  } catch (err) {
    return { ok: false, status: 0, json: { message: (err as Error).message } }
  }
}

/**
 * Upsert a Contact by email. Zoho's upsert endpoint exists but
 * requires explicit duplicate_check_fields config; we use the
 * portable search + create/update pattern instead.
 */
export async function pushZohoContact(input: CrmContactInput): Promise<PushContactResult> {
  if (!isValidEmail(input.email)) {
    return { ok: false, contact_id: "", created: false, mock: false, error: "invalid email" }
  }

  const env = readEnv()
  if (!hasZohoCreds(env)) {
    return {
      ok: true,
      contact_id: mockZohoContactId(input.email),
      created: true,
      mock: true,
    }
  }

  const tokenRes = await getAccessToken(env)
  if ("error" in tokenRes) {
    return { ok: false, contact_id: "", created: false, mock: false, error: tokenRes.error }
  }
  const { token, region } = tokenRes

  const fields = contactToZohoFields(input)

  // 1) Search by email — returns 204 if no match.
  const searchRes = await zohoFetch(
    region,
    token,
    `/crm/v6/Contacts/search?email=${encodeURIComponent(fields.Email)}`,
    { method: "GET" },
  )

  const existingId = readZohoFirstId(searchRes.json)
  if (existingId) {
    const update = await zohoFetch(
      region,
      token,
      `/crm/v6/Contacts/${existingId}`,
      {
        method: "PUT",
        body: JSON.stringify({ data: [fields] }),
      },
    )
    return {
      ok: update.ok,
      contact_id: existingId,
      created: false,
      mock: false,
      error: update.ok ? undefined : `Zoho ${update.status}: ${readZohoMessage(update.json)}`,
    }
  }

  // 2) Create new.
  const create = await zohoFetch(region, token, "/crm/v6/Contacts", {
    method: "POST",
    body: JSON.stringify({ data: [fields] }),
  })
  const newId = readZohoFirstId(create.json)
  return {
    ok: create.ok && Boolean(newId),
    contact_id: newId ?? "",
    created: true,
    mock: false,
    error:
      create.ok && newId
        ? undefined
        : `Zoho ${create.status}: ${readZohoMessage(create.json)}`,
  }
}

export async function addZohoNote(
  contactId: string,
  note: CrmNoteInput,
): Promise<AddNoteResult> {
  if (!contactId) {
    return { ok: false, note_id: "", mock: false, error: "missing contact id" }
  }

  const env = readEnv()
  if (!hasZohoCreds(env)) {
    return {
      ok: true,
      note_id: mockZohoNoteId(`${contactId}:${note.body}`),
      mock: true,
    }
  }

  const tokenRes = await getAccessToken(env)
  if ("error" in tokenRes) {
    return { ok: false, note_id: "", mock: false, error: tokenRes.error }
  }
  const { token, region } = tokenRes

  const res = await zohoFetch(region, token, "/crm/v6/Notes", {
    method: "POST",
    body: JSON.stringify({ data: [noteToZohoFields(contactId, note)] }),
  })
  const id = readZohoFirstId(res.json)
  return {
    ok: res.ok && Boolean(id),
    note_id: id ?? "",
    mock: false,
    error:
      res.ok && id
        ? undefined
        : `Zoho ${res.status}: ${readZohoMessage(res.json)}`,
  }
}

// ----- response helpers -----

/**
 * Zoho's standard envelope is `{ data: [ { details: { id: "..." }, ... } ] }`.
 * Search uses the same shape; create/update/notes echo it back.
 */
function readZohoFirstId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const arr = (payload as { data?: unknown[] }).data
  if (!Array.isArray(arr) || arr.length === 0) return null
  const first = arr[0] as Record<string, unknown>
  // Direct id on the row (search response).
  if (typeof first.id === "string") return first.id
  // Nested under details (create/update response).
  const details = first.details as Record<string, unknown> | undefined
  if (details && typeof details.id === "string") return details.id
  return null
}

function readZohoMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return ""
  const o = payload as Record<string, unknown>
  if (typeof o.message === "string") return o.message
  const arr = o.data as Array<Record<string, unknown>> | undefined
  if (Array.isArray(arr) && arr[0] && typeof arr[0].message === "string") {
    return arr[0].message as string
  }
  return ""
}

/** Test-only — drop the cached token so a fresh refresh fires next call. */
export function __resetZohoTokenCache(): void {
  cached = null
}
