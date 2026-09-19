/**
 * Tests for the Signal-Based Convertible Lead Discovery Engine.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractSearchFilters,
  scoreProspectCandidate,
  type ApolloPersonCandidate,
  type BuyingSignals,
  type SellerContext,
} from "@/lib/discovery/discovery-core";

test("extractSearchFilters: parses role, location, employee count, and industry keywords", () => {
  const query =
    "Find 20 B2B SaaS founders in Bangalore for an early stage startup";
  const filters = extractSearchFilters(query);

  assert.ok(filters.personTitles?.includes("Founder"));
  assert.ok(filters.personSeniorities?.includes("founder"));
  assert.ok(filters.personLocations?.includes("Bengaluru, Karnataka, India"));
  assert.deepEqual(filters.organizationNumEmployeesRanges, ["1,10", "11,50"]);
  assert.ok(filters.qKeywords?.includes("B2B"));
  assert.ok(filters.qKeywords?.includes("SaaS"));
  assert.equal(filters.perPage, 20);
});

test("extractSearchFilters: extracts sales & marketing leadership titles across US/UK", () => {
  const query = "Head of sales and VP marketing in the US and UK";
  const filters = extractSearchFilters(query);

  assert.ok(filters.personTitles?.some((t) => t.includes("Sales")));
  assert.ok(filters.personTitles?.some((t) => t.includes("Marketing")));
  assert.ok(filters.personLocations?.includes("United States"));
  assert.ok(filters.personLocations?.includes("United Kingdom"));
});

test("scoreProspectCandidate: scores high-intent prospect with funding, hiring, and new-in-role signals", () => {
  const candidate: ApolloPersonCandidate = {
    id: "cand_1",
    firstName: "Priya",
    lastName: "Sharma",
    name: "Priya Sharma",
    title: "Chief Revenue Officer",
    companyName: "HyperScale AI",
    companyDomain: "hyperscale.ai",
    linkedinUrl: "https://linkedin.com/in/priyasharma",
    organization: {
      estimatedNumEmployees: 85,
      industry: "Information Technology",
    },
  };

  const signals: BuyingSignals = {
    hasActiveHiring: true,
    hiringRoles: ["Account Executive", "SDR"],
    recentFunding: {
      amount: "$12M",
      round: "Series A",
      date: "2026-07-15",
    },
    isNewInRole: true,
    monthsInRole: 2,
    techStackMatches: ["HubSpot", "Salesforce"],
    signalSummary: "Recent $12M Series A + active sales team hiring surge",
  };

  const sellerContext: SellerContext = {
    ideal_customer_profile: "B2B SaaS companies with 20-200 employees",
    value_proposition: "AI sales engine that books qualified pipeline",
    disqualification_criteria: "B2C, consumer retail, freelance",
  };

  const result = scoreProspectCandidate(candidate, signals, sellerContext);

  assert.equal(result.isDisqualified, false);
  assert.ok(
    result.convertibilityScore >= 80,
    `Expected score >= 80, got ${result.convertibilityScore}`,
  );
  assert.equal(result.intentBucket, "high");
  assert.ok(result.primaryTrigger.includes("Series A"));
  assert.ok(result.primaryTrigger.includes("Hiring"));
  assert.ok(result.suggestedHook.includes("funding"));
});

test("scoreProspectCandidate: enforces seller disqualification criteria", () => {
  const candidate: ApolloPersonCandidate = {
    id: "cand_2",
    firstName: "Alex",
    lastName: "Rivera",
    name: "Alex Rivera",
    title: "Freelance Marketing Consultant",
    companyName: "Freelance / Self Employed",
    organization: {
      industry: "Consumer Retail",
    },
  };

  const signals: BuyingSignals = {
    hasActiveHiring: false,
    signalSummary: "No signals detected",
  };

  const sellerContext: SellerContext = {
    ideal_customer_profile: "B2B software companies",
    disqualification_criteria:
      "Strictly B2B only. Disqualify B2C, freelance, consumer retail.",
  };

  const result = scoreProspectCandidate(candidate, signals, sellerContext);

  assert.equal(result.isDisqualified, true);
  assert.equal(result.convertibilityScore, 0);
  assert.equal(result.intentBucket, "low");
  assert.ok(result.disqualificationReason);
});

test("scoreProspectCandidate: handles candidate with modest signals gracefully", () => {
  const candidate: ApolloPersonCandidate = {
    id: "cand_3",
    firstName: "Rohan",
    lastName: "Verma",
    name: "Rohan Verma",
    title: "Engineering Lead",
    companyName: "Acme Corp",
    companyDomain: "acme.com",
    organization: {
      estimatedNumEmployees: 50,
    },
  };

  const signals: BuyingSignals = {
    hasActiveHiring: false,
    signalSummary: "No active buying signals",
  };

  const result = scoreProspectCandidate(candidate, signals, null);

  assert.equal(result.isDisqualified, false);
  assert.ok(result.convertibilityScore > 0 && result.convertibilityScore < 60);
  assert.equal(result.intentBucket, "low");
  assert.ok(result.suggestedHook.length > 0);
});

test("extractSearchFilters: correctly parses 30 companies and transport queries without truncation", () => {
  const query = "find 30 bengaluru transport companies worth more than 10 cr";
  const filters = extractSearchFilters(query);

  assert.equal(filters.perPage, 30);
  assert.ok(filters.personLocations?.includes("Bengaluru, Karnataka, India"));
});

test("extractSearchFilters: honors explicitMax parameter up to 50", () => {
  const query = "find bengaluru transport logistics firms";
  const filters = extractSearchFilters(query, 45);

  assert.equal(filters.perPage, 45);
});
