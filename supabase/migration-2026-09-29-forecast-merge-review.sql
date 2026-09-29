-- Migration 2026-09-29: forecast merge review — decisions per person, an alert
-- to the engineer whose forecast was not used, and a log of every decision
-- Run once in the Supabase SQL Editor (safe to re-run), after
-- migration-2026-09-24-forward-planning.sql. Then redeploy the app.
--
-- "Review & merge" used to be a list of ticked lines, and a forecast that was
-- only partly used said nothing to the engineer who made it. Now the planner
-- picks carry-over or forecast for every person and mission detail that
-- differ, and on Apply:
--
--   1. forecast_merge_decisions keeps one row per decision: what each side
--      said, which side won, who decided, when, and the optional reason. The
--      "Forecast merged" note on the board links to it.
--
--   2. forecast_hold_events gets one row, kind 'merge', for each forecast
--      placement or mission detail that was NOT used, addressed to the
--      engineer who forecast it. It is the same table (and so the same red
--      header button, live toast and Acknowledge) that already tells an
--      engineer when someone took a person from their hold. A merge alert about
--      a mission detail has no employee, so employee_id becomes optional for
--      that kind only.
--
-- Both are written by record_forecast_merge, one transaction, which also
-- stamps the day as merged. Who forecast what is read from the forecast rows
-- on the server, not taken from the browser, so an alert can't be addressed
-- to somebody who had nothing to do with it.
--
-- Everything below is mirrored in schema.sql — keep the two identical.

-- ===== 1. Merge alerts on forecast_hold_events =====

alter table forecast_hold_events add column if not exists kind     text not null default 'taken';
alter table forecast_hold_events add column if not exists reason   text;
alter table forecast_hold_events add column if not exists detail   jsonb;
alter table forecast_hold_events add column if not exists merge_id uuid;
alter table forecast_hold_events alter column employee_id drop not null;
do $$
begin
  alter table forecast_hold_events add constraint forecast_hold_events_kind_check
    check (kind in ('taken', 'merge'));
exception when duplicate_object then null;
end $$;
do $$
begin
  alter table forecast_hold_events add constraint forecast_hold_events_employee_check
    check (kind = 'merge' or employee_id is not null);
exception when duplicate_object then null;
end $$;

-- ===== 2. The decision log =====

create table if not exists forecast_merge_decisions (
  id             uuid primary key default gen_random_uuid(),
  merge_id       uuid not null,
  board_id       uuid not null references boards(id) on delete cascade,
  plan_date      date not null,
  item_type      text not null check (item_type in ('person', 'field', 'add', 'remove')),
  employee_id    uuid references employees(id) on delete set null,
  mission_number text,
  mission_shift  text,
  field          text,
  carry_value    text,           -- what the carry-over said, as the planner saw it
  forecast_value text,           -- what the forecast said
  choice         text not null check (choice in ('carry', 'forecast')),
  forecaster     text,           -- read from the forecast rows by record_forecast_merge
  reason         text,
  merged_by      text not null,
  merged_at      timestamptz not null default now()
);
create index if not exists forecast_merge_decisions_day_idx on forecast_merge_decisions(board_id, plan_date);

/* p_items: one object per decision —
     { type: 'person'|'field'|'add'|'remove', choice: 'carry'|'forecast',
       employee_id, mission_number, mission_shift, field,
       carry_value, forecast_value, reason }
   The forecaster is looked up here: the holder of the person's forecast
   placement, the last editor of a changed mission detail, the creator of a
   new mission. An alert goes out only for a 'carry' choice, and never to the
   planner themself or to a hold nobody owns ('migrated'). */
create or replace function public.record_forecast_merge(p_board_id uuid, p_plan_date date, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_me         text := lower(coalesce(auth.jwt() ->> 'email', 'unknown'));
  v_merge      uuid := gen_random_uuid();
  v_now        timestamptz := now();
  v_it         jsonb;
  v_type       text;
  v_choice     text;
  v_emp        uuid;
  v_fm         uuid;
  v_zone       text;
  v_forecaster text;
  v_reason     text;
  v_events     int := 0;
  v_rows       int := 0;
begin
  if not (select public.can('board', 'edit')) then
    raise exception 'Your role cannot change the board.' using errcode = 'insufficient_privilege';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Merge decisions must be a list.' using errcode = 'invalid_parameter_value';
  end if;

  for v_it in select value from jsonb_array_elements(p_items) loop
    v_type   := v_it ->> 'type';
    v_choice := v_it ->> 'choice';
    v_emp    := nullif(v_it ->> 'employee_id', '')::uuid;
    v_reason := nullif(left(btrim(coalesce(v_it ->> 'reason', '')), 500), '');
    v_fm := null; v_zone := null; v_forecaster := null;

    if v_type = 'person' then
      if v_emp is null or not exists (select 1 from employees where id = v_emp and board_id = p_board_id) then
        raise exception 'That employee is not on this board.' using errcode = 'check_violation';
      end if;
      select fa.forecast_mission_id, fa.zone, fa.held_by into v_fm, v_zone, v_forecaster
        from forecast_assignments fa
       where fa.employee_id = v_emp and fa.plan_date = p_plan_date;
    elsif v_type in ('field', 'add') then
      select fm.id, case when v_type = 'add' then fm.created_by else coalesce(fm.updated_by, fm.created_by) end
        into v_fm, v_forecaster
        from forecast_missions fm
       where fm.board_id = p_board_id and fm.plan_date = p_plan_date
         and fm.number = v_it ->> 'mission_number' and fm.shift = v_it ->> 'mission_shift';
    end if;

    insert into forecast_merge_decisions (merge_id, board_id, plan_date, item_type, employee_id,
                                          mission_number, mission_shift, field, carry_value, forecast_value,
                                          choice, forecaster, reason, merged_by, merged_at)
    values (v_merge, p_board_id, p_plan_date, v_type, v_emp,
            v_it ->> 'mission_number', v_it ->> 'mission_shift', v_it ->> 'field',
            v_it ->> 'carry_value', v_it ->> 'forecast_value',
            v_choice, v_forecaster, v_reason, v_me, v_now);
    v_rows := v_rows + 1;

    if v_choice = 'carry' and v_forecaster is not null
       and lower(v_forecaster) <> v_me and lower(v_forecaster) <> 'migrated' then
      insert into forecast_hold_events (kind, employee_id, plan_date, from_forecast_mission_id, from_zone,
                                        from_held_by, taken_by, taken_at, reason, merge_id, detail)
      values ('merge', case when v_type = 'person' then v_emp end, p_plan_date, v_fm, v_zone,
              v_forecaster, v_me, v_now, v_reason, v_merge,
              jsonb_build_object('type', v_type, 'board_id', p_board_id,
                                 'mission_number', v_it ->> 'mission_number', 'mission_shift', v_it ->> 'mission_shift',
                                 'field', v_it ->> 'field',
                                 'carry_value', v_it ->> 'carry_value', 'forecast_value', v_it ->> 'forecast_value'));
      v_events := v_events + 1;
    end if;
  end loop;

  insert into plan_day_stamps (board_id, plan_date, forecast_merged_at, forecast_merged_by)
  values (p_board_id, p_plan_date, v_now, coalesce(auth.jwt() ->> 'email', 'unknown'))
  on conflict (board_id, plan_date) do update
    set forecast_merged_at = excluded.forecast_merged_at,
        forecast_merged_by = excluded.forecast_merged_by;

  return jsonb_build_object('merge_id', v_merge, 'decisions', v_rows, 'events', v_events);
end;
$fn$;

grant execute on function public.record_forecast_merge(uuid, date, jsonb) to authenticated;

-- ===== 3. Row Level Security =====
-- Anyone active can read the log. There are no write policies: the only way
-- in is record_forecast_merge, so a row can't be edited after the fact.

alter table forecast_merge_decisions enable row level security;
drop policy if exists "forecast_merge_decisions read" on forecast_merge_decisions;
create policy "forecast_merge_decisions read" on forecast_merge_decisions
  for select using ((select public.is_active()));

-- Not in the realtime publication: the log is read when the "Forecast merged"
-- note opens it, and the merge's own mission/assignment writes already make
-- every open board re-read the day. The alerts ride forecast_hold_events,
-- which is already published.
