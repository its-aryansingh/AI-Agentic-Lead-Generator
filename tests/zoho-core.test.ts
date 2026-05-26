/**
 * zoho-core — pure helper tests. The async OAuth + HTTP layer
 * (lib/providers/zoho.ts) is not exercised here; verification of that
 * path happens via the build + manual smoke once a real refresh token
 * is configured.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  normalizeZohoRegion,
  zohoAccountsHost,
  zohoApiHost,
  hasZohoCreds,
  contactToZohoFields,
  noteToZohoFields,
  clampZohoNote,
  mockZohoContactId,
  mockZohoNoteId,
  isTokenFresh,
  computeTokenExpiry,
} from "../lib/providers/zoho-core.ts"

// ---------- region ----------

test("normalizeZohoRegion accepts the known regions", () => {
  for (const r of ["com", "in", "eu", "com.au", "jp", "com.cn"]) {
    assert.equal(normalizeZohoRegion(r), r)
  }
})

test("normalizeZohoRegion strips a leading dot + lowercases", () => {
  assert.equal(normalizeZohoRegion(".IN"), "in")
  assert.equal(normalizeZohoRegion("EU"), "eu")
})

test("normalizeZohoRegion defaults to 'com' on garbage", () => {
  assert.equal(normalizeZohoRegion(undefined), "com")
  assert.equal(normalizeZohoRegion(""), "com")
  assert.equal(normalizeZohoRegion("xx"), "com")
})

test("zohoAccountsHost / zohoApiHost produce region-correct URLs", () => {
  assert.equal(zohoAccountsHost("in"), "https://accounts.zoho.in")
  assert.equal(zohoApiHost("in"), "https://www.zohoapis.in")
  assert.equal(zohoAccountsHost("com"), "https://accounts.zoho.com")
  assert.equal(zohoApiHost("com.au"), "https://www.zohoapis.com.au")
})

// ---------- creds ----------

test("hasZohoCreds requires all three of refresh/client_id/client_secret", () => {
  assert.equal(
    hasZohoCreds({ refreshToken: "r", clientId: "c", clientSecret: "s", region: "com" }),
    true,
  )
  assert.equal(
    hasZohoCreds({ refreshToken: "r", clientId: "c", clientSecret: undefined, region: "com" }),
    false,
  )
  assert.equal(
    hasZohoCreds({ refreshToken: undefined, clientId: "c", clientSecret: "s", region: "com" }),
    false,
  )
  assert.equal(hasZohoCreds({ refreshToken: undefined, clientId: undefined, clientSecret: undefined, region: undefined }), false)
})

// ---------- contact field mapping ----------

test("contactToZohoFields lowercases email and uses Zoho PascalCase keys", () => {
  const fields = contactToZohoFields({
    email: " PRIYA@razorpay.com ",
    first_name: "Priya",
    last_name: "Kumar",
    company: "Razorpay",
    job_title: "VP Marketing",
    linkedin_url: "https://linkedin.com/in/priyak",
    source_url: "razorpay.com",
  })
  assert.equal(fields.Email, "priya@razorpay.com")
  assert.equal(fields.First_Name, "Priya")
  assert.equal(fields.Last_Name, "Kumar")
  assert.equal(fields.Account_Name, "Razorpay")
  assert.equal(fields.Title, "VP Marketing")
  assert.equal(fields.LinkedIn, "https://linkedin.com/in/priyak")
  assert.match(fields.Description, /Source: razorpay\.com/)
})

test("contactToZohoFields synthesizes Last_Name when missing (Zoho requires it)", () => {
  const a = contactToZohoFields({ email: "alice@example.com", first_name: "Alice" })
  assert.equal(a.Last_Name, "Alice")

  const b = contactToZohoFields({ email: "x@y.com" })
  assert.equal(b.Last_Name, "x")
})

test("contactToZohoFields omits optional fields when unset", () => {
  const fields = contactToZohoFields({ email: "a@b.com" })
  // Email + synthesized Last_Name = 2 fields total.
  assert.deepEqual(Object.keys(fields).sort(), ["Email", "Last_Name"])
})

// ---------- note shaping ----------

test("noteToZohoFields wires Parent_Id + se_module=Contacts", () => {
  const fields = noteToZohoFields("12345", { body: "hello" })
  assert.equal(fields.Parent_Id, "12345")
  assert.equal(fields.se_module, "Contacts")
  assert.equal(fields.Note_Title, "LeadGenAI enrichment")
  assert.equal(fields.Note_Content, "hello")
})

test("clampZohoNote truncates past 32k with ellipsis", () => {
  const big = "a".repeat(40_000)
  const out = clampZohoNote(big)
  assert.equal(out.length, 32_000)
  assert.equal(out.endsWith("…"), true)
})

test("clampZohoNote leaves short bodies alone", () => {
  assert.equal(clampZohoNote("short"), "short")
})

// ---------- mock ids ----------

test("mockZohoContactId is deterministic per email", () => {
  assert.equal(mockZohoContactId("p@x.com"), mockZohoContactId("p@x.com"))
  assert.notEqual(mockZohoContactId("p@x.com"), mockZohoContactId("q@x.com"))
})

test("mockZohoNoteId is deterministic per seed", () => {
  assert.equal(mockZohoNoteId("c1:body"), mockZohoNoteId("c1:body"))
  assert.notEqual(mockZohoNoteId("c1:body"), mockZohoNoteId("c2:body"))
})

// ---------- token cache helpers ----------

test("isTokenFresh respects the 60s safety margin", () => {
  const now = 1_000_000
  // Token expiring in 5 minutes → fresh.
  assert.equal(isTokenFresh(now + 5 * 60_000, now), true)
  // Token expiring in 30s → NOT fresh (inside the 60s margin).
  assert.equal(isTokenFresh(now + 30_000, now), false)
  // Token already expired.
  assert.equal(isTokenFresh(now - 1, now), false)
  // No cache yet.
  assert.equal(isTokenFresh(null, now), false)
})

test("computeTokenExpiry adds expires_in seconds to now", () => {
  const now = 1_000_000
  assert.equal(computeTokenExpiry(3600, now), now + 3_600_000)
  // Negative expires_in clamps to 0 → expires immediately.
  assert.equal(computeTokenExpiry(-10, now), now)
})
