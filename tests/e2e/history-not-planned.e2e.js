/* Acceptance run for Overview → History when people have left and a board was not planned:
     - people deactivated before the range are not counted on its days: a fully deployed
       board reads 100% on every past day (it read ~90%: each of them sat on Standby);
     - someone deactivated TODAY is still counted on the days before today;
     - a board with no missions on a date ("not planned") is left out of the figures instead
       of reading 0%, and History names it with how many days it left out, in English and Thai;
     - picking that board alone shows no data for those days, not a row of zeros.
     NODE_PATH=$(npm root -g) node tests/e2e/history-not-planned.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 6).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const TODAY = h.iso(new Date());
    const SRC = h.isWeekend(TODAY) ? h.prevWorking(TODAY) : TODAY;
    const P2 = h.prevWorking(SRC);
    const P1 = h.prevWorking(P2);
    const LONG_AGO = h.addDays(P1, -40);
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    // Board One: Persons A-F are permanent and Persons G, H on-call. A-F (and Left Today) are on a
    // mission on P1 and P2, so those days are 100%. Three permanent people left long ago, and one
    // more, Left Today, was deactivated today: he was still there on P1 and P2.
    db.seed("employees", [
      { id: "x1", name_th: "Left One", contract: "permanent", area_id: "area-1", board_id: "b1", active: false, deactivated_on: LONG_AGO },
      { id: "x2", name_th: "Left Two", contract: "permanent", area_id: "area-1", board_id: "b1", active: false, deactivated_on: LONG_AGO },
      { id: "x3", name_th: "Left Three", contract: "permanent", area_id: "area-1", board_id: "b1", active: false, deactivated_on: LONG_AGO },
      { id: "x4", name_th: "Left Today", contract: "permanent", area_id: "area-1", board_id: "b1", active: false, deactivated_on: TODAY },
    ]);
    const missions = [], placed = [];
    [P1, P2].forEach((d, i) => {
      missions.push({ id: "p" + i, board_id: "b1", plan_date: d, number: "301", host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" });
      for (const id of ["e1", "e2", "e3", "e4", "e5", "e6", "x4"]) placed.push({ employee_id: id, plan_date: d, mission_id: "p" + i, zone: null });
    });
    db.seed("missions", missions);
    db.seed("assignments", placed);
    // Board Two (Persons I, J, both permanent) has no mission on P1 or P2: nobody planned it
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const OVERVIEW = await p.evaluate(() => OVERVIEW_ID);
    const show = (boardId) => p.evaluate(async ([d, ov, from, to, board]) => {
      state.date = d; D().activeBoardId = ov;
      state.overview.boardId = board;
      state.overview.historyPreset = "custom"; state.overview.historyFrom = from; state.overview.historyTo = to;
      state.overview.historyCacheKey = null;
      await refreshAndRender();
    }, [SRC, OVERVIEW, P1, P2, boardId || ""]);
    const history = () => p.evaluate(() => {
      const sec = document.querySelector(".ov-htiles").closest(".ov-section");   // by its tiles, so it is found in Thai too
      const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
      const note = sec.querySelector(".ov-unplanned");
      return {
        tiles: Object.fromEntries([...sec.querySelectorAll(".ov-htile")].map((t) => [text(t.querySelector(".ov-htile-label")), { value: text(t.querySelector(".ov-htile-value")), sub: text(t.querySelector(".ov-htile-sub")) }])),
        note: note ? text(note) : null,
        chips: note ? [...note.querySelectorAll(".ov-unplanned-board")].map(text) : [],
      };
    });

    await step("people who left before the range are not counted: Board One reads 100% on every past day", async () => {
      await show("b1");
      const r = await history();
      assert.equal(r.tiles["Utilization"].value, "100% avg", "7 deployed of 7 available: the three who left are out");
      assert.equal(r.tiles["Standby / day"].value, "0 avg");
      assert.equal(r.note, null, "Board One was planned on every day it worked: nothing to say");
      const head = await p.evaluate(([from, to]) => cloud.getUtilizationRange(["b1"], from, to).then((x) => [x.b1[from].headcount, x.b1[to].headcount]), [P1, P2]);
      assert.deepEqual(head, [9, 9], "Persons A-H and Left Today: the one deactivated today is still counted on the days before today");
    });

    await step("someone deactivated today is out of today's roster but was there on the days before", async () => {
      const r = await p.evaluate(([from, today]) => cloud.getUtilizationRange(["b1"], from, today).then((x) => x.b1[today].headcount - x.b1[from].headcount), [P1, SRC]);
      assert.equal(r, -1, "one fewer today than on P1: Left Today is off from today");
    });

    await step("All boards: Board Two, which nobody planned, is left out instead of reading 78%", async () => {
      await show("");
      const r = await history();
      assert.equal(r.tiles["Utilization"].value, "100% avg", "without the rule Persons I and J would be 2 on Standby: 7 of 9 = 78%");
      assert.equal(r.tiles["Standby / day"].value, "0 avg");
      assert.deepEqual(r.chips, ["Board Two 2 of 2 days"], "named, with how many of its working days were left out");
      assert.match(r.note, /^Not planned, so left out of these figures \(no missions on the board that day\):/);
    });

    await step("Board Two alone: no data on those days, not a row of zeros", async () => {
      await show("b2");
      const r = await history();
      assert.equal(r.tiles["Utilization"].value, "— avg");
      assert.equal(r.tiles["Utilization"].sub, "no data");
      assert.deepEqual(r.chips, ["Board Two 2 of 2 days"]);
    });

    await step("in Thai the sentence and the count read in Thai", async () => {
      await p.evaluate(() => I18N.setLang("th"));
      await show("");
      const r = await history();
      assert.match(r.note, /ไม่ได้วางแผน/);
      assert.deepEqual(r.chips, ["Board Two 2 จาก 2 วัน"], "the board's name stays as typed");
      assert.doesNotMatch(r.note, /left out|no missions/, "no English left in the sentence");
      await p.evaluate(() => I18N.setLang("en"));
    });

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all history-not-planned checks passed");
  } catch (e) {
    failed = true;
    console.error(e && e.message);
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
})();
