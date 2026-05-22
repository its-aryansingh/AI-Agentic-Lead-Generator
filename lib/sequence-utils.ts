/**
 * sequence-utils.ts
 * Utility functions for multi-step sequences.
 */

/**
 * Replaces placeholders in a template string with actual prospect data.
 * Supported placeholders: {{first_name}}, {{last_name}}, {{name}}, {{company}}, {{title}}
 */
export function hydrateTemplate(
  template: string,
  prospect: {
    name?: string | null
    company?: string | null
    title?: string | null
  }
): string {
  if (!template) return ""

  const nameParts = (prospect.name || "").trim().split(/\s+/)
  const firstName = nameParts[0] || ""
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : ""

  const replacements: Record<string, string> = {
    "{{first_name}}": firstName,
    "{{last_name}}": lastName,
    "{{name}}": prospect.name || "",
    "{{company}}": prospect.company || "",
    "{{title}}": prospect.title || "",
  }

  // Replace all occurrences of the placeholders, case-insensitive.
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/gi, (match, p1) => {
    const key = `{{${p1.toLowerCase()}}}`
    if (key in replacements) {
      return replacements[key] || "" // if value is falsy, replace with empty string
    }
    return match // leave unsupported placeholders alone
  })
}
