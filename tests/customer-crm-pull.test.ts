import { test } from "node:test";
import assert from "node:assert/strict";
import { pullCustomerCrm } from "@/lib/customer-crm";

test("HubSpot pull maps contacts, normalizes identity, pagination, and modifiedAfter search", async () => {
  const original = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({ results: [{ id: "hs-1", properties: { firstname: "Ada", lastname: "Lovelace", email: " ADA@example.com ", phone: "+1 (415) 555-0100", hs_lastmodifieddate: "2026-09-01T00:00:00.000Z" } }], paging: { next: { after: "next" } } }), { status: 200 });
  };
  try {
    const result = await pullCustomerCrm({ provider: "hubspot", accessToken: "secret" }, { limit: 12, cursor: "before", modifiedAfter: "2026-09-01T00:00:00.000Z" });
    assert.equal(request?.url, "https://api.hubapi.com/crm/v3/objects/contacts/search");
    assert.equal(request?.headers.get("authorization"), "Bearer secret");
    const body = await request?.json() as { after: string; limit: number; filterGroups: unknown[]; properties: string[] };
    assert.equal(body.after, "before"); assert.equal(body.limit, 12); assert.ok(body.filterGroups.length); assert.ok(body.properties.includes("hs_lastmodifieddate"));
    assert.deepEqual({ cursor: result.nextCursor, more: result.hasMore }, { cursor: "next", more: true });
    assert.equal(result.contacts[0].normalizedEmail, "ada@example.com");
    assert.equal(result.contacts[0].normalizedPhoneE164, "+14155550100");
  } finally { globalThis.fetch = original; }
});

test("Zoho pull refreshes token, uses regional API/page token and modified header", async () => {
  const original = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init); requests.push(request);
    if (request.url.includes("/oauth/v2/token")) return new Response(JSON.stringify({ access_token: "access" }), { status: 200 });
    return new Response(JSON.stringify({ data: [{ id: "z-1", First_Name: "Grace", Last_Name: "Hopper", Email: "GRACE@example.com", Phone: "+91 98765 43210", Modified_Time: "2026-09-02T00:00:00+00:00" }], info: { more_records: true, next_page_token: "zoho-next" } }), { status: 200 });
  };
  try {
    const result = await pullCustomerCrm({ provider: "zoho", refreshToken: "refresh", clientId: "id", clientSecret: "secret", region: "in" }, { limit: 20, cursor: "page-1", modifiedAfter: "2026-09-01T00:00:00.000Z" });
    assert.equal(requests.length, 2);
    assert.match(requests[1].url, /^https:\/\/www\.zohoapis\.in\/crm\/v6\/Contacts/);
    assert.match(requests[1].url, /page_token=page-1/);
    assert.equal(requests[1].headers.get("authorization"), "Zoho-oauthtoken access");
    assert.equal(requests[1].headers.get("if-modified-since"), "2026-09-01T00:00:00.000Z");
    assert.equal(result.nextCursor, "zoho-next"); assert.equal(result.contacts[0].email, "grace@example.com");
  } finally { globalThis.fetch = original; }
});

test("provider errors are structured and do not include credentials", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "expired" }), { status: 401 });
  try {
    await assert.rejects(() => pullCustomerCrm({ provider: "hubspot", accessToken: "never-show-this" }, {}), (error: Error) => error.message.includes("HubSpot CRM error (401): expired") && !error.message.includes("never-show-this"));
  } finally { globalThis.fetch = original; }
});
