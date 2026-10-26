-- Diagnose 3 of 4: the numbers History shows when ONE board is picked. Read-only.
-- Paste this whole file into a new query in the Supabase SQL Editor and press Run.
-- To look at another range, change the date in the first line of the query.
--
-- headcount follows each person's CURRENT board, and assigned follows the board of the
-- mission they worked. A board with util over 100 (or an odd Standby) on past days,
-- next to another board with the opposite, means people were moved between boards
-- after those days. With "All boards" picked this cancels out, so only run this if
-- you looked at one board, or if file 1 does not explain the gap.
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
