/**
 * Adversarial extraction test.
 *
 * `strict: true` guarantees the shape of the model's JSON, never its
 * truth. This fixes the behaviour that actually protects the database:
 * a plausible-but-fabricated contact, and every Indian business document
 * that looks like a phone number, must be rejected.
 *
 * The page text below is REAL output from the Playwright crawler running
 * against a fixture site, not a hand-written string.
 *
 * Run: node --test --experimental-strip-types tests/enrichment-adversarial.test.ts
 */

import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import { validateExtraction, pickPrimary } from "../lib/enrichment/validator.ts"
import type { CrawledPage } from "../lib/enrichment/types.ts"

const DOMAIN = "bharatprecision.in"

const PAGES: CrawledPage[] = [
  {
    url: "https://bharatprecision.in/contact",
    title: "Contact Us — Bharat Precision Components Pvt Ltd",
    status: 200,
    text: [
      "Home About Team",
      "Contact Us",
      "Registered Office",
      "Plot 42, Sector 63, Noida, Uttar Pradesh 201309, India",
      "GSTIN: 09AABCU9603R1ZM",
      "CIN: U27100UP2011PTC045678",
      "PAN: AABCU9603R",
      "General enquiries: info@bharatprecision.in",
      "Sales: sales@bharatprecision.in",
      "Careers: hr@bharatprecision.in",
      "Export desk: Priya.Sharma@bharatprecision.in",
      "Call us:",
      "Landline: 0120-4567890",
      "Mumbai branch: (022) 6789 0123",
      "Toll Free: 1800 123 4567",
      "Support line: 1860 500 1111",
      "Established 2011 · Pincode 201309 · Invoice ref 4567890123",
      "Site by webmaster@wixpress.com",
      "Errors to noreply@sentry.io",
      "LinkedIn Twitter Feed",
      // tel:/mailto: hrefs promoted into the text by the crawler
      "info@bharatprecision.in",
      "Priya.Sharma@bharatprecision.in",
      "+919876543210",
    ].join("\n"),
  },
  {
    url: "https://bharatprecision.in/team",
    title: "Leadership — Bharat Precision",
    status: 200,
    text: [
      "Our Leadership",
      "Priya Sharma — Managing Director",
      "Rahul Verma — Head of Sales & Exports",
      "Anita Desai — Chief Financial Officer",
      "Reach the leadership team at leadership@bharatprecision.in",
    ].join("\n"),
  },
]

/** A hostile but entirely plausible model response. */
const HOSTILE = {
  emails: [
    "Priya.Sharma@bharatprecision.in",
    "info@bharatprecision.in",
    "sales@bharatprecision.in",
    "ceo@bharatprecision.in",
    "rahul.verma@bharatprecision.in",
    "webmaster@wixpress.com",
    "noreply@sentry.io",
    "info@bharatprecision.in",
    "logo@2x.png",
  ],
  phones: [
    "+91 98765 43210",
    "0120-4567890",
    "1800 123 4567",
    "09AABCU9603R1ZM",
    "U27100UP2011PTC045678",
    "201309",
    "2011",
    "4567890123",
    "+1 415 555 0132",
    "9999999999",
  ],
  key_contacts: [
    { name: "Priya Sharma", title: "Managing Director" },
    { name: "Rahul Verma", title: "Head of Sales & Exports" },
    { name: "Vikram Mehta", title: "Chief Technology Officer" },
  ],
  social_links: [
    "https://www.linkedin.com/company/bharat-precision",
    "https://www.linkedin.com/feed",
    "https://evil.example.com/phish",
  ],
}

const RESULT = validateExtraction(HOSTILE, PAGES, DOMAIN)
const emails = RESULT.emails.map((e) => e.value)
const phones = RESULT.phones.map((p) => p.e164)
const people = RESULT.key_contacts.map((k) => k.name)

describe("hallucinated values", () => {
  it("drops an email that never appeared on any page", () => {
    assert.equal(emails.includes("ceo@bharatprecision.in"), false)
  })

  it("drops a plausible address synthesised from a real name on the team page", () => {
    // The model saw "Rahul Verma" and invented rahul.verma@. This is the
    // most dangerous failure mode: it looks correct and would bounce.
    assert.equal(emails.includes("rahul.verma@bharatprecision.in"), false)
  })

  it("keeps the person even when it drops the invented address for them", () => {
    assert.equal(people.includes("Rahul Verma"), true)
  })

  it("drops an invented person", () => {
    assert.equal(people.includes("Vikram Mehta"), false)
  })
})

describe("Indian business documents are not phone numbers", () => {
  for (const [label, raw] of [
    ["GSTIN", "09AABCU9603R1ZM"],
    ["CIN", "U27100UP2011PTC045678"],
    ["PIN code", "201309"],
    ["year founded", "2011"],
    ["invoice ref that looks like a 10-digit mobile", "4567890123"],
    ["repeated-digit junk", "9999999999"],
  ] as const) {
    it(`rejects ${label}`, () => {
      const digits = raw.replace(/\D/g, "")
      assert.equal(
        phones.some((p) => p?.includes(digits)),
        false,
        `${raw} leaked into phones`,
      )
    })
  }

  it("rejects a valid but non-Indian number", () => {
    assert.equal(phones.includes("+14155550132"), false)
  })
})

describe("what survives", () => {
  it("keeps exactly the three real numbers, correctly typed and ordered", () => {
    assert.deepEqual(phones, ["+919876543210", "+911204567890", "+9118001234567"])
    assert.deepEqual(
      RESULT.phones.map((p) => p.type),
      ["mobile", "landline", "tollfree"],
    )
  })

  it("grounds case-insensitively — a capitalised mailto still counts", () => {
    // Regression: lower-casing the candidate but not the haystack silently
    // dropped every named address a site chose to capitalise.
    assert.equal(emails.includes("priya.sharma@bharatprecision.in"), true)
  })

  it("ranks the named address above role mailboxes", () => {
    assert.equal(emails[0], "priya.sharma@bharatprecision.in")
  })

  it("keeps role mailboxes rather than discarding them", () => {
    assert.equal(emails.includes("info@bharatprecision.in"), true)
    assert.equal(emails.includes("sales@bharatprecision.in"), true)
  })

  it("drops vendor, junk and asset-shaped addresses", () => {
    for (const bad of ["webmaster@wixpress.com", "noreply@sentry.io", "logo@2x.png"]) {
      assert.equal(emails.includes(bad), false, `${bad} leaked`)
    }
  })

  it("deduplicates", () => {
    assert.equal(new Set(emails).size, emails.length)
  })

  it("keeps only the real social profile", () => {
    assert.deepEqual(RESULT.social_links, ["https://linkedin.com/company/bharat-precision"])
  })

  it("records provenance for every kept value", () => {
    for (const e of RESULT.emails) assert.ok(e.page_url, `${e.value} has no page_url`)
    assert.deepEqual(RESULT.source_urls, PAGES.map((p) => p.url))
  })

  it("projects a sane primary onto prospects", () => {
    assert.deepEqual(pickPrimary(RESULT), {
      email: "priya.sharma@bharatprecision.in",
      phone: "+919876543210",
      phone_e164: "+919876543210",
    })
  })
})
