-- Migration 2026-11-09: the Mission register (Missions tab), the Site Admin role and the
-- new-year mission number.
-- Run once in the Supabase SQL Editor (safe to re-run), then redeploy the app. Until it has run
-- the app works exactly as before: the Missions tab, Close mission and the new-year numbers are
-- simply not offered.
--
-- Why: a mission only existed as a copy on each day's plan (missions, one row per board + date),
-- so nothing knew which missions a board has, which are still running, when one ended, or that
-- LCBTH.27.0001 is the same job LCBTH.26.0005 was last year. This adds that one place.
--
--   * mission_register — one row per board + mission number + shift. It is kept in step with the
--     daily rows by a trigger: a mission saved on any day creates or refreshes its register row
--     (first day on the board, latest day, and the details of the latest day). Day and Night of
--     one mission are two rows with the same number; a mission running on two boards (two
--     locations) is two rows with the same number. Numbers are otherwise unique company-wide;
--     the app asks before reusing one, the database does not refuse it.
--   * status 'open' / 'closed'. close_mission() ends a job: the days after its last working day
--     lose it (their crew go back to Standby), carry over never brings it back, and its earlier
--     days, crew and Host Record stay as they were. reopen_mission() undoes that.
--   * mission_number_history — every new-year number entered (old -> new, from which date).
--     renumber_missions() renames the register rows and every day from that date on (missions,
--     forecast_missions, deployment_history) in one go. Earlier days keep the old number.
--   * Site Admin (roles.key 'siteadmin', rank 35: below Engineer, so not offered as a mission's
--     Engineer). Starts with view on everything a Viewer sees, plus the two new areas:
--       missions      the Missions tab, Close mission           (Engineer and up, Site Admin)
--       missionadmin  Reopen, new-year numbers, deleting a row  (Manager and up, Site Admin)
--
-- The back-fill makes a register row for every number + shift already on a board. A mission whose
-- latest day is more than 7 days before its board's latest planned day is registered as closed on
-- that latest day (close_note says the migration did it); every other one is open. Hidden
-- missions are open (Hide is a pause, not an end).

-- ===== 1. The Site Admin role =====

insert into roles (key, label, rank, protected) values ('siteadmin', 'Site Admin', 35, false)
on conflict (key) do nothing;

-- Site Admin starts as a Viewer everywhere (whatever areas this project has)...
insert into role_permissions (role_key, area, level)
select 'siteadmin', rp.area, rp.level from role_permissions rp
 where rp.role_key = 'viewer'
   and not exists (select 1 from role_permissions x where x.role_key = 'siteadmin' and x.area = rp.area);

-- ...and every role gets the two new areas. Only rows that are missing are added, so re-running
-- never undoes a change made in Settings -> Roles & permissions.
insert into role_permissions (role_key, area, level)
select v.role_key, v.area, v.level from (values
  ('admin','missions','edit'),      ('manager','missions','edit'),      ('engineer','missions','edit'),
  ('siteadmin','missions','edit'),  ('viewer','missions','view'),
  ('admin','missionadmin','edit'),  ('manager','missionadmin','edit'),  ('engineer','missionadmin','none'),
  ('siteadmin','missionadmin','edit'), ('viewer','missionadmin','none')
) as v(role_key, area, level)
where exists (select 1 from roles r where r.key = v.role_key)
  and not exists (select 1 from role_permissions rp where rp.role_key = v.role_key and rp.area = v.area);

-- ===== 2. The register =====

create table if not exists mission_register (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references boards(id) on delete cascade,
  number      text not null,
  shift       text not null check (shift in ('day', 'night')),
  -- the details of the latest day on the board (what "Add to board" uses)
  host        text,
  customer    text,
  start_time  time,
  end_time    time,
  engineer_id uuid references engineers(id) on delete set null,
  ppe         text,
  remark      text,
  status      text not null default 'open' check (status in ('open', 'closed')),
  opened_on   date,          -- first day on the board (or the Start date typed in Bulk edit)
  last_on     date,          -- latest day on the board
  closed_on   date,          -- the last working day, when closed
  closed_by   text,
  closed_at   timestamptz,
  close_note  text,
  -- 'board': made by saving a mission on a day; 'list': added on the Missions tab (Bulk edit)
  -- before it was on any day. Only a 'board' row is forgotten when its last day is deleted.
  source      text not null default 'board' check (source in ('board', 'list')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text,
  unique (board_id, number, shift)
);
create index if not exists mission_register_number_idx on mission_register(number);

create table if not exists mission_number_history (
  id          uuid primary key default gen_random_uuid(),
  old_number  text not null,
  new_number  text not null,
  valid_from  date not null,
  entered_by  text,
  entered_at  timestamptz not null default now()
);
create index if not exists mission_number_history_new_idx on mission_number_history(new_number);
create index if not exists mission_number_history_old_idx on mission_number_history(old_number);

-- ===== 3. Keeping the register in step with the daily rows =====

/* After a mission is saved on a day: create or refresh its register row. The details follow the
   latest day, so editing tomorrow's card changes what the register says, editing an old day
   does not. */
create or replace function public.sync_mission_register()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not exists (select 1 from boards b where b.id = new.board_id) then return null; end if;
  insert into mission_register (board_id, number, shift, host, customer, start_time, end_time,
                                engineer_id, ppe, remark, opened_on, last_on, updated_by)
  values (new.board_id, new.number, new.shift, new.host, new.customer, new.start_time, new.end_time,
          new.engineer_id, new.ppe, new.remark, new.plan_date, new.plan_date,
          coalesce(auth.jwt() ->> 'email', 'system'))
  on conflict (board_id, number, shift) do update set
    opened_on   = least(mission_register.opened_on, excluded.opened_on),
    last_on     = greatest(mission_register.last_on, excluded.last_on),
    host        = case when excluded.last_on >= coalesce(mission_register.last_on, excluded.last_on) then excluded.host        else mission_register.host end,
    customer    = case when excluded.last_on >= coalesce(mission_register.last_on, excluded.last_on) then excluded.customer    else mission_register.customer end,
    start_time  = case when excluded.last_on >= coalesce(mission_register.last_on, excluded.last_on) then excluded.start_time  else mission_register.start_time end,
    end_time    = case when excluded.last_on >= coalesce(mission_register.last_on, excluded.last_on) then excluded.end_time    else mission_register.end_time end,
    engineer_id = case when excluded.last_on >= coalesce(mission_register.last_on, excluded.last_on) then excluded.engineer_id else mission_register.engineer_id end,
    ppe         = case when excluded.last_on >= coalesce(mission_register.last_on, excluded.last_on) then excluded.ppe         else mission_register.ppe end,
    remark      = case when excluded.last_on >= coalesce(mission_register.last_on, excluded.last_on) then excluded.remark      else mission_register.remark end,
    updated_at  = now();
  return null;
end;
$fn$;

/* Before a mission is added to a day: a closed mission is never put on a day after it closed.
   This is what makes carry over (and any other copy) skip it; the app checks first and explains
   when someone types a closed number by hand. */
create or replace function public.skip_closed_mission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if exists (select 1 from mission_register r
              where r.board_id = new.board_id and r.number = new.number and r.shift = new.shift
                and r.status = 'closed' and r.closed_on is not null and new.plan_date > r.closed_on) then
    return null;
  end if;
  return new;
end;
$fn$;

/* After a mission is removed from a day: if it is now on no day at all, is still open and has no
   number history, it was a mistake (a typo, a test) — drop its register row too. A row added on the
   Missions tab (source 'list') is kept: it was meant to exist before any day had it. */
create or replace function public.forget_unused_mission()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  delete from mission_register r
   where r.board_id = old.board_id and r.number = old.number and r.shift = old.shift
     and r.status = 'open'
     and not exists (select 1 from missions m where m.board_id = old.board_id and m.number = old.number and m.shift = old.shift)
     and not exists (select 1 from mission_number_history h where h.new_number = old.number or h.old_number = old.number)
     and r.source = 'board';
  return null;
end;
$fn$;

drop trigger if exists sync_mission_register on missions;
create trigger sync_mission_register
  after insert or update on missions
  for each row execute function public.sync_mission_register();
drop trigger if exists skip_closed_mission on missions;
create trigger skip_closed_mission
  before insert on missions
  for each row execute function public.skip_closed_mission();
drop trigger if exists forget_unused_mission on missions;
create trigger forget_unused_mission
  after delete on missions
  for each row execute function public.forget_unused_mission();

-- ===== 4. Back-fill from the days already planned =====

insert into mission_register (board_id, number, shift, host, customer, start_time, end_time, engineer_id,
                              ppe, remark, opened_on, last_on, status, closed_on, closed_by, closed_at, close_note, updated_by)
select distinct on (m.board_id, m.number, m.shift)
       m.board_id, m.number, m.shift, m.host, m.customer, m.start_time, m.end_time, m.engineer_id,
       m.ppe, m.remark, f.first_on, f.last_on,
       case when f.last_on >= b.latest - 7 then 'open' else 'closed' end,
       case when f.last_on >= b.latest - 7 then null else f.last_on end,
       case when f.last_on >= b.latest - 7 then null else 'migration' end,
       case when f.last_on >= b.latest - 7 then null else now() end,
       case when f.last_on >= b.latest - 7 then null
            else 'Closed by the 2026-11-09 migration: not on the board in the 7 days before its latest planned day' end,
       'migration'
  from missions m
  join (select board_id, number, shift, min(plan_date) as first_on, max(plan_date) as last_on
          from missions group by board_id, number, shift) f
    on f.board_id = m.board_id and f.number = m.number and f.shift = m.shift
  join (select board_id, max(plan_date) as latest from missions group by board_id) b
    on b.board_id = m.board_id
 order by m.board_id, m.number, m.shift, m.plan_date desc
on conflict (board_id, number, shift) do nothing;

-- ===== 5. Close, reopen, new-year numbers =====

create or replace function public.close_mission(p_id uuid, p_closed_on date, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  r mission_register%rowtype;
  v_by text := coalesce(auth.jwt() ->> 'email', 'system');
begin
  if not (select public.can('missions', 'edit')) then
    raise exception 'Your role cannot close missions.' using errcode = 'insufficient_privilege';
  end if;
  if p_closed_on is null then
    raise exception 'Choose the last working day.' using errcode = 'check_violation';
  end if;
  select * into r from mission_register where id = p_id for update;
  if not found then
    raise exception 'That mission is not in the Missions list.' using errcode = 'no_data_found';
  end if;
  if r.status = 'closed' then
    raise exception 'Mission % is already closed.', r.number using errcode = 'check_violation';
  end if;
  if exists (select 1 from missions m
               join plan_days pd on pd.board_id = m.board_id and pd.plan_date = m.plan_date and pd.locked_at is not null
              where m.board_id = r.board_id and m.number = r.number and m.shift = r.shift and m.plan_date > p_closed_on) then
    raise exception 'Mission % is on a locked day after %. Unlock that day first, or choose a later last working day.', r.number, p_closed_on
      using errcode = 'check_violation';
  end if;
  -- closed first: the delete below must not make forget_unused_mission drop the row
  update mission_register
     set status = 'closed', closed_on = p_closed_on, closed_by = v_by, closed_at = now(),
         close_note = nullif(btrim(coalesce(p_note, '')), ''),
         last_on = least(coalesce(last_on, p_closed_on), p_closed_on),
         updated_at = now(), updated_by = v_by
   where id = p_id;
  -- the days after: the mission comes off (its crew's assignments go with it, back to Standby)
  delete from deployment_history
   where board_id = r.board_id and mission_number = r.number and plan_date > p_closed_on
     and exists (select 1 from missions m join assignments a on a.mission_id = m.id
                  where m.board_id = r.board_id and m.number = r.number and m.shift = r.shift
                    and m.plan_date = deployment_history.plan_date and a.employee_id = deployment_history.employee_id);
  delete from missions where board_id = r.board_id and number = r.number and shift = r.shift and plan_date > p_closed_on;
  if to_regclass('public.forecast_missions') is not null then
    execute 'delete from forecast_missions where board_id = $1 and number = $2 and shift = $3 and plan_date > $4'
      using r.board_id, r.number, r.shift, p_closed_on;
  end if;
end;
$fn$;

create or replace function public.reopen_mission(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_by text := coalesce(auth.jwt() ->> 'email', 'system');
begin
  if not (select public.can('missionadmin', 'edit')) then
    raise exception 'Your role cannot reopen missions.' using errcode = 'insufficient_privilege';
  end if;
  update mission_register
     set status = 'open', closed_on = null, closed_by = null, closed_at = null, close_note = null,
         updated_at = now(), updated_by = v_by
   where id = p_id and status = 'closed';
  if not found then
    raise exception 'That mission is not closed.' using errcode = 'no_data_found';
  end if;
end;
$fn$;

/* The new-year numbers. p_items: [{"old": "LCBTH.26.0005", "new": "LCBTH.27.0001"}, ...].
   Every register row with the old number (all boards, both shifts) takes the new one, and so does
   every day from p_valid_from on; earlier days keep the old number. All or nothing. */
create or replace function public.renumber_missions(p_items jsonb, p_valid_from date)
returns int language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  it jsonb;
  v_old text;
  v_new text;
  v_count int := 0;
  v_by text := coalesce(auth.jwt() ->> 'email', 'system');
  v_stamps boolean := to_regclass('public.plan_day_stamps') is not null;
begin
  if not (select public.can('missionadmin', 'edit')) then
    raise exception 'Your role cannot enter new mission numbers.' using errcode = 'insufficient_privilege';
  end if;
  if p_valid_from is null then
    raise exception 'Choose the date the new numbers start.' using errcode = 'check_violation';
  end if;
  -- renaming a day is not a change to its plan: keep the days' edit stamps as they were, so no
  -- carried-over day starts saying its source was edited
  if v_stamps then
    create temp table if not exists _renumber_stamps (board_id uuid, plan_date date, last_edited_at timestamptz, last_edited_by text) on commit drop;
    delete from _renumber_stamps;
    insert into _renumber_stamps
      select board_id, plan_date, last_edited_at, last_edited_by from plan_day_stamps where plan_date >= p_valid_from;
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_old := upper(btrim(it ->> 'old'));
    v_new := upper(btrim(it ->> 'new'));
    if v_new !~ '^[A-Z]{2,10}\.[0-9]{2}\.[0-9]{4}$' then
      raise exception 'Mission number % is not in the form PREFIX.YY.NNNN.', v_new using errcode = 'check_violation';
    end if;
    if v_new = v_old then continue; end if;
    if not exists (select 1 from mission_register where number = v_old) then
      raise exception 'Mission % is not in the Missions list.', v_old using errcode = 'no_data_found';
    end if;
    if exists (select 1 from mission_register where number = v_new) then
      raise exception 'Mission number % is already used.', v_new using errcode = 'unique_violation';
    end if;
    update mission_register set number = v_new, updated_at = now(), updated_by = v_by where number = v_old;
    update missions set number = v_new where number = v_old and plan_date >= p_valid_from;
    if to_regclass('public.forecast_missions') is not null then
      execute 'update forecast_missions set number = $1 where number = $2 and plan_date >= $3' using v_new, v_old, p_valid_from;
    end if;
    update deployment_history set mission_number = v_new where mission_number = v_old and plan_date >= p_valid_from;
    insert into mission_number_history (old_number, new_number, valid_from, entered_by)
    values (v_old, v_new, p_valid_from, v_by);
    v_count := v_count + 1;
  end loop;
  if v_stamps then
    update plan_day_stamps s set last_edited_at = t.last_edited_at, last_edited_by = t.last_edited_by
      from _renumber_stamps t where t.board_id = s.board_id and t.plan_date = s.plan_date;
    delete from plan_day_stamps s
     where s.plan_date >= p_valid_from and s.carried_at is null and s.forecast_merged_at is null
       and not exists (select 1 from _renumber_stamps t where t.board_id = s.board_id and t.plan_date = s.plan_date);
  end if;
  return v_count;
end;
$fn$;

grant execute on function public.close_mission(uuid, date, text)     to authenticated;
grant execute on function public.reopen_mission(uuid)                to authenticated;
grant execute on function public.renumber_missions(jsonb, date)      to authenticated;

-- ===== 6. Row Level Security and Realtime =====

alter table mission_register       enable row level security;
alter table mission_number_history enable row level security;

drop policy if exists "mission_register read" on mission_register;
create policy "mission_register read" on mission_register
  for select using ((select public.is_active()));
drop policy if exists "mission_register insert" on mission_register;
create policy "mission_register insert" on mission_register
  for insert with check ((select public.can('missions', 'edit')));
drop policy if exists "mission_register update" on mission_register;
create policy "mission_register update" on mission_register
  for update using ((select public.can('missions', 'edit'))) with check ((select public.can('missions', 'edit')));
drop policy if exists "mission_register delete" on mission_register;
create policy "mission_register delete" on mission_register
  for delete using ((select public.can('missionadmin', 'edit')));

-- the history is written only by renumber_missions()
drop policy if exists "mission_number_history read" on mission_number_history;
create policy "mission_number_history read" on mission_number_history
  for select using ((select public.is_active()));

do $$
begin
  alter publication supabase_realtime add table mission_register;
exception when duplicate_object then null;
end $$;
