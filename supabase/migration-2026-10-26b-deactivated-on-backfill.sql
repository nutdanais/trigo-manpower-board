-- Migration 2026-10-26b: date the people who were deactivated before deactivated_on existed
-- Run AFTER migration-2026-10-26-deactivated-on.sql. Safe to re-run: someone it has already
-- handled is skipped.
--
-- What it does
--   For every deactivated person with no deactivated_on yet, it sets the day they went off
--   the roster to the best evidence there is, because the app never stored it:
--     * they were on a mission or on leave on some day -> the day AFTER the last one;
--     * their last place is today or later (deactivated today, plan already made) -> today,
--       which keeps today exactly as the board shows it now;
--     * they were never on any plan -> never counted: their "on the board from" date is set
--       to the day their row was created (if it was empty) and deactivated_on to the same
--       day, so no date counts them. (Placeholders and test rows like "New 1".)
--   The report at the end lists every person with the date it chose. Correct any date
--   afterwards with one line, e.g.
--     update employees set deactivated_on = date '2026-09-05' where id = '<the id in the report>';
--
-- Safety
--   * PREVIEW FIRST: it starts in preview (apply = false below) and changes nothing. Read the
--     report, then set apply to true and run it again.
--   * One transaction: if anything fails, nothing is kept.
--   * Only people who are deactivated and have no date are touched, and only deactivated_on
--     (and added_on when it was empty and they were never on a plan). Nobody is deleted.
--   * Reversible: what each row held before is saved to employees_deactivated_on_backup.
--     To undo:  update employees e set deactivated_on = b.old_deactivated_on, added_on = b.old_added_on
--                 from employees_deactivated_on_backup b where b.employee_id = e.id;

begin;

-- the safety copy; RLS on with no policy keeps it out of reach of the app's API
-- (the SQL editor and the owner still read it)
create table if not exists employees_deactivated_on_backup (
  employee_id        uuid primary key,
  old_deactivated_on date,
  old_added_on       date,
  saved_at           timestamptz not null default now()
);
alter table employees_deactivated_on_backup enable row level security;

-- ===== CHANGE THIS to true to apply (false = preview, nothing is changed) =====
create temp table _do_cfg as select false as apply;
-- ==============================================================================

create temp table _do_report as
with today as (select (now() at time zone 'Asia/Bangkok')::date as d)
select e.id, e.name_th, b.name as board, e.contract, e.added_on as old_added_on,
       l.last_plan,
       case when l.last_plan is null then coalesce(e.added_on, (e.created_at at time zone 'Asia/Bangkok')::date)
            when l.last_plan >= t.d then t.d
            else l.last_plan + 1 end as new_deactivated_on,
       case when l.last_plan is null and e.added_on is null then (e.created_at at time zone 'Asia/Bangkok')::date end as new_added_on,
       case when l.last_plan is null then 'never on a plan: not counted on any day'
            when l.last_plan >= t.d then 'has a place today: off from today'
            else 'off from the day after the last place' end as why
  from employees e
  join boards b on b.id = e.board_id
 cross join today t
  left join lateral (select max(a.plan_date) as last_plan from assignments a where a.employee_id = e.id) l on true
 where e.active = false
   and e.deactivated_on is null
   and not exists (select 1 from employees_deactivated_on_backup k where k.employee_id = e.id);

do $$
begin
  if (select apply from _do_cfg) then
    insert into employees_deactivated_on_backup (employee_id, old_deactivated_on, old_added_on)
    select r.id, null, r.old_added_on from _do_report r
    on conflict (employee_id) do nothing;

    update employees e
       set deactivated_on = r.new_deactivated_on,
           added_on = coalesce(r.new_added_on, e.added_on)
      from _do_report r
     where r.id = e.id;
  end if;
end $$;

commit;

-- the report: what was (or would be) set, one row per person, people who worked most recently last
select case when (select apply from _do_cfg) then 'set' else 'would set' end as status,
       name_th as "name", board, contract,
       last_plan as "last on a plan", new_deactivated_on as "off the roster from", why, id
  from _do_report
 order by last_plan nulls first, name_th;
