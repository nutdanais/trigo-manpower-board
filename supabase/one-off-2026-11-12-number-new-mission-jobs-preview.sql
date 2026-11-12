-- PREVIEW for one-off-2026-11-12-number-new-mission-jobs.sql: changes nothing, only shows what it would do.
-- Run this first in the Supabase SQL Editor. One row per job that would get its own number.
--
-- A job is every past day (before today, Bangkok time) whose number is the placeholder NEW MISSION (any
-- upper/lower case) with the same host and customer (spelling and case ignored). Both shifts and every board
-- of a job share the number, like any other mission. Numbers run NEW MISSION001, 002, ... in the order of
-- each job's first day, and continue after the highest NEW MISSIONnnn already used.
with today as (select (now() at time zone 'Asia/Bangkok')::date as d),
base as (
  select coalesce(max((substring(x from '^NEW MISSION([0-9]+)$'))::int), 0) as n
    from (select number as x from missions union all select number from mission_register) t
),
jobs as (
  select lower(btrim(m.host)) || ' | ' || lower(btrim(coalesce(m.customer, ''))) as job_key,
         min(m.host) as host, min(m.customer) as customer,
         min(m.plan_date) as first_day, max(m.plan_date) as last_day,
         count(distinct m.plan_date) as days, count(distinct m.id) as day_rows,
         string_agg(distinct b.name, ', ') as boards,
         string_agg(distinct m.shift, ' + ') as shifts,
         count(a.mission_id) as people_days
    from missions m
    join boards b on b.id = m.board_id
    left join assignments a on a.mission_id = m.id
   where upper(btrim(m.number)) = 'NEW MISSION' and m.plan_date < (select d from today)
   group by 1
)
select 'NEW MISSION' || lpad(((select n from base) + row_number() over (order by first_day, job_key))::text, 3, '0') as new_number,
       host, customer, boards, shifts, first_day, last_day, days, day_rows, people_days
  from jobs
 order by first_day, job_key;
