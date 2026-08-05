-- Migration 2026-07-14: per-board work week + per-date overrides
-- Run once in Supabase SQL Editor (safe to re-run). Then redeploy the app.
--
-- Model:
--  * Each board defines which weekdays are its weekend (0=Sun .. 6=Sat).
--  * A day_override forces ONE date on ONE board to a specific state:
--      is_working = false  -> a normally-working day taken off (a "holiday")
--      is_working = true   -> a normally-weekend day that IS worked (special occasion)
--  * A non-working day (weekend or holiday) starts empty; the red "Add Mission"
--    button pulls missions in. Other boards are unaffected.

-- 1) per-board weekend configuration (default Saturday & Sunday)
alter table boards add column if not exists weekend_days int[] not null default '{0,6}';

-- 2) per-date, per-board overrides (supersedes the never-populated holidays table)
drop table if exists holidays cascade;

create table if not exists day_overrides (
  board_id uuid not null references boards(id) on delete cascade,
  override_date date not null,
  is_working boolean not null,
  note text,
  created_at timestamptz not null default now(),
  primary key (board_id, override_date)
);

alter table day_overrides enable row level security;

drop policy if exists "authenticated read/write day_overrides" on day_overrides;
create policy "authenticated read/write day_overrides" on day_overrides
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

do $$
begin
  alter publication supabase_realtime add table day_overrides;
exception when duplicate_object then null;
end $$;
