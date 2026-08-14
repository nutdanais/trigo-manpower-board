-- Manpower Management Board — Supabase schema
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query > paste > Run).
-- Safe to run more than once — every statement below skips anything already in place.

create extension if not exists "pgcrypto";

-- ===== Reference tables =====

create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  weekend_days int[] not null default '{0,6}',   -- days of week that are weekend (0=Sun..6=Sat)
  created_at timestamptz not null default now()
);

create table if not exists engineers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  color text not null default '#9ca3af'
);

create table if not exists service_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#9ca3af'
);

-- ===== Per-board, per-date overrides (force a date working or non-working) =====
-- is_working=false: a normally-working day taken off (holiday)
-- is_working=true:  a normally-weekend day that is worked (special occasion)

create table if not exists day_overrides (
  board_id uuid not null references boards(id) on delete cascade,
  override_date date not null,
  is_working boolean not null,
  note text,
  created_at timestamptz not null default now(),
  primary key (board_id, override_date)
);

-- ===== Employees: one board at a time (enforces "one card, one place") =====

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contract text not null check (contract in ('permanent', 'oncall')),
  position text check (position in ('inspector', 'senior_inspector', 'technician', 'team_leader', 'assistant_site_engineer')),
  phone text,
  area_id uuid references service_areas(id) on delete restrict,
  board_id uuid not null references boards(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ===== Missions: scoped to one board + one date =====

create table if not exists missions (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  plan_date date not null,
  number text not null,
  host text not null,
  customer text not null,
  shift text not null check (shift in ('day', 'night')),
  start_time time not null default '08:00',
  end_time time not null default '17:00',
  ppe text,
  remark text,
  hidden boolean not null default false,
  engineer_id uuid references engineers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists missions_board_date_idx on missions(board_id, plan_date);
-- one mission number per board + date + shift (Day and Night can coexist)
do $$
begin
  alter table missions add constraint missions_unique_number_shift unique (board_id, plan_date, number, shift);
exception when duplicate_object then null;
end $$;

-- ===== Assignments: where an employee is on a given date =====
-- Exactly one row per employee per date (their mission OR their zone).
-- Because employees.board_id is the single source of truth for which board
-- an employee belongs to, this table can never place one card on two boards.

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  plan_date date not null,
  mission_id uuid references missions(id) on delete cascade,
  zone text check (zone in ('annual', 'sick', 'business', 'unpaid', 'exchange')),  -- standby is computed, not a stored zone
  updated_at timestamptz not null default now(),
  unique (employee_id, plan_date),
  check (
    (mission_id is not null and zone is null) or
    (mission_id is null and zone is not null)
  )
);
create index if not exists assignments_date_idx on assignments(plan_date);

-- ===== Plan-day marker: which (board, date) plans have been materialized =====
-- A day is auto-seeded from the previous working day at most once; a row here
-- records that it happened, so an intentionally-emptied day is never re-seeded
-- by a later load (that was the "adjusted board disappears on login" bug).

create table if not exists plan_days (
  board_id  uuid not null references boards(id) on delete cascade,
  plan_date date not null,
  initialized_at timestamptz not null default now(),
  primary key (board_id, plan_date)
);

-- ===== Row Level Security =====
-- Internal team tool: any signed-in user can read/write everything.

alter table boards enable row level security;
alter table engineers enable row level security;
alter table service_areas enable row level security;
alter table employees enable row level security;
alter table missions enable row level security;
alter table assignments enable row level security;
alter table day_overrides enable row level security;
alter table plan_days enable row level security;

drop policy if exists "authenticated read/write day_overrides" on day_overrides;
create policy "authenticated read/write day_overrides" on day_overrides
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated read/write boards" on boards;
create policy "authenticated read/write boards" on boards
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated read/write engineers" on engineers;
create policy "authenticated read/write engineers" on engineers
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated read/write service_areas" on service_areas;
create policy "authenticated read/write service_areas" on service_areas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated read/write employees" on employees;
create policy "authenticated read/write employees" on employees
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated read/write missions" on missions;
create policy "authenticated read/write missions" on missions
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated read/write assignments" on assignments;
create policy "authenticated read/write assignments" on assignments
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated read/write plan_days" on plan_days;
create policy "authenticated read/write plan_days" on plan_days
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ===== Realtime: broadcast changes to every connected client =====
-- Wrapped so re-running doesn't error if a table is already in the publication.

do $$
begin
  alter publication supabase_realtime add table boards;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table engineers;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table service_areas;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table employees;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table missions;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table assignments;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table day_overrides;
exception when duplicate_object then null;
end $$;

-- ===== Seed data (matches the current app defaults) =====
-- Only seeds each table the first time it's empty, so re-running never duplicates rows.

insert into boards (name)
select v.name from (values ('Non-Rayong'), ('Rayong')) as v(name)
where not exists (select 1 from boards);

insert into service_areas (name, color)
select v.name, v.color from (values
  ('LCB', '#f28ba0'), ('AYT', '#f6a06b'), ('NPT', '#7fb8ec'), ('Wellgrow', '#f5c26b'),
  ('AMATA', '#f7dd6c'), ('BENZ', '#e8e8e8'), ('RAYONG', '#a8d98a')
) as v(name, color)
where not exists (select 1 from service_areas);

insert into engineers (name, phone, color)
select v.name, v.phone, v.color from (values
  ('Phada', '063-206-7730', '#a8d98a'),
  ('Tanakit', '065-945-6413', '#7fb8ec'),
  ('Sunicha', '063-023-8939', '#e57fb1'),
  ('Suriya', '081-175-5147', '#f6a06b'),
  ('Phrajak', '', '#f7dd6c'),
  ('Janjira', '062-743-0920', '#c0c4cb'),
  ('Wipa', '065-205-1752', '#c0c4cb')
) as v(name, phone, color)
where not exists (select 1 from engineers);
