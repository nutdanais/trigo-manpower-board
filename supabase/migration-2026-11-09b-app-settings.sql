-- Migration 2026-11-09b: app_settings — shared settings, starting with "days to count as experienced"
-- Run once in the Supabase SQL Editor (safe to re-run), then redeploy the app. Until it has run the
-- app works exactly as before: everyone is "experienced" at a host after 5 days, and Settings ->
-- Host experience shows the 5 with a note that the value can't be changed yet.
--
-- Why: how many days at a host make someone "experienced" was fixed in the code at 5. It drives
-- the Host tab's Skills matrix, the Overview's Host coverage, a person's host list and the Skills
-- risks section of the report, so it has to be one value for everybody — not a per-browser choice.
--
--   * app_settings — one row per setting: key, a JSON value, who changed it and when. A setting
--     with no row uses the app's own default, so nothing needs seeding.
--   * 'host_experienced_days' — a whole number of days, 1 to 365 (the default is 5). The database
--     refuses anything else.
--   * Everyone who is active can read; changing needs Edit on Settings (the same grant as
--     Settings -> Engineers / Service areas / Boards).
--   * Realtime is on, so a change reaches every open browser without a refresh.

create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint app_settings_value_ok check (
    key <> 'host_experienced_days'
    or (jsonb_typeof(value) = 'number'
        and case when (value #>> '{}') ~ '^[0-9]{1,3}$' then (value #>> '{}')::int between 1 and 365 else false end)
  )
);

alter table app_settings enable row level security;

drop policy if exists "app_settings read" on app_settings;
create policy "app_settings read" on app_settings
  for select using ((select public.is_active()));
drop policy if exists "app_settings insert" on app_settings;
create policy "app_settings insert" on app_settings
  for insert with check ((select public.can('settings', 'edit')));
drop policy if exists "app_settings update" on app_settings;
create policy "app_settings update" on app_settings
  for update using ((select public.can('settings', 'edit'))) with check ((select public.can('settings', 'edit')));
drop policy if exists "app_settings delete" on app_settings;
create policy "app_settings delete" on app_settings
  for delete using ((select public.can('settings', 'edit')));

do $$
begin
  alter publication supabase_realtime add table app_settings;
exception when duplicate_object then null;
end $$;
