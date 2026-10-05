#!/usr/bin/env bash
# migration-2026-10-05-employee-english-name.sql against a throwaway database: each
# kind of existing name ends up where it should, mixed ones are left for a person,
# preview mode changes nothing, a second run changes nothing (and keeps later edits),
# and the undo in the file's header works. Needs a local Postgres
# (PGHOST/PGPORT/PGUSER as for the other tests/sql scripts).
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=enname_test
MIG=supabase/migration-2026-10-05-employee-english-name.sql
P="psql -v ON_ERROR_STOP=1 -q -X -At"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }
$P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$P -d $DB -c "create table employees (id uuid primary key default gen_random_uuid(), name text not null, trigo_id text, created_at timestamptz default now())" >/dev/null

# before | expected Thai column | expected English column   (blank expected = no change / NULL)
# status: T = Thai only, E = English only (both columns), S = split, M = manual (untouched)
CASES=$(cat <<'CASES'
สมชาย ใจดี|T|สมชาย ใจดี|
Somchai Jaidee|E|Somchai Jaidee|Somchai Jaidee
Wannaphat|E|Wannaphat|Wannaphat
สมชาย ใจดี (Somchai Jaidee)|S|สมชาย ใจดี|Somchai Jaidee
สมชาย ใจดี Somchai Jaidee|S|สมชาย ใจดี|Somchai Jaidee
Somchai Jaidee สมชาย ใจดี|S|สมชาย ใจดี|Somchai Jaidee
Somchai Jaidee (สมชาย ใจดี)|S|สมชาย ใจดี|Somchai Jaidee
สมชาย ใจดี / Somchai Jaidee|S|สมชาย ใจดี|Somchai Jaidee
สมชาย ใจดี - Somchai Jaidee|S|สมชาย ใจดี|Somchai Jaidee
  สมชาย   ใจดี   [Somchai  Jaidee]  |S|สมชาย ใจดี|Somchai Jaidee
สมชาย Somchai ใจดี|M|สมชาย Somchai ใจดี|
Somchai สมชาย Jaidee|M|Somchai สมชาย Jaidee|
สมชายSomchai ใจดี|M|สมชายSomchai ใจดี|
สมชาย ใจดี Somchai 2|M|สมชาย ใจดี Somchai 2|
12345|N|12345|
Anan P.|E|Anan P.|Anan P.
ปัญญา นาลาด|T|ปัญญา นาลาด|
CASES
)
while IFS='|' read -r before kind th en; do
  [ -z "$before" ] && continue
  $P -d $DB -c "insert into employees(name) values ('${before//\'/\'\'}')" >/dev/null
done <<< "$CASES"
N=$($P -d $DB -c "select count(*) from employees")

# --- preview: nothing changes, not even the column name ---
sed 's/select true as apply/select false as apply/' $MIG | $P -d $DB -f - >/dev/null
[ "$($P -d $DB -c "select count(*) from information_schema.columns where table_name='employees' and column_name='name'")" = 1 ] || fail "preview renamed the column"
[ "$($P -d $DB -c "select count(*) from information_schema.columns where table_name='employees' and column_name='name_en'")" = 0 ] || fail "preview added a column"
[ "$($P -d $DB -c "select count(*) from employees_name_backup_en")" = 0 ] || fail "preview wrote a backup"
ok "preview (apply = false) changes nothing"
# the preview's report names the right kinds
REP=$(sed 's/select true as apply/select false as apply/' $MIG | $P -d $DB -F'|' -f - | grep -c "^would " || true)
[ "$REP" -gt 0 ] || fail "preview report is empty"

# --- apply ---
$P -d $DB -f $MIG >/dev/null 2>&1 || fail "apply failed"
check() {  # expected rows, as 'before|th|en' lines, against the table + backup
  local want got
  want=$(while IFS='|' read -r before kind th en; do
    [ -z "$before" ] && continue
    case $kind in M) th="$before"; en="";; esac
    case $kind in T) th="$before"; en="";; esac
    case $kind in N) th="$before"; en="";; esac
    case $kind in E) th=$(echo "$before" | sed 's/  */ /g;s/^ //;s/ $//'); en="$th";; esac
    # backup holds the untouched original; compare on whitespace-normalised text
    echo "$(echo "$before" | tr -s ' ' | sed 's/^ //;s/ $//')|$th|$en"
  done <<< "$CASES" | sort)
  got=$($P -d $DB -F'|' -c "select regexp_replace(btrim(b.old_name), '\s+', ' ', 'g'), e.name_th, coalesce(e.name_en, '') from employees e join employees_name_backup_en b on b.employee_id = e.id order by 1,2,3" | sort)
  [ "$want" = "$got" ] || { echo "--- want"; echo "$want"; echo "--- got"; echo "$got"; fail "$1"; }
}
check "names are not where they should be after the first run"
[ "$($P -d $DB -c "select count(*) from information_schema.columns where table_name='employees' and column_name='name'")" = 0 ] || fail "old column still there"
[ "$($P -d $DB -c "select count(*) from employees_name_backup_en")" = "$N" ] || fail "backup is not one row per employee"
ok "Thai stays, English goes to both columns, mixed names are split, odd ones are left for a person ($N names)"

# --- a person edits a name, then the migration is run again: nothing is touched ---
$P -d $DB -c "update employees set name_th = 'ปรับแก้แล้ว' where name_th = 'Somchai Jaidee' and name_en = 'Somchai Jaidee' and id = (select id from employees where name_th = 'Somchai Jaidee' limit 1)" >/dev/null
$P -d $DB -c "insert into employees(name_th) values ('Newcomer')" >/dev/null   # added after the migration, no English yet
BEFORE=$($P -d $DB -F'|' -c "select name_th, coalesce(name_en,'') from employees order by 1,2")
$P -d $DB -f $MIG >/dev/null 2>&1 || fail "second run failed"
AFTER=$($P -d $DB -F'|' -c "select name_th, coalesce(name_en,'') from employees order by 1,2")
echo "$AFTER" | grep -q "^ปรับแก้แล้ว|Somchai Jaidee$" || fail "a later edit was lost"
echo "$AFTER" | grep -q "^Newcomer|Newcomer$" || fail "a new English-only employee was not handled on re-run"
# the earlier ones are unchanged
[ "$(echo "$BEFORE" | grep -v Newcomer)" = "$(echo "$AFTER" | grep -v Newcomer)" ] || fail "a re-run changed people who were already handled"
ok "re-run changes nothing for people already handled (later edits kept)"
$P -d $DB -c "delete from employees where name_th = 'Newcomer'" >/dev/null

# --- the undo from the file's header ---
$P -d $DB -c "update employees e set name_th = b.old_name, name_en = null from employees_name_backup_en b where b.employee_id = e.id" >/dev/null
GOT=$($P -d $DB -c "select count(*) from employees e join employees_name_backup_en b on b.employee_id = e.id where e.name_th = b.old_name and e.name_en is null")
[ "$GOT" = "$N" ] || fail "undo did not restore every name"
ok "the undo restores every name"
$P -d postgres -c "drop database $DB" >/dev/null
