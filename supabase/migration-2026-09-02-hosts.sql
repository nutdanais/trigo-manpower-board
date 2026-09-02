-- Migration 2026-09-02: hosts — the master record behind the Host List tab
-- Run once in the Supabase SQL Editor (safe to re-run). Then redeploy the app.
--
-- Until now a "host" existed only as free text on a mission (missions.host) and
-- on the durable deployment log (deployment_history.host). That is enough to
-- ANSWER questions about a host — who has worked there, which boards it shows
-- up on — but there was nowhere to STORE anything about the host itself. This
-- table is that place: one row per host name, carrying its location (address or
-- plant name) and a Google Maps link.
--
-- Deliberately keyed by the host NAME rather than by a foreign key from
-- missions: mission rows already carry the name as plain text (and
-- deployment_history snapshots it on purpose, so history survives a mission
-- being hidden or deleted). Making this a lookup table with an id would mean
-- rewriting both, and would break the one property the Host List depends on —
-- a host that has never been given a location still appears in the list,
-- assembled from mission/deployment rows alone. A row here is therefore purely
-- additive: extra detail attached to a name the board already uses.
--
-- Rows can also exist for a host with no missions yet (the tab's "+ Host"
-- button) — a site you know you'll be sent to, recorded ahead of time.

create table if not exists hosts (
  id uuid primary key default gen_random_uuid(),
  -- matched against missions.host / deployment_history.host verbatim, so the
  -- name is stored exactly as it is typed on a mission
  name text not null unique,
  location text,
  map_url text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== Row Level Security (same as every other table: any signed-in user) =====

alter table hosts enable row level security;

drop policy if exists "authenticated read/write hosts" on hosts;
create policy "authenticated read/write hosts" on hosts
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ===== Realtime =====
-- Unlike deployment_history, this one IS broadcast: two planners can be on the
-- Host List at the same time, and a location added by one should appear for the
-- other without a reload — same as boards / service areas.

do $$
begin
  alter publication supabase_realtime add table hosts;
exception when duplicate_object then null;
end $$;

-- ===== Backfill =====
-- Seed a row for every host name the board already knows about, so the Host
-- List opens with the real roster of sites (location left blank, ready to be
-- filled in). Nothing here overwrites an existing row.

insert into hosts (name)
select distinct host from missions where host is not null and host <> ''
on conflict (name) do nothing;

insert into hosts (name)
select distinct host from deployment_history where host is not null and host <> ''
on conflict (name) do nothing;
