import { createHash } from "node:crypto"

/** Bump this whenever canonicalization rules intentionally change. */
export const IDENTITY_NORMALIZATION_VERSION = 1

export function normalizeEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? ""
  // Deliberately do not apply provider-specific transformations (such as
  // Gmail plus-address stripping): those can merge distinct people.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

/**
 * Conservative, deterministic E.164 normalization.  We accept an explicit
 * international prefix only; a local number is never guessed into a country.
 */
export function normalizeE164(value: string | null | undefined): string | null {
  let phone = value?.trim() ?? ""
  if (!phone) return null
  phone = phone.replace(/[\s().-]/g, "")
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null
}

export function hashCanonicalIdentity(value: string | null | undefined): string | null {
  return value ? createHash("sha256").update(value, "utf8").digest("hex") : null
}

export function buildProspectIdentity(input: { email?: string | null; phone?: string | null }) {
  const normalizedEmail = normalizeEmail(input.email)
  const normalizedPhone = normalizeE164(input.phone)
  return {
    normalized_email: normalizedEmail,
    normalized_phone: normalizedPhone,
    // Kept explicitly named for callers introduced by the Phase 1 spec.
    normalized_phone_e164: normalizedPhone,
    email_hash: hashCanonicalIdentity(normalizedEmail),
    phone_hash: hashCanonicalIdentity(normalizedPhone),
    identity_normalization_version: IDENTITY_NORMALIZATION_VERSION,
  }
}
