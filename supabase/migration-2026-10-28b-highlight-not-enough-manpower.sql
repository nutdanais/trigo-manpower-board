-- Migration 2026-10-28b: "Not enough manpower" as a highlight reason
-- Run once in the Supabase SQL Editor (safe to re-run), after
-- migration-2026-10-28-mission-highlight.sql. It also works on its own: it adds the
-- highlight columns first if that one has not been run.
--
-- Why: engineers also want to flag a mission that is short of people. The card shows
-- it like every other highlight (gold frame, a tag reading "Not enough manpower").
--
--   * missions.highlight now also takes 'short' (not enough manpower), next to
--     'new', 'focus' and 'other'. Nothing already saved changes.
--   * Until this has run, choosing Not enough manpower is refused by the database
--     and the app says to run this file; the other reasons keep working.

alter table missions add column if not exists highlight text;
alter table missions add column if not exists highlight_note text;

alter table missions drop constraint if exists missions_highlight_kind;
alter table missions add constraint missions_highlight_kind check (highlight in ('new', 'focus', 'short', 'other'));

do $$
begin
  alter table missions add constraint missions_highlight_note_len check (char_length(highlight_note) <= 40);
exception when duplicate_object then null;
end $$;
