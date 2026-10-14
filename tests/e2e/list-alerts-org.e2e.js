/* Acceptance run for:
     - the "By area" chips on Manpower and Host filter the table (click again
       to show everyone), No area included;
     - the Manpower alert pills keep the column and offer "+ Add …" buttons
       that open Edit Employee on the missing field;
     - the Org chart uses the toolbar's Board dropdown (no Board filter) and
       labels a mission lead with their account's role.
     NODE_PATH=$(npm root -g) node tests/e2e/list-alerts-org.e2e.js
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
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    // Eng One is linked to the admin account, whose role is Manager here
    const MGR = h.USERS.a.id;
    db.rpcs.engineer_directory = () => [{ id: MGR, display_name: "Eng One", full_name: "", phone: "", role_key: "manager", rank: 20, engineer_id: "eng-1" }];
    for (const e of db.tables.engineers) if (e.id === "eng-1") e.profile_id = MGR;
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const go = (id) => p.evaluate(([d, x]) => { state.date = d; D().activeBoardId = eval(x); return refreshAndRender(); }, [SRC, id]);

    await step("Manpower: an area chip filters the table, a second click shows everyone", async () => {
      await go("EMPLIST_ID");
      await p.evaluate(() => { D().employees.find(e => e.id === "e10").areaId = null; renderStats(); renderEmployeeRows(); });
      const rows = () => p.locator("#emplist-body tr").count();
      assert.equal(await rows(), 10);
      await p.click('#emplist-area-bar .ac-btn[data-area-key="__none__"]');
      assert.equal(await rows(), 1, "No area shows the one person without an area");
      assert.equal(await p.getAttribute('#emplist-area-bar .ac-btn[data-area-key="__none__"]', "aria-pressed"), "true");
      await p.click('#emplist-area-bar .ac-btn[data-area-key="__none__"]');
      assert.equal(await rows(), 10);
    });

    await step("Manpower: missing TRIGO ID keeps the column, with + Add TRIGO ID opening the field", async () => {
      await p.click('#board-status .status-chip:has-text("missing TRIGO ID")');
      assert.equal(await p.locator("#emplist-table thead th.col-off:has-text('TRIGO ID')").count(), 0, "column stays");
      assert.ok(await p.locator("#emplist-body .el-fix[data-fix=trigoId]").count() > 0);
      await p.locator("#emplist-body .el-fix[data-fix=trigoId]").first().click();
      await p.waitForSelector("#modal-employee:not(.hidden)");
      assert.equal(await p.evaluate(() => document.activeElement.name), "trigoId");
      await p.evaluate(() => closeModal());
      await p.click('#board-status .status-chip:has-text("missing TRIGO ID")');
    });

    await step("Host: an area chip filters the table", async () => {
      await go("HOSTLIST_ID");
      await p.waitForFunction(() => allHostRows().length >= 3);
      const before = await p.locator("#hostlist-body tr").count();
      await p.click('#area-bar .ac-btn[data-area-key="__none__"]');
      assert.equal(await p.locator("#hostlist-body tr").count(), before, "every seeded host has no area");
      assert.deepEqual(await p.evaluate(() => state.hostlist.filters.areaId), ["__none__"]);
      await p.click('#area-bar .ac-btn[data-area-key="__none__"]');
      assert.deepEqual(await p.evaluate(() => state.hostlist.filters.areaId), []);
    });

    await step("Org chart: Board dropdown instead of a Board filter; a lead shows their account role", async () => {
      await go("ORGCHART_ID");
      assert.equal(await p.isVisible("#btn-ov-board"), true);
      assert.equal(await p.locator('.oc-ms[data-dim="boards"]').count(), 0);
      await p.click('.oc-view-btn[data-v="chart"]');
      const lvls = await p.$$eval("#oc-tree .oc-box.is-engineer .oc-lvl", (els) => els.map((e) => e.textContent));
      assert.ok(lvls.includes("Manager"), "Eng One reads Manager: " + lvls);
      assert.ok(lvls.includes("Engineer"), "an unlinked lead still reads Engineer");
      await p.evaluate(() => setOvBoard("b2"));
      const boards = await p.$$eval("#oc-tree .oc-box.is-board .oc-ttl", (els) => els.map((e) => e.textContent.trim()));
      assert.deepEqual(boards, ["Board Two"]);
      await p.evaluate(() => setOvBoard(""));
    });

    await step("Org chart canvas stays light when the computer is in dark mode", async () => {
      await p.emulateMedia({ colorScheme: "dark" });
      const ground = await p.evaluate(() => getComputedStyle(document.querySelector("#orgchart-panel")).getPropertyValue("--oc-ground").trim());
      assert.equal(ground, "#f6f8fb");
      await p.emulateMedia({ colorScheme: "light" });
    });
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
  }
  if (failed) process.exit(1);
  console.log("all list-alerts-org checks passed");
})();
