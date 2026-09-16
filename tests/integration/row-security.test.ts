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
               public.campaigns, public.campaign_recipients cascade`,
    )

    ALICE = (await auth.signUp("alice@test.in", "correct horse battery")).user.id
    MALLORY = (await auth.signUp("mallory@test.in", "mallory password 123")).user.id

    admin = sb.createAdminClient()
    alice = sb.createClientForUser(ALICE)
    mallory = sb.createClientForUser(MALLORY)

    jobA = (await admin.from("jobs").insert({ user_id: ALICE, input_source: "chat_search", status: "processing" }).select("id").single()).data.id
    jobM = (await admin.from("jobs").insert({ user_id: MALLORY, input_source: "chat_search", status: "processing" }).select("id").single()).data.id
    pA = (await admin.from("prospects").insert({ job_id: jobA, input_source: "chat_search", input_company: "AcmeCo", stage: "contacted" }).select("id").single()).data.id
    pM = (await admin.from("prospects").insert({ job_id: jobM, input_source: "chat_search", input_company: "MalCo", stage: "contacted" }).select("id").single()).data.id
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
      const r = await alice.from("prospects").insert({ job_id: jobM, input_source: "chat_search" })
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
