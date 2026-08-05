# TRIGO Design System

Version 1.0 · Extracted from the Manpower Planning prototype (July 2026)
Maintainer: TRIGO Quality Services Thailand

A shared visual language for internal TRIGO tools. Copy the token block into any new
project, follow the component recipes, and the result will look like it belongs to the
same family as the Manpower Planning board.

> **Scope.** This covers internal operational tools (planning boards, dashboards, admin
> tables, reports). It is **not** the TRIGO corporate marketing style — that lives with
> the global brand team at trigo-group.com. When in doubt, corporate branding wins on
> anything customer-facing.

---

## 1. Design principles

These are the decisions behind the tokens. Follow them and the tokens mostly pick
themselves.

1. **The physical artifact is the spec.** Our users came from a magnet board with photo
   cards. Digital tools should preserve the mental model — same columns, same reading
   order, same vocabulary — before improving on it. Familiarity beats elegance.
2. **Density is a feature.** These are shop-floor tools showing 100+ people at once.
   Compact rows, small type, content-width cards. Never pad for prettiness.
3. **Navy is structure, green is action.** Navy frames things (headers, table chrome).
   Green means *do this* or *this is good*. Never use green for decoration — it dilutes
   the signal.
4. **State must be readable across a room.** Shortfalls, night shifts, and read-only
   modes get colour + shape + text, never colour alone.
5. **Thai names, English UI.** See §4.

---

## 2. Brand foundation

### Logo

Use the official transparent PNG (white wordmark + green bars). Asset: `logo.png`.

| Rule | Value |
|---|---|
| Header height | `30px` (desktop), `24px` (≤700px) |
| Minimum clear space | Height of the green bars on all sides |
| Approved background | `--navy`, `--navy-2`, or any dark surface |
| On light backgrounds | Use the dark corporate wordmark, or place the white logo on a `--navy` plate with `border-radius: 8px; padding: 5px 12px` |
| Never | Recolour, add effects, stretch, rebuild in CSS/type, or place the white logo on `--paper` |

Embed as base64 in single-file deliverables (prototypes, exported reports) so they work
offline. Reference a hosted asset in real applications.

### Green bars motif

The four stacked green bars are TRIGO's strongest brand shorthand. As a UI accent, a
single `4px × 14px` green bar (`--green`, `border-radius: 1px`) before a section title
echoes the logo without competing with it. Use sparingly — once per view at most.

---

## 3. Tokens

Paste this block verbatim into `:root`. Do not invent new hex values; if a colour is
missing, add it here first so every project inherits it.

```css
:root{
  /* brand */
  --navy:#062A44;      /* headers, table chrome, primary text on light */
  --navy-2:#0B3A5C;    /* secondary navy surfaces, captions */
  --green:#97C21D;     /* primary action, positive state */
  --green-d:#6E9312;   /* green text on light, focus ring, TL accent */

  /* neutrals */
  --paper:#F2F5F8;     /* app background */
  --card:#FFFFFF;      /* raised surface */
  --ink:#13222F;       /* body text */
  --mut:#5C707F;       /* secondary text, labels, placeholders */
  --line:#D8E0E7;      /* borders, dividers */

  /* semantic */
  --red:#D64545;       /* shortfall, destructive, high severity */
  --amber:#E8960C;     /* warning, read-only, medium severity */
  --day:#F2B705;       /* day shift */
  --night:#3A3F8F;     /* night shift */

  /* elevation & shape */
  --shadow:0 1px 2px rgba(6,42,68,.08),0 4px 14px rgba(6,42,68,.07);
  --r:10px;            /* default card radius */

  font-size:15px;      /* base — denser than the 16px web default, on purpose */
}
```

### Colour usage rules

| Token | Use for | Never use for |
|---|---|---|
| `--navy` | App header, table headers, active tabs, modal headers | Body text on white (use `--ink`) |
| `--green` | Primary buttons, "on target" states, active-tab counters, logo bars | Large fills, decorative backgrounds |
| `--red` | Understaffed counts, remove/delete, high-severity records | Anything merely "important" |
| `--amber` | Read-only banners, past-date badges, medium severity | Success or neutral states |
| `--mut` | Labels, secondary lines, empty-state text | Anything the user must act on |

Tinted backgrounds are always paired with a darkened text colour, never the raw token:

| Meaning | Background | Text | Border |
|---|---|---|---|
| Positive / on target | `#EAF4D5` | `#40610A` | `--green-d` |
| Shortfall / high severity | `#FBE4E4` | `#8C2B2B` | — |
| Warning / day shift / med severity | `#FFF3CC` | `#7A5B00` | `#F0D77E` |
| Night shift | `#E4E5F7` | `#31357D` | `#C3C6EE` |
| Neutral / skill tag | `#EAF1F7` | `--navy-2` | — |

### Spacing

A loose 4px-ish scale, biased small. Common values: `4 · 6 · 8 · 10 · 14 · 18 · 20`.
Card padding `14–16px`. Grid gaps `6–8px` inside dense rows, `12–16px` between blocks.
Page gutter `20px`, max content width `1440px`.

### Radius

| Value | Applies to |
|---|---|
| `999px` | Chips, tabs, badges, avatars, icon buttons |
| `10px` (`--r`) | Cards, panels, tables |
| `8px` | Buttons, inputs, logo plate |
| `6px` | Shift tags, skill tags |
| `4px` | Severity tags |

Pills for *people and filters*; soft rectangles for *surfaces and controls*. Keeping
that split is most of what makes the system feel coherent.

### Elevation

One shadow (`--shadow`) for everything resting on `--paper`. Hover lift for draggables
only: `transform: translateY(-1px)` + `0 3px 10px rgba(6,42,68,.16)`. Modals get
`rgba(6,42,68,.45)` scrim. No other shadows.

---

## 4. Typography

Two families, split by script — this is the most important typographic rule in the system.

```html
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet">
```

```css
body{font-family:'IBM Plex Sans Thai','Archivo',system-ui,sans-serif}
.lat{font-family:'Archivo','IBM Plex Sans Thai',sans-serif}  /* opt-in for Latin runs */
```

- **IBM Plex Sans Thai** — default for everything. It renders Thai correctly *and* has a
  competent Latin set, so mixed Thai/English sentences never break mid-line.
- **Archivo** — opt in with `.lat` for Latin-only runs: OEM names, dates, counts, table
  headers, KPI numbers, section labels. Its condensed, industrial feel is the "TRIGO
  voice." **Never apply `.lat` to a string that might contain Thai** — Archivo has no
  Thai glyphs and the browser will silently fall back, producing mismatched baselines.

### Scale

| Role | Size / weight | Notes |
|---|---|---|
| Modal title | `18px / 700` | |
| KPI number | `28px / 800` | `.lat` |
| Section label | `13px / 800`, `letter-spacing:.12em`, uppercase | `.lat`, colour `--mut` |
| Body, form fields | `13.5px / 400–600` | |
| Card name | `13px / 600` | single line, never wrap |
| Table header | `11.5px / 800`, `letter-spacing:.09em`, uppercase | `.lat`, on `--navy` |
| Tag / badge | `10–11px / 700–800` | |

Uppercase + wide letter-spacing is reserved for **Latin structural labels only**. Thai
has no uppercase and letter-spacing damages its cluster rendering — never apply either
to Thai text.

---

## 5. Components

### Person chip

The signature component: descended from a photo magnet.

```css
.chip{display:inline-flex;align-items:center;gap:7px;background:var(--card);
  border:1px solid var(--line);border-radius:999px;padding:4px 11px 4px 4px;
  box-shadow:var(--shadow);cursor:pointer;user-select:none;
  white-space:nowrap;width:max-content}
.chip:hover{transform:translateY(-1px);box-shadow:0 3px 10px rgba(6,42,68,.16)}
.chip.dragging{opacity:.35}
.chip .av{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;
  color:#fff;font-weight:700;font-size:12px;flex:none;position:relative}
.chip .nm{font-size:13px;font-weight:600;white-space:nowrap}
.chip.tl{border-color:var(--green-d);background:#F6FBE8}   /* team leader */
```

Rules:
- **`width:max-content`, one line, never truncate.** Names are identity — a clipped name
  is a defect. Let the chip size to the person.
- Avatar = photo, or initial on a deterministic colour from the palette below. Same
  person → same colour, always (hash the ID; don't randomise per render).
- Max **three** skill dots (`7px` circles) per chip. More than three, show them in the
  profile.
- Role accent goes on the border, not the fill.
- Unavailable people: `opacity:.55` + an explicit text tag. Never opacity alone.

Avatar palette (cycle by index):
`#1D4F9E · #0B7285 · #5F3DC4 · #B03A3A · #3B7A2A · #A8770B · #7A4B9E · #2B6B8C`

### Buttons

```css
.btn{border:0;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;font-family:inherit}
.btn.pri{background:var(--green);color:#16300A}      /* :hover #88B117 */
.btn.ghost{background:#fff;border:1px solid var(--line);color:var(--ink)}  /* :hover border #AFC4D4 */
.btn.danger{background:none;color:var(--red);font-size:12px;font-weight:600;padding:6px 9px;border-radius:6px}
```

One `.pri` per view. Destructive actions are text-only until hovered (`#FBE4E4`) — they
should be findable, not tempting. Anything irreversible confirms first.

### Filter tabs

```css
.gtab{border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 16px;
  font-size:13px;font-weight:600;color:var(--mut);box-shadow:var(--shadow)}
.gtab.on{background:var(--navy);border-color:var(--navy);color:#fff}
.gtab .n{font-weight:700;margin-left:7px;font-size:11px;opacity:.7}  /* count */
.gtab.on .n{color:var(--green);opacity:1}
```

Always carry a live count. A filter that doesn't tell you how much is behind it makes
people click every tab to find out.

### Data table

```css
.table{width:100%;background:#fff;border:1px solid var(--line);border-radius:var(--r);
  box-shadow:var(--shadow);border-collapse:separate;border-spacing:0;overflow:hidden}
.table th{background:var(--navy);color:#fff;font-size:11.5px;letter-spacing:.09em;
  text-transform:uppercase;text-align:left;padding:11px 14px}
.table td{padding:9px 14px;border-top:1px solid #EDF1F5;font-size:13.5px}
.table tr:hover td{background:#F7FAFC}
```

**Grid rule:** `1px` borders in `--navy` for structural boards (matches the header, reads
as one object); `1px` in `#EDF1F5` for scanning-oriented tables. Thick borders were tried
to mimic the physical board's tape and rejected — they read as noise on screen.

On narrow viewports drop columns via `.hide-m` rather than shrinking type or scrolling
horizontally.

### Modal

Bottom sheet under 640px, centred dialog above. `--navy` sticky header with a `14px`
radius avatar; tabs below with a `2.5px` `--green` active underline and `--navy` label.
Body `16px 20px 26px`. Scrim `rgba(6,42,68,.45)`. Dismiss on scrim click and `Escape`.

### Forms

Labels: `11.5px / 700` uppercase-free, colour `--mut`, `4px` above the field.
Fields: `1px solid var(--line)`, `border-radius:8px`, `padding:9px 12px`, `13.5px`.
Layout: `grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px`.
Inline forms open above the data they affect, on a `--card` panel with a `--green-d`
border so it reads as a temporary, active state.

### Status tags

```css
.shift{font-size:11px;font-weight:700;border-radius:6px;padding:3px 9px;
  display:inline-flex;align-items:center;gap:5px}
.shift.day{background:#FFF3CC;color:#7A5B00;border:1px solid #F0D77E}    /* ☀️ DAY */
.shift.night{background:#E4E5F7;color:#31357D;border:1px solid #C3C6EE}  /* 🌙 NIGHT */
```

Emoji carry the shift meaning at a glance and survive PNG export and screenshots — a
worthwhile exception to the usual "no emoji in enterprise UI" instinct.

---

## 6. Patterns

### Read-only history

Any view of a past record: `--amber` badge in the header, full-width `#FFF4DB` banner
with `#F0D9A0` border and `#6B4E00` text, all mutating affordances disabled (drag off,
buttons `opacity:.5`). Time travel must be visibly impossible to get wrong.

### Capacity display

Always `actual/target` as a fraction, never a bare number. Below target → `--red` and an
explicit shortfall count. Never encode shortfall in colour alone.

### Drag and drop

Source `opacity:.35`. Valid target: `#EAF4D5` fill + `2px dashed var(--green-d)` outline
inset `-4px`. Empty drop zones show instructional text in `--mut` rather than sitting
blank. Every drag target also needs a tap/click path — half our users are on phones.

### Export

Operational views need a "share" path — plans get screenshotted into LINE and Teams
regardless of what we build, so make the screenshot good. Export at `scale:2` on a white
background with a `--navy-2` caption bar carrying the green bar motif, scope, and date.
Filename: `trigo-{artifact}-{scope}-{ISO date}.png`.

### Bilingual content

- **UI chrome, labels, buttons, dates: English.** Dates as `14 Jul 2026` — unambiguous
  across the Thai/Western calendar gap that `14/7/2026` vs `14/7/2569` creates.
- **Person names, free-text notes: Thai as entered.** Never transliterate. Never
  truncate.
- Design every label for the longer of the two languages; Thai runs ~20% longer than
  English at the same point size and has taller ascenders/descenders — leave vertical
  headroom (`line-height` ≥ 1.4 on Thai body copy).

---

## 7. Accessibility

- Focus: `outline:2.5px solid var(--green-d); outline-offset:2px`. Never remove it.
- Every drag interaction has a keyboard/click equivalent. Chips are `tabindex="0"` and
  respond to `Enter`.
- Respect `prefers-reduced-motion: reduce` — disable all transitions.
- Icon-only buttons carry `aria-label`. Skill dots carry `title`.
- Contrast: `--mut` on `--paper` passes AA for ≥13px. Don't go lighter or smaller.
- Never rely on colour alone: pair with text, icon, or shape.

---

## 8. Adoption checklist

For any new TRIGO internal tool:

- [ ] Token block pasted into `:root` unchanged; no ad-hoc hex values
- [ ] Both fonts loaded; `.lat` applied only to Latin-only strings
- [ ] Official `logo.png` in a `--navy` header at `30px`
- [ ] Primary action is `--green`; exactly one per view
- [ ] Base `font-size:15px`, `max-width:1440px`, `20px` gutter
- [ ] Names never truncated
- [ ] Every state readable without colour perception
- [ ] Works at 380px wide (phone) and on a shop-floor display
- [ ] Focus rings intact; reduced-motion respected
- [ ] Past/read-only states unmistakable

---

## 9. Changelog

| Version | Date | Notes |
|---|---|---|
| 1.0 | Jul 2026 | Initial extraction from the Manpower Planning prototype. |

Add a row whenever a token changes, and say why — the reasoning is the part future
projects need.
