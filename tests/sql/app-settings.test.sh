#!/usr/bin/env bash
# migration-2026-11-09b (app_settings: the shared "days at a host that make someone experienced" and
# "a host is at risk at this many or fewer active experienced people")
# against a throwaway database built from schema.sql. Checks: a new database gets the table from
# schema.sql; on an older database the migration creates it and a re-run changes nothing (a saved
# value stays, and a table that only has the first version of the check is brought up to date);
# host_experienced_days accepts whole numbers 1-365 and nothing else, host_at_risk_max whole
# numbers 0-99 and nothing else; who may read
# (any active account) and who may change it (Edit on Settings); the table is in the Realtime
# publication. Needs a local Postgres (PGHOST/PGPORT/PGUSER as for the other tests/sql scripts).
# Fixtures are fake.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=app_settings_test
export PGOPTIONS='-c client_min_messages=warning'
MIG=supabase/migration-2026-11-09b-app-settings.sql
P="psql -v ON_ERROR_STOP=1 -q -X -At"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }
q() { $P -d $DB -c "$1"; }
eq() { local got; got="$(q "$1")"; [ "$got" = "$2" ] || fail "$3 (expected '$2', got '$got')"; ok "$3"; }
bash tests/sql/setup-db.sh $DB >/dev/null

eq "select to_regclass('public.app_settings') is not null" t "schema.sql adds app_settings"

# ---------- an older database: no table yet ----------
q "drop table app_settings" >/dev/null
eq "select to_regclass('public.app_settings') is null" t "an older database has no app_settings"
$P -d $DB -f $MIG >/dev/null
eq "select to_regclass('public.app_settings') is not null" t "the migration creates it"
eq "select count(*) from app_settings" 0 "nothing is seeded: a setting with no row uses the app's default"

# ---------- users ----------
q "delete from allowed_email_domains;
   insert into auth.users (id, email) values
   ('00000000-0000-0000-0000-00000000000a', 'eng.a@example.com'), ('00000000-0000-0000-0000-00000000000b', 'mgr.b@example.com'),
   ('00000000-0000-0000-0000-00000000000c', 'viewer.c@example.com'), ('00000000-0000-0000-0000-00000000000d', 'site.d@example.com'),
   ('00000000-0000-0000-0000-00000000000e', 'pending.e@example.com');
   update profiles set status = 'active', role_key = 'engineer'  where email = 'eng.a@example.com';
   update profiles set status = 'active', role_key = 'manager'   where email = 'mgr.b@example.com';
   update profiles set status = 'active', role_key = 'viewer'    where email = 'viewer.c@example.com';
   update profiles set status = 'active', role_key = 'siteadmin' where email = 'site.d@example.com';" >/dev/null
as() { local id; id="$(q "select id from auth.users where email = '$1'")"; echo "set request.jwt.claims = '{\"sub\":\"$id\",\"email\":\"$1\"}'; set role authenticated;"; }
qa() { $P -d $DB -c "$(as "$1") $2" 2>&1 || true; }
refused() { echo "$1" | grep -q "row-level security" || fail "$2 (got: $1)"; ok "$2"; }
check_refused() { echo "$1" | grep -q "app_settings_value_ok" || fail "$2 (got: $1)"; ok "$2"; }

# ---------- who may change it ----------
out="$(qa eng.a@example.com "insert into app_settings (key, value, updated_by) values ('host_experienced_days', '7', 'eng.a@example.com')")"
[ -z "$out" ] || [ "$out" = "INSERT 0 1" ] || fail "an Engineer (Edit on Settings) saves it (got: $out)"
ok "an Engineer, who has Edit on Settings, can set it"
eq "select value from app_settings where key = 'host_experienced_days'" 7 "the value is stored"
eq "select updated_by from app_settings where key = 'host_experienced_days'" eng.a@example.com "who changed it is stored"

out="$(qa mgr.b@example.com "insert into app_settings (key, value) values ('host_experienced_days', '10') on conflict (key) do update set value = excluded.value")"
eq "select value from app_settings where key = 'host_experienced_days'" 10 "a Manager can change it (an upsert updates the one row)"
eq "select count(*) from app_settings" 1 "still one row"

out="$(qa viewer.c@example.com "update app_settings set value = '3' where key = 'host_experienced_days'; select value from app_settings")"
eq "select value from app_settings where key = 'host_experienced_days'" 10 "a Viewer's update changes nothing"
out="$(qa viewer.c@example.com "insert into app_settings (key, value) values ('other', '1')")"
refused "$out" "a Viewer cannot add a row"
out="$(qa viewer.c@example.com "delete from app_settings; select count(*) from app_settings")"
eq "select count(*) from app_settings" 1 "a Viewer cannot delete it"
out="$(qa site.d@example.com "insert into app_settings (key, value) values ('other', '1')")"
refused "$out" "a Site Admin (no Edit on Settings) cannot add a row"

# ---------- who may read ----------
out="$(qa viewer.c@example.com "select value from app_settings where key = 'host_experienced_days'")"
[ "$(echo "$out" | head -1)" = "10" ] || fail "a Viewer reads it (got: $out)"
ok "any active account can read it, a Viewer too"
out="$(qa pending.e@example.com "select count(*) from app_settings")"
[ "$(echo "$out" | head -1)" = "0" ] || fail "an account that is not active reads nothing (got: $out)"
ok "an account that is not active sees nothing"

# ---------- the value ----------
for v in 1 5 365; do
  q "insert into app_settings (key, value) values ('host_experienced_days', '$v') on conflict (key) do update set value = excluded.value" >/dev/null
  eq "select value from app_settings where key = 'host_experienced_days'" $v "$v days is accepted"
done
for v in 0 366 -3 2.5 '"7"' null '[5]' 5.0; do
  out="$($P -d $DB -c "insert into app_settings (key, value) values ('host_experienced_days', '$v') on conflict (key) do update set value = excluded.value" 2>&1 || true)"
  check_refused "$out" "$v is refused"
done
eq "select value from app_settings where key = 'host_experienced_days'" 365 "a refused value leaves the saved one alone"
for v in 0 1 2 99; do
  q "insert into app_settings (key, value) values ('host_at_risk_max', '$v') on conflict (key) do update set value = excluded.value" >/dev/null
  eq "select value from app_settings where key = 'host_at_risk_max'" $v "host_at_risk_max accepts $v"
done
for v in -1 100 2.5 '"3"' null '[2]' 2.0 1000; do
  out="$($P -d $DB -c "insert into app_settings (key, value) values ('host_at_risk_max', '$v') on conflict (key) do update set value = excluded.value" 2>&1 || true)"
  check_refused "$out" "host_at_risk_max refuses $v"
done
eq "select value from app_settings where key = 'host_at_risk_max'" 99 "a refused value leaves the saved one alone (at risk)"
q "insert into app_settings (key, value) values ('some_other_setting', '\"free\"')" >/dev/null
ok "the check applies to the two known settings only, so later settings can hold other values"

# ---------- a table made by the first version of this migration (only host_experienced_days checked) ----------
q "alter table app_settings drop constraint app_settings_value_ok;
   alter table app_settings add constraint app_settings_value_ok check (
     key <> 'host_experienced_days' or (jsonb_typeof(value) = 'number'
       and case when (value #>> '{}') ~ '^[0-9]{1,3}\$' then (value #>> '{}')::int between 1 and 365 else false end));
   update app_settings set value = '500' where key = 'host_at_risk_max';" >/dev/null
eq "select value from app_settings where key = 'host_at_risk_max'" 500 "the first version let any host_at_risk_max in"
$P -d $DB -c "alter table app_settings drop constraint app_settings_value_ok" >/dev/null
q "update app_settings set value = '2' where key = 'host_at_risk_max'" >/dev/null
$P -d $DB -f $MIG >/dev/null
eq "select value from app_settings where key = 'host_at_risk_max'" 2 "re-running on it keeps the saved values"
out="$($P -d $DB -c "update app_settings set value = '500' where key = 'host_at_risk_max'" 2>&1 || true)"
check_refused "$out" "and the check now covers host_at_risk_max"
q "update app_settings set value = '12' where key = 'host_experienced_days'" >/dev/null

# ---------- re-running ----------
q "update app_settings set value = '12' where key = 'host_experienced_days'" >/dev/null
$P -d $DB -f $MIG >/dev/null
eq "select value from app_settings where key = 'host_experienced_days'" 12 "a re-run keeps a value saved in Settings"
eq "select count(*) from pg_policy where polrelid = 'app_settings'::regclass" 4 "a re-run leaves four policies, not eight"
eq "select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'app_settings'" 1 "the table is in the Realtime publication"

echo "all app_settings checks passed"
