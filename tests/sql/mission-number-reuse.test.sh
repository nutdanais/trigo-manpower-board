#!/usr/bin/env bash
# migration-2026-11-18 (replace_mission_number): a number only in the rename history is free to type again.
# A job whose number was typed with a stray dot (.TSTTH.26.0049) must be correctable to TSTTH.26.0049 even
# when that number is in mission_number_history from an earlier rename and no mission has it now. Checks:
# a history-only Etraq number is accepted (as the old number of a past rename, and as the new one); a number
# on the Missions list or on a day is still refused; a replaced temporary number is never given out twice;
# the migration runs twice. Needs a local Postgres (PGHOST/PGPORT/PGUSER as for the other tests/sql scripts).
# Fixtures are fake.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=mission_number_reuse_test
export PGOPTIONS='-c client_min_messages=warning'
P="psql -v ON_ERROR_STOP=1 -q -X -At"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }
q() { $P -d $DB -c "$1"; }
eq() { local got; got="$(q "$1")"; [ "$got" = "$2" ] || fail "$3 (expected '$2', got '$got')"; ok "$3"; }
bash tests/sql/setup-db.sh $DB >/dev/null
# an older database has the 2026-11-11 version of the function: the migration replaces it
$P -d $DB -f supabase/migration-2026-11-11-mission-number-rules.sql >/dev/null
$P -d $DB -f supabase/migration-2026-11-17-mission-number-delete-where.sql >/dev/null
$P -d $DB -f supabase/migration-2026-11-18-mission-number-reuse.sql >/dev/null
$P -d $DB -f supabase/migration-2026-11-18-mission-number-reuse.sql >/dev/null
ok "the migration runs twice"

B=10000000-0000-0000-0000-000000000001
q "insert into boards (id, name) values ('$B', 'Board One');
   insert into missions (board_id, plan_date, number, host, customer, shift) values
   ('$B', '2026-11-02', '.TSTTH.26.0049', 'Host A', 'Cust A', 'day'),
   ('$B', '2026-11-03', '.TSTTH.26.0049', 'Host A', 'Cust A', 'day'),
   ('$B', '2026-11-03', '.TSTTH.26.0050', 'Host B', 'Cust B', 'day'),
   ('$B', '2026-11-03', '.TSTTH.26.0051', 'Host C', 'Cust C', 'day'),
   ('$B', '2026-11-03', 'TSTTH.26.0007', 'Host D', 'Cust D', 'day'),
   ('$B', '2026-11-03', 'TSTTH.26.TMP001', 'Host E', 'Cust E', 'day');
   -- earlier renames: 0049 was a number a mission had before it was renamed away; 0051 is what something was renamed to
   insert into mission_number_history (old_number, new_number, valid_from, entered_by) values
   ('TSTTH.26.0049', 'TSTTH.27.0001', '2027-01-01', 'admin@example.com'),
   ('BAD-0051', 'TSTTH.26.0051', '2026-11-01', 'admin@example.com'),
   ('TSTTH.26.TMP009', 'TSTTH.26.0009', '2026-11-01', 'admin@example.com');
   delete from allowed_email_domains;
   insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'eng.a@example.com');
   update profiles set status = 'active', role_key = 'engineer' where email = 'eng.a@example.com';" >/dev/null
as() { echo "set request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-00000000000a\",\"email\":\"eng.a@example.com\"}'; set role authenticated;"; }
qa() { $P -d $DB -c "$(as) $1" 2>&1 || true; }

eq "select count(*) from mission_register where number = 'TSTTH.26.0049'" 0 "no mission is on the corrected number"
eq "$(as) select public.replace_mission_number('.TSTTH.26.0049', 'TSTTH.26.0049')" 1 "a typo goes back to a number that is only in the history (it was the old side of a past rename)"
eq "select count(*) from missions where number = 'TSTTH.26.0049'" 2 "every day takes it"
eq "select count(*) from mission_number_history where old_number = '.TSTTH.26.0049' and new_number = 'TSTTH.26.0049'" 1 "and the history records the correction"
eq "$(as) select public.replace_mission_number('.TSTTH.26.0051', 'TSTTH.26.0051')" 1 "a number that is only the new side of a past rename is free too"

case "$(qa "select public.replace_mission_number('.TSTTH.26.0050', 'TSTTH.26.0007')")" in *"already used"*) ok "a number on the Missions list is still refused";; *) fail "a number in use was accepted";; esac
q "insert into missions (board_id, plan_date, number, host, customer, shift) values ('$B', '2026-11-04', 'TSTTH.26.0300', 'Host F', 'Cust F', 'night');
   delete from mission_register where number = 'TSTTH.26.0300';" >/dev/null
# a day with the number but no register row (the register is kept by a trigger, so remove its row by hand)
case "$(qa "select public.replace_mission_number('.TSTTH.26.0050', 'TSTTH.26.0300')")" in *"already used"*) ok "a number still on a day is refused";; *) fail "a number on a day was accepted";; esac
q "insert into mission_number_history (old_number, new_number, valid_from, entered_by) values ('TSTTH.26.TMP002', 'TSTTH.26.0002', '2026-11-01', 'admin@example.com')" >/dev/null
q "update missions set number = 'BAD-9' where number = '.TSTTH.26.0050'" >/dev/null   # the register trigger adds its row
case "$(qa "select public.replace_mission_number('BAD-9', 'TSTTH.26.TMP002')")" in *"already used"*) ok "a replaced temporary number is never given out twice";; *) fail "a replaced temporary number was given out again";; esac
eq "$(as) select public.replace_mission_number('BAD-9', 'TSTTH.26.TMP003')" 1 "a temporary number nobody had is accepted"

echo "all mission-number-reuse checks passed"
