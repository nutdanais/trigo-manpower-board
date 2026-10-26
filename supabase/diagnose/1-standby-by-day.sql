-- Diagnose 1 of 4 — RUN THIS ONE FIRST. Read-only: it changes nothing.
-- Paste this whole file into a new query in the Supabase SQL Editor and press Run.
-- To look at another range, change the date in the first line of the query.
--
-- Why this exists: Overview → History rebuilds every past day from TODAY's employee
-- list, and a deactivated person counts on every past day but not on today. So a day
-- that read 100% live drops once it is yesterday. This shows, for each finished
-- working day, where the Standby comes from:
--   standby_deactivated_now  people deactivated since — the suspected cause
--   standby_still_active     people who are active today and sat on no mission/leave
--                            (for a day that read 100% live this should be 0. If it is
--                            not, the cause is people moved between boards, an on-call
--                            person made permanent, or places removed afterwards)
--   util_history_shows       what the History chart plots for that day
--   util_without_deactivated the same day with the deactivated people left out
-- Same rules as the app (cloud.js getUtilizationRange). A person counts from added_on.
-- A deactivated person counts on past days but NOT on today. A board's weekend / holiday
-- override takes its people out of the day. Loans are not looked at (they are dated).
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
