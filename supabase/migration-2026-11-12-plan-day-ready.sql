-- Migration 2026-11-12: plan_day_ready — "my part is planned" ticks on a board's day
-- Run once in the Supabase SQL Editor (safe to re-run), then redeploy the app. Until it has run the
-- app works exactly as before: the "Planned" line on the board simply does not appear.
--
-- Why: when several engineers plan one board for a day, the last one wants to know whether the
-- others are done before the plan is shared with the crew. Each engineer ticks their own name once
-- their missions are planned; the board shows who is still left, and "Ready to share with crew"
-- once everyone has ticked. It is a flag, not an approval: nothing is locked or blocked by it.
-- (design/engineer-planned-ticks.html, option A2)
--
--   * plan_day_ready — one row per ticked engineer per board per day. Unticking deletes the row,
--     so there is nothing to update. Tomorrow starts with no rows, and Carry over copies none.
--   * Who may tick: someone with Edit on the Board who is that engineer (the engineer record is
--     linked to their account), or an Admin or a Manager, who may tick for anyone — for example an
--     engineer on site with no signal. ticked_by keeps who actually ticked.
--   * Everyone who is active can read the ticks.
--   * A deleted board or engineer takes its ticks with it.
--   * Realtime is on, so a tick reaches every open browser without a refresh.

create table if not exists plan_day_ready (
  board_id    uuid not null references boards(id) on delete cascade,
  plan_date   date not null,
  engineer_id uuid not null references engineers(id) on delete cascade,
  ticked_by   text,
  ticked_at   timestamptz not null default now(),
  primary key (board_id, plan_date, engineer_id)
);

/* May the signed-in account tick (or untick) this engineer? Their own engineer record, or any
   engineer for an Admin or a Manager — and only with Edit on the Board. */
create or replace function public.can_tick_ready(p_engineer_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select (select public.can('board', 'edit'))
     and (coalesce((select public.my_role()) in ('admin', 'manager'), false)
          or exists (select 1 from engineers e where e.id = p_engineer_id and e.profile_id = auth.uid()));
$fn$;
grant execute on function public.can_tick_ready(uuid) to authenticated;

alter table plan_day_ready enable row level security;

drop policy if exists "plan_day_ready read" on plan_day_ready;
create policy "plan_day_ready read" on plan_day_ready
  for select using ((select public.is_active()));
drop policy if exists "plan_day_ready insert" on plan_day_ready;
create policy "plan_day_ready insert" on plan_day_ready
  for insert with check (public.can_tick_ready(engineer_id));
drop policy if exists "plan_day_ready delete" on plan_day_ready;
create policy "plan_day_ready delete" on plan_day_ready
  for delete using (public.can_tick_ready(engineer_id));

do $$
begin
  alter publication supabase_realtime add table plan_day_ready;
exception when duplicate_object then null;
end $$;
