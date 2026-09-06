-- Manpower Management Board — short display names, and engineers linked to accounts
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query > paste > Run).
-- Safe to run more than once — every statement below skips anything already in place.
--
-- Two things, one file, because the second needs the first:
--
--   1. profiles.display_name and profiles.phone — the short name a person is
--      known by on the board, and their own mobile number.
--
--      display_name is that short name: first name, a dot, the initial of
--      the last name ("Somchai.P"). Worked
--      out from the email address, because every TRIGO address is already
--      first name + "." + last name — the one spelling of a person that is
--      always there and always in the same shape. (An address that is not in
--      that shape falls back to the typed full name.) It is a plain column,
--      though, not a formula: an admin, or the person themselves, can type
--      something else when the automatic answer collides with somebody or
--      reads wrong. Blank it out and the automatic name comes back.
--
--      Already ran an earlier version of this file? It derived names from the
--      full name first. To hand everyone back to the address, run:
--        update profiles set display_name = null;
--      — the trigger below refills every row. Anything typed by hand is lost
--      that way, so skip it if somebody has already set their own.
--
--      phone is the number the mission card dials. It used to live on the
--      engineer record and be typed by whoever was in Settings; it belongs to
--      the person, so it moves to their profile and they keep it up to date
--      themselves under Settings → My account.
--
--   2. engineers.profile_id — the link between an engineer record (the colour
--      on every mission card, the name the Overview counts by) and the account
--      of the person it belongs to. The Engineer box on a mission searches
--      display names of everyone from Engineer upwards and resolves the one
--      that is picked through this link, creating the engineer record the
--      first time somebody is picked who has none.
--
-- Nothing here changes an existing mission: engineer_id still points at the
-- engineers table exactly as before.

-- ===== 1. The short display name =====

alter table profiles add column if not exists display_name text;
-- the engineer's own mobile number, moved off the engineers table (backfilled
-- at the bottom of this file, once the engineer -> account links exist)
alter table profiles add column if not exists phone text;

/* "somchai.prasert@trigo-group.com" -> "Somchai.P". The email address is the
   first source, not the last: every TRIGO address is first name + "." + last
   name, so it is the one spelling of a person that is always there and always
   in the same shape — a name box is whatever somebody typed into it, if they
   typed anything. The rules, in order:

     * an address whose local part splits into two or more pieces on . _ or -
       -> first piece + "." + initial of the last, capitalised on the way
       through (an address is written in lower case, a name is not)
     * unless that first piece is a single character: "n.sirinapanont@" is an
       initial, not a first name, so the full name gets the next word
     * a full name of two or more words -> first word + "." + initial of the
       last, left exactly as the person typed it, so "McDonald" does not come
       back as "Mcdonald"
     * a one-word full name -> that word, unchanged (many Thai accounts have one)
     * nothing but a one-piece address -> that piece, capitalised

   left() counts characters rather than bytes, so a Thai initial survives. */
create or replace function public.derive_display_name(p_full_name text, p_email text default null)
returns text language plpgsql immutable set search_path = public, pg_temp as $fn$
declare
  mail text[];
  name text[];
  n    int;
begin
  -- the address, split on the separators a local part uses
  mail := string_to_array(
            btrim(regexp_replace(
              translate(split_part(coalesce(p_email, ''), '@', 1), '._-', '   '),
              '\s+', ' ', 'g')), ' ');
  n := coalesce(array_length(mail, 1), 0);
  if n > 1 and length(mail[1]) > 1 then
    return initcap(mail[1]) || '.' || upper(left(mail[n], 1));
  end if;

  -- the typed name, for an address that is not first.last (or is an initial)
  name := string_to_array(
            regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g'), ' ');
  if coalesce(array_length(name, 1), 0) > 1 then
    return name[1] || '.' || upper(left(name[array_length(name, 1)], 1));
  end if;
  if name[1] is not null and name[1] <> '' then return name[1]; end if;

  -- a one-piece address ("info@…", or a nickname) is still better than nothing
  if n = 1 and mail[1] <> '' then return initcap(mail[1]); end if;
  return null;
end;
$fn$;

/* Keeps display_name automatic without making it read-only.
     * blank (or blanked) -> derive it. This is how a person resets to the
       automatic name: clear the box and save.
     * still holding the automatic value while the full name changes -> follow
       the full name. Somebody correcting their spelling should not be left
       with a display name built from the typo.
     * anything else -> leave it alone. A name typed on purpose is not
       overwritten, which is the whole point of the column being editable. */
create or replace function public.fill_display_name()
returns trigger language plpgsql set search_path = public, pg_temp as $fn$
begin
  new.display_name := nullif(btrim(coalesce(new.display_name, '')), '');

  if tg_op = 'UPDATE'
     and new.display_name is not distinct from old.display_name
     and old.display_name is not distinct from public.derive_display_name(old.full_name, old.email)
     and (new.full_name is distinct from old.full_name or new.email is distinct from old.email) then
    new.display_name := null;
  end if;

  if new.display_name is null then
    new.display_name := public.derive_display_name(new.full_name, new.email);
  end if;
  return new;
end;
$fn$;

drop trigger if exists fill_display_name on profiles;
create trigger fill_display_name
  before insert or update on profiles
  for each row execute function public.fill_display_name();

-- Everyone who already has an account. `where display_name is null` rather
-- than a blanket update, so a name somebody has already set by hand survives a
-- re-run of this file.
update profiles
   set display_name = public.derive_display_name(full_name, email)
 where display_name is null or btrim(display_name) = '';

/* update_my_profile grows a second argument. It has to be dropped and recreated
   rather than replaced: a one-argument version left in place next to a
   two-argument one with a default makes every single-argument call ambiguous,
   and Postgres refuses those outright. The app always passes both. */
drop function if exists public.update_my_profile(text);
-- Writes the whole form every time — a null or blank argument clears that
-- field rather than leaving it as it was, which is what makes "empty the
-- display name to get the automatic one back" work.
create or replace function public.update_my_profile(
  p_full_name text, p_display_name text default null, p_phone text default null)
returns void language sql security definer set search_path = public, pg_temp as $fn$
  update profiles
     set full_name    = nullif(btrim(coalesce(p_full_name, '')), ''),
         -- null/blank hands it back to the trigger above, which re-derives it
         display_name = nullif(btrim(coalesce(p_display_name, '')), ''),
         phone        = nullif(btrim(coalesce(p_phone, '')), ''),
         updated_at   = now()
   where id = auth.uid();
$fn$;
grant execute on function public.derive_display_name(text, text)      to authenticated;
grant execute on function public.update_my_profile(text, text, text)  to authenticated;

-- ===== 2. Engineers, linked to accounts =====

alter table engineers add column if not exists profile_id uuid references profiles(id) on delete set null;
-- one engineer record per account. Partial, so the engineers who have no
-- account yet (all of them, before this file runs) are not fighting over null.
create unique index if not exists engineers_profile_id_key on engineers(profile_id) where profile_id is not null;

/* Who the Engineer box offers, and the only way a browser can read anyone
   else's profile: name and role, never the email or the status of an account.
   "From Engineer upwards" is read off roles.rank — the same ladder the Users
   pane sorts by — so a role added later sits where its rank puts it instead of
   having to be named here. Viewer (rank 40) falls below the line. */
create or replace function public.engineer_directory()
returns table (id uuid, display_name text, full_name text, phone text, role_key text, rank int, engineer_id uuid)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select p.id,
         coalesce(nullif(btrim(p.display_name), ''), public.derive_display_name(p.full_name, p.email)),
         p.full_name,
         p.phone,
         p.role_key,
         r.rank,
         (select e.id from engineers e where e.profile_id = p.id)
    from profiles p
    join roles r on r.key = p.role_key
   where (select public.is_active())
     and p.status = 'active'
     and r.rank <= coalesce((select r2.rank from roles r2 where r2.key = 'engineer'), 30)
   order by 2;
$fn$;

/* Picking somebody from that list on a mission has to end in an engineers row,
   because engineer_id is what a mission stores and what the colour, the
   filters and the Overview all read. Rather than make every planner visit
   Settings first, the first mission for a new engineer creates their record
   here: named after their display name, with the first unused colour from the
   board's own palette so two engineers do not arrive the same grey.

   security definer, because it is called from two places with different
   permissions — the mission form (Board-edit) and Settings → Engineer
   (Settings-edit) — so both are accepted explicitly, and the account has to be
   one the directory above would have offered either way. */
create or replace function public.ensure_engineer_for_profile(p_profile_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id    uuid;
  v_name  text;
  v_color text;
  palette text[] := array['#a8d98a','#7fb8ec','#e57fb1','#f6a06b','#f7dd6c',
                          '#f28ba0','#8fd4c8','#b8a6e8','#e8c39e','#9ec5a8'];
begin
  if not ((select public.can('board', 'edit')) or (select public.can('settings', 'edit'))) then
    raise exception 'Your role cannot add engineers.' using errcode = 'insufficient_privilege';
  end if;

  select e.id into v_id from engineers e where e.profile_id = p_profile_id;
  if v_id is not null then return v_id; end if;

  select coalesce(nullif(btrim(p.display_name), ''), public.derive_display_name(p.full_name, p.email))
    into v_name
    from profiles p
    join roles r on r.key = p.role_key
   where p.id = p_profile_id
     and p.status = 'active'
     and r.rank <= coalesce((select r2.rank from roles r2 where r2.key = 'engineer'), 30);
  if v_name is null then
    raise exception 'That account is not an active engineer.' using errcode = 'check_violation';
  end if;

  select c into v_color from unnest(palette) c
   where not exists (select 1 from engineers e where lower(e.color) = lower(c))
   limit 1;

  insert into engineers (name, phone, color, profile_id)
  values (v_name, '', coalesce(v_color, '#9ca3af'), p_profile_id)
  returning id into v_id;
  return v_id;
end;
$fn$;

/* A linked engineer record follows the account's display name, on the same
   "only while it was still the automatic answer" rule as display_name itself —
   so renaming an engineer by hand in Settings sticks, and a person changing
   their own display name does not leave the board showing the old one. */
create or replace function public.sync_engineer_name()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.display_name is distinct from old.display_name then
    update engineers
       set name = new.display_name
     where profile_id = new.id
       and name = old.display_name;
  end if;
  return new;
end;
$fn$;

drop trigger if exists sync_engineer_name on profiles;
create trigger sync_engineer_name
  after update of display_name on profiles
  for each row execute function public.sync_engineer_name();

grant execute on function public.engineer_directory()          to authenticated;
grant execute on function public.ensure_engineer_for_profile(uuid) to authenticated;

/* Is this engineer record's name a way of writing this person's name? Every
   form one of them is likely to have been typed as: the display name whole
   ("Phada.K"), its first piece ("Phada" — what the engineer list has always
   held), the full name, its first word, and the first piece of the address.
   Used once, by the link-up below, and dropped again at the end of it. */
create or replace function public.engineer_link_name_matches(
  p_name text, p_display text, p_full text, p_email text)
returns boolean language sql immutable set search_path = public, pg_temp as $fn$
  select lower(btrim(coalesce(p_name, ''))) <> ''
     and lower(btrim(p_name)) in (
       lower(btrim(coalesce(p_display, ''))),
       lower(split_part(coalesce(p_display, ''), '.', 1)),
       lower(btrim(coalesce(p_full, ''))),
       lower(split_part(btrim(coalesce(p_full, '')), ' ', 1)),
       lower(split_part(split_part(coalesce(p_email, ''), '@', 1), '.', 1))
     );
$fn$;

/* Best-effort link-up of the engineers who were on the list before accounts
   existed. Deliberately timid: it only joins a pair when the name matches
   exactly one account AND exactly one engineer record, so "Phada" finding one
   Phada is linked and anything ambiguous is left for a person to do in
   Settings → Engineer. */
update engineers e
   set profile_id = p.id
  from profiles p
 where e.profile_id is null
   and p.status = 'active'
   and public.engineer_link_name_matches(e.name, p.display_name, p.full_name, p.email)
   and (select count(*) from engineers e2 where lower(e2.name) = lower(e.name)) = 1
   and (select count(*) from profiles p2
         where p2.status = 'active'
           and public.engineer_link_name_matches(e.name, p2.display_name, p2.full_name, p2.email)) = 1
   and not exists (select 1 from engineers e3 where e3.profile_id = p.id);

drop function if exists public.engineer_link_name_matches(text, text, text, text);

/* The phone numbers follow the same links: an engineer record that now belongs
   to somebody hands its number over to them, so the mission card keeps dialling
   the same number and the person can correct it themselves from My account.
   Only fills a profile that has none — a number already on the account wins. */
update profiles p
   set phone = btrim(e.phone)
  from engineers e
 where e.profile_id = p.id
   and coalesce(btrim(e.phone), '') <> ''
   and coalesce(btrim(p.phone), '') = '';

-- ===== Rollback =====
-- To undo this change:
--
--   drop trigger if exists sync_engineer_name on profiles;
--   drop trigger if exists fill_display_name on profiles;
--   drop function if exists public.sync_engineer_name();
--   drop function if exists public.fill_display_name();
--   drop function if exists public.ensure_engineer_for_profile(uuid);
--   drop function if exists public.engineer_directory();
--   drop function if exists public.update_my_profile(text, text, text);
--   create or replace function public.update_my_profile(p_full_name text)
--   returns void language sql security definer set search_path = public, pg_temp as $fn$
--     update profiles set full_name = nullif(btrim(coalesce(p_full_name, '')), ''),
--                         updated_at = now() where id = auth.uid();
--   $fn$;
--   grant execute on function public.update_my_profile(text) to authenticated;
--   drop index if exists engineers_profile_id_key;
--   alter table engineers drop column if exists profile_id;
--   alter table profiles  drop column if exists display_name;
--   alter table profiles  drop column if exists phone;
--   drop function if exists public.derive_display_name(text, text);
--
-- The app falls back on its own if the columns are there but the functions are
-- not: the Engineer box goes back to listing the engineers table alone.
