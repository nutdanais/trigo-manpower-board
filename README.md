# Manpower Management Board

A drag-and-drop daily manpower planning board (replacement for Microsoft Whiteboard).

## How to run

This app is now backed by **Supabase** (cloud database + auth + realtime sync), so it needs one-time setup — see [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md).

Once `config.js` has real Supabase credentials, double-click **index.html** to open the app, or serve the folder with any static web server. Sign in with an account created for you in the Supabase dashboard (Authentication → Users) — there's no self-signup.

## How to use

- **Boards**: tabs at the top-left. `+ Board` creates a new board (e.g. Rayong). Double-click a tab to rename it.
  - Every employee belongs to exactly **one board** — a card assigned on Non-Rayong can never appear as available on Rayong.
  - **Right-click** an employee card → Assign to a mission, send to a leave type, or return to Standby/Available On-call — the same as dragging, for when the target has scrolled off-screen or you're on touch — plus Edit / Move to another board / Archive. (Position, contract type, and service area move to the Manpower List tab — set them one at a time from Edit Employee, or in bulk from the list's selection bar.)
  - **Archive** (right-click, or the Edit Employee modal) replaces "Delete" — it hides the employee from pools and dropdowns but keeps their history: past mission and leave assignments still show their name, and past stats still count them. There's no "show archived" view yet, so archive someone who's actually gone (resigned, transferred), not as a way to temporarily hide them.
- **📊 Overview tab**: a management dashboard, not a wall of numbers — a KPI strip, a deployment donut + per-board stacked bars (with the "Needs attention" list of unassigned names right after), a contract-mix donut per board, a service-area distribution, two 7/14/30-day trend lines per board (click a legend entry to hide/show its line) — **Utilization** and **On-call availability** (on-call headcount not on a mission or on leave) — both counting only working days (weekends and holidays excluded), and a leave-by-type breakdown at the bottom. Every chart has a hover/focus tooltip with the exact numbers.
  - Boards with employees still **Available (not assigned)** keep the amber "Needs attention" list of names, right after the Deployment chart — assign them to a mission or drag them to Standby. Click a name to jump to that board.
- **Date**: top-right button opens a calendar. Each date has its own saved plan.
  - Future date with no plan yet → starts **empty**. Nothing is copied in automatically: the board shows a prompt with a **↺ Carry over last working day's plan** button (also the toolbar's **↺ Carry over** button), and only that explicit click brings the last working day's missions + crew in. This is deliberate — a plan is only ever changed by a real user action, so opening or exporting a board can never silently rewrite it for everyone else.
  - **↺ Reset Board** (toolbar): once a day has content, the same button becomes a destructive "start over from the last working day" — it confirms first, since it replaces what's there.
  - Past date → read-only 🔒; trying to edit shows a confirmation popup.
- **🔓/🔒 Lock**: next to the date picker. Click it once a day's plan is finalized to make that board **view-only for everyone** — a finished plan can't be bumped by someone else's edit or an auto-refresh. Anyone can unlock it again, but they first see a popup naming who locked it (and when); confirming unlocks it for everyone, not just that person.
- **+ New Mission**: mission number, host, customer, shift (day/night) with start/end time, engineer. The mission header takes the engineer's color. Click a mission header to edit, delete, or hide it.
- **👁 Hide/Unhide**: takes a mission off the board without deleting its record — its definition is kept (and stays hidden as the plan carries forward day to day) until you unhide it. Anyone assigned to a mission you hide returns to Standby. Use this for a mission that's paused rather than gone for good.
- **+ New Employee**: name, contract type (Permanent = solid card with `P`, On-call = dashed card with `OC`), service area (card color). Double-click an employee card to edit.
- **Drag & drop** employee cards between missions, Leave / Standby zones, and the Available pool. (No "Return to Site" zone — since employees now belong to a specific board, sending someone back to their original board is done via right-click → Move to Board.)
- **Search** (top-right, floating panel): filters the two unassigned pools as you type. If a match is already assigned to a mission or on leave, the box says so and flashes/scrolls to their card on the board instead of just showing "No match".
- **Stats bar**: total / assigned / leave / standby / return / available + a counter per service area.
- **Filters**: by engineer, host, customer, shift — non-matching missions fade out.
- **Manpower List tab**: every employee across every board, with a colour pill for service area matching the rest of the app, plus search/filter/sort, bulk edit (contract, position, service area, board, archive), and a **⬇ CSV** button that exports whatever the current search/filters are showing.
- **Export**: saves a high-resolution JPG of the current board.
- **Settings** ⚙: manage engineers (name, phone, color), service areas (name, color), and each board's weekly weekend days (checkboxes, save instantly) — this drives the holiday toggle, weekend "Add Mission" import, the date picker's weekend highlighting, and both Overview trend charts, so it's worth checking a new board's checkboxes match its real schedule.

## Where is the data?

In your Supabase project's Postgres database — shared by everyone signed in. Changes
one person makes (drag a card, add a mission, etc.) sync to everyone else's screen
within a second or two via Supabase Realtime.

## Files

- `index.html` / `styles.css` / `app.js` — the app UI (no build step)
- `charts.js` — Overview dashboard charts: hand-drawn inline SVG (donut, stacked bar, bar list, line), no charting library
- `cloud.js` — data layer: talks to Supabase, keeps an in-memory cache, subscribes to realtime changes
- `config.js` — your Supabase Project URL + anon key (see `SUPABASE_SETUP.md`)
- `supabase/schema.sql` — database schema, security rules, and seed data — run once in the Supabase SQL editor
- `supabase/migration-*.sql` — incremental schema changes; run any you haven't yet in the Supabase SQL editor (each is safe to run more than once)
- `vendor/html2canvas.min.js` — library used for JPG export
- `serve.ps1` — optional local web server for development, not needed for normal use
