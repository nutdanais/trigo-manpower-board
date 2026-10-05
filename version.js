/* The release version: the one place it is written down.
   Shown on the sign-in screen, in the page footer and in Settings, so a bug
   report can quote it; and fetched again by app.js while the app is open, so
   a tab left up for days can tell when a newer release is out.
   Don't edit this by hand — `node bump-version.js` rewrites it together with
   every ?v= string in index.html (tests/version.test.js fails if they drift).
   Format: the release date, plus a letter for a second release the same day. */
window.APP_VERSION = "2026-10-05b";
