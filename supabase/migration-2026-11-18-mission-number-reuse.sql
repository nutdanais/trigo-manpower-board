-- Fix mission number: a number only in the rename history is free to type again.
--
-- Fix mission number refused a number that appeared anywhere in the rename history, even when no mission
-- has it now ("already used"). Etraq gives a number to one job, so a number only in the history is free:
-- a typo (a stray dot in front, a space) can be corrected back to the number the job always had.
-- replace_mission_number is the same as before except that the history now blocks only a temporary
-- number (PREFIX.YY.TMPNNN) that was replaced: those are never given out twice. A number on the Missions
-- list or on a day is still refused. Safe to run more than once. Run it in the Supabase SQL Editor,
-- after migration-2026-11-17-mission-number-delete-where.sql.

create or replace function public.replace_mission_number(p_old text, p_new text)
returns int language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_old text := btrim(coalesce(p_old, ''));
  v_new text := upper(regexp_replace(coalesce(p_new, ''), '\s', '', 'g'));
  v_by text := coalesce(auth.jwt() ->> 'email', 'system');
  v_from date;
  v_rows int;
  v_stamps boolean := to_regclass('public.plan_day_stamps') is not null;
  v_site text := '[A-Z][A-Z0-9]{' || (public.mission_prefix_length() - 1) || '}';
begin
  if not (select public.can('missions', 'edit')) then
    raise exception 'Your role cannot change mission numbers.' using errcode = 'insufficient_privilege';
  end if;
  if v_new !~ ('^' || v_site || '\.[0-9]{2}\.([0-9]{4}|TMP[0-9]{3})$') then
    raise exception 'Mission number % is not in the form PREFIX.YY.NNNN (or a temporary PREFIX.YY.TMPNNN).', v_new using errcode = 'check_violation';
  end if;
  if v_new = v_old then return 0; end if;
  if v_new ~ '\.TMP[0-9]{3}$' and v_old ~ ('^' || v_site || '\.[0-9]{2}\.[0-9]{4}$') then
    raise exception 'Mission % already has its Etraq number.', v_old using errcode = 'check_violation';
  end if;
  if not exists (select 1 from mission_register where number = v_old) then
    raise exception 'Mission % is not in the Missions list.', v_old using errcode = 'no_data_found';
  end if;
  select min(opened_on) into v_from from mission_register where number = v_old;
  -- in use: on the Missions list or on a day. A number only in the history (a mission once had it, then was
  -- renamed) is free again, since Etraq gives a number to one job: a typo can go back to the number the job
  -- always had. A temporary number that was replaced is never given out twice.
  if exists (select 1 from mission_register where number = v_new)
     or exists (select 1 from missions where number = v_new)
     or (v_new ~ '\.TMP[0-9]{3}$' and exists (select 1 from mission_number_history where old_number = v_new)) then
    raise exception 'Mission number % is already used.', v_new using errcode = 'unique_violation';
  end if;
  -- renaming a day is not a change to its plan: keep the days' edit stamps as they were
  if v_stamps then
    create temp table if not exists _replace_stamps (board_id uuid, plan_date date, last_edited_at timestamptz, last_edited_by text) on commit drop;
    delete from _replace_stamps where true;
    insert into _replace_stamps
      select s.board_id, s.plan_date, s.last_edited_at, s.last_edited_by from plan_day_stamps s
       where exists (select 1 from missions m where m.board_id = s.board_id and m.plan_date = s.plan_date and m.number = v_old);
  end if;
  update mission_register set number = v_new, updated_at = now(), updated_by = v_by where number = v_old;
  get diagnostics v_rows = row_count;
  update missions set number = v_new where number = v_old;
  if to_regclass('public.forecast_missions') is not null then
    execute 'update forecast_missions set number = $1 where number = $2' using v_new, v_old;
  end if;
  update deployment_history set mission_number = v_new where mission_number = v_old;
  insert into mission_number_history (old_number, new_number, valid_from, entered_by)
  values (v_old, v_new, coalesce(v_from, current_date), v_by);
  if v_stamps then
    update plan_day_stamps s set last_edited_at = t.last_edited_at, last_edited_by = t.last_edited_by
      from _replace_stamps t where t.board_id = s.board_id and t.plan_date = s.plan_date;
    delete from plan_day_stamps s
     where s.carried_at is null and s.forecast_merged_at is null
       and exists (select 1 from missions m where m.board_id = s.board_id and m.plan_date = s.plan_date and m.number = v_new)
       and not exists (select 1 from _replace_stamps t where t.board_id = s.board_id and t.plan_date = s.plan_date);
  end if;
  return v_rows;
end;
$fn$;

grant execute on function public.replace_mission_number(text, text) to authenticated;
