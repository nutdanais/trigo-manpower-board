// node --test tests/*.test.js
// employees.added_on: the dashboard numbers for a date count only the people who
// had been added to the app by that day (the 82-person LCB Port import must not
// turn September's headcount, and so its Standby, upside down).
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCloud, FakeDb } = require("./fake/load-cloud");

const B1 = "board-1";

function setup() {
  const db = new FakeDb();
  db.seed("boards", [{ id: B1, name: "LCB Port", weekend_days: [0, 6] }]);
  db.seed("employees", [
    { id: "old1", name_th: "Old 1", contract: "permanent", board_id: B1 },                       // predates the column: always counted
    { id: "old2", name_th: "Old 2", contract: "oncall", board_id: B1 },
    { id: "new1", name_th: "New 1", contract: "permanent", board_id: B1, added_on: "2026-10-01" },
    { id: "new2", name_th: "New 2", contract: "oncall", board_id: B1, added_on: "2026-10-01" },
    { id: "mid", name_th: "Mid", contract: "permanent", board_id: B1, added_on: "2026-09-23" },   // added part-way through the month
  ]);
  db.seed("missions", [{ id: "m1", board_id: B1, plan_date: "2026-09-30", number: "1", host: "H", customer: "C", shift: "day" }]);
  db.seed("assignments", [
    { employee_id: "old1", plan_date: "2026-09-30", mission_id: "m1", zone: null },
    { employee_id: "new1", plan_date: "2026-09-30", mission_id: "m1", zone: null },   // stray row before they were added: not counted
  ]);
  return { db, ...loadCloud({ db }) };
}

test("headcount follows each employee's added_on, day by day", async () => {
  const { cloud } = setup();
  await cloud._loadEmployees();
  const r = (await cloud.getUtilizationRange([B1], "2026-09-22", "2026-10-02"))[B1];
  assert.equal(r["2026-09-22"].headcount, 2);   // old1, old2
  assert.equal(r["2026-09-23"].headcount, 3);   // + mid, the very day they were added
  assert.equal(r["2026-09-30"].headcount, 3);
  assert.equal(r["2026-10-01"].headcount, 5);   // + the two added on the 1st
  assert.equal(r["2026-10-02"].headcount, 5);
  assert.equal(r["2026-09-22"].oncallHeadcount, 1);
  assert.equal(r["2026-09-30"].oncallHeadcount, 1);
  assert.equal(r["2026-10-01"].oncallHeadcount, 2);
});

test("an assignment dated before added_on is left out so assigned never outruns headcount", async () => {
  const { cloud } = setup();
  await cloud._loadEmployees();
  const r = (await cloud.getUtilizationRange([B1], "2026-09-30", "2026-09-30"))[B1]["2026-09-30"];
  assert.equal(r.assigned, 1);
  assert.equal(r.staffedMissions, 1);
  assert.equal(r.byEngineer[""].crew, 1);
});

test("saveEmployee: a new employee defaults to today, can be back-dated, and an edit can clear it", async () => {
  const { cloud, db } = setup();
  await cloud._loadEmployees();
  const base = { contract: "permanent", position: "", phone: "", startDate: "", areaId: null, boardId: B1 };
  const today = (() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })();

  await cloud.saveEmployee(null, { ...base, name: "Fresh Person", addedOn: "" });
  assert.equal(db.t("employees").find((e) => e.name_th === "Fresh Person").added_on, today);

  await cloud.saveEmployee(null, { ...base, name: "Backdated Person", addedOn: "2026-08-15" });
  assert.equal(db.t("employees").find((e) => e.name_th === "Backdated Person").added_on, "2026-08-15");
  assert.equal(cloud.data.employees.find((e) => e.name === "Backdated Person").addedOn, "2026-08-15");

  await cloud.saveEmployee("new1", { ...base, name: "New 1", addedOn: "" });
  assert.equal(db.t("employees").find((e) => e.id === "new1").added_on, null);
  await cloud.saveEmployee("new1", { ...base, name: "New 1", addedOn: "2026-10-01" });
  assert.equal(db.t("employees").find((e) => e.id === "new1").added_on, "2026-10-01");
});
