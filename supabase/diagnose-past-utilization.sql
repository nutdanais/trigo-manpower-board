-- Diagnose: why do finished days read below 100% in Overview → History?
-- READ-ONLY. Run each block on its own in the Supabase SQL Editor; nothing is changed.
-- Change the start date in the first line of every block if you want another range.
--
-- The History chart does not read a saved record of each day. It rebuilds every
-- past day from TODAY's employee list, and a few things on that list carry no date:
--   * active   — today the app leaves deactivated people out; on every PAST day it
--                counts them (even days after they were deactivated). With nothing
--                to do on those days they read as Standby, so a day that read 100%
--                live drops the moment it becomes yesterday.
--   * board    — a permanent move to another board rewrites that person's board
--                for every earlier day (only a single board's History is affected;
--                "All boards" cancels out).
--   * contract — an on-call person made permanent counts as Standby on past days
--                they were not called in.
-- Loans are not looked at here (they are dated, so they do not rewrite other days).
--
-- Reads only employees, boards, day_overrides, missions, assignments and
-- deployment_history. Blocks 2 and 3 follow the same rules as the app's
-- getUtilizationRange (cloud.js) and give the same numbers on a test database.


-- ===== 1. Who is deactivated, and when were they last on a plan? =================
-- last_on_a_plan is the best available stand-in for "left on": the app stores no
-- date for a deactivation. Each of these people counts as Standby on every past
-- day from then on (and on days before they joined, if added_on is empty).
select e.name_th, e.name_en, b.name as board, e.contract,
       e.added_on, e.created_at::date as row_created,
       max(a.plan_date) as last_on_a_plan, count(a.id) as days_on_a_plan
  from employees e
  join boards b on b.id = e.board_id
  left join assignments a on a.employee_id = e.id
 where e.active = false
 group by e.id, e.name_th, e.name_en, b.name, e.contract, e.added_on, e.created_at
 order by last_on_a_plan nulls first, e.name_th;


-- ===== 2. Day by day, all boards: where does the Standby come from? ==============
-- Same rule as the app: a person counts from added_on; a deactivated person counts
-- on past days but NOT on today; a board's weekend / holiday override takes its
-- people out of the day. util_history_shows is the number the History chart plots;
-- util_without_deactivated is the same day with the deactivated people left out.
-- If standby_still_active is 0 and standby_deactivated_now is the whole gap, the
-- cause is the deactivated people from block 1.
with p as (
  select date '2026-10-01' as from_date, (now() at time zone 'Asia/Bangkok')::date as today
), days as (
  select distinct a.plan_date as d
    from assignments a, p
   where a.mission_id is not null and a.plan_date between p.from_date and p.today
), counted as (
  select d.d, e.id, e.contract, e.active
    from days d
   cross join p
    join employees e on (e.added_on is null or e.added_on <= d.d) and (e.active or d.d < p.today)
    join boards b on b.id = e.board_id
   where coalesce((select o.is_working from day_overrides o where o.board_id = b.id and o.override_date = d.d),
                  not (extract(dow from d.d)::int = any (b.weekend_days)))
), placed as (
  select c.d, c.contract, c.active, a.mission_id, a.zone
    from counted c
    left join assignments a on a.employee_id = c.id and a.plan_date = c.d
)
select d as day,
       count(*) filter (where mission_id is not null) as deployed,
       count(*) filter (where zone is not null) as on_leave,
       count(*) filter (where contract = 'permanent' and mission_id is null and zone is null and active) as standby_still_active,
       count(*) filter (where contract = 'permanent' and mission_id is null and zone is null and not active) as standby_deactivated_now,
       round(100.0 * count(*) filter (where mission_id is not null)
             / nullif(count(*) filter (where mission_id is not null)
                      + count(*) filter (where contract = 'permanent' and mission_id is null and zone is null), 0), 1) as util_history_shows,
       round(100.0 * count(*) filter (where mission_id is not null)
             / nullif(count(*) filter (where mission_id is not null)
                      + count(*) filter (where contract = 'permanent' and mission_id is null and zone is null and active), 0), 1) as util_without_deactivated
  from placed
 group by d
 order by d;


-- ===== 3. Day by day, per board: what History shows when ONE board is picked ====
-- headcount follows each person's CURRENT board; assigned follows the board of the
-- mission they worked. A board with util over 100 (or an odd Standby) on past days,
-- next to another board with the opposite, means people were moved between boards
-- after those days.
with p as (
  select date '2026-10-01' as from_date, (now() at time zone 'Asia/Bangkok')::date as today
), days as (
  select distinct a.plan_date as d
    from assignments a, p
   where a.mission_id is not null and a.plan_date between p.from_date and p.today
), counted as (
  select d.d, e.id, e.contract, e.board_id as home_board
    from days d
   cross join p
    join employees e on (e.added_on is null or e.added_on <= d.d) and (e.active or d.d < p.today)
), person_day as (
  select c.d, c.contract, c.home_board, m.board_id as mission_board, (a.zone is not null) as is_leave
    from counted c
    left join assignments a on a.employee_id = c.id and a.plan_date = c.d
    left join missions m on m.id = a.mission_id and not m.hidden
), board_day as (
  select d.d, b.id as board_id, b.name as board
    from days d
   cross join boards b
   where coalesce((select o.is_working from day_overrides o where o.board_id = b.id and o.override_date = d.d),
                  not (extract(dow from d.d)::int = any (b.weekend_days)))
), tally as (
  select bd.d, bd.board,
         count(*) filter (where pd.home_board = bd.board_id) as headcount,
         count(*) filter (where pd.mission_board = bd.board_id) as assigned,
         count(*) filter (where pd.home_board = bd.board_id and pd.is_leave) as leave,
         count(*) filter (where pd.home_board = bd.board_id and pd.contract = 'oncall') as oncall_headcount,
         count(*) filter (where pd.mission_board = bd.board_id and pd.contract = 'oncall') as oncall_assigned,
         count(*) filter (where pd.home_board = bd.board_id and pd.contract = 'oncall' and pd.is_leave) as oncall_leave
    from board_day bd
    join person_day pd on pd.d = bd.d
   group by bd.d, bd.board
)
select d as day, board, headcount, assigned, leave,
       greatest(0, (headcount - oncall_headcount) - (assigned - oncall_assigned) - (leave - oncall_leave)) as standby,
       round(100.0 * assigned
             / nullif(headcount - leave - greatest(0, oncall_headcount - oncall_assigned - oncall_leave), 0), 1) as util_history_shows
  from tally
 order by d, board;


-- ===== 4. Hint only: people with a work record but no place on the day now =======
-- deployment_history is never cleared when a mission is hidden, deleted or the
-- board is reset, but those actions DO delete the assignment rows History counts.
-- A number here is also made by someone deliberately sent back to Standby, so it
-- is only a pointer: a steady 9-ish per day would mean places were removed after
-- the fact instead of (or as well as) the roster effects above.
select dh.plan_date as day, count(*) as work_record_without_a_place_now
  from deployment_history dh
  left join assignments a on a.employee_id = dh.employee_id and a.plan_date = dh.plan_date
 where dh.plan_date between date '2026-10-01' and (now() at time zone 'Asia/Bangkok')::date
   and a.id is null
 group by dh.plan_date
 order by dh.plan_date;
