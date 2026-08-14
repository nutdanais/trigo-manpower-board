-- Migration 2026-08-14b: plan_days locking — "Lock board" button
-- Run once in the Supabase SQL Editor (safe to re-run). Then redeploy the app.
-- Requires migration-2026-08-14-plan-days.sql to have been run first.
--
-- Lets a planner lock a (board, date) once its plan is finalized. A locked day
-- is view-only for every user. Another user can unlock it, but the app shows a
-- confirmation naming who locked it first; unlocking clears the lock for
-- everyone (a simple "take over the board" model). This reuses the plan_days
-- marker row added by migration-2026-08-14 rather than a new table — locking
-- never deletes that row (it's still the "already materialized" marker that
-- stops the day from being auto-seeded again), it only sets/clears the two
-- lock columns below.

alter table plan_days add column if not exists locked_by text;
alter table plan_days add column if not exists locked_at timestamptz;

-- Broadcast lock/unlock to every connected client so another user's board
-- flips to read-only (or back) live, the same way missions/assignments do.
do $$
begin
  alter publication supabase_realtime add table plan_days;
exception when duplicate_object then null;
end $$;
