/**
 * Tests for universal search aggregator and snippet parsing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseProspectSnippet,
  generateMockCandidates,
  type RawSearchResult,
} from "@/lib/providers/search-aggregator";

test("parseProspectSnippet: parses standard '<Name> - <Title> at <Company> | LinkedIn'", () => {
  const input: RawSearchResult = {
    title: "Priya Sharma - Head of Marketing at Razorpay | LinkedIn",
    url: "https://www.linkedin.com/in/priya-sharma-123",
    description:
      "Experienced Head of Marketing driving growth and demand gen at Razorpay.",
    source: "brave",
  };

  const res = parseProspectSnippet(input);
  assert.ok(res);
  assert.equal(res.name, "Priya Sharma");
  assert.equal(res.title, "Head of Marketing");
  assert.equal(res.company, "Razorpay");
  assert.equal(res.source, "brave");
});

test("parseProspectSnippet: parses comma-separated '<Name> - <Title>, <Company>'", () => {
  const input: RawSearchResult = {
    title: "Rahul Mehta - VP of Sales, Freshworks",
    url: "https://www.linkedin.com/in/rahul-mehta-456",
    description: "VP of Sales leading B2B mid-market acquisition across APAC.",
    source: "serper",
  };

  const res = parseProspectSnippet(input);
  assert.ok(res);
  assert.equal(res.name, "Rahul Mehta");
  assert.equal(res.title, "VP of Sales");
  assert.equal(res.company, "Freshworks");
  assert.equal(res.source, "serper");
});

test("parseProspectSnippet: parses pipe-separated '<Name> | <Title> | <Company>'", () => {
  const input: RawSearchResult = {
    title: "Ananya Iyer | Director of Growth | CRED",
    url: "https://www.linkedin.com/in/ananya-iyer-789",
    description: "Leading performance marketing and product growth.",
    source: "tavily",
  };

  const res = parseProspectSnippet(input);
  assert.ok(res);
  assert.equal(res.name, "Ananya Iyer");
  assert.equal(res.title, "Director of Growth");
  assert.equal(res.company, "CRED");
  assert.equal(res.source, "tavily");
});

test("parseProspectSnippet: handles simple '<Name> - <Company>'", () => {
  const input: RawSearchResult = {
    title: "Vikram Singh - Zerodha",
    url: "https://www.linkedin.com/in/vikram-singh-001",
    description: "Chief Marketing Officer at Zerodha.",
    source: "duckduckgo",
  };

  const res = parseProspectSnippet(input);
  assert.ok(res);
  assert.equal(res.name, "Vikram Singh");
  assert.equal(res.company, "Zerodha");
});

test("generateMockCandidates produces deterministic prospects seeded by query", () => {
  const res1 = generateMockCandidates({ query: "fintech marketing India" }, 3);
  const res2 = generateMockCandidates({ query: "fintech marketing India" }, 3);

  assert.equal(res1.length, 3);
  assert.equal(res2.length, 3);
  assert.deepEqual(res1, res2);
  assert.equal(res1[0].source, "mock");
});
