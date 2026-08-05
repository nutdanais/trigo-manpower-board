# Manpower Management Board

A drag-and-drop daily manpower planning board (replacement for Microsoft Whiteboard).

## How to run

This app is now backed by **Supabase** (cloud database + auth + realtime sync), so it needs one-time setup — see [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md).

Once `config.js` has real Supabase credentials, double-click **index.html** to open the app, or serve the folder with any static web server. Sign in with an account created for you in the Supabase dashboard (Authentication → Users) — there's no self-signup.

## How to use

- **Boards**: tabs at the top-left. `+ Board` creates a new board (e.g. Rayong). Double-click a tab to rename it.
  - Every employee belongs to exactly **one board** — a card assigned on Non-Rayong can never appear as available on Rayong.
  - **Right-click** an employee card → "Move to …" transfers the person to another board; they land in that board's Available pool.
- **📊 Overview tab**: totals across all boards — employees per board, permanent vs on-call per board, and per-date deployment (missions, assigned, leave, standby, return, available) with service-area breakdowns.
  - Boards with employees still **Available (not assigned)** show an amber warning listing their names — assign them to a mission or drag them to Standby. Click a name to jump to that board. Boards with everyone placed show "✓ Everyone is placed".
- **Date**: top-right button opens a calendar. Each date has its own saved plan.
  - Future date with no plan yet → starts as a copy of the latest plan.
  - Past date → read-only 🔒; trying to edit shows a confirmation popup.
- **+ New Mission**: mission number, host, customer, shift (day/night) with start/end time, engineer. The mission header takes the engineer's color. Click a mission header to edit or delete it.
- **+ New Employee**: name, contract type (Permanent = solid card with `P`, On-call = dashed card with `OC`), service area (card color). Double-click an employee card to edit.
- **Drag & drop** employee cards between missions, Leave / Standby zones, and the Available pool. (No "Return to Site" zone — since employees now belong to a specific board, sending someone back to their original board is done via right-click → Move to Board.)
- **Stats bar**: total / assigned / leave / standby / return / available + a counter per service area.
- **Filters**: by engineer, host, customer, shift — non-matching missions fade out.
- **Export**: saves a high-resolution JPG of the current board.
- **Settings** ⚙: manage engineers (name, phone, color) and service areas (name, color).

## Where is the data?

In your Supabase project's Postgres database — shared by everyone signed in. Changes
one person makes (drag a card, add a mission, etc.) sync to everyone else's screen
within a second or two via Supabase Realtime.

## Files

- `index.html` / `styles.css` / `app.js` — the app UI (no build step)
- `cloud.js` — data layer: talks to Supabase, keeps an in-memory cache, subscribes to realtime changes
- `config.js` — your Supabase Project URL + anon key (see `SUPABASE_SETUP.md`)
- `supabase/schema.sql` — database schema, security rules, and seed data — run once in the Supabase SQL editor
- `vendor/html2canvas.min.js` — library used for JPG export
- `serve.ps1` — optional local web server for development, not needed for normal use
