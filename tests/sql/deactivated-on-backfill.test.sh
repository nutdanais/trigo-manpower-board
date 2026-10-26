#!/usr/bin/env bash
# migration-2026-10-26 (employees.deactivated_on) and migration-2026-10-26b (its back-fill)
# against a throwaway database built from schema.sql: the column is added to an older
# schema and a re-run is harmless; the back-fill's preview changes nothing; each kind of
# deactivated person gets the date the script's header promises; people already dated and
# people still active are left alone; a second run changes nothing; and the undo in the
# header restores every row. Needs a local Postgres (PGHOST/PGPORT/PGUSER as for the other
# tests/sql scripts). Fixtures are fake names.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=deactivated_on_test
export PGOPTIONS='-c client_min_messages=warning'
MIG=supabase/migration-2026-10-26-deactivated-on.sql
BACKFILL=supabase/migration-2026-10-26b-deactivated-on-backfill.sql
P="psql -v ON_ERROR_STOP=1 -q -X -At"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }
q() { $P -d $DB -c "$1"; }
bash tests/sql/setup-db.sh $DB --base-only >/dev/null

# an older database: no column yet; the migration adds it, and running it again is harmless
q "alter table employees drop column deactivated_on" >/dev/null
$P -d $DB -f $MIG >/dev/null
$P -d $DB -f $MIG >/dev/null
[ "$(q "select count(*) from information_schema.columns where table_name = 'employees' and column_name = 'deactivated_on'")" = 1 ] \
  || fail "the migration did not add employees.deactivated_on"
ok "the migration adds deactivated_on to an older schema, and a re-run is harmless"

TODAY=$(q "select (now() at time zone 'Asia/Bangkok')::date")
d() { q "select ('$TODAY'::date + ($1))"; }   # a date relative to today

B1='10000000-0000-0000-0000-000000000001'
e() { echo "20000000-0000-0000-0000-0000000000$1"; }
q "insert into boards (id, name) values ('$B1', 'Board One')" >/dev/null
q "insert into employees (id, name_th, contract, board_id, active, added_on, deactivated_on, created_at) values
  ('$(e 01)', 'Perm left long ago',  'permanent', '$B1', false, null,         null,              now() - interval '90 days'),
  ('$(e 02)', 'Oncall left recently','oncall',    '$B1', false, null,         null,              now() - interval '90 days'),
  ('$(e 03)', 'Placeholder no date', 'oncall',    '$B1', false, null,         null,              now() - interval '40 days'),
  ('$(e 04)', 'Placeholder dated',   'oncall',    '$B1', false, '$(d -20)',   null,              now() - interval '40 days'),
  ('$(e 05)', 'Has a place today',   'oncall',    '$B1', false, null,         null,              now() - interval '90 days'),
  ('$(e 06)', 'Still active',        'permanent', '$B1', true,  null,         null,              now() - interval '90 days'),
  ('$(e 07)', 'Already dated',       'permanent', '$B1', false, null,         '$(d -5)',         now() - interval '90 days')" >/dev/null
q "insert into missions (id, board_id, plan_date, number, host, customer, shift)
   select ('30000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, '$B1', ('$TODAY'::date + off), '1', 'H', 'C', 'day'
     from (values (1, -60), (2, -50), (3, -3), (4, 0)) v(n, off)" >/dev/null
a() { q "insert into assignments (employee_id, plan_date, mission_id) values ('$(e $1)', '$TODAY'::date + $2, '30000000-0000-0000-0000-0000000000$3')" >/dev/null; }
a 01 -60 01; a 01 -50 02          # last place 50 days ago
a 02 -50 02; a 02 -3 03           # last place 3 days ago
a 05 -3 03;  a 05 0 04            # a place today
a 06 -3 03;  a 06 0 04            # active: never touched
a 07 -50 02                       # already dated: never touched

snapshot() { q "select name_th || '|' || coalesce(added_on::text, '-') || '|' || coalesce(deactivated_on::text, '-') from employees order by name_th" | tr '\n' ';'; }
BEFORE=$(snapshot)

# ---- preview (the file as shipped): nothing is changed, five people are reported
REPORT=$($P -d $DB -f $BACKFILL)
[ "$(snapshot)" = "$BEFORE" ] || fail "the preview changed employees"
[ "$(q "select count(*) from employees_deactivated_on_backup")" = 0 ] || fail "the preview wrote backup rows"
[ "$(echo "$REPORT" | grep -c '^would set|')" = 5 ] || fail "the preview should report 5 people, got: $REPORT"
ok "the preview reports five people and changes nothing"

# ---- apply
sed 's/select false as apply/select true as apply/' $BACKFILL > /tmp/_deactivated_on_apply.sql
REPORT=$($P -d $DB -f /tmp/_deactivated_on_apply.sql)
[ "$(echo "$REPORT" | grep -c '^set|')" = 5 ] || fail "apply should report 5 people set, got: $REPORT"
got() { q "select coalesce(added_on::text, '-') || '|' || coalesce(deactivated_on::text, '-') from employees where name_th = '$1'"; }
check() { [ "$(got "$1")" = "$2" ] || fail "$1: expected $2, got $(got "$1")"; }
check "Perm left long ago"   "-|$(d -49)"                      # the day after the last place
check "Oncall left recently" "-|$(d -2)"
check "Has a place today"    "-|$TODAY"                        # keeps today as the board shows it
check "Placeholder dated"    "$(d -20)|$(d -20)"               # never on a plan: counted on no day
CREATED=$(q "select (created_at at time zone 'Asia/Bangkok')::date from employees where name_th = 'Placeholder no date'")
check "Placeholder no date"  "$CREATED|$CREATED"               # added_on filled from the row's creation day
check "Still active"         "-|-"
check "Already dated"        "-|$(d -5)"
[ "$(q "select count(*) from employees_deactivated_on_backup")" = 5 ] || fail "expected 5 backup rows"
ok "each kind of person gets the date the header promises; active and already-dated people are left alone"

# ---- a second run has nothing left to do
AFTER=$(snapshot)
REPORT=$($P -d $DB -f /tmp/_deactivated_on_apply.sql)
[ -z "$REPORT" ] || fail "a second run should report nobody, got: $REPORT"
[ "$(snapshot)" = "$AFTER" ] || fail "a second run changed employees"
ok "a second run changes nothing"

# ---- the undo from the file's header puts everything back
q "update employees e set deactivated_on = b.old_deactivated_on, added_on = b.old_added_on
     from employees_deactivated_on_backup b where b.employee_id = e.id" >/dev/null
[ "$(snapshot)" = "$BEFORE" ] || fail "the undo did not restore every row"
ok "the undo restores every row"

# ---- the date rule the app uses, on the same data: counted on days before deactivated_on
q "update employees set deactivated_on = '$(d -49)' where name_th = 'Perm left long ago'" >/dev/null
[ "$(q "select count(*) from employees where name_th = 'Perm left long ago' and ('$(d -50)'::date < deactivated_on)")" = 1 ] || fail "a day before the date should count"
[ "$(q "select count(*) from employees where name_th = 'Perm left long ago' and ('$(d -49)'::date < deactivated_on)")" = 0 ] || fail "the date itself should not count"
ok "counted on the days before the date, not on it"

rm -f /tmp/_deactivated_on_apply.sql
echo "all deactivated-on checks passed"
