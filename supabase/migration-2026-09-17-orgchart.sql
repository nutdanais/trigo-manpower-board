-- Org Chart tab permission (migration for a project that already has data)
--
-- Adds the `orgchart` area to the permission matrix, mirroring `overview`:
-- view for every role. The Org Chart tab (Board → Engineer → Service area →
-- Mission → Employee) is a read-only re-view of the same missions and
-- assignments the Overview already reads — no write ever keys off this area —
-- so it is view-only for all roles and, like the Overview sections, is never
-- given `edit`.
--
-- The client also falls back to the `overview` grant when no `orgchart` row
-- exists (see can() in app.js), so the tab already works before this runs;
-- this file just makes the grant explicit and gives Settings → Roles &
-- permissions a row to manage. Only fills in rows that are missing, so it is
-- safe to run more than once and never undoes an admin's change.

insert into role_permissions (role_key, area, level)
select v.role_key, v.area, v.level from (values
  ('admin','orgchart','view'), ('manager','orgchart','view'),
  ('engineer','orgchart','view'), ('viewer','orgchart','view')
) as v(role_key, area, level)
where not exists (
  select 1 from role_permissions rp where rp.role_key = v.role_key and rp.area = v.area
);
