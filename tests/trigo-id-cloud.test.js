// node --test tests/*.test.js
// TRIGO ID through cloud.saveEmployee and the bulk apply: the rules the form shows
// are enforced where the data is written.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCloud, FakeDb } = require("./fake/load-cloud");
const B = require("../bulk-edit.js");
const { parseCsv } = require("./helpers/csv");

function setup() {
  const db = new FakeDb();
  db.seed("boards", [{ id: "b1", name: "LCB Port", weekend_days: [0, 6] }]);
  db.seed("employees", [
    { id: "e1", name: "Somchai Jaidee", contract: "permanent", board_id: "b1", trigo_id: "T101" },
    { id: "e2", name: "Pichai", contract: "permanent", board_id: "b1" },                 // saved before the full-name rule
    { id: "e3", name: "Malee Sukjai", contract: "oncall", board_id: "b1" },
  ]);
  return { db, ...loadCloud({ db }) };
}
const base = { contract: "permanent", position: "", phone: "", startDate: "", addedOn: "", areaId: null, boardId: "b1" };
const rejects = (p, re) => assert.rejects(p, (e) => re.test(e.message));

test("a new person: full name enforced, ID tidied and stored, loaded back into the cache", async () => {
  const { cloud, db } = setup();
  await cloud._loadEmployees();
  await rejects(cloud.saveEmployee(null, { ...base, name: "Solo", trigoId: "" }), /full name/);
  await rejects(cloud.saveEmployee(null, { ...base, name: "Anan Dee T300", trigoId: "" }), /own field/);
  await rejects(cloud.saveEmployee(null, { ...base, name: "Anan Dee", trigoId: "329" }), /letter T and digits/);
  await cloud.saveEmployee(null, { ...base, name: "Anan Dee", trigoId: " t-300 " });
  assert.equal(db.t("employees").find((e) => e.name === "Anan Dee").trigo_id, "T300");
  assert.equal(cloud.data.employees.find((e) => e.name === "Anan Dee").trigoId, "T300");
});

test("a TRIGO ID is unique, and namesakes need one each", async () => {
  const { cloud, db } = setup();
  await cloud._loadEmployees();
  await rejects(cloud.saveEmployee(null, { ...base, name: "Anan Dee", trigoId: "t101" }), /T101 already belongs to Somchai Jaidee/);
  await rejects(cloud.saveEmployee(null, { ...base, name: "Somchai Jaidee", trigoId: "" }), /already exists/);
  await cloud.saveEmployee(null, { ...base, name: "somchai jaidee", trigoId: "T102" });   // both identified: fine
  assert.equal(db.t("employees").filter((e) => e.name.toLowerCase() === "somchai jaidee").length, 2);
  // the existing Malee has no ID, so a newcomer with her name needs hers first
  await rejects(cloud.saveEmployee(null, { ...base, name: "Malee Sukjai", trigoId: "T103" }), /already exists/);
});

test("editing: a short name saved earlier stays editable, an unchanged ID is left alone, and the ID can be added", async () => {
  const { cloud, db } = setup();
  await cloud._loadEmployees();
  await cloud.saveEmployee("e2", { ...base, name: "Pichai", phone: "081-000-0000", trigoId: undefined });
  const e2 = db.t("employees").find((e) => e.id === "e2");
  assert.deepEqual([e2.name, e2.phone, e2.trigo_id], ["Pichai", "081-000-0000", undefined], "no trigoId key: the column is not touched");
  await rejects(cloud.saveEmployee("e2", { ...base, name: "Pichai2", trigoId: "" }), /full name/);
  await cloud.saveEmployee("e2", { ...base, name: "Pichai", trigoId: "T200" });
  assert.equal(db.t("employees").find((e) => e.id === "e2").trigo_id, "T200");
  await cloud.saveEmployee("e1", { ...base, name: "Somchai Jaidee", trigoId: "T101" });   // saving yourself with your own ID is not a clash
  await cloud.saveEmployee("e1", { ...base, name: "Somchai Jaidee", trigoId: "" });       // the form can clear it
  assert.equal(db.t("employees").find((e) => e.id === "e1").trigo_id, null);
});

test("bulk apply writes the TRIGO ID on updates and on new people", async () => {
  const { cloud, db } = setup();
  await cloud._loadEmployees(); await cloud._loadBoards(); await cloud._loadAreas();
  const d = cloud.data;
  const table = B.readTable(parseCsv("Name,TRIGO ID,Contract type,Board\nMalee Sukjai,T400,On-call,LCB Port\nNew Person,T401,Permanent,LCB Port"), B.EMP_COLUMNS);
  const plan = B.planEmployees(table, { employees: d.employees, areas: d.areas, boards: d.boards, positions: {} });
  assert.deepEqual(plan.rows.map((r) => r.kind), ["update", "create"]);
  const res = await cloud.applyEmployeeImport(plan, { moveDate: "2026-10-05", createNew: true });
  assert.deepEqual([res.updated, res.created, res.failed.length], [1, 1, 0]);
  assert.equal(db.t("employees").find((e) => e.id === "e3").trigo_id, "T400");
  assert.equal(db.t("employees").find((e) => e.name === "New Person").trigo_id, "T401");
});
