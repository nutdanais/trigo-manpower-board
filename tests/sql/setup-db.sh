#!/usr/bin/env bash
# Build a throwaway local database from schema.sql (+ the column migrations
# schema.sql doesn't carry yet) and, unless --base-only, the forward-planning
# migration. Usage: tests/sql/setup-db.sh <dbname> [--base-only]
# Needs a local Postgres; PGHOST/PGPORT/PGUSER select it.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="$1"
export PGOPTIONS='-c client_min_messages=warning'
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB"
$P -d "$DB" -f tests/sql/supabase-shim.sql 2>/dev/null
$P -d "$DB" -f supabase/schema.sql
for f in migration-2026-08-23-updated-by migration-2026-08-23-employee-active migration-2026-09-17-orgchart; do
  $P -d "$DB" -f "supabase/$f.sql"
done
if [ "${2:-}" != "--base-only" ]; then
  $P -d "$DB" -f supabase/migration-2026-09-24-forward-planning.sql
fi
