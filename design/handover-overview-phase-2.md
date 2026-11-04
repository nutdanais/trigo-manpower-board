# Hand-over: Overview phase 2 (merged plan)

This document is the brief for the next set of ideas from
`design/overview-management-proposals.html` (Part 3, numbered cards). A
session should be able to do the work from this document and the code
alone, with no earlier conversation.

The ideas to build: **4, 5, 6, 9, 18, 23, 24 (+ Resigned), 25, 26, 27, 29
(+ year on year), 30, 31, 32 (+ choose sections)**.

They are **merged into a few sections and one set of chart controls**,
not built as one section each. Section 3 shows the target structure; build
towards it. The work is cut into four batches. **One batch = one branch = one
pull request.**

---

## 0. The flow (read this first)

1. **One session per batch, on `main`, Sonnet 5.5 (high effort).** Paste this prompt:

   > Read `design/handover-overview-phase-2.md` and build **Batch A** only.
   > Follow its rules and its "Done when" lists, then open a draft PR.

2. **Review in the same session.** Switch the model with `/model` to
   Opus 5.5 (medium effort), then run:

   > `/code-review medium` — then check section 8 of the brief, fix what you find,
   > re-run the tests, and push.

   The reviewer already has the full context, so nothing is copied between
   sessions. If you want fresh eyes instead, start a new Opus session with:
   "Review the open PR for Batch A against `design/handover-overview-phase-2.md`
   with `/code-review medium` and section 8, fix what you find, push."
3. **You:** open the Netlify deploy preview on the PR, try it, and merge it.
   Then start the next batch the same way: **A → B → C → D**. Batch D's report is
   built from the sections of A–C, so it goes last.

Asking questions: when a choice is genuinely open, the session uses the
default written here and lists it under "Choices made" in the PR description.
It doesn't stop to ask.

---

## 1. Decisions already made (do not change them)

| Topic | Decision |
|---|---|
| Leave | Annual, sick, business, unpaid. **Exchange Working Day is not leave** anywhere in History or Manpower; it is shown on its own ("N Exchange Working Days · not counted as leave"). Utilization's own rule is unchanged. |
| Leave share | Leave ÷ working days. **Amber above 20 %, red above 30 %**, the same for permanent and on-call (`OV_LEAVE_AMBER`, `OV_LEAVE_RED`). |
| On-call | Everyone on an on-call contract (the dashed **OC** cards), whatever their position. |
| Planned days only | A board-day with no missions ("not planned") is left out of every History figure. Weekends and holidays are left off History's axis. |
| **One counting rule per person** | Worked, leave and working days per person are counted on **planned working days** of the board they worked on, in History, People, the profile **and the Manpower List**. Batch A aligns Manpower to this. "Days in a row" is the one exception: it counts calendar days, weekends included, and says so. |
| **One "experienced" rule** | A person is experienced at a host after **≥ 5 days** there (`deployment_history`, all time). Host coverage (Overview) and the skills matrix (Host tab) both use it. A host is at risk when at most **2 active** people are experienced there. |
| Unit | Person-days, plus the number of different people where it helps. |
| Per-person figures | Names and per-person numbers follow the **Overview History** permission (`can("ov.history")`), in Overview, in Manpower and in exports. Do not add new permission rows. |
| Pages | Light theme only (see `CLAUDE.md`). |

---

## 2. Rules for every batch

**Read `CLAUDE.md` first.** It sets the branch name, the PR title, how to share files and how to share HTML pages.

- **Branch:** `claude/overview-phase-2-<batch letter>-<short topic>`, e.g.
  `claude/overview-phase-2-a-people`. Draft PR, titled after the change.
- **Where the code is:**
  - `app.js`: all UI. History is `historySection`, `historyControls`, `historyLeaveView`,
    `historyLeaveCalendar`, `historyWorkedLeave` / `historyWorkedLeaveRows`,
    `historyOncallView`, `engineerHistorySection`, `historyEngineerDetail`,
    `historyWorkloadAlerts`, `historyDelta`, `historyOpenDay` and `wireHistoryDayClicks`,
    wired up in `renderOverview` (look for `can("ov.history")`). The Manpower List is
    `ensureEmplistUtilLoaded`, `renderEmployeeRows` and `emplistWlCells`.
  - `cloud.js`: data. `getUtilizationRange` gives per-board, per-day records,
    `getEmployeeUtilization` gives per-person dates, and `getEmployeeHostHistory`
    gives `deployment_history`.
  - `charts.js`: `lineChart`, `columnChart` (stacks, ghost, line, `dates`),
    `sparkline`, `stackedBarH`.
  - `xlsx-export.js`: Excel workbooks.
  - `i18n-th.js`: Thai text.
  - `styles.css`: styles.
- **Data you already have per board and per day** (`getUtilizationRange`):
  - counts: `assigned`, `headcount`, `leave`, `leaveBy{annual,sick,business,unpaid,exchange}`,
    `oncallAssigned`, `oncallHeadcount`, `oncallLeave`, `missions`, `staffedMissions`;
  - who: `roster[]`, `workEmp{}`, `nightEmp{}`, `leaveEmp{id: type}`, `oncallEmp{}`;
  - per engineer, `byEngineer{id: {missions, crew, permCrew, oncallCrew, nightMissions, hosts{}}}`.

  `historyDayRec(date, boards, hist)` adds them up across the boards in scope. History's fetch
  also covers **the period before the range**, which `historyPrevRange()` gives you. Extend these
  records when you need more; don't add a second fetch for the same rows.
- **One component, many uses.** Before writing a new table, chart or drill-in, check
  whether section 3 says to reuse an existing one. Repeating a list that already exists
  is a review finding.
- **Every new chart of days** passes `dates` (so a day can be clicked to open the
  board, see idea 30), has a hover tooltip, works on a phone at 400 px with no sideways
  scroll, and draws on one scale with an average line where that makes sense.
- **Thai:** every new string gets Thai in `i18n-th.js`, in a new `I18N.add({words}, {patterns})`
  block. Three traps:
  1. Patterns (anything with `{a}`) go in the **second** object.
  2. Use `{num}` for a number. A broad `{a}` can swallow a whole joined sentence.
  3. The translator splits text on " · ", sentence ends and **":"**. Avoid colons
     inside labels, or add each piece.

  Check with `I18N.setLang("th")` and read the rendered text.
- **No database change without a migration** in `supabase/`. Name it
  `migration-YYYY-MM-DD-<name>.sql`. It must be safe to re-run, with a header saying
  what it does and why (copy the style of `migration-2026-10-26-deactivated-on.sql`).
  Add the same change to `supabase/schema.sql`. The app must keep working before the
  migration runs: follow `cloud._missingColumnFromError` as `setEmployeesActive` does.
- **Tests:** extend `tests/e2e/history-leave-oncall.e2e.js` (a fixed past week, known numbers,
  English and Thai), or add a file in the same style. Run it like this:

  ```bash
  NODE_PATH=$(npm root -g) node tests/e2e/<file>.e2e.js
  ```

  Run all unit tests (`node tests/<x>.test.js`) and all end-to-end tests before you push.
  **Known failures on `main`:** `language.e2e.js` and `stats-tiles.e2e.js`. Save `main`'s
  `language` output first and make sure yours has **no new lines**. When you move or
  merge a section, update the tests that read the page order (`overview-board-scope.e2e.js`).
- **Finish every batch with:** README updated (Overview / Manpower bullets and the test list),
  `node bump-version.js`, screenshots checked at 1400 px and 400 px, and PR description
  sections What / Choices made / Tests.
- Keep copy plain and short, like the rest of the app.

---

## 3. Target structure (after Batch D)

The Overview's **Period** group, top to bottom:

1. **Period heading:** the range presets and dates, plus **Compare with:
   Previous period | Same period last year**. They apply to every section below. Today
   the range sits inside History; it moves up here in Batch A, and Compare arrives in Batch C.
2. **History:** the six tiles, as today. One **chart toolbar** for every tile:
   - **Group by:** Day · Week · Month;
   - **Boards:** Together · Side by side (one small chart per board);
   - the Leave view keeps **Chart | Calendar** (Calendar only with Day), its type buttons and its by-type table;
   - the On-call view gets **Count | Share**.

   The per-person lists move to People.
3. **People** (new, Batch A): the spread chart, then **one table** of people with flags and
   quick views. It replaces "Worked vs leave" in the Leave view, "Most called in" in the
   On-call view, and the **Workload alerts** section, which is removed. A name opens the
   **profile**.
4. **Engineer workload:** as today, plus "vs previous period" on its tiles.
5. **Workforce** (new, Batch B): one chart of headcount by years of service per month, with
   joiners and leavers.
6. **Boards & areas** (new, Batch C): a period table per board with net loans, a "By service
   area" switch, and the loan from → to table.

Elsewhere:
- **Host tab:** List | **Skills matrix** (Batch B).
- Overview's **Host coverage** card uses the same experienced rule and links to the matrix.
- **Manpower List:** Worked, Leave, Worked : Leave on the same counting rule (Batch A).
- **Report** button: one checkbox per section above (Batch D).

| Idea | Lands in |
|---|---|
| 4 workload spread | People: the spread chart |
| 5 employee profile | Profile dialog, opened from People and Manpower |
| 6 on-call fairness | People: On-call view (never-called flag, median, spread) |
| 9 nights per person | People: Nights view and column |
| 18 area demand vs supply | Boards & areas: By service area |
| 23 loans over time | Boards & areas: net loans column and the from → to table |
| 24 + Resigned | Workforce chart, plus Resigned status in Manpower |
| 25 on-call reliance | History: On-call view, Share, by month |
| 26 skills matrix | Host tab, with the shared rule in Host coverage |
| 27 experience mix | Workforce chart (bands); "missions with only newcomers" is a People alert |
| 29 + year on year | Compare with: Same period last year, and Group by: Month |
| 30 click a day | Every chart of days (a check in Batch D) |
| 31 compare boards | History: Boards side by side; Boards & areas table |
| 32 report | Report button, a checkbox per section |

---

## 4. Batch A: People (+ two fixes to phase 1)

### A0. Fixes and groundwork
1. **Manpower uses History's counting rule.** The Worked, Leave and Worked : Leave columns
   count only **planned** working days: days whose board (the one the person worked on that
   day) has at least one non-hidden mission. Do this in `getEmployeeUtilization` by selecting
   `board_id` for missions and building the set of planned (board, date) pairs, then in
   `ensureEmplistUtilLoaded`. The **utilization** column keeps its own rule; say so in its
   header tooltip.
   **Done when:** the same person and range show the same worked and leave in History's People
   table and in Manpower (test it with a custom History range equal to the Manpower period).
2. **Engineer tiles get "vs previous period"** (reuse `historyDelta`; the previous records are
   in History's fetch already).
3. **Move the range control into the Period heading** (`historyControls` →
   `ovGroupHead("Period", …)`), so it visibly applies to every section. Nothing else changes.

### A1. The People section (ideas 4, 6, 9, plus the lists built in phase 1)
- **Where:** a new section **"People"** after History, under the History permission. It
  **replaces** `historyWorkedLeave` in the Leave view (leave a one-line link there:
  "Per person → People"), "Most called in" in the On-call view (the same kind of link), and
  the **Workload alerts** section (remove it and fold its rules in here).
- **Spread chart (idea 4):** people by share of working days on a mission, in 10 % bands,
  with the median and "N at 90 % or more · N under 50 %". Segmented
  Permanent / On-call (default Permanent). **Click a band to filter the table.**
- **One table, one row per person** (build it on `historyWorkedLeaveRows`, extended):
  - working days, worked, share worked, leave, Worked : Leave and leave share (amber / red);
  - sick days, nights and night share, longest run of days in a row (calendar days, weekends
    included, counted from the period before), and call-ins for on-call staff;
  - **flags:**
    - **7+ in a row** (red from 10, "still going" when it runs to the range end);
    - **mostly nights** (`OV_NIGHT_MIN` nights and at least `OV_NIGHT_SHARE` %);
    - **leave > 30 %**;
    - **never called in** (on-call people on the roster with 0 call-ins);
    - **newcomer-only mission** (idea 27: they were on a mission where everyone had under 1 year).
- **Quick views:** **Workload** · **Leave** · **Nights** · **On-call** · **Alerts only**. Each view
  sets the sort, the columns shown and the filter. On-call view adds a summary: median,
  min–max days called in, and "never called in" names (idea 6). Nights view adds: "N people
  share the nights; the top 3 worked X % of them" (idea 9).
- Everyone / Permanent / On-call filter, sortable columns, 10 rows until "Show all".
- **Done when:**
  - the old lists and the Workload alerts section are gone, with their numbers now in the table;
  - every flag shows on the seeded test;
  - a band click filters;
  - someone on the roster with 0 call-ins shows with 0;
  - the nights total equals the sum of `nightEmp` over the range.

### A2. Employee profile (idea 5)
- **Opens from:** every name in People and the engineer view's lists, and from the Manpower
  List: a **Profile** item in the row's right-click menu if it has one, otherwise a small
  Profile button in the Name cell. Use a full-screen dialog, the same as the other record dialogs.
- **Built on the one-engineer view's layout** (`historyEngineerDetail`: tiles, a chart against
  the average, facts). Factor the shared parts out instead of copying them.
- **Content:**
  - Header: name, TRIGO ID, contract, position, area, board (with any loan), start date and
    years of service, status.
  - Period switch: 30D / 90D / YTD / "History range".
  - Tiles: worked, leave, standby or not called, Worked : Leave with the share pill, nights,
    weekend and holiday days, longest run. Each tile with "vs previous period".
  - A 12-month chart of worked vs leave per month, against the average of their contract type.
  - Flags (the same as in People).
  - Hosts worked, all time, from `getEmployeeHostHistory`: days and last date, with
    "experienced" marked (≥ 5 days).
  - Loans (from `D().loans`), and notes (`employee_notes`, read-only).
- **Data:** add `getEmployeeDays(employeeId, from, to)`, or extend `getEmployeeUtilization`,
  with night dates (needs `missions.shift`), using the same planned-day rule.
- **Permission:** anyone who can view Manpower opens it. The per-person figures show only with
  `can("ov.history")`.
- **Done when:** the numbers match the People row for the same range, it works on a phone, and
  it reads in Thai.

---

## 5. Batch B: Workforce and skills

### B1. Resigned status (part of idea 24; needs a migration)
- **Migration** (`migration-…-employee-exit.sql`):

  ```sql
  employees.exit_reason text null check (exit_reason in ('resigned'))
  ```

  Design it so more reasons can be added later. The leaving date stays `deactivated_on`.
  Reactivating clears `exit_reason`.
- **Deactivating:** Deactivate (single, bulk, the Manpower Status switch and right-click) asks:
  **"Resigned"** or **"Inactive for now"**. Default "Inactive for now".
- **Manpower List:**
  - Status shows a **Resigned** pill, different from Inactive.
  - The Status filter gets **Active / Inactive / Resigned**.
  - The status tiles add Resigned.
  - Excel's Status column says Resigned (Thai: ลาออก).
- **Before the migration runs,** the Resigned option is disabled with a short note naming the
  migration file.

### B2. Workforce section (ideas 24 + 27 in one chart)
- **One chart, one bar per month:**
  - **headcount at month end**, using the roster rule (`rosterOn`), stacked by years of service:
    under 1 year · 1–3 · 3+ · unknown, from `start_date`;
  - **joiners** above the bar and **leavers** below it (or as markers):
    - joiners: `start_date` in the month, or `added_on` when there is no start date;
    - leavers: **Resigned** people whose `deactivated_on` is in the month.

    People who are only inactive are not leavers; show them as a muted line.
- **Tiles above it:** headcount now (with change), joiners, leavers, turnover %
  (leavers ÷ average headcount), and the share under 1 year.
- **Window:** the **last 12 months** by default, with a switch to "History range". Follows the
  board selector. Names on hover.
- **Done when:** the migration is idempotent and the app works before it runs, Resigned filters
  and exports, and the bars and markers match a seeded test.

### B3. Skills matrix (idea 26) and the shared Host coverage rule
- **Host tab:** a view switch **List | Skills matrix**.
  - **Rows:** hosts, filtered like the Host list.
  - **Columns:** people who worked there (days), **experienced** people (≥ 5 days), last worked,
    and **At risk** when at most 2 experienced people are **active**.
  - Expand a row to see the names with their days and last date. Inactive and Resigned people
    are greyed.
  - **Person filter:** pick a person to see their hosts.
  - **Excel:** a people × hosts days matrix.
- **Overview Host coverage:** switch its rule to the same "experienced, active" rule (one
  shared function), and add a "See all hosts" link that opens the matrix.
- **Done when:** the card and the matrix agree on which of today's hosts are at risk.

---

## 6. Batch C: History chart controls and Boards & areas

### C1. One chart toolbar in History (ideas 25, 29, 31)
- **Group by: Day · Week · Month.** Every tile and every view (chart, leave columns, on-call
  columns), using the engineer view's bucketing. The Calendar is offered only with Day.
- **Compare with: Previous period | Same period last year**, in the Period heading (idea 29):
  - Last year = the same range moved back **364 days**, so weekdays line up.
  - Tile deltas, the People and engineer deltas, and every tooltip name what they compare with.
  - The chart shows the comparison as a dashed grey line (ghost columns for leave and on-call).
  - With **Group by: Month**, this *is* the "this year vs last year by month" chart.
  - Fetch last year's range only when it's chosen, with its own cache key and a loading state.
    A year of assignments is a lot of rows: use `fetchAllPages`.
- **Boards: Together · Side by side** (idea 31). Shown when "All boards" is selected and there
  is more than one board. One small chart per board for the picked tile, on **one shared
  y-scale**, each with the board's name and average. Click one to set the board selector.
- **On-call view: Count · Share** (idea 25). Share = on-call person-days ÷ all person-days on
  missions. Use it with Month for the reliance trend, and with Side by side for per board.
- **Done when:** each control works on every tile, the year-on-year numbers match a seeded year,
  and nothing is fetched until it's needed.

### C2. Boards & areas section (ideas 18, 23)
- **By board (default):** one row per board over the range: utilization, deployed / day,
  standby / day, leave / day, on-call share, and **net loans** (person-days borrowed − lent,
  counted on the receiving board's working days in the range). It's the period version of the
  summary's "By board". A row sets the board selector.
- **By service area** (idea 18):
  - Demand = crew per day on missions whose **host's area** (`hosts.area_id`, matched by host
    name) is the area. Hosts with no area go to a "No area" row.
  - Supply = people on the roster with that area, split permanent / on-call.
  - Columns: average demand, average supply, gap, and "covered by other areas".
  - Needs `areaCrew{areaId: {crew, ownArea}}` added to `getUtilizationRange`.
- **Loans** (idea 23): an expandable **from → to** table of person-days, shown when a loan
  touches the range.

---

## 7. Batch D: Report and the click-through check

### D1. Monthly management report (idea 32)
- **Where:** a **Report** button next to Overview's Export.
- **Dialog:**
  - Period: a month picker, default last month, or "History range".
  - Compare with: the Period heading's choice.
  - Scope: the board selector.
  - **One checkbox per section:** Summary (tiles with deltas) · History (pick which tiles;
    include charts) · People (with an **include names** checkbox, off by default) ·
    Engineer workload · Workforce · Boards & areas · Skills risks (at-risk hosts).
  - Format: **PDF** (the print dialog, the same as the existing Overview PDF export) or **Excel**
    (one sheet per section, built in `xlsx-export.js` in the TRIGO header style).
  - Language EN / TH.
  - All choices remembered on the device.
- **Content:** built from the same functions as the screen, so the numbers can't drift.
  Title: "Manpower report · October 2026 · All boards".
- **Permission:** History. Names only when ticked.
- **Done when:** each checkbox adds or removes its section in both formats, and the Excel
  numbers equal the screen for a seeded month.

### D2. Click a day, everywhere (idea 30)
Check that every chart of days from A–C opens the board on that day
(`wireHistoryDayClicks`), with keyboard focus and Enter, and add a test for each. A week or
month column opens its first day.

---

## 8. Review checklist (for the Opus pass)

`/code-review medium` finds bugs. Also check:

- **No duplicates:** no new per-person list outside People, no second copy of a drill-in layout,
  and no second "experienced" or counting rule. Check against section 3.
- Numbers on a seeded test match a hand count. Off-by-one at range edges (first and last
  day, month ends, the 364-day shift).
- Leave never includes Exchange Working Day. Unplanned board-days and non-working days are
  left out where History leaves them out. History, People, the profile and Manpower agree for
  the same person and range.
- Per-person figures are hidden without `can("ov.history")`, in the UI and in exports.
- New database columns: migration file, `schema.sql`, and the app still works without them.
- No new English in Thai mode: compare `language.e2e.js` with `main`.
- Phone at 400 px: no sideways page scroll, and dialogs open full screen.
- README, version bump, PR description up to date.
