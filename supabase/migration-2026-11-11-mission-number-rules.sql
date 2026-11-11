-- Migration 2026-11-11: stricter mission numbers, temporary numbers, and fixing a wrong number.
-- Run once in the Supabase SQL Editor (safe to re-run), after migration-2026-11-09-mission-register.sql.
-- Until it has run the app still flags wrong and temporary numbers, but "Fix number" says to run
-- this file first.
--
-- Why: the mission number is the Etraq number, PREFIX.YY.NNNN, and the prefix is the site's
-- five-character code (BANGN, AMATA, LCBTH, ESIE1, ESIE2). Numbers typed before the rule was
-- strict (a typo, extra characters, "108") are flagged by the app and need correcting, and an
-- engineer who starts a mission before the Site Admin has registered it in Etraq uses a temporary
-- number, PREFIX.YY.TMPNNN (BANGN.26.TMP001), replaced once the Etraq number is known.
--
--   * replace_mission_number(old, new) — corrects a number on EVERY day: the Missions list rows
--     (all boards, both shifts), the board days, forecast days and the Host Record
--     (deployment_history). Unlike the new-year number (renumber_missions), earlier days are not
--     kept on the old number: the old one was never the right number. The change is written to
--     mission_number_history, so the board shows "was …" beside the new number for two weeks and
--     a search for the old number still finds the mission. Engineer and up, and Site Admin
--     (missions = edit). The new number must be an Etraq number, or a temporary one when the
--     wrong number is being replaced before Etraq has given one; it must not be in use.
--   * renumber_missions() — the same as before, with the stricter format for the new number.
--
-- No check constraint is added on missions.number: the wrong numbers already saved carry over
-- every day until somebody corrects them, and a constraint would stop that carry over.

create or replace function public.replace_mission_number(p_old text, p_new text)
returns int language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_old text := btrim(coalesce(p_old, ''));
  v_new text := upper(regexp_replace(coalesce(p_new, ''), '\s', '', 'g'));
  v_by text := coalesce(auth.jwt() ->> 'email', 'system');
  v_from date;
  v_rows int;
  v_stamps boolean := to_regclass('public.plan_day_stamps') is not null;
begin
  if not (select public.can('missions', 'edit')) then
    raise exception 'Your role cannot change mission numbers.' using errcode = 'insufficient_privilege';
  end if;
  if v_new !~ '^[A-Z][A-Z0-9]{4}\.[0-9]{2}\.([0-9]{4}|TMP[0-9]{3})$' then
    raise exception 'Mission number % is not in the form PREFIX.YY.NNNN (or a temporary PREFIX.YY.TMPNNN).', v_new using errcode = 'check_violation';
  end if;
  if v_new = v_old then return 0; end if;
  if v_new ~ '\.TMP[0-9]{3}$' and v_old ~ '^[A-Z][A-Z0-9]{4}\.[0-9]{2}\.[0-9]{4}$' then
    raise exception 'Mission % already has its Etraq number.', v_old using errcode = 'check_violation';
  end if;
  if not exists (select 1 from mission_register where number = v_old) then
    raise exception 'Mission % is not in the Missions list.', v_old using errcode = 'no_data_found';
  end if;
  select min(opened_on) into v_from from mission_register where number = v_old;
  if exists (select 1 from mission_register where number = v_new)
     or exists (select 1 from missions where number = v_new)
     or exists (select 1 from mission_number_history where old_number = v_new) then
    raise exception 'Mission number % is already used.', v_new using errcode = 'unique_violation';
  end if;
  -- renaming a day is not a change to its plan: keep the days' edit stamps as they were
  if v_stamps then
    create temp table if not exists _replace_stamps (board_id uuid, plan_date date, last_edited_at timestamptz, last_edited_by text) on commit drop;
    delete from _replace_stamps;
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

/* The new-year numbers (migration-2026-11-09), with the stricter format for the new number. */
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
    if v_new !~ '^[A-Z][A-Z0-9]{4}\.[0-9]{2}\.[0-9]{4}$' then
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
