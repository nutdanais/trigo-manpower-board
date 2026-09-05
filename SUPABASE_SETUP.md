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

## 4b. Email (needed for invitations and password resets)

Supabase's built-in email sender is capped at **2 messages an hour** and is not
meant for production, so it needs a real SMTP provider behind it. The app is
written against plain SMTP, so any provider works; these instructions use
[Resend](https://resend.com), whose free tier (3,000 emails a month) is far more
than this app will ever send.

1. Sign up at resend.com and add a **domain**. Use a subdomain —
   `mail.trigo-group.com` — not the bare `trigo-group.com`. The bare domain
   carries the company's real mail, and adding sending records there risks
   colliding with what IT already has set up.
2. Resend shows a few DNS records (SPF, DKIM). Ask IT to add them to
   `mail.trigo-group.com`, then click **Verify**.
3. Create an **API key**.
4. In Supabase: **Authentication** → **Emails** → **SMTP Settings** → enable custom
   SMTP:
   - Host `smtp.resend.com`, Port `465`
   - Username `resend`, Password: the API key
   - Sender `no-reply@mail.trigo-group.com`
5. **Authentication** → **Rate Limits**: custom SMTP starts at 30 emails/hour.
   Raise it (100/hour is plenty).
6. **Authentication** → **URL Configuration**: add your Netlify URL to **Redirect
   URLs**. Password-reset and invitation links will not work without this.

Until this is done the app is still usable — people can be added from Settings →
Users and sign in — they just will not receive invitation or reset emails.

## 4c. Invitations and notification emails (optional)

"Invite" and "Delete permanently" in Settings → Users need a small server-side
function, because creating and destroying a sign-in account is not something a
browser is ever allowed to do. Everything else on that screen works without it.

1. **Edge Functions** → **Deploy a new function** → name it `admin-users`, and paste
   [`supabase/functions/admin-users/index.ts`](supabase/functions/admin-users/index.ts).
2. Under its **Secrets**, add:
   - `RESEND_API_KEY` — the same key as above
   - `MAIL_FROM` — e.g. `TRIGO Manpower Board <no-reply@mail.trigo-group.com>`
   - `APP_URL` — your Netlify URL

## 5. Get your API credentials

11. Go to **Project Settings** (gear icon) → **API**.
12. Copy the **Project URL** and the **anon public** key.

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
