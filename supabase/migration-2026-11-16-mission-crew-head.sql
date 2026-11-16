-- Migration 2026-11-16: the Leader of a mission's crew
-- Run once in the Supabase SQL Editor (safe to re-run), then redeploy the app. Until it has run the
-- app works as before: the employee card's right-click menu offers no "Make Leader".
--
-- Why: a mission's crew needs one person the others (and the engineer) go to on site. The head is
-- set from the employee card's right-click menu, and their card carries a teal crown badge on its
-- top-left corner (design/crew-head-options.html, option A).
--
--   * missions.lead_employee_id: the head of that mission's crew on that board and date; NULL is no
--     head, which is every mission today. One column, so a crew can never have two heads.
--   * The head must be on the mission that day (missions_lead_on_crew): the database refuses a head
--     who has no assignment to it.
--   * When the head leaves the mission (moved to another mission, leave, Standby, lent to another
--     board, or the assignment deleted) the head is cleared (assignments_clear_mission_lead), so it
--     never comes back on its own if they are placed there again later.
--   * Deleting the employee clears it too (on delete set null).
--   * Carry over brings the head across with the crew (the app sets it once the crew is placed).
--     Duplicate mission, Copy to board and Copy from weekday copy no crew, so no head either.

alter table missions add column if not exists lead_employee_id uuid references employees(id) on delete set null;

/* The head must be on this mission's crew on its day. */
create or replace function public.check_mission_lead() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.lead_employee_id is not null and not exists (
    select 1 from assignments a
    where a.employee_id = new.lead_employee_id and a.plan_date = new.plan_date and a.mission_id = new.id
  ) then
    raise exception 'The Leader must be on this mission''s crew (missions_lead_on_crew)'
      using errcode = '23514';
  end if;
  return new;
end $fn$;

drop trigger if exists missions_lead_on_crew on missions;
create trigger missions_lead_on_crew
  before insert or update of lead_employee_id, plan_date on missions
  for each row execute function public.check_mission_lead();

/* The head left the mission: clear it. */
create or replace function public.clear_mission_lead() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if old.mission_id is not null
     and (tg_op = 'DELETE' or new.mission_id is distinct from old.mission_id or new.plan_date is distinct from old.plan_date) then
    update missions set lead_employee_id = null
    where id = old.mission_id and lead_employee_id = old.employee_id;
  end if;
  return null;
end $fn$;

drop trigger if exists assignments_clear_mission_lead on assignments;
create trigger assignments_clear_mission_lead
  after update or delete on assignments
  for each row execute function public.clear_mission_lead();
