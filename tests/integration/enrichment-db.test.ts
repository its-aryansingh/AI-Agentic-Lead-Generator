/**
 * Integration tests — require a real PostgreSQL database.
 *
 *   DATABASE_URL=postgresql://... npm run test:integration
 *
 * Skips itself (rather than failing) when DATABASE_URL is unset, so the
 * default `npm test` stays runnable with no infrastructure.
 *
 * The database must have the base schema plus
 * db/migrations/0001_enrichment_runs.sql applied. Point it at a scratch
 * database, never at production: it truncates fixture tables.
 */

import { strict as assert } from "node:assert"
import { after, before, describe, it } from "node:test"

const HAS_DB = !!process.env.DATABASE_URL
const skip = HAS_DB ? false : "DATABASE_URL not set"

const ALICE = "90006af6-edc5-4c8c-ac48-3ed808c98bd9"
const MALLORY = "c4161281-37d2-48ab-a179-02d8a7d7362a"
const JOB_A = "81c31f43-e79b-4e94-baae-06eac888bbf0"
const JOB_M = "261d1803-6b4f-48f6-889d-13fe143175d8"
const P_ACME = "49d9d614-6ae2-4676-b5bc-1404b4a5517b"
const P_GUESS = "02246e34-cc74-4ee5-bb3d-ed7b23ea3bf7"
const P_MAL = "2ea8a8ce-3e17-4308-a213-f136d4955fe4"

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any, svc: any

const contacts = (email: string) => ({
  emails: [{ value: email, role: false, on_domain: true, page_url: "https://x/contact" }],
  phones: [
    { e164: "+919876543210", raw: "+91 98765 43210", type: "mobile", page_url: "https://x/contact" },
  ],
  key_contacts: [],
  social_links: [],
  source_urls: ["https://x/contact"],
  extracted_at: new Date().toISOString(),
})

describe("enrichment data layer (real Postgres)", { skip }, () => {
  before(async () => {
    db = await import("../../lib/db.ts")
    svc = await import("../../lib/enrichment/run-service.ts")
    const pool = db.getPool()
    await pool.query(
      `truncate public.enrichment_runs, public.prospects, public.jobs,
                public.users, public.scrape_cache cascade`,
    )
    await pool.query(`insert into public.users(id,email) values ($1,'alice@t.in'), ($2,'mal@t.in')`, [
      ALICE,
      MALLORY,
    ])
    await pool.query(
      `insert into public.jobs(id,user_id,input_source,status) values
         ($1,$2,'chat_search','processing'), ($3,$4,'chat_search','processing')`,
      [JOB_A, ALICE, JOB_M, MALLORY],
    )
    await pool.query(
      `insert into public.prospects(id,job_id,input_source,input_company,company_domain,
                                    email,email_source,email_confidence) values
         ($1,$2,'chat_search','Acme','acme.in',null,null,null),
         ($3,$2,'chat_search','Guessy','guessy.in','guess@guessy.in','pattern_guessed','risky'),
         ($4,$5,'chat_search','Mallory','mal.in',null,null,null)`,
      [P_ACME, JOB_A, P_GUESS, P_MAL, JOB_M],
    )
  })

  after(async () => {
    if (db) await db.getPool().end()
  })

  it("connects", async () => {
    const ping = await db.pingDatabase()
    assert.equal(ping.ok, true)
  })

  describe("ownership — the jobs join is the only thing protecting tenants", () => {
    it("loads the owner's prospect", async () => {
      assert.equal((await svc.loadOwnedProspect(P_ACME, ALICE))?.id, P_ACME)
    })

    it("returns null across tenants", async () => {
      // On Railway there is no RLS behind this. If the join is ever
      // dropped from the query, this is the test that catches it.
      assert.equal(await svc.loadOwnedProspect(P_MAL, ALICE), null)
      assert.equal(await svc.loadOwnedProspect(P_ACME, MALLORY), null)
    })
  })

  describe("idempotency", () => {
    it("a duplicate request does not queue a second crawl", async () => {
      const key = svc.buildIdempotencyKey(P_ACME, "acme.in", "t1")
      const a = await svc.createOrGetRun({
        userId: ALICE, prospectId: P_ACME, domain: "acme.in", idempotencyKey: key,
      })
      const b = await svc.createOrGetRun({
        userId: ALICE, prospectId: P_ACME, domain: "acme.in", idempotencyKey: key,
      })
      assert.equal(a.created, true)
      assert.equal(b.created, false)
      assert.equal(b.run.id, a.run.id)
    })

    it("survives 10 concurrent callers", async () => {
      const key = svc.buildIdempotencyKey(P_ACME, "acme.in", "race")
      const runs = await Promise.all(
        Array.from({ length: 10 }, () =>
          svc.createOrGetRun({
            userId: ALICE, prospectId: P_ACME, domain: "acme.in", idempotencyKey: key,
          }),
        ),
      )
      assert.equal(runs.filter((r: any) => r.created).length, 1, "exactly one insert won")
      assert.equal(new Set(runs.map((r: any) => r.run.id)).size, 1, "all resolved to one run")
    })
  })

  describe("merge rules (complete_enrichment_run)", () => {
    it("fills a NULL email and marks it extracted/valid", async () => {
      const key = svc.buildIdempotencyKey(P_ACME, "acme.in", "merge1")
      const { run } = await svc.createOrGetRun({
        userId: ALICE, prospectId: P_ACME, domain: "acme.in", idempotencyKey: key,
      })
      await svc.markRunStarted(run.id, ALICE)
      await svc.completeRun({
        runId: run.id, userId: ALICE, prospectId: P_ACME, status: "succeeded",
        contacts: contacts("priya@acme.in"),
        primary: { email: "priya@acme.in", phone: "+919876543210", phone_e164: "+919876543210" },
        pagesCrawled: 4, model: "gpt-4o-mini", promptTokens: 12000, completionTokens: 250, costPaise: 29,
      })
      const r = await db.queryOne(
        `select email,email_source,email_confidence,phone_source,public_contacts is not null pc
           from public.prospects where id=$1`, [P_ACME])
      assert.equal(r.email, "priya@acme.in")
      assert.equal(r.email_source, "extracted")
      assert.equal(r.email_confidence, "valid")
      assert.equal(r.phone_source, "scraped_public")
      assert.equal(r.pc, true)
    })

    it("a scraped fact overwrites a pattern_guessed address", async () => {
      const key = svc.buildIdempotencyKey(P_GUESS, "guessy.in", "merge2")
      const { run } = await svc.createOrGetRun({
        userId: ALICE, prospectId: P_GUESS, domain: "guessy.in", idempotencyKey: key,
      })
      await svc.completeRun({
        runId: run.id, userId: ALICE, prospectId: P_GUESS, status: "succeeded",
        contacts: contacts("real@guessy.in"),
        primary: { email: "real@guessy.in", phone: null, phone_e164: null },
      })
      const r = await db.queryOne(`select email from public.prospects where id=$1`, [P_GUESS])
      assert.equal(r.email, "real@guessy.in")
    })

    it("never overwrites an already-extracted address", async () => {
      const key = svc.buildIdempotencyKey(P_ACME, "acme.in", "merge3")
      const { run } = await svc.createOrGetRun({
        userId: ALICE, prospectId: P_ACME, domain: "acme.in", idempotencyKey: key,
      })
      await svc.completeRun({
        runId: run.id, userId: ALICE, prospectId: P_ACME, status: "succeeded",
        contacts: contacts("someone.else@acme.in"),
        primary: { email: "someone.else@acme.in", phone: null, phone_e164: null },
      })
      const r = await db.queryOne(`select email from public.prospects where id=$1`, [P_ACME])
      assert.equal(r.email, "priya@acme.in", "verified data must survive re-enrichment")
    })

    it("refuses a cross-tenant write and leaves the row untouched", async () => {
      const key = svc.buildIdempotencyKey(P_ACME, "acme.in", "evil")
      const { run } = await svc.createOrGetRun({
        userId: ALICE, prospectId: P_ACME, domain: "acme.in", idempotencyKey: key,
      })
      await assert.rejects(() =>
        svc.completeRun({
          runId: run.id, userId: ALICE, prospectId: P_MAL, status: "succeeded",
          primary: { email: "stolen@mal.in", phone: null, phone_e164: null },
        }),
      )
      const r = await db.queryOne(
        `select email, enrichment_status from public.prospects where id=$1`, [P_MAL])
      assert.equal(r.email, null)
      assert.equal(r.enrichment_status, null)
    })
  })

  describe("reconciliation", () => {
    it("finds queued runs older than the threshold and ignores finished ones", async () => {
      const key = svc.buildIdempotencyKey(P_GUESS, "guessy.in", "stuck")
      const { run } = await svc.createOrGetRun({
        userId: ALICE, prospectId: P_GUESS, domain: "guessy.in", idempotencyKey: key,
      })
      await db.query(
        `update public.enrichment_runs set status='queued',
           created_at = now() - interval '30 minutes' where id=$1`, [run.id])
      const stuck = await svc.findStuckRuns(5, 50)
      assert.ok(stuck.some((r: any) => r.id === run.id))
      assert.ok(stuck.every((r: any) => r.status === "queued" || r.status === "running"))
    })
  })
})
