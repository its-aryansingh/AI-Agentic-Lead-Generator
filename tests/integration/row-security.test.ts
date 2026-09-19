/**
 * Row-security integration tests — REQUIRE a real PostgreSQL database.
 *
 *   DATABASE_URL=postgresql://... npm run test:integration
 *
 * These are the most important tests in the repo.
 *
 * Moving off Supabase removed Row Level Security. RLS failed CLOSED: a
 * query that forgot its ownership predicate was still filtered by a
 * policy. Application-level checks fail OPEN. lib/db/rls.ts and the query
 * builder restore that safety net; this file is what proves it holds.
 *
 * Three of the cases below are not hypothetical. They are queries that
 * shipped in this repo with NO user filter at all, relying entirely on a
 * policy that no longer exists:
 *
 *   app/api/analytics/route.ts    .from("jobs").select(...)
 *   app/api/export/csv/route.ts   .from("prospects").eq("job_id", <any>)
 *   app/api/prospects/[id]        .update({stage}).eq("id", <any>)
 *
 * If a test here fails, one tenant can read or write another's data.
 * Do not skip it, and do not "fix" it by loosening the assertion.
 */

import { strict as assert } from "node:assert"
import { after, before, describe, it } from "node:test"

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set"

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any, sb: any, auth: any
let ALICE = "", MALLORY = "", jobA = "", jobM = "", pA = "", pM = ""
let alice: any, mallory: any, admin: any

describe("row security (real Postgres, no RLS)", { skip }, () => {
  before(async () => {
    process.env.AUTH_JWT_SECRET ??= "test-secret-at-least-32-chars-long-xx"
    db = await import("@/lib/db")
    sb = await import("@/lib/supabase/server")
    auth = await import("@/lib/db/auth")

    await db.getPool().query(
      `truncate public.users, public.jobs, public.prospects, public.chat_sessions,
               public.prospect_candidates, public.credit_transactions,
               public.campaigns, public.campaign_recipients,
               public.customer_contexts, public.playbook_examples,
               public.voice_connections, public.voice_executions,
               public.lead_qualification_facts, public.phone_suppressions,
               public.crm_connections, public.crm_syncs,
               public.ai_provider_connections, public.ai_preferences,
               public.ai_usage_events, public.credit_packs cascade`,
    )

    ALICE = (await auth.signUp("alice@test.in", "correct horse battery")).user.id
    MALLORY = (await auth.signUp("mallory@test.in", "mallory password 123")).user.id

    admin = sb.createAdminClient()
    alice = sb.createClientForUser(ALICE)
    mallory = sb.createClientForUser(MALLORY)

    jobA = (await admin.from("jobs").insert({ user_id: ALICE, input_source: "chat_search", status: "processing" }).select("id").single()).data.id
    jobM = (await admin.from("jobs").insert({ user_id: MALLORY, input_source: "chat_search", status: "processing" }).select("id").single()).data.id
    pA = (await admin.from("prospects").insert({ user_id: ALICE, job_id: jobA, input_source: "chat_search", input_company: "AcmeCo", stage: "contacted" }).select("id").single()).data.id
    pM = (await admin.from("prospects").insert({ user_id: MALLORY, job_id: jobM, input_source: "chat_search", input_company: "MalCo", stage: "contacted" }).select("id").single()).data.id
  })

  after(async () => { if (db) await db.getPool().end() })

  describe("authentication", () => {
    it("rejects a duplicate email", async () => {
      assert.equal((await auth.signUp("alice@test.in", "another password")).user, null)
    })
    it("rejects a short password", async () => {
      assert.equal((await auth.signUp("bob@test.in", "short")).user, null)
    })
    it("signs in with the correct password", async () => {
      assert.equal((await auth.signInWithPassword("alice@test.in", "correct horse battery")).user.id, ALICE)
    })
    it("rejects the wrong password", async () => {
      assert.equal((await auth.signInWithPassword("alice@test.in", "wrong")).user, null)
    })
    it("rejects an unknown email without leaking that it is unknown", async () => {
      const r = await auth.signInWithPassword("nobody@test.in", "whatever")
      assert.equal(r.user, null)
      // Same message as a wrong password: the response must not distinguish.
      assert.equal(r.error.message, "Invalid email or password")
    })
    it("salts password hashes", async () => {
      assert.notEqual(await auth.hashPassword("x"), await auth.hashPassword("x"))
    })
  })

  describe("regression: queries that shipped with no user filter", () => {
    it('analytics .from("jobs") returns only the caller\'s jobs', async () => {
      const { data } = await alice.from("jobs").select("id,user_id")
      assert.equal(data.length, 1)
      assert.equal(data[0].user_id, ALICE)
    })

    it("export/csv with someone else's jobId returns nothing", async () => {
      const { data } = await alice.from("prospects").select("id").eq("job_id", jobM)
      assert.equal(data.length, 0)
    })

    it("...but the caller's own jobId still works", async () => {
      const { data } = await alice.from("prospects").select("id").eq("job_id", jobA)
      assert.equal(data.length, 1)
    })

    it("stage PATCH cannot touch another tenant's prospect", async () => {
      const { data } = await alice.from("prospects")
        .update({ stage: "converted" }).eq("id", pM).select("id,stage").maybeSingle()
      assert.equal(data, null)
      const after = await admin.from("prospects").select("stage").eq("id", pM).single()
      assert.equal(after.data.stage, "contacted", "victim row must be untouched")
    })

    it("...but the caller can still update their own", async () => {
      const { data } = await alice.from("prospects")
        .update({ stage: "replied" }).eq("id", pA).select("id,stage").maybeSingle()
      assert.equal(data.stage, "replied")
    })
  })

  describe("insert ownership (the WITH CHECK half)", () => {
    it("refuses a row owned by someone else", async () => {
      const r = await alice.from("jobs").insert({ user_id: MALLORY, input_source: "chat_search", status: "pending" })
      assert.notEqual(r.error, null)
    })
    it("stamps an omitted owner with the session user", async () => {
      const r = await alice.from("jobs").insert({ input_source: "chat_search", status: "pending" }).select("id,user_id").single()
      assert.equal(r.data.user_id, ALICE)
    })
    it("refuses a child row under another tenant's parent", async () => {
      // sequence_steps is still parent-owned, so this is the case the
      // SQL guard covers.
      const seqM = (await admin.from("sequences")
        .insert({ user_id: MALLORY, name: "mal" }).select("id").single()).data.id
      const r = await alice.from("sequence_steps").insert({ sequence_id: seqM, step_index: 1 })
      assert.notEqual(r.error, null)
    })

    it("stamps prospects.user_id rather than trusting job_id", async () => {
      // 0004 made prospects column-owned. A row naming another tenant's
      // job now gets the SESSION user's id stamped on it, so it lands in
      // the caller's own tenancy and is not a leak — and the composite
      // FK prospects(id, user_id) keeps every child row consistent with
      // whichever tenancy the parent ended up in.
      const r = await alice.from("prospects")
        .insert({ job_id: jobA, input_source: "chat_search", input_company: "Stamped" })
        .select("user_id").single()
      assert.equal(r.error, null)
      assert.equal(r.data.user_id, ALICE)
    })

    it("refuses a prospect explicitly owned by someone else", async () => {
      const r = await alice.from("prospects")
        .insert({ user_id: MALLORY, job_id: jobM, input_source: "chat_search" })
      assert.notEqual(r.error, null)
    })
  })

  describe("ported SalesEngAI tables", () => {
    // Every table 0003_salesengai.sql adds arrived with an RLS policy
    // that no longer exists. These assert the replacement holds — and
    // in particular that the three secret-bearing ones do, because a
    // gap there hands over a customer's Bolna, CRM or AI credentials.

    it("a voice connection is invisible to another tenant", async () => {
      const ins = await admin.from("voice_connections").insert({
        user_id: ALICE, agent_id: "agent-a", encrypted_api_key: "cipher-a",
      }).select("id").single()
      assert.equal(ins.error, null)
      assert.equal((await mallory.from("voice_connections").select("*")).data.length, 0)
      assert.equal((await alice.from("voice_connections").select("*")).data.length, 1)
    })

    it("a CRM connection is invisible to another tenant", async () => {
      await admin.from("crm_connections").insert({
        user_id: ALICE, provider: "hubspot", encrypted_credentials: "cipher-a",
      })
      assert.equal((await mallory.from("crm_connections").select("*")).data.length, 0)
      assert.equal((await alice.from("crm_connections").select("*")).data.length, 1)
    })

    it("an AI provider key is invisible to another tenant", async () => {
      await admin.from("ai_provider_connections").insert({
        user_id: ALICE, provider: "openai", encrypted_api_key: "cipher-a",
      })
      assert.equal((await mallory.from("ai_provider_connections").select("*")).data.length, 0)
    })

    it("customer_contexts is keyed on user_id and still scoped", async () => {
      await admin.from("customer_contexts").insert({ user_id: ALICE, company_name: "AcmeCo" })
      await admin.from("customer_contexts").insert({ user_id: MALLORY, company_name: "MalCo" })
      const seen = (await alice.from("customer_contexts").select("company_name")).data
      assert.deepEqual(seen.map((r: any) => r.company_name), ["AcmeCo"])
    })

    it("a phone suppression list does not leak across tenants", async () => {
      await admin.from("phone_suppressions").insert({
        user_id: ALICE, phone_hash: "hash-a", reason: "do_not_call",
      })
      assert.equal((await mallory.from("phone_suppressions").select("*")).data.length, 0)
    })

    it("an omitted user_id is stamped with the session user", async () => {
      const r = await alice.from("playbook_examples")
        .insert({ example_type: "email", title: "T", content: "C" })
        .select("user_id").single()
      assert.equal(r.data.user_id, ALICE)
    })

    it("refuses a qualification fact owned by someone else", async () => {
      const r = await alice.from("lead_qualification_facts").insert({
        user_id: MALLORY, prospect_id: pM, fact_key: "interest",
        fact_value: "yes", source_type: "reply", confidence: 0.9,
      })
      assert.notEqual(r.error, null)
    })
  })

  describe("read-only tables (policies that were `for select`)", () => {
    // These three are the billing and audit trail. The owner reads
    // them; only the service client writes them. If a signed-in user
    // could insert here they could forge their own usage history.

    it("the owner can read their usage events", async () => {
      await admin.from("ai_usage_events").insert({
        user_id: ALICE, provider: "openai", model: "gpt-4o-mini",
        operation: "extract", status: "completed",
      })
      assert.equal((await alice.from("ai_usage_events").select("*")).data.length, 1)
    })

    it("...and another tenant cannot", async () => {
      assert.equal((await mallory.from("ai_usage_events").select("*")).data.length, 0)
    })

    it("a signed-in user cannot forge a usage event", async () => {
      const r = await alice.from("ai_usage_events").insert({
        user_id: ALICE, provider: "openai", model: "gpt-4o-mini",
        operation: "extract", status: "completed",
      })
      assert.notEqual(r.error, null)
      assert.equal(r.error.code, "42501")
    })

    it("a signed-in user cannot grant themselves a credit pack", async () => {
      const r = await alice.from("credit_packs").insert({
        user_id: ALICE, pack_id: "pack_6000", credits_added: 6000,
      })
      assert.notEqual(r.error, null)
      assert.equal(r.error.code, "42501")
    })

    it("a signed-in user cannot delete their usage history", async () => {
      const r = await alice.from("ai_usage_events").delete().eq("user_id", ALICE)
      assert.notEqual(r.error, null)
      assert.equal(r.error.code, "42501")
    })

    it("...but the service client writes all three normally", async () => {
      assert.equal((await admin.from("credit_packs").insert({
        user_id: ALICE, pack_id: "pack_500", credits_added: 500,
      })).error, null)
    })
  })

  describe(".or() — the PostgREST disjunction filter", () => {
    // Added for the SalesEngAI agent port, whose search_leads handler
    // calls .or(`input_name.ilike.%${term}%,email.ilike.%${term}%`).
    // That term comes from an agent tool call, so it ultimately comes
    // from chat input. These assert it is parameterised, not spliced.

    it("matches on either branch", async () => {
      const r = await alice.from("prospects")
        .select("id,input_company")
        .or("input_company.ilike.%Acme%,input_company.ilike.%Nothing%")
      assert.equal(r.error, null)
      assert.equal(r.data.length, 1)
    })

    it("is still ownership-filtered — the other tenant's row never matches", async () => {
      const r = await alice.from("prospects")
        .select("id,input_company")
        .or("input_company.ilike.%Acme%,input_company.ilike.%MalCo%")
      assert.equal(r.error, null)
      assert.deepEqual(r.data.map((x: any) => x.input_company), ["AcmeCo"])
    })

    it("treats a quote as data, not syntax", async () => {
      // If the term were concatenated into SQL this would be a syntax
      // error or worse. Parameterised, it is simply a search for a
      // company nobody is called.
      const evil = "%' or '1'='1"
      const r = await alice.from("prospects")
        .select("id")
        .or(`input_company.ilike.%${evil}%,email.ilike.%${evil}%`)
      assert.equal(r.error, null)
      assert.equal(r.data.length, 0)
    })

    it("a comment-injection attempt cannot truncate the ownership predicate", async () => {
      const evil = "x%'; drop table public.prospects; --"
      const r = await alice.from("prospects").select("id").or(`input_company.ilike.%${evil}%`)
      assert.equal(r.error, null)
      assert.equal(r.data.length, 0)
      // The table is still there.
      assert.equal((await admin.from("prospects").select("id")).error, null)
    })

    it("rejects a column name that is not a plain identifier", async () => {
      const r = await alice.from("prospects").select("id").or('"a"."b".eq.1')
      assert.notEqual(r.error, null)
    })

    it("rejects an unknown operator rather than passing it through", async () => {
      const r = await alice.from("prospects").select("id").or("input_company.matches.x")
      assert.notEqual(r.error, null)
    })

    it("rejects a nested group", async () => {
      const r = await alice.from("prospects").select("id").or("and(a.eq.1,b.eq.2)")
      assert.notEqual(r.error, null)
    })
  })

  describe("fails closed", () => {
    it("a table with no ownership rule is denied to user-scoped clients", async () => {
      const r = await alice.from("scrape_cache").select("*")
      assert.notEqual(r.error, null)
      assert.equal(r.error.code, "42501")
    })
    it("...but the service-role client can still reach it", async () => {
      assert.equal((await admin.from("scrape_cache").select("*")).error, null)
    })
  })

  describe("supabase-js behaviours the call sites depend on", () => {
    const NOWHERE = "00000000-0000-4000-8000-000000000000"
    it("maybeSingle returns null rather than erroring", async () => {
      assert.equal((await alice.from("jobs").select("id").eq("id", NOWHERE).maybeSingle()).data, null)
    })
    it("single errors when nothing matched", async () => {
      assert.notEqual((await alice.from("jobs").select("id").eq("id", NOWHERE).single()).error, null)
    })
    it('count:"exact" with head:true returns a number', async () => {
      const { count } = await alice.from("jobs").select("id", { count: "exact", head: true })
      assert.equal(typeof count, "number")
    })
    it("order + limit", async () => {
      const { data } = await alice.from("jobs").select("id,created_at").order("created_at", { ascending: false }).limit(1)
      assert.equal(data.length, 1)
    })
    it(".in() is still ownership-filtered", async () => {
      const { data } = await alice.from("prospects").select("id").in("id", [pA, pM])
      assert.equal(data.length, 1)
    })
    it("upsert with onConflict", async () => {
      const r = await admin.from("users")
        .upsert({ id: ALICE, email: "alice@test.in", credits_remaining: 99 }, { onConflict: "id" })
        .select("credits_remaining").single()
      assert.equal(r.data.credits_remaining, 99)
    })
  })
})
