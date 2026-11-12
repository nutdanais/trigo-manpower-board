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
--   * Missions list rows that differ only by case (Amata new mission, AMATA NEW MISSION: one board, shift)
--     are one mission and are folded into one row (latest day kept, dates joined, open if any is open).
--   * Two days of one board and shift that would get the same number (a lower-case day next to its capital
--     twin) are left alone and listed in a notice at the end: merge those two by hand.

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
  v_row record;
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

  -- The Missions list first, so the register trigger on missions finds each capital row waiting.
  -- Rows that differ only by case (Amata new mission / AMATA NEW MISSION) are one mission: the one with the
  -- latest day is kept (a capital row first among equals), the dates and the status are folded into it
  -- (open if any of them is open) and the others are removed. Two of them cannot both be renamed anyway:
  -- the list has one row per board, number and shift.
  if to_regclass('public.mission_register') is not null then
    create temp table if not exists _caps_reg_keep (id uuid, opened_on date, last_on date, any_open boolean, closed_on date) on commit drop;
    create temp table if not exists _caps_reg_drop (id uuid) on commit drop;
    delete from _caps_reg_keep;
    delete from _caps_reg_drop;
    insert into _caps_reg_keep
      select t.id, g.opened_on, g.last_on, g.any_open, g.closed_on
        from (select id, row_number() over (partition by board_id, shift, upper(number)
                                            order by last_on desc nulls last, (number = upper(number)) desc, created_at, id) as rn,
                     count(*) over (partition by board_id, shift, upper(number)) as c,
                     board_id, shift, upper(number) as un
                from mission_register) t
        join (select board_id, shift, upper(number) as un, min(opened_on) as opened_on, max(last_on) as last_on,
                     bool_or(status = 'open') as any_open, max(closed_on) as closed_on
                from mission_register group by board_id, shift, upper(number)) g
          on g.board_id = t.board_id and g.shift = t.shift and g.un = t.un
       where t.rn = 1 and t.c > 1;
    insert into _caps_reg_drop
      select t.id
        from (select id, row_number() over (partition by board_id, shift, upper(number)
                                            order by last_on desc nulls last, (number = upper(number)) desc, created_at, id) as rn
                from mission_register) t
        join mission_register r on r.id = t.id
        join (select board_id, shift, upper(number) as un from mission_register group by 1, 2, 3 having count(*) > 1) d
          on d.board_id = r.board_id and d.shift = r.shift and d.un = upper(r.number)
       where t.rn > 1;
    delete from mission_register where id in (select id from _caps_reg_drop);
    get diagnostics n = row_count;
    update mission_register r
       set opened_on = k.opened_on, last_on = k.last_on,
           status = case when k.any_open then 'open' else r.status end,
           closed_on = case when k.any_open then null else k.closed_on end,
           closed_by = case when k.any_open then null else r.closed_by end,
           closed_at = case when k.any_open then null else r.closed_at end,
           close_note = case when k.any_open then null else r.close_note end
      from _caps_reg_keep k where k.id = r.id;
    if n > 0 then
      raise notice '% Missions list row(s) that differed only by upper/lower case were folded into one row each.', n;
    end if;
    update mission_register set number = upper(number) where number <> upper(number);
  end if;

  -- the days: one per board, day, shift and number. Two lower-case days that become the same number, or a
  -- lower-case day next to its capital twin, are two missions on one day: left alone, listed below.
  update missions m set number = upper(m.number)
    from (select id from (select id, row_number() over (partition by board_id, plan_date, shift, upper(number)
                                                         order by (number = upper(number)) desc, created_at, id) as rn
                            from missions) t where t.rn = 1) k
   where m.id = k.id and m.number <> upper(m.number);

  if to_regclass('public.forecast_missions') is not null then
    update forecast_missions m set number = upper(m.number)
      from (select id from (select id, row_number() over (partition by board_id, plan_date, shift, upper(number)
                                                           order by (number = upper(number)) desc, created_at, id) as rn
                              from forecast_missions) t where t.rn = 1) k
     where m.id = k.id and m.number <> upper(m.number);
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

  for v_row in select 'board day' as kind, board_id, plan_date, shift, number from missions where number <> upper(number)
           union all
           select 'forecast day', board_id, plan_date, shift, number from forecast_missions where number <> upper(number)
           order by 1, 2, 3, 5 limit 50 loop
    v_left := v_left + 1;
    raise notice 'Left in lower case: % % % % "%": the same number in capitals is already on that day. Merge the two by hand.', v_row.kind, v_row.board_id, v_row.plan_date, v_row.shift, v_row.number;
  end loop;
end $$;
