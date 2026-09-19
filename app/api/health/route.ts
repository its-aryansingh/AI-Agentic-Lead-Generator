/**
 * GET /api/health
 *
 * Launch-readiness probe. Cheap enough to hit from external monitors
 * (one Supabase HEAD + a couple of filesystem reads). No secrets in
 * the response — just booleans for each provider.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/server"
import {
  getProviderMatrix,
  pickLatestMigration,
  type HealthSummary,
} from "@/lib/health-core"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SERVICE_VERSION = "0.8.0"
const START_TIME = Date.now()

export async function GET(req: Request) {
  const url = new URL(req.url)
  const strict = url.searchParams.get("strict") === "1"
  const providers = getProviderMatrix(process.env as Record<string, string | undefined>)

  const db = await pingDb()
  const schemaVersion = readSchemaVersion()
  const crons = readCronSchedule()

  const summary: HealthSummary = {
    ok: db.ok,
    service: "leadgenai",
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.round((Date.now() - START_TIME) / 1000),
    providers,
    db,
    schema_version: schemaVersion,
    crons,
  }

  // Strict mode: gates on full database readiness (503 if DB is failing).
  // Default mode: returns 200 for platform liveness check (Railway, Docker), reporting status in JSON.
  const status = strict && !summary.ok ? 503 : 200

  return NextResponse.json(summary, { status })
}

async function pingDb(): Promise<HealthSummary["db"]> {
  // 1. If Railway Postgres (DATABASE_URL) is present, probe it
  if (process.env.DATABASE_URL) {
    try {
      const { pingDatabase } = await import("@/lib/db")
      const res = await pingDatabase()
      return {
        ok: res.ok,
        latency_ms: res.latencyMs,
        error: res.error,
      }
    } catch (err) {
      return {
        ok: false,
        latency_ms: null,
        error: (err as Error).message,
      }
    }
  }

  // 2. If Supabase is present, probe Supabase
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return pingSupabase()
  }

  // 3. Neither configured: running in mock mode (development / fresh deployment)
  return { ok: true, latency_ms: null }
}

async function pingSupabase(): Promise<HealthSummary["db"]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return { ok: false, latency_ms: null, error: "SUPABASE_URL unset" }
  }
  const t0 = Date.now()
  try {
    const admin = createAdminClient()
    // Lightweight HEAD-style query: count(*) on a tiny RLS-free table.
    // `users` is the right call here — every deployed DB has at least 0
    // rows of it, and the service-role key bypasses RLS.
    const { error } = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .limit(1)
    const latency = Date.now() - t0
    if (error) {
      return { ok: false, latency_ms: latency, error: error.message }
    }
    return { ok: true, latency_ms: latency }
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - t0,
      error: (err as Error).message,
    }
  }
}

function readSchemaVersion(): string | null {
  try {
    const dir = join(process.cwd(), "supabase", "migrations")
    const files = readdirSync(dir)
    return pickLatestMigration(files)
  } catch {
    return null
  }
}

function readCronSchedule(): HealthSummary["crons"] {
  try {
    const path = join(process.cwd(), "vercel.json")
    const raw = readFileSync(path, "utf-8")
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { crons?: unknown[] }).crons)
    ) {
      const crons = (parsed as { crons: unknown[] }).crons
      const out: HealthSummary["crons"] = []
      for (const c of crons) {
        if (
          c &&
          typeof c === "object" &&
          typeof (c as { path?: unknown }).path === "string" &&
          typeof (c as { schedule?: unknown }).schedule === "string"
        ) {
          out.push({
            path: (c as { path: string }).path,
            schedule: (c as { schedule: string }).schedule,
          })
        }
      }
      return out
    }
  } catch {
    // ignore
  }
  return []
}
