#!/usr/bin/env bash
# Bootstrap a Railway PostgreSQL database for LeadGenAI.
#
#   DATABASE_URL="postgresql://..." bash db/setup-railway-db.sh
#
# The URL is Railway → Postgres service → Connect → "Postgres Connection URL".
# Safe to re-run: every migration is idempotent.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set." >&2
  echo "Railway -> Postgres service -> Connect -> Postgres Connection URL" >&2
  exit 1
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/migrations"

for f in 0000_base_schema 0001_enrichment_runs 0002_auth; do
  printf '  %-26s ' "$f.sql"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$DIR/$f.sql"
  echo "ok"
done

echo
echo "--- verification ---"
psql "$DATABASE_URL" -tA <<'SQL'
select 'tables:            ' || count(*) from information_schema.tables where table_schema='public'
union all select 'RLS policies:      ' || count(*) || '  (expect 0)' from pg_policies where schemaname='public'
union all select 'RLS-enabled tables:' || count(*) || '  (expect 0)' from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity
union all select 'users credentials: ' || count(*) || '  (expect 2)' from information_schema.columns
  where table_name='users' and column_name in ('password_hash','google_sub')
union all select 'enrichment_runs:   ' || count(*) || '  (expect 1)' from information_schema.tables
  where table_schema='public' and table_name='enrichment_runs';
SQL

echo
echo "Database ready. Next:"
echo "  DATABASE_URL=\"\$DATABASE_URL\" npm run test:integration    # 32 must pass"
