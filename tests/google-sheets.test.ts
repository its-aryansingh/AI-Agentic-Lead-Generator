/**
 * Unit tests for lib/csv — the pure CSV serializer extracted from
 * lib/providers/google-sheets so it has no runtime deps on googleapis.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import { rowsToCsv, type ProspectRow } from "../lib/csv.ts"

const baseRow: ProspectRow = {
  name: "Priya Sharma",
  title: "Head of Marketing",
  company: "Razorpay",
  email: "priya.sharma@razorpay.com",
  email_confidence: "risky",
  research_summary: "Recent move into mid-market segment.",
  email_subject: "quick question about Razorpay's mid-market push",
  email_body: "Saw the Capital launch. How are you approaching outbound to founders 50-200?",
  talking_points: ["Capital launch", "Inbound vs outbound split", "Anonymized data point"],
  source_url: "https://www.linkedin.com/in/priya-sharma",
}

test("rowsToCsv: emits a header row + one data row", () => {
  const csv = rowsToCsv([baseRow])
  const lines = csv.split("\n")
  assert.equal(lines.length, 2)
  assert.ok(lines[0].startsWith("Name,Title,Company,"))
})

test("rowsToCsv: quotes fields containing commas", () => {
  const csv = rowsToCsv([{ ...baseRow, email_body: "hello, world, foo" }])
  assert.ok(csv.includes('"hello, world, foo"'))
})

test("rowsToCsv: escapes embedded double quotes by doubling them", () => {
  const csv = rowsToCsv([{ ...baseRow, email_body: 'she said "hi"' }])
  assert.ok(csv.includes('"she said ""hi"""'))
})

test("rowsToCsv: quotes fields containing newlines", () => {
  const csv = rowsToCsv([{ ...baseRow, email_body: "line1\nline2" }])
  assert.ok(csv.includes('"line1\nline2"'))
})

test("rowsToCsv: null/undefined fields become empty strings, not 'null'", () => {
  const csv = rowsToCsv([
    {
      ...baseRow,
      email: null,
      research_summary: null,
      talking_points: null,
    },
  ])
  // No literal "null" anywhere in the data row.
  const dataRow = csv.split("\n")[1]
  assert.ok(!dataRow.includes("null"))
})

test("rowsToCsv: empty talking-points pad to 3 empty cells", () => {
  const csv = rowsToCsv([{ ...baseRow, talking_points: [] }])
  const cols = csv.split("\n")[1].split(",")
  // Talking point columns are #9, #10, #11 (0-indexed 8, 9, 10).
  assert.equal(cols[8], "")
  assert.equal(cols[9], "")
  assert.equal(cols[10], "")
})

test("rowsToCsv: handles zero rows", () => {
  const csv = rowsToCsv([])
  assert.equal(csv.split("\n").length, 1) // header only
})
