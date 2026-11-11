#!/usr/bin/env bash
# migration-2026-11-11 (stricter mission numbers, temporary numbers, replace_mission_number) against a
# throwaway database built from schema.sql, then the migration run on top (it must be safe to re-run).
# Checks: who may correct a number; the new number's format; a used number refused; a wrong number and
# a temporary one replaced on every day (both boards and shifts, forecast days, the Host Record), with
# the history written and the day stamps kept; an Etraq number never turned back into a temporary one;
# the new-year renumber refusing a 4-character prefix. Needs a local Postgres (PGHOST/PGPORT/PGUSER as
# for the other tests/sql scripts). Fixtures are fake.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=mission_number_rules_test
export PGOPTIONS='-c client_min_messages=warning'
P="psql -v ON_ERROR_STOP=1 -q -X -At"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }
q() { $P -d $DB -c "$1"; }
eq() { local got; got="$(q "$1")"; [ "$got" = "$2" ] || fail "$3 (expected '$2', got '$got')"; ok "$3"; }
bash tests/sql/setup-db.sh $DB >/dev/null
$P -d $DB -f supabase/migration-2026-11-11-mission-number-rules.sql >/dev/null
$P -d $DB -f supabase/migration-2026-11-11-mission-number-rules.sql >/dev/null
ok "the migration runs twice on a database built from schema.sql"

B() { echo "10000000-0000-0000-0000-00000000000$1"; }
E() { echo "20000000-0000-0000-0000-00000000000$1"; }
q "insert into boards (id, name) values ('$(B 1)', 'Board One'), ('$(B 2)', 'Board Two');
   insert into employees (id, name_th, contract, board_id) values ('$(E 1)', 'Test Person 1', 'permanent', '$(B 1)');
   insert into missions (board_id, plan_date, number, host, customer, shift) values
   ('$(B 1)', '2026-11-02', '108', 'Host A', 'Cust A', 'day'),
   ('$(B 1)', '2026-11-03', '108', 'Host A', 'Cust A', 'day'),
   ('$(B 1)', '2026-11-03', '108', 'Host A', 'Cust A', 'night'),
   ('$(B 2)', '2026-11-03', '108', 'Host A', 'Cust A', 'day'),
   ('$(B 1)', '2026-11-03', 'TSTTH.26.TMP001', 'Host T', 'Cust T', 'day'),
   ('$(B 1)', '2026-11-03', 'TSTTH.26.0005', 'Host R', 'Cust R', 'day');
   insert into deployment_history (employee_id, plan_date, mission_number, host, customer, board_id) values
   ('$(E 1)', '2026-11-02', '108', 'Host A', 'Cust A', '$(B 1)');
   update plan_day_stamps set last_edited_at = '2026-11-03 09:00+07', last_edited_by = 'planner@example.com' where plan_date = '2026-11-03';" >/dev/null
eq "select count(*) from mission_register where number = '108'" 3 "the wrong number is on two boards and both shifts"

q "delete from allowed_email_domains;
   insert into auth.users (id, email) values
   ('00000000-0000-0000-0000-00000000000a', 'eng.a@example.com'), ('00000000-0000-0000-0000-00000000000b', 'site.b@example.com'),
   ('00000000-0000-0000-0000-00000000000c', 'viewer.c@example.com');
   update profiles set status = 'active', role_key = 'engineer'  where email = 'eng.a@example.com';
   update profiles set status = 'active', role_key = 'siteadmin' where email = 'site.b@example.com';
   update profiles set status = 'active', role_key = 'viewer'    where email = 'viewer.c@example.com';" >/dev/null
as() { local id; id="$(q "select id from auth.users where email = '$1'")"; echo "set request.jwt.claims = '{\"sub\":\"$id\",\"email\":\"$1\"}'; set role authenticated;"; }
qa() { $P -d $DB -c "$(as "$1") $2" 2>&1 || true; }

case "$(qa viewer.c@example.com "select public.replace_mission_number('108', 'TSTTH.26.0108')")" in *"cannot change"*) ok "a viewer cannot correct a number";; *) fail "a viewer could correct a number";; esac
case "$(qa eng.a@example.com "select public.replace_mission_number('108', 'TST.26.0108')")" in *"not in the form"*) ok "a 3-character prefix is refused";; *) fail "a short prefix was accepted";; esac
case "$(qa eng.a@example.com "select public.replace_mission_number('108', 'TSTTH.26.0108.AA')")" in *"not in the form"*) ok "a monthly suffix is refused";; *) fail "a suffix was accepted";; esac
case "$(qa eng.a@example.com "select public.replace_mission_number('108', 'TSTTH.26.0005')")" in *"already used"*) ok "a number in use is refused";; *) fail "a used number was accepted";; esac
case "$(qa eng.a@example.com "select public.replace_mission_number('999', 'TSTTH.26.0999')")" in *"not in the Missions list"*) ok "an unknown number is refused";; *) fail "an unknown number was accepted";; esac
case "$(qa eng.a@example.com "select public.replace_mission_number('TSTTH.26.0005', 'TSTTH.26.TMP002')")" in *"already has its Etraq number"*) ok "an Etraq number is never turned back into a temporary one";; *) fail "an Etraq number became temporary";; esac

eq "$(as eng.a@example.com) select public.replace_mission_number('108', ' tstth.26.0108 ')" 3 "an engineer corrects a wrong number"
eq "select count(*) from missions where number = '108'" 0 "no day is left on the wrong number, the first day included"
eq "select count(*) from missions where number = 'TSTTH.26.0108'" 4 "every day, board and shift takes the new number"
eq "select count(*) from mission_register where number = 'TSTTH.26.0108'" 3 "the Missions list rows take it"
eq "select string_agg(mission_number, ',') from deployment_history" TSTTH.26.0108 "the Host Record takes it"
eq "select old_number || '>' || new_number || ' ' || valid_from || ' ' || entered_by from mission_number_history" "108>TSTTH.26.0108 2026-11-02 eng.a@example.com" "the history says what it was, from its first day"
eq "select string_agg(distinct last_edited_by, ',') from plan_day_stamps where plan_date = '2026-11-03'" planner@example.com "correcting a number is not an edit of the day"

eq "$(as site.b@example.com) select public.replace_mission_number('TSTTH.26.TMP001', 'TSTTH.26.0110')" 1 "a Site Admin replaces a temporary number with the Etraq number"
eq "select count(*) from missions where number = 'TSTTH.26.TMP001'" 0 "the temporary number is gone from the days"
case "$(qa eng.a@example.com "select public.replace_mission_number('TSTTH.26.0005', 'TSTTH.26.TMP001')")" in *"already"*) ok "a temporary number is never given out again";; *) fail "a used temporary number was given out again";; esac

q "insert into missions (board_id, plan_date, number, host, customer, shift) values ('$(B 1)', '2026-11-04', 'BAD-1', 'Host Z', 'Cust Z', 'day')" >/dev/null
eq "$(as eng.a@example.com) select public.replace_mission_number('BAD-1', 'TSTTH.26.TMP003')" 1 "a wrong number may become a temporary one while Etraq has none yet"
eq "$(as eng.a@example.com) select public.replace_mission_number('TSTTH.26.TMP003', 'TSTTH.26.0111')" 1 "and later its Etraq number"
eq "select string_agg(old_number || '>' || new_number, ',' order by entered_at) from mission_number_history where old_number in ('BAD-1', 'TSTTH.26.TMP003')" "BAD-1>TSTTH.26.TMP003,TSTTH.26.TMP003>TSTTH.26.0111" "the history keeps each step, from the wrong number to the Etraq one"

case "$(qa site.b@example.com "select public.renumber_missions('[{\"old\":\"TSTTH.26.0110\",\"new\":\"TST.27.0001\"}]', '2027-01-01')")" in *"PREFIX.YY.NNNN"*) ok "the new-year number needs the 5-character prefix too";; *) fail "renumber accepted a short prefix";; esac

echo "all mission number rule checks passed"
