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
