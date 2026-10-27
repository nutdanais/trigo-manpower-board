#!/usr/bin/env bash
# migration-2026-10-27 (employee_loans_no_overlap) against a throwaway database built
# from schema.sql: on an older database it stops, changing nothing, while two loans of
# one person on different boards share a day, and names them; once those are sorted it
# keeps the newest of each exact duplicate (Lend clicked twice) and leaves other loans
# alone; a re-run is harmless; and from then on an overlapping loan is refused while the
# next day, or someone else on the same days, is fine. Needs a local Postgres
# (PGHOST/PGPORT/PGUSER as for the other tests/sql scripts). Fixtures are fake names.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=loans_no_overlap_test
export PGOPTIONS='-c client_min_messages=warning'
MIG=supabase/migration-2026-10-27-loans-no-overlap.sql
P="psql -v ON_ERROR_STOP=1 -q -X -At"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }
q() { $P -d $DB -c "$1"; }
bash tests/sql/setup-db.sh $DB >/dev/null

# schema.sql carries the rule for a new database
[ "$(q "select count(*) from pg_constraint where conname = 'employee_loans_no_overlap'")" = 1 ] \
  || fail "schema.sql does not add employee_loans_no_overlap"
ok "a new database gets the rule from schema.sql"

# an older database: the table without the rule
q "alter table employee_loans drop constraint employee_loans_no_overlap" >/dev/null

B() { echo "10000000-0000-0000-0000-00000000000$1"; }
E() { echo "20000000-0000-0000-0000-00000000000$1"; }
q "insert into boards (id, name) values ('$(B 1)', 'Board One'), ('$(B 2)', 'Board Two'), ('$(B 3)', 'Board Three')" >/dev/null
q "insert into employees (id, name_th, contract, board_id) values
  ('$(E 1)', 'Clicked twice', 'permanent', '$(B 1)'),
  ('$(E 2)', 'Two loans in a row', 'permanent', '$(B 1)'),
  ('$(E 3)', 'Two boards same day', 'permanent', '$(B 1)')" >/dev/null
q "insert into employee_loans (id, employee_id, to_board_id, start_date, end_date, note, created_at) values
  ('30000000-0000-0000-0000-000000000001', '$(E 1)', '$(B 2)', '2026-10-27', '2026-11-30', 'first',  '2026-10-27 08:00:00+07'),
  ('30000000-0000-0000-0000-000000000002', '$(E 1)', '$(B 2)', '2026-10-27', '2026-11-30', 'second', '2026-10-27 08:00:01+07'),
  ('30000000-0000-0000-0000-000000000003', '$(E 1)', '$(B 2)', '2026-10-27', '2026-11-30', 'first',  '2026-10-27 08:00:00+07'),
  ('30000000-0000-0000-0000-000000000004', '$(E 2)', '$(B 2)', '2026-10-27', '2026-10-31', null,     '2026-10-26 09:00:00+07'),
  ('30000000-0000-0000-0000-000000000005', '$(E 2)', '$(B 3)', '2026-11-01', '2026-11-05', null,     '2026-10-26 09:00:00+07'),
  ('30000000-0000-0000-0000-000000000006', '$(E 3)', '$(B 2)', '2026-10-27', '2026-10-31', null,     '2026-10-26 09:00:00+07'),
  ('30000000-0000-0000-0000-000000000007', '$(E 3)', '$(B 3)', '2026-10-30', '2026-11-02', null,     '2026-10-26 10:00:00+07')" >/dev/null

snapshot() { q "select id || '|' || start_date || '|' || end_date from employee_loans order by id" | tr '\n' ';'; }
BEFORE=$(snapshot)

# ---- a real overlap (two boards on the same days): stops, names it, changes nothing
if OUT=$($P -d $DB -f $MIG 2>&1); then fail "the migration ran with an overlap left"; fi
echo "$OUT" | grep -q "Overlapping loans found; nothing was changed" || fail "no clear message: $OUT"
echo "$OUT" | grep -q "Two boards same day: → Board Two 2026-10-27–2026-10-31 and → Board Three 2026-10-30–2026-11-02" \
  || fail "the message does not name the overlap: $OUT"
echo "$OUT" | grep -q "Clicked twice" && fail "exact duplicates are not for a person to sort: $OUT"
[ "$(snapshot)" = "$BEFORE" ] || fail "the stopped migration changed loans (duplicates removed?)"
[ "$(q "select count(*) from pg_constraint where conname = 'employee_loans_no_overlap'")" = 0 ] || fail "the rule was added anyway"
ok "an overlap on two boards stops it, names the person and dates, and changes nothing"

# ---- sorted out in the app: the duplicates go, the newest kept, the rest untouched
q "update employee_loans set start_date = '2026-11-01' where id = '30000000-0000-0000-0000-000000000007'" >/dev/null
$P -d $DB -f $MIG >/dev/null
[ "$(q "select string_agg(note, ',') from employee_loans where employee_id = '$(E 1)'")" = "second" ] \
  || fail "the newest duplicate should be the one kept"
[ "$(q "select count(*) from employee_loans where employee_id in ('$(E 2)', '$(E 3)')")" = 4 ] || fail "loans that don't overlap were touched"
[ "$(q "select count(*) from pg_constraint where conname = 'employee_loans_no_overlap'")" = 1 ] || fail "the rule was not added"
ok "exact duplicates keep the newest row, other loans are untouched, the rule is added"

AFTER=$(snapshot)
$P -d $DB -f $MIG >/dev/null
[ "$(snapshot)" = "$AFTER" ] || fail "a re-run changed loans"
ok "a re-run is harmless"

# ---- the rule
refused() {
  local out
  if out=$(q "$1" 2>&1); then fail "$2 was accepted"; fi
  echo "$out" | grep -q employee_loans_no_overlap || fail "$2: refused for another reason: $out"
}
refused "insert into employee_loans (employee_id, to_board_id, start_date, end_date) values ('$(E 1)', '$(B 2)', '2026-10-27', '2026-11-30')" "the same loan again"
refused "insert into employee_loans (employee_id, to_board_id, start_date, end_date) values ('$(E 1)', '$(B 3)', '2026-11-30', '2026-11-30')" "a loan on its last day"
refused "update employee_loans set end_date = '2026-11-01' where id = '30000000-0000-0000-0000-000000000004'" "stretching a loan into the next one"
q "insert into employee_loans (employee_id, to_board_id, start_date, end_date) values ('$(E 1)', '$(B 3)', '2026-12-01', '2026-12-01')" >/dev/null
q "insert into employee_loans (employee_id, to_board_id, start_date, end_date) values ('$(E 2)', '$(B 2)', '2026-11-10', '2026-11-30')" >/dev/null
ok "an overlapping loan is refused; the next day, or someone else on the same days, is fine"

psql -q -X -d postgres -c "drop database $DB" >/dev/null
echo "all loans-no-overlap checks passed"
