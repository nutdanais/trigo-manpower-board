#!/usr/bin/env bash
# supabase/one-off-2026-11-12-number-new-mission-jobs.sql (and its preview) against a throwaway database built
# from schema.sql. Past days on the placeholder number NEW MISSION, in any case, get one number per job
# (same host + customer): NEW MISSION001, 002, ... Checks: the preview lists the jobs and changes nothing;
# each job gets its own number on every day (both cases, both shifts, both boards); today and later days, a real
# number and AMATA NEW MISSION are untouched; the Host Record follows; each job has its own Missions list row and
# the old one is gone; the days' edit stamps are kept; people stay on their cards; a second run does nothing and a
# new past day continues the numbering. Needs a local Postgres (PGHOST/PGPORT/PGUSER as for the other tests/sql
# scripts). Fixtures are fake.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=new_mission_jobs_test
export PGOPTIONS='-c client_min_messages=warning'
P="psql -v ON_ERROR_STOP=1 -q -X -At"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }
q() { $P -d $DB -c "$1"; }
eq() { local got; got="$(q "$1")"; [ "$got" = "$2" ] || fail "$3 (expected '$2', got '$got')"; ok "$3"; }
bash tests/sql/setup-db.sh $DB >/dev/null

B() { echo "10000000-0000-0000-0000-00000000000$1"; }
E() { echo "20000000-0000-0000-0000-00000000000$1"; }
# the lower-case "New Mission" was saved before the capitals trigger existed: no trigger for the setup
q "drop trigger aaa_uppercase_mission_number on missions;" >/dev/null
q "insert into boards (id, name) values ('$(B 1)', 'Board One'), ('$(B 2)', 'Board Two');
   insert into employees (id, name_th, contract, board_id) values
   ('$(E 1)', 'Test Person 1', 'permanent', '$(B 1)'), ('$(E 2)', 'Test Person 2', 'permanent', '$(B 1)'), ('$(E 3)', 'Test Person 3', 'permanent', '$(B 2)');
   insert into missions (board_id, plan_date, number, host, customer, shift) values
   ('$(B 1)', '2026-08-04', 'NEW MISSION', 'Host Valeo', 'Cust Juken', 'day'),
   ('$(B 1)', '2026-08-03', 'NEW MISSION', 'Host Valeo', 'Cust Juken', 'day'),
   ('$(B 1)', '2026-08-14', 'NEW MISSION', 'Host Linex', 'Cust Isuzu', 'day'),
   ('$(B 1)', '2026-09-14', 'New Mission', 'Host F-Tech', 'Cust Honda', 'day'),
   ('$(B 1)', '2026-09-14', 'NEW MISSION', 'Host Yusen', 'Cust Schaeffler', 'day'),
   ('$(B 1)', '2026-09-15', 'NEW MISSION', 'Host F-TECH ', 'cust honda', 'day'),
   ('$(B 1)', '2026-09-15', 'NEW MISSION', 'Host F-Tech', 'Cust Honda', 'night'),
   ('$(B 2)', '2026-09-15', 'NEW MISSION', 'Host F-Tech', 'Cust Honda', 'day'),
   ('$(B 1)', '2099-01-05', 'NEW MISSION', 'Host Future', 'Cust Future', 'day'),
   ('$(B 1)', '2026-09-20', 'AMATA NEW MISSION', 'Host Valeo', 'Cust Juken', 'day'),
   ('$(B 1)', '2026-09-21', 'TSTTH.26.0005', 'Host Valeo', 'Cust Juken', 'day');" >/dev/null
q "insert into assignments (employee_id, plan_date, mission_id)
   select '$(E 1)', plan_date, id from missions where host = 'Host F-Tech' and plan_date = '2026-09-14';
   insert into assignments (employee_id, plan_date, mission_id)
   select '$(E 2)', plan_date, id from missions where host = 'Host Yusen';
   insert into deployment_history (employee_id, plan_date, mission_number, host, customer, board_id) values
   ('$(E 1)', '2026-09-14', 'New Mission', 'Host F-Tech', 'Cust Honda', '$(B 1)'),
   ('$(E 2)', '2026-09-14', 'NEW MISSION', 'Host Yusen', 'Cust Schaeffler', '$(B 1)'),
   ('$(E 3)', '2026-09-15', 'NEW MISSION', 'Host F-Tech', 'Cust Honda', '$(B 2)'),
   ('$(E 3)', '2026-09-16', 'NEW MISSION', 'Nobody Knows', 'Cust Odd', '$(B 2)'),
   ('$(E 1)', '2026-09-21', 'TSTTH.26.0005', 'Host Valeo', 'Cust Juken', '$(B 1)');
   delete from plan_day_stamps;
   insert into plan_day_stamps (board_id, plan_date, last_edited_at, last_edited_by) values
   ('$(B 1)', '2026-09-14', '2026-09-14 09:00+07', 'planner@example.com'), ('$(B 1)', '2026-08-03', '2026-08-03 09:00+07', 'planner@example.com');" >/dev/null
eq "select count(*) from mission_register where upper(number) = 'NEW MISSION'" 3 "before: one placeholder row per board and shift (3), whatever the job"

# the preview changes nothing and lists the jobs in the order of their first day
before="$(q "select md5(string_agg(number || plan_date::text || id::text, ',' order by id)) from missions")"
PREVIEW="$($P -d $DB -F '|' -f supabase/one-off-2026-11-12-number-new-mission-jobs-preview.sql)"
[ "$before" = "$(q "select md5(string_agg(number || plan_date::text || id::text, ',' order by id)) from missions")" ] || fail "the preview changed something"
ok "the preview changes nothing"
case "$PREVIEW" in "NEW MISSION001|Host Valeo|Cust Juken|Board One|day|2026-08-03|2026-08-04|2|2|0"*) ok "the preview starts with the first job";; *) fail "preview: $PREVIEW";; esac
[ "$(echo "$PREVIEW" | wc -l)" = 4 ] || fail "the preview should list 4 jobs: $PREVIEW"
ok "the preview lists 4 jobs (Valeo, Linex, F-Tech, Yusen); the future job and the real numbers are not in it"

q "update mission_register set status = 'closed', closed_on = '2026-09-15', closed_by = 'planner@example.com' where board_id = '$(B 2)' and upper(number) = 'NEW MISSION'" >/dev/null

$P -d $DB -f supabase/one-off-2026-11-12-number-new-mission-jobs.sql >/dev/null

eq "select string_agg(distinct number, ',' order by number) from missions where host = 'Host Valeo' and number like 'NEW MISSION%'" "NEW MISSION001" "a job's days share one number (Valeo, 2 days)"
eq "select number from missions where host = 'Host Linex'" "NEW MISSION002" "the next job takes the next number"
eq "select string_agg(distinct number, ',') from missions where upper(btrim(host)) = 'HOST F-TECH' and plan_date < '2026-12-01'" "NEW MISSION003" "one job, any case and spacing of host and customer, both boards and shifts and the lower-case day, shares a number"
eq "select number from missions where host = 'Host Yusen'" "NEW MISSION004" "another job on the same day as a lower-case NEW MISSION gets its own number"
eq "select count(*) from missions where upper(btrim(number)) = 'NEW MISSION' and plan_date < '2026-12-01'" 0 "no past day is left on NEW MISSION"
eq "select number from missions where host = 'Host Future'" "NEW MISSION" "a day in the future is left alone"
eq "select count(*) from missions where number in ('AMATA NEW MISSION', 'TSTTH.26.0005')" 2 "other numbers are untouched"

eq "select mission_number from deployment_history where employee_id = '$(E 1)' and plan_date = '2026-09-14'" "NEW MISSION003" "the Host Record follows (a lower-case row too)"
eq "select mission_number from deployment_history where employee_id = '$(E 2)'" "NEW MISSION004" "and the other job's person"
eq "select mission_number from deployment_history where employee_id = '$(E 3)' and plan_date = '2026-09-16'" "NEW MISSION" "a Host Record row whose host matches no day is left, not guessed"
eq "select mission_number from deployment_history where employee_id = '$(E 1)' and plan_date = '2026-09-21'" "TSTTH.26.0005" "a real number's history is untouched"
eq "select count(*) from assignments a join missions m on m.id = a.mission_id where m.number in ('NEW MISSION003', 'NEW MISSION004')" 2 "people stay on their cards"

eq "select string_agg(number || ':' || shift || ':' || board_id::text, ',' order by number, shift, board_id) from mission_register where number like 'NEW MISSION0%'" "NEW MISSION001:day:$(B 1),NEW MISSION002:day:$(B 1),NEW MISSION003:day:$(B 1),NEW MISSION003:day:$(B 2),NEW MISSION003:night:$(B 1),NEW MISSION004:day:$(B 1)" "each job has its own Missions list row, per board and shift"
eq "select status || ' ' || closed_on from mission_register where number = 'NEW MISSION003' and board_id = '$(B 2)'" "closed 2026-09-15" "a closed placeholder row's state is copied to its jobs' rows"
eq "select status from mission_register where number = 'NEW MISSION003' and board_id = '$(B 1)' and shift = 'day'" "open" "an open one stays open"
eq "select opened_on || ' ' || last_on from mission_register where number = 'NEW MISSION001'" "2026-08-03 2026-08-04" "with its own first and last day"
eq "select string_agg(board_id::text || shift, ',' order by board_id, shift) from mission_register where upper(number) = 'NEW MISSION'" "$(B 1)day" "only the future day keeps the placeholder row"

eq "select last_edited_by || ' ' || (last_edited_at = '2026-09-14 09:00+07'::timestamptz) from plan_day_stamps where board_id = '$(B 1)' and plan_date = '2026-09-14'" "planner@example.com true" "a stamped day keeps its stamp"
eq "select count(*) from plan_day_stamps where plan_date in ('2026-08-14', '2026-09-15')" 0 "a day that had no stamp gets none"

# a second run does nothing; a new past day continues the numbering
$P -d $DB -f supabase/one-off-2026-11-12-number-new-mission-jobs.sql >/dev/null
eq "select count(*) from missions where number like 'NEW MISSION0%'" 8 "a second run changes nothing"
q "insert into missions (board_id, plan_date, number, host, customer, shift) values ('$(B 1)', '2026-10-02', 'NEW MISSION', 'Host Later', 'Cust Later', 'day')" >/dev/null
$P -d $DB -f supabase/one-off-2026-11-12-number-new-mission-jobs.sql >/dev/null
eq "select number from missions where host = 'Host Later'" "NEW MISSION005" "a new past day continues after the highest number"

q "drop database $DB" >/dev/null 2>&1 || true
echo "all NEW MISSION job checks passed"
