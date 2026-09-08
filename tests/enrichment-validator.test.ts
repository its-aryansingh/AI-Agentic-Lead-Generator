/**
 * Validator tests — run with the repo's existing runner:
 *   node --test --experimental-strip-types tests/enrichment-validator.test.ts
 *
 * These cover the cases that actually cost money or credibility in
 * production: a hallucinated contact reaching the database, a GSTIN
 * being dialled as a phone number, and a verified email being clobbered
 * by a scraped one.
 */

import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import {
  pickPrimary,
  validateEmails,
  validateExtraction,
  validatePhones,
  validateSocialLinks,
  buildPageIndex,
} from "../lib/enrichment/validator.ts"
import type { CrawledPage } from "../lib/enrichment/types.ts"

const DOMAIN = "acmesteel.in"

const PAGES: CrawledPage[] = [
  {
    url: "https://acmesteel.in/contact",
    title: "Contact — Acme Steel",
    status: 200,
    text: [
      "Acme Steel Pvt Ltd",
      "Plot 42, Sector 62, Noida, Uttar Pradesh 201309",
      "Email: info@acmesteel.in",
      "Sales: priya.sharma@acmesteel.in",
      "Mobile: +91 98765 43210",
      "Landline: 011-2634 5678",
      "Toll Free: 1800 123 4567",
      "GSTIN: 09AABCU9603R1ZM",
      "CIN: U27100UP2011PTC045678",
      "PIN: 201309",
      "Priya Sharma — Managing Director",
      "https://www.linkedin.com/company/acme-steel",
    ].join("\n"),
  },
]

const HAY = PAGES.map((p) => p.text).join("\n")
const INDEX = buildPageIndex(PAGES)

describe("validateEmails", () => {
  it("keeps role mailboxes — they are the published B2B contact point", () => {
    const out = validateEmails(["info@acmesteel.in"], DOMAIN, HAY, INDEX)
    assert.equal(out.length, 1)
    assert.equal(out[0].role, true)
    assert.equal(out[0].on_domain, true)
  })

  it("ranks a named on-domain address above a role one", () => {
    const out = validateEmails(
      ["info@acmesteel.in", "priya.sharma@acmesteel.in"],
      DOMAIN,
      HAY,
      INDEX,
    )
    assert.equal(out[0].value, "priya.sharma@acmesteel.in")
  })

  it("drops an address that never appeared on the page (hallucination)", () => {
    const out = validateEmails(["ceo@acmesteel.in"], DOMAIN, HAY, INDEX)
    assert.equal(out.length, 0)
  })

  it("drops vendor and placeholder addresses", () => {
    const hay = `${HAY}\nnoreply@sentry.io\nyou@example.com`
    const out = validateEmails(["noreply@sentry.io", "you@example.com"], DOMAIN, hay, INDEX)
    assert.equal(out.length, 0)
  })

  it("records the page a value came from", () => {
    const out = validateEmails(["info@acmesteel.in"], DOMAIN, HAY, INDEX)
    assert.equal(out[0].page_url, "https://acmesteel.in/contact")
  })
})

describe("validatePhones", () => {
  it("normalizes an Indian mobile to E.164 and types it", () => {
    const out = validatePhones(["+91 98765 43210"], HAY, INDEX)
    assert.equal(out.length, 1)
    assert.equal(out[0].e164, "+919876543210")
    assert.equal(out[0].type, "mobile")
  })

  it("parses a landline with an STD code", () => {
    const out = validatePhones(["011-2634 5678"], HAY, INDEX)
    assert.equal(out.length, 1)
    assert.equal(out[0].type, "landline")
    assert.equal(out[0].e164, "+911126345678")
  })

  it("types 1800 numbers as toll-free", () => {
    const out = validatePhones(["1800 123 4567"], HAY, INDEX)
    assert.equal(out[0]?.type, "tollfree")
  })

  it("ranks mobile above landline above toll-free", () => {
    const out = validatePhones(["1800 123 4567", "011-2634 5678", "+91 98765 43210"], HAY, INDEX)
    assert.deepEqual(
      out.map((p) => p.type),
      ["mobile", "landline", "tollfree"],
    )
  })

  it("rejects a GSTIN digit run", () => {
    const out = validatePhones(["09AABCU9603R1ZM"], HAY, INDEX)
    assert.equal(out.length, 0)
  })

  it("rejects a PIN code", () => {
    const out = validatePhones(["201309"], HAY, INDEX)
    assert.equal(out.length, 0)
  })

  it("rejects repeated-digit junk", () => {
    const hay = `${HAY}\n9999999999`
    const out = validatePhones(["9999999999"], hay, INDEX)
    assert.equal(out.length, 0)
  })

  it("rejects a number that was never on the page", () => {
    const out = validatePhones(["+91 90000 00001"], HAY, INDEX)
    assert.equal(out.length, 0)
  })

  it("matches across different separator styles", () => {
    // Model returns it spaced differently than the page printed it.
    const out = validatePhones(["+919876543210"], HAY, INDEX)
    assert.equal(out.length, 1)
    assert.equal(out[0].e164, "+919876543210")
  })

  it("rejects a non-Indian number", () => {
    const hay = `${HAY}\n+1 415 555 0132`
    const out = validatePhones(["+1 415 555 0132"], hay, INDEX)
    assert.equal(out.length, 0)
  })
})

describe("validateSocialLinks", () => {
  it("keeps a company profile and drops a bare feed link", () => {
    const out = validateSocialLinks([
      "https://www.linkedin.com/company/acme-steel",
      "https://www.linkedin.com/feed",
      "https://malware.example.com/x",
    ])
    assert.deepEqual(out, ["https://linkedin.com/company/acme-steel"])
  })
})

describe("validateExtraction + pickPrimary", () => {
  it("end-to-end: grounds everything and picks a sensible primary", () => {
    const contacts = validateExtraction(
      {
        emails: ["info@acmesteel.in", "priya.sharma@acmesteel.in", "fake@acmesteel.in"],
        phones: ["+91 98765 43210", "09AABCU9603R1ZM", "011-2634 5678"],
        key_contacts: [
          { name: "Priya Sharma", title: "Managing Director" },
          { name: "Invented Person", title: "CTO" },
        ],
        social_links: ["https://www.linkedin.com/company/acme-steel"],
      },
      PAGES,
      DOMAIN,
    )

    assert.equal(contacts.emails.length, 2, "hallucinated email dropped")
    assert.equal(contacts.phones.length, 2, "GSTIN dropped")
    assert.equal(contacts.key_contacts.length, 1, "hallucinated person dropped")
    assert.equal(contacts.key_contacts[0].name, "Priya Sharma")
    assert.deepEqual(contacts.source_urls, ["https://acmesteel.in/contact"])

    const primary = pickPrimary(contacts)
    assert.equal(primary.email, "priya.sharma@acmesteel.in")
    assert.equal(primary.phone_e164, "+919876543210")
  })

  it("returns empty arrays rather than throwing on an empty extraction", () => {
    const contacts = validateExtraction(
      { emails: [], phones: [], key_contacts: [], social_links: [] },
      PAGES,
      DOMAIN,
    )
    assert.equal(contacts.emails.length, 0)
    assert.equal(contacts.phones.length, 0)
    const primary = pickPrimary(contacts)
    assert.equal(primary.email, null)
    assert.equal(primary.phone, null)
  })
})
