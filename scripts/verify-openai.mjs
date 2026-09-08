#!/usr/bin/env node
/**
 * Live OpenAI verification — the one thing that cannot be proven without
 * network access to api.openai.com.
 *
 *   OPENAI_API_KEY=sk-... node scripts/verify-openai.mjs
 *
 * Sends ONE real gpt-4o-mini request using the exact response_format the
 * pipeline uses, on a small fixed page of text. Costs well under a rupee.
 *
 * It answers four questions the offline tests cannot:
 *   1. Does OpenAI accept our json_schema under strict:true?
 *   2. Does gpt-4o-mini honour the "never invent" instruction?
 *   3. What does a real call actually cost for this prompt shape?
 *   4. Is the key valid and does the account have access to the model?
 */

const KEY = process.env.OPENAI_API_KEY
if (!KEY) {
  console.error("OPENAI_API_KEY is not set.")
  process.exit(2)
}

const MODEL = process.env.OPENAI_EXTRACTION_MODEL ?? "gpt-4o-mini"
const BASE = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")
const USD_INR = Number(process.env.USD_INR_RATE ?? 88)

const SCHEMA = {
  type: "object",
  properties: {
    emails: { type: "array", items: { type: "string" } },
    phones: { type: "array", items: { type: "string" } },
    key_contacts: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, title: { type: "string" } },
        required: ["name", "title"],
        additionalProperties: false,
      },
    },
    social_links: { type: "array", items: { type: "string" } },
  },
  required: ["emails", "phones", "key_contacts", "social_links"],
  additionalProperties: false,
}

const SYSTEM = `You extract published business contact details from the text of a company's own public web pages.

You are reading pages from ONE Indian company. Return only what is literally printed in the text provided.

RULES
1. Never invent, complete, correct, or infer a value.
2. Copy phone numbers EXACTLY as printed, including any +91 or 0 prefix, STD code, brackets, spaces and hyphens. Do not reformat.
3. Include role mailboxes (info@, sales@, hr@). Also include named addresses.
4. EXCLUDE addresses belonging to website vendors, agencies or CMS tooling; placeholder values.
5. EXCLUDE anything that is not a phone number even if it looks like digits: GSTIN, CIN, PAN, PIN codes, invoice or licence numbers, years.
6. key_contacts: only people the page NAMES with a job title beside the name.
7. Every array may be empty. An empty array is preferred over a guess.`

// Contains three traps: a GSTIN, a PIN code, and an "invoice ref" that is
// shaped exactly like a 10-digit Indian mobile.
const PAGE = `===== PAGE: https://bharatprecision.in/contact =====
Bharat Precision Components Pvt Ltd
Plot 42, Sector 63, Noida, Uttar Pradesh 201309
GSTIN: 09AABCU9603R1ZM
CIN: U27100UP2011PTC045678
General enquiries: info@bharatprecision.in
Sales: sales@bharatprecision.in
Export desk: Priya.Sharma@bharatprecision.in
Landline: 0120-4567890
Toll Free: 1800 123 4567
Mobile: +91 98765 43210
Established 2011 - Pincode 201309 - Invoice ref 4567890123
Site by webmaster@wixpress.com
Priya Sharma - Managing Director
Rahul Verma - Head of Sales & Exports`

const body = {
  model: MODEL,
  temperature: 0,
  top_p: 1,
  max_tokens: 2000,
  messages: [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Company domain: bharatprecision.in\n\n${PAGE}` },
  ],
  response_format: {
    type: "json_schema",
    json_schema: { name: "public_business_contacts", strict: true, schema: SCHEMA },
  },
}

console.log(`POST ${BASE}/chat/completions  model=${MODEL}\n`)
const t0 = Date.now()

let res
try {
  res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
} catch (err) {
  console.error("NETWORK FAILURE:", err.message)
  console.error("The API was unreachable. Check egress/firewall, not the code.")
  process.exit(1)
}

const ms = Date.now() - t0
const json = await res.json().catch(() => null)

if (!res.ok) {
  console.error(`HTTP ${res.status} after ${ms}ms`)
  console.error(JSON.stringify(json, null, 2))
  if (res.status === 401) console.error("\n-> Key rejected. Wrong, revoked, or wrong project.")
  if (res.status === 404) console.error(`\n-> Model "${MODEL}" not available to this account.`)
  if (res.status === 400 && /schema/i.test(json?.error?.message ?? ""))
    console.error("\n-> OpenAI REJECTED THE SCHEMA. This is the finding. Paste the message above.")
  if (res.status === 429) console.error("\n-> Rate limited or no quota/billing on the account.")
  process.exit(1)
}

const choice = json.choices?.[0]
console.log(`HTTP 200 in ${ms}ms  ·  resolved model: ${json.model}`)
console.log(`finish_reason: ${choice?.finish_reason}  ·  refusal: ${choice?.message?.refusal ?? "none"}`)

if (choice?.message?.refusal) {
  console.error("\nModel REFUSED. The pipeline treats this as terminal (no retry).")
  process.exit(1)
}

let parsed
try {
  parsed = JSON.parse(choice.message.content)
} catch {
  console.error("\nContent was not valid JSON — strict mode did not hold:")
  console.error(choice?.message?.content)
  process.exit(1)
}

console.log("\n--- raw model output ---")
console.log(JSON.stringify(parsed, null, 2))

const u = json.usage ?? {}
const usd = (u.prompt_tokens / 1e6) * 0.15 + (u.completion_tokens / 1e6) * 0.6
console.log("\n--- usage ---")
console.log(`in ${u.prompt_tokens}  out ${u.completion_tokens}  ·  $${usd.toFixed(6)}  ·  ${Math.ceil(usd * USD_INR * 100)} paise`)

console.log("\n--- did it obey the rules? ---")
const flat = JSON.stringify(parsed)
const checks = [
  ["schema shape is exact", ["emails","phones","key_contacts","social_links"].every(k => k in parsed) && Object.keys(parsed).length === 4],
  ["kept the named address", parsed.emails.some(e => /priya\.sharma@bharatprecision\.in/i.test(e))],
  ["kept role mailboxes", parsed.emails.some(e => /^info@/i.test(e))],
  ["rejected the vendor address", !/wixpress/i.test(flat)],
  ["rejected the GSTIN", !/09AABCU9603R1ZM/i.test(flat)],
  ["rejected the PIN code", !parsed.phones.some(p => p.replace(/\D/g,"") === "201309")],
  ["rejected the invoice ref", !parsed.phones.some(p => p.replace(/\D/g,"") === "4567890123")],
  ["kept all three real numbers", ["9876543210","1204567890","18001234567"]
      .every(d => parsed.phones.some(p => p.replace(/\D/g,"").endsWith(d.slice(-8))))],
  ["named both real people", parsed.key_contacts.length >= 2],
  ["invented nobody", !/Vikram|Anita/i.test(flat)],
]
let bad = 0
for (const [label, okv] of checks) { console.log(`  ${okv ? "PASS" : "FAIL"}  ${label}`); if (!okv) bad++ }

console.log(bad === 0
  ? "\nLIVE VERIFICATION PASSED — schema accepted, traps rejected, real values kept."
  : `\n${bad} check(s) failed. The validator would still catch these before the DB, but review the prompt.`)
process.exit(bad === 0 ? 0 : 1)
