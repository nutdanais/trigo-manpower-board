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
-- an existing constraint reports duplicate_table (its backing index), not
-- duplicate_object — catching only the latter broke this file's promise to be
-- safe to run more than once
exception when duplicate_object or duplicate_table then null;
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

-- ===== Deployment history: durable log for the employee Host Record tab =====
-- Independent of assignments' lifecycle on purpose — hiding or deleting a
-- mission deletes its assignment rows (see the assignments table's own
-- comment / migration-2026-08-31), but the fact that an employee once worked
-- a given host should survive that. One row per (employee, date), written the
-- moment an employee is assigned to a mission, snapshotting host/number/
-- customer as plain text rather than a foreign key. Never deleted by the
-- board's hide/unassign/delete flows — see cloud.js's _writeDeploymentHistory.

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

-- ===== Hosts: the master record behind the Host List tab =====
-- A host exists on the board as free text (missions.host, and the snapshot in
-- deployment_history.host); this table is where anything ABOUT that host is
-- stored — its location and a Google Maps link. Keyed by the name rather than
-- by an id on purpose, so it stays purely additive: a host with no row here
-- still appears in the Host List, assembled from mission/deployment rows
-- alone. See migration-2026-09-02-hosts.sql for the full reasoning.

create table if not exists hosts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  location text,
  map_url text,
  -- which service area the host sits in; drives the Host List's Service area
  -- column and the area pill on every mission card for that host
  area_id uuid references service_areas(id) on delete set null,
  -- a real site the team no longer serves: kept in the Host List with all of
  -- its history, only dropped from the New Mission host picker. A duplicate or
  -- a typo is NOT archived — it is merged into the real host (cloud.mergeHost),
  -- which rewrites the name on its mission and deployment rows.
  archived boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== Plan-day marker: "Lock board" state per (board, date) =====
-- The app no longer auto-seeds a future day from the previous working day (that
-- was the source of the "adjusted board disappears on login" bug — a load that
-- wrote to the database). Carry-forward is now an explicit user action only
-- (Carry over / Reset Board). This table's sole remaining job is the board lock:
-- locked_by/locked_at are set when a planner locks a finished day (view-only for
-- everyone) and cleared on unlock. (initialized_at is a harmless leftover column;
-- rows are created only by locking now.)

create table if not exists plan_days (
  board_id  uuid not null references boards(id) on delete cascade,
  plan_date date not null,
  initialized_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  primary key (board_id, plan_date)
);

-- ===== Users, roles and permissions =====
-- Everything below to the RLS section is also shipped as
-- migration-2026-09-04b-user-management.sql, for a project that already
-- has data. The two files are kept identical on purpose.

-- ===== Roles =====
-- `protected` marks the row the app refuses to weaken (admin). It is a data
-- flag rather than a hardcoded name so the guard trigger below has one thing
-- to read, but nothing creates a second protected role today.

create table if not exists roles (
  key       text primary key,
  label     text not null,
  rank      int  not null default 100,
  protected boolean not null default false
);

insert into roles (key, label, rank, protected) values
  ('admin',    'Admin',    10, true),
  ('manager',  'Manager',  20, false),
  ('engineer', 'Engineer', 30, false),
  ('viewer',   'Viewer',   40, false)
on conflict (key) do nothing;

-- ===== The permission matrix =====
-- One row per (role, area). `area` is a flat key shared by the client, this
-- table and the RLS policies below — see the seed block for the full list.
-- Levels form a ladder: none < view < edit.

create table if not exists role_permissions (
  role_key text not null references roles(key) on delete cascade,
  area     text not null,
  level    text not null default 'none' check (level in ('none','view','edit')),
  primary key (role_key, area)
);

-- ===== Profiles: the app's own record of a sign-in account =====
-- `status` answers "may they in at all", `role_key` answers "what may they
-- touch" — two separate axes on purpose, so approving a pending request as an
-- Engineer is one natural action rather than a magic role value.

create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null unique,
  full_name    text,
  role_key     text not null default 'viewer' references roles(key) on delete restrict,
  status       text not null default 'pending' check (status in ('pending','active','disabled')),
  requested_at timestamptz not null default now(),
  approved_at  timestamptz,
  approved_by  text,
  -- stamped by the app at boot (touch_last_seen). auth.users.last_sign_in_at is
  -- the real thing but it is not readable from the browser, and an admin
  -- deciding who to disable needs "when was this person last here".
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists profiles_status_idx on profiles(status);
alter table profiles add column if not exists last_seen_at timestamptz;

-- ===== Who may request access =====
-- Empty table = no restriction, which is what keeps this from bricking a
-- project where someone clears it by accident.

create table if not exists allowed_email_domains (
  domain text primary key
);
insert into allowed_email_domains (domain) values ('trigo-group.com') on conflict do nothing;

-- ===== Seed the default matrix =====
-- Only ever fills in rows that are missing, so re-running this file never
-- undoes a change an admin has made in Settings → Roles & permissions.

insert into role_permissions (role_key, area, level)
select v.role_key, v.area, v.level from (values
  -- tabs & menus
  ('admin','board','edit'),      ('manager','board','edit'),      ('engineer','board','edit'),      ('viewer','board','view'),
  ('admin','overview','view'),   ('manager','overview','view'),   ('engineer','overview','view'),   ('viewer','overview','view'),
  ('admin','emplist','edit'),    ('manager','emplist','edit'),    ('engineer','emplist','edit'),    ('viewer','emplist','view'),
  ('admin','hostlist','edit'),   ('manager','hostlist','edit'),   ('engineer','hostlist','edit'),   ('viewer','hostlist','view'),
  ('admin','settings','edit'),   ('manager','settings','edit'),   ('engineer','settings','edit'),   ('viewer','settings','none'),
  ('admin','users','edit'),      ('manager','users','none'),      ('engineer','users','none'),      ('viewer','users','none'),
  -- overview sections. ov.history (History + Engineer workload) and
  -- ov.byEngineer are the per-engineer performance picture — management data
  -- rather than today's operational plan — so they start Admin/Manager only.
  ('admin','ov.status','view'),      ('manager','ov.status','view'),      ('engineer','ov.status','view'),      ('viewer','ov.status','view'),
  ('admin','ov.kpi','view'),         ('manager','ov.kpi','view'),         ('engineer','ov.kpi','view'),         ('viewer','ov.kpi','view'),
  ('admin','ov.actionQueue','view'), ('manager','ov.actionQueue','view'), ('engineer','ov.actionQueue','view'), ('viewer','ov.actionQueue','view'),
  ('admin','ov.byBoard','view'),     ('manager','ov.byBoard','view'),     ('engineer','ov.byBoard','view'),     ('viewer','ov.byBoard','view'),
  ('admin','ov.history','view'),     ('manager','ov.history','view'),     ('engineer','ov.history','none'),     ('viewer','ov.history','none'),
  ('admin','ov.byEngineer','view'),  ('manager','ov.byEngineer','view'),  ('engineer','ov.byEngineer','none'),  ('viewer','ov.byEngineer','none'),
  ('admin','ov.dayNight','view'),    ('manager','ov.dayNight','view'),    ('engineer','ov.dayNight','view'),    ('viewer','ov.dayNight','view'),
  ('admin','ov.hostRisk','view'),    ('manager','ov.hostRisk','view'),    ('engineer','ov.hostRisk','view'),    ('viewer','ov.hostRisk','view'),
  ('admin','ov.byArea','view'),      ('manager','ov.byArea','view'),      ('engineer','ov.byArea','view'),      ('viewer','ov.byArea','view'),
  ('admin','ov.leave','view'),       ('manager','ov.leave','view'),       ('engineer','ov.leave','view'),       ('viewer','ov.leave','view')
) as v(role_key, area, level)
where not exists (
  select 1 from role_permissions rp where rp.role_key = v.role_key and rp.area = v.area
);

-- ===== Helper functions =====
-- All `security definer`: a policy ON profiles that reads profiles would
-- recurse forever otherwise. `stable` + the (select ...) wrapper at the call
-- sites lets Postgres evaluate each one once per statement instead of once per
-- row. search_path is pinned because a security-definer function that resolves
-- names through the caller's search_path is a privilege-escalation hole.

create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'active');
$fn$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public, pg_temp as $fn$
  select p.role_key from profiles p where p.id = auth.uid() and p.status = 'active';
$fn$;

/* The single source of truth for "may this person do this". The client has a
   JS twin of exactly this ladder (see `can()` in app.js) so the UI and the
   database can never disagree about what a role means. */
create or replace function public.can(p_area text, p_need text default 'view')
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce((
    select (case rp.level  when 'edit' then 2 when 'view' then 1 else 0 end)
        >= (case p_need    when 'edit' then 2 when 'view' then 1 else 0 end)
    from profiles p
    join role_permissions rp on rp.role_key = p.role_key and rp.area = p_area
    where p.id = auth.uid() and p.status = 'active'
  ), false);
$fn$;

/* Self-service, and deliberately narrow: a person may set their own display
   name and nothing else. Role and status are not parameters, so this cannot be
   turned into a way to promote yourself. */
create or replace function public.update_my_profile(p_full_name text)
returns void language sql security definer set search_path = public, pg_temp as $fn$
  update profiles
     set full_name = nullif(btrim(coalesce(p_full_name, '')), ''),
         updated_at = now()
   where id = auth.uid();
$fn$;

/* One column, stamped once per sign-in. Deliberately not part of
   update_my_profile: it is written on every boot, and keeping it separate
   means the display-name path stays a deliberate user action. */
create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = public, pg_temp as $fn$
  update profiles set last_seen_at = now() where id = auth.uid();
$fn$;

grant execute on function public.is_active()               to authenticated;
grant execute on function public.my_role()                 to authenticated;
grant execute on function public.can(text, text)           to authenticated;
grant execute on function public.update_my_profile(text)   to authenticated;
grant execute on function public.touch_last_seen()         to authenticated;

-- ===== auth.users triggers =====

/* The @trigo-group.com rule. A table trigger rather than a client-side check
   or an Auth Hook: it covers sign-up, admin invite and any future OAuth alike,
   and it works on every Supabase plan (Auth Hooks are gated on some). */
create or replace function public.enforce_email_domain()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  d text;
begin
  if new.email is null then return new; end if;
  -- an empty allow-list means "no restriction" — so clearing the table by
  -- accident opens sign-up back up rather than locking everyone out
  if not exists (select 1 from public.allowed_email_domains) then return new; end if;
  d := split_part(lower(new.email), '@', 2);
  if not exists (select 1 from public.allowed_email_domains a where a.domain = d) then
    raise exception 'Access is limited to % addresses.',
      (select string_agg('@' || domain, ' or ' order by domain) from public.allowed_email_domains)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

/* Every auth user gets a profile the moment they exist, pending by default —
   so a new sign-up shows up in Settings → Users waiting for approval, and an
   invited user is approved by the admin who invited them. */
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  insert into public.profiles (id, email, full_name, status)
  values (
    new.id,
    lower(new.email),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

create or replace function public.sync_profile_email()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  update public.profiles set email = lower(new.email), updated_at = now() where id = new.id;
  return new;
end;
$fn$;

drop trigger if exists enforce_email_domain on auth.users;
create trigger enforce_email_domain
  before insert on auth.users
  for each row execute function public.enforce_email_domain();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

-- ===== Lock-out guards =====
-- The UI also renders the Admin column read-only and hides the self-demote
-- buttons, but these triggers are what make it true: the same rules cannot be
-- worked around with the anon key from a browser console.

create or replace function public.guard_last_admin()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  losing_admin boolean;
begin
  -- NEW is unassigned on DELETE, so the two cases are kept strictly apart
  -- rather than relying on AND short-circuiting inside one expression.
  if tg_op = 'DELETE' then
    losing_admin := (old.role_key = 'admin' and old.status = 'active');
  else
    losing_admin := (old.role_key = 'admin' and old.status = 'active')
                and not (new.role_key = 'admin' and new.status = 'active');
  end if;

  if losing_admin and not exists (
    select 1 from public.profiles p
    where p.id <> old.id and p.role_key = 'admin' and p.status = 'active'
  ) then
    raise exception 'This is the only active admin — promote someone else first.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$fn$;

drop trigger if exists guard_last_admin on profiles;
create trigger guard_last_admin
  before update or delete on profiles
  for each row execute function public.guard_last_admin();

/* Admin is the role that can always get back in. The rule enforced here is
   narrow on purpose: no area may be switched off for Admin, Users must stay at
   `edit` (that is the pane the matrix itself lives in), and an Admin row cannot
   be deleted out from under the check. Areas that are legitimately read-only
   for everyone — the Overview sections — stay at `view`. */
create or replace function public.guard_admin_permissions()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  r_role  text;
  r_area  text;
  r_level text;
begin
  if tg_op = 'DELETE' then
    if old.role_key = 'admin' then
      raise exception 'The Admin role keeps access to every area — its permissions cannot be removed.'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  r_role  := new.role_key;
  r_area  := new.area;
  r_level := new.level;

  if r_role = 'admin' then
    if r_level = 'none' then
      raise exception 'The Admin role keeps access to every area — "%" cannot be switched off.', r_area
        using errcode = 'check_violation';
    end if;
    if r_area = 'users' and r_level <> 'edit' then
      raise exception 'Admin must keep full access to Users, or nobody could change these settings again.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists guard_admin_permissions on role_permissions;
create trigger guard_admin_permissions
  before insert or update or delete on role_permissions
  for each row execute function public.guard_admin_permissions();

/* A protected role (admin) may be relabelled or reordered — that is cosmetic —
   but it can never be deleted, renamed at the key level, or quietly
   unprotected, because everything else here keys off `admin` by name. */
create or replace function public.guard_protected_roles()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not old.protected then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'The % role is built in and cannot be removed.', old.key
      using errcode = 'check_violation';
  end if;
  if new.key <> old.key or new.protected is distinct from old.protected then
    raise exception 'The % role is built in — its name and protection cannot change.', old.key
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists guard_protected_roles on roles;
create trigger guard_protected_roles
  before update or delete on roles
  for each row execute function public.guard_protected_roles();


-- ===== Row Level Security =====
-- The rule is: read if your account is active, write only if your role has
-- `edit` on the area that table belongs to (see role_permissions above).
--
-- Reads stay wide on purpose. The board cannot render without missions,
-- assignments and employees, so a Viewer must be able to read them; what a
-- Viewer loses is the ability to change anything. Hiding individual Overview
-- SECTIONS is a presentation choice made in app.js — those sections are
-- computed from these same rows, so it is not, and cannot be, a data barrier.

alter table boards             enable row level security;
alter table engineers          enable row level security;
alter table service_areas      enable row level security;
alter table employees          enable row level security;
alter table missions           enable row level security;
alter table assignments        enable row level security;
alter table day_overrides      enable row level security;
alter table plan_days          enable row level security;
alter table deployment_history enable row level security;
alter table hosts              enable row level security;

-- ===== Row Level Security on the new tables =====

alter table roles                 enable row level security;
alter table role_permissions      enable row level security;
alter table profiles              enable row level security;
alter table allowed_email_domains enable row level security;

-- Every active user needs the role list and the matrix to render their own UI,
-- so both are readable; only Users-edit can change them.
drop policy if exists "roles readable" on roles;
create policy "roles readable" on roles
  for select using ((select public.is_active()));
drop policy if exists "roles writable by user admins" on roles;
create policy "roles writable by user admins" on roles
  for all using ((select public.can('users','edit'))) with check ((select public.can('users','edit')));

drop policy if exists "role_permissions readable" on role_permissions;
create policy "role_permissions readable" on role_permissions
  for select using ((select public.is_active()));
drop policy if exists "role_permissions writable by user admins" on role_permissions;
create policy "role_permissions writable by user admins" on role_permissions
  for all using ((select public.can('users','edit'))) with check ((select public.can('users','edit')));

-- A person can always read their own row — that is how the app knows it is
-- still pending, and how the sign-in screen explains why. Seeing everyone
-- else's needs the Users area.
drop policy if exists "profiles read own or all" on profiles;
create policy "profiles read own or all" on profiles
  for select using (id = auth.uid() or (select public.can('users')));

-- Deliberately no self-update policy: a person changes their own display name
-- through update_my_profile(), which cannot touch role or status.
drop policy if exists "profiles managed by user admins" on profiles;
create policy "profiles managed by user admins" on profiles
  for update using ((select public.can('users','edit'))) with check ((select public.can('users','edit')));
drop policy if exists "profiles deletable by user admins" on profiles;
create policy "profiles deletable by user admins" on profiles
  for delete using ((select public.can('users','edit')));
-- Rows are created by handle_new_user() (security definer), never by a client.

drop policy if exists "allowed_email_domains readable" on allowed_email_domains;
create policy "allowed_email_domains readable" on allowed_email_domains
  for select using ((select public.is_active()));
drop policy if exists "allowed_email_domains writable by user admins" on allowed_email_domains;
create policy "allowed_email_domains writable by user admins" on allowed_email_domains
  for all using ((select public.can('users','edit'))) with check ((select public.can('users','edit')));

-- ===== Row Level Security rewrite on the existing tables =====
-- Replaces the original "any signed-in user can do anything" policies
-- (auth.role() = 'authenticated') with: read if your account is active, write
-- only if your role has `edit` on the area that table belongs to.
--
-- Reads stay wide on purpose. The board cannot render without missions,
-- assignments and employees, so a Viewer must be able to read them; what a
-- Viewer loses is the ability to change anything. (Hiding individual Overview
-- SECTIONS is a presentation choice made in app.js — those sections are
-- computed from these same rows, so it is not, and cannot be, a data barrier.)

do $$
declare
  m record;
begin
  for m in select * from (values
    ('missions',           'board'),
    ('assignments',        'board'),
    ('plan_days',          'board'),
    ('day_overrides',      'board'),
    ('deployment_history', 'board'),
    ('employees',          'emplist'),
    ('hosts',              'hostlist'),
    ('engineers',          'settings'),
    ('service_areas',      'settings'),
    ('boards',             'settings')
  ) as v(tbl, area)
  loop
    -- the original single all-in-one policy from schema.sql
    execute format('drop policy if exists %I on public.%I', 'authenticated read/write ' || m.tbl, m.tbl);
    -- and our own, so this file can be re-run
    execute format('drop policy if exists %I on public.%I', m.tbl || ' read', m.tbl);
    execute format('drop policy if exists %I on public.%I', m.tbl || ' insert', m.tbl);
    execute format('drop policy if exists %I on public.%I', m.tbl || ' update', m.tbl);
    execute format('drop policy if exists %I on public.%I', m.tbl || ' delete', m.tbl);

    execute format(
      'create policy %I on public.%I for select using ((select public.is_active()))',
      m.tbl || ' read', m.tbl);
    execute format(
      'create policy %I on public.%I for insert with check ((select public.can(%L, ''edit'')))',
      m.tbl || ' insert', m.tbl, m.area);
    execute format(
      'create policy %I on public.%I for update using ((select public.can(%L, ''edit''))) with check ((select public.can(%L, ''edit'')))',
      m.tbl || ' update', m.tbl, m.area, m.area);
    execute format(
      'create policy %I on public.%I for delete using ((select public.can(%L, ''edit'')))',
      m.tbl || ' delete', m.tbl, m.area);
  end loop;
end $$;

-- ===== Realtime: broadcast changes to every connected client =====
-- deployment_history is deliberately NOT added below: nothing renders it live
-- across clients, the Host Record tab just reads it fresh on every modal open.
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
do $$
begin
  alter publication supabase_realtime add table plan_days;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table hosts;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table profiles;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table roles;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table role_permissions;
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

-- ===== Bootstrap: make yourself the first admin =====
-- A fresh project has no accounts yet, so this cannot be seeded. After running
-- this file:
--   1. create your own account — Authentication → Users → Add user, or sign up
--      through the app's "Request access" form with your @trigo-group.com address;
--   2. run the two lines below with your address filled in.
-- Without an admin nobody can open Settings → Users, and no pending request can
-- ever be approved.
--
--   update profiles
--      set role_key = 'admin', status = 'active', approved_at = now()
--    where email = lower('YOUR-EMAIL@trigo-group.com');
--
-- Check it worked:
--   select email, role_key, status from profiles;
