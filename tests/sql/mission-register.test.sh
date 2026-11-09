#!/usr/bin/env bash
# migration-2026-11-09 (the Mission register, Site Admin, the new-year number) against a throwaway
# database built from schema.sql. Checks: a new database gets it from schema.sql; on an older
# database the back-fill registers every number + shift (open, or closed when gone for more than
# a week before its board's latest day) and a re-run changes nothing; saving a day keeps the
# register in step; a closed mission is never put on a later day and its later days lose it; who
# may close, reopen and renumber; a renumber renames the days from 1 January only and keeps the
# day stamps; a mission added on a day by mistake and deleted leaves no register row. Needs a
# local Postgres (PGHOST/PGPORT/PGUSER as for the other tests/sql scripts). Fixtures are fake.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=mission_register_test
export PGOPTIONS='-c client_min_messages=warning'
MIG=supabase/migration-2026-11-09-mission-register.sql
P="psql -v ON_ERROR_STOP=1 -q -X -At"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }
q() { $P -d $DB -c "$1"; }
eq() { local got; got="$(q "$1")"; [ "$got" = "$2" ] || fail "$3 (expected '$2', got '$got')"; ok "$3"; }
bash tests/sql/setup-db.sh $DB >/dev/null

eq "select count(*) from roles where key = 'siteadmin' and rank = 35" 1 "schema.sql adds the Site Admin role"
eq "select to_regclass('public.mission_register') is not null" t "schema.sql adds mission_register"

# ---------- an older database: no register yet, days already planned ----------
q "drop trigger sync_mission_register on missions; drop trigger skip_closed_mission on missions; drop trigger forget_unused_mission on missions;
   drop table mission_register; drop table mission_number_history;
   alter table role_permissions disable trigger guard_admin_permissions;
   delete from role_permissions where role_key = 'siteadmin' or area in ('missions', 'missionadmin'); delete from roles where key = 'siteadmin';
   alter table role_permissions enable trigger guard_admin_permissions;" >/dev/null
B() { echo "10000000-0000-0000-0000-00000000000$1"; }
E() { echo "20000000-0000-0000-0000-00000000000$1"; }
q "insert into boards (id, name) values ('$(B 1)', 'Board One'), ('$(B 2)', 'Board Two')" >/dev/null
q "insert into employees (id, name_th, contract, board_id) values ('$(E 1)', 'Test Person 1', 'permanent', '$(B 1)'), ('$(E 2)', 'Test Person 2', 'permanent', '$(B 1)')" >/dev/null
# Board One's latest day is 2026-11-05. 0005 runs to the end (day and night), 0002 ended on
# 2026-10-20 (more than a week before), 0009 was last on 2026-11-01 (within the week: still open).
q "insert into missions (board_id, plan_date, number, host, customer, shift) values
  ('$(B 1)', '2026-10-01', 'TSTTH.26.0005', 'Host Old', 'Cust A', 'day'),
  ('$(B 1)', '2026-11-05', 'TSTTH.26.0005', 'Host New', 'Cust A', 'day'),
  ('$(B 1)', '2026-11-05', 'TSTTH.26.0005', 'Host New', 'Cust A', 'night'),
  ('$(B 1)', '2026-10-15', 'TSTTH.26.0002', 'Host B', 'Cust B', 'day'),
  ('$(B 1)', '2026-10-20', 'TSTTH.26.0002', 'Host B', 'Cust B', 'day'),
  ('$(B 1)', '2026-11-01', 'TSTTH.26.0009', 'Host C', 'Cust C', 'day'),
  ('$(B 2)', '2026-11-04', 'TSTTH.26.0005', 'Host Two', 'Cust A', 'day')" >/dev/null

$P -d $DB -f $MIG >/dev/null
eq "select count(*) from mission_register" 5 "the back-fill registers every board + number + shift"
eq "select status || ' ' || opened_on || ' ' || last_on || ' ' || host from mission_register where board_id = '$(B 1)' and number = 'TSTTH.26.0005' and shift = 'day'" \
   "open 2026-10-01 2026-11-05 Host New" "a running mission is open, from its first day, with its latest day's details"
eq "select status || ' ' || closed_on || ' ' || closed_by from mission_register where number = 'TSTTH.26.0002'" "closed 2026-10-20 migration" "a mission gone for more than a week is closed on its last day"
eq "select status from mission_register where number = 'TSTTH.26.0009'" open "a mission gone for less than a week stays open"
eq "select count(*) from role_permissions where role_key = 'siteadmin'" "$(q "select count(*) + 2 from role_permissions where role_key = 'viewer' and area not in ('missions','missionadmin')")" "Site Admin gets every Viewer area plus the two new ones"
eq "select level from role_permissions where role_key = 'siteadmin' and area = 'board'" view "Site Admin only views the board"
eq "select string_agg(role_key || '=' || level, ',' order by role_key) from role_permissions where area = 'missionadmin'" \
   "admin=edit,engineer=none,manager=edit,siteadmin=edit,viewer=none" "who may reopen and renumber"

q "update role_permissions set level = 'none' where role_key = 'engineer' and area = 'missions'" >/dev/null
$P -d $DB -f $MIG >/dev/null
eq "select count(*) from mission_register" 5 "a re-run adds nothing"
eq "select level from role_permissions where role_key = 'engineer' and area = 'missions'" none "a re-run keeps a permission changed in Settings"
q "update role_permissions set level = 'edit' where role_key = 'engineer' and area = 'missions'" >/dev/null

# ---------- users ----------
q "delete from allowed_email_domains;
   insert into auth.users (id, email) values
   ('00000000-0000-0000-0000-00000000000a', 'eng.a@example.com'), ('00000000-0000-0000-0000-00000000000b', 'site.b@example.com'),
   ('00000000-0000-0000-0000-00000000000c', 'viewer.c@example.com');
   update profiles set status = 'active', role_key = 'engineer'  where email = 'eng.a@example.com';
   update profiles set status = 'active', role_key = 'siteadmin' where email = 'site.b@example.com';
   update profiles set status = 'active', role_key = 'viewer'    where email = 'viewer.c@example.com';" >/dev/null
as() { local id; id="$(q "select id from auth.users where email = '$1'")"; echo "set request.jwt.claims = '{\"sub\":\"$id\",\"email\":\"$1\"}'; set role authenticated;"; }
qa() { $P -d $DB -c "$(as "$1") $2" 2>&1 || true; }

# ---------- saving a day keeps the register in step ----------
q "insert into missions (board_id, plan_date, number, host, customer, shift) values ('$(B 1)', '2026-11-06', 'TSTTH.26.0005', 'Host Newest', 'Cust A', 'day')" >/dev/null
eq "select last_on || ' ' || host from mission_register where board_id = '$(B 1)' and number = 'TSTTH.26.0005' and shift = 'day'" "2026-11-06 Host Newest" "a new day refreshes the register"
q "update missions set host = 'Edited Old Day' where plan_date = '2026-10-01' and number = 'TSTTH.26.0005'" >/dev/null
eq "select host from mission_register where board_id = '$(B 1)' and number = 'TSTTH.26.0005' and shift = 'day'" "Host Newest" "editing an old day leaves the register's details alone"
q "insert into missions (board_id, plan_date, number, host, customer, shift) values ('$(B 2)', '2026-11-06', 'TSTTH.26.0077', 'Typo', 'X', 'day')" >/dev/null
eq "select count(*) from mission_register where number = 'TSTTH.26.0077'" 1 "a new mission is registered"
q "delete from missions where number = 'TSTTH.26.0077'" >/dev/null
eq "select count(*) from mission_register where number = 'TSTTH.26.0077'" 0 "a mission added by mistake and deleted leaves no register row"
q "insert into mission_register (board_id, number, shift, source) values ('$(B 2)', 'TSTTH.26.0088', 'day', 'list')" >/dev/null
q "insert into missions (board_id, plan_date, number, host, customer, shift) values ('$(B 2)', '2026-11-06', 'TSTTH.26.0088', 'H', 'C', 'day')" >/dev/null
q "delete from missions where number = 'TSTTH.26.0088'" >/dev/null
eq "select count(*) from mission_register where number = 'TSTTH.26.0088'" 1 "a mission added on the Missions tab is kept when its day is deleted"

# ---------- close ----------
q "insert into missions (id, board_id, plan_date, number, host, customer, shift) values
   ('30000000-0000-0000-0000-000000000001', '$(B 1)', '2026-11-07', 'TSTTH.26.0009', 'Host C', 'Cust C', 'day'),
   ('30000000-0000-0000-0000-000000000002', '$(B 1)', '2026-11-08', 'TSTTH.26.0009', 'Host C', 'Cust C', 'day');
   insert into assignments (employee_id, plan_date, mission_id) values ('$(E 1)', '2026-11-08', '30000000-0000-0000-0000-000000000002');
   insert into deployment_history (employee_id, plan_date, mission_number, host, customer, board_id) values ('$(E 1)', '2026-11-08', 'TSTTH.26.0009', 'Host C', 'Cust C', '$(B 1)'), ('$(E 1)', '2026-11-07', 'TSTTH.26.0009', 'Host C', 'Cust C', '$(B 1)');" >/dev/null
R9="$(q "select id from mission_register where number = 'TSTTH.26.0009'")"
case "$(qa viewer.c@example.com "select public.close_mission('$R9', '2026-11-07')")" in *"cannot close"*) ok "a viewer cannot close";; *) fail "a viewer could close";; esac
q "insert into plan_days (board_id, plan_date, locked_by, locked_at) values ('$(B 1)', '2026-11-08', 'x', now())" >/dev/null
case "$(qa eng.a@example.com "select public.close_mission('$R9', '2026-11-07')")" in *"locked day"*) ok "closing refuses to take a mission off a locked day";; *) fail "closing changed a locked day";; esac
q "delete from plan_days where plan_date = '2026-11-08'" >/dev/null
qa eng.a@example.com "select public.close_mission('$R9', '2026-11-07', '  Contract ended ')" >/dev/null
eq "select status || ' ' || closed_on || ' ' || closed_by || ' ' || close_note || ' ' || last_on from mission_register where id = '$R9'" \
   "closed 2026-11-07 eng.a@example.com Contract ended 2026-11-07" "an engineer closes a mission"
eq "select count(*) from missions where number = 'TSTTH.26.0009' and plan_date > '2026-11-07'" 0 "the days after lose the mission"
eq "select count(*) from assignments where plan_date = '2026-11-08'" 0 "its crew on those days go back to Standby"
eq "select string_agg(plan_date::text, ',') from deployment_history where mission_number = 'TSTTH.26.0009'" 2026-11-07 "the Host Record keeps the days up to the close"
q "insert into missions (board_id, plan_date, number, host, customer, shift) values ('$(B 1)', '2026-11-09', 'TSTTH.26.0009', 'Host C', 'Cust C', 'day')" >/dev/null
eq "select count(*) from missions where number = 'TSTTH.26.0009' and plan_date = '2026-11-09'" 0 "carry over never puts a closed mission on a later day"
case "$(qa eng.a@example.com "select public.reopen_mission('$R9')")" in *"cannot reopen"*) ok "an engineer cannot reopen";; *) fail "an engineer could reopen";; esac
qa site.b@example.com "select public.reopen_mission('$R9')" >/dev/null
eq "select status || coalesce(closed_on::text, '-') from mission_register where id = '$R9'" "open-" "a Site Admin reopens it"

# ---------- the new-year number ----------
q "insert into missions (board_id, plan_date, number, host, customer, shift) values
   ('$(B 1)', '2026-12-31', 'TSTTH.26.0005', 'Host Newest', 'Cust A', 'day'),
   ('$(B 1)', '2027-01-04', 'TSTTH.26.0005', 'Host Newest', 'Cust A', 'day'),
   ('$(B 1)', '2027-01-04', 'TSTTH.26.0005', 'Host Newest', 'Cust A', 'night'),
   ('$(B 2)', '2027-01-04', 'TSTTH.26.0005', 'Host Two', 'Cust A', 'day');
   insert into deployment_history (employee_id, plan_date, mission_number, host, customer, board_id) values
   ('$(E 2)', '2026-12-31', 'TSTTH.26.0005', 'Host Newest', 'Cust A', '$(B 1)'), ('$(E 2)', '2027-01-04', 'TSTTH.26.0005', 'Host Newest', 'Cust A', '$(B 1)');
   update plan_day_stamps set last_edited_at = '2027-01-04 09:00+07', last_edited_by = 'planner@example.com' where plan_date = '2027-01-04';" >/dev/null
case "$(qa eng.a@example.com "select public.renumber_missions('[{\"old\":\"TSTTH.26.0005\",\"new\":\"TSTTH.27.0001\"}]', '2027-01-01')")" in *"cannot enter"*) ok "an engineer cannot enter new-year numbers";; *) fail "an engineer could renumber";; esac
case "$(qa site.b@example.com "select public.renumber_missions('[{\"old\":\"TSTTH.26.0005\",\"new\":\"TSTTH.27.0001.AA\"}]', '2027-01-01')")" in *"PREFIX.YY.NNNN"*) ok "a number with a suffix is refused";; *) fail "a suffix was accepted";; esac
case "$(qa site.b@example.com "select public.renumber_missions('[{\"old\":\"TSTTH.26.0005\",\"new\":\"TSTTH.26.0002\"}]', '2027-01-01')")" in *"already used"*) ok "a number already in use is refused";; *) fail "a used number was accepted";; esac
eq "$(as site.b@example.com) select public.renumber_missions('[{\"old\":\"tstth.26.0005\",\"new\":\" tstth.27.0001 \"}]', '2027-01-01')" 1 "a Site Admin enters the new-year number"
eq "select count(*) from mission_register where number = 'TSTTH.27.0001'" 3 "every board and shift of the mission takes the new number"
eq "select string_agg(distinct number, ',') from missions where plan_date >= '2027-01-01' and number like 'TSTTH.2_.0005' or (plan_date >= '2027-01-01' and number like 'TSTTH.27.%')" TSTTH.27.0001 "days from 1 January show the new number"
eq "select string_agg(distinct number, ',') from missions where plan_date < '2027-01-01' and number in ('TSTTH.26.0005', 'TSTTH.27.0001')" TSTTH.26.0005 "earlier days keep the old number"
eq "select string_agg(mission_number, ',' order by plan_date) from deployment_history where employee_id = '$(E 2)'" "TSTTH.26.0005,TSTTH.27.0001" "the Host Record follows the same rule"
eq "select old_number || '>' || new_number || ' ' || valid_from || ' ' || entered_by from mission_number_history" "TSTTH.26.0005>TSTTH.27.0001 2027-01-01 site.b@example.com" "the number history links the two years"
eq "select last_edited_by from plan_day_stamps where board_id = '$(B 1)' and plan_date = '2027-01-04'" planner@example.com "the renumber does not count as an edit of the day"
eq "select count(*) from mission_register where number = 'TSTTH.26.0005'" 0 "no register row is left on the old number"

echo "all mission register checks passed"
