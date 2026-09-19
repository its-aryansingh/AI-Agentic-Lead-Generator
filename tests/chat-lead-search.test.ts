import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isMetaQuery,
  filterLeadsByCallStatus,
  filterLeadsByPhone,
  filterLeadsByTimeRange,
  filterLeadsByAvailability,
  filterLeadsByQuery,
  type LeadForFiltering,
} from "@/lib/agent/lead-search-core";

test("isMetaQuery correctly recognizes open-ended user requests vs specific search terms", () => {
  assert.equal(isMetaQuery("all"), true);
  assert.equal(isMetaQuery("leads"), true);
  assert.equal(isMetaQuery("all leads"), true);
  assert.equal(isMetaQuery("List out all the present leads"), true);
  assert.equal(isMetaQuery("List out all the leads present in our database."), true);
  assert.equal(isMetaQuery("Call the leads which have not been called"), true);
  assert.equal(isMetaQuery("Call all the leads which have been added today"), true);
  assert.equal(isMetaQuery(""), true);
  assert.equal(isMetaQuery("   "), true);

  // Specific search terms should NOT be flagged as meta queries
  assert.equal(isMetaQuery("Akshat Birla"), false);
  assert.equal(isMetaQuery("Fintech"), false);
  assert.equal(isMetaQuery("Tester from Acme"), false);
  assert.equal(isMetaQuery("john@example.com"), false);
});

test("filterLeadsByQuery retains all leads for meta queries and filters by meaningful terms", () => {
  const sampleLeads: LeadForFiltering[] = [
    { id: "1", input_name: "Akshat Birla", input_company: "BharatNXT", created_at: "2026-09-01T00:00:00Z" },
    { id: "2", input_name: "Paroma Chatterjee", input_company: "Revolut India", created_at: "2026-09-01T00:00:00Z" },
    { id: "3", input_name: "Naveen Kukreja", input_company: "Paisabazaar", created_at: "2026-09-01T00:00:00Z" },
  ];

  // "all", "leads", "all the present leads" should NOT filter out anyone
  assert.equal(filterLeadsByQuery(sampleLeads, "all").length, 3);
  assert.equal(filterLeadsByQuery(sampleLeads, "leads").length, 3);
  assert.equal(filterLeadsByQuery(sampleLeads, "List out all the present leads").length, 3);

  // Specific query should match
  const matched = filterLeadsByQuery(sampleLeads, "Akshat");
  assert.equal(matched.length, 1);
  assert.equal(matched[0].input_name, "Akshat Birla");

  // Company query should match
  const companyMatched = filterLeadsByQuery(sampleLeads, "Revolut");
  assert.equal(companyMatched.length, 1);
  assert.equal(companyMatched[0].input_name, "Paroma Chatterjee");
});

test("filterLeadsByCallStatus accurately separates uncalled, called, and no-answer leads", () => {
  const sampleLeads: LeadForFiltering[] = [
    { id: "1", input_name: "Alice", phone: "+919999999991", created_at: "2026-09-01T00:00:00Z", latest_call: null },
    { id: "2", input_name: "Bob", phone: "+919999999992", created_at: "2026-09-01T00:00:00Z", latest_call: { status: "no_answer" } },
    { id: "3", input_name: "Charlie", phone: "+919999999993", created_at: "2026-09-01T00:00:00Z", latest_call: { status: "completed", outcome: "interested" } },
    { id: "4", input_name: "David", phone: "+919999999994", created_at: "2026-09-01T00:00:00Z", latest_call: { status: "failed" } },
  ];

  const uncalled = filterLeadsByCallStatus(sampleLeads, "not_called");
  assert.equal(uncalled.length, 2); // Alice (null) and David (failed)
  assert.deepEqual(uncalled.map(l => l.input_name), ["Alice", "David"]);

  const noAnswer = filterLeadsByCallStatus(sampleLeads, "no_answer");
  assert.equal(noAnswer.length, 1);
  assert.equal(noAnswer[0].input_name, "Bob");

  const answered = filterLeadsByCallStatus(sampleLeads, "answered");
  assert.equal(answered.length, 1);
  assert.equal(answered[0].input_name, "Charlie");

  const anyCalled = filterLeadsByCallStatus(sampleLeads, "called");
  assert.equal(anyCalled.length, 3);
});

test("filterLeadsByPhone accurately filters leads with valid phone numbers", () => {
  const sampleLeads: LeadForFiltering[] = [
    { id: "1", input_name: "Has Phone", phone: "+919999999991", created_at: "2026-09-01T00:00:00Z" },
    { id: "2", input_name: "No Phone 1", phone: null, created_at: "2026-09-01T00:00:00Z" },
    { id: "3", input_name: "No Phone 2", phone: "   ", created_at: "2026-09-01T00:00:00Z" },
  ];

  const withPhone = filterLeadsByPhone(sampleLeads, true);
  assert.equal(withPhone.length, 1);
  assert.equal(withPhone[0].input_name, "Has Phone");

  const withoutPhone = filterLeadsByPhone(sampleLeads, false);
  assert.equal(withoutPhone.length, 2);
});

test("filterLeadsByTimeRange accurately isolates leads added today vs earlier", () => {
  const now = new Date("2026-09-05T12:00:00Z");
  const sampleLeads: LeadForFiltering[] = [
    { id: "1", input_name: "Today Lead", created_at: "2026-09-05T08:00:00Z" },
    { id: "2", input_name: "Yesterday Lead", created_at: "2026-09-04T10:00:00Z" },
    { id: "3", input_name: "Older Lead", created_at: "2026-08-20T10:00:00Z" },
  ];

  const today = filterLeadsByTimeRange(sampleLeads, "today", now);
  assert.equal(today.length, 1);
  assert.equal(today[0].input_name, "Today Lead");

  const yesterday = filterLeadsByTimeRange(sampleLeads, "yesterday", now);
  assert.equal(yesterday.length, 1);
  assert.equal(yesterday[0].input_name, "Yesterday Lead");
});

test("filterLeadsByAvailability captures callbacks, follow-ups, and meeting requests", () => {
  const sampleLeads: LeadForFiltering[] = [
    {
      id: "1",
      input_name: "Available Later Lead",
      created_at: "2026-09-01T00:00:00Z",
      latest_reply: { snippet: "I am traveling, please call back next week", wants_meeting: false },
    },
    {
      id: "2",
      input_name: "Meeting Lead",
      created_at: "2026-09-01T00:00:00Z",
      latest_reply: { snippet: "Let us schedule a demo", wants_meeting: true },
    },
    {
      id: "3",
      input_name: "No Callback Lead",
      created_at: "2026-09-01T00:00:00Z",
      next_action: "none",
      latest_reply: { snippet: "Not interested", wants_meeting: false },
    },
  ];

  const available = filterLeadsByAvailability(sampleLeads, "available_later");
  assert.equal(available.length, 2);
  assert.deepEqual(available.map(l => l.input_name), ["Available Later Lead", "Meeting Lead"]);
});

