/* The Missions tab's crew facts (mission-activity.js): on the board, hidden or off it, the average
   crew over four weeks, and how many working days in a row nobody was on a mission.
     node --test tests/mission-activity.test.js */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const MA = require("../mission-activity.js");

/* Mon 2 Nov 2026 … Fri 13 Nov 2026, working days only */
const WORKING = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];
const TODAY = "2026-11-13";
const run = (days, extra = {}) => MA.summarise({ days, working: WORKING, today: TODAY, ...extra });
const crew = (entries) => Object.fromEntries(entries.map(([d, crew, hidden]) => [d, { crew, hidden: !!hidden }]));

test("on the board, hidden or off it is read from the latest working day", () => {
  assert.equal(run(crew([["2026-11-13", 3]])).placement, "on");
  assert.equal(run(crew([["2026-11-13", 0, true]])).placement, "hidden");
  assert.equal(run(crew([["2026-11-11", 3]])).placement, "off", "no row on the latest working day");
  assert.equal(run({}).placement, "off");
  // a weekend today looks at Friday
  const weekend = MA.summarise({ days: crew([["2026-11-13", 2]]), working: WORKING, today: "2026-11-15" });
  assert.equal(weekend.ref, "2026-11-13");
  assert.equal(weekend.placement, "on");
  assert.equal(MA.summarise({ days: {}, working: [], today: TODAY }).ref, null);
});

test("the average crew is over the days it was on the board and visible; hidden days and gaps do not count", () => {
  const s = run(crew([["2026-11-09", 4], ["2026-11-10", 5], ["2026-11-11", 0], ["2026-11-12", 3, true], ["2026-11-13", 3]]));
  assert.equal(s.avgDays, 4);
  assert.equal(s.avgCrew, (4 + 5 + 0 + 3) / 4);
  assert.equal(run({}).avgCrew, null);
  // only the last 28 days
  const old = MA.summarise({ days: crew([["2026-09-01", 9], ["2026-11-13", 1]]), working: ["2026-09-01", ...WORKING], today: TODAY });
  assert.equal(old.avgCrew, 1);
});

test("no crew is counted in working days in a row, ending on the latest one", () => {
  const six = run(crew([["2026-11-02", 4], ["2026-11-03", 0], ["2026-11-04", 0], ["2026-11-05", 0], ["2026-11-06", 0], ["2026-11-09", 0], ["2026-11-10", 0],
    ["2026-11-11", 1], ["2026-11-12", 0], ["2026-11-13", 0]]));
  assert.equal(six.noCrewDays, 2, "someone on 11 Nov breaks the run");
  const long = run(crew(WORKING.slice(1).map((d) => [d, 0]).concat([["2026-11-02", 2]])));
  assert.equal(long.noCrewDays, 9);
  assert.equal(long.noCrewCapped, false);
  assert.equal(run(crew([["2026-11-12", 0], ["2026-11-13", 2]])).noCrewDays, 0);
  assert.equal(run(crew([["2026-11-12", 0], ["2026-11-13", 0, true]])).noCrewDays, 0, "hidden is not 'no crew'");
  assert.equal(run(crew([["2026-11-12", 0]])).noCrewDays, 0, "a gap on the latest day is off the board, not no crew");
  // the whole window empty: at least this many
  const all = run(crew(WORKING.map((d) => [d, 0])));
  assert.equal(all.noCrewDays, 10);
  assert.equal(all.noCrewCapped, true);
  assert.ok(MA.NO_CREW_ALERT_AFTER === 5 && all.noCrewDays > MA.NO_CREW_ALERT_AFTER);
});

test("hidden is counted in working days in a row too", () => {
  const s = run(crew([["2026-11-09", 0, true], ["2026-11-10", 0, true], ["2026-11-11", 0, true], ["2026-11-12", 0, true], ["2026-11-13", 0, true]]));
  assert.equal(s.hiddenDays, 5);
  assert.equal(s.hiddenCapped, false);
  assert.equal(run(crew([["2026-11-12", 0, true], ["2026-11-13", 2]])).hiddenDays, 0);
});

test("working days between two dates", () => {
  const sat = (d) => [0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay());
  assert.equal(MA.workingDaysBetween("2026-11-06", "2026-11-13", sat), 5, "Fri to the next Fri: Mon to Fri");
  assert.equal(MA.workingDaysBetween("2026-11-13", "2026-11-13", sat), 0);
});
