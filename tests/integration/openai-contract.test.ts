/**
 * OpenAI contract tests — no network required.
 *
 *   node --import tsx --test tests/integration/openai-contract.test.ts
 *
 * Starts a local OpenAI-compatible server, points the real `openai` SDK at
 * it via OPENAI_BASE_URL, and asserts two things:
 *
 *   1. WIRE SHAPE — the exact HTTP request our code emits matches the
 *      documented Chat Completions + Structured Outputs contract. This is
 *      what an offline environment CAN prove: not that OpenAI accepts it,
 *      but that we send precisely what the docs specify.
 *
 *   2. RESPONSE HANDLING — every documented failure shape (safety refusal,
 *      finish_reason=length, non-JSON content, schema drift, 401/400/429/
 *      5xx) maps to the right EnrichmentError code and the right
 *      retryable flag. Getting `retryable` wrong is expensive: a retried
 *      401 burns the queue, an un-retried 429 drops a lead.
 *
 * The live check that this cannot replace is scripts/verify-openai.mjs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { strict as assert } from "node:assert"
import http from "node:http"
import { after, before, describe, it } from "node:test"

const PORT = 8991
let server: http.Server
let captured: { method?: string; url?: string; headers: any; body: any } = { headers: {}, body: null }
let scenario = "ok"

const MODEL_OUTPUT = {
  emails: [
    "Priya.Sharma@bharatprecision.in",
    "info@bharatprecision.in",
    "ceo@bharatprecision.in",        // hallucinated
    "webmaster@wixpress.com",        // vendor
  ],
  phones: ["+91 98765 43210", "0120-4567890", "09AABCU9603R1ZM", "4567890123"],
  key_contacts: [
    { name: "Priya Sharma", title: "Managing Director" },
    { name: "Vikram Mehta", title: "CTO" },   // invented
  ],
  social_links: ["https://www.linkedin.com/company/bharat-precision"],
}

const completion = (over: any = {}) => ({
  id: "chatcmpl-test", object: "chat.completion", created: 1,
  model: "gpt-4o-mini-2024-07-18",
  choices: [{ index: 0, finish_reason: "stop",
    message: { role: "assistant", content: JSON.stringify(MODEL_OUTPUT), refusal: null } }],
  usage: { prompt_tokens: 3187, completion_tokens: 214, total_tokens: 3401 },
  ...over,
})

const PAGES = [{
  url: "https://bharatprecision.in/contact", title: "Contact", status: 200,
  text: [
    "GSTIN: 09AABCU9603R1ZM", "Pincode 201309", "Invoice ref 4567890123",
    "info@bharatprecision.in", "Export desk: Priya.Sharma@bharatprecision.in",
    "Landline: 0120-4567890", "+919876543210", "Site by webmaster@wixpress.com",
    "Priya Sharma — Managing Director",
  ].join("\n"),
}]

/* eslint-disable @typescript-eslint/no-explicit-any */
let extractContacts: any, validateExtraction: any

before(async () => {
  server = http.createServer(async (req, res) => {
    let raw = ""
    for await (const c of req) raw += c
    captured = { method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null }
    const json = (code: number, b: any) => {
      res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(b))
    }
    switch (scenario) {
      case "refusal": return json(200, completion({ choices: [{ index: 0, finish_reason: "stop",
        message: { role: "assistant", content: null, refusal: "I can't help with that." } }] }))
      case "length": return json(200, completion({ choices: [{ index: 0, finish_reason: "length",
        message: { role: "assistant", content: '{"emails":["a@b.in", "c@', refusal: null } }] }))
      case "badjson": return json(200, completion({ choices: [{ index: 0, finish_reason: "stop",
        message: { role: "assistant", content: "```json\n{\"emails\":[]}\n```", refusal: null } }] }))
      case "drift": return json(200, completion({ choices: [{ index: 0, finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify({ emails: "nope" }), refusal: null } }] }))
      case "empty": return json(200, completion({ choices: [{ index: 0, finish_reason: "stop",
        message: { role: "assistant", content: null, refusal: null } }] }))
      case "401": return json(401, { error: { message: "Incorrect API key" } })
      case "400": return json(400, { error: { message: "Invalid schema for response_format" } })
      case "429": return json(429, { error: { message: "Rate limit reached" } })
      case "500": return json(500, { error: { message: "server_error" } })
      default: return json(200, completion())
    }
  })
  await new Promise<void>((r) => server.listen(PORT, r))

  process.env.OPENAI_API_KEY = "sk-proj-test-key"
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${PORT}/v1`
  extractContacts = (await import("@/lib/enrichment/extractor.service")).extractContacts
  validateExtraction = (await import("@/lib/enrichment/validator")).validateExtraction
})

after(() => { server?.close() })

describe("request shape sent to OpenAI", () => {
  before(async () => {
    scenario = "ok"
    await extractContacts({ domain: "bharatprecision.in", pages: PAGES })
  })

  it("POSTs to /v1/chat/completions with bearer auth", () => {
    assert.equal(captured.method, "POST")
    assert.equal(captured.url, "/v1/chat/completions")
    assert.equal(captured.headers.authorization, "Bearer sk-proj-test-key")
  })

  it("pins deterministic sampling", () => {
    assert.equal(captured.body.model, "gpt-4o-mini")
    assert.equal(captured.body.temperature, 0)
    assert.equal(captured.body.top_p, 1)
    assert.equal(captured.body.max_tokens, 2000)
  })

  it("sends response_format json_schema with strict:true", () => {
    const rf = captured.body.response_format
    assert.equal(rf.type, "json_schema")
    assert.equal(rf.json_schema.strict, true)
    assert.match(rf.json_schema.name, /^[a-zA-Z0-9_-]{1,64}$/)
  })

  it("satisfies strict-mode schema rules at every level", () => {
    const s = captured.body.response_format.json_schema.schema
    assert.equal(s.additionalProperties, false)
    assert.deepEqual(s.required.slice().sort(),
      ["emails", "key_contacts", "phones", "social_links"])
    const nested = s.properties.key_contacts.items
    assert.equal(nested.additionalProperties, false)
    assert.deepEqual(nested.required.slice().sort(), ["name", "title"])
  })

  it("enforces the token budget on the wire", () => {
    assert.ok(captured.body.messages[1].content.length <= 48_000)
  })

  it("never puts a secret in the request body", () => {
    const s = JSON.stringify(captured.body)
    assert.equal(s.includes("sk-proj"), false)
  })
})

describe("response handling", () => {
  const expectError = async (sc: string, code: string, retryable: boolean) => {
    scenario = sc
    await assert.rejects(
      () => extractContacts({ domain: "bharatprecision.in", pages: PAGES }),
      (err: any) => {
        assert.equal(err.code, code, `${sc}: expected ${code}, got ${err.code}`)
        assert.equal(err.retryable, retryable, `${sc}: expected retryable=${retryable}`)
        return true
      },
    )
  }

  it("safety refusal -> MODEL_REFUSAL, terminal", () => expectError("refusal", "MODEL_REFUSAL", false))
  it("finish_reason=length -> MODEL_INVALID_JSON, terminal", () => expectError("length", "MODEL_INVALID_JSON", false))
  it("markdown-fenced content -> MODEL_INVALID_JSON", () => expectError("badjson", "MODEL_INVALID_JSON", false))
  it("schema drift -> caught by the Zod guard", () => expectError("drift", "MODEL_INVALID_JSON", false))
  it("null content -> retryable", () => expectError("empty", "MODEL_INVALID_JSON", true))

  // Getting these wrong is what makes a queue expensive.
  it("401 -> never retried", () => expectError("401", "MODEL_UNAVAILABLE", false))
  it("400 invalid schema -> never retried", () => expectError("400", "MODEL_UNAVAILABLE", false))
  it("429 -> retried", () => expectError("429", "MODEL_UNAVAILABLE", true))
  it("500 -> retried", () => expectError("500", "MODEL_UNAVAILABLE", true))
})

describe("usage accounting", () => {
  it("reads real token counts and converts to paise", async () => {
    scenario = "ok"
    const out = await extractContacts({ domain: "bharatprecision.in", pages: PAGES })
    assert.equal(out.using_mock_data, false)
    assert.equal(out.usage.prompt_tokens, 3187)
    assert.equal(out.usage.completion_tokens, 214)
    assert.equal(out.usage.model, "gpt-4o-mini-2024-07-18", "records the resolved snapshot")
    const expected = Math.ceil(((3187 / 1e6) * 0.15 + (214 / 1e6) * 0.6) * 88 * 100)
    assert.equal(out.usage.cost_paise, expected)
  })
})

describe("model output still passes through the validator", () => {
  it("rejects everything the model got wrong", async () => {
    scenario = "ok"
    const out = await extractContacts({ domain: "bharatprecision.in", pages: PAGES })
    const c = validateExtraction(out.extraction, PAGES, "bharatprecision.in")
    const emails = c.emails.map((e: any) => e.value)
    const phones = c.phones.map((p: any) => p.e164)

    assert.equal(emails.includes("ceo@bharatprecision.in"), false, "hallucination dropped")
    assert.equal(emails.includes("webmaster@wixpress.com"), false, "vendor dropped")
    assert.equal(emails.includes("priya.sharma@bharatprecision.in"), true, "real address kept")
    assert.equal(phones.some((p: string) => p?.includes("09AABCU")), false, "GSTIN dropped")
    assert.equal(phones.some((p: string) => p?.endsWith("4567890123")), false, "invoice ref dropped")
    assert.deepEqual(phones, ["+919876543210", "+911204567890"], "only the real numbers survive")
    assert.equal(c.key_contacts.some((k: any) => k.name === "Vikram Mehta"), false, "invented person dropped")
  })
})
