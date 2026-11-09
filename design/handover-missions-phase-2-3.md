# Hand-over: Missions module, after phase 1

This is the brief for the Missions work still to do after phase 1 (merged in PR #106,
release 2026-11-09c). A session should be able to do each batch from this document and the
code alone, with no earlier conversation.

The work is cut into **three batches**. **One batch = one branch = one pull request.** Do them
in this order: **A → B → C**. Batch C has open questions for the admin team; do not start it
until they are answered (section 6).

| Batch | What | Size |
|---|---|---|
| A | Edit Mission asks "This day only / From this day on" (decision D2) | small |
| B | Phase 2: the job details (17 columns, engineer input) | large |
| C | Phase 3: admin and invoicing (14 columns), the monthly suffix if wanted, the workbook import and export | large, needs answers first |

---

## 0. The flow (read this first)

1. **One session per batch, starting from `main`.** Paste this prompt:

   > Read `design/handover-missions-phase-2-3.md` and build **Batch A** only.
   > Follow its rules and its "Done when" list, then open a draft PR.

2. **Review in the same session**: `/code-review medium`, fix what it finds, re-run the tests, push.
3. **You** open the Netlify deploy preview with `/?demo`, try it, and merge.

When a choice is genuinely open, the session uses the default written here and lists it under
"Choices made" in the PR description. It asks the user only when this brief says to.

---

## 1. Where phase 1 left things

Read these first:

- `README.md` → **📋 Missions tab** (the user-facing behaviour, in full).
- `design/mission-list-integration.html` → the admins' Mission List workbook review, the 41-column
  guide marked P1 / P2 / P3, the team's remarks, and the Phase 1 section.
  Rendered: https://claude.ai/artifact/FgoWqnxdzAYHburRML9Pj2
- `design/mission-register-proposal.html` → the register idea and decisions D1–D5, Q1–Q5.
  Rendered: https://claude.ai/artifact/3kas2xib4WMjUG8rEuR9Uc

What exists:

| Piece | Where |
|---|---|
| `mission_register` (one row per board + number + shift; status open / closed; opened_on, last_on, closed_*, source 'board' / 'list'; the latest day's host, customer, times, engineer, PPE, remark) | `supabase/migration-2026-11-09-mission-register.sql`, also in `schema.sql` |
| Triggers on `missions`: `sync_mission_register` (after insert / update), `skip_closed_mission` (before insert), `forget_unused_mission` (after delete) | same file |
| `mission_number_history` (old_number → new_number, valid_from, entered_by, entered_at) | same file |
| RPCs `close_mission`, `reopen_mission`, `renumber_missions` (security definer, check `can()`) | same file |
| Role `siteadmin` (rank 35); areas `missions` (Engineer and up, Site Admin; view for Viewer) and `missionadmin` (Manager, Admin, Site Admin) | same file |
| The rules for a mission number (PREFIX.YY.NNNN, suffix refused, new-year check, alert from 8 January, the old number shown for 14 days) | `mission-number.js` |
| cloud side: `loadMissionRegister`, `registerFor`, `isClosedOn`, `closeMission`, `reopenMission`, `renumberMissions`, `addMissionsFromRegister`, `applyMissionImport`, `previousNumber`, `numberChain`, `recentOldNumber`; carry over skips closed missions in `_carrySource` | `cloud.js` |
| Missions tab (`MISSIONS_ID`, `renderMissionList`, `missionRows`, Close / Reopen / Add to board, New-year numbers, `checkMissionNumberUse`) | `app.js` |
| Bulk edit for missions (`MISSION_COLUMNS`, `planMissions`, `missionTable`) | `bulk-edit.js` |
| The fake backend (tests and `/?demo`): register triggers, RPCs, `_can` | `demo/fake-db.js` |
| Demo examples: Site Admin sample account (`?demo&role=siteadmin`), closed mission Chonburi 209, renumbered Ayutthaya AYTTH.YY.0302 | `demo/seed.js`, `demo/demo.js` |
| Tests | `tests/sql/mission-register.test.sh`, `tests/mission-number.test.js`, `tests/e2e/missions-tab.e2e.js`, `tests/e2e/demo-mode.e2e.js` |

Decisions already made (do not reopen them):

- **No Customer list** in the app: Etraq controls customer codes. The customer is the company name typed as today.
- **No monthly suffix and no monthly routine in phase 1.** The suffix (.AA, .AB…) stays in the admins' workbook.
- **Numbers are unique company-wide**, except one mission running on several boards (same number on two boards = the same mission). Day and Night of one mission share a number.
- **Number format** `PREFIX.YY.NNNN`, validated. Numbers come from Etraq (Finance / ERP / customer); the app never suggests one.
- **Etraq** is the name everyone knows; write "Etraq", never "ERP".
- **Engineers can also enter** Customer contact, Host contact and the Work Instruction status / Rev. (team remarks).
- Close is for Engineer and up; Reopen and new-year numbers for Site Admin, Manager and Admin.

---

## 2. Rules for every batch

- Work with the existing stack: plain JS, no build step, no new libraries. `app.js` is large; keep new code in clearly named functions next to the Missions tab code.
- **A database change is a new migration** `supabase/migration-YYYY-MM-DD-<name>.sql`, safe to re-run, also copied into `schema.sql` (as phase 1 did, before "Seed data"). Until it has run, the app must work as before: probe the new table / column in `cloud._loadFeatures` and hide the feature.
- **Test it against Postgres**: a `tests/sql/<name>.test.sh` like `tests/sql/mission-register.test.sh` (start Postgres with `service postgresql start`; `PGHOST=/var/run/postgresql`).
- **Keep the demo working** (CLAUDE.md): imitate every new table, column, RPC and trigger in `demo/fake-db.js`, add examples to `demo/seed.js`, and run `node tests/e2e/demo-mode.e2e.js`. In the PR, link `<deploy-preview>/?demo` and say what the demo does not prove (real SQL and migration, row-level security, live sync, real data).
- **Thai for every new string** in `i18n-th.js`. A string with a number or a name in it is a pattern: it goes in the **second** object of `I18N.add({...}, {...})`.
- Permissions: one `can()` area per thing a role may or may not do; enforce it in the database (RLS or a security-definer RPC), not only in the UI.
- Run all tests before the PR: `node --test tests/*.test.js`, every `tests/e2e/*.e2e.js` (`NODE_PATH=$(npm root -g)`), and the `tests/sql` scripts you touched. Then `node bump-version.js`.
- Light-mode HTML for any design page; publish it as an Artifact and commit it under `design/` (CLAUDE.md).

---

## 3. Batch A: "This day only / From this day on" (decision D2)

Today the register follows the **latest** day's details (the `sync_mission_register` trigger). An
engineer covering for one day, edited on that day's card, quietly becomes the register's engineer
if that day is the latest one.

Build: when Edit Mission changes the host, customer, shift times, engineer, PPE or remark of a
mission that has later days already planned, or that is the latest day, Save asks:

- **This day only**: save the day; the register keeps its details (the trigger must not copy them).
- **From this day on**: save this day **and every later day already planned** for the same board + number + shift (confirmed and forecast), and the register.

Default (no question) when nothing that the register holds changed, or on a forecast date.

Suggested design: a column `missions.detail_scope` is not needed. Instead add an RPC
`update_mission_from(p_mission_id, p_fields jsonb, p_scope text)` that updates the days and sets
the register explicitly, and make the trigger skip the detail copy when a session flag
(`set_config('app.register_keep','on',true)`) is set. Mirror it in `demo/fake-db.js`.

**Done when**
- Both choices work on a confirmed day; locked later days are not changed (say which were skipped).
- Carry over after "This day only" brings the register's details, not the one-off.
- SQL test, unit or e2e test, demo, Thai, README (Missions tab section) updated.

---

## 4. Batch B: phase 2, the job details (17 columns)

The columns (letters are the workbook's; full evidence per column is in the guide on
`design/mission-list-integration.html`):

| Col | Column | Entry | Owner | Notes |
|---|---|---|---|---|
| E | Customer code | typed, checked: 6 digits or `P` + 9 digits | Admin | no Customer list (team decision) |
| J | Prescriber | typed, defaults to the customer | Engineer | |
| G | Part number | a list: one part per line, each with an optional note | Engineer | cells held several parts and notes |
| H | Part name | text beside each part | Engineer | |
| I | Problem / activity description | long text | Engineer | |
| K | Defect category | dropdown (Settings list, 60 items) | Engineer | only 47 / 338 filled: optional |
| L | System | dropdown (Settings list) | Engineer | |
| M | Sub-system | dropdown that depends on System | Engineer | 70 System / Sub-system pairs |
| N | Mission type | dropdown, default "INSPECTION - corrective sorting & basic rework / containment" | Engineer | same value in 333 / 338 |
| P | Type of operation | dropdown: Sort, Rework, Sort & Rework, Other (Reflash counts as Rework) | Engineer | |
| O | Breakpoint | quantity + unit, or TBC | Engineer | 179 / 338 were TBC |
| Z | Agreed pace (pcs/hr) | number or N/A; allow one per part | Engineer | some cells held two paces |
| AA | Wished pace (pcs/hr) | same | Engineer | |
| AB | Customer contact | names + emails on the mission | Engineer or Admin | carried to the next year with the mission |
| AC | Host contact | names + emails on the Host list record | Engineer or Admin | shared by every mission at the host |
| X | Work Instruction status | dropdown, default Received | Engineer or Admin | |
| Y | Work Instruction Rev. | dropdown, default Rev.00 | Engineer or Admin | |

Suggested design (defaults; list them under "Choices made"):

- **Storage**: columns on `mission_register` (one set per board + number + shift), except Host contact on `hosts`. The lookup lists in one table `mission_lists (kind, value, parent, sort, active)` (kind = defect / system / subsystem / mission_type / operation / wi_status / wi_rev), edited in **Settings → Mission lists** (Admin, Manager). Seed it from the workbook's own lists (the category sheets; their values are in the workbook, ask the user for the file again if needed: it is not in the repo).
- **Where they are edited**: a click on a row of the Missions tab opens a side panel (like Edit Employee) with the phase 1 fields read-only and the job details editable. Keep it out of the board's mission form, which stays short for planners.
- **Bulk edit**: add the columns to `MISSION_COLUMNS`, with dropdowns from the lists.
- **Permissions**: the `missions` area (edit) covers these fields.

**Done when**
- Every column can be entered in the side panel and in Bulk edit, with the lists from Settings.
- The Missions tab can show the main ones (customer code, part, type of operation) as optional columns.
- Migration + SQL test, fake-db + demo examples, Thai, README, e2e test.

---

## 5. Batch C: phase 3, admin and invoicing (do not start before section 6 is answered)

| Col | Column | Entry | Notes |
|---|---|---|---|
| D | DATA ENTRY (IN USED / UNUSED) | ask | meaning unclear: the Rule sheet calls it "Customer Type" |
| V | MO/PO/QT status | dropdown Received / Waiting | per suffix or per mission? |
| W | MO/PO/QT type | dropdown MO, QT, Cost estimate, PO | |
| AK | Document sent to finance | tick boxes (MO signed, PO, QT, Cost estimate) | |
| AN | PO status | dropdown Normal method / PO needed | |
| AO | PO number | text; "Waiting PO" is a state with a reminder | changes on most suffix changes |
| AE | Rate for customer | amount + currency (THB, USD, EUR, CNY, RMB) | **restricted** |
| AF | Invoicing type | Hourly, Piece price, Credit hours, Not to be invoiced | |
| AG | Rate / price | rate lines (role, amount, unit) | **restricted** |
| AH | Management fee / day | dropdown | |
| AI | Transportation and additional cost | text | |
| AJ | Rate profile in Etraq | dropdown | |
| AL | Risk analysis | default "Yes: 1 audit per shift per day" | same in 338 / 338 |
| AM | Remark | a notes log per mission; "URGENT INV CASE" / "INV process follow customer schedule" become an Invoice timing dropdown | |
| A, U + the suffix | Month, Continue / Close at month end, the monthly suffix | only if the team wants the suffix in the app | see section 6 |

Design constraints:

- **Rates and contacts must not be readable by every role.** RLS hides rows, not columns, so put
  the commercial fields in their own table (`mission_commercial`, one row per register row) with a
  read policy on a new area `missioncommercial` (Admin, Manager, Site Admin).
- If the suffix comes in: suffix **periods** under a mission (suffix, start, end, PO number,
  created-in-Etraq tick), a monthly routine screen (design: `design/mission-list-integration.html`,
  "Monthly suffix"), and the January run asking for the new-year numbers (reuse `renumber_missions`).
- **The one-off import** of the admins' workbook (group the rows into missions, rows → suffix
  periods, "last year" numbers → `mission_number_history`) with a preview before anything is saved,
  and an **Export in the workbook's column order** for the Etraq double-check.

**Done when**: decided with the user from the answers in section 6.

---

## 6. Questions for the admin team (answer before Batch C)

From the meeting checklist on `design/mission-list-integration.html`:

1. What starts a new suffix: the month only, or also a new PO, breakpoint or rate? (24 times in 2026 a mission got two suffixes in one month; 11 of them changed nothing else.)
2. Does the ERP side (Etraq) need a suffix for every month a mission is open? (5 missions skipped a month.)
3. Which number does the crew see: with suffix or without?
4. What does DATA ENTRY (IN USED / UNUSED) mean?
5. Which columns change per suffix: PO number, breakpoint, MO/PO/QT status, documents?
6. Who may see rates and contacts? (Suggested: Admin, Manager, Site Admin.)
7. Who keeps the lookup lists up to date in Settings?
8. The import: when, and which month to run side by side before the workbook is retired?
9. Export layout: the same column order as today? Thai or English headers?

Note: the admins' workbook (`2026_BANGN_Mission_List_*.xlsx`) holds customer names, contacts and
rates. It is not in the repo and must not be committed; ask the user to upload it again when a batch
needs it, and keep anything derived from it out of design pages (counts only, as phase 1 did).
