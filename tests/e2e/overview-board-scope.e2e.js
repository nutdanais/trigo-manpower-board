/* Acceptance run for the Overview's board selector and section order, and for
   "nothing done today changes a past day's Overview":
     - the selector sits first, above the attention card, with All boards
       plus one pill per board, and picking a board scopes every section
       (attention card, KPIs, By board, the day's cards and History);
     - the page reads summary -> "In detail" (By engineer | By service area,
       Shifts | Host coverage) -> "Over time" (History, Engineer workload);
     - the idle names follow the "Action queue" permission, and Engineer
       workload ranks engineers with missions and crew in one table;
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

    await step("the board dropdown leads the toolbar (which stays in view), with All boards and every board", async () => {
      await go(SRC);
      const first = await p.evaluate(() => document.querySelector("#overview-panel").firstElementChild.className);
      assert.match(first, /^ov-attn/, "the dashboard starts with the attention card");
      assert.equal(await p.isVisible("#ov-board-select"), true);
      assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById("toolbar")).position), "sticky");
      assert.equal(await p.locator("#stats-bar .stat-tile").count(), 0, "Overview row 2 is a plain summary line, not the board tiles");
      const opts = await p.$$eval("#ov-board-select option", (els) => els.map((e) => [e.textContent.trim(), e.selected]));
      assert.deepEqual(opts, [["All boards (10)", true], ["Board One (8)", false], ["Board Two (2)", false]]);
    });

    await step("the page reads summary, then In detail, then Over time", async () => {
      const order = await p.evaluate(() => [...document.querySelector("#overview-panel").children].map((c) =>
        c.classList.contains("ov-group-head") ? "head:" + c.querySelector("h2").textContent
          : c.classList.contains("ov-detail-grid") ? "detail-cards"
          : c.querySelector("h3") ? c.querySelector("h3").firstChild.textContent.trim() : c.className.split(" ")[0]));
      assert.deepEqual(order, ["ov-attn", "ov-kpi-row", "By board",
        "head:In detail", "detail-cards", "head:Over time", "History", "Engineer workload"]);
      const cards = await p.$$eval(".ov-detail-grid > .ov-section > h3", (els) => els.map((e) => e.textContent));
      assert.deepEqual(cards, ["By engineer", "By service area", "Shifts", "Host coverage"]);
    });

    await step("By service area shows each contract type's count; Engineer workload ranks with missions and crew together", async () => {
      const area = await p.$$eval(".ov-area-row:not(.ov-area-row-grandtotal) .ov-area-row-pct", (els) => els.map((e) => e.textContent));
      assert.deepEqual(area, ["8 P · 2 OC"], "Board One + Board Two in AREA1: 8 permanent, 2 on-call");
      const wl = await p.evaluate(() => {
        const sec = [...document.querySelectorAll(".ov-section")].find((x) => x.querySelector("h3").textContent === "Engineer workload");
        const rows = [...sec.querySelectorAll("tbody tr:not(.ov-table-totalrow)")];
        return {
          names: rows.map((r) => r.querySelector(".ov-table-label").textContent),
          heads: [...sec.querySelectorAll("thead th")].map((t) => t.textContent),
          split: rows.map((r) => r.querySelectorAll(".ov-rk-sub")[1].textContent),
          shares: rows.map((r) => parseInt(r.lastElementChild.textContent, 10)),
          switches: sec.querySelectorAll("button").length,
        };
      });
      assert.deepEqual(wl.names, ["Eng One", "Eng Two"], "tied on missions, so more crew ranks first");
      assert.deepEqual(wl.heads.slice(0, 3), ["Engineer", "Missions / day", "Crew / day"]);
      assert.ok(wl.split.every((t) => /permanent · .* on-call/.test(t)), "each engineer's crew is split by contract type");
      assert.equal(wl.shares.reduce((a, b) => a + b, 0), 100);
      assert.equal(wl.switches, 0, "no Missions / Crew switch: both are in the table");
    });

    await step("picking a board scopes every section, and is remembered", async () => {
      await p.selectOption("#ov-board-select", "b2");
      await p.waitForFunction(() => document.querySelector("#ov-board-select").value === "b2" && /Board Two/.test(document.querySelector(".ov-attn-sub").textContent));
      const view = await p.evaluate(() => ({
        title: document.querySelector(".ov-attn-title").textContent.trim(),
        sub: document.querySelector(".ov-attn-sub").textContent,
        deployed: document.querySelectorAll(".ov-kpi-tile .ov-kpi-value")[1].textContent.replace(/\s+/g, ""),
        idle: [...document.querySelectorAll(".ov-attn-groups .ov-mini")].map((m) => m.textContent),
        boardRows: [...document.querySelectorAll(".ov-boards-table tbody tr")].map((r) => r.querySelector(".ov-table-label").textContent.trim()),
        overTime: [...document.querySelectorAll(".ov-group-head")].pop().textContent,
        historySelect: document.querySelectorAll(".ov-history-board").length,
        saved: localStorage.getItem("manpower.ovBoard"),
      }));
      assert.equal(view.title, "1 permanent staff member has no mission");
      assert.match(view.sub, /Board Two/);
      assert.equal(view.deployed, "1/2", "Board Two: 1 of its 2 people deployed");
      assert.deepEqual(view.idle, ["Person J"], "only Board Two's idle person is listed");
      assert.deepEqual(view.boardRows, ["Board Two"], "one board picked: its row, no All boards total");
      assert.match(view.overTime, /Board Two/);
      assert.equal(view.historySelect, 0, "History has no board select of its own any more");
      assert.equal(view.saved, "b2");
      await p.selectOption("#ov-board-select", "");
      await p.waitForFunction(() => document.querySelector("#ov-board-select").value === "");
      assert.equal(await p.evaluate(() => localStorage.getItem("manpower.ovBoard")), "");
    });

    const pastCoverage = async () => {
      await p.evaluate(() => { state.overview.hostCoverageCacheKey = null; });
      await go(PAST);
      return p.evaluate(() => ({
        risk: [...document.querySelectorAll(".ov-host")].map((r) => r.querySelector(".ov-host-name").textContent + ":" + r.querySelectorAll(".ov-person").length),
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

    await step("without the Action queue permission the card keeps its headline but lists no names", async () => {
      db.t("role_permissions").find((r) => r.role_key === "viewer" && r.area === "ov.actionQueue").level = "none";
      const v = await env.openAs(db, h.USERS.v);
      await v.page.evaluate(([d, ov]) => { state.date = d; D().activeBoardId = ov; return refreshAndRender(); }, [SRC, OVERVIEW]);
      const seen = await v.page.evaluate(() => ({
        title: document.querySelector(".ov-attn-title") && document.querySelector(".ov-attn-title").textContent.trim(),
        names: document.querySelectorAll(".ov-attn .ov-mini").length,
      }));
      assert.match(seen.title || "", /permanent staff (have|member has) no mission/);
      assert.equal(seen.names, 0);
      assert.deepEqual(v.errors, [], "no console errors for the viewer");
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
