/* Acceptance run for "On the board from" (employees.added_on): people added to
   the app on a given day are left out of every earlier day's board, stats and
   Overview numbers, and counted from that day on. The Edit Employee form shows
   and saves the date.
     NODE_PATH=$(npm root -g) node tests/e2e/added-on.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

(async () => {
  const env = await h.launch();
  try {
    const T = h.iso(new Date());
    const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
    const PAST = h.prevWorking(h.prevWorking(SRC));          // an earlier working day
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    // three people on Board One who joined the app on SRC (like the LCB Port import)
    db.seed("employees", ["X", "Y", "Z"].map((n, i) => ({ id: "n" + i, name: "Newcomer " + n, contract: "permanent", area_id: "area-1", board_id: "b1", added_on: SRC })));
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const stat = (label) => p.evaluate((l) => {
      const chip = [...document.querySelectorAll("#stats-bar .stat-chip")].find((c) => c.textContent.trim().startsWith(l + ":"));
      return chip ? Number(chip.querySelector("b").textContent) : null;
    }, label);
    const go = (d) => p.evaluate((x) => { state.date = x; return refreshAndRender(); }, d);

    await go(SRC);
    const todayTotal = await stat("Total");
    await go(PAST);
    assert.equal(await stat("Total"), todayTotal === null ? null : todayTotal - 3, "the 3 newcomers are not on the board before the day they were added");
    // nobody is assigned on PAST, so Standby = the 6 permanent people already on Board One (9 if the newcomers leaked in)
    assert.equal(await stat("Standby"), 6, "and are not counted as Standby either");
    const pastCards = await p.locator(".emp-card", { hasText: "Newcomer" }).count();
    assert.equal(pastCards, 0, "no newcomer card on an earlier day");
    console.log("ok - the board and its stats skip people not yet added");

    await go(SRC);
    assert.ok(await p.locator(".emp-card", { hasText: "Newcomer X" }).count() > 0, "on their first day they appear");
    console.log("ok - they appear on the very day they were added");

    // Overview KPI on the earlier day uses the same roster
    const kpiTotal = (d) => p.evaluate(async (x) => {
      state.date = x; D().activeBoardId = OVERVIEW_ID; await refreshAndRender();
      return D().employees.filter(onRoster).length;
    }, d);
    assert.equal((await kpiTotal(SRC)) - (await kpiTotal(PAST)), 3);
    console.log("ok - Overview roster differs by exactly the newcomers");

    // Trend/History headcount per day
    const hc = await p.evaluate(async ([from, to]) => {
      const r = await cloud.getUtilizationRange(D().boards.map((b) => b.id), from, to);
      return [r.b1[from].headcount, r.b1[to].headcount];
    }, [PAST, SRC]);
    assert.equal(hc[1] - hc[0], 3);
    console.log("ok - the Trend/History headcount steps up on the day they were added");

    // Edit Employee form
    await p.evaluate(() => { D().activeBoardId = "b1"; return refreshAndRender(); });
    await p.evaluate(() => { openEmployeeModal("n0"); state.employeeTab = "edit"; applyEmployeeTab(); });
    assert.equal(await p.inputValue("#form-employee input[name=addedOn]"), SRC);
    await p.fill("#form-employee input[name=addedOn]", PAST);
    await p.click("#form-employee button[type=submit]");
    await p.waitForSelector("#modal-employee", { state: "hidden" });
    assert.equal(db.t("employees").find((e) => e.id === "n0").added_on, PAST);
    await go(PAST);
    assert.equal(await p.locator(".emp-card", { hasText: "Newcomer X" }).count() > 0, true, "back-dated person shows from the corrected day");
    console.log("ok - the form shows and corrects the date");

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all added-on checks passed");
  } finally {
    await env.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
