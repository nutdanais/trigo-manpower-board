-- Migration 2026-10-03: employees.trigo_id — the TRIGO ID (T + digits, e.g. T329)
-- Run once in the Supabase SQL Editor (safe to re-run). Then redeploy the app.
--
-- What it does
--   1. adds employees.trigo_id (optional text) and a unique index on it
--      (case-insensitive, blank/NULL ignored), so no two people share an ID;
--   2. reviews every existing employee name for an ID typed into the name
--      ("Wannaphatson T329", "T329 Somchai", "Somchai Jaidee (T329)",
--      "Somchai - T329") and moves it into trigo_id, leaving the name clean;
--   3. shows a report of everything it looked at (the last result in the editor).
--
-- Safety
--   * PREVIEW FIRST: set `apply` to false below and run it — nothing is changed,
--     the report shows what WOULD be split. Then set it to true and run again.
--   * Reversible: every name it changes is saved to employees_name_backup_trigo.
--     To undo:  update employees e set name = b.old_name, trigo_id = null
--               from employees_name_backup_trigo b where b.employee_id = e.id;
--   * Only an ID at the very start or very end of the name is moved, and only
--     when exactly one ID is found. An ID in the middle, two IDs, an ID already
--     used by someone else, or someone who already has a TRIGO ID is NOT touched
--     — the report lists them as "manual" or "skipped" so a person can decide
--     (fix them in the app, or in Bulk edit using the TRIGO ID column).
--   * The rule is the same as splitNameAndId() in employee-id.js, which the
--     tests compare against this file (tests/sql/trigo-id-split.test.sh).

alter table employees add column if not exists trigo_id text;
create unique index if not exists employees_trigo_id_key
  on employees (upper(trigo_id)) where trigo_id is not null and trigo_id <> '';

-- the safety copy of names this migration changes; RLS on with no policy keeps it
-- out of reach of the app's API (the SQL editor and the owner still read it)
create table if not exists employees_name_backup_trigo (
  employee_id uuid primary key,
  old_name    text not null,
  split_at    timestamptz not null default now()
);
alter table employees_name_backup_trigo enable row level security;

-- ===== CHANGE THIS to false to preview without changing anything =====
create temp table _trigo_cfg as select true as apply;
-- =====================================================================

create or replace function pg_temp.trigo_split(raw text, out new_name text, out new_id text)
language plpgsql immutable as $fn$
declare
  s text := btrim(regexp_replace(normalize(coalesce(raw, ''), NFC), '\s+', ' ', 'g'));
  lead_m text[];
  trail_m text[];
  nm text;
begin
  lead_m  := regexp_match(s, '^[(\[[:space:]]*(T[0-9]{1,6})(?![0-9])[[:space:])\]\-–—:.,_/|]*(.+)$', 'i');
  trail_m := regexp_match(s, '^(.+?)[[:space:]\-–—:.,_/|(\[]+(T[0-9]{1,6})(?![0-9])[[:space:])\]]*$', 'i');
  if (lead_m is not null and trail_m is not null) or (lead_m is null and trail_m is null) then
    return;
  end if;
  if lead_m is not null then new_id := upper(lead_m[1]); nm := lead_m[2];
  else new_id := upper(trail_m[2]); nm := trail_m[1];
  end if;
  nm := btrim(regexp_replace(nm, '^[[:space:]\-–—:.,_/|()\[\]]+|[[:space:]\-–—:.,_/|()\[\]]+$', '', 'g'));
  -- the rest must be a real name, and must not hold a second ID
  if nm !~ '[^[:space:][:punct:][:digit:]]' or nm ~* '(^|[[:space:]\-–—:.,_/|(\[])T[0-9]{1,6}(?![0-9])' then
    new_id := null;
    return;
  end if;
  new_name := nm;
end
$fn$;

create temp table _trigo_report as
select e.id, e.name as old_name, s.new_name, s.new_id, e.trigo_id as existing_id,
       'pending'::text as status
  from employees e
  cross join lateral pg_temp.trigo_split(e.name) s
 where s.new_id is not null;

-- an ID somewhere in a name that the rule above will not move: a person decides
insert into _trigo_report (id, old_name, status)
select e.id, e.name, 'manual: an ID is in the name but not at the start or end (or two IDs)'
  from employees e
 where e.name ~* '(^|[[:space:]\-–—:.,_/|(\[])T[0-9]{1,6}(?![0-9])'
   and not exists (select 1 from _trigo_report r where r.id = e.id);

update _trigo_report r set status = 'skipped: this person already has a TRIGO ID'
 where r.status = 'pending' and coalesce(r.existing_id, '') <> '';
update _trigo_report r set status = 'skipped: the same ID appears on more than one name'
 where r.status = 'pending'
   and (select count(*) from _trigo_report x where x.new_id = r.new_id and x.status = 'pending') > 1;
update _trigo_report r set status = 'skipped: that ID already belongs to someone else'
 where r.status = 'pending'
   and exists (select 1 from employees e where upper(e.trigo_id) = r.new_id and e.id <> r.id);

insert into employees_name_backup_trigo (employee_id, old_name)
select r.id, r.old_name from _trigo_report r
 where r.status = 'pending' and (select apply from _trigo_cfg)
on conflict (employee_id) do nothing;

update employees e set name = r.new_name, trigo_id = r.new_id
  from _trigo_report r
 where r.id = e.id and r.status = 'pending' and (select apply from _trigo_cfg);

update _trigo_report set status = case when (select apply from _trigo_cfg) then 'split' else 'would split' end
 where status = 'pending';

-- the report: what was (or would be) changed, and what needs a person
select status, old_name as "name before", new_name as "name after", new_id as "TRIGO ID"
  from _trigo_report
 order by (status like 'split' or status like 'would split') desc, status, old_name;
