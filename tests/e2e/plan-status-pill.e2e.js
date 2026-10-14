/* Acceptance run for the date pill saying where the plan stands (PlanStatus):
   an empty next working day reads Not planned, missions added straight onto it
   read Draft · Not reviewed, a carry-over stamp makes it Planned, a lock makes
   it Final · Locked, an empty weekend reads Holiday and a past day reads Record.
     NODE_PATH=$(npm root -g) node tests/e2e/plan-status-pill.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
const H = h.nextWorking(T);                       // the last confirmed day
const PAST = h.prevWorking(SRC);
let WEEKEND = h.addDays(PAST, -1);                // a past weekend day
while (!h.isWeekend(WEEKEND)) WEEKEND = h.addDays(WEEKEND, -1);

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 14).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  try {
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const go = (d) => p.evaluate((x) => { cloud.data.plans = {}; state.date = x; return refreshAndRender(); }, d);
    const pill = async () => ({ text: (await p.textContent("#mode-pill")).replace(/\s*·\s*/g, " · ").replace(/\s+/g, " ").trim(), state: await p.getAttribute("#mode-pill", "data-state") });

    await step("an empty next working day reads Not planned", async () => {
      await go(H);
      assert.deepEqual(await pill(), { text: "Not planned", state: "empty" });
    });
    await step("a mission added straight onto it reads Draft · Not reviewed", async () => {
      db.seed("missions", [{ id: "h1", board_id: "b1", plan_date: H, number: "901", host: "Host Alpha", customer: "C", shift: "day", engineer_id: "eng-1" }]);
      await go(H);
      assert.deepEqual(await pill(), { text: "Draft · Not reviewed", state: "draft" });
    });
    await step("carried over (stamped) it reads Planned", async () => {
      // the day already has a stamp row (its last edit); the carry fills in carried_from
      const st = db.t("plan_day_stamps").find((x) => x.board_id === "b1" && x.plan_date === H);
      Object.assign(st, { carried_from: SRC, carried_at: new Date().toISOString() });
      await go(H);
      assert.deepEqual(await pill(), { text: "Planned", state: "planned" });
    });
    await step("locked it reads Final · Locked", async () => {
      db.seed("plan_days", [{ board_id: "b1", plan_date: H, locked_by: h.USERS.a.email, locked_at: new Date().toISOString() }]);
      await p.evaluate(() => refreshAndRender());
      await go(H);
      assert.deepEqual(await pill(), { text: "Final · Locked", state: "locked" });
    });
    await step("an empty past weekend reads Holiday · Read-only", async () => {
      await go(WEEKEND);
      assert.deepEqual(await pill(), { text: "Holiday · Read-only", state: "holiday past" });
    });
    await step("a past day with missions reads Record · Read-only, never Draft", async () => {
      db.seed("missions", [{ id: "p1", board_id: "b1", plan_date: PAST, number: "902", host: "Host Alpha", customer: "C", shift: "day", engineer_id: "eng-1" }]);
      await go(PAST);
      assert.deepEqual(await pill(), { text: "Record · Read-only", state: "draft past" });
    });
    await a.close();
  } finally {
    await env.close();
  }
})().catch(() => { process.exitCode = 1; });
