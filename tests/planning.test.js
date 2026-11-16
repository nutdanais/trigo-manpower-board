// node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { PlanDiff, Horizon, PlanStatus, Capacity, Sandbox } = require("../planning.js");

const zones = (o = {}) => ({ annual: [], sick: [], business: [], unpaid: [], exchange: [], ...o });
const mission = (number, members, extra = {}) => ({
  id: "id-" + number + (extra.shift || "day"), number, shift: "day", host: "Host A", customer: "Cust A",
  startTime: "08:00", endTime: "17:00", engineerId: "eng1", ppe: "", remark: "", hidden: false, members, ...extra,
});

test("Part A acceptance 2: one move + one deletion on the source day show up as exactly those two items", () => {
  // Tue as carried: p1 in M1, p2 in M2, p3 in M3
  const base = { missions: [mission("M1", ["p1"]), mission("M2", ["p2"]), mission("M3", ["p3"])], zones: zones() };
  // Mon since: p1 moved to M2, p3's assignment deleted (standby)
  const proposed = { missions: [mission("M1", []), mission("M2", ["p1", "p2"]), mission("M3", [])], zones: zones() };
  const d = PlanDiff.compute(base, proposed, { employeeIds: ["p1", "p2", "p3"] });
  assert.deepEqual(d.items.map((i) => [i.type, i.empId, i.from.kind === "mission" ? i.from.key : i.from.kind, i.to.kind === "mission" ? i.to.key : i.to.kind]).sort(),
    [["move", "p1", "M1|day", "M2|day"], ["move", "p3", "M3|day", "standby"]]);
  assert.ok(d.items.every((i) => i.ticked === false), "moves default to unticked");
});

test("identical plans produce no items", () => {
  const p = { missions: [mission("M1", ["p1"])], zones: zones({ sick: ["p2"] }) };
  assert.equal(PlanDiff.compute(p, JSON.parse(JSON.stringify(p))).items.length, 0);
});

test("add / update / remove / leave defaults follow the brief", () => {
  const base = { missions: [mission("M1", ["p1"]), mission("OLD", ["p4"])], zones: zones() };
  const proposed = {
    missions: [mission("M1", ["p1"], { host: "Host B", startTime: "07:00" }), mission("NEW", ["p2", "p4"])],
    zones: zones({ annual: ["p3"] }),
  };
  const d = PlanDiff.compute(base, proposed, { employeeIds: ["p1", "p2", "p3", "p4"] });
  const byType = Object.fromEntries(d.items.map((i) => [i.type + (i.empId ? ":" + i.empId : ""), i]));
  assert.equal(byType.add.ticked, true);
  assert.deepEqual(byType.add.members.map((m) => m.empId).sort(), ["p2", "p4"], "members of an added mission ride with it, not as separate moves");
  assert.equal(byType.update.ticked, false);
  assert.deepEqual(byType.update.changes.map((c) => c.field), ["host", "startTime"]);
  assert.equal(byType.remove.ticked, false);
  assert.equal(byType["leave:p3"].ticked, true);
  assert.equal(Object.keys(byType).length, 4);
});

test("employees outside the scope are ignored on both sides", () => {
  const base = { missions: [mission("M1", ["gone"])], zones: zones() };
  const proposed = { missions: [mission("M1", [])], zones: zones() };
  assert.equal(PlanDiff.compute(base, proposed, { employeeIds: ["p1"] }).items.length, 0);
});

test("hidden missions: never added or removed; unhiding shows as an update", () => {
  const base = { missions: [mission("H1", [], { hidden: true }), mission("H2", [], { hidden: true })], zones: zones() };
  const proposed = { missions: [mission("H1", []), mission("H3", [], { hidden: true })], zones: zones() };
  const d = PlanDiff.compute(base, proposed);
  assert.deepEqual(d.items.map((i) => i.id), ["update:H1|day"]);
  assert.deepEqual(d.items[0].changes.map((c) => c.field), ["hidden"]);
});

test("day and night shifts of one number are two missions", () => {
  const base = { missions: [mission("M1", [])], zones: zones() };
  const proposed = { missions: [mission("M1", []), mission("M1", [], { shift: "night" })], zones: zones() };
  assert.deepEqual(PlanDiff.compute(base, proposed).items.map((i) => i.id), ["add:M1|night"]);
});

test("groups put an item under where the person is going; plan orders writes", () => {
  const base = { missions: [mission("M2", ["p1"]), mission("M10", [])], zones: zones() };
  const proposed = { missions: [mission("M2", []), mission("M10", ["p1"])], zones: zones({ sick: ["p2"] }) };
  const d = PlanDiff.compute(base, proposed, { employeeIds: ["p1", "p2"] });
  const g = PlanDiff.groups(d);
  assert.deepEqual(g.map((x) => x.id), ["m:M10|day", "z:leave"]);
  d.items.forEach((i) => { i.ticked = true; });
  const p = PlanDiff.plan(d);
  assert.equal(p.count, 2);
  assert.equal(p.placements.length, 2);
});

test("horizon: next working day, per board", () => {
  const weekend = (d) => [0, 6].includes(new Date(d + "T00:00:00").getDay());
  assert.equal(Horizon.end("2026-09-23", weekend), "2026-09-24");  // Wed -> Thu
  assert.equal(Horizon.end("2026-09-25", weekend), "2026-09-28");  // Fri -> Mon
  const holidayMon = (d) => weekend(d) || d === "2026-09-28";
  assert.equal(Horizon.end("2026-09-25", holidayMon), "2026-09-29");
  const sixDay = (d) => new Date(d + "T00:00:00").getDay() === 0;   // board working Saturdays
  assert.equal(Horizon.end("2026-09-25", sixDay), "2026-09-26");
});

test("capacity: available = active roster minus leave; named from the right source per date", () => {
  const employees = [
    { id: "a", boardId: "B", contract: "permanent" },
    { id: "b", boardId: "B", contract: "permanent" },
    { id: "c", boardId: "B", contract: "oncall" },
    { id: "x", boardId: "B", contract: "permanent", active: false },
  ];
  const dates = ["2026-09-24", "2026-09-25"];
  const isForecast = (_b, d) => d > "2026-09-24";
  const agg = Capacity.aggregate({
    boards: [{ id: "B" }], employees, dates, isForecast,
    confirmed: {
      assignments: [
        { employee_id: "a", plan_date: "2026-09-24", zone: "annual" },
        { employee_id: "b", plan_date: "2026-09-24", mission_id: "m1" },
        { employee_id: "b", plan_date: "2026-09-25", zone: "sick" },   // beyond horizon: ignored
      ],
      missions: [{ id: "m1", board_id: "B", hidden: false }],
    },
    forecast: {
      assignments: [
        { employee_id: "c", plan_date: "2026-09-25", zone: "business" },
        { employee_id: "a", plan_date: "2026-09-25", forecast_mission_id: "f1" },
        { employee_id: "a", plan_date: "2026-09-24", zone: "sick" },   // within horizon: ignored
      ],
      missions: [{ id: "f1", board_id: "B" }],
    },
  });
  assert.deepEqual(agg.B["2026-09-24"], { headPerm: 2, headOncall: 1, leavePerm: 1, leaveOncall: 0, availPerm: 1, availOncall: 1, available: 2, named: 1 });
  assert.deepEqual(agg.B["2026-09-25"], { headPerm: 2, headOncall: 1, leavePerm: 0, leaveOncall: 1, availPerm: 2, availOncall: 0, available: 2, named: 1 });
});

test("capacity: demand totals and fill-right dates", () => {
  assert.deepEqual(Capacity.demandTotals([
    { board_id: "B", plan_date: "2026-09-24", headcount: 12 },
    { board_id: "B", plan_date: "2026-09-24", headcount: 8 },
  ]), { B: { "2026-09-24": 20 } });
  const grid = ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"];
  const working = (d) => ![0, 6].includes(new Date(d + "T00:00:00").getDay());
  assert.deepEqual(Capacity.fillRightDates("2026-09-23", grid, working), ["2026-09-24", "2026-09-25"]);
  assert.equal(Capacity.weekStart("2026-09-27"), "2026-09-21");
  assert.equal(Capacity.weekEnd("2026-09-21"), "2026-09-27");
});

/* ----- Sandbox: the Capacity tab's private what-if ----- */
const SBX_DATES = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"];   // Mon..Fri
const sbxInputs = () => {
  const cm = (id, date, number, extra = {}) => ({ id, board_id: "b1", plan_date: date, number, shift: "day", host: "Host A", customer: "Cust A", hidden: false, ...extra });
  const on = (missionField, id, date, emps) => emps.map((e) => ({ employee_id: e, plan_date: date, [missionField]: id }));
  return {
    boardId: "b1", dates: SBX_DATES, isForecast: (d) => d > "2026-09-22",
    activeIds: new Set(["a", "b", "c", "d", "e", "f", "g"]),
    confirmed: {
      missions: [
        cm("m1", "2026-09-21", "S.26.0001"), cm("m2", "2026-09-21", "S.26.0002", { host: "Host B" }),
        cm("m3", "2026-09-22", "S.26.0001"), cm("m4", "2026-09-22", "S.26.0002", { host: "Host B" }),
        cm("m5", "2026-09-22", "S.26.0003", { hidden: true }),                    // hidden: ignored
        cm("mx", "2026-09-22", "S.26.0009", { board_id: "b2" }),                  // another board
      ],
      assignments: [
        ...on("mission_id", "m1", "2026-09-21", ["a", "b", "gone"]), ...on("mission_id", "m2", "2026-09-21", ["c"]),
        ...on("mission_id", "m3", "2026-09-22", ["a", "b", "d"]), ...on("mission_id", "m4", "2026-09-22", ["c", "e"]),
        ...on("mission_id", "m5", "2026-09-22", ["f"]), ...on("mission_id", "mx", "2026-09-22", ["g"]),
      ],
    },
    forecast: {
      missions: [{ id: "f1", board_id: "b1", plan_date: "2026-09-24", number: "S.26.0001", shift: "day", host: "Host A", customer: "Cust A" }],
      assignments: on("forecast_mission_id", "f1", "2026-09-24", ["a"]),
    },
    closed: [{ number: "S.26.0002", shift: "day", closedOn: "2026-09-24" }],
  };
};
const sbxRow = (rows, number) => rows.find((r) => r.number === number);

test("sandbox baseline: placed days show their crew, empty days repeat the latest confirmed day, a closed mission stops", () => {
  const b = Sandbox.baseline(sbxInputs());
  assert.deepEqual(b.source, { "2026-09-21": "confirmed", "2026-09-22": "confirmed", "2026-09-23": "repeat", "2026-09-24": "forecast", "2026-09-25": "repeat" });
  assert.equal(b.repeatDate, "2026-09-22");
  assert.deepEqual(b.rows.map((r) => r.number), ["S.26.0001", "S.26.0002"], "hidden and other boards' missions are not rows");
  // "gone" is not on the roster, so Monday counts 2
  assert.deepEqual(sbxRow(b.rows, "S.26.0001").base, { "2026-09-21": 2, "2026-09-22": 3, "2026-09-23": 3, "2026-09-24": 1, "2026-09-25": 3 });
  // Thursday has a forecast (without this mission); Friday is after its closing date
  assert.deepEqual(sbxRow(b.rows, "S.26.0002").base, { "2026-09-21": 1, "2026-09-22": 2, "2026-09-23": 2 });
});

test("sandbox baseline: with nobody placed in the range, the latest earlier day is repeated", () => {
  const inp = sbxInputs();
  inp.confirmed = { missions: [], assignments: [] };
  inp.forecast = { missions: [], assignments: [] };
  inp.closed = [];
  assert.deepEqual(Sandbox.baseline(inp).rows, [], "nothing to repeat");
  inp.fallback = { date: "2026-09-18", missions: [mission("S.26.0001", ["a", "b", "gone"]), mission("S.26.0004", ["c"], { hidden: true }), mission("S.26.0005", [])] };
  const b = Sandbox.baseline(inp);
  assert.equal(b.repeatDate, "2026-09-18");
  assert.deepEqual(b.rows.map((r) => r.number), ["S.26.0001"]);
  assert.deepEqual(Object.values(b.rows[0].base), [2, 2, 2, 2, 2]);
});

test("sandbox apply: new missions, crew changes and typed cells stack; off and orphaned requests do nothing", () => {
  const b = Sandbox.baseline(sbxInputs());
  const key1 = Sandbox.sandboxKey({ number: "S.26.0001", shift: "day" });
  const reqs = [
    { id: "q1", kind: "new", host: "Host C", customer: "Cust C", shift: "night", headcount: 4, from: "2026-09-23", to: null, on: true },
    { id: "q2", kind: "change", key: key1, headcount: 5, from: "2026-09-22", to: "2026-09-23", on: true },
    { id: "q3", kind: "cells", key: key1, cells: { "2026-09-23": 9 }, on: true },
    { id: "q4", kind: "change", key: key1, headcount: 0, from: "2026-09-21", to: null, on: false },
    { id: "q5", kind: "change", key: "m\u0001GONE\u0001day", headcount: 2, from: "2026-09-21", to: null, on: true },
  ];
  const out = Sandbox.apply(b.rows, reqs, SBX_DATES);
  assert.deepEqual([...out.orphans], ["q5"]);
  assert.deepEqual(sbxRow(out.rows, "S.26.0001").values, { "2026-09-21": 2, "2026-09-22": 5, "2026-09-23": 9, "2026-09-24": 1, "2026-09-25": 3 });
  const added = out.rows.find((r) => r.isNew);
  assert.equal(added.key, Sandbox.requestKey("q1"));
  assert.deepEqual(added.values, { "2026-09-23": 4, "2026-09-24": 4, "2026-09-25": 4 });
  assert.deepEqual(Sandbox.totals(out.rows, SBX_DATES, "values"), [3, 7, 15, 5, 7]);
  assert.deepEqual(Sandbox.totals(out.rows, SBX_DATES, "base"), [3, 5, 5, 1, 3]);
  assert.deepEqual(Sandbox.byHost(out.rows).map((g) => g.host + ":" + g.rows.length), ["Host A:1", "Host B:1", "Host C:1"]);
  assert.deepEqual(sbxRow(b.rows, "S.26.0001").base["2026-09-22"], 3, "the baseline rows are not changed");
});

test("sandbox setCells: a typed number is kept as one request per row; typing the board's number back removes it", () => {
  const b = Sandbox.baseline(sbxInputs());
  const key1 = Sandbox.sandboxKey({ number: "S.26.0001", shift: "day" });
  let n = 0;
  const id = () => "c" + (++n);
  let reqs = Sandbox.setCells([], [{ key: key1, date: "2026-09-21", value: 6 }, { key: key1, date: "2026-09-22", value: 3 }], b.rows, SBX_DATES, id);
  assert.deepEqual(reqs, [{ id: "c1", kind: "cells", key: key1, cells: { "2026-09-21": 6 }, on: true }], "3 is already the board's number");
  reqs = Sandbox.setCells(reqs, [{ key: key1, date: "2026-09-25", value: 0 }], b.rows, SBX_DATES, id);
  assert.deepEqual(reqs[0].cells, { "2026-09-21": 6, "2026-09-25": 0 });
  reqs = Sandbox.setCells(reqs, [{ key: key1, date: "2026-09-21", value: null }, { key: key1, date: "2026-09-25", value: 3 }], b.rows, SBX_DATES, id);
  assert.deepEqual(reqs, [], "an empty request goes");
  // on top of a crew change, the number to beat is the changed one
  const change = { id: "q", kind: "change", key: key1, headcount: 5, from: "2026-09-21", to: null, on: true };
  assert.deepEqual(Sandbox.setCells([change], [{ key: key1, date: "2026-09-21", value: 5 }], b.rows, SBX_DATES, id), [change]);
  assert.equal(Sandbox.setCells([change], [{ key: key1, date: "2026-09-21", value: 2 }], b.rows, SBX_DATES, id)[1].cells["2026-09-21"], 2);
});

test("capacity paste: Excel-style clipboard text parses to whole numbers, blanks clear", () => {
  assert.deepEqual(Capacity.parseClip("3\t4\r\n\t5\r\n"), { rows: [[3, 4], [null, 5]] });
  assert.deepEqual(Capacity.parseClip(" 12 "), { rows: [[12]] });
  assert.deepEqual(Capacity.parseClip("7.0"), { rows: [[7]] }, "Excel's 7.0 is still a whole number");
  assert.deepEqual(Capacity.parseClip("2\t2.5"), { error: "2.5" });
  assert.deepEqual(Capacity.parseClip("Host A\t3"), { error: "Host A" });
  assert.deepEqual(Capacity.parseClip("\n"), { rows: [] });
});

test("capacity paste: a block lands at the selection's top-left; one value fills the selection; overflow is dropped", () => {
  const block = [[1, 2], [3, 4]];
  const p = Capacity.pastePlan(block, { r0: 1, c0: 3, r1: 1, c1: 3 }, 3, 5);
  assert.deepEqual(p.cells, [{ r: 1, c: 3, v: 1 }, { r: 1, c: 4, v: 2 }, { r: 2, c: 3, v: 3 }, { r: 2, c: 4, v: 4 }]);
  assert.deepEqual([p.r0, p.c0, p.r1, p.c1, p.dropped], [1, 3, 2, 4, 0]);
  const off = Capacity.pastePlan(block, { r0: 2, c0: 4, r1: 2, c1: 4 }, 3, 5);
  assert.deepEqual(off.cells, [{ r: 2, c: 4, v: 1 }]);
  assert.equal(off.dropped, 3);
  const fill = Capacity.pastePlan([[null]], { r0: 0, c0: 0, r1: 1, c1: 1 }, 3, 5);
  assert.deepEqual(fill.cells.map((c) => [c.r, c.c, c.v]), [[0, 0, null], [0, 1, null], [1, 0, null], [1, 1, null]]);
  const ragged = Capacity.pastePlan([[1, 2], [3]], { r0: 0, c0: 0, r1: 0, c1: 0 }, 3, 5);
  assert.deepEqual(ragged.cells.map((c) => c.v), [1, 2, 3]);
});

/* ---------- PlanDiff merge model (Review & merge, per-person decisions) ---------- */
function mergeFixture() {
  // carry-over: wichai + malee on 101, anucha on 312, rattana + boonmee on 520, jirawat on standby
  const base = {
    missions: [mission("101", ["somchai", "wichai", "malee"]), mission("205", ["kanya"], { ppe: "Shoes" }),
               mission("312", ["anucha"]), mission("520", ["rattana", "boonmee"])],
    zones: zones(),
  };
  // forecast: wichai to 205 (new start time), anucha to 101, malee on leave,
  // a new 410 with jirawat + rattana; 520 left out, boonmee not mentioned
  const forecast = {
    missions: [mission("101", ["somchai", "anucha"], { createdBy: "anan" }),
               mission("205", ["kanya", "wichai"], { startTime: "07:00", ppe: "Shoes", createdBy: "anan", updatedBy: "natt" }),
               mission("312", [], { createdBy: "anan" }),
               mission("410", ["jirawat", "rattana"], { createdBy: "natt" })],
    zones: zones({ annual: ["malee"] }),
    holds: { somchai: "anan", anucha: "anan", kanya: "natt", wichai: "natt", malee: "anan", jirawat: "natt", rattana: "natt" },
  };
  const ids = ["somchai", "wichai", "malee", "kanya", "anucha", "rattana", "boonmee", "jirawat"];
  return PlanDiff.computeMerge(base, forecast, { employeeIds: ids });
}
const place = (p) => p.kind === "mission" ? p.key : p.kind === "zone" ? "zone:" + p.zone : "standby";

test("merge: every collision is an item, only the collision-free ones come pre-decided", () => {
  const m = mergeFixture();
  const summary = Object.fromEntries(m.items.map((i) => [i.id, [i.decision, i.forecaster]]));
  assert.deepEqual(summary, {
    "add:410|day": ["forecast", "natt"],
    "field:205|day:startTime": [null, "natt"],
    "remove:520|day": [null, null],
    "person:wichai": [null, "natt"],
    "person:malee": [null, "anan"],
    "person:anucha": [null, "anan"],
    "person:rattana": [null, "natt"],
    "person:jirawat": ["forecast", "natt"],
  });
  assert.ok(!m.byId.has("person:boonmee"), "the forecast doesn't mention boonmee and left out his mission: he follows the mission");
  assert.equal(PlanDiff.pending(m).length, 6);
});

test("merge: a forecast that planned a mission without someone is a collision with no forecaster", () => {
  const base = { missions: [mission("101", ["p1", "p2"])], zones: zones() };
  const forecast = { missions: [mission("101", ["p1"])], zones: zones(), holds: { p1: "anan" } };
  const m = PlanDiff.computeMerge(base, forecast, { employeeIds: ["p1", "p2"] });
  assert.deepEqual(m.items.map((i) => [i.id, i.decision, i.forecaster, place(i.to)]), [["person:p2", null, null, "standby"]]);
});

test("merge: not adding a new mission locks its crew to the carry-over", () => {
  const m = mergeFixture();
  assert.equal(PlanDiff.decide(m, "person:rattana", "forecast"), true);
  assert.equal(PlanDiff.decide(m, "add:410|day", "carry"), true);
  assert.equal(PlanDiff.decisionOf(m, "person:rattana"), "carry", "locked while 410 isn't added");
  assert.equal(PlanDiff.decisionOf(m, "person:jirawat"), "carry");
  assert.equal(PlanDiff.decide(m, "person:rattana", "forecast"), false, "can't take the forecast side for a mission that won't exist");
  assert.equal(place(PlanDiff.resultPlace(m, "jirawat")), "standby");
  assert.equal(PlanDiff.missionOnBoard(m, "410|day"), false);
  PlanDiff.decide(m, "add:410|day", "forecast");
  assert.equal(PlanDiff.decisionOf(m, "person:rattana"), "forecast", "the earlier choice comes back");
});

test("merge: removing a carry-over mission sends whoever stays on it to Standby", () => {
  const m = mergeFixture();
  PlanDiff.decide(m, "person:rattana", "carry");
  assert.equal(place(PlanDiff.resultPlace(m, "boonmee")), "520|day", "undecided removal = kept for now");
  PlanDiff.decide(m, "remove:520|day", "forecast");
  assert.equal(place(PlanDiff.resultPlace(m, "boonmee")), "standby");
  assert.equal(place(PlanDiff.resultPlace(m, "rattana")), "standby");
  assert.equal(PlanDiff.missionOnBoard(m, "520|day"), false);
});

test("merge: toDiff refuses while anything is undecided, then maps choices onto the apply shape", () => {
  const m = mergeFixture();
  assert.throws(() => PlanDiff.toDiff(m), /decision/);
  for (const [id, v] of [["field:205|day:startTime", "forecast"], ["remove:520|day", "carry"], ["person:wichai", "forecast"],
                         ["person:malee", "forecast"], ["person:anucha", "carry"], ["person:rattana", "forecast"]]) PlanDiff.decide(m, id, v);
  assert.equal(PlanDiff.pending(m).length, 0);
  const d = PlanDiff.toDiff(m);
  const by = Object.fromEntries(d.items.map((i) => [i.id, i]));
  assert.deepEqual(Object.keys(by).sort(), ["add:410|day", "leave:malee", "move:wichai", "update:205|day"]);
  assert.ok(d.items.every((i) => i.ticked));
  assert.deepEqual(by["add:410|day"].members.map((x) => x.empId).sort(), ["jirawat", "rattana"]);
  assert.deepEqual(by["update:205|day"].changes.map((c) => c.field), ["startTime"]);
  assert.equal(by["update:205|day"].mission.startTime, "07:00");
  assert.equal(by["update:205|day"].mission.number, "205");
  assert.equal(place(by["move:wichai"].to), "205|day");
  assert.equal(place(by["leave:malee"].to), "zone:annual");
  // the apply order still holds: adds, updates, placements, removes
  const steps = PlanDiff.plan(d);
  assert.deepEqual([steps.adds.length, steps.updates.length, steps.placements.length, steps.removes.length], [1, 1, 2, 0]);
});

test("merge: decisionRows logs every decision with both sides and the reason", () => {
  const m = mergeFixture();
  for (const [id, v] of [["field:205|day:startTime", "carry"], ["remove:520|day", "forecast"], ["person:wichai", "carry"],
                         ["person:malee", "forecast"], ["person:anucha", "forecast"], ["person:rattana", "carry"]]) PlanDiff.decide(m, id, v);
  const label = { place: (p) => place(p), field: (f, v) => f + "=" + v };
  const rows = PlanDiff.decisionRows(m, label, { "person:wichai": "  Needed on 101 " });
  assert.equal(rows.length, 8);
  const w = rows.find((r) => r.employee_id === "wichai");
  assert.deepEqual({ ...w }, { type: "person", choice: "carry", reason: "Needed on 101", employee_id: "wichai",
    mission_number: "205", mission_shift: "day", field: null, carry_value: "101|day", forecast_value: "205|day" });
  const r = rows.find((x) => x.employee_id === "rattana");
  assert.equal(r.carry_value, "standby", "the carry side says where he really ends up: 520 is being removed");
  const f = rows.find((x) => x.type === "field");
  assert.deepEqual([f.mission_number, f.field, f.carry_value, f.forecast_value, f.reason], ["205", "startTime", "startTime=08:00", "startTime=07:00", null]);
});

test("capacity export: one board's grid as data, with only the ticked host columns, in a fixed order", () => {
  const days = [
    { date: "2026-10-05", forecast: false, demand: 3, gap: -1, kind: "short", a: { available: 2, named: 1 } },
    { date: "2026-10-06", forecast: true, demand: 0, gap: null, kind: null, a: null },
  ];
  const vals = { "2026-10-05|Host A|day": 3, "2026-10-06|Host A|day": 0 };
  const out = Capacity.exportBoard({
    name: "Board One", days, rows: [{ host: "Host A", shift: "day" }, { host: "Host Z", shift: "night" }],
    value: (d, h, s) => vals[d + "|" + h + "|" + s],
    hostInfo: (h) => (h === "Host A" ? { area: "LCB", location: "Plant 2", note: "Gate 3", mapUrl: "https://m.example.com" } : null),
    extras: ["mapUrl", "area"], dateLabel: (d) => "L" + d.slice(8),
  });
  assert.deepEqual(out.extras.map((c) => c.key), ["area", "mapUrl"], "fixed order, only the ticked ones");
  assert.deepEqual(out.dates, [{ date: "2026-10-05", label: "L05", forecast: false }, { date: "2026-10-06", label: "L06", forecast: true }]);
  assert.deepEqual(out.summary, { available: [2, null], demand: [3, 0], gap: [-1, null], kind: ["short", null], named: [1, null] });
  assert.deepEqual(out.rows[0], { host: "Host A", shift: "day", extra: { area: "LCB", mapUrl: "https://m.example.com" }, values: [3, 0] }, "a 0 stays 0");
  assert.deepEqual(out.rows[1], { host: "Host Z", shift: "night", extra: { area: "", mapUrl: "" }, values: [null, null] }, "no Host-list record: blank columns");
});

test("PlanStatus: the date pill says where the plan stands", () => {
  const base = { forecast: false, locked: false, empty: false, nonWorking: false, stamped: true, stale: false, date: "2026-10-15", today: "2026-10-14" };
  const s = (o) => PlanStatus.of({ ...base, ...o }).state;
  assert.equal(s({ forecast: true, empty: true }), "forecast");
  assert.equal(s({ locked: true, stamped: false }), "locked");
  assert.equal(s({ empty: true }), "empty");
  assert.equal(s({ empty: true, nonWorking: true }), "holiday");
  // a holiday with anything on it is planned, no review expected
  assert.equal(s({ nonWorking: true, stamped: false }), "planned");
  // missions added one by one, never carried over or merged
  assert.equal(s({ stamped: false }), "draft");
  assert.equal(s({}), "planned");
  assert.equal(s({ stale: true }), "stale");
  // stamps unknown (older database): no false Draft
  assert.equal(s({ stamped: null }), "planned");
  assert.deepEqual(PlanStatus.of({ ...base, date: "2026-10-14" }), { state: "planned", past: false, today: true });
  assert.deepEqual(PlanStatus.of({ ...base, date: "2026-10-01", stamped: false }), { state: "draft", past: true, today: false });
});
