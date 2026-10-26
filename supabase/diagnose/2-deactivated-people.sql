-- Diagnose 2 of 4: who is deactivated, and when were they last on a plan? Read-only.
-- Paste this whole file into a new query in the Supabase SQL Editor and press Run.
--
-- The app stores no date for a deactivation, so last_on_a_plan is the best available
-- stand-in for "left on". Every person listed counts as Standby on every past day after
-- that date (and on days before they joined, if added_on is empty), because History
-- counts deactivated people on past days. This list is also what a back-fill of the
-- "left on" dates would start from, for you to review.
select e.name_th, e.name_en, b.name as board, e.contract,
       e.added_on, e.created_at::date as row_created,
       max(a.plan_date) as last_on_a_plan, count(a.id) as days_on_a_plan
  from employees e
  join boards b on b.id = e.board_id
  left join assignments a on a.employee_id = e.id
 where e.active = false
 group by e.id, e.name_th, e.name_en, b.name, e.contract, e.added_on, e.created_at
 order by last_on_a_plan nulls first, e.name_th;
