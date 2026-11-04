-- Migration 2026-11-04: employees.exit_reason — why someone is off the roster
-- Run once in the Supabase SQL Editor (safe to re-run), then redeploy the app. Until the column
-- exists the app works as before: deactivating just stores no reason, and the Resigned choice in
-- the Deactivate dialog is disabled with a note naming this file.
--
-- Why: "Inactive" says someone is off the roster, not why. The Overview's Workforce section counts
-- joiners and leavers, and a person who resigned is a leaver where someone who is only inactive
-- for now (a long leave, a pause) is not. The Manpower List also needs to tell the two apart.
--
--   * exit_reason is NULL for everyone who is active, and for someone who is inactive for now.
--   * 'resigned' marks a leaver. The date they left stays in deactivated_on
--     (migration-2026-10-26-deactivated-on.sql), so no second date is stored.
--   * Reactivating clears exit_reason (the app does this in the same update that clears
--     deactivated_on).
--   * More reasons can be added later by widening the check: drop employees_exit_reason_check and
--     add it again with the longer list. Nothing else reads the list.

alter table employees add column if not exists exit_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'employees_exit_reason_check' and conrelid = 'employees'::regclass
  ) then
    alter table employees
      add constraint employees_exit_reason_check check (exit_reason is null or exit_reason in ('resigned'));
  end if;
end $$;
