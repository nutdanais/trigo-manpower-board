/* The mission number rules (mission-number.js) and Bulk edit for the Missions tab
   (bulk-edit.js planMissions). Fixtures are fake.
     node --test tests/mission-number.test.js */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const MN = require("../mission-number.js");
const B = require("../bulk-edit.js");

test("a mission number is PREFIX.YY.NNNN: tidied, and a suffix is refused with the number to type", () => {
  assert.deepEqual(MN.check(" bangn.26.0007 "), { ok: true, number: "BANGN.26.0007", error: null });
  assert.equal(MN.check("BANGN.26.0007.AB").ok, false);
  assert.match(MN.check("BANGN.26.0007.AB").error, /Leave the monthly suffix off: type BANGN\.26\.0007, not BANGN\.26\.0007\.AB/);
  for (const bad of ["101", "BANGN.2026.0007", "BANGN.26.007", "B.26.0007", "BANGN-26-0007"]) assert.equal(MN.check(bad).ok, false, bad);
  assert.match(MN.check("").error, /Type the mission number/);
});

test("the year of a number, and which numbers are waiting for the new year", () => {
  assert.equal(MN.yearOf("LCBTH.26.0005"), 2026);
  assert.equal(MN.yearOf("101"), null);
  assert.equal(MN.needsNewYearNumber("LCBTH.26.0005", "2027-01-03"), true);
  assert.equal(MN.needsNewYearNumber("LCBTH.27.0001", "2027-01-03"), false);
  assert.equal(MN.needsNewYearNumber("LCBTH.26.0005", "2026-12-31"), false);
  assert.equal(MN.needsNewYearNumber("101", "2027-01-03"), false, "a number not in the form never waits");
});

test("the alert starts once the wait is more than a week: on 8 January", () => {
  assert.equal(MN.daysWaiting("2027-01-01"), 1);
  assert.equal(MN.daysWaiting("2027-01-07"), 7);
  assert.equal(MN.daysWaiting("2027-01-08"), 8);
  assert.equal(MN.daysWaiting("2027-02-01"), 32);
  assert.ok(!(MN.daysWaiting("2027-01-07") > MN.ALERT_AFTER_DAYS));
  assert.ok(MN.daysWaiting("2027-01-08") > MN.ALERT_AFTER_DAYS);
});

test("a new-year number must be a later year, and applies from its 1 January", () => {
  assert.equal(MN.checkNewYear("LCBTH.26.0005", "lcbth.27.0001").ok, true);
  assert.match(MN.checkNewYear("LCBTH.26.0005", "LCBTH.26.0099").error, /not a newer year/);
  assert.equal(MN.checkNewYear("LCBTH.26.0005", "LCBTH.27.0001.AA").ok, false);
  assert.equal(MN.validFrom("LCBTH.27.0001"), "2027-01-01");
});

/* ---------- Bulk edit: missions ---------- */
const ctx = (over = {}) => ({
  register: [
    { id: "r1", boardId: "b1", number: "TSTTH.26.0005", shift: "day", customer: "Cust A", host: "Host Alpha", engineerId: "eng-1", startTime: "08:00", endTime: "17:00", openedOn: "2026-03-02", status: "open", closedOn: null },
    { id: "r2", boardId: "b1", number: "TSTTH.26.0005", shift: "night", customer: "Cust A", host: "Host Alpha", engineerId: "eng-1", startTime: "20:00", endTime: "05:00", openedOn: "2026-03-02", status: "open", closedOn: null },
    { id: "r3", boardId: "b2", number: "TSTTH.26.0009", shift: "day", customer: "Cust B", host: "Host Beta", engineerId: null, startTime: "", endTime: "", openedOn: "2026-05-04", status: "closed", closedOn: "2026-09-30" },
  ],
  boards: [{ id: "b1", name: "Board One" }, { id: "b2", name: "Board Two" }],
  hosts: ["Host Alpha", "Host Beta"],
  engineers: [{ id: "eng-1", label: "Eng One" }, { id: "eng-2", label: "Eng Two" }],
  canReopen: false, canRenumber: false,
  ...over,
});
const H = ["ID", "Board", "Mission number", "Shift", "Customer", "Host", "Trigo responsible", "Status", "Finish date", "New number (next year)"];
const plan = (rows, over) => B.planMissions(B.readTable([H, ...rows], B.MISSION_COLUMNS, { key: "number", keyLabel: "Mission number" }), ctx(over));

test("Bulk edit missions: matched by ID, then board + number + shift; a changed detail is an update", () => {
  const p = plan([
    ["r1", "Board One", "TSTTH.26.0005", "Day", "Cust A2", "Host Alpha", "Eng Two", "Open", "", ""],
    ["", "Board One", "tstth.26.0005", "Night", "Cust A", "Host Alpha", "Eng One", "Open", "", ""],
  ]);
  assert.equal(p.rows[0].kind, "update");
  assert.deepEqual(p.rows[0].patch, { customer: "Cust A2", engineerId: "eng-2" });
  assert.equal(p.rows[1].kind, "same", "matched without its ID");
  assert.equal(p.rows[1].id, "r2");
});

test("Bulk edit missions: a new mission needs a valid number, board, shift, customer and a known host", () => {
  const p = plan([
    ["", "Board Two", "TSTTH.26.0101", "Night", "Cust New", "Host Beta", "", "", "", ""],
    ["", "Board Two", "TSTTH.26.0102.AB", "Day", "Cust New", "Host Beta", "", "", "", ""],
    ["", "Board Two", "TSTTH.26.0103", "Day", "Cust New", "Host Nowhere", "", "", "", ""],
    ["", "", "TSTTH.26.0104", "Day", "Cust New", "Host Beta", "", "", "", ""],
    ["", "Board Two", "TSTTH.26.0005", "Day", "Cust A", "Host Alpha", "", "", "", ""],
  ]);
  assert.equal(p.rows[0].kind, "create");
  assert.deepEqual(p.rows[0].create, { boardId: "b2", number: "TSTTH.26.0101", shift: "night", customer: "Cust New", host: "Host Beta", engineerId: null, startTime: "", endTime: "", openedOn: "" });
  assert.match(p.rows[1].errors.join(), /monthly suffix/);
  assert.match(p.rows[2].errors.join(), /not in the Host list/);
  assert.match(p.rows[3].errors.join(), /needs a Board/);
  assert.equal(p.rows[4].kind, "create", "same mission at another location is allowed…");
  assert.match(p.rows[4].warnings.join(), /already used on Board One/, "…with a warning");
  assert.equal(p.counts.create, 2);
  assert.equal(p.counts.error, 3);
});

test("Bulk edit missions: Closed + Finish date closes; Open reopens only for who may", () => {
  const p = plan([
    ["r1", "Board One", "TSTTH.26.0005", "Day", "Cust A", "Host Alpha", "Eng One", "Closed", "2026-10-30", ""],
    ["r2", "Board One", "TSTTH.26.0005", "Night", "Cust A", "Host Alpha", "Eng One", "Closed", "", ""],
    ["r3", "Board Two", "TSTTH.26.0009", "Day", "Cust B", "Host Beta", "", "Open", "", ""],
  ]);
  assert.deepEqual(p.rows[0].close, { date: "2026-10-30" });
  assert.match(p.rows[1].errors.join(), /give its Finish date/);
  assert.match(p.rows[2].errors.join(), /cannot reopen/);
  const q = plan([["r3", "Board Two", "TSTTH.26.0009", "Day", "Cust B", "Host Beta", "", "Open", "", ""]], { canReopen: true });
  assert.equal(q.rows[0].reopen, true);
  assert.equal(q.counts.reopen, 1);
});

test("Bulk edit missions: the New number column renames a mission (both shifts) for who may", () => {
  const rows = [
    ["r1", "Board One", "TSTTH.26.0005", "Day", "Cust A", "Host Alpha", "Eng One", "Open", "", "TSTTH.27.0001"],
    ["r2", "Board One", "TSTTH.26.0005", "Night", "Cust A", "Host Alpha", "Eng One", "Open", "", "TSTTH.27.0001"],
  ];
  assert.match(plan(rows).rows[0].errors.join(), /cannot enter new mission numbers/);
  const p = plan(rows, { canRenumber: true });
  assert.deepEqual(p.rows[0].renumber, { old: "TSTTH.26.0005", new: "TSTTH.27.0001" });
  assert.deepEqual(p.rows[1].renumber, { old: "TSTTH.26.0005", new: "TSTTH.27.0001" });
  const clash = plan([rows[0], [...rows[1].slice(0, 9), "TSTTH.27.0002"]], { canRenumber: true });
  assert.match(clash.rows[1].errors.join(), /takes one number/);
  const used = plan([[...rows[0].slice(0, 9), "TSTTH.26.0009"]], { canRenumber: true });
  assert.match(used.rows[0].errors.join(), /not a newer year/);
  const changed = plan([["r1", "Board One", "TSTTH.27.0001", "Day", "Cust A", "Host Alpha", "Eng One", "Open", "", ""]]);
  assert.match(changed.rows[0].errors.join(), /New number \(next year\)/, "the Mission number column is the key, not a way to rename");
});

test("the old number shows beside the new one for two weeks from the day it was entered", () => {
  assert.equal(MN.SHOW_OLD_DAYS, 14);
  assert.equal(MN.showsOldNumber("2027-01-05", "2027-01-05"), true, "the day it was entered");
  assert.equal(MN.showsOldNumber("2027-01-05T09:30:00+07:00", "2027-01-18"), true, "the 14th day");
  assert.equal(MN.showsOldNumber("2027-01-05", "2027-01-19"), false, "two weeks later it is gone");
  assert.equal(MN.showsOldNumber("2027-01-05", "2027-01-04"), false);
  assert.equal(MN.showsOldNumber(null, "2027-01-05"), false);
});
