/**
 * WhatsApp provider — pure helpers. whatsapp.ts has no "@/" imports, so it
 * loads directly under `node --test --experimental-strip-types`.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import { normalizeWhatsAppNumber, whatsappConfigured } from "../lib/providers/whatsapp.ts"

test("normalizeWhatsAppNumber strips formatting down to digits", () => {
  assert.equal(normalizeWhatsAppNumber("+91 98765-43210"), "919876543210")
  assert.equal(normalizeWhatsAppNumber("(080) 1234 5678"), "08012345678")
  assert.equal(normalizeWhatsAppNumber("919876543210"), "919876543210")
  assert.equal(normalizeWhatsAppNumber("+1 (415) 555-0100"), "14155550100")
})

test("whatsappConfigured is false without BSP env (mock mode)", () => {
  assert.equal(whatsappConfigured(), false)
})
