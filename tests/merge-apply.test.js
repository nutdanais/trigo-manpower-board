// node --test tests/*.test.js
// cloud.applyForecastMerge: writes only the chosen side of each decision
// (through applyPlanDiff), logs every decision, alerts the forecaster only
// where their forecast was not used, and still works without the migration.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCloud, FakeDb } = require("./fake/load-cloud");

const DAY = "2026-09-22";
const B = "eng.b@example.com";
const label = { place: (p) => p.kind === "mission" ? p.key : p.kind === "zone" ? p.zone : "standby", field: (f, v) => String(v) };

async function setup(dbOpts) {
  const x = loadCloud({ db: new FakeDb(dbOpts) });
  const db = x.db;
  db.seed("boards", [{ id: "b1", name: "Board One", weekend_days: [0, 6] }, { id: "b2", name: "Board Two", weekend_days: [0, 6] }]);
  db.seed("employees", [...["e1", "e2", "e3", "e4"].map((id) => ({ id, name_th: id, contract: "permanent", board_id: "b1" })),
                         { id: "e9", name_th: "e9", contract: "permanent", board_id: "b2" }]);
  // the confirmed day, as carried over: e1 + e2 on 101, e3 on 102, e4 on standby
  db.seed("missions", [
    { id: "m101", board_id: "b1", plan_date: DAY, number: "101", host: "H1", customer: "C1", shift: "day" },
    { id: "m102", board_id: "b1", plan_date: DAY, number: "102", host: "H2", customer: "C2", shift: "day" },
  ]);
  db.seed("assignments", [
    { employee_id: "e1", plan_date: DAY, mission_id: "m101", zone: null },
    { employee_id: "e2", plan_date: DAY, mission_id: "m101", zone: null },
    { employee_id: "e3", plan_date: DAY, mission_id: "m102", zone: null },
  ]);
  // eng.b's forecast: e2 + e4 on a new 201, e3 on sick leave (held by eng.a, the planner), 102 left out
  db.seed("forecast_missions", [
    { id: "f101", board_id: "b1", plan_date: DAY, number: "101", host: "H1", customer: "C1", shift: "day", created_by: B },
    { id: "f201", board_id: "b1", plan_date: DAY, number: "201", host: "H3", customer: "C3", shift: "day", created_by: B },
  ]);
  db.seed("forecast_assignments", [
    { employee_id: "e1", plan_date: DAY, forecast_mission_id: "f101", zone: null, held_by: B },
    { employee_id: "e2", plan_date: DAY, forecast_mission_id: "f201", zone: null, held_by: B },
    { employee_id: "e4", plan_date: DAY, forecast_mission_id: "f201", zone: null, held_by: B },
    { employee_id: "e3", plan_date: DAY, forecast_mission_id: null, zone: "sick", held_by: "eng.a@example.com" },
  ]);
  await x.cloud._loadEmployees(); await x.cloud._loadBoards(); await x.cloud._loadFeatures();
  const P = x.context.PlanDiff;
  const model = P.computeMerge(
    await x.cloud.ensurePlanLoaded("b1", DAY, { force: true }),
    await x.cloud.ensureForecastLoaded("b1", DAY, { force: true }),
    { employeeIds: ["e1", "e2", "e3", "e4"] });
  return { ...x, P, model };
}
const placeOf = (db, emp) => {
  const a = db.t("assignments").find((r) => r.employee_id === emp && r.plan_date === DAY);
  if (!a) return "standby";
  return a.zone ? "zone:" + a.zone : db.t("missions").find((m) => m.id === a.mission_id).number;
};

test("writes the chosen side only, logs every decision, alerts the forecaster once", async () => {
  const { cloud, db, P, model } = await setup();
  assert.deepEqual(Array.from(model.items, (i) => i.id).sort(),
    ["add:201|day", "person:e2", "person:e3", "person:e4", "remove:102|day"]);
  P.decide(model, "person:e2", "carry");
  P.decide(model, "person:e3", "forecast");
  P.decide(model, "remove:102|day", "carry");
  const rows = P.decisionRows(model, label, { "person:e2": "Needed on 101" });
  const sum = await cloud.applyForecastMerge("b1", DAY, model, rows);
  assert.deepEqual(JSON.parse(JSON.stringify(sum)), { added: 1, updated: 0, placed: 2, removed: 0, logged: true, alerts: 1 });

  assert.equal(placeOf(db, "e2"), "101", "kept on the carry-over");
  assert.equal(placeOf(db, "e4"), "201", "joined the new mission");
  assert.equal(placeOf(db, "e3"), "zone:sick", "took the forecast's leave");
  assert.ok(db.t("missions").some((m) => m.plan_date === DAY && m.number === "102"), "102 kept");
  assert.ok(db.t("deployment_history").some((h) => h.employee_id === "e4" && h.plan_date === DAY), "history for the applied placement");

  const log = db.t("forecast_merge_decisions");
  assert.equal(log.length, 5);
  assert.equal(new Set(log.map((r) => r.merge_id)).size, 1);
  const e2 = log.find((r) => r.employee_id === "e2");
  assert.deepEqual([e2.choice, e2.forecaster, e2.reason, e2.carry_value, e2.forecast_value], ["carry", B, "Needed on 101", "101|day", "201|day"]);

  const alerts = db.t("forecast_hold_events").filter((e) => e.kind === "merge");
  assert.equal(alerts.length, 1, "only e2: e3 was the planner's own hold and was used anyway");
  assert.deepEqual([alerts[0].employee_id, alerts[0].from_held_by, alerts[0].taken_by, alerts[0].from_forecast_mission_id, alerts[0].reason],
    ["e2", B, "eng.a@example.com", "f201", "Needed on 101"]);
  assert.ok(db.t("plan_day_stamps").find((s) => s.plan_date === DAY).forecast_merged_at, "stamped as merged");

  await cloud.loadHoldEvents();
  const ev = cloud.data.holdEvents.find((e) => e.kind === "merge");
  assert.deepEqual([ev.employeeId, ev.reason, ev.detail.mission_number], ["e2", "Needed on 101", "201"]);
  assert.equal(cloud.data.holdMissions.f201.host, "H3", "the alert knows the forecast mission's host");
  const read = await cloud.loadMergeDecisions("b1", DAY);
  assert.equal(read.length, 5);
});

test("nothing is written while a decision is missing", async () => {
  const { cloud, db, model } = await setup();
  const before = JSON.stringify(db.t("assignments")) + JSON.stringify(db.t("missions"));
  await assert.rejects(cloud.applyForecastMerge("b1", DAY, model, []), /decision/);
  assert.equal(JSON.stringify(db.t("assignments")) + JSON.stringify(db.t("missions")), before);
  assert.equal(db.t("forecast_merge_decisions").length, 0);
});

test("a day locked during the review: nothing written, nothing logged, nobody alerted", async () => {
  const { cloud, db, P, model } = await setup();
  for (const it of P.pending(model)) P.decide(model, it.id, "carry");
  db.seed("plan_days", [{ board_id: "b1", plan_date: DAY, locked_by: B, locked_at: new Date().toISOString() }]);
  await assert.rejects(cloud.applyForecastMerge("b1", DAY, model, P.decisionRows(model, label)), /locked/);
  assert.equal(db.t("forecast_merge_decisions").length, 0);
  assert.equal(db.t("forecast_hold_events").length, 0);
});

test("without the 2026-09-29 migration the merge still applies and stamps, with no log", async () => {
  const { cloud, db, P, model } = await setup({ mergeLog: false });
  assert.equal(cloud.data.features.mergeLog, false);
  for (const it of P.pending(model)) P.decide(model, it.id, "forecast");
  const sum = await cloud.applyForecastMerge("b1", DAY, model, P.decisionRows(model, label));
  assert.equal(sum.logged, false);
  assert.equal(placeOf(db, "e2"), "201");
  assert.ok(!db.t("missions").some((m) => m.plan_date === DAY && m.number === "102"), "removal applied");
  assert.equal(placeOf(db, "e3"), "zone:sick");
  assert.ok(db.t("plan_day_stamps").find((s) => s.plan_date === DAY).forecast_merged_at, "stamped the old way");
  assert.equal((await cloud.loadMergeDecisions("b1", DAY)).length, 0);
});
