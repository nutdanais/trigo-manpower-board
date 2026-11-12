-- One-off 2026-11-12: give every past job that sits on the placeholder number NEW MISSION its own number
-- (NEW MISSION001, NEW MISSION002, ...). A temporary fix: they are still not Etraq numbers, so each stays
-- flagged as a wrong number until somebody types its real Etraq number with Fix number (which now renames just
-- that one job, because the jobs no longer share a number).
-- Run supabase/one-off-2026-11-12-number-new-mission-jobs-preview.sql first to see what it will do.
-- Safe to run again: it only touches days before today that are still on NEW MISSION.
--
--   * Days before today (Bangkok time) with the number NEW MISSION, in any upper/lower case, are renamed.
--     Today and later days are left alone (the job may still be running).
--   * A job is every such day with the same host and customer (spelling and case ignored), on any board or
--     shift. Numbers run in the order of each job's first day, after the highest NEW MISSIONnnn in use.
--   * The same rename is made on the Host Record (deployment_history, matched by board, day, host, customer)
--     and the Missions list: each job gets its own row (the day rows' trigger makes it, with its first and last
--     day), the old NEW MISSION row is removed once no day is left on it, and a closed state is copied over.
--   * The days' edit stamps are kept, like Fix number does (renaming a day is not a change to its plan).
--   * Nothing else changes: AMATA NEW MISSION, real numbers, forecast days and people on a card stay as they are.
-- Prints a notice with how many jobs and day rows were renumbered.

do $$
declare
  v_today  date := (now() at time zone 'Asia/Bangkok')::date;
  v_base   int;
  v_stamps boolean := to_regclass('public.plan_day_stamps') is not null;
  v_jobs   int;
  v_days   int;
  v_hist   int;
  v_left   int;
begin
  select coalesce(max((substring(x from '^NEW MISSION([0-9]+)$'))::int), 0) into v_base
    from (select number as x from missions union all select number from mission_register) t;

  create temp table if not exists _nm_jobs (job_key text primary key, new_number text not null) on commit drop;
  delete from _nm_jobs;
  insert into _nm_jobs
    select g.job_key, 'NEW MISSION' || lpad((v_base + row_number() over (order by g.first_day, g.job_key))::text, 3, '0')
      from (select lower(btrim(host)) || ' | ' || lower(btrim(coalesce(customer, ''))) as job_key, min(plan_date) as first_day
              from missions
             where upper(btrim(number)) = 'NEW MISSION' and plan_date < v_today
             group by 1) g;
  get diagnostics v_jobs = row_count;
  if v_jobs = 0 then
    raise notice 'Nothing to do: no past day is on NEW MISSION.';
    return;
  end if;

  -- the days that will be renamed: their stamps are put back afterwards (has_stamp: the day had one)
  if v_stamps then
    create temp table if not exists _nm_stamps (board_id uuid, plan_date date, has_stamp boolean, last_edited_at timestamptz, last_edited_by text) on commit drop;
    delete from _nm_stamps;
    insert into _nm_stamps
      select d.board_id, d.plan_date, s.board_id is not null, s.last_edited_at, s.last_edited_by
        from (select distinct board_id, plan_date from missions
               where upper(btrim(number)) = 'NEW MISSION' and plan_date < v_today) d
        left join plan_day_stamps s on s.board_id = d.board_id and s.plan_date = d.plan_date;
  end if;

  -- the Missions list rows' closed state, to copy to the new rows (the old rows go afterwards)
  create temp table if not exists _nm_closed (board_id uuid, shift text, closed_on date, closed_by text, closed_at timestamptz, close_note text) on commit drop;
  delete from _nm_closed;
  if to_regclass('public.mission_register') is not null then
    insert into _nm_closed
      select distinct on (board_id, shift) board_id, shift, closed_on, closed_by, closed_at, close_note
        from mission_register where upper(btrim(number)) = 'NEW MISSION' and status = 'closed'
       order by board_id, shift, closed_on desc nulls last;
  end if;

  update missions m set number = j.new_number
    from _nm_jobs j
   where upper(btrim(m.number)) = 'NEW MISSION' and m.plan_date < v_today
     and j.job_key = lower(btrim(m.host)) || ' | ' || lower(btrim(coalesce(m.customer, '')));
  get diagnostics v_days = row_count;

  update deployment_history d set mission_number = j.new_number
    from _nm_jobs j
   where upper(btrim(d.mission_number)) = 'NEW MISSION' and d.plan_date < v_today
     and j.job_key = lower(btrim(d.host)) || ' | ' || lower(btrim(coalesce(d.customer, '')));
  get diagnostics v_hist = row_count;

  if to_regclass('public.mission_register') is not null then
    update mission_register r
       set status = 'closed', closed_on = c.closed_on, closed_by = c.closed_by, closed_at = c.closed_at, close_note = c.close_note
      from _nm_closed c
     where c.board_id = r.board_id and c.shift = r.shift and r.number in (select new_number from _nm_jobs);
    -- no day left on the placeholder: its Missions list row goes (one made on the Missions tab is kept)
    delete from mission_register r
     where upper(btrim(r.number)) = 'NEW MISSION' and r.source = 'board'
       and not exists (select 1 from missions m
                        where m.board_id = r.board_id and m.shift = r.shift and upper(btrim(m.number)) = 'NEW MISSION');
  end if;

  if v_stamps then
    update plan_day_stamps s set last_edited_at = t.last_edited_at, last_edited_by = t.last_edited_by
      from _nm_stamps t where t.has_stamp and t.board_id = s.board_id and t.plan_date = s.plan_date;
    delete from plan_day_stamps s
     where s.carried_at is null and s.forecast_merged_at is null
       and exists (select 1 from _nm_stamps t where not t.has_stamp and t.board_id = s.board_id and t.plan_date = s.plan_date);
  end if;

  select count(*) into v_left from deployment_history where upper(btrim(mission_number)) = 'NEW MISSION' and plan_date < v_today;
  raise notice '% job(s) renumbered (% day row(s), % Host Record row(s)).', v_jobs, v_days, v_hist;
  if v_left > 0 then
    raise notice '% Host Record row(s) still say NEW MISSION: their host or customer differs from the day they belong to.', v_left;
  end if;
end $$;
