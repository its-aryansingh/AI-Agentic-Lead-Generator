import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildIntakeProspect, parseLeadCsv, prepareConfirmedDuplicateProspect } from '@/lib/lead-intake'

test('manual lead receives valid workflow defaults', () => {
  const row = buildIntakeProspect({ name: '  Asha  ', company: 'Acme', email: 'asha@example.com' }, 'manual')
  assert.equal(row.input_name, 'Asha')
  assert.equal(row.lead_status, 'new')
  assert.equal(row.next_action, 'review')
  assert.equal(row.email_source, 'extracted')
  assert.equal(row.normalized_email, 'asha@example.com')
  assert.ok(row.email_hash)
})

test('CSV rows use the same safe workflow shape', () => {
  const { rows } = parseLeadCsv('Name,Company,Email\nAsha,Acme,asha@example.com')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].input_source, 'csv')
  assert.equal(rows[0].status, 'pending')
  assert.equal(rows[0].identity_normalization_version, 1)
})

test('invalid email is not persisted as extracted', () => {
  const row = buildIntakeProspect({ name: 'Asha', email: 'not-email' }, 'manual')
  assert.equal(row.email, null)
  assert.equal(row.email_source, 'none')
})

test('blank manual name is rejected', () => {
  assert.throws(() => buildIntakeProspect({ name: ' ' }, 'manual'), /required/)
})

test('confirmed duplicate keeps normalized identity while yielding unique hashes', () => {
  const row = buildIntakeProspect({
    name: 'Second Asha',
    email: 'asha@example.com',
    phone: '+919876543210',
  }, 'manual')
  const duplicate = prepareConfirmedDuplicateProspect(row, { phone: true, email: true })
  assert.equal(duplicate.normalized_email, 'asha@example.com')
  assert.equal(duplicate.normalized_phone_e164, '+919876543210')
  assert.equal(duplicate.email_hash, null)
  assert.equal(duplicate.phone_hash, null)
})

test('manual duplicate lookup is tenant scoped and requires identity-bound confirmation', () => {
  const source = readFileSync('app/app/leads/actions.ts', 'utf8')
  assert.match(source, /\.eq\("user_id", user\.id\)[\s\S]*?\.eq\("normalized_phone_e164", row\.normalized_phone_e164\)/)
  assert.match(source, /confirmedPhoneValue === row\.normalized_phone_e164/)
  assert.match(source, /prepareConfirmedDuplicateProspect/)
})

test('manual duplicate warning is an accessible explicit confirmation dialog', () => {
  const source = readFileSync('app/app/leads/manual-lead-form.tsx', 'utf8')
  assert.match(source, /role="dialog"/)
  assert.match(source, /aria-modal="true"/)
  assert.match(source, /Yes, add anyway/)
  assert.match(source, /person-level call[\s\S]*limits/)
})
