-- Migration 2026-08-23: missions/assignments updated_by — realtime attribution
-- Run once in the Supabase SQL Editor (safe to re-run). Then redeploy the app.
--
-- Lets the app tell you when a board you're looking at was just changed by
-- someone else, instead of it silently re-rendering underneath you. Same
-- mechanism plan_days.locked_by already uses (migration-2026-08-14b): the app
-- stamps the current signed-in user's email into this column client-side on
-- every write, no new RLS/trigger machinery needed.

alter table missions add column if not exists updated_by text;
alter table assignments add column if not exists updated_by text;
