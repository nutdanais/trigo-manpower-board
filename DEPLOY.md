# Publishing the board to a shareable link (Netlify)

The app is a set of static files that talk to Supabase. Netlify hosts those files
for free and gives you one HTTPS link the whole team can open.

The folder to publish is **`deploy/`** — it contains only the 6 files the app needs.
(Re-create it any time with `build-deploy.ps1` after a change.)

## Recommended: free account → stable link you can update

Using a free account (rather than the anonymous "Drop" page) means you get a
**permanent URL** you can rename and redeploy to. Worth the extra 2 minutes.

1. Go to https://app.netlify.com and sign up (email, or your Microsoft/Google account).
2. Click **Add new site** → **Deploy manually**.
3. In File Explorer, open this project folder and **drag the `deploy` folder** onto the
   upload area in the browser.
4. Wait ~20 seconds. Netlify gives you a URL like `https://random-name-1234.netlify.app`.
5. (Optional) **Site configuration → Change site name** to something tidy, e.g.
   `trigo-manpower` → your link becomes `https://trigo-manpower.netlify.app`.
6. Open the link, sign in with a Supabase account, and confirm the board loads.
7. Share the link with your team. They sign in with their `@trigo-group.com` account,
   or use **Request access** and wait for you to approve them in Settings → Users.

### To update later (new features, fixes, or config changes)

1. Run `build-deploy.ps1` (double-click, or right-click → Run with PowerShell) to
   refresh the `deploy` folder.
2. In Netlify: open your site → **Deploys** tab → drag the `deploy` folder onto the
   page again. The same URL updates in place. Everyone gets the new version on refresh.

## Fastest, no account (just to preview it live)

Go to https://app.netlify.com/drop and drag the `deploy` folder on. You get an instant
public URL — but each drop makes a **new random URL** and it isn't easily updatable,
so use this only for a quick look, not as the real team link.

## Notes

- **One Supabase setting does need your Netlify URL.** Go to **Authentication** →
  **URL Configuration** and add the site's address (e.g. `https://trigo-manpower.netlify.app`)
  to **Redirect URLs**. Password-reset and invitation links land there, and without it
  they will not work. Everything else — ordinary email/password sign-in — needs no
  configuration.
- **The anon key in `config.js` is fine to publish** — Row Level Security is the real
  guard, and it requires a valid sign-in for any data access.
- **Access control:** anyone with the link reaches the *sign-in page*, but only people
  with an approved `@trigo-group.com` account can get in, and what they can do once in
  depends on their role (Settings → Users). If you ever need to hide the sign-in page
  itself behind your company identity, that's the Entra ID / Azure route we can revisit
  later.
