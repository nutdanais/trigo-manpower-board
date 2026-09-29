// node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { PlanDiff, Horizon, Capacity } = require("../planning.js");

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

test("capacity seed: a confirmed day's deployment becomes demand per host x shift, filling only empty cells", () => {
  const plan = { missions: [
    mission("101", ["a", "b", "gone"], { host: "Host A" }),
    mission("102", ["c"], { host: "Host A" }),                      // same host + shift: adds up
    mission("103", ["d"], { host: "Host A", shift: "night" }),
    mission("104", ["e"], { host: "Host B", hidden: true }),         // hidden: ignored
    mission("105", [], { host: "Host C" }),                          // nobody on it: no row
  ], zones: zones() };
  const seed = Capacity.seedFromPlan(plan, new Set(["a", "b", "c", "d", "e"]));
  assert.deepEqual(seed, [
    { host: "Host A", shift: "day", headcount: 3 },
    { host: "Host A", shift: "night", headcount: 1 },
  ]);
  const kept = new Set(["2026-09-25|Host A|day"]);
  const cells = Capacity.fillEmpty(seed, ["2026-09-24", "2026-09-25"], (d, h, s) => kept.has(d + "|" + h + "|" + s));
  assert.deepEqual(cells.map((c) => `${c.date} ${c.host} ${c.shift} ${c.headcount}`), [
    "2026-09-24 Host A day 3", "2026-09-24 Host A night 1", "2026-09-25 Host A night 1",
  ]);
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
