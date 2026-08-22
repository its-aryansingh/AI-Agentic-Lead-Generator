#!/usr/bin/env node
/**
 * Regenerates supabase/FULL_SCHEMA_DEPLOY.sql from supabase/migrations/.
 *
 * The consolidated file is the fallback path for applying the schema when
 * the Supabase CLI is not available — paste it into the dashboard SQL
 * editor. It was previously hand-assembled, which meant it silently drifted
 * from the migrations it claims to mirror.
 *
 * Run: npm run db:bundle
 *
 * Only *.sql is included, in filename order. `.bak` files are skipped by
 * design (see 00000000000004_sequences_sending.sql.bak — superseded by
 * _00005_sequences and _00007_sending).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const migrationsDir = join(root, "supabase", "migrations")
const outFile = join(root, "supabase", "FULL_SCHEMA_DEPLOY.sql")

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()

if (files.length === 0) {
  console.error("no migrations found in", migrationsDir)
  process.exit(1)
}

const parts = [
  "-- LeadGenAI Complete Database Schema",
  "-- GENERATED FILE — do not edit by hand.",
  "-- Regenerate with: npm run db:bundle",
  `-- Source: supabase/migrations/ (${files.length} files)`,
  "--",
  "-- Every statement is idempotent, so this is safe to paste more than once.",
  "-- Prefer `npm run db:push` when the Supabase CLI is available; this file",
  "-- exists for the dashboard SQL-editor path.",
  "",
]

for (const f of files) {
  parts.push(
    "",
    "-- ==========================================",
    `-- Migration: ${f}`,
    "-- ==========================================",
    "",
    readFileSync(join(migrationsDir, f), "utf8").trimEnd(),
    "",
  )
}

writeFileSync(outFile, parts.join("\n") + "\n", "utf8")
console.log(`bundled ${files.length} migrations -> supabase/FULL_SCHEMA_DEPLOY.sql`)
