-- Migration 2026-08-23: employee active flag — archive instead of delete
-- Run once in the Supabase SQL Editor (safe to re-run). Then redeploy the app.
--
-- "Delete employee" used to hard-DELETE the row, and assignments.employee_id
-- references employees(id) on delete cascade — so deleting someone silently
-- wiped every past mission/zone assignment for them too, rewriting finished
-- plans. Archiving instead just flips this flag off: the employee disappears
-- from pools/dropdowns/today's headcount, but their row (and every past
-- assignment that points at it) stays untouched. Existing employees default
-- to active = true, so nothing changes until someone is explicitly archived.

alter table employees add column if not exists active boolean not null default true;
