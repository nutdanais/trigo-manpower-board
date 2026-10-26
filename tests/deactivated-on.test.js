// node --test tests/*.test.js
// employees.deactivated_on: a deactivated person counts on the days BEFORE the day they were
// deactivated and not from it on, so a day that read 100% when it happened still reads 100%
// the day after (it used to drop to ~90%: every deactivated person counted on every past
// day, and sat on Standby). Also: a board nobody planned on a date reports missions = 0.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCloud, FakeDb } = require("./fake/load-cloud");

const B1 = "board-1";
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const TODAY = iso(new Date());
const day = (n) => { const d = new Date(TODAY + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };

/* one board, `active` permanent people all on a mission on each of `days`, plus `left`
   permanent people who are deactivated (with `deactivated_on` when given) and never on a plan */
function setup({ active = 10, left = 2, deactivatedOn, days = [day(-2), day(-1), TODAY] } = {}) {
  const db = new FakeDb();
  db.seed("boards", [{ id: B1, name: "Board One", weekend_days: [] }]);   // no weekend: every date is a working day
  const emps = [];
  for (let i = 1; i <= active; i++) emps.push({ id: "a" + i, name_th: "Active " + i, contract: "permanent", board_id: B1 });
  for (let i = 1; i <= left; i++) emps.push({ id: "x" + i, name_th: "Left " + i, contract: "permanent", board_id: B1, active: false, ...(deactivatedOn ? { deactivated_on: deactivatedOn } : {}) });
  db.seed("employees", emps);
  db.seed("missions", days.map((d, i) => ({ id: "m" + i, board_id: B1, plan_date: d, number: "1", host: "H", customer: "C", shift: "day" })));
  db.seed("assignments", days.flatMap((d, i) => Array.from({ length: active }, (_, n) => ({ employee_id: "a" + (n + 1), plan_date: d, mission_id: "m" + i, zone: null }))));
  return { db, ...loadCloud({ db }) };
}
/* the History formula: assigned ÷ (assigned + standby), whole percent */
const util = (r) => {
  const oncallFree = Math.max(0, r.oncallHeadcount - r.oncallAssigned - r.oncallLeave);
  const denom = r.headcount - r.leave - oncallFree;
  return denom > 0 ? Math.round((r.assigned / denom) * 100) : 0;
};

test("rosterOn: active counts always; a dated deactivation counts before its day only; an undated one keeps the old rule", async () => {
  const { cloud } = setup();
  const active = { active: true, deactivatedOn: "" };
  const dated = { active: false, deactivatedOn: day(-3) };
  const undated = { active: false, deactivatedOn: "" };
  assert.equal(cloud.rosterOn(active, day(-30)), true);
  assert.equal(cloud.rosterOn(active, TODAY), true);
  assert.equal(cloud.rosterOn({ active: true, deactivatedOn: day(-3) }, TODAY), true, "an active person is never cut by a stray date");
  assert.equal(cloud.rosterOn(dated, day(-4)), true, "the day before");
  assert.equal(cloud.rosterOn(dated, day(-3)), false, "the day itself is off");
  assert.equal(cloud.rosterOn(dated, TODAY), false);
  assert.equal(cloud.rosterOn(undated, day(-30)), true, "no date yet: counted on every past day, as before");
  assert.equal(cloud.rosterOn(undated, TODAY), false, "no date yet: out today, as before");
  assert.equal(cloud.rosterOn(undated, day(1)), false);
});

test("people deactivated before the range no longer count on its days: a fully deployed board reads 100% on every past day", async () => {
  const { cloud } = setup({ left: 9, deactivatedOn: day(-30) });   // nine permanent people who left a month ago
  await cloud._loadEmployees();
  const r = (await cloud.getUtilizationRange([B1], day(-2), TODAY))[B1];
  for (const d of [day(-2), day(-1), TODAY]) {
    assert.equal(r[d].headcount, 10, d + ": only the ten who are there");
    assert.equal(util(r[d]), 100, d + " reads 100%");
  }
});

test("the same day reads the same the day after (the bug: 100% on the day, 83% once it was past)", async () => {
  const { cloud } = setup({ left: 2, deactivatedOn: day(-30) });
  await cloud._loadEmployees();
  const onTheDay = (await cloud.getUtilizationRange([B1], TODAY, TODAY))[B1][TODAY];
  assert.equal(util(onTheDay), 100);
  // the clock moves on: today's date is now yesterday for the same data
  const tomorrow = loadCloud({ db: setup({ left: 2, deactivatedOn: day(-30) }).db });
  tomorrow.context.Date = class extends Date { constructor(...a) { if (a.length) super(...a); else { super(); this.setDate(this.getDate() + 1); } } };
  await tomorrow.cloud._loadEmployees();
  const later = (await tomorrow.cloud.getUtilizationRange([B1], TODAY, TODAY))[B1][TODAY];
  assert.equal(util(later), 100, "still 100% once the day is in the past");
  assert.equal(later.headcount, onTheDay.headcount);
});

test("someone deactivated on a date is counted on the days before it and not from it on", async () => {
  const { cloud } = setup({ left: 1, deactivatedOn: day(-1) });
  await cloud._loadEmployees();
  const r = (await cloud.getUtilizationRange([B1], day(-2), TODAY))[B1];
  assert.equal(r[day(-2)].headcount, 11, "there the day before they left");
  assert.equal(r[day(-1)].headcount, 10, "off from their date");
  assert.equal(r[TODAY].headcount, 10);
  assert.equal(util(r[day(-2)]), 91, "10 deployed of 11: the one who is about to leave is on Standby that day");
});

test("a deactivated person with no date yet keeps the old rule (counted on every past day, out today)", async () => {
  const { cloud } = setup({ left: 2 });
  await cloud._loadEmployees();
  const r = (await cloud.getUtilizationRange([B1], day(-2), TODAY))[B1];
  assert.equal(r[day(-2)].headcount, 12);
  assert.equal(r[day(-1)].headcount, 12);
  assert.equal(r[TODAY].headcount, 10);
});

test("setEmployeesActive stamps today when deactivating, never moves an existing date, and reactivating clears it", async () => {
  const { cloud, db } = setup({ left: 0 });
  await cloud._loadEmployees();
  const row = (id) => db.t("employees").find((e) => e.id === id);
  await cloud.setEmployeesActive(["a1", "a2"], false);
  assert.equal(row("a1").active, false);
  assert.equal(row("a1").deactivated_on, TODAY);
  assert.equal(cloud.data.employees.find((e) => e.id === "a1").deactivatedOn, TODAY, "the cache carries it too");

  row("a2").deactivated_on = day(-5);               // pretend a2 was deactivated earlier
  await cloud._loadEmployees();
  await cloud.setEmployeesActive(["a2", "a3"], false);   // a mixed selection: a2 already off, a3 active
  assert.equal(row("a2").deactivated_on, day(-5), "someone already off keeps their date");
  assert.equal(row("a3").deactivated_on, TODAY);

  await cloud.setEmployeesActive(["a1", "a2"], true);
  assert.equal(row("a1").active, true);
  assert.equal(row("a1").deactivated_on, null);
  assert.equal(row("a2").deactivated_on, null);
  assert.equal(cloud.rosterOn(cloud.data.employees.find((e) => e.id === "a1"), day(-3)), true, "reactivated: counted on every date again");
});

test("setEmployeesActive still works on a database without the column (no date stored)", async () => {
  const { cloud, db } = setup({ left: 0 });
  const exec = db.exec.bind(db);
  db.exec = (q, user) => (q.table === "employees" && q.op === "update" && q.values && "deactivated_on" in q.values
    ? { data: null, error: { code: "PGRST204", message: "Could not find the 'deactivated_on' column of 'employees' in the schema cache" } }
    : exec(q, user));
  await cloud._loadEmployees();
  await cloud.setEmployeesActive(["a1"], false);
  assert.equal(db.t("employees").find((e) => e.id === "a1").active, false);
  assert.equal(cloud.data.employees.find((e) => e.id === "a1").deactivatedOn, "");
  await cloud.setEmployeesActive(["a1"], true);
  assert.equal(db.t("employees").find((e) => e.id === "a1").active, true);
});

test("missions counts the board's missions per date, hidden ones left out: 0 means nobody planned that board", async () => {
  const db = new FakeDb();
  db.seed("boards", [{ id: B1, name: "Planned", weekend_days: [] }, { id: "board-2", name: "Never planned", weekend_days: [] }]);
  db.seed("employees", [
    { id: "p1", name_th: "P1", contract: "permanent", board_id: B1 },
    { id: "q1", name_th: "Q1", contract: "permanent", board_id: "board-2" },
  ]);
  db.seed("missions", [
    { id: "m1", board_id: B1, plan_date: day(-1), number: "1", host: "H", customer: "C", shift: "day" },
    { id: "m2", board_id: B1, plan_date: day(-1), number: "2", host: "H", customer: "C", shift: "night" },    // empty: still planned
    { id: "m3", board_id: B1, plan_date: TODAY, number: "1", host: "H", customer: "C", shift: "day", hidden: true },   // hidden: not planned
  ]);
  db.seed("assignments", [{ employee_id: "p1", plan_date: day(-1), mission_id: "m1", zone: null }]);
  const { cloud } = loadCloud({ db });
  await cloud._loadEmployees();
  const r = await cloud.getUtilizationRange([B1, "board-2"], day(-1), TODAY);
  assert.equal(r[B1][day(-1)].missions, 2, "two missions, one of them with nobody on it");
  assert.equal(r[B1][day(-1)].staffedMissions, 1);
  assert.equal(r[B1][TODAY].missions, 0, "its only mission is hidden");
  assert.equal(r["board-2"][day(-1)].missions, 0);
  assert.equal(r["board-2"][day(-1)].headcount, 1, "the roster is still there; the chart decides to leave the day out");
});
