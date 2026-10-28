-- Migration 2026-10-28: highlight a mission on the board
-- Run once in the Supabase SQL Editor (safe to re-run). Until it has run, the app
-- works as before and the mission card's right-click menu offers no Highlight.
--
-- Why: engineers want some missions to stand out on the day's board: a new
-- customer, a focus activity, or another reason they type. The card shows a gold
-- frame and a tag with the reason (design/mission-highlight-options.html, option E).
--
--   * highlight: 'new' (new customer), 'focus' (focus activity) or 'other'; NULL is
--     not highlighted, which is every mission today.
--   * highlight_note: the short text shown for 'other', up to 40 characters.
--   * Like the rest of a mission it belongs to one board and one date. Carry over,
--     Duplicate and Copy to board leave it behind, so each day starts plain.

alter table missions add column if not exists highlight text;
alter table missions add column if not exists highlight_note text;

do $$
begin
  alter table missions add constraint missions_highlight_kind check (highlight in ('new', 'focus', 'other'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table missions add constraint missions_highlight_note_len check (char_length(highlight_note) <= 40);
exception when duplicate_object then null;
end $$;
