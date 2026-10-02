-- Migration 2026-10-02b: employees.added_on — the day someone joined the app/board
-- Run once in the Supabase SQL Editor (safe to re-run). Then redeploy the app.
--
-- Why: headcount, Standby and utilization were worked out from TODAY's roster
-- for every date, so adding the 82 LCB Port people on 2026-10-01 made them
-- count as idle on every earlier day (September's Standby jumped). With this
-- column a date only counts the people who had already been added by then,
-- down to the day.
--
--   * added_on is a plain date. NULL means "always counted" — that is what every
--     person who was already on the board before this migration keeps, so
--     nothing about past months changes for them.
--   * New employees get today's date (Bangkok time) automatically from the
--     column default; the Edit Employee form can correct it (e.g. back-date
--     someone who really joined earlier, or clear it).
--   * The 82 people loaded by migration-2026-10-01-lcb-port-employees.sql are
--     back-filled from the day their row was created. Only rows created on or
--     after 2026-10-01 (Bangkok) are touched; older rows stay NULL.
--
-- Deliberately separate from employees.start_date, which is the real hire date
-- (many of the 82 started in 2023) and drives Years of Service.

alter table employees add column if not exists added_on date;

update employees
   set added_on = (created_at at time zone 'Asia/Bangkok')::date
 where added_on is null
   and created_at >= timestamptz '2026-10-01 00:00:00+07';

alter table employees alter column added_on set default ((now() at time zone 'Asia/Bangkok')::date);
