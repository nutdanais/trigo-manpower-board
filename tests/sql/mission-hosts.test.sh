#!/usr/bin/env bash
# migration-2026-11-19 (a mission at several hosts: one customer, a list of hosts). Checks, on a database made to look
# like an older one (the day key without the host, no hosts column) and then migrated, and on one built from schema.sql:
# the key of a day's card is board + date + number + shift + HOST, so one mission at two hosts on one day is two cards
# and the same host twice is refused (also on forecast days); the hosts list starts empty; merging two missions keeps
# every host of both, merges the day cards at the SAME host and keeps two cards where the hosts differ, with the crews
# of both; the migration runs twice. Needs a local Postgres (PGHOST/PGPORT/PGUSER as for the other tests/sql scripts).
# Fixtures are fake.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=mission_hosts_test
export PGOPTIONS='-c client_min_messages=warning'
P="psql -v ON_ERROR_STOP=1 -q -X -At"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }
q() { $P -d $DB -c "$1"; }
eq() { local got; got="$(q "$1")"; [ "$got" = "$2" ] || fail "$3 (expected '$2', got '$got')"; ok "$3"; }
refused() { if q "$1" >/dev/null 2>&1; then fail "$2 (was accepted)"; fi; ok "$2"; }
bash tests/sql/setup-db.sh $DB >/dev/null

# ---- an older database: the key without the host, no hosts column, no flag
q "alter table missions drop constraint missions_unique_number_shift_host;
   alter table missions add constraint missions_unique_number_shift unique (board_id, plan_date, number, shift);
   alter table forecast_missions drop constraint forecast_missions_unique_number_shift_host;
   alter table forecast_missions add constraint forecast_missions_board_id_plan_date_number_shift_key unique (board_id, plan_date, number, shift);
   alter table mission_register drop column hosts; alter table missions drop column host_unconfirmed;" >/dev/null
B1=10000000-0000-0000-0000-000000000001
q "insert into boards (id, name) values ('$B1', 'Board One');
   insert into missions (board_id, plan_date, number, host, customer, shift) values ('$B1', '2026-11-02', 'TSTTH.26.0007', 'Host A', 'Cust', 'day');" >/dev/null
refused "insert into missions (board_id, plan_date, number, host, customer, shift) values ('$B1', '2026-11-02', 'TSTTH.26.0007', 'Host B', 'Cust', 'day')" "before: one mission twice on a day is refused (the old key)"
$P -d $DB -f supabase/migration-2026-11-19-mission-hosts.sql >/dev/null
$P -d $DB -f supabase/migration-2026-11-19-mission-hosts.sql >/dev/null
ok "the migration runs twice on an older database"
eq "select count(*) from pg_constraint where conrelid in ('missions'::regclass, 'forecast_missions'::regclass) and conname in ('missions_unique_number_shift', 'forecast_missions_board_id_plan_date_number_shift_key')" 0 "the old keys are gone"
eq "select count(*) from pg_constraint where conname in ('missions_unique_number_shift_host', 'forecast_missions_unique_number_shift_host')" 2 "the new keys are there"
eq "select hosts::text || host_unconfirmed::text from mission_register r, missions m where r.number = 'TSTTH.26.0007' and m.number = r.number" "{}false" "the hosts list starts empty and no card is waiting for a host"

# ---- one mission at two hosts on one day
q "insert into missions (board_id, plan_date, number, host, customer, shift) values ('$B1', '2026-11-02', 'TSTTH.26.0007', 'Host B', 'Cust', 'day')" >/dev/null
eq "select count(*) from missions where number = 'TSTTH.26.0007' and plan_date = '2026-11-02'" 2 "one mission at two hosts on one day: two cards"
refused "insert into missions (board_id, plan_date, number, host, customer, shift) values ('$B1', '2026-11-02', 'TSTTH.26.0007', 'Host B', 'Cust', 'day')" "the same host twice on a day is refused"
eq "select count(*) from mission_register where number = 'TSTTH.26.0007'" 1 "still one Missions list row"
q "insert into forecast_missions (board_id, plan_date, number, host, customer, shift) values ('$B1', '2026-12-01', 'TSTTH.26.0007', 'Host A', 'Cust', 'day'), ('$B1', '2026-12-01', 'TSTTH.26.0007', 'Host B', 'Cust', 'day')" >/dev/null
refused "insert into forecast_missions (board_id, plan_date, number, host, customer, shift) values ('$B1', '2026-12-01', 'TSTTH.26.0007', 'Host B', 'Cust', 'day')" "the same on a forecast day"

# ---- the older migrations, if they are run again, leave a mission at two hosts alone
$P -d $DB -f supabase/migration-2026-07-15-dedupe-missions.sql >/dev/null
eq "select count(*) from missions where number = 'TSTTH.26.0007' and plan_date = '2026-11-02'" 2 "re-running the dedupe migration keeps both host cards"
eq "select count(*) from pg_constraint where conrelid = 'missions'::regclass and conname = 'missions_unique_number_shift'" 0 "and does not bring back the old key"

# ---- merging missions at different hosts
E() { echo "20000000-0000-0000-0000-00000000000$1"; }
q "insert into employees (id, name_th, contract, board_id) values ('$(E 1)', 'P1', 'permanent', '$B1'), ('$(E 2)', 'P2', 'permanent', '$B1'), ('$(E 3)', 'P3', 'permanent', '$B1');
   insert into missions (board_id, plan_date, number, host, customer, shift) values
   ('$B1', '2026-10-05', 'TSTTH.26.0100', 'Host A', 'Cust M', 'day'), ('$B1', '2026-10-05', 'TSTTH.26.0100', 'Host B', 'Cust M', 'day'),
   ('$B1', '2026-10-05', 'TSTTH.26.0100.', 'Host A', 'Cust M', 'day'), ('$B1', '2026-10-05', 'TSTTH.26.0100.', 'Host C', 'Cust M', 'day');" >/dev/null
mid() { q "select id from missions where plan_date = '2026-10-05' and number = '$1' and host = '$2'"; }
q "insert into assignments (employee_id, plan_date, mission_id) values
   ('$(E 1)', '2026-10-05', '$(mid TSTTH.26.0100 'Host A')'), ('$(E 2)', '2026-10-05', '$(mid TSTTH.26.0100. 'Host A')'), ('$(E 3)', '2026-10-05', '$(mid TSTTH.26.0100. 'Host C')');
   delete from allowed_email_domains;
   insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'eng.a@example.com');
   update profiles set status = 'active', role_key = 'engineer' where email = 'eng.a@example.com';" >/dev/null
AS="set request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-00000000000a\",\"email\":\"eng.a@example.com\"}'; set role authenticated;"
eq "$AS select public.merge_mission_number('TSTTH.26.0100.', 'TSTTH.26.0100')" 1 "merging: one day card (same host A) merged"
eq "select string_agg(host, ',' order by host) from missions where number = 'TSTTH.26.0100' and plan_date = '2026-10-05'" "Host A,Host B,Host C" "the cards at Host B and Host C stay: one card per host"
eq "select count(*) from missions where number = 'TSTTH.26.0100.'" 0 "nothing left on the typo"
eq "select string_agg(a.employee_id::text, ',' order by a.employee_id) from assignments a join missions m on m.id = a.mission_id where m.number = 'TSTTH.26.0100' and m.host = 'Host A'" "$(E 1),$(E 2)" "the card at Host A has both crews"
eq "select string_agg(a.employee_id::text, ',') from assignments a join missions m on m.id = a.mission_id where m.number = 'TSTTH.26.0100' and m.host = 'Host C'" "$(E 3)" "the card at Host C keeps its crew"
eq "select hosts::text from mission_register where number = 'TSTTH.26.0100'" '{"Host A","Host B","Host C"}' "the Missions list row keeps every host of both missions"
eq "select count(*) from mission_register where number in ('TSTTH.26.0100', 'TSTTH.26.0100.')" 1 "one row"
echo "all mission-hosts checks passed"
