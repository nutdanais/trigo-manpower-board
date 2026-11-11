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

test("the prefix is the 5-character site code: capital letters or digits, starting with a letter", () => {
  for (const good of ["BANGN.26.0001", "AMATA.27.0002", "ESIE1.26.0123", "esie2.26.0001", "LCBTH.26.0005"]) assert.equal(MN.check(good).ok, true, good);
  for (const bad of ["BANG.26.0001", "BANGNA.26.0001", "1BANG.26.0001", "LCB.26.0005", "BANGN.26.0001X", "BANGN..26.0001", "BANGN.26.00012"]) assert.equal(MN.check(bad).ok, false, bad);
  assert.match(MN.check("BANG.26.0001").error, /5-character site code/);
  assert.match(MN.check("BANGN.26.TMP001").error, /is a temporary number/);
});

test("a number is an Etraq one, a temporary one or a wrong one", () => {
  assert.equal(MN.kindOf("BANGN.26.0001"), "real");
  assert.equal(MN.kindOf(" bangn.26.tmp001 "), "temp");
  for (const bad of ["108", "RYGTH.26.104", "BANGN.26.TMP01", "BANGN.26.TEMP01", "BANGN.26.0001.AA", ""]) assert.equal(MN.kindOf(bad), "bad", bad);
  assert.equal(MN.isTemp("BANGN.26.TMP001"), true);
  assert.equal(MN.yearOf("BANGN.26.TMP001"), null, "a temporary number never waits for a new-year number");
  assert.equal(MN.needsNewYearNumber("BANGN.26.TMP001", "2027-01-20"), false);
  assert.equal(MN.prefixOf("ESIE1.26.TMP002"), "ESIE1");
  assert.equal(MN.prefixOf("108"), null);
});

test("the site code for a temporary number", () => {
  assert.deepEqual(MN.checkPrefix(" esie1 "), { ok: true, prefix: "ESIE1", error: null });
  for (const bad of ["", "BANG", "BANGNA", "1BANG", "BAN-G"]) assert.equal(MN.checkPrefix(bad).ok, false, bad);
});

test("the next temporary number: one more than the site's highest that year, never one given out before", () => {
  const used = ["BANGN.26.TMP001", "BANGN.26.TMP004", "BANGN.25.TMP009", "AMATA.26.TMP007", "BANGN.26.0042"];
  assert.equal(MN.nextTemp("bangn", "2026-11-11", used), "BANGN.26.TMP005");
  assert.equal(MN.nextTemp("BANGN", "2027-01-04", used), "BANGN.27.TMP001", "a new year starts again at 001");
  assert.equal(MN.nextTemp("ESIE2", "2026-11-11", []), "ESIE2.26.TMP001");
  assert.equal(MN.nextTemp("BANGN", "2026-11-11", ["BANGN.26.TMP999"]), null, "999 is the last");
});

test("a temporary number is flagged from the third day after the mission was created", () => {
  assert.equal(MN.daysSince("2026-11-08T23:30:00Z", "2026-11-11"), 3);
  assert.equal(MN.daysSince("2026-11-11", "2026-11-11"), 0);
  assert.equal(MN.tempOverdue("2026-11-09", "2026-11-11"), false, "two days: not yet");
  assert.equal(MN.tempOverdue("2026-11-08", "2026-11-11"), true, "made on Sunday, flagged on Wednesday");
  assert.equal(MN.TEMP_ALERT_AFTER_DAYS, 3);
});

test("what a wrong or temporary number may be replaced with", () => {
  assert.equal(MN.checkReplacement("BANGN.26.TMP001", "bangn.26.0042").number, "BANGN.26.0042");
  assert.equal(MN.checkReplacement("BANGN.26.TMP001", "BANGN.26.TMP002").ok, false, "a temporary one takes the Etraq number");
  assert.equal(MN.checkReplacement("108", "BANGN.26.TMP002", { allowTemp: true }).ok, true, "a wrong one may become temporary");
  assert.match(MN.checkReplacement("BANGN.26.0042", "BANGN.26.0042").error, /number it has now/);
  assert.equal(MN.checkReplacement("108", "RYGTH.26.108").ok, false);
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

test("the Missions tiles count a mission that runs this year: every open one, and a closed one by its last working day", () => {
  const T = "2027-01-10";
  // open: running, whatever its number (the weeks before the new-year number is entered) or its last day on a board
  assert.equal(MN.runsInYear({ status: "open", number: "BANGN.26.0005", lastOn: "2026-12-30" }, T), true);
  assert.equal(MN.runsInYear({ status: "open", number: "BANGN.27.0001", lastOn: "2027-01-08" }, T), true);
  // closed last year: left out, from 1 January
  assert.equal(MN.runsInYear({ status: "closed", closedOn: "2026-12-20", lastOn: "2026-12-20" }, T), false);
  assert.equal(MN.runsInYear({ status: "closed", closedOn: "2026-12-31" }, "2027-01-01"), false);
  assert.equal(MN.runsInYear({ status: "closed", closedOn: "2026-12-31" }, "2026-12-31"), true);
  // closed this year, even on last year's number (it ended before its new number was entered)
  assert.equal(MN.runsInYear({ status: "closed", number: "BANGN.26.0005", closedOn: "2027-01-05" }, T), true);
  // no closing day: its last day on a board, then the day it was closed
  assert.equal(MN.runsInYear({ status: "closed", closedOn: null, lastOn: "2026-11-02" }, T), false);
  assert.equal(MN.runsInYear({ status: "closed", closedAt: "2027-01-03T02:00:00Z" }, T), true);
  // nothing to place it by: kept
  assert.equal(MN.runsInYear({ status: "closed" }, T), true);
});

test("the site code length follows Settings -> Mission numbers (5 until changed, 2 to 10)", () => {
  try {
    assert.equal(MN.prefixLength, 5);
    assert.equal(MN.setPrefixLength(4), 4);
    assert.equal(MN.check("BANG.26.0001").ok, true);
    assert.equal(MN.check("BANGN.26.0001").ok, false, "a 5-character code is now wrong");
    assert.equal(MN.kindOf("BANGN.26.0001"), "bad");
    assert.equal(MN.kindOf("BANG.26.TMP001"), "temp");
    assert.equal(MN.yearOf("BANG.27.0001"), 2027);
    assert.equal(MN.EXAMPLE, "BANG.26.0007", "the examples follow it");
    assert.match(MN.check("x").error, /the 4-character site code/);
    assert.match(MN.checkPrefix("BANGN").error, /4 capital letters or digits.*like BANG\./);
    assert.equal(MN.nextTemp("bang", "2026-11-11", ["BANG.26.TMP002"]), "BANG.26.TMP003");
    assert.equal(MN.setPrefixLength(6), 6);
    assert.equal(MN.check("ESIE12.26.0001").ok, true);
    assert.equal(MN.SITE_EXAMPLE, "BANGN1");
    for (const bad of [1, 11, 4.5, "4", null]) assert.equal(MN.setPrefixLength(bad), 5, `${bad} falls back to 5`);
  } finally {
    MN.setPrefixLength(5);
  }
});
