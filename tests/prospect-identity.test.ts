import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildProspectIdentity,
  hashCanonicalIdentity,
  normalizeE164,
  normalizeEmail,
} from "@/lib/prospect-identity"

test("email normalization is deterministic and conservative", () => {
  assert.equal(normalizeEmail("  Alice+Sales@Example.COM "), "alice+sales@example.com")
  assert.equal(normalizeEmail("not an email"), null)
})

test("E.164 normalization accepts explicit international numbers only", () => {
  assert.equal(normalizeE164(" +1 (415) 555-2671 "), "+14155552671")
  assert.equal(normalizeE164("0044 20 7946 0018"), "+442079460018")
  assert.equal(normalizeE164("9876543210"), null)
})

test("identity hashing is deterministic and raw hashes remain server-only", () => {
  assert.equal(hashCanonicalIdentity("alice@example.com"), hashCanonicalIdentity("alice@example.com"))
  assert.notEqual(hashCanonicalIdentity("alice@example.com"), hashCanonicalIdentity("bob@example.com"))
  const identity = buildProspectIdentity({ email: "ALICE@example.com", phone: "+1 415 555 2671" })
  assert.equal(identity.normalized_email, "alice@example.com")
  assert.equal(identity.normalized_phone_e164, "+14155552671")
  assert.match(identity.email_hash ?? "", /^[a-f0-9]{64}$/)
})
