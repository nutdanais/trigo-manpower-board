-- Delete-board permission (migration for a project that already has data)
-- Run this in the Supabase SQL editor. Safe to run more than once.
--
-- Adds the `boarddelete` area to the permission matrix: Admin only by default
-- (Settings → Roles & permissions → "Delete boards" can grant it to others).
-- Deleting a board cascades to its missions, plans, overrides, forecasts and
-- employees, so it is kept apart from the everyday `settings` grant that
-- Managers and Engineers hold.
--
-- Only fills in rows that are missing, so it never undoes an admin's change.

insert into role_permissions (role_key, area, level)
select v.role_key, v.area, v.level from (values
  ('admin','boarddelete','edit'),    ('manager','boarddelete','none'),
  ('engineer','boarddelete','none'), ('viewer','boarddelete','none')
) as v(role_key, area, level)
where not exists (
  select 1 from role_permissions rp where rp.role_key = v.role_key and rp.area = v.area
);

-- Replace the delete policy the RLS loop gave boards (keyed off `settings`).
-- NOTE: re-running migration-2026-09-04b-user-management.sql puts the plain
-- policy back — run this file again after it if that ever happens.
drop policy if exists "boards delete" on public.boards;
create policy "boards delete" on public.boards
  for delete using ((select public.can('boarddelete', 'edit')));
