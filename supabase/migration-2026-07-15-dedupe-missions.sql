-- Migration 2026-07-15: de-duplicate missions + prevent future duplicates
-- Run once in Supabase SQL Editor (safe to re-run). Then redeploy the app.
--
-- Root cause of the duplicate-mission glitch: toggling the holiday switch
-- triggers two independent refreshes (one from the click, one pushed back by
-- Realtime once the database change lands). Both could see an empty board and
-- both "copy forward" the previous day's missions at the same time, each
-- inserting its own copy. This migration merges any duplicates that already
-- happened, then adds a database rule so the same mission number can never
-- exist twice for the same board + date + shift again (Day and Night remain
-- allowed as separate mission boxes).

-- 1) For each (board_id, plan_date, number, shift) group with more than one row,
--    keep the most recently updated copy and move any assignments pointing at
--    the other copies onto it, so nobody's placement is lost.
with ranked as (
  select id,
         row_number() over (
           partition by board_id, plan_date, number, shift
           order by updated_at desc, created_at desc, id asc
         ) as rn,
         first_value(id) over (
           partition by board_id, plan_date, number, shift
           order by updated_at desc, created_at desc, id asc
         ) as canonical_id
  from missions
)
update assignments a
set mission_id = r.canonical_id
from ranked r
where a.mission_id = r.id and r.rn > 1;

-- 2) Delete the now-redundant duplicate mission rows.
with ranked as (
  select id,
         row_number() over (
           partition by board_id, plan_date, number, shift
           order by updated_at desc, created_at desc, id asc
         ) as rn
  from missions
)
delete from missions m
using ranked r
where m.id = r.id and r.rn > 1;

-- 3) Guardrail: one mission number per board + date + shift, going forward.
do $$
begin
  alter table missions add constraint missions_unique_number_shift unique (board_id, plan_date, number, shift);
exception when duplicate_object then null;
end $$;
