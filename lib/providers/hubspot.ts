/**
 * HubSpot CRM provider — upsert a contact + attach a note from an
 * enriched prospect / completed campaign. Read by the `push_to_crm`
 * agent tool.
 *
 * Auth: a HubSpot Private App token in `HUBSPOT_API_KEY`. Without it
 * we mock cleanly so the whole flow runs key-free (matching every
 * other provider).
 *
 * API reference:
 *   POST /crm/v3/objects/contacts            (create)
 *   POST /crm/v3/objects/contacts/{id}       (update by id)
 *   GET  /crm/v3/objects/contacts/{email}?idProperty=email
 *   POST /crm/v3/objects/notes               (create note + association)
 */

import {
  clampNoteBody,
  contactToHubSpotProperties,
  hubspotConfigured,
  isValidEmail,
  mockContactId,
  mockNoteId,
  type CrmContactInput,
  type CrmNoteInput,
} from "@/lib/providers/hubspot-core"

const API_BASE = "https://api.hubapi.com"
const REQUEST_TIMEOUT_MS = 12_000

export interface PushContactResult {
  ok: boolean
  contact_id: string
  created: boolean
  mock: boolean
  error?: string
}

export interface AddNoteResult {
  ok: boolean
  note_id: string
  mock: boolean
  error?: string
}

export function isHubSpotConfigured(): boolean {
  return hubspotConfigured(process.env.HUBSPOT_API_KEY)
}

function authHeader(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
    "Content-Type": "application/json",
  }
}

async function hubFetch(
  path: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...authHeader(), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const json = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, json }
  } catch (err) {
    return { ok: false, status: 0, json: { message: (err as Error).message } }
  }
}

/**
 * Upsert a contact by email. HubSpot's create endpoint returns 409 on
 * duplicate; we fall through to a GET by `idProperty=email` to fetch
 * the existing id and then PATCH. Three calls in the duplicate path,
 * one in the happy path — well within the free-tier rate limit.
 */
export async function pushContact(input: CrmContactInput): Promise<PushContactResult> {
  if (!isValidEmail(input.email)) {
    return {
      ok: false,
      contact_id: "",
      created: false,
      mock: false,
      error: "invalid email",
    }
  }

  if (!isHubSpotConfigured()) {
    return {
      ok: true,
      contact_id: mockContactId(input.email),
      created: true,
      mock: true,
    }
  }

  const properties = contactToHubSpotProperties(input)

  const create = await hubFetch("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  })
  if (create.ok) {
    const id = readId(create.json)
    return { ok: true, contact_id: id ?? "", created: true, mock: false }
  }
  if (create.status === 409) {
    const existing = await hubFetch(
      `/crm/v3/objects/contacts/${encodeURIComponent(properties.email)}?idProperty=email`,
      { method: "GET" },
    )
    const id = readId(existing.json)
    if (!id) {
      return {
        ok: false,
        contact_id: "",
        created: false,
        mock: false,
        error: "duplicate but lookup failed",
      }
    }
    const update = await hubFetch(`/crm/v3/objects/contacts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    })
    return {
      ok: update.ok,
      contact_id: id,
      created: false,
      mock: false,
      error: update.ok ? undefined : `HubSpot ${update.status}`,
    }
  }
  return {
    ok: false,
    contact_id: "",
    created: false,
    mock: false,
    error: `HubSpot ${create.status}: ${readMessage(create.json)}`,
  }
}

export async function addNote(
  contactId: string,
  note: CrmNoteInput,
): Promise<AddNoteResult> {
  if (!contactId) {
    return { ok: false, note_id: "", mock: false, error: "missing contact id" }
  }

  if (!isHubSpotConfigured()) {
    return {
      ok: true,
      note_id: mockNoteId(`${contactId}:${note.body}`),
      mock: true,
    }
  }

  const ts = note.timestamp ?? new Date().toISOString()
  const body = clampNoteBody(note.body)

  // HubSpot's "note" engagement requires a hs_note_body property + a
  // contact-to-note association (assoc type 202).
  const res = await hubFetch("/crm/v3/objects/notes", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        hs_note_body: body,
        hs_timestamp: ts,
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
  })
  const id = readId(res.json)
  return {
    ok: res.ok && Boolean(id),
    note_id: id ?? "",
    mock: false,
    error: res.ok ? undefined : `HubSpot ${res.status}: ${readMessage(res.json)}`,
  }
}

function readId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const o = payload as Record<string, unknown>
  if (typeof o.id === "string") return o.id
  return null
}

function readMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return ""
  const o = payload as Record<string, unknown>
  if (typeof o.message === "string") return o.message
  return ""
}
