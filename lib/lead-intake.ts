// Node's strip-types test runner needs the extension; Next resolves it normally.
import { csvToProspects, type ParsedProspect } from '@/lib/csv-parse'
import { buildProspectIdentity, normalizeE164 } from '@/lib/prospect-identity'

export const MAX_CSV_BYTES = 2 * 1024 * 1024
export const MAX_IMPORT_ROWS = 1000

function clean(value: unknown, max = 500): string | null {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, max) : null
}

export function buildIntakeProspect(
  prospect: ParsedProspect & { phone?: string },
  source: 'manual' | 'csv',
) {
  const name = clean(prospect.name, 200)
  if (!name) throw new Error('Lead name is required.')
  const candidateEmail = clean(prospect.email, 320)
  const identity = buildProspectIdentity({ email: candidateEmail, phone: clean(prospect.phone, 40) })
  const email = identity.normalized_email
  const phone = normalizeE164(prospect.phone) ?? clean(prospect.phone, 40)
  return {
    input_name: name,
    input_company: clean(prospect.company, 200),
    input_title: clean(prospect.title, 200),
    input_linkedin_url: clean(prospect.linkedin_url, 1000),
    email,
    email_source: email ? 'extracted' as const : 'none' as const,
    email_confidence: 'unknown' as const,
    phone,
    ...identity,
    input_source: source,
    status: 'pending' as const,
    lead_status: 'new' as const,
    next_action: 'review' as const,
  }
}

/**
 * Duplicate lead rows retain their normalized contact values so every
 * person-level policy still sees the same identity. The earliest canonical
 * row alone owns the unique hashes used for default intake deduplication.
 */
export function prepareConfirmedDuplicateProspect(
  row: ReturnType<typeof buildIntakeProspect>,
  duplicate: { phone: boolean; email: boolean },
) {
  return {
    ...row,
    phone_hash: duplicate.phone ? null : row.phone_hash,
    email_hash: duplicate.email ? null : row.email_hash,
  };
}

export function parseLeadCsv(input: string) {
  const parsed = csvToProspects(input)
  if (parsed.prospects.length > MAX_IMPORT_ROWS) {
    throw new Error('CSV imports are limited to 1000 leads.')
  }
  return {
    rows: parsed.prospects.map((row) => buildIntakeProspect(row, 'csv')),
    warnings: parsed.warnings,
  }
}
