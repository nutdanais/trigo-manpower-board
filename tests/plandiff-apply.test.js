// node --test tests/*.test.js
// cloud.applyPlanDiff: writes only the ticked items, through the normal
// mutations (so deployment history follows applied placements only), stamps
// the re-sync, and refuses outright if the day got locked meanwhile.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCloud, FakeDb } = require("./fake/load-cloud");

const SRC = "2026-09-21", DEST = "2026-09-22";

async function setup() {
  const x = loadCloud({ db: new FakeDb() });
  x.db.seed("boards", [{ id: "b1", name: "Board One", weekend_days: [0, 6] }]);
  x.db.seed("employees", ["e1", "e2", "e3"].map((id) => ({ id, name: id, contract: "permanent", board_id: "b1" })));
  x.db.seed("missions", [
    { id: "s1", board_id: "b1", plan_date: SRC, number: "1", host: "H", customer: "C", shift: "day" },
    { id: "s2", board_id: "b1", plan_date: SRC, number: "2", host: "H", customer: "C", shift: "day" },
  ]);
  x.db.seed("assignments", [
    { employee_id: "e1", plan_date: SRC, mission_id: "s1", zone: null },
    { employee_id: "e2", plan_date: SRC, mission_id: "s1", zone: null },
  ]);
  await x.cloud._loadEmployees(); await x.cloud._loadBoards(); await x.cloud._loadFeatures();
  await x.cloud.resetBoardFromLastWorkingDay("b1", DEST);
  // the source day moves on: e1 to mission 2, e3 onto sick leave, a new mission 3
  x.db.exec({ table: "assignments", op: "update", values: { mission_id: "s2" }, filters: [["eq", "employee_id", "e1"], ["eq", "plan_date", SRC]] }, { email: "eng.b@example.com" });
  x.db.exec({ table: "assignments", op: "insert", values: { employee_id: "e3", plan_date: SRC, mission_id: null, zone: "sick" } }, { email: "eng.b@example.com" });
  x.db.exec({ table: "missions", op: "insert", values: { board_id: "b1", plan_date: SRC, number: "3", host: "H3", customer: "C3", shift: "day" } }, { email: "eng.b@example.com" });
  const diff = x.context.PlanDiff.compute(
    await x.cloud.ensurePlanLoaded("b1", DEST, { force: true }),
    await x.cloud.buildCarryPreview("b1", SRC),
    { employeeIds: ["e1", "e2", "e3"] });
  return { ...x, diff };
}

test("applies only the ticked items and stamps the re-sync", async () => {
  const { cloud, db, diff } = await setup();
  assert.deepEqual(Array.from(diff.items, (i) => i.id).sort(), ["add:3|day", "leave:e3", "move:e1"]);
  // defaults: add + leave ticked, move not
  const summary = await cloud.applyPlanDiff("b1", DEST, diff, { carriedFrom: SRC });
  // JSON round trip: objects made inside the vm realm fail a cross-realm deepEqual
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), { added: 1, updated: 0, placed: 1, removed: 0 });
  const at = (emp) => db.t("assignments").find((a) => a.employee_id === emp && a.plan_date === DEST);
  const missionNo = (id) => db.t("missions").find((m) => m.id === id).number;
  assert.equal(missionNo(at("e1").mission_id), "1", "unticked move not applied");
  assert.equal(at("e3").zone, "sick", "ticked leave applied");
  assert.ok(db.t("missions").some((m) => m.plan_date === DEST && m.number === "3"), "ticked add applied");
  assert.ok(!db.t("deployment_history").some((h) => h.employee_id === "e3" && h.plan_date === DEST), "no history for leave");
  const s = db.t("plan_day_stamps").find((x) => x.plan_date === DEST);
  const src = db.t("plan_day_stamps").find((x) => x.plan_date === SRC);
  assert.ok(s.carried_at > src.last_edited_at, "re-sync stamp clears staleness");
});

test("refuses to apply anything if the day was locked while the panel was open", async () => {
  const { cloud, db, diff } = await setup();
  db.seed("plan_days", [{ board_id: "b1", plan_date: DEST, locked_by: "eng.b@example.com", locked_at: new Date().toISOString() }]);
  const before = JSON.stringify(db.t("assignments")) + JSON.stringify(db.t("missions"));
  await assert.rejects(cloud.applyPlanDiff("b1", DEST, diff, { carriedFrom: SRC }), /locked/);
  assert.equal(JSON.stringify(db.t("assignments")) + JSON.stringify(db.t("missions")), before, "nothing written");
});
