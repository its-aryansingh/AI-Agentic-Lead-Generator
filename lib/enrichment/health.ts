/**
 * Enrichment readiness probe.
 *
 * Answers, from inside the deployed container, the question you cannot
 * answer from the Railway dashboard: is the OPENAI_API_KEY variable
 * actually reaching this process, and does OpenAI accept it?
 *
 * Without this, a missing or mistyped key is invisible until the first
 * lead — and because every provider in this repo has a mock fallback
 * (CLAUDE.md hard rule #2), the failure is SILENT: enrichment "succeeds"
 * with deterministic fake contacts. That is far worse than an error.
 *
 * `GET /api/health` runs `checkEnrichment()` (no network).
 * `GET /api/health?deep=1` also calls OpenAI's /models — one cheap,
 * unbilled request that proves the key works end to end.
 */

import { isCrawlerConfigured } from "./crawler.service"
import { isExtractorConfigured, EXTRACTION_MODEL } from "./extractor.service"
import { pingDatabase } from "@/lib/db"

export type Level = "ok" | "degraded" | "down"

export interface Component {
  status: Level
  detail: string
  /** true when this component is serving mock data instead of the real thing. */
  mock?: boolean
}

export interface EnrichmentHealth {
  status: Level
  components: Record<string, Component>
  checked_at: string
}

function keyShape(): { present: boolean; looksValid: boolean; hint: string } {
  const k = process.env.OPENAI_API_KEY
  if (!k) return { present: false, looksValid: false, hint: "OPENAI_API_KEY is not set" }

  // Never log the key. Shape only: enough to catch a truncated paste, a
  // quoted value, or trailing whitespace from the Railway UI.
  const trimmed = k.trim()
  if (trimmed !== k) return { present: true, looksValid: false, hint: "key has leading/trailing whitespace" }
  if (/^["']|["']$/.test(k)) return { present: true, looksValid: false, hint: "key is wrapped in quotes" }
  if (!k.startsWith("sk-")) return { present: true, looksValid: false, hint: "key does not start with sk-" }
  if (k.length < 40) return { present: true, looksValid: false, hint: `key is only ${k.length} chars — truncated?` }

  return { present: true, looksValid: true, hint: `${k.slice(0, 7)}…${k.slice(-4)} (${k.length} chars)` }
}

/** Fast, no network. Safe to call on every health request. */
export async function checkEnrichment(): Promise<EnrichmentHealth> {
  const components: Record<string, Component> = {}

  const db = await pingDatabase()
  components.database = db.ok
    ? { status: "ok", detail: `${db.latencyMs}ms` }
    : { status: "down", detail: db.error ?? "unreachable" }

  const k = keyShape()
  components.openai = !k.present
    ? { status: "degraded", detail: k.hint + " — extraction will return MOCK data", mock: true }
    : !k.looksValid
      ? { status: "degraded", detail: k.hint, mock: false }
      : { status: "ok", detail: `${k.hint}, model ${EXTRACTION_MODEL}` }

  components.crawler = isCrawlerConfigured()
    ? { status: "ok", detail: process.env.SCRAPER_URL ?? "" }
    : { status: "degraded", detail: "SCRAPER_URL/SCRAPER_KEY unset — crawler will return MOCK pages", mock: true }

  components.queue = process.env.INNGEST_EVENT_KEY
    ? { status: "ok", detail: "inngest configured" }
    : { status: "degraded", detail: "INNGEST_EVENT_KEY unset — runs stay queued until reconciliation" }

  const status: Level = components.database.status === "down"
    ? "down"
    : Object.values(components).some((c) => c.status !== "ok")
      ? "degraded"
      : "ok"

  return { status, components, checked_at: new Date().toISOString() }
}

/**
 * Deep check: one real request to OpenAI's /models endpoint.
 *
 * /models is not billed and does not depend on model access, so it
 * isolates "is the key valid" from "does this account have gpt-4o-mini".
 * Both are reported.
 */
export async function checkOpenAiLive(): Promise<Component> {
  if (!isExtractorConfigured()) {
    return { status: "degraded", detail: "OPENAI_API_KEY not set", mock: true }
  }

  const base = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")
  const t0 = Date.now()

  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    })
    const ms = Date.now() - t0

    if (res.status === 401) return { status: "down", detail: `401 — key rejected (${ms}ms)` }
    if (res.status === 429) return { status: "degraded", detail: `429 — rate limited or no billing (${ms}ms)` }
    if (!res.ok) return { status: "down", detail: `HTTP ${res.status} (${ms}ms)` }

    const body = (await res.json()) as { data?: Array<{ id: string }> }
    const ids = (body.data ?? []).map((m) => m.id)
    const hasModel = ids.includes(EXTRACTION_MODEL)

    return hasModel
      ? { status: "ok", detail: `key valid, ${EXTRACTION_MODEL} available (${ms}ms)` }
      : {
          status: "degraded",
          detail:
            `key valid but ${EXTRACTION_MODEL} is NOT in this account's model list ` +
            `(${ids.length} models, ${ms}ms)`,
        }
  } catch (err) {
    return {
      status: "down",
      detail: `unreachable after ${Date.now() - t0}ms: ${(err as Error).message}`,
    }
  }
}
