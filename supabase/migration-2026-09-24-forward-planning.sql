-- Migration 2026-09-24: forward planning — staleness stamps, Capacity, Forecast
-- Run once in the Supabase SQL Editor (safe to re-run). Then run
-- migration-2026-09-24b-forward-planning-data.sql (read its header first), then
-- redeploy the app.
--
-- Three things ship together in this release:
--
--   1. plan_day_stamps — when a (board, date) was last edited and which day it
--      was carried over from, so the app can say "the day this plan was copied
--      from has changed since" and offer a line-by-line review instead of a
--      destructive Reset. A new table rather than more columns on plan_days:
--      plan_days is in the Realtime publication and every change to it makes
--      every open browser reload its locks, and this table is stamped on every
--      single mission/assignment write.
--
--   2. capacity_demand — headcount needed per board, date, host and shift,
--      for the Capacity tab. Numbers only, no names, never touches a board.
--
--   3. forecast_missions / forecast_assignments / forecast_hold_events — tentative
--      plans for dates beyond the confirm horizon (the next working day). Kept in
--      their own tables on purpose: missions and assignments are read by the
--      board, Overview, Org Chart, utilization, the export and deployment
--      history, and a status column would need a filter in every one of those
--      reads — one missed filter would leak tentative plans into the LINE
--      export. Separate tables leave every existing read correct by default.
--      A forecast placement is a soft "hold" by the engineer who made it; taking
--      someone out of another engineer's hold is allowed but recorded, so the
--      engineer who lost them sees a red flag until they acknowledge it.
--
-- Plus a database backstop on missions/assignments: no confirmed row more than
-- 10 calendar days ahead (Bangkok time). The app enforces the real rule (next
-- working day, per board); this only stops a buggy client or a direct API call.
--
-- Everything below is mirrored in schema.sql — keep the two identical.

-- ===== 1. Plan-day stamps =====

create table if not exists plan_day_stamps (
  board_id           uuid not null references boards(id) on delete cascade,
  plan_date          date not null,
  last_edited_at     timestamptz,   -- bumped by trigger on any missions/assignments change
  last_edited_by     text,
  carried_from       date,          -- set when Carry over / Reset / Review changes runs
  carried_at         timestamptz,
  forecast_merged_at timestamptz,   -- set when a forecast for this day is reviewed & merged
  forecast_merged_by text,
  primary key (board_id, plan_date)
);

/* One upsert, shared by both triggers below. The board check matters: deleting
   a board cascades to its missions, and by the time those row triggers fire
   the board row is already gone — inserting a stamp that references it would
   fail the foreign key and, with it, the whole board delete. Same for an
   employee delete cascading to assignments (no board to find: skip). */
create or replace function public._bump_plan_day_stamp(p_board_id uuid, p_plan_date date, p_by text)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if p_board_id is null or p_plan_date is null then return; end if;
  if not exists (select 1 from boards b where b.id = p_board_id) then return; end if;
  insert into plan_day_stamps (board_id, plan_date, last_edited_at, last_edited_by)
  values (p_board_id, p_plan_date, now(), p_by)
  on conflict (board_id, plan_date) do update
    set last_edited_at = excluded.last_edited_at,
        last_edited_by = excluded.last_edited_by;
end;
$fn$;
revoke execute on function public._bump_plan_day_stamp(uuid, date, text) from public, anon, authenticated;

/* A trigger rather than max(updated_at) because a DELETE has to count too:
   unassigning someone deletes their row, which would leave nothing behind to
   take a max over. OLD and NEW are only touched in the operations that have
   them — NEW is unassigned on DELETE. */
create or replace function public.bump_plan_day_stamp()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_by    text := coalesce(auth.jwt() ->> 'email', 'system');
  v_board uuid;
begin
  if tg_table_name = 'missions' then
    if tg_op in ('UPDATE', 'DELETE') then
      perform public._bump_plan_day_stamp(old.board_id, old.plan_date, v_by);
    end if;
    if tg_op = 'INSERT' then
      perform public._bump_plan_day_stamp(new.board_id, new.plan_date, v_by);
    elsif tg_op = 'UPDATE' and (new.board_id is distinct from old.board_id or new.plan_date is distinct from old.plan_date) then
      perform public._bump_plan_day_stamp(new.board_id, new.plan_date, v_by);
    end if;
  else  -- assignments: the board comes from the employee
    if tg_op in ('UPDATE', 'DELETE') then
      select e.board_id into v_board from employees e where e.id = old.employee_id;
      perform public._bump_plan_day_stamp(v_board, old.plan_date, v_by);
    end if;
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and (new.employee_id is distinct from old.employee_id or new.plan_date is distinct from old.plan_date)) then
      select e.board_id into v_board from employees e where e.id = new.employee_id;
      perform public._bump_plan_day_stamp(v_board, new.plan_date, v_by);
    end if;
  end if;
  return null;   -- AFTER trigger: the return value is ignored
end;
$fn$;

drop trigger if exists plan_day_stamp on missions;
create trigger plan_day_stamp
  after insert or update or delete on missions
  for each row execute function public.bump_plan_day_stamp();
drop trigger if exists plan_day_stamp on assignments;
create trigger plan_day_stamp
  after insert or update or delete on assignments
  for each row execute function public.bump_plan_day_stamp();

/* Written by the app after a carry (Carry over, Reset Board, Review changes).
   An RPC rather than a plain upsert so carried_at is the SERVER's clock — it is
   compared against last_edited_at, which the trigger above stamps with now(),
   and a browser clock a few minutes out would make that comparison lie. */
create or replace function public.stamp_carry(p_board_id uuid, p_plan_date date, p_carried_from date)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not (select public.can('board', 'edit')) then
    raise exception 'Your role cannot change the board.' using errcode = 'insufficient_privilege';
  end if;
  insert into plan_day_stamps (board_id, plan_date, carried_from, carried_at)
  values (p_board_id, p_plan_date, p_carried_from, now())
  on conflict (board_id, plan_date) do update
    set carried_from = excluded.carried_from,
        carried_at   = excluded.carried_at;
end;
$fn$;

/* Written when a planner has reviewed a day's forecast and merged what they
   wanted of it. Hides the "Forecast for this day" banner for good; the
   forecast rows themselves are kept, read-only, for reference. */
create or replace function public.stamp_forecast_merge(p_board_id uuid, p_plan_date date)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not (select public.can('board', 'edit')) then
    raise exception 'Your role cannot change the board.' using errcode = 'insufficient_privilege';
  end if;
  insert into plan_day_stamps (board_id, plan_date, forecast_merged_at, forecast_merged_by)
  values (p_board_id, p_plan_date, now(), coalesce(auth.jwt() ->> 'email', 'unknown'))
  on conflict (board_id, plan_date) do update
    set forecast_merged_at = excluded.forecast_merged_at,
        forecast_merged_by = excluded.forecast_merged_by;
end;
$fn$;

-- ===== 2. Capacity demand =====

-- One row per board, date, HOST and shift: the site the people are needed
-- at, by the same name the Host list and every mission use.
create table if not exists capacity_demand (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references boards(id) on delete cascade,
  plan_date  date not null,
  host       text not null,
  shift      text not null check (shift in ('day', 'night')),
  headcount  int  not null check (headcount >= 0),
  note       text,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (board_id, plan_date, host, shift)
);
-- The first draft of this table was keyed by customer. A database that ran
-- that draft keeps its rows; the column (and its unique key) is renamed.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'capacity_demand' and column_name = 'customer')
     and not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'capacity_demand' and column_name = 'host') then
    alter table capacity_demand rename column customer to host;
  end if;
  if exists (select 1 from pg_constraint where conname = 'capacity_demand_board_id_plan_date_customer_shift_key') then
    alter table capacity_demand rename constraint capacity_demand_board_id_plan_date_customer_shift_key
      to capacity_demand_board_id_plan_date_host_shift_key;
  end if;
end $$;
create index if not exists capacity_demand_date_idx on capacity_demand(plan_date);

-- ===== 3. Forecast layer =====

create table if not exists forecast_missions (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references boards(id) on delete cascade,
  plan_date   date not null,
  number      text not null,
  host        text not null,
  customer    text not null,
  shift       text not null check (shift in ('day', 'night')),
  start_time  time not null default '08:00',
  end_time    time not null default '17:00',
  ppe         text,
  remark      text,
  engineer_id uuid references engineers(id) on delete set null,
  created_by  text,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (board_id, plan_date, number, shift)
);
create index if not exists forecast_missions_board_date_idx on forecast_missions(board_id, plan_date);

-- One row per employee per date, like assignments: a forecast placement is a
-- soft hold, and the unique key is what makes a second engineer's placement of
-- the same person a visible collision instead of a silent double-booking.
create table if not exists forecast_assignments (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references employees(id) on delete cascade,
  plan_date           date not null,
  forecast_mission_id uuid references forecast_missions(id) on delete cascade,
  zone                text check (zone in ('annual', 'sick', 'business', 'unpaid', 'exchange')),
  held_by             text,          -- email of the engineer who placed the hold
  updated_at          timestamptz not null default now(),
  unique (employee_id, plan_date),
  check ((forecast_mission_id is not null and zone is null) or
         (forecast_mission_id is null and zone is not null))
);
create index if not exists forecast_assignments_date_idx on forecast_assignments(plan_date);

-- Every time someone takes a person out of ANOTHER engineer's hold. Stays
-- unacknowledged — a red flag on the losing mission — until somebody
-- acknowledges it, so an engineer who was offline when it happened still sees it.
create table if not exists forecast_hold_events (
  id                       uuid primary key default gen_random_uuid(),
  employee_id              uuid not null references employees(id) on delete cascade,
  plan_date                date not null,
  from_forecast_mission_id uuid references forecast_missions(id) on delete cascade,  -- null if the hold was a leave zone
  from_zone                text,
  from_held_by             text not null,   -- the engineer who lost the person
  to_forecast_mission_id   uuid references forecast_missions(id) on delete set null,
  to_zone                  text,
  taken_by                 text not null,   -- the engineer who moved them
  taken_at                 timestamptz not null default now(),
  acknowledged_at          timestamptz,
  acknowledged_by          text
);
create index if not exists forecast_hold_events_open_idx on forecast_hold_events(from_held_by) where acknowledged_at is null;
create index if not exists forecast_hold_events_mission_idx on forecast_hold_events(from_forecast_mission_id);

/* The only way the app places, moves or removes a person in a forecast. One
   function so the move and the "you took someone's hold" record happen in the
   same transaction — a second, separate insert could fail after the move had
   already happened, and the losing engineer would never be told.

   p_mission_id / p_zone: exactly one of them to place someone, neither to
   take them off the forecast (back to standby). An event is only written when
   the existing hold belongs to someone else: re-arranging your own holds is
   not news to anybody, and neither is a hold nobody owns ('migrated'). */
create or replace function public.set_forecast_assignment(
  p_employee_id uuid, p_plan_date date, p_mission_id uuid default null, p_zone text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_me    text := lower(coalesce(auth.jwt() ->> 'email', 'unknown'));
  v_old   forecast_assignments%rowtype;
  v_event uuid;
begin
  if not (select public.can('forecast', 'edit')) then
    raise exception 'Your role cannot change forecasts.' using errcode = 'insufficient_privilege';
  end if;
  if p_mission_id is not null and p_zone is not null then
    raise exception 'A forecast placement is a mission or a leave type, not both.' using errcode = 'check_violation';
  end if;
  if p_mission_id is not null and not exists (
    select 1 from forecast_missions fm join employees e on e.board_id = fm.board_id
     where fm.id = p_mission_id and fm.plan_date = p_plan_date and e.id = p_employee_id
  ) then
    raise exception 'That forecast mission is not on this employee''s board for this date.' using errcode = 'check_violation';
  end if;

  select * into v_old from forecast_assignments
   where employee_id = p_employee_id and plan_date = p_plan_date
   for update;

  if found and v_old.forecast_mission_id is not distinct from p_mission_id
           and v_old.zone is not distinct from p_zone then
    return jsonb_build_object('changed', false);
  end if;

  -- 'migrated' marks a hold the data migration could not attribute to
  -- anyone: there is nobody to tell, so taking it is not an event
  if found and v_old.held_by is not null and lower(v_old.held_by) <> v_me
           and lower(v_old.held_by) <> 'migrated' then
    insert into forecast_hold_events (employee_id, plan_date, from_forecast_mission_id, from_zone,
                                      from_held_by, to_forecast_mission_id, to_zone, taken_by)
    values (p_employee_id, p_plan_date, v_old.forecast_mission_id, v_old.zone,
            v_old.held_by, p_mission_id, p_zone, v_me)
    returning id into v_event;
  end if;

  if p_mission_id is null and p_zone is null then
    delete from forecast_assignments where employee_id = p_employee_id and plan_date = p_plan_date;
  else
    insert into forecast_assignments (employee_id, plan_date, forecast_mission_id, zone, held_by, updated_at)
    values (p_employee_id, p_plan_date, p_mission_id, p_zone, v_me, now())
    on conflict (employee_id, plan_date) do update
      set forecast_mission_id = excluded.forecast_mission_id,
          zone                = excluded.zone,
          held_by             = excluded.held_by,
          updated_at          = excluded.updated_at;
  end if;

  return jsonb_build_object('changed', true, 'event_id', v_event,
                            'taken_from', case when v_event is not null then v_old.held_by end);
end;
$fn$;

/* Anyone who may edit forecasts may acknowledge a lost hold — the engineer who
   lost the person is the usual one, but a manager clearing the flag for a
   colleague on leave is fine too. who/when are stamped server-side. */
create or replace function public.acknowledge_hold_events(p_ids uuid[])
returns int language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  n int;
begin
  if not (select public.can('forecast', 'edit')) then
    raise exception 'Your role cannot change forecasts.' using errcode = 'insufficient_privilege';
  end if;
  update forecast_hold_events
     set acknowledged_at = now(),
         acknowledged_by = lower(coalesce(auth.jwt() ->> 'email', 'unknown'))
   where id = any(p_ids) and acknowledged_at is null;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- ===== 4. Confirm horizon backstop =====

/* Calendar days, Bangkok time (current_date alone is UTC, which is 7 hours
   behind the planners). Deliberately looser than the app's rule of "next
   working day" so a long holiday such as Songkran never blocks a real plan. */
create or replace function public.within_confirm_horizon(p_date date)
returns boolean language sql stable set search_path = public, pg_temp as $fn$
  select p_date <= (now() at time zone 'Asia/Bangkok')::date + 10
$fn$;

grant execute on function public.stamp_carry(uuid, date, date)                     to authenticated;
grant execute on function public.stamp_forecast_merge(uuid, date)                  to authenticated;
grant execute on function public.set_forecast_assignment(uuid, date, uuid, text)   to authenticated;
grant execute on function public.acknowledge_hold_events(uuid[])                   to authenticated;
grant execute on function public.within_confirm_horizon(date)                      to authenticated;

-- ===== 5. Permissions: two new areas =====
-- Only fills in rows that are missing, so re-running never undoes an admin's change.

insert into role_permissions (role_key, area, level)
select v.role_key, v.area, v.level from (values
  ('admin','capacity','edit'),   ('manager','capacity','edit'),   ('engineer','capacity','edit'),   ('viewer','capacity','view'),
  ('admin','forecast','edit'),   ('manager','forecast','edit'),   ('engineer','forecast','edit'),   ('viewer','forecast','view')
) as v(role_key, area, level)
where not exists (
  select 1 from role_permissions rp where rp.role_key = v.role_key and rp.area = v.area
);

-- ===== 6. Row Level Security on the new tables =====
-- Same rule as every other table: read if your account is active, write only
-- if your role has `edit` on the table's area.

alter table plan_day_stamps      enable row level security;
alter table capacity_demand      enable row level security;
alter table forecast_missions    enable row level security;
alter table forecast_assignments enable row level security;
alter table forecast_hold_events enable row level security;

do $$
declare
  m record;
begin
  for m in select * from (values
    ('plan_day_stamps',      'board'),
    ('capacity_demand',      'capacity'),
    ('forecast_missions',    'forecast'),
    ('forecast_assignments', 'forecast'),
    ('forecast_hold_events', 'forecast')
  ) as v(tbl, area)
  loop
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

-- ===== 7. Horizon backstop on missions and assignments =====
-- Replaces the write policies the RLS loop in schema.sql creates for these two
-- tables with the same rule plus the calendar ceiling. Reads are unchanged.
-- NOTE: re-running migration-2026-09-04b-user-management.sql would put the
-- plain policies back — run this file again after it if that ever happens.

do $$
declare
  t text;
begin
  foreach t in array array['missions', 'assignments']
  loop
    execute format('drop policy if exists %I on public.%I', t || ' insert', t);
    execute format('drop policy if exists %I on public.%I', t || ' update', t);
    execute format('drop policy if exists %I on public.%I', t || ' delete', t);
    execute format(
      'create policy %I on public.%I for insert with check ((select public.can(''board'', ''edit'')) and public.within_confirm_horizon(plan_date))',
      t || ' insert', t);
    execute format(
      'create policy %I on public.%I for update using ((select public.can(''board'', ''edit'')) and public.within_confirm_horizon(plan_date)) with check ((select public.can(''board'', ''edit'')) and public.within_confirm_horizon(plan_date))',
      t || ' update', t);
    execute format(
      'create policy %I on public.%I for delete using ((select public.can(''board'', ''edit'')) and public.within_confirm_horizon(plan_date))',
      t || ' delete', t);
  end loop;
end $$;

-- ===== 8. Realtime =====
-- plan_day_stamps is deliberately NOT added: it is written on every board edit,
-- and the missions/assignments events that cause those writes already make
-- every open board re-read its stamps.

do $$
begin
  alter publication supabase_realtime add table capacity_demand;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table forecast_missions;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table forecast_assignments;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table forecast_hold_events;
exception when duplicate_object then null;
end $$;
