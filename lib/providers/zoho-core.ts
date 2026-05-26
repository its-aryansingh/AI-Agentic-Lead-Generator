/**
 * Zoho CRM provider — pure helpers. Import-free so
 * `node --test --experimental-strip-types` can load them. The async
 * OAuth + HTTP layer lives in zoho.ts.
 *
 * Zoho is region-aware: the API host suffix changes per data center
 * (.com / .in / .eu / .com.au / .jp). Users on a non-US tenant must
 * set ZOHO_REGION to the suffix their account is on; default is com.
 */

import type { CrmContactInput, CrmNoteInput } from "@/lib/providers/hubspot-core"

export type ZohoRegion = "com" | "in" | "eu" | "com.au" | "jp" | "com.cn"

const VALID_REGIONS: ReadonlySet<string> = new Set([
  "com",
  "in",
  "eu",
  "com.au",
  "jp",
  "com.cn",
])

/** Normalize whatever the env var said into a known region; fallback com. */
export function normalizeZohoRegion(raw: string | undefined): ZohoRegion {
  if (!raw) return "com"
  const lower = raw.trim().toLowerCase().replace(/^\./, "")
  if (VALID_REGIONS.has(lower)) return lower as ZohoRegion
  return "com"
}

export function zohoAccountsHost(region: ZohoRegion): string {
  return `https://accounts.zoho.${region}`
}

export function zohoApiHost(region: ZohoRegion): string {
  return `https://www.zohoapis.${region}`
}

export interface ZohoEnv {
  refreshToken: string | undefined
  clientId: string | undefined
  clientSecret: string | undefined
  region: string | undefined
}

export function hasZohoCreds(env: ZohoEnv): boolean {
  return Boolean(env.refreshToken && env.clientId && env.clientSecret)
}

/**
 * Map our shared CrmContactInput into Zoho's snake-PascalCase field
 * names (First_Name, Last_Name, Email, Account_Name, Title, …). Zoho's
 * API takes the contact under a `data: [...]` wrapper; this helper
 * returns just the inner row.
 */
export function contactToZohoFields(
  input: CrmContactInput,
): Record<string, string> {
  const fields: Record<string, string> = {
    Email: input.email.trim().toLowerCase(),
  }
  if (input.first_name) fields.First_Name = input.first_name
  if (input.last_name) fields.Last_Name = input.last_name
  // Zoho Contacts REQUIRES Last_Name. When we don't have one (only
  // first name provided), use the local-part of the email so the
  // create call succeeds instead of 400ing.
  if (!fields.Last_Name) {
    const local = fields.Email.split("@")[0] ?? "Contact"
    fields.Last_Name = (input.first_name || local).slice(0, 80)
  }
  if (input.company) fields.Account_Name = input.company
  if (input.job_title) fields.Title = input.job_title
  if (input.linkedin_url) fields.LinkedIn = input.linkedin_url
  if (input.source_url) fields.Description = `Source: ${input.source_url}`
  return fields
}

/**
 * Zoho's Notes module body shape. The note is attached to a parent
 * record via Parent_Id + se_module ("Contacts" for our use case).
 */
export function noteToZohoFields(
  contactId: string,
  note: CrmNoteInput,
): Record<string, string> {
  return {
    Note_Title: "LeadGenAI enrichment",
    Note_Content: clampZohoNote(note.body),
    Parent_Id: contactId,
    se_module: "Contacts",
  }
}

/** Zoho Notes module rejects bodies past 32k chars. Trim with ellipsis. */
export function clampZohoNote(body: string, max = 32_000): string {
  const trimmed = body.replace(/\r/g, "").trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1) + "…"
}

/** Deterministic mock contact id — same email → same id. */
export function mockZohoContactId(seed: string): string {
  let h = 5381
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0
  // Zoho contact ids are big numeric strings in real life; the prefix
  // makes it obvious in logs that this came from the mock path.
  return `mock-zoho-${Math.abs(h)}`
}

export function mockZohoNoteId(seed: string): string {
  let h = 1469598103
  for (let i = 0; i < seed.length; i++) h = (h * 16777619) ^ seed.charCodeAt(i)
  return `mock-zoho-note-${Math.abs(h)}`
}

/** True if a Zoho-shaped access-token response is still valid. */
export function isTokenFresh(expiresAtMs: number | null, nowMs: number): boolean {
  if (!expiresAtMs) return false
  // 60s safety margin so we don't fire a request right as the token expires.
  return expiresAtMs - nowMs > 60_000
}

export function computeTokenExpiry(
  expiresInSeconds: number,
  nowMs: number,
): number {
  return nowMs + Math.max(0, expiresInSeconds) * 1000
}
