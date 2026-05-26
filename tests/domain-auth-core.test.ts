/**
 * domain-auth-core — pure parser tests. The async DNS layer
 * (lib/domain-auth.ts) is not exercised here; that's verified by the
 * build + manual smoke against a known-good domain.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  isValidDomain,
  parseSpfRecord,
  parseDmarcRecord,
  summarizeDkim,
  summarizeOverall,
  COMMON_DKIM_SELECTORS,
} from "../lib/domain-auth-core.ts"

// ---------- isValidDomain ----------

test("isValidDomain accepts normal hostnames", () => {
  assert.equal(isValidDomain("razorpay.com"), true)
  assert.equal(isValidDomain("mail.acme.co.in"), true)
  assert.equal(isValidDomain("xn--p1ai.example.com"), true) // punycode
})

test("isValidDomain rejects garbage", () => {
  assert.equal(isValidDomain(""), false)
  assert.equal(isValidDomain("   "), false)
  assert.equal(isValidDomain("not a domain"), false)
  assert.equal(isValidDomain("example"), false) // no TLD
  assert.equal(isValidDomain("-bad.com"), false) // leading hyphen
  assert.equal(isValidDomain(".example.com"), false) // leading dot
  assert.equal(isValidDomain("a".repeat(254) + ".com"), false) // too long
})

// ---------- SPF ----------

test("parseSpfRecord returns null for non-SPF strings", () => {
  assert.equal(parseSpfRecord("v=DMARC1; p=none"), null)
  assert.equal(parseSpfRecord("hello world"), null)
  assert.equal(parseSpfRecord(""), null)
})

test("parseSpfRecord extracts hard-fail policy", () => {
  const r = parseSpfRecord("v=spf1 include:_spf.google.com -all")
  assert.notEqual(r, null)
  assert.equal(r!.found, true)
  assert.equal(r!.policy, "hard_fail")
  assert.equal(r!.lookup_count_estimate, 1)
  assert.equal(r!.issues.length, 0)
})

test("parseSpfRecord flags +all as insecure", () => {
  const r = parseSpfRecord("v=spf1 +all")
  assert.equal(r!.policy, "pass")
  assert.equal(r!.issues.length > 0, true)
  assert.match(r!.issues[0], /\+all/)
})

test("parseSpfRecord flags soft fail ~all", () => {
  const r = parseSpfRecord("v=spf1 include:spf.protection.outlook.com ~all")
  assert.equal(r!.policy, "soft_fail")
  assert.equal(r!.lookup_count_estimate, 1)
})

test("parseSpfRecord warns when no all-mechanism present", () => {
  const r = parseSpfRecord("v=spf1 include:_spf.example.com")
  assert.equal(r!.policy, "none")
  assert.match(r!.issues[0], /no `all` mechanism/)
})

test("parseSpfRecord counts lookups and warns past 10", () => {
  const includes = Array(11).fill("include:x.example.com").join(" ")
  const r = parseSpfRecord(`v=spf1 ${includes} -all`)
  assert.equal(r!.lookup_count_estimate, 11)
  assert.equal(r!.issues.some((i) => i.includes("RFC 7208")), true)
})

// ---------- DMARC ----------

test("parseDmarcRecord returns null for non-DMARC strings", () => {
  assert.equal(parseDmarcRecord("v=spf1 -all"), null)
  assert.equal(parseDmarcRecord(""), null)
})

test("parseDmarcRecord extracts policy + rua + pct", () => {
  const r = parseDmarcRecord("v=DMARC1; p=reject; pct=100; rua=mailto:dmarc@x.com")
  assert.equal(r!.policy, "reject")
  assert.equal(r!.pct, 100)
  assert.equal(r!.has_rua, true)
  assert.equal(r!.issues.length, 0)
})

test("parseDmarcRecord flags p=none as monitoring-only", () => {
  const r = parseDmarcRecord("v=DMARC1; p=none; rua=mailto:x@y.com")
  assert.equal(r!.policy, "none")
  assert.match(r!.issues[0], /monitoring|reported but not blocked/)
})

test("parseDmarcRecord warns when rua missing", () => {
  const r = parseDmarcRecord("v=DMARC1; p=quarantine")
  assert.equal(r!.has_rua, false)
  assert.equal(r!.issues.some((i) => i.includes("rua=")), true)
})

test("parseDmarcRecord rejects invalid pct", () => {
  const r = parseDmarcRecord("v=DMARC1; p=reject; pct=999")
  assert.equal(r!.pct, null)
})

test("parseDmarcRecord uses sp when present, falls back to p", () => {
  const a = parseDmarcRecord("v=DMARC1; p=quarantine; sp=reject")
  assert.equal(a!.subdomain_policy, "reject")
  const b = parseDmarcRecord("v=DMARC1; p=quarantine")
  assert.equal(b!.subdomain_policy, "quarantine")
})

test("parseDmarcRecord warns on pct<100", () => {
  const r = parseDmarcRecord("v=DMARC1; p=reject; pct=50; rua=mailto:x@y.com")
  assert.equal(r!.pct, 50)
  assert.equal(r!.issues.some((i) => i.includes("pct=50")), true)
})

// ---------- DKIM summary ----------

test("summarizeDkim flags no-hit case", () => {
  const a = summarizeDkim(["google", "default"], [])
  assert.equal(a.found, false)
  assert.equal(a.issues.length > 0, true)
  assert.match(a.issues[0], /No DKIM record/)
})

test("summarizeDkim accepts a good hit", () => {
  const a = summarizeDkim(["google"], [{ selector: "google", record: "v=DKIM1; k=rsa; p=ABC" }])
  assert.equal(a.found, true)
  assert.equal(a.issues.length, 0)
})

test("summarizeDkim flags empty public key (revoked)", () => {
  const a = summarizeDkim(["google"], [{ selector: "google", record: "v=DKIM1; k=rsa; p=" }])
  assert.equal(a.found, true)
  assert.equal(a.issues.some((i) => i.includes("revoked")), true)
})

test("COMMON_DKIM_SELECTORS includes the major providers", () => {
  assert.equal(COMMON_DKIM_SELECTORS.includes("google"), true)
  assert.equal(COMMON_DKIM_SELECTORS.includes("selector1"), true) // M365
  assert.equal(COMMON_DKIM_SELECTORS.includes("amazonses"), true)
  assert.equal(COMMON_DKIM_SELECTORS.includes("zoho"), true)
})

// ---------- overall summary ----------

test("summarizeOverall returns 'good' when all three pass strongly", () => {
  const checks = {
    spf: { found: true, record: null, policy: "hard_fail" as const, lookup_count_estimate: 1, issues: [] },
    dkim: { found: true, selectors_checked: ["google"], hits: [{ selector: "google", record: "v=DKIM1; p=AB" }], issues: [] },
    dmarc: { found: true, record: null, policy: "reject" as const, subdomain_policy: "reject" as const, pct: 100, has_rua: true, has_ruf: false, issues: [] },
  }
  const o = summarizeOverall(checks)
  assert.equal(o.grade, "good")
  assert.equal(o.recommendations.length, 0)
})

test("summarizeOverall returns 'poor' when nothing is configured", () => {
  const checks = {
    spf: { found: false, record: null, policy: "none" as const, lookup_count_estimate: 0, issues: [] },
    dkim: { found: false, selectors_checked: [], hits: [], issues: [] },
    dmarc: { found: false, record: null, policy: null, subdomain_policy: null, pct: null, has_rua: false, has_ruf: false, issues: [] },
  }
  const o = summarizeOverall(checks)
  assert.equal(o.grade, "poor")
  assert.equal(o.recommendations.length >= 3, true)
})

test("summarizeOverall returns 'fair' when something's halfway", () => {
  const checks = {
    spf: { found: true, record: null, policy: "soft_fail" as const, lookup_count_estimate: 1, issues: [] },
    dkim: { found: true, selectors_checked: ["google"], hits: [{ selector: "google", record: "v=DKIM1; p=AB" }], issues: [] },
    dmarc: { found: true, record: null, policy: "none" as const, subdomain_policy: "none" as const, pct: 100, has_rua: true, has_ruf: false, issues: [] },
  }
  const o = summarizeOverall(checks)
  assert.equal(o.grade, "fair")
  assert.equal(o.recommendations.some((r) => r.includes("p=quarantine")), true)
})
