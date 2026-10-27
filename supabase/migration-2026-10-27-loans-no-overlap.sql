-- Migration 2026-10-27: one loan per person per day — the database refuses overlapping loans
-- Run once in the Supabase SQL Editor (safe to re-run), after
-- migration-2026-10-20-employee-loans.sql. No app redeploy is needed for the rule
-- itself; the app release that goes with it disables Lend while it saves.
--
-- Why: the app keeps one person's loans from overlapping (a new loan trims the
-- ones it runs into), but it does that from what the browser has loaded. Two
-- saves that start before either has finished — Lend clicked twice, or two
-- people lending the same person at the same moment — both see no loan and both
-- add one. The person then shows twice in Overview → Loans today.
--
-- What it does
--   1. removes exact duplicate loans: same person, same board, same first and
--      last day. The newest row is kept (effective_board reads the newest), so
--      nothing anyone sees changes except the second line in Loans today;
--   2. stops if other overlapping loans are left (different boards or dates for
--      the same person on the same day): those need a person to pick which loan
--      is right. It lists them and changes nothing. End or change one of each
--      pair in the app (or delete the wrong row), then run this again;
--   3. adds employee_loans_no_overlap: a loan that shares any day with another
--      loan of the same person is refused. The app trims older loans before it
--      writes a new one, so normal lending never hits it; a save that lost a race
--      gets an error and the app reloads the loans.
--
-- Everything runs in one transaction: if step 2 stops, step 1 is undone too.

begin;

-- the exclusion constraint needs "=" on uuid inside a GiST index (btree_gist);
-- Supabase keeps extensions in their own schema when it has one
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    create extension if not exists btree_gist with schema extensions;
  else
    create extension if not exists btree_gist;
  end if;
end $$;

-- 1. exact duplicates: keep the newest of each
delete from employee_loans l
using employee_loans k
where k.employee_id = l.employee_id
  and k.to_board_id = l.to_board_id
  and k.start_date  = l.start_date
  and k.end_date    = l.end_date
  and (k.created_at, k.id) > (l.created_at, l.id);

-- 2. any other overlap is left for a person to decide
do $$
declare
  v_list text;
begin
  select string_agg(format('%s: → %s %s–%s and → %s %s–%s',
                           coalesce(e.name_th, a.employee_id::text),
                           ba.name, a.start_date, a.end_date,
                           bb.name, b.start_date, b.end_date), E'\n')
    into v_list
  from employee_loans a
  join employee_loans b on b.employee_id = a.employee_id and a.id < b.id
                       and a.start_date <= b.end_date and b.start_date <= a.end_date
  left join employees e on e.id = a.employee_id
  left join boards ba on ba.id = a.to_board_id
  left join boards bb on bb.id = b.to_board_id;
  if v_list is not null then
    raise exception E'Overlapping loans found; nothing was changed. End or change one loan of each pair in the app, then run this again:\n%', v_list;
  end if;
end $$;

-- 3. the rule
do $$
begin
  alter table employee_loans add constraint employee_loans_no_overlap
    exclude using gist (employee_id with =, daterange(start_date, end_date, '[]') with &&);
exception when duplicate_object or duplicate_table then null;   -- already there
end $$;

commit;
