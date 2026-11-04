# Hand-over: Overview phase 2

This document is the brief for building the next set of ideas from
`design/overview-management-proposals.html` (Part 3, numbered cards). A
session should be able to do the work from this document and the code
alone, with no earlier conversation.

The ideas to build: **4, 5, 6, 9, 18, 23, 24 (+ Resigned), 25, 26, 27, 29
(+ year on year), 30, 31, 32 (+ choose sections)**. They are grouped into
four batches below. **One batch = one branch = one pull request.**

---

## 0. The flow (read this first)

1. **Before batch A:** merge PR #98 (Overview phase 1) and PR #99 (the
   proposal and this file) into `main`. Every batch builds on phase 1.
2. **One session per batch, on `main`, Sonnet 5.5 (high effort).** Paste this prompt:

   > Read `design/handover-overview-phase-2.md` and build **Batch A** only.
   > Follow its rules and its "Done when" list, then open a draft PR.

3. **Review in the same session.** Switch the model with `/model` to
   Opus 5.5 (medium effort), then run:

   > `/code-review medium` — then fix what it finds, re-run the tests, and push.

   The reviewer already has the full context, so nothing is copied between
   sessions. If you want fresh eyes instead, start a new Opus session with:
   "Review the open PR for Batch A against `design/handover-overview-phase-2.md`
   with `/code-review medium`, fix what it finds, push."
4. **You:** open the Netlify deploy preview on the PR, try it, and merge it.
   Then start the next batch the same way: B, then C, then D. Batch D's report
   includes the sections from A to C, so it goes last.

Asking questions: when a choice is genuinely open, the session uses the
default written in this document and lists it under "Choices made" in the PR
description. It doesn't stop to ask.

---

## 1. Decisions already made (do not change them)

| Topic | Decision |
|---|---|
| Leave | Annual, sick, business, unpaid. **Exchange Working Day is not leave** anywhere in History or Manpower; it is shown on its own ("N Exchange Working Days · not counted as leave"). Utilization's own rule is unchanged. |
| Leave share | Leave ÷ working days. **Amber above 20 %, red above 30 %**, the same for permanent and on-call (`OV_LEAVE_AMBER`, `OV_LEAVE_RED`). |
| On-call | Everyone on an on-call contract (the dashed **OC** cards), whatever their position. |
| Planned days only | A board-day with no missions ("not planned") is left out of every History figure. Weekends and holidays are left off History's axis. |
| Unit | Person-days, plus the number of different people where it helps. |
| Per-person figures | Names and per-person numbers follow the **Overview History** permission (`can("ov.history")`), in Overview, in Manpower and in exports. Do not add new permission rows. |
| Pages | Light theme only (see `CLAUDE.md`). |

---

## 2. Rules for every batch

**Read `CLAUDE.md` first.** It sets the branch name, the PR title, how to share files and how to share HTML pages.

- **Branch:** `claude/overview-phase-2-<batch letter>-<short topic>`, e.g.
  `claude/overview-phase-2-a-people`. Draft PR, titled after the change.
- **Where the code is:**
  - `app.js`: all UI. History is `historySection`, `historyLeaveView`,
    `historyWorkedLeave`, `historyOncallView`, `engineerHistorySection`,
    `historyEngineerDetail` and `historyWorkloadAlerts`, wired up in `renderOverview`
    (look for `can("ov.history")`).
  - `cloud.js`: data. `getUtilizationRange` gives per-board, per-day records, and
    `getEmployeeUtilization` gives per-person worked and leave dates.
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
- **Tests:** add or extend an end-to-end test in `tests/e2e/` for every item. The model to
  copy is `tests/e2e/history-leave-oncall.e2e.js`: a fixed past week, known numbers,
  English and Thai. Run it like this:

  ```bash
  NODE_PATH=$(npm root -g) node tests/e2e/<file>.e2e.js
  ```

  Run all unit tests (`node tests/<x>.test.js`) and all end-to-end tests before you push.
  **Known failures on `main`:** `language.e2e.js` and `stats-tiles.e2e.js`. Save `main`'s
  `language` output first and make sure yours has **no new lines**.
- **Finish every batch with:** README updated (Overview / Manpower bullets and the test list),
  `node bump-version.js`, screenshots checked at 1400 px and 400 px, and PR description
  sections What / Choices made / Tests.
- Keep copy plain and short, like the rest of the app.

---

## 3. Batch A: People

### Idea 4: Workload spread across inspectors
- **Goal:** see whether work is shared fairly, or a few people carry most of it.
- **Where:** a new Overview section **"Workload spread"** after "Workload alerts", under the History permission.
- **Data:** `historyWorkedLeaveRows(recs)` already gives each person their worked and working days.
  Share worked = worked ÷ working days.
- **UI:**
  - Segmented Permanent / On-call (default Permanent).
  - A histogram of people by share of working days on a mission, 10 % bands.
  - The median, plus "N people at 90 % or more" and "N under 50 %".
  - Lists of the 5 busiest and the 5 least used, with worked / working days.
  - Click a name to open the profile (idea 5).
- **Done when:** the histogram's counts add up to the people listed, the median is right
  on the test week, and the On-call switch works.

### Idea 6: On-call call-in fairness (extends "Most called in")
- **Built already:** "Most called in" in the On-call deployed view.
- **Add:**
  - Include on-call people on the roster who were **never called in** (0 days). Take them
    from `roster` ∩ on-call contract over the plotted days.
  - Show the median, min and max days called in, and a strip or histogram of days per person.
  - A "Never called in this range" line with the names.
  - Sort Most / Least.
- **Done when:** someone on the roster with 0 call-ins appears with 0.

### Idea 9: Night-shift load per person (extends the alert)
- **Built already:** the "Mostly nights" alert, using `OV_NIGHT_MIN` and `OV_NIGHT_SHARE`.
- **Add:**
  - A "Nights per person" table in the Workload spread section. List everyone with at least
    one night: nights, days worked, night share, and a bar.
  - Amber at `OV_NIGHT_SHARE` %.
  - A summary: "N people share the nights; the top 3 worked X % of them".
  - Count calendar days in the range, the same as the alerts.
- **Done when:** the nights add up to the sum of `nightEmp` over the range.

### Idea 5: Employee profile
- **Goal:** one page per person for reviews.
- **Opens from:** every person's name in Overview (Worked vs leave, name lists, alerts,
  spread), plus the Manpower List: a **Profile** item in the row's right-click menu if the
  row has one; otherwise a small Profile button in the Name cell.
  Use a full-screen dialog, the same as the other record dialogs.
- **Content:**
  - Header: name, TRIGO ID, contract, position, area, board (with any loan), start date and
    years of service, status (Active / Inactive / Resigned after Batch B).
  - Period switch: 30D / 90D / YTD / "History range".
  - Figures: worked, leave (by type), standby or not called, Worked : Leave with the
    share pill, nights, weekend and holiday days, longest run of days in a row.
  - A 12-month bar chart of worked vs leave per month.
  - Hosts worked, all time, from `cloud.getEmployeeHostHistory`: days and last date per host.
  - Loans (from `D().loans`), and notes (`employee_notes`, read-only).
- **Data:** extend `getEmployeeUtilization` (or add `getEmployeeDays(employeeId, from, to)`) with
  night dates. That needs `missions.shift`.
- **Permission:** anyone who can view Manpower opens it. The per-person figures (worked,
  leave, ratio, nights) show only with `can("ov.history")`, the same as the Manpower columns.
- **Done when:** the numbers match the Worked vs leave table for the same range, it works on
  a phone, and it reads in Thai.

---

## 4. Batch B: Workforce

### Idea 24 + Resigned: joiners, leavers, headcount trend
**Resigned status (needs a migration):**
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

**Trend section "Joiners and leavers":**
- One bar pair per month: joiners and leavers.
  - Joiners: `start_date` in the month, or `added_on` when there is no start date.
  - Leavers: **Resigned** people whose `deactivated_on` is in the month. People who are only
    inactive are not leavers; count them in a separate muted line.
- A headcount line at each month end, using the roster rule (`rosterOn`).
- Turnover % = leavers ÷ average headcount.
- Window: the **last 12 months** by default, with a switch to "History range". Follows the
  board selector.
- Names on hover.

**Done when:** the migration is idempotent, the app works before it runs, Resigned filters
and exports, and the trend counts match a seeded test.

### Idea 25: On-call reliance trend
- On-call person-days ÷ all person-days on missions (`oncallAssigned / assigned`), per month.
  Use per week when the range is under 3 months.
- Draw one line for the scope, plus small lines per board when "All boards" is selected.
- Also show the on-call share of headcount.
- Add the change against the previous period (reuse `historyDelta`).
- Lives in a new section **"Workforce"** with ideas 24 and 27.

### Idea 27: Experience mix
- Years of service from `start_date`, in buckets: under 1 year, 1–3, 3+, unknown.
- Person-days on missions by bucket over the range, per board (a stacked bar).
- **"Missions with only newcomers":** missions where everyone had under 1 year. Show the
  count and a list (date, board, mission number, host).
  - Needs per-mission crew. Extend `getUtilizationRange` with `missionCrew{missionId: {number, host, ids[]}}`
    for staffed missions, or compute it from the rows it already reads.

### Idea 26: Who can work which host (skills matrix)
- **Where:** the **Host** tab gets a view switch **List | Skills matrix**.
  It has the host filters, and `deployment_history` covers all time.
- **Rows:** hosts, filtered like the Host list.
- **Columns:** people who worked there (days), experienced people (≥ 5 days, a constant),
  last worked, and a risk flag when at most 2 experienced people are **active**.
- Expand a row to see the names with their days and last date. Inactive and Resigned people
  are greyed.
- **Person filter:** pick a person to see their hosts.
- **Excel:** a people × hosts days matrix.

---

## 5. Batch C: Boards and areas

### Idea 18: Service area demand vs supply
- **Demand:** crew per day on missions whose **host's area** (`hosts.area_id`, matched by host
  name) is the area. Hosts with no area go to a "No area" row.
- **Supply:** people on the roster per day with that `employees.area_id`, split permanent / on-call.
- **Table:** area, average demand per day, average supply per day, gap, and
  "covered by other areas" (crew whose own area differs from the host's).
  Also a small chart of demand vs supply per day for the area you pick.
- Needs per-board, per-day crew by host area. Extend `getUtilizationRange` with
  `areaCrew{areaId: {crew, ownArea}}`.

### Idea 23: Loans between boards over time
- From `D().loans`: person-days lent, counted on the receiving board's working days that
  fall inside the range.
- A **from → to matrix**, and per-board monthly bars of lent vs borrowed.
- Shown only when a loan touches the range. History permission.

### Idea 31: Compare boards side by side
- In History, when "All boards" is selected and there is more than one board, add a
  **Compare boards** switch next to the range.
- It replaces the single chart with **one small chart per board** for the picked tile, on
  **one shared y-scale**, each with the board name and its average.
- Click a small chart to set the board selector to that board.
- Leave and on-call use the same small multiples.

---

## 6. Batch D: Reporting

### Idea 29 + year on year
- **Built already:** each History tile against the previous period (`historyDelta`).
- **Add:**
  - A **Compare with: Previous period | Same period last year** switch, remembered on the device.
  - Last year = the same range moved back **364 days**, so weekdays line up.
  - Deltas and tooltips name what they compare with.
  - The day chart shows last year as a dashed grey line (or ghost columns for leave and on-call).
  - A **"This year vs last year, by month"** view for the picked tile: 12 monthly averages,
    two series.
- **Performance:** fetch last year's range only when this is chosen, with its own cache key
  and a loading state. A year of assignments is a lot of rows: use `fetchAllPages`.

### Idea 30: Click a day to open the board
- **Built already** for History's day chart, leave and on-call columns, the calendar and
  the engineer's daily chart (`wireHistoryDayClicks`, `historyOpenDay`).
- **Here:** check that every chart of days added in Batches A–D does the same, with keyboard
  focus and Enter. Add one test per new chart.

### Idea 32: Monthly management report (choose sections)
- **Where:** a **Report** button next to Overview's Export.
- **Dialog:**
  - Period: a month picker, default last month, or "History range".
  - Scope: the board selector.
  - **Checkboxes per section:** summary tiles with deltas; leave and worked vs leave;
    on-call; engineer workload; workload alerts; workload spread and nights; joiners and
    leavers; on-call reliance; experience mix; area demand vs supply; loans; board comparison.
  - An **include names** checkbox, off by default, for printing.
  - Format: **PDF** (the print dialog, the same as the existing Overview PDF export) or **Excel**
    (one sheet per section, built in `xlsx-export.js` in the TRIGO header style).
  - Language EN / TH.
  - All choices remembered on the device.
- **Content:** built from the same functions as the screen, so the numbers can't drift.
  Title: "Manpower report · October 2026 · All boards".
- **Permission:** History. Names only when the checkbox is ticked.
- **Done when:** each checkbox adds or removes its section in both formats, and the Excel
  numbers equal the screen for a seeded month.

---

## 7. Review checklist (for the Opus pass)

`/code-review medium` finds bugs. Also check:

- Numbers on a seeded test match a hand count. Off-by-one at range edges (first and last
  day, month ends, 364-day shift).
- Leave never includes Exchange Working Day. Unplanned board-days and non-working days are
  left out where History leaves them out.
- Per-person figures are hidden without `can("ov.history")`, in the UI and in exports.
- New database columns: migration file, `schema.sql`, and the app still works without them.
- No new English in Thai mode: compare `language.e2e.js` with `main`.
- Phone at 400 px: no sideways page scroll, and dialogs open full screen.
- README, version bump, PR description up to date.
