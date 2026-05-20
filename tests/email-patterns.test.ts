/**
 * Unit tests for lib/email-patterns.
 *
 * Run with:  npm run test
 *           (which proxies to: node --test --experimental-strip-types tests/**\/*.test.ts)
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  bestGuessEmail,
  generateEmailGuesses,
  guessDomainFromCompany,
} from "../lib/email-patterns.ts"

test("generateEmailGuesses: standard two-part name", () => {
  const out = generateEmailGuesses("Priya Sharma", "razorpay.com")
  const emails = out.map((g) => g.email)
  assert.ok(emails.includes("priya.sharma@razorpay.com"))
  assert.ok(emails.includes("priyasharma@razorpay.com"))
  assert.ok(emails.includes("psharma@razorpay.com"))
  assert.ok(emails.includes("priya_sharma@razorpay.com"))
  assert.ok(emails.includes("priya@razorpay.com"))
})

test("generateEmailGuesses: mononym yields a first-only address", () => {
  const out = generateEmailGuesses("Mira", "khatabook.com")
  assert.ok(out.length >= 1)
  assert.equal(out[0].email, "mira@khatabook.com")
})

test("generateEmailGuesses: empty input returns empty array", () => {
  assert.deepEqual(generateEmailGuesses("", "razorpay.com"), [])
  assert.deepEqual(generateEmailGuesses("Priya", ""), [])
})

test("generateEmailGuesses: dedupes patterns that collapse to the same address", () => {
  // For "Mira" all multi-part patterns collapse to "mira", "m" or empty.
  const out = generateEmailGuesses("Mira", "khatabook.com")
  const emails = out.map((g) => g.email)
  assert.equal(new Set(emails).size, emails.length, "no duplicate emails")
})

test("generateEmailGuesses: strips uppercase and trims", () => {
  const out = generateEmailGuesses("  Karthik   Subramanian  ", "ZOHO.COM")
  const emails = out.map((g) => g.email)
  assert.ok(emails.includes("karthik.subramanian@zoho.com"))
})

test("bestGuessEmail: prefers first.last pattern", () => {
  const guess = bestGuessEmail("Priya Sharma", "razorpay.com")
  assert.ok(guess)
  assert.equal(guess.pattern, "first.last")
  assert.equal(guess.email, "priya.sharma@razorpay.com")
})

test("bestGuessEmail: falls back to first pattern available for mononyms", () => {
  const guess = bestGuessEmail("Mira", "khatabook.com")
  assert.ok(guess)
  assert.equal(guess.email, "mira@khatabook.com")
})

test("bestGuessEmail: returns null when nothing can be derived", () => {
  assert.equal(bestGuessEmail("", "razorpay.com"), null)
  assert.equal(bestGuessEmail("Priya", ""), null)
})

test("guessDomainFromCompany: strips legal-suffix noise", () => {
  assert.equal(guessDomainFromCompany("Razorpay"), "razorpay.com")
  assert.equal(guessDomainFromCompany("Freshworks Inc."), "freshworks.com")
  assert.equal(guessDomainFromCompany("Acme Pvt Ltd"), "acme.com")
  assert.equal(guessDomainFromCompany("Foo Bar SaaS"), "foobarsaas.com")
})

test("guessDomainFromCompany: handles empty / nonsense input", () => {
  assert.equal(guessDomainFromCompany(""), null)
  assert.equal(guessDomainFromCompany("Inc Ltd Pvt"), null)
})

test("guessDomainFromCompany: drops punctuation", () => {
  assert.equal(guessDomainFromCompany("Stripe, Inc."), "stripe.com")
  assert.equal(guessDomainFromCompany("Razorpay (India)"), "razorpayindia.com")
})
