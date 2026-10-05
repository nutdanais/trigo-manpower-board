-- Migration 2026-10-05: employees.name_en — the employee's English name
-- Run once in the Supabase SQL Editor (safe to re-run). Run it, then redeploy the app
-- straight away: the new app reads name_th / name_en, the old one reads "name".
--
-- What it does
--   1. renames employees.name to name_th (the Thai name — the one the app shows by
--      default, and still required) and adds employees.name_en (optional);
--   2. reviews every existing name and sorts it by the script it is written in:
--        Thai only          -> stays in name_th, name_en stays empty
--        English only       -> copied into BOTH columns (name_th keeps a copy so the
--                              required field is never empty; people fix it later)
--        Thai + English     -> split: the Thai words go to name_th, the English to
--                              name_en ("สมชาย ใจดี (Somchai Jaidee)", "Somchai สมชาย ...")
--        anything else      -> left alone and listed as "manual" for a person
--      "anything else" = a Thai and an English word interleaved, a single word that mixes
--      both scripts, or a number inside a mixed name;
--   3. shows a report of everything it looked at (the last result in the editor).
--
-- Safety
--   * PREVIEW FIRST: set `apply` to false below and run it — nothing is changed (no
--     rename either), the report shows what WOULD happen. Then set it to true and run again.
--   * One transaction: if anything fails, nothing is kept.
--   * Reversible: the old name of every employee is saved to employees_name_backup_en.
--     To undo:  update employees e set name_th = b.old_name, name_en = null
--                 from employees_name_backup_en b where b.employee_id = e.id;
--               (and, if you want the old column name back:
--                alter table employees rename column name_th to name; the old app then works again)
--   * Never deletes anybody and never changes any other column. A second run does not
--     touch anyone it has already handled, so names people have edited since are safe.

begin;

-- the safety copy; RLS on with no policy keeps it out of reach of the app's API
-- (the SQL editor and the owner still read it)
create table if not exists employees_name_backup_en (
  employee_id uuid primary key,
  old_name    text not null,
  saved_at    timestamptz not null default now()
);
alter table employees_name_backup_en enable row level security;

-- ===== CHANGE THIS to false to preview without changing anything =====
create temp table _en_cfg as select true as apply;
-- =====================================================================

-- Sort one name by script. status: thai | english | split | manual | none
create or replace function pg_temp.name_split(raw text, out status text, out th text, out en text)
language plpgsql immutable as $fn$
declare
  s text := btrim(regexp_replace(normalize(coalesce(raw, ''), NFC), '\s+', ' ', 'g'));
  has_th boolean := s ~ '[฀-๿]';
  has_la boolean := s ~ '[A-Za-z]';
  tok text;
  cls text;
  last_cls text := null;
  runs int := 0;
  th_toks text[] := '{}';
  en_toks text[] := '{}';
begin
  if not has_th and not has_la then status := 'none'; th := s; return; end if;
  if has_th and not has_la then status := 'thai'; th := s; return; end if;
  if has_la and not has_th then status := 'english'; th := s; en := s; return; end if;

  -- both scripts: brackets and slashes only separate the two spellings
  for tok in
    select t from regexp_split_to_table(regexp_replace(s, '[()\[\]/|]', ' ', 'g'), '\s+') as t
  loop
    if tok = '' or tok ~ '^[[:punct:]]+$' then continue; end if;   -- "-", ",", "." on their own
    if tok ~ '[0-9]' then status := 'manual'; th := null; en := null; return; end if;
    cls := case when tok ~ '[฀-๿]' and tok ~ '[A-Za-z]' then 'mixed'
                when tok ~ '[฀-๿]' then 'th'
                when tok ~ '[A-Za-z]' then 'en'
                else 'mixed' end;
    if cls = 'mixed' then status := 'manual'; th := null; en := null; return; end if;
    if cls is distinct from last_cls then runs := runs + 1; last_cls := cls; end if;
    if cls = 'th' then th_toks := th_toks || tok; else en_toks := en_toks || tok; end if;
  end loop;

  -- one Thai block and one English block, in either order; anything more is a person's call
  if runs <> 2 then status := 'manual'; th := null; en := null; return; end if;
  status := 'split';
  th := array_to_string(th_toks, ' ');
  en := array_to_string(en_toks, ' ');
end
$fn$;

-- read the old column when it has not been renamed yet (a preview, or the first run),
-- the new one on a re-run
do $$
declare src text := case when exists (select 1 from information_schema.columns
                                       where table_schema = current_schema() and table_name = 'employees' and column_name = 'name')
                         then 'name' else 'name_th' end;
begin
  execute format($q$
    create temp table _en_report as
    select e.id, e.%1$I as old_name, s.status as kind, s.th as new_th, s.en as new_en,
           'pending'::text as status
      from employees e
      cross join lateral pg_temp.name_split(e.%1$I) s
     where not exists (select 1 from employees_name_backup_en b where b.employee_id = e.id)
  $q$, src);
end $$;

-- nothing to do for these: Thai already in the right place, or no letters at all
update _en_report set status = case kind when 'thai' then 'unchanged: Thai name' else 'unchanged: no letters' end
 where kind in ('thai', 'none');
update _en_report set status = 'manual: Thai and English are mixed — fix in the app (Edit employee)'
 where kind = 'manual';

-- structure (only when applying)
do $$
begin
  if (select apply from _en_cfg) then
    alter table employees add column if not exists name_en text;
    if exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'employees' and column_name = 'name')
       and not exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'employees' and column_name = 'name_th') then
      alter table employees rename column name to name_th;
    end if;
  end if;
end $$;

-- every employee the migration looked at gets a backup row, so a re-run skips them
do $$
begin
  if (select apply from _en_cfg) then
    insert into employees_name_backup_en (employee_id, old_name)
    select id, old_name from _en_report
    on conflict (employee_id) do nothing;

    update employees e set name_th = r.new_th, name_en = r.new_en
      from _en_report r
     where r.id = e.id and r.kind in ('english', 'split');
  end if;
end $$;

update _en_report set status = case when (select apply from _en_cfg) then 'copied to both columns' else 'would copy to both columns' end
 where kind = 'english';
update _en_report set status = case when (select apply from _en_cfg) then 'split' else 'would split' end
 where kind = 'split';

commit;

-- the report: what was (or would be) changed, and what needs a person
select status, old_name as "name before", new_th as "Thai name after", new_en as "English name after"
  from _en_report
 order by (status like 'manual%') desc, (status like 'unchanged%'), status, old_name;
