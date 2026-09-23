#!/usr/bin/env bash
# Tests migration-2026-09-24b-forward-planning-data.sql against a throwaway DB:
# dry run changes nothing and its counts match what the move then does; the
# move leaves no confirmed rows on/after the cutoff; only the moved (employee,
# date) pairs lose their deployment_history; a second run is a no-op.
# Usage: tests/sql/data-migration.test.sh   (PGHOST/PGPORT/PGUSER select the server)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=fp_datamig
tests/sql/setup-db.sh "$DB" >/dev/null 2>&1
Q() { psql -X -v ON_ERROR_STOP=1 -qAt -d "$DB" -c "$1"; }
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }

CUT=$(Q "select ((now() at time zone 'Asia/Bangkok')::date + 3)::text")
TOMORROW=$(Q "select ((now() at time zone 'Asia/Bangkok')::date + 1)::text")
MIG=$(mktemp); sed "s/date '2026-10-02' as cutoff/date '$CUT' as cutoff/" supabase/migration-2026-09-24b-forward-planning-data.sql > "$MIG"
grep -q "date '$CUT' as cutoff" "$MIG" || fail "could not set the cutoff"
MOVE=$(mktemp); sed "s/false             as do_move/true              as do_move/" "$MIG" > "$MOVE"
grep -q "true              as do_move" "$MOVE" || fail "could not flip do_move"

psql -X -v ON_ERROR_STOP=1 -q -d "$DB" <<SQL
insert into boards (id, name) values ('10000000-0000-0000-0000-000000000001', 'Board One');
insert into employees (id, name, contract, board_id) values
  ('20000000-0000-0000-0000-000000000001', 'P1', 'permanent', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', 'P2', 'permanent', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000003', 'P3', 'oncall',    '10000000-0000-0000-0000-000000000001');
-- tomorrow (stays confirmed) and two dates on/after the cutoff
insert into missions (id, board_id, plan_date, number, host, customer, shift, updated_by) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '$TOMORROW', 'M1', 'H', 'C', 'day', 'eng.a@example.com'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '$CUT', 'M1', 'H', 'C', 'day', 'eng.a@example.com'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '$CUT', 'M2', 'H', 'C', 'night', null),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '$CUT'::date + 1, 'M1', 'H', 'C', 'day', 'eng.b@example.com'),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '$CUT', 'HID', 'H', 'C', 'day', null);
update missions set hidden = true where number = 'HID';
insert into assignments (employee_id, plan_date, mission_id, zone, updated_by) values
  ('20000000-0000-0000-0000-000000000001', '$TOMORROW', '30000000-0000-0000-0000-000000000001', null, 'eng.a@example.com'),
  ('20000000-0000-0000-0000-000000000001', '$CUT', '30000000-0000-0000-0000-000000000002', null, 'eng.b@example.com'),
  ('20000000-0000-0000-0000-000000000002', '$CUT', '30000000-0000-0000-0000-000000000003', null, null),
  ('20000000-0000-0000-0000-000000000003', '$CUT', null, 'annual', null),
  ('20000000-0000-0000-0000-000000000002', '$CUT'::date + 1, '30000000-0000-0000-0000-000000000004', null, null);
insert into deployment_history (employee_id, plan_date, mission_number, host, board_id) values
  ('20000000-0000-0000-0000-000000000001', '$TOMORROW', 'M1', 'H', '10000000-0000-0000-0000-000000000001'),   -- tomorrow: kept
  ('20000000-0000-0000-0000-000000000001', '$CUT', 'M1', 'H', '10000000-0000-0000-0000-000000000001'),        -- moved pair: deleted
  ('20000000-0000-0000-0000-000000000002', '$CUT'::date + 1, 'M1', 'H', '10000000-0000-0000-0000-000000000001'), -- moved pair: deleted
  ('20000000-0000-0000-0000-000000000003', '$CUT'::date + 2, 'OLD', 'H', '10000000-0000-0000-0000-000000000001'), -- no assignment behind it: kept (not by date alone)
  ('20000000-0000-0000-0000-000000000002', '2020-01-06', 'PAST', 'H', '10000000-0000-0000-0000-000000000001');  -- past: kept
SQL

snapshot() { Q "select (select count(*) from missions)||'/'||(select count(*) from assignments)||'/'||(select count(*) from deployment_history)||'/'||(select count(*) from forecast_missions)||'/'||(select count(*) from forecast_assignments)"; }

BEFORE=$(snapshot)
DRY=$(psql -X -v ON_ERROR_STOP=1 -qAt -F'|' -d "$DB" -f "$MIG" 2>/dev/null | grep '^DRY RUN — will move|2|TOTAL')
[ "$(snapshot)" = "$BEFORE" ] || fail "dry run changed data"
ok "dry run changes nothing"
# phase|ord|board|date|missions|crew|leave|dh|hidden|already_fm|already_fc
IFS='|' read -r _ _ _ _ D_M D_C D_L D_DH D_HID _ _ <<< "$DRY"
[ "$D_M/$D_C/$D_L/$D_DH/$D_HID" = "3/3/1/2/1" ] || fail "dry run totals were $D_M/$D_C/$D_L/$D_DH/$D_HID, expected 3/3/1/2/1"
ok "dry run totals: 3 missions, 3 crew, 1 leave, 2 deployment_history, 1 hidden dropped"

AFTER_OUT=$(psql -X -v ON_ERROR_STOP=1 -qAt -F'|' -d "$DB" -f "$MOVE" 2>/dev/null | grep '|2|TOTAL')
IFS='|' read -r _ _ _ _ A_M A_C A_L A_DH A_HID A_FM A_FC <<< "$AFTER_OUT"
[ "$A_M/$A_C/$A_L/$A_DH/$A_HID" = "0/0/0/0/0" ] || fail "confirmed rows left after move: $A_M/$A_C/$A_L/$A_DH/$A_HID"
ok "after the move no confirmed rows remain on/after the cutoff"
[ "$(Q "select count(*) from forecast_missions")" = "$D_M" ] || fail "forecast mission count differs from dry run"
[ "$(Q "select count(*) from forecast_assignments where forecast_mission_id is not null")" = "$D_C" ] || fail "forecast crew count differs from dry run"
[ "$(Q "select count(*) from forecast_assignments where zone is not null")" = "$D_L" ] || fail "forecast leave count differs from dry run"
ok "moved counts match the dry run"
[ "$(Q "select count(*) from missions where plan_date = '$TOMORROW'")/$(Q "select count(*) from assignments where plan_date = '$TOMORROW'")" = "1/1" ] || fail "tomorrow's confirmed plan was touched"
ok "tomorrow's confirmed plan is untouched"
[ "$(Q "select string_agg(mission_number, ',' order by plan_date) from deployment_history")" = "PAST,M1,OLD" ] || fail "deployment_history cleanup was wrong: $(Q "select string_agg(mission_number||'@'||plan_date, ',') from deployment_history")"
ok "D4: only moved (employee, date) pairs lost their deployment_history"
[ "$(Q "select string_agg(held_by, ',' order by held_by) from forecast_assignments")" = "eng.b@example.com,eng.b@example.com,migrated,migrated" ] \
  && true || fail "held_by attribution wrong: $(Q "select string_agg(held_by, ',' order by held_by) from forecast_assignments")"
ok "held_by = assignment.updated_by, else mission.updated_by, else 'migrated'"
[ "$(Q "select count(*) from forecast_assignments fa join forecast_missions fm on fm.id = fa.forecast_mission_id where fm.number = 'M1' and fm.plan_date = '$CUT' and fa.employee_id = '20000000-0000-0000-0000-000000000001'")" = "1" ] || fail "placement not re-pointed at the moved mission"
ok "mission placements point at the moved forecast mission"

SNAP=$(snapshot)
psql -X -v ON_ERROR_STOP=1 -qAt -d "$DB" -f "$MOVE" >/dev/null 2>&1
[ "$(snapshot)" = "$SNAP" ] || fail "second run changed data"
ok "re-running the move is a no-op"

EARLY=$(mktemp); sed "s/date '2026-10-02' as cutoff/date '$TOMORROW' as cutoff/" supabase/migration-2026-09-24b-forward-planning-data.sql > "$EARLY"
if psql -X -v ON_ERROR_STOP=1 -q -d "$DB" -f "$EARLY" >/dev/null 2>&1; then fail "a cutoff of tomorrow was accepted"; fi
ok "a cutoff of tomorrow or earlier is refused"
rm -f "$MIG" "$MOVE" "$EARLY"
echo "ALL DATA-MIGRATION TESTS PASSED"
