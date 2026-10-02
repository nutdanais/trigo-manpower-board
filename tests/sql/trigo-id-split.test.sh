#!/usr/bin/env bash
# The migration's SQL split must agree with splitNameAndId() in employee-id.js on
# every name below, and must leave the unsplittable ones alone. Needs a local
# Postgres (PGHOST/PGPORT/PGUSER as for the other tests/sql scripts).
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=trigotest
P="psql -v ON_ERROR_STOP=1 -q -X"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$P -d $DB -c "create table employees (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz default now())" >/dev/null

CASES=$(node -e '
const cases = ["Wannaphatson T329","T330 Somchai Jaidee","Somchai Jaidee (T331)","Somchai Jaidee [t332]","Somchai - T333","สมชาย ใจดี T001",
 "สมชาย ใจดี (T12)","T340","T341 123","Somchai T342 Jaidee","T1 Somchai T2","Tanaporn Chai","Matt5","Somchai T1234567","Somchai T",
 "  somchai   t 343 ","T344Somchai","Somchai.P","Anan T345 ","Ben (T5) ","(T7) Chai Dee","Chai Dee T0042","Plain Name","ปัญญา นาลาด"];
process.stdout.write(JSON.stringify(cases));')
node -e "for (const c of JSON.parse(process.argv[1])) console.log(c.replace(/'/g, \"''\"))" "$CASES" | while IFS= read -r n; do
  $P -d $DB -c "insert into employees(name) values ('$n')" >/dev/null
done
# two people whose names carry the same ID, and one whose ID is already taken
$P -d $DB -c "insert into employees(name) values ('Dup One T900'),('Dup Two T900')" >/dev/null

$P -d $DB -f supabase/migration-2026-10-03-trigo-id.sql >/dev/null
$P -d $DB -f supabase/migration-2026-10-03-trigo-id.sql >/dev/null   # a second run changes nothing

GOT=$($P -d $DB -At -c "select coalesce(json_agg(json_build_object('o', b.old_name, 'n', e.name, 'i', e.trigo_id) order by b.old_name), '[]') from employees e join employees_name_backup_trigo b on b.employee_id = e.id")
UNTOUCHED=$($P -d $DB -At -c "select coalesce(json_agg(name order by name), '[]') from employees where trigo_id is null")
export CASES GOT UNTOUCHED
node -e '
const E = require("./employee-id.js"), assert = require("node:assert/strict");
const cases = JSON.parse(process.env.CASES).concat(["Dup One T900", "Dup Two T900"]);
const norm = (s) => s.replace(/\s+/g, " ").trim();
const want = [], keep = [];
for (const c of cases) {
  const r = E.splitNameAndId(c);
  if (r && !/T900$/.test(c)) want.push({ o: norm(c), n: r.name, i: r.trigoId }); else keep.push(c);   // T900 is on two names: both skipped
}
want.sort((a, b) => (a.o < b.o ? -1 : a.o > b.o ? 1 : 0));
const got = JSON.parse(process.env.GOT).map((x) => ({ o: x.o, n: x.n, i: x.i }));
// the backup holds the original text; compare on whitespace-normalised names
got.forEach((g) => { g.o = norm(g.o); });
got.sort((a, b) => (a.o < b.o ? -1 : a.o > b.o ? 1 : 0));
assert.deepEqual(got, want);
const untouched = JSON.parse(process.env.UNTOUCHED).map(norm).sort();
assert.deepEqual(untouched, keep.map(norm).sort());
console.log("ok - the SQL split agrees with employee-id.js on " + cases.length + " names (" + want.length + " split, " + keep.length + " left alone)");
'
# preview mode changes nothing
$P -d $DB -c "update employees e set name = b.old_name, trigo_id = null from employees_name_backup_trigo b where b.employee_id = e.id; delete from employees_name_backup_trigo" >/dev/null
sed 's/select true as apply/select false as apply/' supabase/migration-2026-10-03-trigo-id.sql | $P -d $DB -f - >/dev/null
N=$($P -d $DB -At -c "select count(*) from employees where trigo_id is not null")
[ "$N" = "0" ] && echo "ok - preview mode (apply = false) changes nothing"
$P -d postgres -c "drop database $DB" >/dev/null
