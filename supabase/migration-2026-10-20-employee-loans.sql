-- Migration 2026-10-20: employee_loans — lend people to another board for a day or a few days
-- Run once in the Supabase SQL Editor (safe to re-run). Then redeploy the app.
--
-- What it does
--   1. adds the employee_loans table: who is lent, to which board, from which
--      date until which date (both included), with an optional note;
--   2. lets anyone who may edit the board plan (Settings → Roles: Board = Edit)
--      lend and end loans, and everyone signed in see them;
--   3. sends loan changes to every open app (Realtime), like missions;
--   4. adds effective_board(employee, date): the board someone works on that
--      day (the loan's board, or their own), and makes the "last edited"
--      stamp of a day use it, so a borrowed person's changes mark the board
--      they were changed on.
--
-- An employee still belongs to ONE board (employees.board_id). A loan only
-- says where they work on the dates it covers; the day after it ends they are
-- back on their own board's Standby with nothing to undo. Moving someone for
-- good is still Edit Employee / the Manpower List.
--
-- Until this has run the app keeps working as before: lending is hidden and
-- "Move to board" stays on the board's employee menu.
--
-- migration-2026-09-24-forward-planning.sql defines the same day-stamp
-- trigger. If that one is ever run again, run this one again after it.

create table if not exists employee_loans (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  to_board_id uuid not null references boards(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now(),
  constraint employee_loans_dates check (end_date >= start_date)
);
create index if not exists employee_loans_employee_idx on employee_loans (employee_id, start_date);
create index if not exists employee_loans_board_idx on employee_loans (to_board_id, start_date);

alter table employee_loans enable row level security;
drop policy if exists "employee_loans read" on employee_loans;
drop policy if exists "employee_loans insert" on employee_loans;
drop policy if exists "employee_loans update" on employee_loans;
drop policy if exists "employee_loans delete" on employee_loans;
create policy "employee_loans read" on employee_loans for select using ((select public.is_active()));
create policy "employee_loans insert" on employee_loans for insert with check ((select public.can('board', 'edit')));
create policy "employee_loans update" on employee_loans for update
  using ((select public.can('board', 'edit'))) with check ((select public.can('board', 'edit')));
create policy "employee_loans delete" on employee_loans for delete using ((select public.can('board', 'edit')));

do $$
begin
  alter publication supabase_realtime add table employee_loans;
exception when duplicate_object or undefined_object then null;
end $$;

/* The board someone works on that day: the loan covering it, else their own.
   The app keeps loans from overlapping; if two ever did, the newest wins. */
create or replace function public.effective_board(p_employee uuid, p_date date)
returns uuid language sql stable set search_path = public, pg_temp as $fn$
  select coalesce(
    (select l.to_board_id from employee_loans l
      where l.employee_id = p_employee and p_date between l.start_date and l.end_date
      order by l.created_at desc limit 1),
    (select e.board_id from employees e where e.id = p_employee))
$fn$;
grant execute on function public.effective_board(uuid, date) to authenticated;

/* Same trigger as in schema.sql; only the assignments branch changes, from the
   employee's own board to effective_board on the assignment's date. */
create or replace function public.bump_plan_day_stamp()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_by    text := coalesce(auth.jwt() ->> 'email', 'system');
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
  else  -- assignments: the board the employee works on that day
    if tg_op in ('UPDATE', 'DELETE') then
      perform public._bump_plan_day_stamp(public.effective_board(old.employee_id, old.plan_date), old.plan_date, v_by);
    end if;
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and (new.employee_id is distinct from old.employee_id or new.plan_date is distinct from old.plan_date)) then
      perform public._bump_plan_day_stamp(public.effective_board(new.employee_id, new.plan_date), new.plan_date, v_by);
    end if;
  end if;
  return null;   -- AFTER trigger: the return value is ignored
end;
$fn$;
