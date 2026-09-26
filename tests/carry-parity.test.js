// node --test tests/*.test.js
// Part A acceptance 4: after the buildCarryPreview / applyCarry split, Carry
// over and Reset Board write exactly the rows the old _copyPlanForward wrote;
// the preview is exactly what a carry into an empty day produces; and
// findLatestWeekdayMissionDate only ever reads confirmed missions.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCloud, FakeDb } = require("./fake/load-cloud");
const installReference = require("./fixtures/copy-plan-forward.reference");

const B1 = "board-1", B2 = "board-2";
const SRC = "2026-09-21", DEST = "2026-09-22";   // Mon -> Tue

function seed(db, { destMissions = [] } = {}) {
  db.seed("boards", [{ id: B1, name: "Board One", weekend_days: [0, 6] }, { id: B2, name: "Board Two", weekend_days: [0, 6] }]);
  db.seed("employees", [
    { id: "e1", name: "P1", contract: "permanent", board_id: B1 },
    { id: "e2", name: "P2", contract: "permanent", board_id: B1 },
    { id: "e3", name: "P3", contract: "oncall", board_id: B1 },
    { id: "e4", name: "P4", contract: "permanent", board_id: B1, active: false },   // deactivated: never carried
    { id: "e5", name: "P5", contract: "permanent", board_id: B2 },                  // other board: never carried
    { id: "e6", name: "P6", contract: "permanent", board_id: B1 },
  ]);
  db.seed("missions", [
    { id: "m1", board_id: B1, plan_date: SRC, number: "101", host: "Host A", customer: "Cust A", shift: "day", start_time: "07:00:00", end_time: "16:00:00", engineer_id: "eng1", ppe: "Helmet", remark: "Gate 3" },
    { id: "m2", board_id: B1, plan_date: SRC, number: "101", host: "Host A", customer: "Cust A", shift: "night", start_time: "19:00:00", end_time: "04:00:00", engineer_id: "eng1" },
    { id: "m3", board_id: B1, plan_date: SRC, number: "202", host: "Host B", customer: "Cust B", shift: "day", hidden: true },
    { id: "m4", board_id: B2, plan_date: SRC, number: "303", host: "Host C", customer: "Cust C", shift: "day" },
    ...destMissions,
  ]);
  db.seed("assignments", [
    { employee_id: "e1", plan_date: SRC, mission_id: "m1", zone: null },
    { employee_id: "e2", plan_date: SRC, mission_id: "m2", zone: null },
    { employee_id: "e3", plan_date: SRC, mission_id: null, zone: "annual" },
    { employee_id: "e4", plan_date: SRC, mission_id: "m1", zone: null },
    { employee_id: "e5", plan_date: SRC, mission_id: "m4", zone: null },
  ]);
}

/* rows on DEST, with ids replaced by content so two runs compare equal */
function snapshot(db) {
  const mById = new Map(db.t("missions").map((m) => [m.id, m]));
  const strip = ({ id, created_at, updated_at, ...rest }) => rest;
  return {
    missions: db.t("missions").filter((m) => m.plan_date === DEST).map(strip).sort((a, b) => (a.number + a.shift + a.board_id).localeCompare(b.number + b.shift + b.board_id)),
    assignments: db.t("assignments").filter((a) => a.plan_date === DEST)
      .map(({ id, updated_at, mission_id, ...rest }) => ({ ...rest, mission: mission_id ? mById.get(mission_id).number + "|" + mById.get(mission_id).shift : null }))
      .sort((a, b) => a.employee_id.localeCompare(b.employee_id)),
    history: db.t("deployment_history").filter((h) => h.plan_date === DEST).map(({ id, created_at, ...rest }) => rest)
      .sort((a, b) => a.employee_id.localeCompare(b.employee_id)),
  };
}

async function runBoth(scenario) {
  const a = loadCloud({ db: new FakeDb() });
  const b = loadCloud({ db: new FakeDb() });
  for (const x of [a, b]) {
    seed(x.db, scenario);
    await x.cloud._loadEmployees();
    await x.cloud._loadBoards();
    await x.cloud._loadFeatures();
  }
  installReference(a.cloud, a.sb);
  await a.cloud._referenceCopyPlanForward(B1, SRC, DEST);
  await b.cloud.applyCarry(B1, SRC, DEST);
  return [snapshot(a.db), snapshot(b.db)];
}

test("parity: carry into an empty day writes the same missions, assignments and history as the old code", async () => {
  const [before, after] = await runBoth({});
  assert.ok(before.missions.length === 3 && before.assignments.length === 3, "fixture exercises missions + assignments");
  assert.deepEqual(after, before);
});

test("parity: a day that already has missions keeps them and only gets people", async () => {
  const dest = [
    { id: "d1", board_id: B1, plan_date: DEST, number: "101", host: "Edited host", customer: "Cust A", shift: "day", remark: "pre-set" },
    { id: "d2", board_id: B1, plan_date: DEST, number: "999", host: "New", customer: "New", shift: "day" },
  ];
  const [before, after] = await runBoth({ destMissions: dest });
  assert.equal(before.missions.find((m) => m.number === "101").host, "Edited host");
  assert.deepEqual(after, before);
});

test("parity: Reset Board on a non-empty day gives the same result as the old code, and stamps the carry", async () => {
  const a = loadCloud({ db: new FakeDb() });
  const b = loadCloud({ db: new FakeDb() });
  for (const x of [a, b]) {
    seed(x.db, { destMissions: [{ id: "d9", board_id: B1, plan_date: DEST, number: "777", host: "X", customer: "X", shift: "day" }] });
    x.db.seed("assignments", [{ employee_id: "e6", plan_date: DEST, mission_id: "d9", zone: null }]);
    await x.cloud._loadEmployees(); await x.cloud._loadBoards(); await x.cloud._loadFeatures();
  }
  installReference(a.cloud, a.sb);
  // the old Reset: same clearing steps, then the old copy
  a.cloud.applyCarry = a.cloud._referenceCopyPlanForward;
  a.cloud.data.features.stamps = false;
  assert.equal(await a.cloud.resetBoardFromLastWorkingDay(B1, DEST), SRC);
  assert.equal(await b.cloud.resetBoardFromLastWorkingDay(B1, DEST), SRC);
  assert.deepEqual(snapshot(b.db), snapshot(a.db));
  const stamp = b.db.t("plan_day_stamps").find((s) => s.board_id === B1 && s.plan_date === DEST);
  assert.equal(stamp.carried_from, SRC);
  assert.ok(stamp.carried_at);
});

test("the carry preview is exactly what a real carry into an empty day produces", async () => {
  const x = loadCloud({ db: new FakeDb() });
  seed(x.db);
  await x.cloud._loadEmployees(); await x.cloud._loadBoards(); await x.cloud._loadFeatures();
  const writesBefore = JSON.stringify(x.db.tables);
  const preview = await x.cloud.buildCarryPreview(B1, SRC);
  assert.equal(JSON.stringify(x.db.tables), writesBefore, "preview writes nothing");
  await x.cloud.applyCarry(B1, SRC, DEST);
  const real = await x.cloud.ensurePlanLoaded(B1, DEST, { force: true });
  const shape = (p) => ({
    missions: p.missions.map(({ id, members, ...m }) => ({ ...m, members: [...members].sort() })).sort((a, b) => (a.number + a.shift).localeCompare(b.number + b.shift)),
    zones: Object.fromEntries(Object.entries(p.zones).map(([k, v]) => [k, [...v].sort()])),
  });
  assert.deepEqual(shape(preview), shape(real));
});

test("findLatestWeekdayMissionDate never returns a forecast date", async () => {
  const x = loadCloud({ db: new FakeDb() });
  seed(x.db);
  x.db.seed("forecast_missions", [
    { board_id: B1, plan_date: "2026-09-29", number: "F1", host: "H", customer: "C", shift: "day" },
    { board_id: B1, plan_date: "2026-09-24", number: "F2", host: "H", customer: "C", shift: "day" },
  ]);
  await x.cloud._loadEmployees(); await x.cloud._loadBoards();
  assert.equal(await x.cloud.findLatestWeekdayMissionDate(B1, "2026-09-30"), SRC);
});

test("the stamp trigger: carrying into a day does not make its SOURCE look edited, a later source edit does", async () => {
  const x = loadCloud({ db: new FakeDb() });
  seed(x.db);
  await x.cloud._loadEmployees(); await x.cloud._loadBoards(); await x.cloud._loadFeatures();
  await x.cloud.resetBoardFromLastWorkingDay(B1, DEST);
  let sig = await x.cloud.getPlanSignals(B1, DEST, { stale: true });
  assert.equal(sig.stale, null, "fresh carry: not stale");
  // unassigning someone on the source day (a DELETE) must be enough
  await x.cloud.setAssignment("e3", SRC, null);
  sig = await x.cloud.getPlanSignals(B1, DEST, { stale: true });
  assert.ok(sig.stale && sig.stale.edited, "source edited after the carry: stale");
  assert.equal(sig.stale.sourceEditedBy, "eng.a@example.com");
});
