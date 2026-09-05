# Connecting the board to Supabase

Follow these steps once. After this, the board is a real multi-user cloud app —
anyone you create an account for can open it and see the same live board.

## 1. Create your Supabase project

1. Go to https://supabase.com and sign in (you can use your Microsoft/Google email).
2. Click **New project**. Pick a name (e.g. `manpower-board`), set a database password
   (save it somewhere safe — you likely won't need it again), and choose a region close
   to Thailand (e.g. **Southeast Asia (Singapore)**).
3. Wait ~2 minutes while it provisions.

## 2. Run the schema

4. In the left sidebar, open **SQL Editor** → **New query**.
5. Open [`supabase/schema.sql`](supabase/schema.sql) from this project, copy its entire
   contents, paste into the SQL editor, and click **Run**.
6. You should see it finish without errors. This creates all the tables, security
   rules, realtime sync, and seeds your boards/engineers/service areas.
   The script is safe to run again if you ever need to (e.g. after pulling an updated
   version) — it skips anything already created instead of erroring.

## 3. Turn on Realtime (usually on by default, but double check)

7. Go to **Database** → **Replication** in the sidebar. Confirm the tables `boards`,
   `engineers`, `service_areas`, `employees`, `missions`, `assignments` are listed
   under the `supabase_realtime` publication (the schema script already added them —
   this step is just to confirm).

## 4. Make yourself the first admin

The schema creates the `profiles` table and the four roles, but it cannot know
which account is yours — there are no accounts yet.

8. Go to **Authentication** → **Users** → **Add user** → **Create new user**, and
   create your own account with your `@trigo-group.com` address and a password.
9. Back in **SQL Editor**, run this with your address filled in:

   ```sql
   update profiles
      set role_key = 'admin', status = 'active', approved_at = now()
    where email = lower('YOUR-EMAIL@trigo-group.com');
   ```

10. Check it worked: `select email, role_key, status from profiles;`

**Without this nobody can open Settings → Users**, and no request for access can
ever be approved. Everyone else you add from inside the app from here on.

> Upgrading an existing project rather than starting fresh? Run
> [`supabase/migration-2026-09-04b-user-management.sql`](supabase/migration-2026-09-04b-user-management.sql)
> instead of the whole schema. **Edit the "REQUIRED: name the first admin" line at
> the bottom before running it.** It backfills every account you already have as an
> active **Manager** — full use of the app, minus user management — so nobody loses
> access, and re-running it never re-promotes someone you have since demoted.
> Then run
> [`supabase/migration-2026-09-05-admin-passwords.sql`](supabase/migration-2026-09-05-admin-passwords.sql),
> which adds the flag behind "choose your own password the first time you sign in".
> No editing needed on that one.

## 4b. Turn off email confirmation

**This app sends no email at all**, by design. Sending any would need DNS records
on a domain we control, and Supabase's own sender is no help: it delivers only to
members of the Supabase project and is capped at 2 messages an hour. So the app
never relies on a message arriving. Instead an admin creates the account, hands
the temporary password over in person (or on Teams/LINE), and the person is made
to choose their own the first time they sign in.

One setting has to match that:

11. **Authentication** → **Sign In / Providers** → **Email** → turn **Confirm
    email** OFF, and Save.

This one is load-bearing. Left on, "Request access" queues a confirmation email
that can never arrive, and the account can never sign in. Off, the request
completes immediately and waits for an admin to approve it in Settings → Users.

Leave **custom SMTP** disabled — there is nothing to send.

## 4c. The admin-users function (required)

Three things in Settings → Users happen inside `auth.users`, which a browser is
never allowed to touch: **creating** an account, **reissuing** its password, and
**deleting** it. They live in a small server-side function. Everything else on
that screen — approve, reject, change role, disable — is a plain database write
and works without it.

12. **Edge Functions** → **Deploy a new function** → name it exactly
    `admin-users`, and paste
    [`supabase/functions/admin-users/index.ts`](supabase/functions/admin-users/index.ts).
13. Leave **Verify JWT** on (the default) and deploy.

**There are no secrets to set.** `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` are all provided by the platform.

### How adding someone works

1. Settings → **Users** → **+ Add user**: their name, their `@trigo-group.com`
   address, and a role.
2. You get a **temporary password on screen, once**. It is not stored anywhere you
   can look it up again — pass it on before you close the dialog. If it gets lost,
   just issue another with **Reset password**.
3. They sign in with it and are taken straight to "Set a new password". They
   cannot reach the board until they have chosen one, so the password you read out
   never becomes a permanent shared secret.

Someone who uses **Request access** instead picks their own password up front, so
there is nothing to hand over — you only have to approve them, and tell them you
have.

### Forgotten passwords

There is no "Forgot password?" — it would send an email. Open the person's row in
Settings → Users and click **Reset password**, then pass the new one on the same
way. **This makes you the password help desk**, which is the price of having no
mail service at all.

Two consequences worth planning for:

- **Keep at least two admins.** An admin cannot reset their own password from
  inside the app (deliberately — you would be typing a password you had just read
  off a screen), so a second one is your only in-app recovery.
- **The one exception is the Supabase project owner.** Supabase's built-in sender
  *does* deliver to members of the project, so whoever owns the project can always
  use **Authentication → Users → Send password recovery** on their own account from
  the dashboard. Worth making sure the main admin's app account uses the same
  address as their Supabase login.

## 5. Get your API credentials

14. Go to **Project Settings** (gear icon) → **API**.
15. Copy the **Project URL** and the **anon public** key.

## 6. Tell me these two values

Once you have them, send me:
- Project URL (e.g. `https://abcdefgh.supabase.co`)
- anon public key (a long string starting with `eyJ...`)

I'll paste them into [`config.js`](config.js) and do a live test — creating a mission,
dragging a card, and confirming it syncs — before handing it back to you.

## 7. Hosting (so you get one shareable link)

Supabase only hosts the data — the app's files still need a home. Once the Supabase
wiring is confirmed working locally, I'll deploy the `index.html`/`css`/`js` files to
a free static host (Vercel or Netlify) so you get a real URL like
`manpower-board.vercel.app` to share with the team, instead of everyone needing the
files on their own PC.

---

**Note on security:** the anon key is safe to paste into a client-side file — it's
meant to be public. What actually protects your data is Row Level Security in the
schema: reading anything requires an **active** account, and every write additionally
requires that your role has `edit` on the area that table belongs to. Hiding a tab in
the browser is a courtesy; the database is what actually refuses the write, so the
published anon key cannot be used to get around it.

The one thing that is *not* a data barrier is hiding an individual **Overview
section**. Those sections are worked out from the same mission and assignment rows
the board itself needs, so a Viewer must be able to read them. Treat that setting as
tidying the dashboard, not as protecting a secret.
