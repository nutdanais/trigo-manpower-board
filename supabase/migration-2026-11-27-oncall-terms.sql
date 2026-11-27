-- Migration 2026-11-27: employees.oncall_terms — an on-call person's contract terms
-- Run once in the Supabase SQL Editor (safe to re-run). The app works before it is run
-- (it just cannot save a term), so the order of this and the deploy does not matter.
--
--   1. adds the optional employees.oncall_terms column: 'daily', 'monthly' or NULL (not set).
--      It means something only when contract = 'oncall'; the app clears it when a person is
--      made permanent. Every existing on-call person starts as NULL until someone sets it
--      in the Profile, the Manpower List's "Set contract…" menu or Bulk edit by file.
--   2. Nothing else changes: contract stays 'permanent' / 'oncall', so every on-call count,
--      utilization and chart works exactly as before. The term is only shown.
--
-- To undo: alter table employees drop column oncall_terms;

alter table employees add column if not exists oncall_terms text;
alter table employees drop constraint if exists employees_oncall_terms_check;
alter table employees add constraint employees_oncall_terms_check
  check (oncall_terms is null or oncall_terms in ('daily', 'monthly'));
