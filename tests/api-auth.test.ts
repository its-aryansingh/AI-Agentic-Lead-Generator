/**
 * api-auth bearer parsing — pure helpers, loaded directly under
 * `node --test --experimental-strip-types`. The async user-lookup
 * (which calls Supabase) lives in lib/api-auth.ts and is not exercised
 * here; integration is covered by tsc + production smoke tests.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import { parseBearerToken, looksLikeJwt } from "../lib/api-auth-core.ts"

test("parseBearerToken returns null on missing/empty input", () => {
  assert.equal(parseBearerToken(null), null)
  assert.equal(parseBearerToken(undefined), null)
  assert.equal(parseBearerToken(""), null)
  assert.equal(parseBearerToken("   "), null)
})

test("parseBearerToken returns null when scheme is missing", () => {
  assert.equal(parseBearerToken("abc.def.ghi"), null)
  assert.equal(parseBearerToken("Basic dXNlcjpwYXNz"), null)
  assert.equal(parseBearerToken("Token abc"), null)
})

test("parseBearerToken extracts the token and is case-insensitive on scheme", () => {
  assert.equal(parseBearerToken("Bearer abc.def.ghi"), "abc.def.ghi")
  assert.equal(parseBearerToken("bearer abc.def.ghi"), "abc.def.ghi")
  assert.equal(parseBearerToken("BEARER abc.def.ghi"), "abc.def.ghi")
})

test("parseBearerToken tolerates surrounding whitespace and extra spaces between scheme and token", () => {
  assert.equal(parseBearerToken("  Bearer abc.def.ghi  "), "abc.def.ghi")
  assert.equal(parseBearerToken("Bearer    abc.def.ghi"), "abc.def.ghi")
})

test("parseBearerToken rejects tokens with internal whitespace (token must be a single value)", () => {
  // After "Bearer ", a token with a space inside is almost certainly
  // a malformed concatenation, not a real JWT.
  assert.equal(parseBearerToken("Bearer abc def"), null)
})

test("parseBearerToken returns null when token is empty after the scheme", () => {
  assert.equal(parseBearerToken("Bearer "), null)
  assert.equal(parseBearerToken("Bearer    "), null)
})

test("looksLikeJwt accepts three base64url segments", () => {
  assert.equal(looksLikeJwt("abc.def.ghi"), true)
  assert.equal(
    looksLikeJwt("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature_value-_"),
    true,
  )
})

test("looksLikeJwt rejects malformed tokens", () => {
  assert.equal(looksLikeJwt(""), false)
  assert.equal(looksLikeJwt("abc"), false)
  assert.equal(looksLikeJwt("abc.def"), false)
  assert.equal(looksLikeJwt("abc.def.ghi.jkl"), false)
  assert.equal(looksLikeJwt("abc.def.ghi "), false)
  assert.equal(looksLikeJwt("abc def ghi"), false)
  // characters outside base64url alphabet
  assert.equal(looksLikeJwt("abc.def.gh!"), false)
})
