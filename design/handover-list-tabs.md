# Hand-over: Manpower, Host and Missions, one design for the list, the record and the form

This is the brief for building the design the user approved on 10 Nov 2026. A session should be
able to do each batch from this document and the code alone, with no earlier conversation.

**The approved design:** Table **B** (two-line rows), Panel **A** (read first, then Edit), Alerts
**A** (in the Status cell), with one change the user asked for: **the status chip is on the first
line of its cell and the alert is under it on the second line**, so the Status column stays narrow
and matches the other two-line cells.

**The picture of it:** `design/list-tabs-review.html`
(rendered: https://claude.ai/artifact/37kE7mmJ8Yw9TxC9hQzD9D). Open it before you start. Decision 1
option B, Decision 2 option A and Decision 3 option A are what to build; switch the tab control to
see each of the three tabs. Its `<style>` block holds the chip CSS to copy (section 3). Where this
brief and the page disagree, **this brief wins**; the differences are listed in section 9.

The work is cut into **four batches**. **One batch = one branch = one pull request.** Do them in
order: **A → B → C → D**.

| Batch | What | Size |
|---|---|---|
| A | The chip shapes and the small fixes, on all three tabs. No layout change | small |
| B | The three tables: two-line rows, one column order, stacked status and alert, ⋯ and Columns everywhere | large |
| C | The record panel: one width, one header, fields as label and value, forms with one footer (Employee and Mission) | large |
| D | The Host record view (Host has none today) | medium |

---

## 0. The flow

1. **One session per batch, starting from `main`.** Paste this prompt:

   > Read `design/handover-list-tabs.md` and build **Batch A** only.
   > Follow its rules and its "Done when" list, then open a draft PR.

2. **Review in the same session:** `/code-review medium`, fix what it finds, re-run the tests, push.
3. **The user** opens the Netlify deploy preview with `/?demo`, tries it, and merges.

When a choice is genuinely open, use the default written here and list it under "Choices made" in
the PR description. Ask the user only when this brief says to, or when a default here turns out to
be impossible.

---

## 1. Rules for every batch

- Read `CLAUDE.md` first and follow it: the branch is named after the change
  (`claude/list-tabs-chips`, `claude/list-tabs-tables`, `claude/list-tabs-panels`,
  `claude/host-record-view`), the PR title says what changed, the PR description gives the
  preview link with `/?demo` and says what the demo does not prove.
- **No database change.** No migration, no new column, no new RPC. Everything here is `app.js`,
  `styles.css`, `index.html`, `i18n-th.js`, tests, `README.md`. If you find you need one, stop and
  ask.
- **Thai.** Every new or changed English string needs its line in `i18n-th.js`. With Thai on,
  `I18N.missing()` in the console must list nothing new. Names people typed are not translated
  (`data-no-i18n`).
- **Permissions stay as they are.** Whatever a role could not do before, it still cannot. A viewer
  sees no edit buttons, no checkboxes that lead to an edit, no "+ Add".
- **The phone layout (below 640px) keeps its cards.** The tables turn into cards there through
  `data-label` on each `<td>` and the phone block in `styles.css`. After any table change, check
  all three tabs at 390px: the card shows the same fields as before, and the new chips. Do not
  redesign the phone cards.
- **Do not touch:** the toolbar, the stat tiles and proportion bar, the By area chips, the Skills
  matrix view, the Excel / CSV exports, bulk edit by file (`bulk-edit.js`), the board itself.
- **Light mode only**, the app's tokens from `styles.css`. Add new colours as tokens in `:root`,
  not as literals in a rule.
- **Tests.** Run before every push:
  - `node --test tests/*.test.js`
  - `NODE_PATH=$(npm root -g) node tests/e2e/<file>` for every e2e file that touches the tabs you
    changed. The ones that do: `missions-tab`, `mission-menu`, `mission-highlight`,
    `list-alerts-org`, `manpower-fit`, `employee-profile`, `employee-start-date`, `english-name`,
    `trigo-id`, `host-experience-setting`, `stats-tiles`, `loans`, `loans-overview`, `added-later`,
    `bulk-edit`, `phone-shell`, `language`, `demo-mode`.
  - A test that fails because the design changed (a selector, a column that moved, a chip's text)
    is updated to check the same behaviour in its new place. Never delete or skip a check to get
    green. A test that fails for any other reason is a bug in your change.
  - Add checks for what you built (the "Done when" lists say which).
- **Release:** at the end of each batch run `node bump-version.js`, and update the tab's section
  in `README.md` so it describes what the user now sees.
- Keep each batch to its scope. If you see something else worth fixing, list it in the PR
  description under "Noticed, not done".

---

## 2. Where things are

`app.js` (line numbers are from `main` at e74914e; search by name if they have moved):

| What | Where |
|---|---|
| Manpower table rows | `renderEmployeeRows` (~8210); header in `index.html` `#emplist-table` |
| Manpower issue chips beside the tiles (missing TRIGO ID, no service area, no English name, on loan) | `issueChip` inside `renderStats` (~3528) |
| Employee profile (read) | `openProfile` (~6211), `renderProfile` (~6284), `#modal-profile` |
| Employee form | `openEmployeeModal` (~11459), `#modal-employee`, shown inside the profile (`.employee-pane-stack`) |
| Deactivate with a reason | `askDeactivate` (~10764) |
| Host table rows | `renderHostRows` (~8791); header `#hostlist-table` |
| Host "without a location" chip | `renderStats` (~3591) |
| Host experience, "at risk" | `hostExperience` (~345), `hostMatrixRows` (~8913) |
| Host form | `openHostModal` (~9737), `renderHostMergeSection`, `#modal-host` |
| Missions table | `renderMissionList` (~9295), `missionInfo`, `missionStatusHtml` (~9118), `missionAlerts` (~9071), `missionAlertsHtml` (~9137), `missionHighlightChip` |
| Missions Columns button | `renderMissionColumns` (~9406), `#btn-missions-cols`, `.mcol-*` classes |
| Missions row menu | `openMissionRowMenu` (~9440), `renderMissionRowMenu` |
| Mission panel (read) | `openMissionFromList` (~10952), `renderMissionDetail` (~11072) |
| Mission form | `openMissionModal` (~10994), `#modal-mission` |
| Board chip, area pill | `boardChipHtml` (~3694), `areaPillHtml` (~8393) |

`styles.css`: the Missions chips are `.ml-tag`, `.ml-open`, `.ml-hidden`, `.ml-off`, `.ml-wait`,
`.ml-warn`, `.ml-late`, `.ml-closed`, `.ml-hl`, `.ml-pill-btn` (~7380 on); side panels are
`.modal.modal-side` (~5379).

To see the app: serve the repo root with any static server and open `/?demo` (the e2e tests show
how, `tests/e2e/demo-mode.e2e.js`). Playwright and Chromium are already installed.

---

## 3. The chip rules (used by every batch)

Five meanings, five shapes. A shape never carries a second meaning. Copy the CSS for `.st`, `.al`,
`.ar`, `.bd`, `.pc` and `.act` from the `<style>` block of `design/list-tabs-review.html` into
`styles.css` under one comment block, rename them with one prefix (`lt-`: `lt-st`, `lt-al`, …), and
use the app's existing tokens where the page defines its own (`--ok-surface`, `--ok-line`,
`--ok-text`, `--warn-surface`, `--warn-line`, `--warn-text`, `--danger-tint`, `--danger-line`,
`--danger-text`).

| Meaning | Shape | Rule |
|---|---|---|
| **Status** | Pill with a dot, 22px high | Exactly one per row. Green = live, grey (hollow dot) = parked, amber = drifting, red = ended |
| **Alert** | Warning-triangle icon + coloured bold text, **no pill, no border** | States the problem only. Amber or red. Never ends in a question or an action |
| **Category** | Board = square 4px tag, neutral outline. Service area = 9px colour square + normal-weight text | Never filled with colour. The same drawing in tables, panels and forms |
| **Person** | Square 4px neutral chip with the day count; a navy outline = experienced | Panels only. Never in a table cell |
| **Action** | Navy bold text button | Never drawn as a chip |

Status mapping:

| Tab | Value | Chip |
|---|---|---|
| Manpower | Active | green "Active" |
| | Inactive for now | grey "Inactive" |
| | Resigned | red "Resigned" |
| Host | Active | green "Active" |
| | Archived | grey "Archived" |
| Missions | on its board | green "On board" |
| | hidden | grey "Hidden" |
| | not started | grey "Not started" |
| | off the board | amber "Off the board" |
| | closed | grey "Closed 3 Nov 2026" (the date as today) |

Alert texts (short, so they fit the second line; the long sentence stays as the `title` tooltip):

| Tab | Alert | Text | Colour |
|---|---|---|---|
| Missions | no crew, 5 days or fewer | `No crew, 3 days` | amber |
| | no crew, more than 5 | `No crew, 25 days` | red |
| | hidden more than 5 | `Hidden 9 days` | amber |
| | off the board more than 5 | `Off 8 days` | amber |
| | waiting for the new-year number | `Needs 2027 number` | grey text with an info look while not late, red once late (as `missionAlerts` levels 0 and 2) |
| | no Trigo responsible | `No responsible` | amber |
| Manpower | no TRIGO ID | `No TRIGO ID` | amber |
| | no service area | `No service area` | amber |
| | leave share above 20% / above 30% | `Leave 24%` / `Leave 32%` | amber / red (the thresholds the Leave share column uses today) |
| Host | no location and no Maps link | `No location` | amber |
| | at risk (`hostExperience(...).atRisk`) | `2 experienced` (the count) | red |

"No English name" and "on loan" are information, not alerts: they stay as the grey chips beside the
tiles and get no row alert.

**More than one alert on a row:** show the most serious one (the order `missionAlerts` already
sorts by; for Manpower and Host: red before amber, then the table order above), followed by a
muted `+1` (or `+2`). The tooltip on the alert lists all of them, one per line.

---

## 4. Batch A: chips and small fixes

No column moves, no panel changes. After this batch the three tabs look as they do now, with
consistent chips.

1. Add the `lt-*` chip CSS (section 3).
2. **Missions table:** `missionStatusHtml` draws the status pill; `missionAlertsHtml` draws the
   alert as icon + text with the short texts above and without " · Close?". The alert is no longer
   a button. "Close…" is already a hover action on the row and in ⋯; keep those. "Add to board"
   (beside Not started / Off the board) becomes an action text button.
3. **Board chip** everywhere on the three tabs and their panels: the square neutral tag.
4. **Service area** everywhere on the three tabs and their panels: colour square + normal-weight
   text. This replaces the bold text in the Manpower and Host tables and the solid pill in the
   mission panel. The employee cards on the board are **not** part of this; leave them.
5. **Empty value:** one helper (for example `emptyCell()`) returning a muted `—`. Use it for every
   empty cell in the three tables and every empty field in the three panels (the Missions table is
   blank today and its panel shows `-`).
6. **Links:** hosts and locations use one link style (navy, solid thin underline, 3px offset).
7. **Headers on one line:** shorten instead of wrapping: "Mobile", "Contract", "Service",
   "Responsible", "Avg crew", "Boards". Keep each header's `title` tooltip.
8. **Years of service:** `7y 8m` in the table (days dropped; under one month shows `26d`). The full
   text stays in the tooltip and in the profile.
9. **Host:** remove the count text that repeats the amber chip (`· 1 without a location` in
   `#hostlist-count`). Keep the chip.
10. **Mission form title:** `107` with "Edit mission" as the sub-line, as the Host and Employee
    forms do, in place of the bare "Edit Mission".
11. **Profile tiles:** the values in the Details grid are in two sizes today (TRIGO ID, Service
    area, Board, English name small; Contract, Status, Mobile large). Make them one size.

**Done when**
- All existing tests pass, updated only where a chip's markup or text changed.
- New e2e checks (add to `missions-tab.e2e.js` and `list-alerts-org.e2e.js`): a Missions row with
  an alert has exactly one status pill and one alert element, and the alert is not a button; an
  empty Missions cell shows `—`; the service area in the Manpower table, the Host table and the
  mission panel uses the same class.
- Thai shows no English on the three tabs.
- Phone at 390px: the cards show the new chips and nothing overflows.

---

## 5. Batch B: the three tables

### 5.1 The shape of every row

Two lines per row, every row the same height. The first three columns are the same on every tab,
then the tab's own facts, then ⋯.

```
☐ | Identity            | Status       | Board and area | … tab's own columns … | ⋯
  | Name (bold)         | ● Status     | [Board]        |
  | second line (muted) | ⚠ Alert      | ■ Service area |
```

- **Status cell:** line 1 the status pill, line 2 the alert (section 3). No alert: line 2 is
  empty, the pill stays on line 1 (top-aligned with the other cells' first lines, not centred).
  The column is as wide as its longest pill or alert, about 150px; it must not wrap to a third
  line. Long alert text is cut with an ellipsis and kept whole in the tooltip.
- **Row height:** fixed by two lines of text. Nothing in a row may make it taller.
- **Sticky header** as today.
- **Fit:** at 1366px wide none of the three tables scrolls sideways with the default columns.
  Check this in a test.

### 5.2 Columns

Second line in *italics* here means muted 12.5px text in the app.

**Manpower**

| Column | Line 1 | Line 2 | Sorts by |
|---|---|---|---|
| ☐ | checkbox (as today) | | |
| Person | name, bold | *TRIGO ID · Position* (leave out what is empty) | name |
| Status | status pill | alert | status, then alert level |
| Board and area | board tag | *service area*; when on loan, the loan text the Board column shows today replaces the area on line 2 and the area moves to the tooltip | board |
| Contract | Permanent / On-call | *since Feb 2019 · 7y 8m* | contract |
| Mobile | number | | |
| Utilisation 30D | the bar and % (follows 30D / 90D / YTD as today) | | utilisation |
| Worked · Leave | `17 · 3`, right-aligned | *13.6% leave* (amber / red as today) | worked |
| ⋯ | row menu | | |

**Host**

| Column | Line 1 | Line 2 | Sorts by |
|---|---|---|---|
| ☐ | checkbox (new) | | |
| Host | name, bold | *location* as the Maps link; none: *No location yet* | name |
| Status | status pill | alert | status, then alert level |
| Board and area | board tag(s); more than two: first + `+1` | *service area* | first board |
| People who know the site | **6** experienced | *22 people · 99 days in all* | experienced |
| Last worked | date | | date |
| Note | note, one line, ellipsis, full text in the tooltip | | |
| ⋯ | row menu | | |

The name chips of "Inspectors deployed" leave the table. They are shown in the Host record
(Batch D) and, until then, in the Skills matrix view, which already lists them. The numbers come
from the row's `inspectors` list and `hostExperience`, as `hostMatrixRows` does.

**Missions**

| Column | Line 1 | Line 2 | Sorts by |
|---|---|---|---|
| ☐ | checkbox (new) | | |
| Mission | number, bold; a gold star before it when the day is highlighted (tooltip = the highlight's label) | *customer*; a renumbered mission keeps its "was AYTTH.25.0157" in the tooltip | number |
| Status | status pill | alert | as today's Board and status |
| Board and area | board tag | *service area of the host* | board |
| Host and responsible | host link | *Trigo responsible* | host |
| Shift | Day / ☾ Night | *08:00–17:00* | shift |
| On the board | `7 Oct → 11 Nov` | *2026* (both years when they differ: `2025 → 2026`) | start date |
| Crew (date) | crew on the day, bold, right-aligned; `—` when hidden or not on the board | *avg 2.8* | crew |
| Note | PPE and remark joined with ` · `, one line, ellipsis, tooltip | | |
| ⋯ | the hover action (Close… / Add to board) and the row menu, as today | | |

### 5.3 Sorting and the Columns button

- A header sorts by the value named in "Sorts by". Clicking again reverses, as today.
- **All three tabs get the Columns button** Missions has now (same component, same place in the
  toolbar, the choice kept on the device per tab).
- Every fact that used to have its own column and now sits on a second line is offered in Columns
  as an **optional single-fact column, off by default**, with its old `data-sort` key, so it can
  still be shown and sorted on its own:
  - Manpower: TRIGO ID, Position, Start date, Years of service, Service area, Worked, Leave,
    Leave share.
  - Host: Location, Service area, People (count), Note is already a column.
  - Missions: Customer, Trigo responsible, Time, Start date, Last on board, Avg crew, PPE, Remark.
- The default columns above can be hidden too, except Identity, Status and ⋯.
- Existing saved Missions column choices on a device: map old keys to the new ones where they
  exist, drop the rest. Do not crash on an unknown key.

### 5.4 Acting on a row

- **Click** a row (not on a link, checkbox, button or ⋯): opens the record. On Host, until Batch D,
  it opens the form as the pencil does today. **Double-click** keeps working and does the same.
- **Checkbox:** Manpower as today. Host and Missions get the column and "select all", and a bulk
  bar in the same component as Manpower's with what already exists for one row: Host: Archive /
  Make active. Missions: Close… (the existing close dialog, applied to each). Shown only to roles
  that may edit.
- **⋯** on every row. Missions as today. Manpower: Profile, Move to board / Lend to board (as the
  right-click menu), Deactivate / Activate. Host: Edit, Open map (when there is a link), Archive /
  Make active. Right-click and long-press keep opening the same menu.
- **The Status switches leave the tables.** Activate / Deactivate and Archive / Make active are in
  ⋯, the bulk bar and the record. Deactivate still asks why (`askDeactivate`).
- **"+ Add"** for a missing TRIGO ID, service area or location shows on row hover (and always on
  touch screens), as an action text button in the cell where the value would be, for roles that
  may edit. It opens the form on that field, as today.

### 5.5 Alerts counted and filtered

Do not build a new tile. The chips beside the tiles already count and filter:

- Manpower: "missing TRIGO ID", "no service area" stay. Add **"high leave"** (count of active
  people above 20% in the period on screen), filtering the same way.
- Host: "without a location" stays. Add **"at risk"**, which filters to hosts at risk.
- Missions: the No crew tile and the Alerts filter stay as they are.

### Done when
- The three tables match 5.1 and 5.2 in the demo, and none scrolls sideways at 1366px.
- Every row on every tab is the same height (a test measures the rows of each table and expects
  one height).
- Sorting works on every header and on every optional column.
- Columns works on all three tabs and survives a reload.
- A viewer (`/?demo&role=viewer`) sees no checkboxes, no "+ Add", and a ⋯ with read actions only
  (Profile, Open map) or no ⋯ when it would be empty.
- Phone at 390px: cards unchanged in content, no sideways scroll (`phone-shell.e2e.js`).
- Thai: nothing in English.
- README: the Manpower, Host and Missions sections describe the new columns, the Columns button,
  where Deactivate and Archive went, and the alert line.

---

## 6. Batch C: the record panel (Employee and Mission)

### 6.1 One panel

- **One width for all records and their forms: `min(760px, 100vw)`.** The profile is about 1,040px
  today, the mission panel 880px, the forms 500px.
- **Header** (fixed while the body scrolls):
  - Line 1: the name or number (18px, bold), the status pill, the close ×.
  - Line 2 (muted): what it is, then the board tag and the service area. Employee:
    `T213 · Kittipong Wongyai`. Mission: `Door Module Co. at Siam Auto Parts`.
  - Line 3: actions. **At most two buttons and "More ⋯".** Employee: **Edit**, Move to board
    (Lend to board when loans are on), More: Deactivate… / Activate. Mission: **Edit**, Move or
    copy…, More: Duplicate, Highlight, Hide / Unhide, Close mission…, Delete. Nothing a role
    cannot do is shown.
- **Alert line** under the header, only when the record has an alert: a tinted box (amber or red)
  with the alert on the left and its one fix as a text button on the right ("Close mission…",
  "+ Add TRIGO ID"). It replaces the "Flags None right now" line: no alert, no line. Several
  alerts: one box, one line each.
- **Fields** as label and value pairs in groups with a small heading, two columns, **no boxes**:
  - Employee: *Contract* (Contract type, Position, Start date with the service length, On the
    board from) and *Contact* (Mobile, English name).
  - Mission: *Job* (Customer, Host as a link, Trigo responsible with the phone, Shift and time)
    and *Notes* (PPE, Remark, Highlight).
- **Key numbers** are the only cards: the period tiles of the profile, the four crew tiles of the
  mission. Keep their content and the 30D / 90D / YTD / History range switch.
- **History** under them, unchanged in content: the leave record and the 12-month chart; the crew
  on the day, the crew-per-day chart, the people who have worked on it (as person chips), then a
  short list: First day, Latest day, Last edited.

### 6.2 Edit

- **Edit** turns the same panel into the form: same width, same header (lines 1 and 2, no action
  row), the body replaced by the form. Cancel or Save returns to the read view of the same record.
  A new record opens straight in the form.
- The form uses the same group headings as the read view, two columns, inputs no wider than their
  column (one-column fields only for names and remarks).
- **Footer pinned at the bottom of the panel:** destructive actions as plain red text on the left
  (Employee: Deactivate…; Mission: Delete), Cancel and Save on the right. The employee form's Save
  is mid-page today; it moves here. "Hide" leaves the mission form's footer (it is in More).
- Labels: required fields marked with the red `*` the Thai name has today; optional fields carry
  a muted "optional" after the label. Use this on all forms, including Host's.
- Keep every existing rule of the forms: the unsaved-changes prompt, the mission's "Changes apply
  to <day> only" note, the host and engineer checks, the TRIGO ID rules, focus on the field asked
  for by "+ Add", returning to a half-finished mission after creating a host.

### Done when
- Employee and Mission open at the same width with the same header layout, in read and in edit.
- No field is drawn as a card; the key-number tiles still are.
- With an alert the box shows and its button works; without one there is no Flags line.
- Save and Cancel are pinned at the bottom of both forms at any scroll position and at 390px.
- Everything in `employee-profile`, `employee-start-date`, `english-name`, `trigo-id`,
  `mission-menu`, `mission-highlight`, `missions-tab` still passes, updated only for moved
  elements.
- New checks: the two panels have the same width; the action row has at most three items; the
  form's footer stays in view after scrolling the form to the end.
- Phone: the panels stay full screen with Save pinned, as today.

---

## 7. Batch D: the Host record view

Host has no read view: a row opens the form. Build one with the panel from Batch C.

- **Opens from:** a click or double-click on a Host row, a host link in the Missions table and in
  the mission panel (`openHostFromMission` focuses the row today; it now opens the record), and ⋯
  → Open.
- **Header:** name, status pill; line 2 `Host`, board tag(s), service area; actions **Edit**,
  Open map (when there is a link), More: Archive / Make active, Merge into another host…, Clear
  record.
- **Alert line:** No location (fix: "+ Add location", opens the form on Location); at risk (fix:
  "See who", scrolls to the people list).
- **Fields:** *Site*: Location (the Maps link), Note for the crew, Boards.
- **Key numbers** (cards): Experienced (with "N days or more" from Settings → Host experience),
  People (ever worked there), Days (in all), Last worked.
- **People who worked here:** person chips with their days, most days first, the experienced ones
  outlined; all of them, wrapping (no "+N more" inside the record). A chip opens that person's
  profile for roles that may see it.
- **Missions at this host:** the open missions from the register (number, customer, shift, status
  pill), each opening the mission panel; then a "Closed (N)" line that expands.
- **Edit** opens the existing host form inside the panel (Batch C's form rules and footer). Merge
  and Clear record are reached from More and open the form's existing sections; their behaviour
  does not change.
- Demo: the seed already has hosts with history, one without a location and two at risk. Add
  nothing unless a state above cannot be shown.

### Done when
- A Host row and a host link both open the record; Edit, Save, Cancel return to it.
- The numbers equal the Skills matrix row for the same host (a test compares them).
- A viewer sees the record with no Edit and no More.
- `host-experience-setting.e2e.js` still passes; changing the experienced-days setting changes the
  record's Experienced number.
- README: the Host section describes the record view.

---

## 8. Choices already made (do not reopen)

- Two-line rows; the status over the alert in one cell; one alert shown per row with `+N`.
- Read first, then Edit, in one panel width. No editing in place. No tabs inside the panel.
- No "needs attention" strip above the table and no Alerts column.
- The Status switches leave the tables.
- The phone layout, the Skills matrix, the exports and bulk edit by file are out of scope.

## 9. Where this brief differs from the proposal page

- The page's mock toolbar shows one "need a look" tile. Build section 5.5 instead: the existing
  chips beside the tiles do that job.
- The page's Manpower sample shows "No start date" as an alert. It is not one; the Manpower alerts
  are the three in section 3.
- The page's mock toolbar leaves out the Thai / English switch, the 30D / 90D / YTD switch, the
  board picker and Open / Closed / All. They all stay.
- The page's panel mock is about 440px wide to fit two side by side. The real width is 760px.
