// node --test tests/*.test.js
// Lending people to another board (employee_loans) through the real cloud.js:
// which board someone works on each date, overlapping loans giving way, ending
// and changing a loan, and what each clears. Fixtures are fake names.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCloud, FakeDb } = require("./fake/load-cloud");

const D = (n) => `2026-11-${String(n).padStart(2, "0")}`;

function setup() {
  const db = new FakeDb();
  db.seed("boards", [{ id: "b1", name: "Board One" }, { id: "b2", name: "Board Two" }, { id: "b3", name: "Board Three" }]);
  db.seed("employees", [
    { id: "e1", name_th: "Person A", contract: "permanent", board_id: "b1" },
    { id: "e2", name_th: "Person B", contract: "permanent", board_id: "b1" },
  ]);
  db.seed("missions", [
    { id: "m1", board_id: "b1", plan_date: D(2), number: "101", host: "H", customer: "C", shift: "day" },
    { id: "m9", board_id: "b1", plan_date: D(9), number: "101", host: "H", customer: "C", shift: "day" },
  ]);
  db.seed("assignments", [
    { employee_id: "e1", plan_date: D(2), mission_id: "m1", zone: null },
    { employee_id: "e1", plan_date: D(9), mission_id: "m9", zone: null },
    { employee_id: "e2", plan_date: D(2), mission_id: "m1", zone: null },
  ]);
  const env = loadCloud({ db });
  env.cloud.data.features = { loans: true };
  return env;
}
const loans = (db, id) => db.t("employee_loans").filter((l) => l.employee_id === id)
  .map((l) => [l.to_board_id, l.start_date, l.end_date]).sort((a, b) => a[1].localeCompare(b[1]));
const has = (db, id, d) => db.t("assignments").some((a) => a.employee_id === id && a.plan_date === d);

test("boardOn: the loan's board on its first and last day, their own before and after", async () => {
  const { cloud } = setup();
  await cloud._loadEmployees();
  await cloud.setLoan(["e1"], "b2", D(3), D(5), "cover");
  const e1 = cloud.data.employees.find((e) => e.id === "e1");
  assert.deepEqual([D(2), D(3), D(5), D(6)].map((d) => cloud.boardOn(e1, d)), ["b1", "b2", "b2", "b1"]);
  assert.equal(cloud.loanOn("e1", D(4)).note, "cover");
  assert.equal(cloud.loanOn("e2", D(4)), null);
});

test("setLoan clears their places on those dates only, and the plan follows", async () => {
  const { cloud, db } = setup();
  await cloud._loadEmployees();
  await cloud.setLoan(["e1"], "b2", D(2), D(3));
  assert.equal(has(db, "e1", D(2)), false, "taken off 101 on the first day");
  assert.equal(has(db, "e1", D(9)), true, "a later day outside the loan keeps its place");
  assert.equal(has(db, "e2", D(2)), true, "someone not lent keeps theirs");
  const p1 = await cloud.ensurePlanLoaded("b1", D(2));
  const p2 = await cloud.ensurePlanLoaded("b2", D(2));
  assert.equal(JSON.stringify(p1.missions[0].members), JSON.stringify(["e2"]));   // an array from the vm context
  assert.equal(p2.missions.length, 0);
});

test("a loan inside a longer one keeps the older loan's days before and after it", async () => {
  const { cloud, db } = setup();
  await cloud._loadEmployees();
  await cloud.setLoan(["e1"], "b2", D(3), D(10));
  await cloud.setLoan(["e1"], "b3", D(5), D(6));
  assert.deepEqual(loans(db, "e1"), [["b2", D(3), D(4)], ["b3", D(5), D(6)], ["b2", D(7), D(10)]]);
});

test("a loan that starts inside an older one pushes the older one's start back", async () => {
  const { cloud, db } = setup();
  await cloud._loadEmployees();
  await cloud.setLoan(["e1"], "b2", D(5), D(10));
  await cloud.setLoan(["e1"], "b3", D(3), D(6));
  assert.deepEqual(loans(db, "e1"), [["b3", D(3), D(6)], ["b2", D(7), D(10)]]);
});

test("lending to their own board is not a loan", async () => {
  const { cloud, db } = setup();
  await cloud._loadEmployees();
  await cloud.setLoan(["e1", "e2"], "b1", D(3), D(4));
  assert.equal(db.t("employee_loans").length, 0);
});

test("endLoans: each person from that date, bounded by their own loan", async () => {
  const { cloud, db } = setup();
  await cloud._loadEmployees();
  await cloud.setLoan(["e1"], "b2", D(3), D(5));
  await cloud.setLoan(["e2"], "b2", D(3), D(12));
  db.seed("assignments", [{ employee_id: "e1", plan_date: D(8), mission_id: null, zone: "annual" }]);
  await cloud.endLoans(["e1", "e2"], D(4));
  assert.deepEqual(loans(db, "e1"), [["b2", D(3), D(3)]]);
  assert.deepEqual(loans(db, "e2"), [["b2", D(3), D(3)]]);
  assert.equal(has(db, "e1", D(8)), true, "e1's own board after their loan is untouched");
  await cloud.endLoans(["e1"], D(3));
  assert.deepEqual(loans(db, "e1"), [], "ended on its first day: gone");
});

test("updateLoan: a shorter loan clears the days given up, a longer one the days taken on", async () => {
  const { cloud, db } = setup();
  await cloud._loadEmployees();
  await cloud.setLoan(["e1"], "b2", D(3), D(5));
  db.seed("assignments", [{ employee_id: "e1", plan_date: D(5), mission_id: null, zone: "sick" }]);
  await cloud.updateLoan(cloud.data.loans[0], { endDate: D(4), note: "shorter" });
  assert.deepEqual(loans(db, "e1"), [["b2", D(3), D(4)]]);
  assert.equal(has(db, "e1", D(5)), false);
  assert.equal(db.t("employee_loans")[0].note, "shorter");
  await cloud.setLoan(["e1"], "b3", D(10), D(12));
  await cloud.updateLoan(cloud.data.loans.find((l) => l.toBoardId === "b2"), { endDate: D(10) });
  assert.equal(has(db, "e1", D(9)), false, "their own board's day 9 is now the loan's");
  assert.deepEqual(loans(db, "e1"), [["b2", D(3), D(10)], ["b3", D(11), D(12)]]);
});

test("a move for good ends the loan from that date", async () => {
  const { cloud, db } = setup();
  await cloud._loadEmployees();
  await cloud.setLoan(["e1"], "b2", D(3), D(10));
  await cloud.moveEmployeesToBoard(["e1"], "b3", D(6));
  assert.deepEqual(loans(db, "e1"), [["b2", D(3), D(5)]]);
  assert.equal(db.t("employees").find((e) => e.id === "e1").board_id, "b3");
});

test("capacity counts people on the board they work on each date, when asked to", () => {
  const { context } = setup();
  const Capacity = context.Capacity || context.window.Capacity;
  const emps = [{ id: "e1", boardId: "b1", contract: "permanent" }, { id: "e2", boardId: "b1", contract: "permanent" }];
  const args = { boards: [{ id: "b1" }, { id: "b2" }], employees: emps, dates: [D(2), D(3)], isForecast: () => false, confirmed: { assignments: [], missions: [] }, forecast: null };
  const plain = Capacity.aggregate(args);
  assert.equal(plain.b1[D(3)].available, 2);
  const lent = Capacity.aggregate({ ...args, boardOn: (e, d) => (e.id === "e1" && d === D(3) ? "b2" : e.boardId) });
  assert.deepEqual([lent.b1[D(2)].available, lent.b1[D(3)].available, lent.b2[D(3)].available], [2, 1, 1]);
});

test("capacity: a board's forecast date leaves loans out, its confirmed dates follow them", () => {
  const { context } = setup();
  const Capacity = context.Capacity || context.window.Capacity;
  const emps = [{ id: "e1", boardId: "b1", contract: "permanent" }, { id: "e2", boardId: "b1", contract: "permanent" }];
  // e1 is lent to b2 on D(3); Board One's D(3) is still a forecast, Board Two's is confirmed
  const boardOn = (e, d) => (e.id === "e1" && d === D(3) ? "b2" : e.boardId);
  const isForecast = (b, d) => b === "b1" && d >= D(3);
  const out = Capacity.aggregate({
    boards: [{ id: "b1" }, { id: "b2" }], employees: emps, dates: [D(3)], isForecast, boardOn,
    confirmed: { assignments: [], missions: [] },
    forecast: { assignments: [{ employee_id: "e1", plan_date: D(3), forecast_mission_id: "f1", zone: null }], missions: [{ id: "f1", board_id: "b1" }] },
  });
  assert.equal(out.b1[D(3)].available, 2, "Board One's forecast plans everyone on their own board");
  assert.equal(out.b2[D(3)].available, 1, "Board Two's confirmed day has the borrowed person");
  assert.equal(out.b1[D(3)].named, 1, "the forecast place on Board One's forecast counts there");
});

test("two saves of the same loan at once (Lend clicked twice): one loan, the other refused and the loans reloaded", async () => {
  const { cloud, db } = setup();
  await cloud._loadEmployees();
  // both start before either has written, so neither sees the other's loan
  const [a, b] = await Promise.allSettled([
    cloud.setLoan(["e1"], "b2", D(3), D(5), ""),
    cloud.setLoan(["e1"], "b2", D(3), D(5), ""),
  ]);
  assert.deepEqual(loans(db, "e1"), [["b2", D(3), D(5)]], "only one loan in the database");
  assert.deepEqual([a.status, b.status].sort(), ["fulfilled", "rejected"]);
  const err = (a.status === "rejected" ? a : b).reason;
  assert.match(err.message, /changed somewhere else at the same time/);
  assert.equal(cloud.data.loans.length, 1, "the browser shows the loan that won");
});

test("the database refuses a loan that shares a day with another of the same person", async () => {
  const { cloud, db } = setup();
  await cloud._loadEmployees();
  await cloud.setLoan(["e1"], "b2", D(3), D(5));
  cloud.data.loans = [];   // a browser that has not seen that loan yet
  await assert.rejects(cloud.setLoan(["e1"], "b3", D(5), D(6)), /changed somewhere else/);
  assert.deepEqual(loans(db, "e1"), [["b2", D(3), D(5)]]);
  await cloud.setLoan(["e1"], "b3", D(6), D(7));   // the next day is free
  await cloud.setLoan(["e2"], "b2", D(3), D(5));   // someone else on the same days is fine
  assert.deepEqual(loans(db, "e1"), [["b2", D(3), D(5)], ["b3", D(6), D(7)]]);
});
