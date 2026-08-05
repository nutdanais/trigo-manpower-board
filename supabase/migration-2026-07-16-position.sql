-- Migration 2026-07-16: employee position
-- Run once in Supabase SQL Editor (safe to re-run). Then redeploy the app.
-- Optional field — existing employees keep position = NULL until edited.

alter table employees add column if not exists position text
  check (position in ('inspector', 'senior_inspector', 'technician', 'team_leader', 'assistant_site_engineer'));
