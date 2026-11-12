#!/usr/bin/env bash
# migration-2026-11-12b (mission numbers are always capitals) against a throwaway database built from
# schema.sql. The numbers saved before the migration are made without its trigger (dropped for the setup),
# then the migration runs twice (it must be safe to re-run). Checks: every place that keeps a number is
# capitalised (days, forecast days, Missions list, Host Record, number history); a wrong number only changes
# its letters; the days' edit stamps are kept and a day without one gets none; a capital number that already
# exists beside the lower-case one is left alone; the trigger capitalises a new number and a changed one, and
# an upsert on a lower-case number lands on the capital register row. Needs a local Postgres (PGHOST/PGPORT/
# PGUSER as for the other tests/sql scripts). Fixtures are fake.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=mission_number_capitals_test
export PGOPTIONS='-c client_min_messages=warning'
P="psql -v ON_ERROR_STOP=1 -q -X -At"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }
q() { $P -d $DB -c "$1"; }
eq() { local got; got="$(q "$1")"; [ "$got" = "$2" ] || fail "$3 (expected '$2', got '$got')"; ok "$3"; }
bash tests/sql/setup-db.sh $DB >/dev/null

B() { echo "10000000-0000-0000-0000-00000000000$1"; }
E() { echo "20000000-0000-0000-0000-00000000000$1"; }

# numbers saved before the migration: no capitals trigger yet
q "drop trigger aaa_uppercase_mission_number on missions;
   drop trigger aaa_uppercase_mission_number on forecast_missions;
   drop trigger aaa_uppercase_mission_number on mission_register;" >/dev/null
q "insert into boards (id, name) values ('$(B 1)', 'Board One'), ('$(B 2)', 'Board Two');
   insert into employees (id, name_th, contract, board_id) values ('$(E 1)', 'Test Person 1', 'permanent', '$(B 1)');
   insert into missions (board_id, plan_date, number, host, customer, shift) values
   ('$(B 1)', '2026-11-02', 'Esie1.26.0417', 'Host A', 'Cust A', 'day'),
   ('$(B 1)', '2026-11-03', 'Esie1.26.0417', 'Host A', 'Cust A', 'day'),
   ('$(B 1)', '2026-11-03', 'Esie1.26.0417', 'Host A', 'Cust A', 'night'),
   ('$(B 1)', '2026-11-03', 'Bangna.26.0007', 'Host B', 'Cust B', 'day'),
   ('$(B 1)', '2026-11-03', 'TSTTH.26.0005', 'Host R', 'Cust R', 'day'),
   ('$(B 2)', '2026-11-03', 'Dup01.26.0001', 'Host D', 'Cust D', 'day'),
   ('$(B 2)', '2026-11-03', 'DUP01.26.0001', 'Host D', 'Cust D', 'day'),
   ('$(B 2)', '2026-11-04', 'Amata new mission', 'Host M', 'Cust M', 'day'),
   ('$(B 2)', '2026-11-05', 'AMATA NEW MISSION', 'Host M', 'Cust M', 'day'),
   ('$(B 2)', '2026-11-06', 'amata new mission', 'Host M', 'Cust M', 'day'),
   ('$(B 2)', '2026-11-07', 'Free Text One', 'Host F', 'Cust F', 'day'),
   ('$(B 2)', '2026-11-08', 'free text one', 'Host F', 'Cust F', 'day');
   insert into forecast_missions (board_id, plan_date, number, host, customer, shift) values
   ('$(B 1)', '2026-11-10', 'Esie1.26.0417', 'Host A', 'Cust A', 'day');
   insert into deployment_history (employee_id, plan_date, mission_number, host, customer, board_id) values
   ('$(E 1)', '2026-11-02', 'Esie1.26.0417', 'Host A', 'Cust A', '$(B 1)');
   insert into mission_number_history (old_number, new_number, valid_from) values ('Esie1.25.0001', 'Esie1.26.0417', '2026-01-01');" >/dev/null
# the day stamps as an editor left them: 2 November stamped, 3 November stamped, nothing on the others
q "delete from plan_day_stamps;
   insert into plan_day_stamps (board_id, plan_date, last_edited_at, last_edited_by) values
   ('$(B 1)', '2026-11-02', '2026-11-02 09:00+07', 'planner@example.com'), ('$(B 1)', '2026-11-03', '2026-11-03 09:00+07', 'planner@example.com');" >/dev/null
eq "select count(*) from mission_register where number = 'Esie1.26.0417'" 2 "before: the number is in the Missions list in lower case, once per shift"

$P -d $DB -f supabase/migration-2026-11-12b-mission-number-capitals.sql >/dev/null
$P -d $DB -f supabase/migration-2026-11-12b-mission-number-capitals.sql >/dev/null
ok "the migration runs twice on a database built from schema.sql"

eq "select count(*) from missions where number = 'Esie1.26.0417'" 0 "no day keeps the lower-case number"
eq "select count(*) from missions where number = 'ESIE1.26.0417'" 3 "every day and shift is in capitals"
eq "select count(*) from forecast_missions where number = 'ESIE1.26.0417'" 1 "a forecast day too"
eq "select string_agg(number || ':' || shift, ',' order by shift) from mission_register where number like 'ESIE1%'" "ESIE1.26.0417:day,ESIE1.26.0417:night" "the Missions list has one capital row per shift, none doubled by the days' update"
eq "select count(*) from mission_register where number = 'Esie1.26.0417'" 0 "the lower-case Missions list rows are gone"
eq "select mission_number from deployment_history" ESIE1.26.0417 "the Host Record"
eq "select old_number || ' > ' || new_number from mission_number_history" "ESIE1.25.0001 > ESIE1.26.0417" "the number history"
eq "select count(*) from missions where number = 'BANGNA.26.0007'" 1 "a wrong number only changes its letters"
eq "select count(*) from missions where number ~ '^BANGNA\\.26\\.0007$' and number !~ '^[A-Z][A-Z0-9]{4}\\.[0-9]{2}\\.[0-9]{4}$'" 1 "and is still not an Etraq number (6-character site code)"
eq "select count(*) from missions where number = 'TSTTH.26.0005'" 1 "a number already in capitals is untouched"

eq "select last_edited_by || ' ' || (last_edited_at = '2026-11-02 09:00+07'::timestamptz) from plan_day_stamps where board_id = '$(B 1)' and plan_date = '2026-11-02'" "planner@example.com true" "a stamped day keeps its stamp (2 Nov)"
eq "select last_edited_at = '2026-11-03 09:00+07'::timestamptz from plan_day_stamps where board_id = '$(B 1)' and plan_date = '2026-11-03'" t "the stamp's time is the one before the renaming (3 Nov)"
eq "select count(*) from plan_day_stamps where board_id = '$(B 2)'" 0 "a day that had no stamp gets none from the renaming"

eq "select count(*) from missions where board_id = '$(B 2)' and number = 'Dup01.26.0001'" 1 "a lower-case number whose capital twin is on the same day is left alone"
eq "select count(*) from missions where board_id = '$(B 2)' and number = 'DUP01.26.0001'" 1 "and the twin stays"

# case variants of one number, a free-text one with spaces (the real data that broke the first version): rows of
# the Missions list that differ only by case are one mission, folded into one capital row
eq "select count(*) from mission_register where board_id = '$(B 2)' and upper(number) = 'AMATA NEW MISSION'" 1 "the Missions list: three case variants of one mission become one row"
eq "select number from mission_register where board_id = '$(B 2)' and upper(number) = 'AMATA NEW MISSION'" "AMATA NEW MISSION" "in capitals"
eq "select opened_on || ' ' || last_on from mission_register where board_id = '$(B 2)' and number = 'AMATA NEW MISSION'" "2026-11-04 2026-11-06" "it covers all three days"
eq "select count(*) from missions where board_id = '$(B 2)' and number = 'AMATA NEW MISSION'" 3 "every day of it is in capitals, none lost"
eq "select count(*) from mission_register where board_id = '$(B 2)' and number = 'FREE TEXT ONE'" 1 "two lower-case variants and no capital row: one capital row"
eq "select count(*) from missions where board_id = '$(B 2)' and number = 'FREE TEXT ONE'" 2 "both of its days are in capitals"
eq "select count(*) from mission_register where board_id = '$(B 2)' and upper(number) = 'DUP01.26.0001'" 1 "a lower-case Missions list row next to its capital twin is folded into it"

# the trigger
q "insert into missions (board_id, plan_date, number, host, customer, shift) values ('$(B 1)', '2026-12-04', 'amata.26.0042', 'Host N', 'Cust N', 'day')" >/dev/null
eq "select number from missions where plan_date = '2026-12-04'" "AMATA.26.0042" "a new number is saved in capitals"
eq "select count(*) from mission_register where number = 'AMATA.26.0042'" 1 "its Missions list row is in capitals"
q "update missions set number = 'lcbth.26.0001' where plan_date = '2026-12-04'" >/dev/null
eq "select number from missions where plan_date = '2026-12-04'" "LCBTH.26.0001" "a changed number is saved in capitals"
q "insert into mission_register (board_id, number, shift, source) values ('$(B 2)', 'esie2.26.0003', 'day', 'list')" >/dev/null
eq "select count(*) from mission_register where board_id = '$(B 2)' and number = 'ESIE2.26.0003'" 1 "a Missions list row added by hand is in capitals"
q "insert into missions (board_id, plan_date, number, host, customer, shift) values ('$(B 2)', '2026-12-05', 'esie2.26.0003', 'Host E', 'Cust E', 'day')" >/dev/null
eq "select count(*) from mission_register where board_id = '$(B 2)' and number ilike 'esie2.26.0003'" 1 "a day typed in lower case lands on the capital Missions list row"
q "update missions set host = 'Host Z' where plan_date = '2026-12-05'" >/dev/null
eq "select host from missions where plan_date = '2026-12-05'" "Host Z" "changing another column still works"

q "drop database $DB" >/dev/null 2>&1 || true
echo "all mission number capital checks passed"
