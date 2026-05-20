/**
 * Lightweight CSV serializer.
 *
 * Lives in its own file (separate from lib/providers/google-sheets) so
 * unit tests can import it without pulling in the googleapis runtime
 * or the @/* path alias.
 */

export interface ProspectRow {
  name: string
  title: string
  company: string
  email?: string | null
  email_confidence?: string | null
  research_summary?: string | null
  email_subject?: string | null
  email_body?: string | null
  talking_points?: string[] | null
  source_url?: string | null
}

export const CSV_HEADER_ROW = [
  "Name",
  "Title",
  "Company",
  "Email",
  "Email confidence",
  "Research summary",
  "Email subject",
  "Email body",
  "Talking point 1",
  "Talking point 2",
  "Talking point 3",
  "Source URL",
  "Generated at",
]

export function rowToCsvValues(r: ProspectRow): string[] {
  const t = r.talking_points ?? []
  return [
    r.name,
    r.title,
    r.company,
    r.email ?? "",
    r.email_confidence ?? "",
    r.research_summary ?? "",
    r.email_subject ?? "",
    r.email_body ?? "",
    t[0] ?? "",
    t[1] ?? "",
    t[2] ?? "",
    r.source_url ?? "",
    new Date().toISOString(),
  ]
}

export function rowsToCsv(rows: ProspectRow[]): string {
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return ""
    const s = String(v)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [CSV_HEADER_ROW.join(",")]
  for (const r of rows) {
    lines.push(rowToCsvValues(r).map(esc).join(","))
  }
  return lines.join("\n")
}
