// Node's strip-types test runner needs the extension; Next resolves it normally.
// @ts-expect-error TS5097: runtime TypeScript import is intentional.
import { csvToProspects, type ParsedProspect } from './csv-parse.ts'

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
  const email = candidateEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail)
    ? candidateEmail : null
  return {
    input_name: name,
    input_company: clean(prospect.company, 200),
    input_title: clean(prospect.title, 200),
    input_linkedin_url: clean(prospect.linkedin_url, 1000),
    email,
    email_source: email ? 'extracted' as const : 'none' as const,
    email_confidence: 'unknown' as const,
    phone: clean(prospect.phone, 40),
    input_source: source,
    status: 'pending' as const,
    lead_status: 'new' as const,
    next_action: 'review' as const,
  }
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
