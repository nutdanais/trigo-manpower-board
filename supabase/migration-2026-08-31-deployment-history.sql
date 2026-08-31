-- Migration 2026-08-31: deployment_history — a durable log for the Host Record tab
-- Run once in the Supabase SQL Editor (safe to re-run). Then redeploy the app.
--
-- The Host Record tab (Edit Employee modal) originally read an employee's host
-- history straight off assignments/missions. That breaks the moment a mission
-- is hidden — setMissionsHidden deletes its assignment rows outright, on
-- purpose, so the crew shows back up as available — or deleted outright, which
-- cascades and removes its assignment rows too. Either way the "who worked
-- where" fact disappears along with the live board state, even though the
-- fact itself is still true.
--
-- deployment_history is an independent, append-only record of that fact: one
-- row per (employee, date), written the moment an employee is assigned to a
-- mission, snapshotting the mission's host/number/customer as plain text
-- rather than a foreign key so it survives that mission later being hidden or
-- deleted. It is never deleted by the board's normal hide/unassign/delete
-- flows — only overwritten if the same employee's assignment for that same
-- date is corrected to a different mission before the day is done.

create table if not exists deployment_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  plan_date date not null,
  mission_number text not null,
  host text not null,
  customer text,
  board_id uuid references boards(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (employee_id, plan_date)
);
create index if not exists deployment_history_employee_idx on deployment_history(employee_id);

-- ===== Row Level Security (same as every other table: any signed-in user) =====

alter table deployment_history enable row level security;

drop policy if exists "authenticated read/write deployment_history" on deployment_history;
create policy "authenticated read/write deployment_history" on deployment_history
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Not added to the supabase_realtime publication on purpose: unlike the board
-- tables, nothing renders this live across connected clients — the Host
-- Record tab reads it fresh every time the Edit Employee modal opens.

-- ===== Backfill =====
-- Every assignment that is still live right now already proves a host-history
-- fact, so recover all of it. This can only backfill what's still there —
-- an assignment already lost to a hide/delete before this migration runs
-- can't be recovered, since the row itself is gone.

insert into deployment_history (employee_id, plan_date, mission_number, host, customer, board_id)
select a.employee_id, a.plan_date, m.number, m.host, m.customer, m.board_id
from assignments a
join missions m on m.id = a.mission_id
where a.mission_id is not null
on conflict (employee_id, plan_date) do nothing;
