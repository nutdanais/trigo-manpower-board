/* Mission number rules (Missions tab, phase 1 — see design/mission-list-integration.html).

   A mission number is the yearly number Etraq gives a job, PREFIX.YY.NNNN (BANGN.26.0005),
   without the monthly suffix (.AA, .AB…) that stays in the admins' workbook. The prefix is the
   site code: capital letters or digits, starting with a letter, as many as Settings -> Mission numbers
   says (5 until changed: BANGN, AMATA, LCBTH, ESIE1; setPrefixLength).
   At the turn of the year a running mission gets a new number from Etraq (BANGN.26.0005 ->
   BANGN.27.0001), entered by a Site Admin; until then the board keeps running on last year's number.

   Until a Site Admin has registered the job in Etraq, an engineer can start it on a temporary
   number, PREFIX.YY.TMPNNN (BANGN.26.TMP001): the site code they choose, the year, and TMP with
   the next free three digits for that site and year. It can never be an Etraq number (those end
   in four digits), it sorts and searches with the site's real numbers, and it is replaced with
   the Etraq number on every day once that is known (replace_mission_number). A temporary number
   still in use TEMP_ALERT_AFTER_DAYS days after the mission was created is flagged.

   Pure logic, no DOM: shared by the mission form and the New-year numbers list (app.js), Bulk
   edit (bulk-edit.js) and the tests (node). */
(function (root) {
  "use strict";

  /* The site code's length is a shared setting (app_settings 'mission_prefix_length', 2 to 10, 5 until
     changed). Everything below reads it through these, rebuilt by setPrefixLength. */
  const PREFIX_DEFAULT = 5, PREFIX_MIN = 2, PREFIX_MAX = 10;
  let LEN, PREFIX, FORMAT, TEMP, WITH_SUFFIX, PREFIX_ONLY, SITE, EXAMPLE, TEMP_EXAMPLE;
  function setPrefixLength(n) {
    LEN = Number.isInteger(n) && n >= PREFIX_MIN && n <= PREFIX_MAX ? n : PREFIX_DEFAULT;
    PREFIX = "[A-Z][A-Z0-9]{" + (LEN - 1) + "}";
    FORMAT = new RegExp("^" + PREFIX + "\\.[0-9]{2}\\.[0-9]{4}$");
    TEMP = new RegExp("^(" + PREFIX + ")\\.([0-9]{2})\\.TMP([0-9]{3})$");
    WITH_SUFFIX = new RegExp("^(" + PREFIX + "\\.[0-9]{2}\\.[0-9]{4})\\.[A-Z]{2}$");
    PREFIX_ONLY = new RegExp("^" + PREFIX + "$");
    // an example site code of the right length, for messages and placeholders: BANGN at 5, BANG at 4, BANGN1 at 6
    SITE = "BANGN12345".slice(0, LEN);
    EXAMPLE = SITE + ".26.0007";
    TEMP_EXAMPLE = SITE + ".26.TMP001";
    return LEN;
  }
  setPrefixLength(PREFIX_DEFAULT);
  const TEMP_ALERT_AFTER_DAYS = 3;

  /* what the person meant: upper case, no spaces */
  function tidy(s) {
    return String(s == null ? "" : s).normalize("NFC").replace(/\s+/g, "").toUpperCase();
  }

  /* { ok, number, error } for an Etraq number. `number` is the tidied number when ok. */
  function check(s) {
    const n = tidy(s);
    if (!n) return { ok: false, number: "", error: "Type the mission number." };
    if (FORMAT.test(n)) return { ok: true, number: n, error: null };
    const m = n.match(WITH_SUFFIX);
    if (m) return { ok: false, number: n, error: `Leave the monthly suffix off: type ${m[1]}, not ${n}.` };
    if (TEMP.test(n)) return { ok: false, number: n, error: `${n} is a temporary number. Type the number Etraq gave the mission, like ${EXAMPLE}.` };
    return { ok: false, number: n, error: `A mission number looks like ${EXAMPLE}: the ${LEN}-character site code, the year's two digits and four digits.` };
  }

  /* "real": an Etraq number; "temp": a temporary one; "bad": anything else (a typo, extra characters) */
  function kindOf(number) {
    const n = tidy(number);
    return FORMAT.test(n) ? "real" : TEMP.test(n) ? "temp" : "bad";
  }
  const isTemp = (number) => TEMP.test(tidy(number));

  /* the site code a person typed for a temporary number: { ok, prefix, error } */
  function checkPrefix(s) {
    const p = tidy(s);
    if (!p) return { ok: false, prefix: "", error: `Type the site code, like ${SITE}.` };
    if (PREFIX_ONLY.test(p)) return { ok: true, prefix: p, error: null };
    return { ok: false, prefix: p, error: `The site code is ${LEN} capital letters or digits, starting with a letter, like ${SITE}.` };
  }
  /* the site code of any number that starts with one (BANGN for BANGN.26.0005 and BANGN.26.TMP002) */
  function prefixOf(number) {
    const m = tidy(number).match(new RegExp("^(" + PREFIX + ")\\."));
    return m ? m[1] : null;
  }

  /* The next temporary number for a site and year: one more than the highest TMP number that site
     has had that year, in `used` (every number the app knows, the ones already replaced included,
     so a temporary number is never given out twice). date: YYYY-MM-DD, the year it is for. */
  function nextTemp(prefix, date, used) {
    const p = tidy(prefix), yy = String(date).slice(2, 4);
    let max = 0;
    for (const u of used || []) {
      const m = tidy(u).match(TEMP);
      if (m && m[1] === p && m[2] === yy) max = Math.max(max, Number(m[3]));
    }
    if (max >= 999) return null;
    return `${p}.${yy}.TMP${String(max + 1).padStart(3, "0")}`;
  }

  /* whole days from `since` (an ISO timestamp or date) to today (YYYY-MM-DD): 0 on the same day */
  function daysSince(since, today) {
    if (!since) return 0;
    const d = String(since).slice(0, 10);
    const ms = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) - Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
    return Math.max(0, Math.round(ms / 86400000));
  }
  /* a temporary number made on `createdOn` is overdue from the third day after: made on Monday, flagged on Thursday */
  const tempOverdue = (createdOn, today) => daysSince(createdOn, today) >= TEMP_ALERT_AFTER_DAYS;

  /* What a wrong or temporary number may be replaced with: an Etraq number, or (for a wrong one,
     when Etraq has not given one yet) a temporary number. { ok, number, error } */
  function checkReplacement(oldNumber, newNumber, { allowTemp = false } = {}) {
    const n = tidy(newNumber);
    if (allowTemp && TEMP.test(n)) return n === tidy(oldNumber) ? { ok: false, number: n, error: "That is the number it has now." } : { ok: true, number: n, error: null };
    const c = check(newNumber);
    if (c.ok && c.number === tidy(oldNumber)) return { ok: false, number: c.number, error: "That is the number it has now." };
    return c;
  }

  /* 2026 for BANGN.26.0005; null for a number that isn't in the format */
  function yearOf(number) {
    const n = tidy(number);
    return FORMAT.test(n) ? 2000 + Number(n.split(".")[1]) : null;
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

  const api = { tidy, check, kindOf, isTemp, checkPrefix, prefixOf, nextTemp, daysSince, tempOverdue, checkReplacement, setPrefixLength,
    PREFIX_DEFAULT, PREFIX_MIN, PREFIX_MAX, TEMP_ALERT_AFTER_DAYS, yearOf, needsNewYearNumber, daysWaiting, ALERT_AFTER_DAYS, validFrom, checkNewYear,
    SHOW_OLD_DAYS, showsOldNumber, runsInYear };
  // follow the setting: read each time, never copied
  Object.defineProperties(api, {
    prefixLength: { get: () => LEN, enumerable: true },
    EXAMPLE: { get: () => EXAMPLE, enumerable: true },
    TEMP_EXAMPLE: { get: () => TEMP_EXAMPLE, enumerable: true },
    SITE_EXAMPLE: { get: () => SITE, enumerable: true },
  });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MissionNumber = api;
})(typeof window !== "undefined" ? window : globalThis);
