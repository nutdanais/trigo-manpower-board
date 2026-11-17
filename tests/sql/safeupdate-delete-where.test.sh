#!/usr/bin/env bash
# migration-2026-11-17: "DELETE requires a WHERE clause" when fixing a mission number.
# Supabase runs the app's calls with pg-safeupdate, which refuses a DELETE or UPDATE without a WHERE
# clause, inside functions too. A plain local Postgres does not have it, so the other tests never saw
# replace_mission_number / renumber_missions fail. This one looks for the cause instead: a function
# body or a SQL file with a bare "delete from x;" / "update x set ...;". It also checks that the
# migration leaves the two functions exactly as schema.sql defines them, that it runs twice, and that
# a number can still be fixed afterwards. Needs a local Postgres (PGHOST/PGPORT/PGUSER as for the
# other tests/sql scripts). Fixtures are fake.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=safeupdate_delete_where_test
export PGOPTIONS='-c client_min_messages=warning'
MIG=supabase/migration-2026-11-17-mission-number-delete-where.sql
P="psql -v ON_ERROR_STOP=1 -q -X -At"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok - $*"; }
q() { $P -d $DB -c "$1"; }
eq() { local got; got="$(q "$1")"; [ "$got" = "$2" ] || fail "$3 (expected '$2', got '$got')"; ok "$3"; }

# --- the SQL files: no bare DELETE / UPDATE statement (the tests' own clean-up scripts are not checked)
bad="$(python3 -I - <<'EOF'
import glob, re
for f in sorted(glob.glob("supabase/*.sql")):
    s = open(f, encoding="utf-8").read()
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)       # notes in comments are not statements
    s = re.sub(r"--[^\n]*", "", s)
    for m in re.finditer(r"\bdelete\s+from\s+[\w.\"]+\s*;|\bupdate\s+[\w.\"]+\s+set\s[^;]*;", s, flags=re.I):
        if not re.search(r"\bwhere\b", m.group(0), flags=re.I):
            print(f + ": " + " ".join(m.group(0).split())[:80])
EOF
)"
[ -z "$bad" ] || fail "a DELETE or UPDATE without WHERE in the SQL files: $bad"
ok "no DELETE or UPDATE without a WHERE clause in supabase/*.sql"

# --- the database: built from schema.sql, then the migration on top (twice)
bash tests/sql/setup-db.sh $DB >/dev/null
FN="select string_agg(p.proname || ':' || md5(p.prosrc), ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('replace_mission_number', 'renumber_missions')"
SCHEMA_FN="$(q "$FN")"
[ -n "$SCHEMA_FN" ] || fail "schema.sql defines neither function"

# the DELETE pattern in any public function body (how pg-safeupdate would see it)
BARE_FN="select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosrc ~* 'delete\s+from\s+[a-z0-9_.\"]+\s*;'"
eq "$BARE_FN" "" "no function in the database empties a table without a WHERE clause"

# an old database still has the bare DELETE: put those two functions back as they were, then migrate
q "create or replace function public.replace_mission_number(p_old text, p_new text) returns int language plpgsql as \$f\$ begin delete from _replace_stamps; return 0; end; \$f\$;
   create or replace function public.renumber_missions(p_items jsonb, p_valid_from date) returns int language plpgsql as \$f\$ begin delete from _renumber_stamps; return 0; end; \$f\$;" >/dev/null
eq "$BARE_FN" "renumber_missions,replace_mission_number" "the check does catch the old, refused form"

$P -d $DB -f $MIG >/dev/null
$P -d $DB -f $MIG >/dev/null
ok "the migration runs twice"
eq "$BARE_FN" "" "after the migration neither function has a bare DELETE"
eq "$FN" "$SCHEMA_FN" "the migration leaves both functions exactly as schema.sql defines them"

# --- a number can still be fixed
B1=10000000-0000-0000-0000-000000000001
q "insert into boards (id, name) values ('$B1', 'Board One');
   insert into missions (board_id, plan_date, number, host, customer, shift) values
   ('$B1', '2026-11-02', 'TSTTH.26.0075.', 'Host A', 'Cust A', 'day'),
   ('$B1', '2026-11-03', 'TSTTH.26.0075.', 'Host A', 'Cust A', 'day');" >/dev/null
q "delete from allowed_email_domains;
   insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'eng.a@example.com');
   update profiles set status = 'active', role_key = 'engineer' where email = 'eng.a@example.com';" >/dev/null
as() { echo "set request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-00000000000a\",\"email\":\"$1\"}'; set role authenticated;"; }
eq "$(as eng.a@example.com) select public.replace_mission_number('TSTTH.26.0075.', 'TSTTH. 26.0075')" 1 "an engineer fixes a number with a stray dot and a space"
eq "select count(*) from missions where number = 'TSTTH.26.0075'" 2 "every day takes the corrected number"
eq "select count(*) from mission_number_history where old_number = 'TSTTH.26.0075.' and new_number = 'TSTTH.26.0075'" 1 "the history records it"

echo "all safeupdate-delete-where checks passed"
