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
