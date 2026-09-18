/**
 * A PostgREST-shaped query builder over node-postgres.
 *
 * This reproduces the slice of the @supabase/supabase-js surface this
 * codebase actually uses — measured, not guessed, by grepping all 33
 * files that imported it:
 *
 *   eq(101) select(71) update(41) insert(35) maybeSingle(34) limit(17)
 *   order(11) upsert(9) in(9) single(8) match(5) not(2) neq(2)
 *   lte(2) lt(2) gte(2) gt(2) delete(2) rpc
 *   options: count:"exact", head:true, onConflict, ignoreDuplicates
 *
 * The point is that call sites do not change. `supabase.from("jobs")
 * .select("id").eq("user_id", x).maybeSingle()` keeps working; underneath
 * it is now SQL on a Railway Postgres, with the ownership predicate from
 * lib/db/rls.ts injected when the client is user-scoped.
 *
 * DIFFERENCES FROM SUPABASE-JS, on purpose:
 *  - `select("a,b")` takes plain columns. PostgREST embedded resources
 *    (`jobs!inner(user_id)`) are NOT supported — they were only used in
 *    the enrichment engine, which now writes its own SQL.
 *  - Errors come back as `{ data: null, error }` like supabase-js, so
 *    existing `if (error)` branches behave the same.
 */

import type { PoolClient } from "pg"

import { getPool } from "@/lib/db"
import { insertOwnershipCheck, ownershipPredicate, RowSecurityError, writeDenied } from "./rls"

export interface PgError {
  message: string
  code?: string
  details?: string
  hint?: string
}

export interface Result<T> {
  data: T | null
  error: PgError | null
  count?: number | null
}

type Op = "select" | "insert" | "update" | "upsert" | "delete"

/**
 * Operators PostgREST spells with words. Only these are accepted; an
 * unknown one is an error rather than a passthrough, so a typo can
 * never become raw SQL.
 */
const OR_OPERATORS: Record<string, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "like",
  ilike: "ilike",
}

const PLAIN_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Turns `a.eq.1,b.ilike.%x%` into `("t"."a" = $1 or "t"."b" ilike $2)`,
 * registering every value as a bound parameter via `push`.
 */
function renderOrExpression(
  table: string,
  expression: string,
  push: (value: unknown) => string,
): string {
  if (expression.includes("(") || expression.includes(")")) {
    throw new Error(
      `or(): nested groups are not supported — got ${JSON.stringify(expression)}`,
    )
  }

  const parts: string[] = []
  for (const raw of expression.split(",")) {
    const term = raw.trim()
    if (!term) continue

    // column.operator.value — the value may itself contain dots.
    const first = term.indexOf(".")
    const second = term.indexOf(".", first + 1)
    if (first <= 0 || second < 0) {
      throw new Error(`or(): cannot parse term ${JSON.stringify(term)}`)
    }

    const column = term.slice(0, first)
    const op = term.slice(first + 1, second)
    let value: string = term.slice(second + 1)

    if (!PLAIN_IDENT.test(column)) {
      throw new Error(`or(): ${JSON.stringify(column)} is not a plain column name`)
    }

    const col = `"${table}"."${column}"`

    if (op === "is") {
      if (value === "null") { parts.push(`${col} is null`); continue }
      if (value === "true" || value === "false") { parts.push(`${col} is ${value}`); continue }
      throw new Error(`or(): is.${value} is not null/true/false`)
    }

    const sqlOp = OR_OPERATORS[op]
    if (!sqlOp) throw new Error(`or(): unsupported operator ${JSON.stringify(op)}`)

    // PostgREST writes wildcards as *; SQL wants %.
    if (op === "like" || op === "ilike") value = value.replace(/\*/g, "%")
    // PostgREST allows "quoted values" to protect commas and dots.
    if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }

    parts.push(`${col} ${sqlOp} ${push(value)}`)
  }

  if (parts.length === 0) throw new Error("or(): no usable terms")
  return `(${parts.join(" or ")})`
}

interface Filter {
  column: string
  operator: string
  value: unknown
}

interface SelectOptions {
  count?: "exact" | "planned" | "estimated"
  head?: boolean
}

interface UpsertOptions {
  onConflict?: string
  ignoreDuplicates?: boolean
}

function quoteIdent(name: string): string {
  // Column refs may arrive as "table.column" from .match()/.eq() on joins.
  return name
    .split(".")
    .map((p) => `"${p.replace(/"/g, '""')}"`)
    .join(".")
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date)
}

/** jsonb columns must be handed to pg as text, not as JS objects. */
function encode(value: unknown): unknown {
  if (value === undefined) return null
  if (isPlainObject(value) || Array.isArray(value)) return JSON.stringify(value)
  return value
}

/**
 * Result of a query narrowed by .single() / .maybeSingle().
 * supabase-js changes the resolved type at this point; so must we, or
 * every call site that reads `data.someColumn` fails to compile.
 */
export interface SingleResult<T> extends PromiseLike<Result<T>> {}

/**
 * The default row type is `any`, deliberately.
 *
 * supabase-js resolves an untyped `.from(...).select(...)` to `any`, and
 * all 33 call sites in this repo were written against that. Defaulting to
 * `Record<string, unknown>` here would be *more* correct in isolation and
 * would break every one of them, which is the wrong trade for a
 * compatibility shim. Pass a generic — `.from<JobRow>("jobs")` — where you
 * want real safety.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class QueryBuilder<T = any> implements PromiseLike<Result<T[]>> {
  private op: Op = "select"
  private columns = "*"
  private filters: Filter[] = []
  private payload: Record<string, unknown>[] = []
  private orderBy: Array<{ column: string; ascending: boolean; nullsFirst?: boolean }> = []
  private limitValue: number | null = null
  private rangeValue: { from: number; to: number } | null = null
  private wantSingle: "single" | "maybe" | null = null
  private selectOptions: SelectOptions = {}
  private upsertOptions: UpsertOptions = {}
  private returning = false
  private countMode: SelectOptions["count"] | null = null

  constructor(
    private readonly table: string,
    /** null = service role (no ownership injection). */
    private readonly userId: string | null,
    private readonly client?: PoolClient,
  ) {}

  // ------------------------------------------------------------------
  // Verbs
  // ------------------------------------------------------------------

  select(columns = "*", options: SelectOptions = {}): this {
    if (this.op === "select") {
      this.columns = columns
      this.selectOptions = options
      this.countMode = options.count ?? null
    } else {
      // .insert(...).select("id") — PostgREST's RETURNING.
      this.returning = true
      this.columns = columns
    }
    return this
  }

  /**
   * Accepts any object shape, like supabase-js.
   *
   * `Record<string, unknown>` would be stricter but rejects every typed
   * interface in this codebase — a declared `interface TriggerInsert`
   * has no index signature, so it is not assignable. Insisting on one
   * would mean editing call sites, which is exactly what this shim
   * exists to avoid.
   */
  insert<R extends object>(rows: R | R[]): this {
    this.op = "insert"
    this.payload = (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[]
    return this
  }

  upsert<R extends object>(rows: R | R[], options: UpsertOptions = {}): this {
    this.op = "upsert"
    this.payload = (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[]
    this.upsertOptions = options
    return this
  }

  update<R extends object>(values: R): this {
    this.op = "update"
    this.payload = [values as Record<string, unknown>]
    return this
  }

  delete(options: SelectOptions = {}): this {
    this.op = "delete"
    this.countMode = options.count ?? null
    return this
  }

  // ------------------------------------------------------------------
  // Filters
  // ------------------------------------------------------------------

  eq(column: string, value: unknown): this { return this.push(column, "=", value) }
  neq(column: string, value: unknown): this { return this.push(column, "<>", value) }
  gt(column: string, value: unknown): this { return this.push(column, ">", value) }
  gte(column: string, value: unknown): this { return this.push(column, ">=", value) }
  lt(column: string, value: unknown): this { return this.push(column, "<", value) }
  lte(column: string, value: unknown): this { return this.push(column, "<=", value) }
  like(column: string, pattern: string): this { return this.push(column, "like", pattern) }
  ilike(column: string, pattern: string): this { return this.push(column, "ilike", pattern) }
  in(column: string, values: unknown[]): this { return this.push(column, "in", values) }

  /**
   * PostgREST's .or("a.eq.1,b.ilike.%x%") — a disjunction of filters.
   *
   * The string is PARSED into columns, operators and bound parameters,
   * never spliced into SQL. That matters here more than anywhere else
   * in this file: the only call sites interpolate a search term that
   * originates in an agent tool call, i.e. ultimately from chat input.
   * Concatenating it would be a SQL injection with a language model
   * holding the needle.
   *
   * Anything this cannot parse — a nested group, an unknown operator,
   * a column name that is not a plain identifier — throws at build
   * time and surfaces as a query error. Fails closed, like rls.ts.
   */
  or(expression: string): this { return this.push("", "__or", expression) }
  contains(column: string, value: unknown): this { return this.push(column, "@>", value) }

  is(column: string, value: null | boolean): this {
    return this.push(column, "is", value)
  }

  /** `.not("email", "is", null)` — the only `not` form this codebase uses. */
  not(column: string, operator: string, value: unknown): this {
    if (operator === "is") return this.push(column, "is not", value)
    const negatable: Record<string, string> = { eq: "<>", neq: "=", gt: "<=", lt: ">=", in: "not in" }
    return this.push(column, negatable[operator] ?? `not ${operator}`, value)
  }

  /** `.match({ a: 1, b: 2 })` — sugar for chained eq. */
  match(criteria: Record<string, unknown>): this {
    for (const [k, v] of Object.entries(criteria)) this.push(k, "=", v)
    return this
  }

  order(column: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}): this {
    this.orderBy.push({
      column,
      ascending: opts.ascending !== false,
      nullsFirst: opts.nullsFirst,
    })
    return this
  }

  limit(n: number): this { this.limitValue = n; return this }
  range(from: number, to: number): this { this.rangeValue = { from, to }; return this }

  /** Resolves to one row, or an error when the count is not exactly 1. */
  single(): SingleResult<T> {
    this.wantSingle = "single"
    return this as unknown as SingleResult<T>
  }

  /** Resolves to one row or null — no error when nothing matched. */
  maybeSingle(): SingleResult<T | null> {
    this.wantSingle = "maybe"
    return this as unknown as SingleResult<T | null>
  }

  private push(column: string, operator: string, value: unknown): this {
    this.filters.push({ column, operator, value })
    return this
  }

  // ------------------------------------------------------------------
  // SQL
  // ------------------------------------------------------------------

  private build(): { text: string; values: unknown[] } {
    const values: unknown[] = []
    const p = (v: unknown) => `$${values.push(encode(v))}`
    const t = `public."${this.table}"`

    // UPDATE registers its SET parameters first and re-derives its own
    // WHERE below. Building the shared WHERE here too would push those
    // params twice and leave $1..$n referenced by nothing, which Postgres
    // rejects with "could not determine data type of parameter $1".
    const where: string[] = []
    if (this.op !== "update") for (const f of this.filters) {
      if (f.operator === "__or") {
        where.push(renderOrExpression(this.table, f.value as string, p))
        continue
      }
      const col = f.column.includes(".") ? quoteIdent(f.column) : `"${this.table}"."${f.column}"`
      if (f.operator === "in") {
        const list = (f.value as unknown[]) ?? []
        if (list.length === 0) { where.push("false"); continue }
        where.push(`${col} in (${list.map((v) => p(v)).join(",")})`)
      } else if (f.operator === "not in") {
        const list = (f.value as unknown[]) ?? []
        if (list.length === 0) continue
        where.push(`${col} not in (${list.map((v) => p(v)).join(",")})`)
      } else if (f.operator === "is") {
        where.push(f.value === null ? `${col} is null` : `${col} is ${f.value ? "true" : "false"}`)
      } else if (f.operator === "is not") {
        where.push(f.value === null ? `${col} is not null` : `${col} is not ${f.value ? "true" : "false"}`)
      } else {
        where.push(`${col} ${f.operator} ${p(f.value)}`)
      }
    }

    // The RLS replacement. Applied to every user-scoped statement.
    // (UPDATE appends its own copy after the SET params.)
    if (this.userId && this.op !== "insert" && this.op !== "upsert" && this.op !== "update") {
      where.push(ownershipPredicate(this.table, this.userId, p))
    }

    const whereSql = where.length ? ` where ${where.join(" and ")}` : ""
    const cols = this.columns === "*" ? "*" : this.columns.split(",").map((c) => quoteIdent(c.trim())).join(", ")

    switch (this.op) {
      case "select": {
        if (this.countMode && this.selectOptions.head) {
          return { text: `select count(*)::int as __count from ${t}${whereSql}`, values }
        }
        let sql = `select ${cols}${this.countMode ? ", count(*) over() ::int as __count" : ""} from ${t}${whereSql}`
        if (this.orderBy.length) {
          sql += ` order by ${this.orderBy
            .map((o) => {
              const dir = o.ascending ? "asc" : "desc"
              const nulls = o.nullsFirst === undefined ? "" : o.nullsFirst ? " nulls first" : " nulls last"
              return `${quoteIdent(o.column)} ${dir}${nulls}`
            })
            .join(", ")}`
        }
        if (this.rangeValue) {
          sql += ` limit ${this.rangeValue.to - this.rangeValue.from + 1} offset ${this.rangeValue.from}`
        } else if (this.limitValue !== null) {
          sql += ` limit ${this.limitValue}`
        }
        return { text: sql, values }
      }

      case "insert":
      case "upsert": {
        const rows = this.payload
        if (rows.length === 0) return { text: "select 1 where false", values }

        const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]
        const tuples = rows
          .map((r) => `(${keys.map((k) => p(r[k] ?? null)).join(",")})`)
          .join(", ")

        let sql =
          `insert into ${t} (${keys.map((k) => `"${k}"`).join(",")}) values ${tuples}`

        if (this.op === "upsert") {
          const conflict = (this.upsertOptions.onConflict ?? "id")
            .split(",").map((c) => `"${c.trim()}"`).join(",")
          sql += this.upsertOptions.ignoreDuplicates
            ? ` on conflict (${conflict}) do nothing`
            : ` on conflict (${conflict}) do update set ${keys
                .filter((k) => !(this.upsertOptions.onConflict ?? "id").split(",").map((c) => c.trim()).includes(k))
                .map((k) => `"${k}" = excluded."${k}"`)
                .join(", ") || `"${keys[0]}" = excluded."${keys[0]}"`}`
        }

        if (this.returning || this.wantSingle) sql += ` returning ${cols}`
        return { text: sql, values }
      }

      case "update": {
        const patch = this.payload[0] ?? {}
        const sets = Object.keys(patch)
        if (sets.length === 0) return { text: "select 1 where false", values }
        let sql = `update ${t} set ${sets.map((k) => `"${k}" = ${p(patch[k])}`).join(", ")}`
        // Re-derive WHERE: the SET params must be registered first.
        const where2: string[] = []
        for (const f of this.filters) {
          if (f.operator === "__or") {
            where2.push(renderOrExpression(this.table, f.value as string, p))
            continue
          }
          const col = f.column.includes(".") ? quoteIdent(f.column) : `"${this.table}"."${f.column}"`
          if (f.operator === "in") {
            const list = (f.value as unknown[]) ?? []
            if (list.length === 0) { where2.push("false"); continue }
            where2.push(`${col} in (${list.map((v) => p(v)).join(",")})`)
          } else if (f.operator === "is") {
            where2.push(f.value === null ? `${col} is null` : `${col} is ${f.value ? "true" : "false"}`)
          } else if (f.operator === "is not") {
            where2.push(f.value === null ? `${col} is not null` : `${col} is not ${f.value ? "true" : "false"}`)
          } else {
            where2.push(`${col} ${f.operator} ${p(f.value)}`)
          }
        }
        if (this.userId) where2.push(ownershipPredicate(this.table, this.userId, p))
        if (where2.length) sql += ` where ${where2.join(" and ")}`
        if (this.returning || this.wantSingle) sql += ` returning ${cols}`
        return { text: sql, values }
      }

      case "delete": {
        let sql = `delete from ${t}${whereSql}`
        if (this.returning || this.wantSingle) sql += ` returning ${cols}`
        return { text: sql, values }
      }
    }
  }

  // ------------------------------------------------------------------
  // Execution — the builder is awaited directly, like supabase-js
  // ------------------------------------------------------------------

  private async execute(): Promise<Result<unknown>> {
    try {
      // Tables whose original policy was `for select` only. Checked
      // before anything is built, so a user-scoped write never reaches
      // the database at all.
      if (this.userId && this.op !== "select") {
        const denied = writeDenied(this.table)
        if (denied) return { data: null, error: { message: denied, code: "42501" } }
      }

      // INSERT/UPSERT ownership is a WITH CHECK, not a WHERE.
      if ((this.op === "insert" || this.op === "upsert") && this.userId) {
        const checked: Record<string, unknown>[] = []
        for (const row of this.payload) {
          const verdict = insertOwnershipCheck(this.table, row, this.userId)
          if (!verdict.ok) {
            return { data: null, error: { message: verdict.reason, code: "42501" } }
          }
          checked.push(verdict.row)
        }
        this.payload = checked

        // Parent-owned insert: verify the parent belongs to this user.
        const guard = await this.verifyParentOwnership()
        if (guard) return { data: null, error: guard }
      }

      const { text, values } = this.build()
      const runner = this.client ?? getPool()
      const res = await runner.query(text, values as never[])

      let count: number | null = null
      let rows = res.rows as Record<string, unknown>[]
      if (this.countMode) {
        count = rows.length > 0 ? ((rows[0].__count as number) ?? 0) : 0
        if (this.selectOptions.head) rows = []
        else rows = rows.map(({ __count, ...rest }) => rest)
      }
      if (this.op === "delete" && this.countMode) count = res.rowCount ?? 0

      if (this.wantSingle) {
        if (rows.length === 0) {
          return this.wantSingle === "maybe"
            ? { data: null, error: null, count }
            : {
                data: null,
                error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
                count,
              }
        }
        if (rows.length > 1) {
          return {
            data: null,
            error: { message: `Expected 1 row, got ${rows.length}`, code: "PGRST116" },
            count,
          }
        }
        return { data: rows[0], error: null, count }
      }

      return { data: rows, error: null, count }
    } catch (err) {
      if (err instanceof RowSecurityError) {
        return { data: null, error: { message: err.message, code: "42501" } }
      }
      const e = err as { message: string; code?: string; detail?: string; hint?: string }
      return {
        data: null,
        error: { message: e.message, code: e.code, details: e.detail, hint: e.hint },
      }
    }
  }

  /** Parent-owned INSERT: confirm the referenced parent is the user's. */
  private async verifyParentOwnership(): Promise<PgError | null> {
    const { OWNERSHIP } = await import("./rls")
    const rule = OWNERSHIP[this.table]
    if (!rule || rule.kind !== "parent" || !this.userId) return null

    const ids = [...new Set(this.payload.map((r) => r[rule.localKey]).filter(Boolean))]
    if (ids.length === 0) return null

    const runner = this.client ?? getPool()
    const ph = ids.map((_, i) => `$${i + 1}`).join(",")
    const { rows } = await runner.query(
      `select count(*)::int c from public."${rule.parentTable}"
        where "${rule.parentKey}" in (${ph}) and "${rule.parentOwner}" = $${ids.length + 1}`,
      [...ids, this.userId] as never[],
    )
    if ((rows[0]?.c ?? 0) !== ids.length) {
      return {
        message: `row security: ${this.table}.${rule.localKey} does not belong to the session user`,
        code: "42501",
      }
    }
    return null
  }

  then<R1 = Result<T[]>, R2 = never>(
    onfulfilled?: ((value: Result<T[]>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled as never, onrejected)
  }
}
