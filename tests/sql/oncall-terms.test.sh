#!/usr/bin/env bash
# migration-2026-11-27-oncall-terms.sql against a throwaway database built from schema.sql
# without the column: it adds employees.oncall_terms, existing people are left as they were
# (NULL = not set), only 'daily', 'monthly' or NULL is accepted, a second run changes nothing,
# and the undo in the file's header works. Also checks schema.sql carries the same column and
# rule. Needs a local Postgres (PGHOST/PGPORT/PGUSER as for the other tests/sql scripts).
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=oncall_terms_test
MIG=supabase/migration-2026-11-27-oncall-terms.sql
P="psql -v ON_ERROR_STOP=1 -q -X -At"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }
$P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
# a roster as it is before the migration
$P -d $DB -c "create table employees (id text primary key, name_th text not null, contract text not null check (contract in ('permanent', 'oncall')))" \
  -c "insert into employees values ('p1', 'สมชาย ใจดี', 'permanent'), ('o1', 'มาลี สุขใจ', 'oncall')" >/dev/null

$P -d $DB -f $MIG >/dev/null
[ "$($P -d $DB -c "select count(*) from employees where oncall_terms is null")" = 2 ] || fail "existing people should start as not set"
ok "adds the column; existing people start as not set"

$P -d $DB -c "update employees set oncall_terms = 'daily' where id = 'o1'" >/dev/null
$P -d $DB -c "update employees set oncall_terms = 'monthly' where id = 'o1'" >/dev/null
$P -d $DB -c "update employees set oncall_terms = null where id = 'o1'" >/dev/null
if $P -d $DB -c "update employees set oncall_terms = 'weekly' where id = 'o1'" >/dev/null 2>&1; then fail "'weekly' should be refused"; fi
if $P -d $DB -c "update employees set oncall_terms = 'Daily' where id = 'o1'" >/dev/null 2>&1; then fail "'Daily' (capital) should be refused"; fi
ok "accepts daily, monthly and NULL; refuses anything else"

$P -d $DB -c "update employees set oncall_terms = 'monthly' where id = 'o1'" >/dev/null
$P -d $DB -f $MIG >/dev/null
[ "$($P -d $DB -c "select oncall_terms from employees where id = 'o1'")" = monthly ] || fail "a second run should keep what is stored"
ok "safe to re-run: a stored term is kept"

$P -d $DB -c "alter table employees drop column oncall_terms" >/dev/null
[ "$($P -d $DB -c "select count(*) from information_schema.columns where table_name = 'employees' and column_name = 'oncall_terms'")" = 0 ] || fail "undo"
ok "the undo in the header removes the column"

# schema.sql: a fresh database has the same column and rule
$P -d postgres -c "drop database $DB" -c "create database $DB" >/dev/null
$P -d $DB -f tests/sql/supabase-shim.sql >/dev/null 2>&1
PGOPTIONS='-c client_min_messages=warning' $P -d $DB -f supabase/schema.sql >/dev/null
if $P -d $DB -c "insert into boards (id, name) values (gen_random_uuid(), 'B') returning id" >/dev/null 2>&1; then :; fi
BID=$($P -d $DB -c "select id from boards limit 1")
$P -d $DB -c "insert into employees (name_th, contract, oncall_terms, board_id) values ('ก ข', 'oncall', 'daily', '$BID')" >/dev/null
if $P -d $DB -c "insert into employees (name_th, contract, oncall_terms, board_id) values ('ค ง', 'oncall', 'yearly', '$BID')" >/dev/null 2>&1; then fail "schema.sql should refuse 'yearly'"; fi
ok "schema.sql carries the column and the same rule"
$P -d postgres -c "drop database $DB" >/dev/null
