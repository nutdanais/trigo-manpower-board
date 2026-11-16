#!/usr/bin/env bash
# migration-2026-11-16 (missions.lead_employee_id: the head of a mission's crew) against a
# throwaway database built from schema.sql. Checks: a new database gets the column and both
# triggers from schema.sql; on an older database the migration adds them and a re-run keeps a head
# already set; a head must be on the mission that day; moving the head to another mission, to
# leave or deleting their assignment clears it, while moving someone else does not; deleting the
# mission or the employee works. Needs a local Postgres (PGHOST/PGPORT/PGUSER as for the other
# tests/sql scripts). Fixtures are fake.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=mission_crew_head_test
export PGOPTIONS='-c client_min_messages=warning'
MIG=supabase/migration-2026-11-16-mission-crew-head.sql
P="psql -v ON_ERROR_STOP=1 -q -X -At"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }
q() { $P -d $DB -c "$1"; }
eq() { local got; got="$(q "$1")"; [ "$got" = "$2" ] || fail "$3 (expected '$2', got '$got')"; ok "$3"; }
refused() { if q "$1" >/dev/null 2>&1; then fail "$2 (was accepted)"; fi; ok "$2"; }
bash tests/sql/setup-db.sh $DB >/dev/null

COL="select count(*) from information_schema.columns where table_name = 'missions' and column_name = 'lead_employee_id'"
TRG="select count(*) from pg_trigger where tgname in ('missions_lead_on_crew', 'assignments_clear_mission_lead')"
eq "$COL" 1 "schema.sql adds missions.lead_employee_id"
eq "$TRG" 2 "schema.sql adds both triggers"

# ---------- an older database: no column yet ----------
q "drop trigger missions_lead_on_crew on missions; drop trigger assignments_clear_mission_lead on assignments;
   drop function public.check_mission_lead(); drop function public.clear_mission_lead();
   alter table missions drop column lead_employee_id" >/dev/null
eq "$COL" 0 "an older database has no lead_employee_id"
$P -d $DB -f $MIG >/dev/null
eq "$COL" 1 "the migration adds the column"
eq "$TRG" 2 "the migration adds both triggers"

# ---------- a board, three people, two missions on one day ----------
BRD=10000000-0000-0000-0000-000000000001
M1=30000000-0000-0000-0000-000000000001
M2=30000000-0000-0000-0000-000000000002
E1=40000000-0000-0000-0000-000000000001
E2=40000000-0000-0000-0000-000000000002
E3=40000000-0000-0000-0000-000000000003
D=2026-11-17
q "insert into boards (id, name) values ('$BRD', 'Test board');
   insert into employees (id, name_th, contract, board_id) values
     ('$E1', 'Somsak Test', 'permanent', '$BRD'), ('$E2', 'Wanna Test', 'permanent', '$BRD'), ('$E3', 'Anucha Test', 'permanent', '$BRD');
   insert into missions (id, board_id, plan_date, number, host, customer, shift) values
     ('$M1', '$BRD', '$D', 'T-101', 'Host A', 'Customer A', 'day'),
     ('$M2', '$BRD', '$D', 'T-102', 'Host B', 'Customer B', 'day');
   insert into assignments (employee_id, plan_date, mission_id) values
     ('$E1', '$D', '$M1'), ('$E2', '$D', '$M1'), ('$E3', '$D', '$M2');" >/dev/null
LEAD="select coalesce(lead_employee_id::text, 'none') from missions where id = '$M1'"

eq "$LEAD" none "a mission starts with no head"
q "update missions set lead_employee_id = '$E1' where id = '$M1'" >/dev/null
eq "$LEAD" "$E1" "a crew member becomes the head"
refused "update missions set lead_employee_id = '$E3' where id = '$M1'" "someone on another mission cannot be its head"
eq "$LEAD" "$E1" "the refused change leaves the head as it was"
q "update missions set lead_employee_id = '$E2' where id = '$M1'" >/dev/null
eq "$LEAD" "$E2" "a new head replaces the old one"
$P -d $DB -f $MIG >/dev/null
eq "$LEAD" "$E2" "a re-run keeps the head"

q "update assignments set mission_id = '$M2' where employee_id = '$E1' and plan_date = '$D'" >/dev/null
eq "$LEAD" "$E2" "moving another crew member leaves the head alone"
q "update assignments set mission_id = '$M2' where employee_id = '$E2' and plan_date = '$D'" >/dev/null
eq "$LEAD" none "moving the head to another mission clears it"

q "update assignments set mission_id = '$M1' where employee_id = '$E2' and plan_date = '$D';
   update missions set lead_employee_id = '$E2' where id = '$M1'" >/dev/null
q "update assignments set mission_id = null, zone = 'annual' where employee_id = '$E2' and plan_date = '$D'" >/dev/null
eq "$LEAD" none "sending the head on leave clears it"

q "update assignments set mission_id = '$M1', zone = null where employee_id = '$E2' and plan_date = '$D';
   update missions set lead_employee_id = '$E2' where id = '$M1'" >/dev/null
q "delete from assignments where employee_id = '$E2' and plan_date = '$D'" >/dev/null
eq "$LEAD" none "returning the head to Standby (assignment deleted) clears it"

q "insert into assignments (employee_id, plan_date, mission_id) values ('$E2', '$D', '$M1');" >/dev/null
eq "$LEAD" none "placing them back does not bring the head back"

q "update missions set lead_employee_id = '$E2' where id = '$M1'" >/dev/null
q "delete from employees where id = '$E2'" >/dev/null
eq "$LEAD" none "deleting the head's employee record clears it"

q "insert into assignments (employee_id, plan_date, mission_id) values ('$E1', '$D' , '$M1')
   on conflict (employee_id, plan_date) do update set mission_id = excluded.mission_id;
   update missions set lead_employee_id = '$E1' where id = '$M1'" >/dev/null
q "delete from missions where id = '$M1'" >/dev/null
eq "select count(*) from missions where id = '$M1'" 0 "a mission with a head can be deleted (its crew goes with it)"

psql -q -X -d postgres -c "drop database if exists $DB" >/dev/null
echo "all mission-crew-head checks passed"
