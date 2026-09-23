-- Migration 2026-09-24b: move existing future boards into the forecast layer
-- Run in the Supabase SQL Editor AFTER migration-2026-09-24-forward-planning.sql,
-- and deploy the new app straight after. Safe to re-run: once it has moved a
-- date there is nothing left there to move, so a second run changes nothing.
--
-- WHY: from this release a confirmed plan only exists up to the next working
-- day; everything after that is a forecast. Confirmed rows already exist on
-- later dates (week-ahead boards built in the old app). Left where they are,
-- the new app would open those dates in forecast mode and they would look
-- empty. This moves them into forecast_missions / forecast_assignments, and
-- removes the deployment_history rows that week-ahead planning wrote for
-- deployments that have not happened (decision D4).
--
-- HOW TO RUN — two passes:
--   1. Set the cutoff below. Leave do_move = false. Run the whole file.
--      Nothing changes; the result grid lists, per board and date, what WILL
--      move. Check it looks right (back up missions, assignments and
--      deployment_history first — see the release checklist).
--   2. Set do_move = true. Run the whole file again. The move is one atomic
--      step: it either all happens or none of it does. The result grid then
--      shows what is left on or after the cutoff — every count should be 0.
--
-- What moves, for every date >= cutoff:
--   * missions      -> forecast_missions (hidden missions are not moved: they
--                      were off the board anyway, and the forecast has no
--                      hidden state; they are deleted with the rest)
--   * assignments   -> forecast_assignments (mission placements are re-pointed
--                      at the moved mission by board + date + number + shift;
--                      leave stays leave). held_by = the assignment's
--                      updated_by, else the mission's updated_by, else 'migrated'.
--   * deployment_history rows for exactly the (employee, date) pairs moved
--     above — never by date alone, so a record with no future assignment
--     behind it is left untouched.
-- The originals are then deleted.

drop table if exists pg_temp.fp_settings;
create temp table fp_settings as select
  -- EDIT BEFORE RUNNING: first date that becomes forecast = the day AFTER the
  -- next working day, on release day. (Released on Thu 1 Oct -> next working
  -- day Fri 2 Oct -> cutoff Sat 3 Oct. Released on Fri 2 Oct -> next working
  -- day Mon 5 Oct -> cutoff Tue 6 Oct.)
  date '2026-10-02' as cutoff,
  -- EDIT: false = dry run, changes nothing. true = do the move.
  false             as do_move;

do $$
declare
  s        record;
  v_today  date := (now() at time zone 'Asia/Bangkok')::date;
  n_fm     int;
  n_fa     int;
  n_fz     int;
  n_dh     int;
  n_a      int;
  n_m      int;
begin
  select * into s from fp_settings;
  -- tomorrow is still a confirmed day: a cutoff on or before it would move a
  -- plan that is about to be executed
  if s.cutoff is null or s.cutoff <= v_today + 1 then
    raise exception 'cutoff % is too early: it must be at least the day after tomorrow (today is % in Bangkok).', s.cutoff, v_today;
  end if;
  if not s.do_move then
    raise notice 'DRY RUN — nothing was changed. Check the result grid, then set do_move = true.';
    return;
  end if;

  -- the (employee, date) pairs being moved, captured before anything is deleted
  drop table if exists pg_temp.fp_pairs;
  create temp table fp_pairs as
    select a.employee_id, a.plan_date, a.mission_id, a.zone,
           nullif(to_jsonb(a) ->> 'updated_by', '') as a_by
      from assignments a
     where a.plan_date >= s.cutoff;

  insert into forecast_missions (board_id, plan_date, number, host, customer, shift, start_time, end_time,
                                 ppe, remark, engineer_id, created_by, updated_by, created_at, updated_at)
  select m.board_id, m.plan_date, m.number, m.host, m.customer, m.shift, m.start_time, m.end_time,
         m.ppe, m.remark, m.engineer_id,
         coalesce(nullif(to_jsonb(m) ->> 'updated_by', ''), 'migrated'),
         coalesce(nullif(to_jsonb(m) ->> 'updated_by', ''), 'migrated'),
         m.created_at, now()
    from missions m
   where m.plan_date >= s.cutoff
     and not coalesce((to_jsonb(m) ->> 'hidden')::boolean, false)
  on conflict (board_id, plan_date, number, shift) do nothing;
  get diagnostics n_fm = row_count;

  insert into forecast_assignments (employee_id, plan_date, forecast_mission_id, zone, held_by, updated_at)
  select p.employee_id, p.plan_date, fm.id, null,
         coalesce(p.a_by, nullif(to_jsonb(m) ->> 'updated_by', ''), 'migrated'), now()
    from fp_pairs p
    join missions m on m.id = p.mission_id
    join forecast_missions fm on fm.board_id = m.board_id and fm.plan_date = m.plan_date
                             and fm.number = m.number and fm.shift = m.shift
   where p.mission_id is not null
  on conflict (employee_id, plan_date) do nothing;
  get diagnostics n_fa = row_count;

  insert into forecast_assignments (employee_id, plan_date, forecast_mission_id, zone, held_by, updated_at)
  select p.employee_id, p.plan_date, null, p.zone, coalesce(p.a_by, 'migrated'), now()
    from fp_pairs p
   where p.mission_id is null and p.zone is not null
  on conflict (employee_id, plan_date) do nothing;
  get diagnostics n_fz = row_count;

  delete from deployment_history dh
   using fp_pairs p
   where dh.employee_id = p.employee_id and dh.plan_date = p.plan_date;
  get diagnostics n_dh = row_count;

  delete from assignments where plan_date >= s.cutoff;
  get diagnostics n_a = row_count;
  delete from missions where plan_date >= s.cutoff;
  get diagnostics n_m = row_count;

  raise notice 'MOVED: % forecast missions, % mission placements, % leave entries created; deleted % assignments, % missions, % deployment_history rows.',
    n_fm, n_fa, n_fz, n_a, n_m, n_dh;
end $$;

-- ---------- Result grid ----------
-- Dry run: what WILL move. After the move: what is left on or after the
-- cutoff in the confirmed tables (every count should be 0), with the forecast
-- rows now there alongside for comparison.
with s as (select * from fp_settings),
m as (
  select m.board_id, m.plan_date,
         count(*) filter (where not coalesce((to_jsonb(m) ->> 'hidden')::boolean, false)) as missions,
         count(*) filter (where coalesce((to_jsonb(m) ->> 'hidden')::boolean, false))     as hidden_missions_dropped
    from missions m, s where m.plan_date >= s.cutoff
   group by 1, 2
),
a as (
  select e.board_id, a.plan_date,
         count(*) filter (where a.mission_id is not null) as crew_on_missions,
         count(*) filter (where a.zone is not null)       as leave_entries
    from assignments a join employees e on e.id = a.employee_id, s
   where a.plan_date >= s.cutoff
   group by 1, 2
),
d as (
  select e.board_id, dh.plan_date, count(*) as deployment_history
    from deployment_history dh join employees e on e.id = dh.employee_id, s
   where dh.plan_date >= s.cutoff
     and exists (select 1 from assignments a where a.employee_id = dh.employee_id and a.plan_date = dh.plan_date)
   group by 1, 2
),
f as (
  select fm.board_id, fm.plan_date, count(distinct fm.id) as forecast_missions, count(fa.id) as forecast_crew
    from forecast_missions fm left join forecast_assignments fa on fa.forecast_mission_id = fm.id, s
   where fm.plan_date >= s.cutoff
   group by 1, 2
),
keys as (
  select board_id, plan_date from m union select board_id, plan_date from a
  union select board_id, plan_date from d union select board_id, plan_date from f
),
detail as (
  select b.name as board, k.plan_date,
         coalesce(m.missions, 0)                as missions,
         coalesce(a.crew_on_missions, 0)        as crew_on_missions,
         coalesce(a.leave_entries, 0)           as leave_entries,
         coalesce(d.deployment_history, 0)      as deployment_history,
         coalesce(m.hidden_missions_dropped, 0) as hidden_missions_dropped,
         coalesce(f.forecast_missions, 0)       as already_in_forecast_missions,
         coalesce(f.forecast_crew, 0)           as already_in_forecast_crew
    from keys k
    join boards b on b.id = k.board_id
    left join m on m.board_id = k.board_id and m.plan_date = k.plan_date
    left join a on a.board_id = k.board_id and a.plan_date = k.plan_date
    left join d on d.board_id = k.board_id and d.plan_date = k.plan_date
    left join f on f.board_id = k.board_id and f.plan_date = k.plan_date
)
select case when s.do_move then 'AFTER MOVE — confirmed rows left (expect 0)' else 'DRY RUN — will move' end as phase,
       x.*
  from s, (
    select 1 as ord, board, plan_date, missions, crew_on_missions, leave_entries, deployment_history,
           hidden_missions_dropped, already_in_forecast_missions, already_in_forecast_crew
      from detail
    union all
    select 2, 'TOTAL (cutoff ' || (select cutoff from fp_settings)::text || ')', null,
           coalesce(sum(missions), 0), coalesce(sum(crew_on_missions), 0), coalesce(sum(leave_entries), 0),
           coalesce(sum(deployment_history), 0), coalesce(sum(hidden_missions_dropped), 0),
           coalesce(sum(already_in_forecast_missions), 0), coalesce(sum(already_in_forecast_crew), 0)
      from detail
  ) x
 order by x.ord, x.board, x.plan_date;
