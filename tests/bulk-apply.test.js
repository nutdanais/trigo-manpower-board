// node --test tests/*.test.js
// Bulk edit by file, the write half: a reviewed plan applied through cloud.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCloud, FakeDb } = require("./fake/load-cloud");
const B = require("../bulk-edit.js");
const { parseCsv } = require("./helpers/csv");

const POSITIONS = { inspector: { label: "Inspector", short: "Ins" }, technician: { label: "Technician", short: "Tec" } };
const DAY = "2026-10-05", OTHER_DAY = "2026-10-06";

function setup() {
  const db = new FakeDb();
  db.seed("boards", [{ id: "b1", name: "LCB Port", weekend_days: [0, 6] }, { id: "b2", name: "Rayong", weekend_days: [0, 6] }]);
  db.seed("service_areas", [{ id: "a1", name: "FTM", color: "#fff" }, { id: "a2", name: "LCB", color: "#fff" }]);
  db.seed("employees", [
    { id: "e1", name_th: "Somchai", contract: "permanent", board_id: "b1", area_id: "a1", phone: "081", position: "inspector" },
    { id: "e2", name_th: "Malee", contract: "oncall", board_id: "b1", area_id: "a1" },
    { id: "e3", name_th: "Pichai", contract: "permanent", board_id: "b1", area_id: "a1" },
  ]);
  db.seed("missions", [{ id: "m1", board_id: "b1", plan_date: DAY, number: "1", host: "H", customer: "C", shift: "day" }, { id: "m2", board_id: "b1", plan_date: OTHER_DAY, number: "1", host: "H", customer: "C", shift: "day" }]);
  db.seed("assignments", [
    { employee_id: "e1", plan_date: DAY, mission_id: "m1", zone: null },
    { employee_id: "e1", plan_date: OTHER_DAY, mission_id: "m2", zone: null },
  ]);
  return { db, ...loadCloud({ db }) };
}
async function planFrom(cloud, csv) {
  await cloud._loadEmployees(); await cloud._loadAreas(); await cloud._loadBoards();
  const d = cloud.data;
  return B.planEmployees(B.readTable(parseCsv(csv), B.EMP_COLUMNS), { employees: d.employees, areas: d.areas, boards: d.boards, positions: POSITIONS });
}

test("applies renames, field changes, clears, board moves and status in one go", async () => {
  const { cloud, db } = setup();
  const plan = await planFrom(cloud,
    "ID,Name,Contract type,Position,Mobile number,Start date,Service area,Board,Status\n" +
    "e1,Somchai P.,Permanent,Technician,,2023-04-20,LCB,Rayong,Active\n" +      // rename, position, clear phone, date, area, move
    "e2,Malee,Permanent,,,,FTM,LCB Port,Inactive\n" +                          // contract + deactivate
    "e3,Pichai,Permanent,,,,FTM,LCB Port,Active");                              // no change
  assert.deepEqual(plan.rows.map((r) => r.kind), ["update", "update", "same"]);
  const res = await cloud.applyEmployeeImport(plan, { moveDate: DAY });
  assert.deepEqual(JSON.parse(JSON.stringify(res)), { updated: 2, created: 0, failed: [] });
  const e1 = db.t("employees").find((e) => e.id === "e1");
  assert.deepEqual([e1.name_th, e1.position, e1.phone, e1.start_date, e1.area_id, e1.board_id], ["Somchai P.", "technician", null, "2023-04-20", "a2", "b2"]);
  const e2 = db.t("employees").find((e) => e.id === "e2");
  assert.deepEqual([e2.contract, e2.active], ["permanent", false]);
  // the move cleared the viewed day only
  assert.equal(db.t("assignments").some((a) => a.employee_id === "e1" && a.plan_date === DAY), false);
  assert.equal(db.t("assignments").some((a) => a.employee_id === "e1" && a.plan_date === OTHER_DAY), true);
  // and the app's cache already shows it
  assert.equal(cloud.data.employees.find((e) => e.id === "e1").name, "Somchai P.");
});

test("new people are only created when asked, and get today's date unless one is given", async () => {
  const { cloud, db } = setup();
  const csv = "Name,Contract type,Board,Service area,On the board from\nNew One,Permanent,LCB Port,FTM,\nNew Two,On-call,Rayong,,2026-08-15";
  let res = await cloud.applyEmployeeImport(await planFrom(cloud, csv), { moveDate: DAY });
  assert.deepEqual([res.created, db.t("employees").length], [0, 3], "not ticked: nothing is created");
  res = await cloud.applyEmployeeImport(await planFrom(cloud, csv), { moveDate: DAY, createNew: true });
  assert.deepEqual([res.created, res.failed.length], [2, 0]);
  const one = db.t("employees").find((e) => e.name_th === "New One"), two = db.t("employees").find((e) => e.name_th === "New Two");
  const d = new Date(), today = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  assert.equal(one.added_on, today);
  assert.equal(two.added_on, "2026-08-15");
  assert.deepEqual([one.board_id, one.area_id, two.contract, two.area_id], ["b1", "a1", "oncall", null]);
  // idempotent: the same file again finds them by name and has nothing left to do
  const again = await planFrom(cloud, csv);
  assert.deepEqual(again.rows.map((r) => r.kind), ["same", "same"]);
});

test("one failing row is reported with its row number and the rest still apply", async () => {
  const { cloud, db } = setup();
  const plan = await planFrom(cloud, "ID,Name,Position\ne1,Boom Boom,Technician\ne2,Malee Two,Inspector");
  const orig = db.exec.bind(db);
  db.exec = (q, u) => (q.table === "employees" && q.op === "update" && q.values && q.values.name_th === "Boom Boom" ? { data: null, error: { message: "boom" } } : orig(q, u));
  const res = await cloud.applyEmployeeImport(plan, { moveDate: DAY });
  assert.deepEqual(JSON.parse(JSON.stringify(res.failed)), [{ rowNumber: 2, name: "Boom Boom", message: "boom" }]);
  assert.equal(res.updated, 1);
  assert.equal(db.t("employees").find((e) => e.id === "e2").name_th, "Malee Two");
  assert.equal(db.t("employees").find((e) => e.id === "e1").name_th, "Somchai");
});

test("hosts: updates keep the columns the file did not mention; new hosts need the tick", async () => {
  const { cloud, db } = setup();
  db.seed("hosts", [{ name: "Fortune", location: "Rayong", map_url: "https://m.example/1", area_id: "a1", archived: false, note: "keep me" }]);
  await cloud._loadHosts(); await cloud._loadAreas();
  const hosts = cloud.data.hosts.map((h) => ({ ...h, hasRecord: true }));
  const plan = B.planHosts(B.readTable(parseCsv("Host name,Location,Status\nFortune,Map Ta Phut,Archived\nMissions Only,Bangkok,Active\nBrand New,Chonburi,Active"), B.HOST_COLUMNS),
    { hosts: [...hosts, { name: "Missions Only", hasRecord: false, location: "", mapUrl: "", areaId: "", archived: false, note: "" }], areas: cloud.data.areas });
  assert.deepEqual(plan.rows.map((r) => r.kind), ["update", "update", "create"]);
  let res = await cloud.applyHostImport(plan, { createNew: false });
  assert.deepEqual([res.updated, res.created, res.failed.length], [2, 0, 0]);
  const f = db.t("hosts").find((h) => h.name === "Fortune");
  assert.deepEqual([f.location, f.archived, f.map_url, f.note, f.area_id], ["Map Ta Phut", true, "https://m.example/1", "keep me", "a1"]);
  assert.equal(db.t("hosts").find((h) => h.name === "Missions Only").location, "Bangkok", "a host known only from its missions gets its first record");
  assert.equal(db.t("hosts").some((h) => h.name === "Brand New"), false);
  res = await cloud.applyHostImport(plan, { createNew: true });
  assert.equal(res.created, 1);
  assert.equal(db.t("hosts").find((h) => h.name === "Brand New").location, "Chonburi");
});
