/**
 * hubspot-core — pure helpers loaded directly under
 * `node --test --experimental-strip-types`. The async HTTP layer
 * (lib/providers/hubspot.ts) is not exercised here; verification of
 * that path happens via the build + manual smoke tests once a
 * HUBSPOT_API_KEY is set.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  isValidEmail,
  contactToHubSpotProperties,
  clampNoteBody,
  hubspotConfigured,
  mockContactId,
  mockNoteId,
} from "../lib/providers/hubspot-core.ts"

test("isValidEmail accepts well-formed addresses", () => {
  assert.equal(isValidEmail("priya@razorpay.com"), true)
  assert.equal(isValidEmail("john.doe+leadgen@acme.co.in"), true)
})

test("isValidEmail rejects empty/malformed input", () => {
  assert.equal(isValidEmail(""), false)
  assert.equal(isValidEmail("   "), false)
  assert.equal(isValidEmail("not-an-email"), false)
  assert.equal(isValidEmail("missing@dot"), false)
  assert.equal(isValidEmail("@no-local.com"), false)
  assert.equal(isValidEmail("space in@addr.com"), false)
  assert.equal(isValidEmail("a".repeat(255) + "@b.co"), false)
})

test("contactToHubSpotProperties always includes a lowercased email", () => {
  const props = contactToHubSpotProperties({ email: " PRIYA@razorpay.com " })
  assert.equal(props.email, "priya@razorpay.com")
})

test("contactToHubSpotProperties maps optional fields to HubSpot's internal names", () => {
  const props = contactToHubSpotProperties({
    email: "p@x.com",
    first_name: "Priya",
    last_name: "Kumar",
    company: "Razorpay",
    job_title: "VP Marketing",
    linkedin_url: "https://linkedin.com/in/priyak",
    source_url: "razorpay.com",
  })
  assert.equal(props.firstname, "Priya")
  assert.equal(props.lastname, "Kumar")
  assert.equal(props.company, "Razorpay")
  assert.equal(props.jobtitle, "VP Marketing")
  assert.equal(props.linkedin_url, "https://linkedin.com/in/priyak")
  assert.equal(props.website, "razorpay.com")
})

test("contactToHubSpotProperties omits unset optional fields", () => {
  const props = contactToHubSpotProperties({ email: "p@x.com" })
  assert.deepEqual(Object.keys(props).sort(), ["email"])
})

test("clampNoteBody truncates and adds an ellipsis past the limit", () => {
  const body = "a".repeat(70_000)
  const clamped = clampNoteBody(body)
  assert.equal(clamped.length, 65000)
  assert.equal(clamped.endsWith("…"), true)
})

test("clampNoteBody is a no-op below the limit", () => {
  const body = "Short note about the prospect."
  assert.equal(clampNoteBody(body), body)
})

test("hubspotConfigured is false for unset/empty/whitespace tokens", () => {
  assert.equal(hubspotConfigured(undefined), false)
  assert.equal(hubspotConfigured(""), false)
  assert.equal(hubspotConfigured("   "), false)
  assert.equal(hubspotConfigured("hubspot-pat-XXXXX"), true)
})

test("mockContactId is deterministic for the same seed", () => {
  assert.equal(mockContactId("priya@razorpay.com"), mockContactId("priya@razorpay.com"))
  assert.notEqual(mockContactId("priya@razorpay.com"), mockContactId("rahul@freshworks.com"))
})

test("mockNoteId is deterministic for the same seed", () => {
  assert.equal(mockNoteId("c1:body"), mockNoteId("c1:body"))
  assert.notEqual(mockNoteId("c1:body"), mockNoteId("c2:body"))
})
