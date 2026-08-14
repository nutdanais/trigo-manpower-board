-- Migration 2026-08-14: plan_days marker — fixes "the adjusted board disappears
-- when another user logs in".
-- Run once in the Supabase SQL Editor (safe to re-run). Then redeploy the app.
--
-- Root cause: ensurePlanLoaded() decided "is this day new, so seed it with the
-- previous working day's plan?" from whether any assignment rows existed. But an
-- intentionally-adjusted day legitimately has zero assignments — everyone on
-- Standby (which is computed, not stored), people removed, or missions edited
-- with nobody placed yet — so it looked identical to a brand-new day and got
-- re-seeded the moment another user merely loaded it. (A fresh login boots with
-- an empty cache and runs the seed; Realtime then pushes the revert to everyone,
-- including the planner who made the adjustment.)
--
-- Fix: record materialization explicitly. A day is seeded at most once, ever;
-- once a plan_days row exists for it, no load re-seeds it — no matter how empty
-- the planner deliberately leaves it.

create table if not exists plan_days (
  board_id  uuid not null references boards(id) on delete cascade,
  plan_date date not null,
  initialized_at timestamptz not null default now(),
  primary key (board_id, plan_date)
);

-- ===== Row Level Security (same as every other table: any signed-in user) =====

alter table plan_days enable row level security;

drop policy if exists "authenticated read/write plan_days" on plan_days;
create policy "authenticated read/write plan_days" on plan_days
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ===== Backfill =====
-- Any day that already has a mission or an assignment has clearly been
-- materialized already, so mark it initialized. Without this, the first
-- post-deploy load of an existing adjusted future day would re-seed it once.

insert into plan_days (board_id, plan_date)
select distinct board_id, plan_date from missions
on conflict do nothing;

insert into plan_days (board_id, plan_date)
select distinct e.board_id, a.plan_date
from assignments a
join employees e on e.id = a.employee_id
on conflict do nothing;
