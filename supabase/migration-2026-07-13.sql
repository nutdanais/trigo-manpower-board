-- Migration 2026-07-13: leave types + PPE field
-- Run once in Supabase SQL Editor (safe to re-run).
-- IMPORTANT: run this BEFORE deploying the new app version, then redeploy right after —
-- the old app writes zone='leave', which this migration retires.

-- 1) PPE requirement per mission
alter table missions add column if not exists ppe text;

-- 2) Replace the single "leave" zone with 5 specific leave types
alter table assignments drop constraint if exists assignments_zone_check;

-- migrate any existing generic "leave" rows to Annual Leave
-- (engineers can re-drag to the correct type afterwards)
update assignments set zone = 'annual' where zone = 'leave';

alter table assignments add constraint assignments_zone_check
  check (zone in ('annual', 'sick', 'business', 'unpaid', 'exchange', 'standby'));
