-- A mission can be done at several hosts: one customer, a list of hosts.
--
-- * mission_register.hosts: every host the mission is done at. Empty means just its one host. The New Mission
--   form with several hosts, merging two missions and "Hosts…" on a mission fill it; the Add to board host picker
--   offers them.
-- * The key of a day's card is now board + date + number + shift + HOST (it was without the host): one mission at
--   two hosts on the same day is two cards, the same host twice is still refused. Same for forecast days.
-- * missions.host_unconfirmed: a carried-over card of a mission with several hosts keeps the previous day's host
--   but shows "Confirm host" until somebody confirms or changes it.
-- * merge_mission_number keeps every host of both missions, and two day cards at different hosts stay two cards.
--
-- Nothing is deleted. Safe to run more than once. Run it in the Supabase SQL Editor, after
-- migration-2026-11-18c-merge-same-job.sql. Run it BEFORE the app update that uses it (the app works either way,
-- but the host picker and the two-hosts-a-day cards need this).

alter table mission_register add column if not exists hosts text[] not null default '{}';
alter table missions add column if not exists host_unconfirmed boolean not null default false;

alter table missions drop constraint if exists missions_unique_number_shift;
do $$
begin
  alter table missions add constraint missions_unique_number_shift_host unique (board_id, plan_date, number, shift, host);
exception when duplicate_object or duplicate_table then null;
end $$;

do $$
begin
  if to_regclass('public.forecast_missions') is not null then
    alter table forecast_missions drop constraint if exists forecast_missions_board_id_plan_date_number_shift_key;
    begin
      alter table forecast_missions add constraint forecast_missions_unique_number_shift_host unique (board_id, plan_date, number, shift, host);
    exception when duplicate_object or duplicate_table then null;
    end;
  end if;
end $$;

create or replace function public.merge_mission_number(p_old text, p_new text)
returns int language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_old text := btrim(coalesce(p_old, ''));
  v_new text := upper(regexp_replace(coalesce(p_new, ''), '\s', '', 'g'));
  v_by text := coalesce(auth.jwt() ->> 'email', 'system');
  v_from date;
  v_merged int := 0;
  v_clash int := 0;
  v_lead uuid;
  v_hosts text[];
  v_stamps boolean := to_regclass('public.plan_day_stamps') is not null;
  v_fc boolean := to_regclass('public.forecast_missions') is not null;
  v_site text := '[A-Z][A-Z0-9]{' || (public.mission_prefix_length() - 1) || '}';
  r_old mission_register%rowtype;
  r_new mission_register%rowtype;
  d record;
begin
  if not (select public.can('missions', 'edit')) then
    raise exception 'Your role cannot change mission numbers.' using errcode = 'insufficient_privilege';
  end if;
  if v_new !~ ('^' || v_site || '\.[0-9]{2}\.[0-9]{4}$') then
    raise exception 'Mission number % is not in the form PREFIX.YY.NNNN.', v_new using errcode = 'check_violation';
  end if;
  if v_new = v_old then return 0; end if;
  if not exists (select 1 from mission_register where number = v_old) then
    raise exception 'Mission % is not in the Missions list.', v_old using errcode = 'no_data_found';
  end if;
  -- every place (board and shift) the new number is on must be a place the old number is on too
  if exists (select 1 from mission_register n
              where n.number = v_new
                and not exists (select 1 from mission_register o where o.number = v_old and o.board_id = n.board_id and o.shift = n.shift))
     or exists (select 1 from missions n
                 where n.number = v_new
                   and not exists (select 1 from mission_register o where o.number = v_old and o.board_id = n.board_id and o.shift = n.shift)) then
    raise exception 'Mission number % is also used on another board or shift, so the two are not merged.', v_new using errcode = 'unique_violation';
  end if;
  if v_fc then
    execute 'select count(*) from forecast_missions a join forecast_missions b
               on b.board_id = a.board_id and b.plan_date = a.plan_date and b.shift = a.shift and b.number = $2 and b.host = a.host
             where a.number = $1' into v_clash using v_old, v_new;
    if v_clash > 0 then
      raise exception 'Both % and % are on % forecast day(s). Merge those forecast days first.', v_old, v_new, v_clash using errcode = 'check_violation';
    end if;
  end if;
  -- merging into a closed mission reopens it: allowed to whoever may edit missions, as reopen_mission is

  -- renaming a day is not a change to its plan: keep the days' edit stamps as they were
  if v_stamps then
    create temp table if not exists _merge_stamps (board_id uuid, plan_date date, last_edited_at timestamptz, last_edited_by text) on commit drop;
    delete from _merge_stamps where true;
    insert into _merge_stamps
      select s.board_id, s.plan_date, s.last_edited_at, s.last_edited_by from plan_day_stamps s
       where exists (select 1 from missions m where m.board_id = s.board_id and m.plan_date = s.plan_date and m.number in (v_old, v_new));
  end if;

  -- a place where only the old number is: its Missions list row simply takes the new number
  update mission_register o set number = v_new, updated_at = now(), updated_by = v_by
   where o.number = v_old
     and not exists (select 1 from mission_register n where n.number = v_new and n.board_id = o.board_id and n.shift = o.shift);

  -- a place where both are: one job
  for r_old in select * from mission_register where number = v_old loop
    -- every host the job has been at, from both Missions list rows and every day of both: one customer, several hosts
    select coalesce(array_agg(distinct h order by h), '{}') into v_hosts from (
      select unnest(hosts) as h from mission_register where board_id = r_old.board_id and shift = r_old.shift and number in (v_old, v_new)
      union all select host from mission_register where board_id = r_old.board_id and shift = r_old.shift and number in (v_old, v_new)
      union all select host from missions where board_id = r_old.board_id and shift = r_old.shift and number in (v_old, v_new)
    ) s where h is not null and btrim(h) <> '';
    -- a day that has both cards at the SAME host is one card; at two hosts it stays two cards (one mission, two hosts)
    for d in select md.id as old_id, mt.id as new_id
               from missions md
               join missions mt on mt.board_id = md.board_id and mt.plan_date = md.plan_date and mt.shift = md.shift and mt.number = v_new and mt.host = md.host
              where md.board_id = r_old.board_id and md.shift = r_old.shift and md.number = v_old loop
      select lead_employee_id into v_lead from missions where id = d.old_id;
      update assignments set mission_id = d.new_id where mission_id = d.old_id;
      update missions m
         set lead_employee_id = coalesce(m.lead_employee_id, v_lead),
             hidden = m.hidden and x.hidden,
             highlight = coalesce(m.highlight, x.highlight),
             highlight_note = case when m.highlight is null then x.highlight_note else m.highlight_note end
        from missions x
       where m.id = d.new_id and x.id = d.old_id;
      delete from missions where id = d.old_id;
      v_merged := v_merged + 1;
    end loop;
    -- the rest of its days here take the new number
    update missions set number = v_new where board_id = r_old.board_id and shift = r_old.shift and number = v_old;
    select * into r_new from mission_register where number = v_new and board_id = r_old.board_id and shift = r_old.shift;
    update mission_register r
       set opened_on  = least(r_new.opened_on, r_old.opened_on),
           last_on    = greatest(r_new.last_on, r_old.last_on),
           hosts      = v_hosts,
           host       = case when coalesce(r_old.last_on, r_old.opened_on) >= coalesce(r_new.last_on, r_new.opened_on) then r_old.host else r_new.host end,
           customer   = case when coalesce(r_old.last_on, r_old.opened_on) >= coalesce(r_new.last_on, r_new.opened_on) then r_old.customer else r_new.customer end,
           start_time = case when coalesce(r_old.last_on, r_old.opened_on) >= coalesce(r_new.last_on, r_new.opened_on) then r_old.start_time else r_new.start_time end,
           end_time   = case when coalesce(r_old.last_on, r_old.opened_on) >= coalesce(r_new.last_on, r_new.opened_on) then r_old.end_time else r_new.end_time end,
           engineer_id = case when coalesce(r_old.last_on, r_old.opened_on) >= coalesce(r_new.last_on, r_new.opened_on) then r_old.engineer_id else r_new.engineer_id end,
           ppe        = case when coalesce(r_old.last_on, r_old.opened_on) >= coalesce(r_new.last_on, r_new.opened_on) then r_old.ppe else r_new.ppe end,
           remark     = case when coalesce(r_old.last_on, r_old.opened_on) >= coalesce(r_new.last_on, r_new.opened_on) then r_old.remark else r_new.remark end,
           status     = case when r_old.status = 'open' or r_new.status = 'open' then 'open' else 'closed' end,
           closed_on  = case when r_old.status = 'open' or r_new.status = 'open' then null else greatest(r_new.closed_on, r_old.closed_on) end,
           closed_by  = case when r_old.status = 'open' or r_new.status = 'open' then null else r_new.closed_by end,
           closed_at  = case when r_old.status = 'open' or r_new.status = 'open' then null else r_new.closed_at end,
           close_note = case when r_old.status = 'open' or r_new.status = 'open' then null else r_new.close_note end,
           updated_at = now(), updated_by = v_by
     where r.id = r_new.id;
    delete from mission_register where id = r_old.id;
  end loop;

  -- every other day of the old number (the places with no twin)
  update missions set number = v_new where number = v_old;
  if v_fc then
    execute 'update forecast_missions set number = $1 where number = $2' using v_new, v_old;
  end if;
  update deployment_history set mission_number = v_new where mission_number = v_old;
  select min(opened_on) into v_from from mission_register where number = v_new;
  insert into mission_number_history (old_number, new_number, valid_from, entered_by)
  values (v_old, v_new, coalesce(v_from, current_date), v_by);
  if v_stamps then
    update plan_day_stamps s set last_edited_at = st.last_edited_at, last_edited_by = st.last_edited_by
      from _merge_stamps st where st.board_id = s.board_id and st.plan_date = s.plan_date;
    delete from plan_day_stamps s
     where s.carried_at is null and s.forecast_merged_at is null
       and exists (select 1 from missions m where m.board_id = s.board_id and m.plan_date = s.plan_date and m.number = v_new)
       and not exists (select 1 from _merge_stamps st where st.board_id = s.board_id and st.plan_date = s.plan_date);
  end if;
  return v_merged;
end;
$fn$;

grant execute on function public.merge_mission_number(text, text) to authenticated;
