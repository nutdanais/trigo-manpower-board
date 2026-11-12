#!/usr/bin/env bash
# migration-2026-11-12 (plan_day_ready: the "my part is planned" ticks on a board's day)
# against a throwaway database built from schema.sql. Checks: a new database gets the table from
# schema.sql; on an older database the migration creates it and a re-run changes nothing (a tick
# stays); an Engineer ticks and unticks their own name but not someone else's; a Manager and an
# Admin tick for anyone; a Viewer and an account that is not active cannot tick; any active account
# reads the ticks; deleting a board or an engineer takes their ticks with them; the table is in the
# Realtime publication. Needs a local Postgres (PGHOST/PGPORT/PGUSER as for the other tests/sql
# scripts). Fixtures are fake.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=plan_day_ready_test
export PGOPTIONS='-c client_min_messages=warning'
MIG=supabase/migration-2026-11-12-plan-day-ready.sql
P="psql -v ON_ERROR_STOP=1 -q -X -At"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }
q() { $P -d $DB -c "$1"; }
eq() { local got; got="$(q "$1")"; [ "$got" = "$2" ] || fail "$3 (expected '$2', got '$got')"; ok "$3"; }
bash tests/sql/setup-db.sh $DB >/dev/null

eq "select to_regclass('public.plan_day_ready') is not null" t "schema.sql adds plan_day_ready"

# ---------- an older database: no table yet ----------
q "drop table plan_day_ready; drop function public.can_tick_ready(uuid)" >/dev/null
eq "select to_regclass('public.plan_day_ready') is null" t "an older database has no plan_day_ready"
$P -d $DB -f $MIG >/dev/null
eq "select to_regclass('public.plan_day_ready') is not null" t "the migration creates it"

# ---------- users, a board and their engineer records ----------
q "delete from allowed_email_domains;
   insert into auth.users (id, email) values
   ('00000000-0000-0000-0000-00000000000a', 'eng.a@example.com'), ('00000000-0000-0000-0000-00000000000b', 'eng.b@example.com'),
   ('00000000-0000-0000-0000-00000000000c', 'mgr.c@example.com'), ('00000000-0000-0000-0000-00000000000d', 'admin.d@example.com'),
   ('00000000-0000-0000-0000-00000000000e', 'viewer.e@example.com'), ('00000000-0000-0000-0000-00000000000f', 'pending.f@example.com');
   update profiles set status = 'active', role_key = 'engineer' where email in ('eng.a@example.com', 'eng.b@example.com');
   update profiles set status = 'active', role_key = 'manager'  where email = 'mgr.c@example.com';
   update profiles set status = 'active', role_key = 'admin'    where email = 'admin.d@example.com';
   update profiles set status = 'active', role_key = 'viewer'   where email = 'viewer.e@example.com';
   insert into boards (id, name) values ('10000000-0000-0000-0000-000000000001', 'Test board');" >/dev/null
# an engineer record per engineer account (made by the app's trigger where it exists, else here)
for who in a b; do
  q "insert into engineers (name, profile_id) select 'Eng $who', '00000000-0000-0000-0000-00000000000$who'
     where not exists (select 1 from engineers where profile_id = '00000000-0000-0000-0000-00000000000$who')" >/dev/null
done
q "insert into engineers (id, name) values ('20000000-0000-0000-0000-000000000009', 'No account')" >/dev/null
EA="$(q "select id from engineers where profile_id = '00000000-0000-0000-0000-00000000000a'")"
EB="$(q "select id from engineers where profile_id = '00000000-0000-0000-0000-00000000000b'")"
EN=20000000-0000-0000-0000-000000000009
BRD=10000000-0000-0000-0000-000000000001
as() { local id; id="$(q "select id from auth.users where email = '$1'")"; echo "set request.jwt.claims = '{\"sub\":\"$id\",\"email\":\"$1\"}'; set role authenticated;"; }
qa() { $P -d $DB -c "$(as "$1") $2" 2>&1 || true; }
refused() { echo "$1" | grep -q "row-level security" || fail "$2 (got: $1)"; ok "$2"; }
tick() { qa "$1" "insert into plan_day_ready (board_id, plan_date, engineer_id, ticked_by) values ('$BRD', '2026-11-12', '$2', '$1')"; }
ticked() { q "select count(*) from plan_day_ready where engineer_id = '$1'"; }

# ---------- an Engineer: their own name only ----------
out="$(tick eng.a@example.com "$EA")"
[ "$(ticked "$EA")" = 1 ] || fail "an Engineer ticks their own name (got: $out)"
ok "an Engineer ticks their own name"
eq "select ticked_by from plan_day_ready where engineer_id = '$EA'" eng.a@example.com "who ticked is stored"
refused "$(tick eng.a@example.com "$EB")" "an Engineer cannot tick another engineer"
refused "$(tick eng.a@example.com "$EN")" "an Engineer cannot tick an engineer with no account"
qa eng.b@example.com "delete from plan_day_ready where engineer_id = '$EA'" >/dev/null
eq "select count(*) from plan_day_ready where engineer_id = '$EA'" 1 "another Engineer cannot untick it"
qa eng.a@example.com "delete from plan_day_ready where engineer_id = '$EA'" >/dev/null
eq "select count(*) from plan_day_ready where engineer_id = '$EA'" 0 "an Engineer unticks their own name"

# ---------- a Manager and an Admin: anyone ----------
tick mgr.c@example.com "$EB" >/dev/null
eq "select ticked_by from plan_day_ready where engineer_id = '$EB'" mgr.c@example.com "a Manager ticks for an engineer, and is recorded as who ticked"
tick admin.d@example.com "$EN" >/dev/null
eq "select count(*) from plan_day_ready where engineer_id = '$EN'" 1 "an Admin ticks for an engineer with no account"
qa mgr.c@example.com "delete from plan_day_ready where engineer_id = '$EN'" >/dev/null
eq "select count(*) from plan_day_ready where engineer_id = '$EN'" 0 "a Manager unticks someone else's tick"
out="$(tick eng.a@example.com "$EA")"
out="$(tick eng.a@example.com "$EA")"
echo "$out" | grep -q "duplicate key" || fail "ticking twice is refused as a duplicate, not stored twice (got: $out)"
eq "select count(*) from plan_day_ready where engineer_id = '$EA'" 1 "one tick per engineer per board per day"

# ---------- a Viewer, and an account that is not active ----------
refused "$(tick viewer.e@example.com "$EA")" "a Viewer (view only on the Board) cannot tick"
refused "$(tick pending.f@example.com "$EA")" "an account that is not active cannot tick"
qa viewer.e@example.com "delete from plan_day_ready" >/dev/null
eq "select count(*) from plan_day_ready" 2 "a Viewer cannot untick"
out="$(qa viewer.e@example.com "select count(*) from plan_day_ready")"
[ "$(echo "$out" | tail -1)" = "2" ] || fail "a Viewer reads the ticks (got: $out)"
ok "any active account reads the ticks, a Viewer too"
out="$(qa pending.f@example.com "select count(*) from plan_day_ready")"
[ "$(echo "$out" | tail -1)" = "0" ] || fail "an account that is not active reads nothing (got: $out)"
ok "an account that is not active sees nothing"

# ---------- re-run, cascades, Realtime ----------
$P -d $DB -f $MIG >/dev/null
eq "select count(*) from plan_day_ready" 2 "a re-run keeps the ticks"
eq "select count(*) from pg_policies where tablename = 'plan_day_ready'" 3 "a re-run leaves three policies, not six"
q "delete from engineers where id = '$EB'" >/dev/null
eq "select count(*) from plan_day_ready where engineer_id = '$EB'" 0 "deleting an engineer takes their ticks"
q "delete from boards where id = '$BRD'" >/dev/null
eq "select count(*) from plan_day_ready" 0 "deleting a board takes its ticks"
eq "select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'plan_day_ready'" 1 "the table is in the Realtime publication"

psql -q -X -d postgres -c "drop database if exists $DB" >/dev/null
echo "all plan_day_ready checks passed"
