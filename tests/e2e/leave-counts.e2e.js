/* Acceptance run for the leave headcounts on a board and the Standby / Leave
   filter on the Org Chart, driving the real app in Chromium against the shared
   fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/leave-counts.e2e.js
   Seed (harness.seedBase): Board One has four people on missions, one on annual
   leave, one permanent and two on-call people unplaced; Board Two has two
   unplaced. Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 5).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);

    const zoneCount = (z) => p.locator(`.zone[data-zone="${z}"] .zone-count`).innerText();

    await step("each leave zone shows its headcount, like a mission card", async () => {
      assert.equal(await zoneCount("annual"), "1");
      for (const z of ["sick", "business", "unpaid", "exchange"]) assert.equal(await zoneCount(z), "0", z);
      const missionCounts = await p.locator("#missions-grid .m-count").allInnerTexts();
      assert.deepEqual(missionCounts.map(Number).sort(), [1, 1, 2]);
    });

    await step("the count follows a move into a leave zone", async () => {
      await p.evaluate(() => assignEmployeesTo(["e6"], { zone: "sick" }));
      await p.waitForFunction(() => document.querySelector('.zone[data-zone="sick"] .zone-count').textContent === "1");
      assert.equal(await zoneCount("annual"), "1");
    });

    // Org Chart, everything expanded so every person is a row in the outline
    await p.click(".tab-orgchart");
    await p.waitForSelector("#oc-outline .oc-ol-row");
    await p.selectOption("#oc-level", "all");
    const people = () => p.locator("#oc-outline .oc-ol-row.l-employee").count();
    const pools = () => p.locator("#oc-outline .oc-ol-row.l-bucket").count();
    const statusDrop = p.locator('.oc-ms[data-dim="statuses"]');
    const statusLabel = async () => (await statusDrop.locator(".oc-ms-btn").innerText()).replace(/\s+/g, " ").trim();
    const toggle = async (key) => {
      if (!(await statusDrop.locator(".oc-ms-pop").isVisible())) await statusDrop.locator(".oc-ms-btn").click();
      await statusDrop.locator(`input[value="${key}"]`).click();
    };

    await step("by default the chart includes everyone on standby and leave", async () => {
      // 4 on missions + Board One's pool (annual, sick, 2 on-call standby) + Board Two's 2 standby
      assert.equal(await people(), 10);
      assert.equal(await pools(), 2);
      assert.equal(await statusLabel(), "Standby / Leave: All");
    });

    await step("the filter lists standby and every leave type with today's count", async () => {
      await statusDrop.locator(".oc-ms-btn").click();
      const labels = await statusDrop.locator(".oc-ms-pop label").allInnerTexts();
      assert.deepEqual(labels.map((s) => s.trim()), [
        "Standby (4)", "Annual Leave (1)", "Sick Leave (1)", "Business Leave (0)", "Unpaid Leave (0)", "Exchange Working Day (0)",
      ]);
    });

    await step("leaving out standby keeps the people on leave", async () => {
      await toggle("standby");
      assert.equal(await people(), 6);
      assert.equal(await pools(), 1, "Board Two's pool was all standby, so it goes");
      assert.equal(await statusLabel(), "Standby / Leave: 5/6");
    });

    await step("leaving out the leave types too shows only the people on missions", async () => {
      await toggle("annual");
      await toggle("sick");
      assert.equal(await people(), 4);
      assert.equal(await pools(), 0);
      // the root's crew count follows what is shown
      assert.match(await p.locator("#oc-outline .oc-ol-row.l-root .oc-cnt").innerText(), /· 4 crew$/);
    });

    await step("All brings everyone back", async () => {
      await statusDrop.locator("[data-all]").click();
      assert.equal(await people(), 10);
      assert.equal(await pools(), 2);
    });

    await step("the choice survives a change of day", async () => {
      await statusDrop.locator("[data-none]").click();
      assert.equal(await people(), 4);
      await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, h.nextWorking(SRC));
      await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);
      await p.waitForSelector("#oc-outline .oc-ol-row");
      await p.selectOption("#oc-level", "all");
      assert.equal(await people(), 4);
      assert.equal(await pools(), 0);
    });

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all leave-count checks passed");
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
})();
