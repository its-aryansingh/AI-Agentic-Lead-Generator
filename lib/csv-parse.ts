/**
 * Tiny zero-dependency CSV parser.
 *
 * Handles the common cases users actually hit:
 *   - Quoted fields with embedded commas
 *   - Doubled-quote escapes inside quoted fields
 *   - \r\n, \n, and \r line endings
 *   - Optional header row
 *
 * Not a full RFC 4180 implementation — doesn't support multi-character
 * delimiters or quoted line breaks split across records. For the
 * prospect-list use case (Apollo exports, LinkedIn Sales Navigator,
 * Hunter exports) this covers >95% of real files.
 */

export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ""
  let inQuotes = false
  let i = 0
  const n = input.length

  while (i < n) {
    const c = input[i]

    if (inQuotes) {
      if (c === '"') {
        // Escaped quote ("") inside a quoted field
        if (i + 1 < n && input[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }

    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ",") {
      cur.push(field)
      field = ""
      i++
      continue
    }
    if (c === "\r") {
      cur.push(field)
      rows.push(cur)
      cur = []
      field = ""
      i++
      if (i < n && input[i] === "\n") i++
      continue
    }
    if (c === "\n") {
      cur.push(field)
      rows.push(cur)
      cur = []
      field = ""
      i++
      continue
    }
    field += c
    i++
  }

  // Flush the final record (handles files without trailing newline).
  if (field.length > 0 || cur.length > 0) {
    cur.push(field)
    rows.push(cur)
  }

  // Drop fully-empty trailing rows.
  while (rows.length > 0 && rows[rows.length - 1].every((f) => f === "")) {
    rows.pop()
  }

  return rows
}

export interface ParsedProspect {
  name: string
  company?: string
  title?: string
  linkedin_url?: string
  email?: string
}

const HEADER_ALIASES: Record<keyof ParsedProspect, string[]> = {
  name: ["name", "full name", "full_name", "fullname", "contact name", "person"],
  company: ["company", "company name", "company_name", "organization", "employer", "account"],
  title: ["title", "job title", "job_title", "role", "position"],
  linkedin_url: [
    "linkedin",
    "linkedin url",
    "linkedin_url",
    "linkedin profile",
    "profile url",
    "url",
  ],
  email: ["email", "email address", "work email"],
}

/**
 * Auto-detects which CSV column maps to which prospect field by header
 * name. Returns parsed prospect rows in the canonical shape that
 * add_named_prospects accepts.
 *
 * If the first row doesn't look like a header (no recognized keys),
 * we assume column order: name, company, title, linkedin_url, email.
 */
export function csvToProspects(input: string): {
  prospects: ParsedProspect[]
  warnings: string[]
} {
  const rows = parseCsv(input)
  if (rows.length === 0) return { prospects: [], warnings: ["CSV is empty."] }

  const headerRow = rows[0].map((h) => h.trim().toLowerCase())
  const mapping: Partial<Record<keyof ParsedProspect, number>> = {}
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [keyof ParsedProspect, string[]]
  >) {
    const idx = headerRow.findIndex((h) => aliases.includes(h))
    if (idx >= 0) mapping[field] = idx
  }

  const warnings: string[] = []
  let dataStart = 1
  if (mapping.name === undefined) {
    // No recognized header — assume positional layout.
    dataStart = 0
    mapping.name = 0
    mapping.company = 1
    mapping.title = 2
    mapping.linkedin_url = 3
    mapping.email = 4
    warnings.push(
      "No recognized column headers — assumed positional layout: name, company, title, linkedin_url, email.",
    )
  }

  const prospects: ParsedProspect[] = []
  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r]
    const name = mapping.name !== undefined ? (row[mapping.name] ?? "").trim() : ""
    if (!name) continue
    prospects.push({
      name,
      company:
        mapping.company !== undefined
          ? (row[mapping.company] ?? "").trim() || undefined
          : undefined,
      title:
        mapping.title !== undefined
          ? (row[mapping.title] ?? "").trim() || undefined
          : undefined,
      linkedin_url:
        mapping.linkedin_url !== undefined
          ? (row[mapping.linkedin_url] ?? "").trim() || undefined
          : undefined,
      email:
        mapping.email !== undefined
          ? (row[mapping.email] ?? "").trim() || undefined
          : undefined,
    })
  }

  if (prospects.length === 0) {
    warnings.push("No usable rows — at minimum each row needs a name.")
  }
  return { prospects, warnings }
}
