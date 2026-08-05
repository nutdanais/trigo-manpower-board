-- Migration 2026-07-16b: Standby becomes automatic
-- Run once in Supabase SQL Editor (safe to re-run). Then redeploy the app.
--
-- Previously "Standby" was a manual zone an engineer dragged people into,
-- alongside the leave types. From now on it's computed automatically: any
-- permanent employee not assigned to a mission or a leave type simply shows
-- as Standby. On-call employees in the same situation show separately as
-- "Available On-call" — deliberately not flagged, since that's normal.
--
-- Anyone currently sitting in the manual "standby" zone becomes plain
-- "unassigned" for that date, which then renders automatically into the
-- correct new box based on their contract type.

delete from assignments where zone = 'standby';

alter table assignments drop constraint if exists assignments_zone_check;
alter table assignments add constraint assignments_zone_check
  check (zone in ('annual', 'sick', 'business', 'unpaid', 'exchange'));
