-- Migration 2026-11-12b: a mission number is always in capital letters (Esie1.26.0417 -> ESIE1.26.0417).
-- Run once in the Supabase SQL Editor (safe to re-run), after migration-2026-11-09-mission-register.sql.
-- Until it has run the app still works: it types a number in capitals as it is entered, but a number
-- saved earlier (or by a file import) keeps the letters it was typed with.
--
-- Why: the app already compares numbers without caring about case, so Esie1.26.0417 is accepted as the
-- Etraq number ESIE1.26.0417, but it was SAVED as typed, so the board, the Missions tab and the reports
-- showed the lower-case letters, and a search or a join on the exact text could miss it.
--
--   * A trigger on missions, forecast_missions and mission_register turns number into capitals on every
--     insert and every change of the number, whoever writes it (the form, Bulk edit, carry over, a script).
--     It is named aaa_... so it runs BEFORE skip_closed_mission, which looks the number up in the register.
--   * The numbers already saved are turned into capitals once, in every place that keeps one: the days
--     (missions, forecast_missions), the Missions list, the Host Record (deployment_history), the number
--     history and the forecast merge log. The days' edit stamps are kept as they were (renaming a day's
--     number is not a change to its plan), like replace_mission_number does.
--   * Only the letters change. A number that was wrong stays wrong: Bangna.26.0007 becomes BANGNA.26.0007
--     and is still flagged, because the site code has 6 characters.
--   * If the capital version already exists next to the lower-case one (the same board, day and shift),
--     the lower-case row is left alone and counted in the notice at the end: merge those two by hand.

create or replace function public.uppercase_mission_number()
returns trigger language plpgsql as $fn$
begin
  new.number := upper(new.number);
  return new;
end;
$fn$;

drop trigger if exists aaa_uppercase_mission_number on missions;
create trigger aaa_uppercase_mission_number
  before insert or update of number on missions
  for each row execute function public.uppercase_mission_number();

do $$
begin
  if to_regclass('public.forecast_missions') is not null then
    drop trigger if exists aaa_uppercase_mission_number on forecast_missions;
    create trigger aaa_uppercase_mission_number
      before insert or update of number on forecast_missions
      for each row execute function public.uppercase_mission_number();
  end if;
  if to_regclass('public.mission_register') is not null then
    drop trigger if exists aaa_uppercase_mission_number on mission_register;
    create trigger aaa_uppercase_mission_number
      before insert or update of number on mission_register
      for each row execute function public.uppercase_mission_number();
  end if;
end $$;

/* The numbers already saved. */
do $$
declare
  v_stamps boolean := to_regclass('public.plan_day_stamps') is not null;
  v_left int := 0;
  n int;
begin
  -- the days that will be renamed: their stamps are put back afterwards (has_stamp: the day had one)
  if v_stamps then
    create temp table if not exists _caps_stamps (board_id uuid, plan_date date, has_stamp boolean, last_edited_at timestamptz, last_edited_by text) on commit drop;
    delete from _caps_stamps;
    insert into _caps_stamps
      select d.board_id, d.plan_date, s.board_id is not null, s.last_edited_at, s.last_edited_by
        from (select distinct board_id, plan_date from missions where number <> upper(number)) d
        left join plan_day_stamps s on s.board_id = d.board_id and s.plan_date = d.plan_date;
  end if;

  -- the Missions list first, so the register trigger on missions finds each capital row waiting
  if to_regclass('public.mission_register') is not null then
    update mission_register r set number = upper(r.number)
     where r.number <> upper(r.number)
       and not exists (select 1 from mission_register o
                        where o.board_id = r.board_id and o.shift = r.shift and o.number = upper(r.number));
    select count(*) into n from mission_register where number <> upper(number);
    v_left := v_left + n;
  end if;

  update missions m set number = upper(m.number)
   where m.number <> upper(m.number)
     and not exists (select 1 from missions o
                      where o.board_id = m.board_id and o.plan_date = m.plan_date and o.shift = m.shift and o.number = upper(m.number));
  select count(*) into n from missions where number <> upper(number);
  v_left := v_left + n;

  if to_regclass('public.forecast_missions') is not null then
    update forecast_missions m set number = upper(m.number)
     where m.number <> upper(m.number)
       and not exists (select 1 from forecast_missions o
                        where o.board_id = m.board_id and o.plan_date = m.plan_date and o.shift = m.shift and o.number = upper(m.number));
    select count(*) into n from forecast_missions where number <> upper(number);
    v_left := v_left + n;
  end if;

  update deployment_history set mission_number = upper(mission_number) where mission_number <> upper(mission_number);
  if to_regclass('public.mission_number_history') is not null then
    update mission_number_history set old_number = upper(old_number) where old_number <> upper(old_number);
    update mission_number_history set new_number = upper(new_number) where new_number <> upper(new_number);
  end if;
  if to_regclass('public.forecast_merge_decisions') is not null then
    update forecast_merge_decisions set mission_number = upper(mission_number) where mission_number <> upper(mission_number);
  end if;

  if v_stamps then
    update plan_day_stamps s set last_edited_at = t.last_edited_at, last_edited_by = t.last_edited_by
      from _caps_stamps t where t.has_stamp and t.board_id = s.board_id and t.plan_date = s.plan_date;
    -- a day that had no stamp gets none from the renaming either
    delete from plan_day_stamps s
     where s.carried_at is null and s.forecast_merged_at is null
       and exists (select 1 from _caps_stamps t where not t.has_stamp and t.board_id = s.board_id and t.plan_date = s.plan_date);
  end if;

  if v_left > 0 then
    raise notice '% row(s) still have lower-case letters in the mission number because the capital number is already on the same board, day and shift. Merge them by hand.', v_left;
  end if;
end $$;
