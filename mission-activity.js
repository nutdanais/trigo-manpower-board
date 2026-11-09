/* What a mission's recent days say about it (Missions tab): is it on the board now, hidden, or off
   it; how many people it has had on average; and for how many working days in a row nobody has
   been on it. The alert pills on the Missions tab are built from this.

   Pure logic, no DOM and no database: cloud.js reads the days, app.js draws the pills, and the
   tests (node) run it on fake days. Dates are YYYY-MM-DD strings. */
(function (root) {
  "use strict";

  const NO_CREW_ALERT_AFTER = 5;   // "more than 5 working days in a row": from the 6th the pill turns red and suggests closing
  const AVG_DAYS = 28;             // the average crew looks at the last four weeks

  function addDays(s, n) {
    const d = new Date(s + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /* days:    { [date]: { crew, hidden } } for the days this mission (board + number + shift) has a row
     working: that board's working dates, ascending, up to `today` (weekends and holidays left out)
     today:   the day it is now
     Returns
       ref           the latest working day up to today (null when there is none in the window)
       placement     "on" (a visible row on `ref`), "hidden" (a hidden row on `ref`), "off" (no row on `ref`)
       avgCrew       the mean number of people on its visible working days in the last 28 days, or null
       avgDays       how many days that mean covers
       noCrewDays    working days in a row, ending on `ref`, that it was on the board with nobody on it
       noCrewCapped  true when the count reached the start of the window (so it is "at least")
       hiddenDays    working days in a row, ending on `ref`, that it was hidden
       hiddenCapped  true when the count reached the start of the window */
  function summarise({ days, working, today }) {
    const d = days || {};
    const w = (working || []).filter((x) => x <= today);
    const ref = w.length ? w[w.length - 1] : null;
    const out = { ref, placement: "off", avgCrew: null, avgDays: 0, noCrewDays: 0, noCrewCapped: false, hiddenDays: 0, hiddenCapped: false };
    if (!ref) return out;
    const row = d[ref];
    out.placement = !row ? "off" : row.hidden ? "hidden" : "on";

    const since = addDays(today, -(AVG_DAYS - 1));
    let sum = 0, n = 0;
    for (const date of w) {
      const r = d[date];
      if (date < since || !r || r.hidden) continue;
      sum += r.crew; n++;
    }
    if (n) { out.avgCrew = sum / n; out.avgDays = n; }

    // the run of working days ending on `ref`
    for (let i = w.length - 1; i >= 0; i--) {
      const r = d[w[i]];
      if (!r || r.hidden || r.crew > 0) break;
      out.noCrewDays++;
      if (i === 0) out.noCrewCapped = true;
    }
    for (let i = w.length - 1; i >= 0; i--) {
      const r = d[w[i]];
      if (!r || !r.hidden) break;
      out.hiddenDays++;
      if (i === 0) out.hiddenCapped = true;
    }
    return out;
  }

  /* working days from `from` (excluded) up to and including `to`, given a test for a non-working date */
  function workingDaysBetween(from, to, isOff) {
    let n = 0;
    for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (!isOff(d)) n++;
    return n;
  }

  const api = { NO_CREW_ALERT_AFTER, AVG_DAYS, summarise, workingDaysBetween };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MissionActivity = api;
})(typeof window !== "undefined" ? window : globalThis);
