/* Mission number rules (Missions tab, phase 1 — see design/mission-list-integration.html).

   A mission number is the yearly number Etraq gives a job, PREFIX.YY.NNNN (BANGN.26.0005),
   without the monthly suffix (.AA, .AB…) that stays in the admins' workbook. At the turn of the
   year a running mission gets a new number from Etraq (BANGN.26.0005 -> BANGN.27.0001), entered
   by a Site Admin; until then the board keeps running on last year's number.

   Pure logic, no DOM: shared by the mission form and the New-year numbers list (app.js), Bulk
   edit (bulk-edit.js) and the tests (node). */
(function (root) {
  "use strict";

  const FORMAT = /^[A-Z]{2,10}\.[0-9]{2}\.[0-9]{4}$/;
  const WITH_SUFFIX = /^([A-Z]{2,10}\.[0-9]{2}\.[0-9]{4})\.[A-Z]{2}$/;
  const EXAMPLE = "BANGN.26.0007";

  /* what the person meant: upper case, no spaces */
  function tidy(s) {
    return String(s == null ? "" : s).normalize("NFC").replace(/\s+/g, "").toUpperCase();
  }

  /* { ok, number, error }. `number` is the tidied number when ok. */
  function check(s) {
    const n = tidy(s);
    if (!n) return { ok: false, number: "", error: "Type the mission number." };
    if (FORMAT.test(n)) return { ok: true, number: n, error: null };
    const m = n.match(WITH_SUFFIX);
    if (m) return { ok: false, number: n, error: `Leave the monthly suffix off: type ${m[1]}, not ${n}.` };
    return { ok: false, number: n, error: `A mission number looks like ${EXAMPLE}: the site code, the year's two digits and four digits.` };
  }

  /* 2026 for BANGN.26.0005; null for a number that isn't in the format */
  function yearOf(number) {
    const m = tidy(number).match(/^[A-Z]{2,10}\.([0-9]{2})\.[0-9]{4}$/);
    return m ? 2000 + Number(m[1]) : null;
  }

  /* true when a number from an earlier year is still in use on `today` (YYYY-MM-DD): the
     mission is waiting for its new-year number. Numbers not in the format never wait. */
  function needsNewYearNumber(number, today) {
    const y = yearOf(number);
    return y != null && y < Number(String(today).slice(0, 4));
  }

  /* Days a mission has waited for its new-year number on `today`: 1 January is day 1. The
     alert starts once that is more than a week (ALERT_AFTER_DAYS), i.e. on 8 January. */
  const ALERT_AFTER_DAYS = 7;
  function daysWaiting(today) {
    const y = String(today).slice(0, 4);
    const ms = Date.UTC(+y, +today.slice(5, 7) - 1, +today.slice(8, 10)) - Date.UTC(+y, 0, 1);
    return Math.round(ms / 86400000) + 1;
  }

  /* After a new-year number is entered, the board shows the old one beside it for two weeks
     (the day it was entered and the 13 days after), so every engineer notices the change and
     can still find their mission by the number they know. enteredAt: the ISO timestamp or date
     it was entered; today: YYYY-MM-DD. */
  const SHOW_OLD_DAYS = 14;
  function showsOldNumber(enteredAt, today) {
    if (!enteredAt) return false;
    const d = String(enteredAt).slice(0, 10);
    const ms = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) - Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
    const days = Math.round(ms / 86400000);
    return days >= 0 && days < SHOW_OLD_DAYS;
  }

  /* 1 January of the year a new number belongs to: the day it applies from */
  function validFrom(newNumber) {
    const y = yearOf(newNumber);
    return y == null ? null : y + "-01-01";
  }

  /* Check one new-year number against the old one: format, and a later year. */
  function checkNewYear(oldNumber, newNumber) {
    const c = check(newNumber);
    if (!c.ok) return c;
    const yo = yearOf(oldNumber), yn = yearOf(c.number);
    if (yo != null && yn <= yo) return { ok: false, number: c.number, error: `${c.number} is not a newer year than ${tidy(oldNumber)}.` };
    return c;
  }

  /* true when a Missions-list row runs in the year of `today` (YYYY-MM-DD): what the Missions tab's
     tiles count. An open mission is running, whatever year its number is from, so one still waiting
     for its new-year number in January is counted. A closed one counts when its last working day
     (closedOn, else its last day on a board, else the day it was closed) is in this year; one that
     ended in an earlier year is left out. A closed row with no date at all cannot be placed, so it stays in. */
  function runsInYear(row, today) {
    if (!row || row.status !== "closed") return true;
    const end = row.closedOn || row.lastOn || (row.closedAt ? String(row.closedAt).slice(0, 10) : "") || row.openedOn || "";
    return !end || end >= String(today).slice(0, 4) + "-01-01";
  }

  const api = { tidy, check, yearOf, needsNewYearNumber, daysWaiting, ALERT_AFTER_DAYS, validFrom, checkNewYear, EXAMPLE, SHOW_OLD_DAYS, showsOldNumber, runsInYear };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MissionNumber = api;
})(typeof window !== "undefined" ? window : globalThis);
