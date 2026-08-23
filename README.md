# Manpower Management Board

A drag-and-drop daily manpower planning board (replacement for Microsoft Whiteboard).

## How to run

This app is now backed by **Supabase** (cloud database + auth + realtime sync), so it needs one-time setup — see [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md).

Once `config.js` has real Supabase credentials, double-click **index.html** to open the app, or serve the folder with any static web server. Sign in with an account created for you in the Supabase dashboard (Authentication → Users) — there's no self-signup.

## How to use

- **Boards**: tabs at the top-left. `+ Board` creates a new board (e.g. Rayong). Double-click a tab to rename it.
  - Every employee belongs to exactly **one board** — a card assigned on Non-Rayong can never appear as available on Rayong.
  - **Right-click** an employee card → Assign to a mission, send to a leave type, or return to Standby/Available On-call — the same as dragging, for when the target has scrolled off-screen or you're on touch — plus Edit / Move to another board / Deactivate. (Position, contract type, and service area move to the Manpower List tab — set them one at a time from Edit Employee, or in bulk from the list's selection bar.)
  - **Active / Inactive** — the **Status** column in the Manpower List toggles an employee on or off the roster (right-click → **Deactivate**, the Edit Employee modal's **Deactivate** button, and the list's bulk **Deactivate** all do the same thing). An inactive employee disappears from **today's and future** boards — the Standby / On-call pools, mission and leave cards, and every count built from them — so they can't be planned in. **Past dates keep them**, so a finished plan stays an accurate record of who was actually there. Nothing is deleted: flip Status back on and they return everywhere. The list header shows how many are inactive, and the column sorts, so they're easy to find again.
- **📊 Overview tab**: a management dashboard, not a wall of numbers — a KPI strip, a deployment donut + per-board stacked bars (with the "Needs attention" list of unassigned names right after), a contract-mix donut per board, a service-area breakdown (one bar per area on a shared scale — full length is that area's headcount, the two segments split permanent / on-call), two 7/14/30-day trend lines per board (click a legend entry to hide/show its line) — **Utilization** and **On-call availability** (on-call headcount not on a mission or on leave) — both counting only working days (weekends and holidays excluded), and a leave-by-type breakdown at the bottom. Every chart has a hover/focus tooltip with the exact numbers.
  - **How utilization is counted**: assigned ÷ (headcount − leave − holiday − **free on-call**). On-call staff are surge capacity, so an on-call employee who wasn't called leaves the denominator rather than dragging the day down — a day where everyone you actually needed is deployed reads 100%, however many on-call people went uncalled. They're still counted the moment they *are* deployed, and "On-call free" keeps its own stats-bar chip and its own **By board** column, so the number is never hidden.
  - Boards with employees still **Available (not assigned)** keep the amber "Needs attention" list of names, right after the Deployment chart — assign them to a mission or drag them to Standby. Click a name to jump to that board.
- **Date**: top-right button opens a calendar. Each date has its own saved plan.
  - **On login the board always opens on the next working day** — tomorrow, skipping that board's weekend days and any dates marked as holidays. It does remember which board tab you were last on, just not which date, so you always start on a day you can actually edit rather than on yesterday's finished (read-only) plan.
  - Future date with no plan yet → starts **empty**. Nothing is copied in automatically: the board shows a prompt with a **↺ Carry over last working day's plan** button (also the toolbar's **↺ Carry over** button), and only that explicit click brings the last working day's missions + crew in. This is deliberate — a plan is only ever changed by a real user action, so opening or exporting a board can never silently rewrite it for everyone else.
  - **↺ Reset Board** (toolbar): once a day has content, the same button becomes a destructive "start over from the last working day" — it confirms first, since it replaces what's there.
  - Past date → read-only 🔒; trying to edit shows a confirmation popup.
- **🔓/🔒 Lock**: next to the date picker. Click it once a day's plan is finalized to make that board **view-only for everyone** — a finished plan can't be bumped by someone else's edit or an auto-refresh. Anyone can unlock it again, but they first see a popup naming who locked it (and when); confirming unlocks it for everyone, not just that person.
- **+ New Mission**: mission number, host, customer, shift (day/night) with start/end time, engineer. The engineer's colour marks the card: full strength on its border, and a soft wash of the same colour behind the header — so you can still pick out one engineer's missions across the whole board, without the board being a wall of saturated blocks. Click a mission header to edit, delete, or hide it.
- **👁 Hide/Unhide**: takes a mission off the board without deleting its record — its definition is kept (and stays hidden as the plan carries forward day to day) until you unhide it. Anyone assigned to a mission you hide returns to Standby. Use this for a mission that's paused rather than gone for good.
- **+ New Employee**: name, contract type (Permanent = solid card with `P`, On-call = dashed card with `OC`), service area (card color). Double-click an employee card to edit.
- **Drag & drop** employee cards between missions, Leave / Standby zones, and the Available pool. (No "Return to Site" zone — since employees now belong to a specific board, sending someone back to their original board is done via right-click → Move to Board.)
- **Search** (top-right, floating panel): filters the two unassigned pools as you type. If a match is already assigned to a mission or on leave, the box says so and flashes/scrolls to their card on the board instead of just showing "No match".
- **Stats bar**: total / assigned / leave / standby / return / available + a counter per service area.
- **Filters**: by engineer, host, customer, shift — non-matching missions fade out.
- **Manpower List tab**: every employee across every board, with a colour pill for service area matching the rest of the app, plus search/filter/sort, bulk edit (contract, position, service area, board, deactivate), a **30D utilization** column (the share of the last 30 working days that person was on a mission, as a meter plus the number — this one is per-person, so unlike the board figures above an uncalled on-call employee does count those days), and a **⬇ CSV** button that exports whatever the current search/filters are showing.
- **Export**: saves a high-resolution JPG of the current board.
- **Settings** ⚙: manage engineers (name, phone, color), service areas (name, color), and each board's weekly weekend days (checkboxes, save instantly) — this drives the holiday toggle, weekend "Add Mission" import, the date picker's weekend highlighting, and both Overview trend charts, so it's worth checking a new board's checkboxes match its real schedule.

## Releasing a change

There's no build step, so the only release chore is one line. `index.html` loads
`styles.css`, `cloud.js`, `charts.js` and `app.js` with a `?v=` version string —
**bump it in all four tags whenever you change any of those files** (use the
date; add a letter for a second release the same day). A changed URL is the one
thing a caching proxy between a factory PC and the internet cannot ignore.

Forgetting it is not a disaster: `_headers` tells every cache to revalidate on
each load, so the browser still picks the new file up. The version string is
there for the caches that ignore that instruction. If a deploy ever looks
half-updated — new page, old behaviour — check the version string first, then
hard-refresh.

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
- `_headers` — Netlify caching rules. Everything is set to revalidate on every load; nothing is cached hard.
- `vendor/html2canvas.min.js` — library used for JPG export
- `serve.ps1` — optional local web server for development, not needed for normal use
