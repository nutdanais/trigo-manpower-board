-- Migration 2026-09-16: employee_notes — a free-text remarks log for the
-- employee Note tab
-- Run once in the Supabase SQL Editor (safe to re-run). Then redeploy the app.
--
-- Adds a "Note" tab next to Host Record in the employee module (opened from
-- the Manpower List or by double-clicking an employee card) so planners can
-- leave remarks about an employee — preferences, reminders, anything worth
-- flagging for whoever looks at that person's record next.
--
-- One row per note (not one column on employees) so the tab reads as a
-- running log rather than a single field that gets silently overwritten —
-- same reasoning as deployment_history over a plain column. Independent of
-- any date, assignment or mission: a note is about the person, not about a
-- shift.

create table if not exists employee_notes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  note text not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists employee_notes_employee_idx on employee_notes(employee_id);

-- ===== Row Level Security (same rule as the employees table itself: anyone
-- with an active account can read, only emplist-edit can write) =====

alter table employee_notes enable row level security;

drop policy if exists "employee_notes read" on employee_notes;
create policy "employee_notes read" on employee_notes
  for select using ((select public.is_active()));

drop policy if exists "employee_notes insert" on employee_notes;
create policy "employee_notes insert" on employee_notes
  for insert with check ((select public.can('emplist', 'edit')));

drop policy if exists "employee_notes update" on employee_notes;
create policy "employee_notes update" on employee_notes
  for update using ((select public.can('emplist', 'edit'))) with check ((select public.can('emplist', 'edit')));

drop policy if exists "employee_notes delete" on employee_notes;
create policy "employee_notes delete" on employee_notes
  for delete using ((select public.can('emplist', 'edit')));

-- Not added to the supabase_realtime publication on purpose, same as
-- deployment_history: nothing renders this live across clients — the Note
-- tab reads it fresh every time the Edit Employee modal opens.
