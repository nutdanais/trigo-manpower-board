# Design canvas — Overview tab review

Design collateral, not app code. Nothing here is loaded by `index.html` or shipped
to Netlify; the app is unaffected by anything in this folder.

## What's here

A design review of the **Overview** tab — the state it's in today, a proposed
redesign, and five data modules worth adding. Three artboards:

| File | Artboard |
|---|---|
| `CurrentIA.dc.html` | Review of the current Overview: its 9 blocks, with findings A–F marked |
| `Main.dc.html` | The proposed Overview — status bar, action queue, one merged trend chart, position coverage |
| `Modules.dc.html` | The five new data modules in detail, each with where its data comes from |
| `canvas.json` | Canvas layout (positions, frame sizes) + the review's sticky notes |

All figures in the artboards are realistic **placeholders** (128 staff, 21 missions,
2 boards) — not live data. Colours and type are lifted from `styles.css` so the
mockups match the real app: `--panel` `#ffffff`, `--border` `#d8dde4`,
`--primary` `#004983`, the 8-hue categorical chart set, Noto Sans.

## Overview directions (2026-10-12)

`overview-directions.html` is a standalone page (open it in any browser): a
review of the Overview tab with findings F1–F11, then four directions — A
Refined dashboard, B Board cards, C Action inbox, D Today | Trends — each with
a live-HTML mockup on the same sample day, a comparison table and a
recommendation. Like the rest of this folder it is not loaded by the app.

`overview-a-mockup.html` is the full, working mockup of direction A for sign-off:
every Overview section at full size on one consistent sample day (pick a board,
switch Desktop / Phone, hover anything), with numbered markers keyed to a change
list (1–11) that says, per section, what changes and why.

## Re-seeding the canvas

The published canvas (`overview-tab-review.html`, gitignored — 2.5 MB of editor
bundle) is generated, never hand-edited. To change the design, edit the
`.dc.html` files here and re-seed:

```
node <claude-design-skill>/seed-canvas.mjs \
  --template <claude-design-skill>/payload.template.html \
  --out overview-tab-review.html \
  --title "Overview Tab Review" \
  --artboard Main.dc.html --artboard CurrentIA.dc.html --artboard Modules.dc.html \
  --canvas canvas.json
```

Then republish that file to the same artifact URL so the link keeps working.
Each `.dc.html` is a self-contained static page; the `<script src="./support.js">`
line in the head is a placeholder the canvas runtime swaps at render time — leave
it alone.

## Stats bar directions (2026-10-12)

`stats-bar-directions.html` is a standalone page (open it in any browser): a review of the
Board tab's toolbar (findings S1–S9), then four directions for the stats bar — A Grouped &
hushed, B Headline + composition bar, C KPI tiles, D Summary line + details popover — as
live mockups driven by one scenario object (normal / short-staffed / holiday day, four
widths, row-1 as-is or tidied, light/dark), a comparison table with live toolbar heights,
and a recommendation (B plus the row-1 tidy). Like the rest of this folder it is not loaded
by the app.

## Hide/Unhide missions directions (2026-10-12)

`hide-missions-directions.html` is a standalone, interactive review page for the
board toolbar's Hide/Unhide dialog: findings F1–F6 on today's dialog, three
dialog directions (A Grouped list, B On the board | Hidden, C Mini board), each
shown in a live desktop frame (min(920px, 94vw) wide) and a full-screen phone
frame, all suggesting the missions with no crew first. It also proposes three
places for a "Hide" action on an empty mission card (H1 empty-state row, H2
count chip, H3 corner icon), with a comparison and a decision picker. Not
loaded by the app.

## Capacity tab directions (2026-10-12)

`capacity-directions.html` is a standalone, interactive review page for the
Capacity tab. It contains annotated screenshots of the current release (desktop and
phone) with findings F1–F12; the planner and manager flows as they work today; a
proposed four-stage flow (Read, Explain, Plan, Hand over); and four directions as
working mockups on one shared sample (Board One, 32 people, 6 host rows, 2 weeks):
A Refined grid, B Answer first (gap timeline + day panel), C All boards heatmap,
D Guided planner. Each has a desktop frame and a phone frame, and editing a number in
one mockup updates every gap on the page. A comparison table follows, then a
recommendation (A now, B's day panel next, C later) and a decision picker. Not
loaded by the app.

## Modal directions (2026-10-13)

`modal-directions.html` is a standalone page: an audit of all 26 dialogs (17 on the
default 440 px card), then four directions — A Size tiers, B Side sheet, C Sectioned
workspace, D Adaptive hybrid (recommended) — each mocked on Edit Employee, Review &
merge forecast and a phone view, with a comparison table. Not loaded by the app.
