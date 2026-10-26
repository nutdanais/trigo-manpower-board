-- Diagnose 4 of 4: people with a work record but no place on the day now. Read-only.
-- Paste this whole file into a new query in the Supabase SQL Editor and press Run.
--
-- A hint only. deployment_history is never cleared when a mission is hidden or deleted,
-- when a day is turned into a holiday, or when the board is reset, but those actions DO
-- delete the assignment rows History counts. The number also includes anyone who was
-- deliberately sent back to Standby, so it is an upper bound on places lost by accident.
-- Weekends and holidays (a holiday deletes that day's missions) are expected to be large
-- and are not on the History chart.
select dh.plan_date as day, count(*) as work_record_without_a_place_now
  from deployment_history dh
  left join assignments a on a.employee_id = dh.employee_id and a.plan_date = dh.plan_date
 where dh.plan_date between date '2026-10-01' and (now() at time zone 'Asia/Bangkok')::date
   and a.id is null
 group by dh.plan_date
 order by dh.plan_date;
