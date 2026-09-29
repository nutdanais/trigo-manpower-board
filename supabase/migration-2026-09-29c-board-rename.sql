-- Board rename permission. Run in the Supabase SQL editor after
-- migration-2026-09-29b-board-delete.sql. Safe to run more than once.
--
-- Renaming a board now needs the same `boarddelete` grant as deleting one
-- (shown as "Rename & delete boards" in Settings → Roles & permissions, Admin
-- only by default). Weekend days stay under the ordinary `settings` grant, so
-- this is a trigger on the name column rather than a change to the update policy.

create or replace function public.guard_board_rename()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.name is distinct from old.name and auth.uid() is not null
     and not public.can('boarddelete', 'edit') then
    raise exception 'Only roles allowed to rename & delete boards may rename a board.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$fn$;

drop trigger if exists guard_board_rename on boards;
create trigger guard_board_rename
  before update on boards
  for each row execute function public.guard_board_rename();
