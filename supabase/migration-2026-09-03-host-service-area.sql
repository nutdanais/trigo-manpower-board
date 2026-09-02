-- Migration 2026-09-03: hosts.area_id — the service area a host belongs to
-- Run once in the Supabase SQL Editor (safe to re-run). Then redeploy the app.
--
-- Service area was, until now, only a property of a PERSON (employees.area_id):
-- which part of the region someone works in. A host sits in one of those areas
-- too, and knowing which one is what lets a mission card say where the job is
-- without anyone reading the address — so the Host List gains a Service area
-- column, and every mission card shows its host's area pill beside the shift.
--
-- Nullable and ON DELETE SET NULL, like employees.area_id is nullable in
-- practice: a host whose area nobody has set yet is normal (it just shows no
-- pill), and deleting a service area must not take its hosts with it.

alter table hosts add column if not exists area_id uuid references service_areas(id) on delete set null;
