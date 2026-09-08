/**
 * Railway PostgreSQL connection pool.
 *
 * Replaces @supabase/supabase-js for the enrichment pipeline. Supabase's
 * client speaks HTTP to PostgREST; Railway gives you a bare Postgres, so
 * the wire protocol is the real one and every query is SQL.
 *
 * WHAT THIS CHANGES ABOUT SECURITY — read before adding queries.
 *
 * Under Supabase, Row Level Security was a real safety net: even a query
 * missing its ownership predicate was filtered by a policy using
 * auth.uid(). On Railway there is no auth.uid() and no PostgREST role
 * switching, so RLS cannot fire. Ownership is now enforced ONLY by:
 *
 *   1. the WHERE clause you write, and
 *   2. the re-check inside complete_enrichment_run().
 *
 * A forgotten `and j.user_id = $n` is a cross-tenant data leak with
 * nothing behind it. Treat every query touching prospects as requiring
 * the jobs join — public.prospects has no user_id column of its own.
 */

import { Pool, type PoolClient, type QueryResultRow } from "pg"

declare global {
  var __leadgenPool: Pool | undefined
}

function connectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Railway injects it automatically when the " +
        "Postgres service is linked; locally, copy it from the service's " +
        "Connect tab into .env.local.",
    )
  }
  return url
}

/**
 * Railway's private network (*.railway.internal) is unencrypted by design
 * and rejects an SSL handshake; the public proxy URL requires SSL but
 * presents a certificate that is not in Node's CA bundle.
 *
 * `rejectUnauthorized: false` is correct for the proxy and wrong-looking
 * everywhere else, so it is scoped to exactly the hosts that need it
 * rather than applied globally.
 */
function sslConfig(url: string): false | { rejectUnauthorized: boolean } {
  if (process.env.DATABASE_SSL === "disable") return false
  const host = (() => {
    try {
      return new URL(url).hostname
    } catch {
      return ""
    }
  })()

  if (host.endsWith(".railway.internal") || host === "localhost" || host === "127.0.0.1") {
    return false
  }
  return { rejectUnauthorized: false }
}

export function getPool(): Pool {
  // Next.js dev reloads modules on every edit; without the global the app
  // opens a new pool per reload and exhausts Postgres connections in
  // about a minute.
  if (!global.__leadgenPool) {
    const url = connectionString()
    global.__leadgenPool = new Pool({
      connectionString: url,
      ssl: sslConfig(url),
      // Railway's starter Postgres allows ~20 connections. Serverless
      // functions each hold their own pool, so keep this small.
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // A crawl worker can hold a connection while it waits on the model;
      // this bounds the damage from a query that never returns.
      statement_timeout: 20_000,
    })

    global.__leadgenPool.on("error", (err) => {
      // An idle client erroring must not take the process down.
      console.error("[db] idle client error", err.message)
    })
  }
  return global.__leadgenPool
}

/** Single query. Returns rows. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params)
  return res.rows
}

/** Single row or null. Throws if the query returns more than one. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params)
  if (rows.length > 1) {
    throw new Error(`queryOne expected at most 1 row, got ${rows.length}`)
  }
  return rows[0] ?? null
}

/**
 * Run several statements in one transaction. The callback receives the
 * client; anything thrown rolls back.
 */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query("begin")
    const out = await fn(client)
    await client.query("commit")
    return out
  } catch (err) {
    await client.query("rollback").catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

/** Postgres SQLSTATE for unique_violation — the idempotency race. */
export const UNIQUE_VIOLATION = "23505"

export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === UNIQUE_VIOLATION
}

/** Liveness probe for /api/health. */
export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = Date.now()
  try {
    await query("select 1")
    return { ok: true, latencyMs: Date.now() - t0 }
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message }
  }
}
