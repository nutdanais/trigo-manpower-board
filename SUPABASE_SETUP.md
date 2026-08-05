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

## 4. Create engineer accounts (no self-signup — you control who gets in)

8. Go to **Authentication** → **Users** → **Add user** → **Create new user**.
9. For each engineer, enter their email and a temporary password, then share that
   password with them (ask them to note it down — there's no "forgot password" flow
   set up yet, so keep a record of who has which login for now).
10. Repeat for everyone who needs access, including yourself.

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
meant to be public. What actually protects your data is the Row Level Security
policy in the schema (`auth.role() = 'authenticated'`), which requires a valid sign-in
before any read or write is allowed.
