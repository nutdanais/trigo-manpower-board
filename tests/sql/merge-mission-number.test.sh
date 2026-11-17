#!/usr/bin/env bash
# migration-2026-11-18b (merge_mission_number): a typo made on a mission that already exists under the right
# number on the same board and shift. The case from the live board: LCBTH.26.0049 closed on 12 October, and the
# job carried on as <THAI VOWEL MARK>LCBTH.26.0049 (typed from the wrong keyboard), with both spellings on the
# same days. Checks: every day ends under the right number, one card a day; the crew of a day that has both is
# added, nobody lost; the Leader, the Host Record, the history and the days' edit stamps follow; the two Missions
# list rows become one, open, from the first day to the last (a closed one reopened: Site Admin / Manager only);
# a number also on another board or shift is refused; a number that is not a mistyped spelling of the other (two different jobs on one board and shift) is never merged; a typo with no twin is just renamed; it runs twice.
# Needs a local Postgres (PGHOST/PGPORT/PGUSER as for the other tests/sql scripts). Fixtures are fake.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=merge_mission_number_test
export PGOPTIONS='-c client_min_messages=warning'
P="psql -v ON_ERROR_STOP=1 -q -X -At"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }
q() { $P -d $DB -c "$1"; }
eq() { local got; got="$(q "$1")"; [ "$got" = "$2" ] || fail "$3 (expected '$2', got '$got')"; ok "$3"; }
bash tests/sql/setup-db.sh $DB >/dev/null
$P -d $DB -f supabase/migration-2026-11-18b-merge-mission-number.sql >/dev/null
$P -d $DB -f supabase/migration-2026-11-18b-merge-mission-number.sql >/dev/null
ok "the migration runs twice on a database built from schema.sql"

RIGHT='TSTTH.26.0049'
TYPO="$(printf '\xe0\xb8\xba')TSTTH.26.0049"     # U+0E3A THAI CHARACTER PHINTHU in front: not a space, not a dot
B1=10000000-0000-0000-0000-000000000001; B2=10000000-0000-0000-0000-000000000002
E() { echo "20000000-0000-0000-0000-00000000000$1"; }
q "insert into boards (id, name) values ('$B1', 'Board One'), ('$B2', 'Board Two');
   insert into employees (id, name_th, contract, board_id) values
   ('$(E 1)', 'Person 1', 'permanent', '$B1'), ('$(E 2)', 'Person 2', 'permanent', '$B1'),
   ('$(E 3)', 'Person 3', 'permanent', '$B1'), ('$(E 4)', 'Person 4', 'permanent', '$B1');
   insert into missions (board_id, plan_date, number, host, customer, shift) values
   ('$B1', '2026-10-05', '$RIGHT', 'Host Old', 'Cust Old', 'day'),
   ('$B1', '2026-10-06', '$RIGHT', 'Host Old', 'Cust Old', 'day'),
   ('$B1', '2026-10-07', '$RIGHT', 'Host Old', 'Cust Old', 'day'),
   ('$B1', '2026-10-06', '$TYPO', 'Host New', 'Cust New', 'day'),
   ('$B1', '2026-10-07', '$TYPO', 'Host New', 'Cust New', 'day'),
   ('$B1', '2026-10-08', '$TYPO', 'Host New', 'Cust New', 'day'),
   ('$B1', '2026-11-18', '$TYPO', 'Host New', 'Cust New', 'day');" >/dev/null
mid() { q "select id from missions where board_id = '$B1' and plan_date = '$2' and number = '$1'"; }
q "insert into assignments (employee_id, plan_date, mission_id) values
   ('$(E 1)', '2026-10-05', '$(mid "$RIGHT" 2026-10-05)'),
   ('$(E 2)', '2026-10-06', '$(mid "$RIGHT" 2026-10-06)'),
   ('$(E 3)', '2026-10-06', '$(mid "$TYPO" 2026-10-06)'),
   ('$(E 4)', '2026-10-07', '$(mid "$TYPO" 2026-10-07)'),
   ('$(E 1)', '2026-10-08', '$(mid "$TYPO" 2026-10-08)'),
   ('$(E 2)', '2026-11-18', '$(mid "$TYPO" 2026-11-18)');
   update missions set lead_employee_id = '$(E 3)' where id = '$(mid "$TYPO" 2026-10-06)';
   insert into deployment_history (employee_id, plan_date, mission_number, host, customer, board_id)
   values ('$(E 1)', '2026-10-08', '$TYPO', 'Host New', 'Cust New', '$B1');
   update plan_day_stamps set last_edited_at = '2026-10-08 09:00+07', last_edited_by = 'planner@example.com' where plan_date = '2026-10-08' and board_id = '$B1';
   -- the right number was closed on 7 October; the typo carried on (a closed number is not put on later days, a typo is)
   update mission_register set status = 'closed', closed_on = '2026-10-07', closed_by = 'admin@example.com', closed_at = now(), close_note = 'done'
    where number = '$RIGHT';
   -- the same job elsewhere, and a mission with no twin
   insert into missions (board_id, plan_date, number, host, customer, shift) values
   ('$B1', '2026-10-09', 'TSTTH.26.0060.', 'Host X', 'Cust X', 'day'), ('$B2', '2026-10-09', 'TSTTH.26.0060', 'Host Y', 'Cust Y', 'day'),
   ('$B1', '2026-10-09', 'TSTTH.26.0071.', 'Host Z', 'Cust Z', 'day'), ('$B1', '2026-10-09', 'BAD-2', 'Host Q', 'Cust Q', 'day');
   delete from allowed_email_domains;
   insert into auth.users (id, email) values
   ('00000000-0000-0000-0000-00000000000a', 'eng.a@example.com'), ('00000000-0000-0000-0000-00000000000b', 'site.b@example.com'),
   ('00000000-0000-0000-0000-00000000000c', 'viewer.c@example.com');
   update profiles set status = 'active', role_key = 'engineer'  where email = 'eng.a@example.com';
   update profiles set status = 'active', role_key = 'siteadmin' where email = 'site.b@example.com';
   update profiles set status = 'active', role_key = 'viewer'    where email = 'viewer.c@example.com';" >/dev/null
as() { local id; id="$(q "select id from auth.users where email = '$1'")"; echo "set request.jwt.claims = '{\"sub\":\"$id\",\"email\":\"$1\"}'; set role authenticated;"; }
qa() { $P -d $DB -c "$(as "$1") $2" 2>&1 || true; }

eq "select count(*) from mission_register where number in ('$RIGHT', '$TYPO')" 2 "before: two Missions list rows (the right one closed, the typo open)"
eq "select count(*) from assignments" 6 "before: six crew placements"
SA="$(q "select count(*) from assignments")"

case "$(qa viewer.c@example.com "select public.merge_mission_number('$TYPO', '$RIGHT')")" in *"cannot change"*) ok "a viewer cannot merge";; *) fail "a viewer could merge";; esac
case "$(qa eng.a@example.com "select public.merge_mission_number('$TYPO', '$RIGHT')")" in *"is closed. A Site Admin or a Manager"*) ok "an engineer cannot reopen a closed mission by merging";; *) fail "an engineer merged into a closed mission";; esac
case "$(qa site.b@example.com "select public.merge_mission_number('TSTTH.26.0060.', 'TSTTH.26.0060')")" in *"another board or shift"*) ok "a number also on another board is refused";; *) fail "a number on another board was merged";; esac
case "$(qa site.b@example.com "select public.merge_mission_number('$TYPO', 'TSTTH.26.0049.AA')")" in *"not in the form"*) ok "a wrong form is refused";; *) fail "a wrong form was accepted";; esac
# two different jobs are never merged, even on the same board and shift
case "$(qa site.b@example.com "select public.merge_mission_number('BAD-2', '$RIGHT')")" in *"not a mistyped spelling"*) ok "a different number on the same board and shift is not merged";; *) fail "two different jobs were merged";; esac
case "$(qa site.b@example.com "select public.merge_mission_number('TSTTH.26.0071.', '$RIGHT')")" in *"not a mistyped spelling"*) ok "nor a different job that is merely close";; *) fail "a close number was merged";; esac
eq "select count(*) from missions where number = '$TYPO'" 4 "nothing changed by the refusals"

eq "$(as site.b@example.com) select public.merge_mission_number('$TYPO', '$RIGHT')" 2 "a Site Admin merges: two days had both"
eq "select count(*) from missions where number = '$TYPO'" 0 "no day is left on the typo"
eq "select string_agg(plan_date::text, ',' order by plan_date) from missions where number = '$RIGHT' and board_id = '$B1'" "2026-10-05,2026-10-06,2026-10-07,2026-10-08,2026-11-18" "one card a day, every day of both"
eq "select count(*) from assignments" "$SA" "nobody lost: the same number of crew placements"
eq "select count(*) from assignments a join missions m on m.id = a.mission_id where m.number = '$RIGHT'" "$SA" "every placement is on a card of the right number"
eq "select string_agg(a.employee_id::text, ',' order by a.employee_id) from assignments a join missions m on m.id = a.mission_id where m.number = '$RIGHT' and m.plan_date = '2026-10-06'" "$(E 2),$(E 3)" "a day that had both: both crews"
eq "select coalesce(lead_employee_id::text, '') from missions where number = '$RIGHT' and plan_date = '2026-10-06'" "$(E 3)" "the Leader of the other card is kept when this one had none"
eq "select count(*) from mission_register where number in ('$RIGHT', '$TYPO')" 1 "the two Missions list rows are one"
eq "select status || '|' || coalesce(closed_on::text, '') || '|' || opened_on || '|' || last_on || '|' || host from mission_register where number = '$RIGHT'" "open||2026-10-05|2026-11-18|Host New" "open again, from the first day to the last, the details of the later one"
eq "select mission_number from deployment_history" "$RIGHT" "the Host Record follows"
eq "select old_number = '$TYPO' and new_number = '$RIGHT' from mission_number_history" t "the history records the merge"
eq "select last_edited_by from plan_day_stamps where board_id = '$B1' and plan_date = '2026-10-08'" "planner@example.com" "a day's edit stamp is kept"

eq "$(as site.b@example.com) select public.merge_mission_number('TSTTH.26.0071.', 'TSTTH.26.0071')" 0 "a typo with no twin is simply renamed"
eq "select count(*) from missions where number = 'TSTTH.26.0071'" 1 "its day takes the new number"
eq "select count(*) from mission_register where number = 'TSTTH.26.0071'" 1 "and its Missions list row"

# both closed stays closed
q "insert into missions (board_id, plan_date, number, host, customer, shift) values
   ('$B1', '2026-09-01', 'TSTTH.26.0081', 'H', 'C', 'night'), ('$B1', '2026-09-02', 'TSTTH.26.0081.', 'H', 'C', 'night');
   update mission_register set status = 'closed', closed_on = '2026-09-01' where number = 'TSTTH.26.0081';
   update mission_register set status = 'closed', closed_on = '2026-09-02' where number = 'TSTTH.26.0081.';" >/dev/null
eq "$(as eng.a@example.com) select public.merge_mission_number('TSTTH.26.0081.', 'TSTTH.26.0081')" 0 "two closed rows merge for an engineer too (nothing is reopened)"
eq "select status || '|' || closed_on from mission_register where number = 'TSTTH.26.0081'" "closed|2026-09-02" "and stay closed, to the later last day"
echo "all merge-mission-number checks passed"
