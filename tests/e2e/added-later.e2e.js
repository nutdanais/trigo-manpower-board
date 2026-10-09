/* Acceptance run for "people added later never change a past day": two
   employees are added through the app today (the New Employee form's own save
   call, so the database stamps added_on = today), and an earlier, confirmed
   working day must read exactly as it did before — board pools and stats, Org
   Chart, Overview roster, Trend headcount and the Excel sheets. Their Manpower
   List 30D figure counts only the days since they were added.
     NODE_PATH=$(npm root -g) node tests/e2e/added-later.e2e.js
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
    const PAST = h.prevWorking(SRC);                       // a confirmed working day before anyone new joined
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    // PAST is a finished, confirmed day on Board One: one mission, one person on leave
    db.seed("missions", [{ id: "p101", board_id: "b1", plan_date: PAST, number: "101", host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" }]);
    db.seed("assignments", [
      { employee_id: "e1", plan_date: PAST, mission_id: "p101", zone: null },
      { employee_id: "e2", plan_date: PAST, mission_id: "p101", zone: null },
      { employee_id: "e3", plan_date: PAST, mission_id: null, zone: "sick" },
    ]);
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const go = (d, board = "b1") => p.evaluate(([x, b]) => { state.date = x; D().activeBoardId = b; return refreshAndRender(); }, [d, board]);

    /* everything a past day shows about who was on Board One */
    const snapshot = async () => {
      await go(PAST);
      const board = await p.evaluate(() => {
        const s = boardStats("b1");
        return {
          stats: [s.total, s.assigned, s.leave, s.standby, s.oncallAvailable],
          pool: [...document.querySelectorAll("#float-pool .emp-card, [data-pool] .emp-card")].map((c) => c.textContent.trim()).sort(),
          xlsx: (() => { const g = xlsxGroups(); return { standby: g.standby.map((x) => x.name), oncall: g.oncall.map((x) => x.name), leave: g.leave.map((x) => x.name) }; })(),
          roster: D().employees.filter(onRoster).map((e) => e.name).sort(),
        };
      });
      const trend = await p.evaluate(async (d) => (await cloud.getUtilizationRange(["b1"], d, d)).b1[d].headcount, PAST);
      await go(PAST, ORGCHART_ID_FOR_TEST);
      await p.waitForSelector("#oc-outline .oc-ol-row");
      await p.selectOption("#oc-level", "all");
      const org = await p.evaluate(() => ({
        people: [...document.querySelectorAll("#oc-outline .oc-ol-row.l-employee .oc-nm")].map((n) => n.textContent.trim()).sort(),
        root: document.querySelector("#oc-outline .oc-ol-row.l-root .oc-cnt").textContent,
      }));
      return { ...board, trend, org };
    };
    const ORGCHART_ID_FOR_TEST = await p.evaluate(() => ORGCHART_ID);

    const before = await snapshot();
    let newIds = [];

    await step("two people are added through the app today", async () => {
      await go(SRC);
      await p.evaluate(async () => {
        await cloud.saveEmployee(null, { name: "Late Joiner Perm", nameEn: "", trigoId: "", contract: "permanent", position: "", phone: "", startDate: "", areaId: "area-1", boardId: "b1" });
        await cloud.saveEmployee(null, { name: "Late Joiner Oncall", nameEn: "", trigoId: "", contract: "oncall", position: "", phone: "", startDate: "", areaId: "area-1", boardId: "b1" });
        await refreshAndRender();
      });
      const rows = db.t("employees").filter((e) => e.name_th.startsWith("Late Joiner"));
      assert.equal(rows.length, 2);
      for (const r of rows) assert.equal(r.added_on, TODAY, "the database stamps the day they were added");
      newIds = rows.map((r) => r.id);
    });

    const after = await snapshot();

    await step("the past board's pools and stats are unchanged", async () => {
      assert.deepEqual(after.stats, before.stats);
      assert.deepEqual(after.pool, before.pool);
      assert.ok(!after.pool.some((t) => t.includes("Late Joiner")));
    });
    await step("the past day's Org Chart is unchanged", async () => {
      assert.deepEqual(after.org, before.org);
      assert.ok(!after.org.people.some((t) => t.includes("Late Joiner")));
    });
    await step("the past day's Excel sheets, Overview roster and Trend headcount are unchanged", async () => {
      assert.deepEqual(after.xlsx, before.xlsx);
      assert.deepEqual(after.roster, before.roster);
      assert.equal(after.trend, before.trend);
    });

    await step("from today on they are there, unassigned", async () => {
      await go(TODAY);
      assert.equal(await p.locator(".emp-card", { hasText: "Late Joiner Perm" }).count() > 0, true);
      assert.equal(await p.locator(".emp-card", { hasText: "Late Joiner Oncall" }).count() > 0, true);
    });

    if (!h.isWeekend(TODAY)) {
      await step("their 30D figure counts only the days since they were added", async () => {
        await go(TODAY);
        await p.evaluate((id) => assignEmployeesTo([id], { missionId: "s101" }), newIds[0]);
        await p.waitForFunction((id) => getPlan().missions.some((m) => m.members.includes(id)), newIds[0]);
        const util = await p.evaluate(async (ids) => {
          state.emplist.utilCacheKey = null;
          await ensureEmplistUtilLoaded();
          return ids.map((id) => state.emplist.util[id]);
        }, newIds);
        assert.deepEqual(util, [100, 0], "1 day worked of the 1 working day since joining; the on-call newcomer 0 of 1");
      });
    }

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all added-later checks passed");
  } catch (e) {
    failed = true;
    console.error(e && e.message);
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
})();
