/* Acceptance run for the Overview's board selector and section order, and for
   "nothing done today changes a past day's Overview":
     - the selector sits first, above "Needs attention today", with All boards
       plus one pill per board, and picking a board scopes every section
       (status, KPIs, Action queue, By board, the day's cards and History);
     - the page reads summary -> "In detail" -> "Over time";
     - a newcomer who later works a host leaves a past day's Host coverage risk
       as it was, and someone deactivated today stays in a past day's
       History / Trend headcount.
     NODE_PATH=$(npm root -g) node tests/e2e/overview-board-scope.e2e.js
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
    const PAST = h.prevWorking(SRC);
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    // Board Two gets a mission on SRC; PAST has one Board One mission at Host Alpha,
    // which only Person A had ever worked by then
    db.seed("missions", [
      { id: "s201", board_id: "b2", plan_date: SRC, number: "201", host: "Host Beta", customer: "Cust Beta", shift: "day", engineer_id: "eng-2" },
      { id: "p101", board_id: "b1", plan_date: PAST, number: "101", host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" },
    ]);
    db.seed("assignments", [
      { employee_id: "e9", plan_date: SRC, mission_id: "s201", zone: null },
      { employee_id: "e1", plan_date: PAST, mission_id: "p101", zone: null },
    ]);
    db.seed("deployment_history", [
      { id: "dh1", employee_id: "e1", plan_date: PAST, mission_number: "101", host: "Host Alpha", customer: "Cust Alpha", board_id: "b1" },
    ]);
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const OVERVIEW = await p.evaluate(() => OVERVIEW_ID);
    const go = (d) => p.evaluate(([x, ov]) => { state.date = x; D().activeBoardId = ov; return refreshAndRender(); }, [d, OVERVIEW]);

    await step("the selector comes first, above Needs attention, with All boards and every board", async () => {
      await go(SRC);
      const first = await p.evaluate(() => document.querySelector("#overview-panel").firstElementChild.className);
      assert.equal(first, "ov-scope-bar");
      const second = await p.evaluate(() => document.querySelector("#overview-panel").children[1].className);
      assert.equal(second, "ov-status-bar");
      const pills = await p.$$eval(".ov-scope-pill", (els) => els.map((e) => [e.textContent.trim(), e.getAttribute("aria-pressed")]));
      assert.deepEqual(pills, [["All boards10", "true"], ["Board One8", "false"], ["Board Two2", "false"]]);
    });

    await step("the page reads summary, then In detail, then Over time", async () => {
      const order = await p.evaluate(() => [...document.querySelector("#overview-panel").children].map((c) =>
        c.classList.contains("ov-group-head") ? "head:" + c.querySelector("h2").textContent
          : c.id === "overview-masonry" ? "detail-cards"
          : c.classList.contains("ov-history-group") ? "history"
          : c.querySelector("h3") ? c.querySelector("h3").textContent : c.className));
      assert.deepEqual(order, ["ov-scope-bar", "ov-status-bar", "ov-kpi-row", "Action queue", "By board",
        "head:In detail", "detail-cards", "head:Over time", "history"]);
      const cards = await p.$$eval("#overview-masonry > .ov-section > h3", (els) => els.map((e) => e.textContent));
      assert.deepEqual(cards, ["Day / night split", "By engineer", "Leave today", "Host coverage risk", "By service area"]);
    });

    await step("picking a board scopes every section, and is remembered", async () => {
      await p.click(".ov-scope-pill:has-text('Board Two')");
      await p.waitForSelector(".ov-scope-pill.active:has-text('Board Two')");
      const view = await p.evaluate(() => ({
        status: document.querySelector(".ov-status-date").textContent,
        deployed: document.querySelectorAll(".ov-kpi-tile .ov-kpi-value")[1].textContent.replace(/\s+/g, ""),
        idle: [...document.querySelectorAll(".ov-avail-cards .ov-mini")].map((m) => m.textContent),
        boardRows: [...document.querySelectorAll(".ov-section .ov-table tbody tr")].filter((r) => r.closest(".ov-section").querySelector("h3").textContent === "By board")
          .map((r) => r.querySelector(".ov-table-label").textContent.trim()),
        history: document.querySelector(".ov-history-group .ov-section-sub").textContent,
        historySelect: document.querySelectorAll(".ov-history-board").length,
        saved: localStorage.getItem("manpower.ovBoard"),
      }));
      assert.match(view.status, /Board Two$/);
      assert.equal(view.deployed, "1/2", "Board Two: 1 of its 2 people deployed");
      assert.deepEqual(view.idle, ["Person J · AREA1"], "only Board Two's idle person is listed");
      assert.deepEqual(view.boardRows, ["Board Two"], "one board picked: its row, no All boards total");
      assert.match(view.history, /Board Two/);
      assert.equal(view.historySelect, 0, "History has no board select of its own any more");
      assert.equal(view.saved, "b2");
      await p.click(".ov-scope-pill:has-text('All boards')");
      await p.waitForSelector(".ov-scope-pill.active:has-text('All boards')");
      assert.equal(await p.evaluate(() => localStorage.getItem("manpower.ovBoard")), "");
    });

    const pastCoverage = async () => {
      await p.evaluate(() => { state.overview.hostCoverageCacheKey = null; });
      await go(PAST);
      return p.evaluate(() => ({
        risk: [...document.querySelectorAll(".ov-hostrisk-row")].map((r) => r.querySelector(".ov-hostrisk-name").textContent + ":" + r.querySelector(".ov-hostrisk-count").textContent),
        crew: (state.overview.hostCoverage || {})["Host Alpha"],
      }));
    };
    const pastHeadcount = () => p.evaluate(async ([from, to]) => (await cloud.getUtilizationRange(["b1"], from, to)).b1[from].headcount, [PAST, TODAY]);

    const before = await pastCoverage();
    const beforeHead = await pastHeadcount();
    await step("a past day starts with Host Alpha as a single-person risk", async () => {
      assert.deepEqual(before.risk, ["Host Alpha:1"]);
    });

    await step("a newcomer added today and sent to Host Alpha leaves that past day's risk unchanged", async () => {
      await p.evaluate(async () => {
        await cloud.saveEmployee(null, { name: "Late Joiner", nameEn: "", trigoId: "", contract: "permanent", position: "", phone: "", startDate: "", areaId: "area-1", boardId: "b1" });
      });
      const id = db.t("employees").find((e) => e.name_th === "Late Joiner").id;
      db.seed("deployment_history", [{ id: "dh2", employee_id: id, plan_date: SRC, mission_number: "101", host: "Host Alpha", customer: "Cust Alpha", board_id: "b1" }]);
      const after = await pastCoverage();
      assert.deepEqual(after.risk, before.risk);
      // and the day the newcomer worked it does see two people
      const now = await p.evaluate((d) => cloud.getHostCoverageForHosts(["Host Alpha"], d), SRC);
      assert.equal(now["Host Alpha"].count, 2);
    });

    await step("someone deactivated today stays in a past day's History headcount", async () => {
      await p.evaluate(async () => { await cloud.setEmployeesActive(["e6"], false); });
      assert.equal(await pastHeadcount(), beforeHead);
      const todayHead = await p.evaluate(async (d) => (await cloud.getUtilizationRange(["b1"], d, d)).b1[d].headcount, TODAY);
      assert.equal(todayHead, beforeHead, "today: one newcomer in, one person deactivated out");
    });

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all overview-board-scope checks passed");
  } catch (e) {
    failed = true;
    console.error(e && e.message);
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
})();
