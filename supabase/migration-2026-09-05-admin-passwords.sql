-- Manpower Management Board — admin-issued passwords (no email anywhere)
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query > paste > Run).
-- Safe to run more than once.
--
-- Why: this deployment has no way to send email. There is no DNS access for
-- mail.trigo-group.com, and Supabase's built-in sender only delivers to members
-- of the Supabase project — so "Forgot password?" and emailed invitations can
-- never work here. Instead an admin creates the account, hands the temporary
-- password over in person (or on Teams/LINE), and the app makes the person
-- choose their own password the first time they sign in.
--
-- This adds the one flag that makes that last part true.

alter table profiles
  add column if not exists must_change_password boolean not null default false;

-- Set by the admin-users Edge Function whenever it issues a password, cleared
-- here once the person has chosen their own. An RPC rather than a plain update
-- because the profiles write policy is admin-only — the same reason
-- update_my_profile() exists. It takes no arguments and reads auth.uid()
-- itself, so it can only ever clear the caller's own flag.
create or replace function public.clear_must_change_password()
returns void language sql security definer set search_path = public, pg_temp as $fn$
  update profiles
     set must_change_password = false,
         updated_at = now()
   where id = auth.uid();
$fn$;

grant execute on function public.clear_must_change_password() to authenticated;
