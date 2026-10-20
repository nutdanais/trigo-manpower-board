-- Overview "Loans today" section permission (migration for a project that already has data)
--
-- Adds the `ov.loans` area to the permission matrix: view for every role, the
-- same as "By board", whose headcounts it explains (who on a board today is
-- borrowed from another board, and until when). Like every Overview section it
-- is view-only and never given `edit`.
--
-- The client falls back to the `ov.byBoard` grant when no `ov.loans` row exists
-- (see can() in app.js), so the section already shows before this runs; this
-- file makes the grant explicit and gives Settings -> Roles & permissions a row
-- to manage. Only fills in rows that are missing, so it is safe to run more
-- than once and never undoes an admin's change. Needs no other migration (the
-- section itself only appears once migration-2026-10-20-employee-loans.sql has
-- created the loans table).

insert into role_permissions (role_key, area, level)
select v.role_key, v.area, v.level from (values
  ('admin','ov.loans','view'), ('manager','ov.loans','view'),
  ('engineer','ov.loans','view'), ('viewer','ov.loans','view')
) as v(role_key, area, level)
where not exists (
  select 1 from role_permissions rp where rp.role_key = v.role_key and rp.area = v.area
);
