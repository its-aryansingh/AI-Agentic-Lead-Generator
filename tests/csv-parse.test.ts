/**
 * Unit tests for lib/csv-parse — the zero-dep CSV reader used by the
 * chat composer's drop-paste flow.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import { csvToProspects, parseCsv } from "../lib/csv-parse.ts"

test("parseCsv: simple rows + header", () => {
  const rows = parseCsv("a,b,c\n1,2,3\n4,5,6")
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["1", "2", "3"],
    ["4", "5", "6"],
  ])
})

test("parseCsv: quoted field with embedded comma", () => {
  const rows = parseCsv('name,bio\n"Smith, John","CEO, Acme"')
  assert.deepEqual(rows[1], ["Smith, John", "CEO, Acme"])
})

test("parseCsv: doubled-quote escapes inside quoted field", () => {
  const rows = parseCsv('text\n"she said ""hi"""')
  assert.equal(rows[1][0], 'she said "hi"')
})

test("parseCsv: handles CRLF and LF line endings", () => {
  const rows = parseCsv("a,b\r\n1,2\r\n3,4")
  assert.deepEqual(rows, [
    ["a", "b"],
    ["1", "2"],
    ["3", "4"],
  ])
})

test("parseCsv: tolerates missing trailing newline", () => {
  const rows = parseCsv("a,b\n1,2")
  assert.equal(rows.length, 2)
})

test("parseCsv: drops fully-empty trailing rows", () => {
  const rows = parseCsv("a,b\n1,2\n\n\n")
  assert.equal(rows.length, 2)
})

test("csvToProspects: detects standard headers", () => {
  const csv = "Name,Company,Title,LinkedIn\nPriya Sharma,Razorpay,Head of Marketing,https://linkedin.com/in/priya\nRahul Mehta,Freshworks,VP Sales,https://linkedin.com/in/rahul"
  const { prospects, warnings } = csvToProspects(csv)
  assert.equal(prospects.length, 2)
  assert.equal(prospects[0].name, "Priya Sharma")
  assert.equal(prospects[0].company, "Razorpay")
  assert.equal(prospects[0].title, "Head of Marketing")
  assert.equal(prospects[0].linkedin_url, "https://linkedin.com/in/priya")
  assert.equal(warnings.length, 0)
})

test("csvToProspects: handles header aliases (Full Name, Organization)", () => {
  const csv = "Full Name,Organization,Job Title\nPriya Sharma,Razorpay,Head of Marketing"
  const { prospects } = csvToProspects(csv)
  assert.equal(prospects[0].name, "Priya Sharma")
  assert.equal(prospects[0].company, "Razorpay")
  assert.equal(prospects[0].title, "Head of Marketing")
})

test("csvToProspects: falls back to positional layout when no header", () => {
  const csv = "Priya Sharma,Razorpay,Head of Marketing\nRahul Mehta,Freshworks,VP Sales"
  const { prospects, warnings } = csvToProspects(csv)
  assert.equal(prospects.length, 2)
  assert.equal(prospects[0].name, "Priya Sharma")
  assert.equal(prospects[0].company, "Razorpay")
  assert.ok(warnings.some((w) => w.includes("positional layout")))
})

test("csvToProspects: skips rows without a name", () => {
  const csv = "Name,Company\nPriya,Razorpay\n,OrphanCo\nRahul,Freshworks"
  const { prospects } = csvToProspects(csv)
  assert.equal(prospects.length, 2)
})

test("csvToProspects: empty input warns and returns no prospects", () => {
  const { prospects, warnings } = csvToProspects("")
  assert.equal(prospects.length, 0)
  assert.ok(warnings.length > 0)
})
