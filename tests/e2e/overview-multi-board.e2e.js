/* Acceptance run for picking more than one board on the Overview, and for the Period group's own scope:
     - the toolbar picker is a tick list: All boards, a checkbox and an Only shortcut per board, any 1 to 4
       boards, at least one stays ticked, ticking every board is "All boards", the choice is a comma list
       remembered per device (an older single id still reads);
     - the day sections (attention card, tiles, By board) follow the ticked boards;
     - the Period group is LINKED to the page by default; unlinked it keeps its own boards;
     - Period view: Combined, Side by side (two or more boards), A vs B (exactly two). A vs B overlays the
       two boards, shows both averages on each tile and a Difference row, and turns Compare with off;
     - the Report names the Period's boards; Thai shows no English; a phone has no sideways scroll.
     NODE_PATH=$(npm root -g) node tests/e2e/overview-multi-board.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 8).join("\n   ")); throw e; }
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
    // two more boards, four in all, each with two permanent people
    db.seed("boards", [{ id: "b3", name: "Board Three", weekend_days: [0, 6] }, { id: "b4", name: "Board Four", weekend_days: [0, 6] }]);
    db.seed("employees", [
      { id: "e21", name_th: "Person P", contract: "permanent", area_id: "area-1", board_id: "b3" },
      { id: "e22", name_th: "Person Q", contract: "permanent", area_id: "area-1", board_id: "b3" },
      { id: "e31", name_th: "Person R", contract: "permanent", area_id: "area-1", board_id: "b4" },
      { id: "e32", name_th: "Person S", contract: "permanent", area_id: "area-1", board_id: "b4" },
    ]);
    // every board has a mission on both days; on SRC Board Three has both people on it, Board Four one of two
    db.seed("missions", [
      { id: "s201", board_id: "b2", plan_date: SRC, number: "201", host: "Host Beta", customer: "Cust Beta", shift: "day", engineer_id: "eng-2" },
      { id: "s301", board_id: "b3", plan_date: SRC, number: "301", host: "Host Gamma", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" },
      { id: "s401", board_id: "b4", plan_date: SRC, number: "401", host: "Host Alpha", customer: "Cust Beta", shift: "night", engineer_id: "eng-2" },
      { id: "p101", board_id: "b1", plan_date: PAST, number: "101", host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" },
      { id: "p201", board_id: "b2", plan_date: PAST, number: "201", host: "Host Beta", customer: "Cust Beta", shift: "day", engineer_id: "eng-2" },
      { id: "p301", board_id: "b3", plan_date: PAST, number: "301", host: "Host Gamma", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" },
      { id: "p401", board_id: "b4", plan_date: PAST, number: "401", host: "Host Alpha", customer: "Cust Beta", shift: "night", engineer_id: "eng-2" },
    ]);
    db.seed("assignments", [
      { employee_id: "e9", plan_date: SRC, mission_id: "s201", zone: null },
      { employee_id: "e21", plan_date: SRC, mission_id: "s301", zone: null },
      { employee_id: "e22", plan_date: SRC, mission_id: "s301", zone: null },
      { employee_id: "e31", plan_date: SRC, mission_id: "s401", zone: null },
      { employee_id: "e1", plan_date: PAST, mission_id: "p101", zone: null },
      { employee_id: "e9", plan_date: PAST, mission_id: "p201", zone: null },
      { employee_id: "e21", plan_date: PAST, mission_id: "p301", zone: null },
      { employee_id: "e31", plan_date: PAST, mission_id: "p401", zone: null },
      { employee_id: "e32", plan_date: PAST, mission_id: "p401", zone: null },
    ]);
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const OVERVIEW = await p.evaluate(() => OVERVIEW_ID);
    const show = () => p.evaluate(async ([day, ov, f, t]) => {
      state.date = day; D().activeBoardId = ov;
      Object.assign(state.overview, { historyPreset: "custom", historyFrom: f, historyTo: t, historyCacheKey: null, historyMeasure: "deployed", historyGroup: "day", historyCompare: "prev", baView: "board" });
      await refreshAndRender();
    }, [SRC, OVERVIEW, PAST, SRC]);
    await show();
    const text = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, " ").trim()), sel);
    const label = () => p.locator("#btn-ov-board .ovb-label").textContent();
    const tick = async (name) => { await p.click(`#ov-board-menu .ovb-row:has(.ovb-name:text-is('${name}')) .ovb-check`); };
    const saved = () => p.evaluate(() => localStorage.getItem("manpower.ovBoard"));
    const view = (name) => p.locator('.ov-period-scope [aria-label="Period board view"] .btn', { hasText: name }).first();

    await step("the picker is a tick list of four boards, all ticked to begin with", async () => {
      await p.click("#btn-ov-board");
      const rows = await p.$$eval("#ov-board-menu .ovb-row", (els) => els.map((e) => [e.querySelector(".ovb-name").textContent, e.querySelector(".ovb-check").getAttribute("aria-checked")]));
      assert.deepEqual(rows, [["All boards", "true"], ["Board One", "true"], ["Board Two", "true"], ["Board Three", "true"], ["Board Four", "true"]]);
      assert.equal(await p.locator("#ov-board-menu .ovb-only").count(), 4, "an Only shortcut on each board");
      assert.equal(await label(), "All boards");
    });

    await step("unticking boards narrows the page; the menu stays open while you tick; the choice is saved as a list", async () => {
      await tick("Board Two");
      await tick("Board Four");
      assert.equal(await p.locator("#ov-board-menu").isVisible(), true, "the menu stays open");
      assert.equal(await label(), "Board One + Board Three");
      assert.equal(await saved(), "b1,b3");
      const sub = await p.locator(".ov-attn-sub").first().textContent();
      assert.match(sub, /Board One \+ Board Three/);
      assert.deepEqual(await text(".ov-boards-table tbody tr .ov-table-label").then((x) => x.filter((n) => /^Board \w+$/.test(n))), ["Board One", "Board Three"], "By board lists only the ticked boards");
      const all = await p.$eval("#ov-board-menu .ovb-check[data-key=all]", (e) => e.getAttribute("aria-checked"));
      assert.equal(all, "mixed", "All boards shows a mixed state");
      await tick("Board Four");
      assert.equal(await label(), "3 of 4 boards");
      assert.equal(await saved(), "b1,b3,b4");
    });

    await step("at least one board stays ticked; ticking all four is All boards; Only picks one and closes the menu", async () => {
      await tick("Board Four"); await tick("Board Three");           // b1 left
      await tick("Board One");                                         // refused
      assert.equal(await label(), "Board One");
      assert.match(await p.locator("#ov-board-menu .ovb-note").textContent(), /At least one board stays ticked/);
      await tick("Board Two"); await tick("Board Three"); await tick("Board Four");
      assert.equal(await label(), "All boards", "every board ticked means All boards");
      assert.equal(await saved(), "");
      await p.click("#ov-board-menu .ovb-row:has(.ovb-name:text-is('Board Three')) .ovb-only");
      assert.equal(await p.locator("#ov-board-menu").isVisible(), false, "Only closes the menu");
      assert.equal(await label(), "Board Three");
      assert.equal(await saved(), "b3");
    });

    await step("an older saved single id still reads, and a deleted board drops out of a saved list", async () => {
      assert.deepEqual(await p.evaluate(() => { localStorage.setItem("manpower.ovBoard", "b2"); return ovBoardSaved(); }), ["b2"]);
      assert.deepEqual(await p.evaluate(() => { localStorage.setItem("manpower.ovBoard", "b1,gone"); state.overview.boardIds = ovBoardSaved(); return ovScopeBoards().map((b) => b.id); }), ["b1"]);
      await p.evaluate(() => setOvBoard(["b1", "b3"]));
      assert.equal(await label(), "Board One + Board Three");
    });

    await step("the Period starts linked to the page: its heading, boards and sections follow the page", async () => {
      await show();
      await p.evaluate(() => setOvBoard(["b1", "b3"]));
      const head = await p.locator(".ov-period .ov-group-sub").textContent();
      assert.match(head, /Board One \+ Board Three/);
      assert.equal(await p.locator(".ov-period-scope .btn", { hasText: "Linked to page" }).getAttribute("aria-pressed"), "true");
      assert.equal(await p.locator(".ov-period-boards .btn:disabled").count(), 4, "the board buttons are off while linked");
      const ba = await text(".ov-ba-table tbody tr .ov-table-label");
      assert.deepEqual(ba.filter((n) => /^Board \w+$/.test(n)), ["Board One", "Board Three"]);
      assert.equal(ba[ba.length - 1], "Board One + Board Three", "the total row names the boards, not All boards");
    });

    await step("unlinking gives the Period its own boards, and the page keeps its own", async () => {
      await p.locator(".ov-period-scope .btn", { hasText: "Linked to page" }).click();
      assert.equal(await p.locator(".ov-period-scope .btn", { hasText: "Own boards" }).count(), 1);
      await p.locator(".ov-period-boards .btn", { hasText: "Board Four" }).click();
      await p.locator(".ov-period-boards .btn", { hasText: "Board One" }).click();
      const head = await p.locator(".ov-period .ov-group-sub").textContent();
      assert.match(head, /Board Three \+ Board Four/, "the Period shows its own boards");
      assert.match(await p.locator(".ov-attn-sub").first().textContent(), /Board One \+ Board Three/, "the day sections keep the page's boards");
      // the last board cannot be unticked
      await p.locator(".ov-period-boards .btn", { hasText: "Board Three" }).click();
      await p.locator(".ov-period-boards .btn", { hasText: "Board Four" }).click();
      assert.match(await p.locator(".ov-period .ov-group-sub").textContent(), /Board Four/);
      assert.equal(await p.evaluate(() => ovPeriodBoards().length), 1, "one board stays");
      assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("manpower.ovPeriod")).linked), false, "remembered");
    });

    await step("Side by side and A vs B are offered by how many boards the Period has", async () => {
      await p.evaluate(() => setOvPeriod({ ids: ["b3", "b4"], view: "side" }));
      assert.equal(await p.locator(".ov-small").count(), 2, "one small chart per board, for a subset of the boards");
      await p.locator(".ov-period-boards .btn", { hasText: "Board One" }).click();     // three boards
      assert.equal(await view("A vs B").isDisabled(), true, "A vs B needs exactly two");
      assert.match(await p.locator(".ov-period-hint").textContent(), /exactly 2 boards/);
      assert.equal(await p.locator(".ov-small").count(), 3);
      await p.evaluate(() => setOvPeriod({ ids: ["b4"] }));
      assert.equal(await view("Side by side").isDisabled(), true, "one board has nothing to put side by side");
      assert.equal(await p.locator(".ov-small").count(), 0, "so it reads Combined");
      await p.evaluate(() => setOvPeriod({ ids: ["b3", "b4"], view: "together" }));
    });

    await step("A vs B overlays two boards, shows both averages, turns Compare with off, and adds a Difference row", async () => {
      await view("A vs B").click();
      assert.equal(await view("A vs B").getAttribute("aria-pressed"), "true");
      assert.equal(await p.locator(".ov-history-compare .btn:disabled").count(), 2, "Compare with is off");
      assert.match(await p.locator(".ov-history-compare").textContent(), /Off while two boards are compared/);
      const tiles = await text(".ov-htiles:not(.ov-eng-tiles) .ov-htile");
      assert.ok(tiles.every((t) => /vs/.test(t)), "every tile shows both boards: " + tiles.join(" | "));
      const legend = await text(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-legend > span");
      assert.equal(legend.length, 2);
      assert.match(legend[0], /^Board Three · avg /); assert.match(legend[1], /^Board Four · avg /);
      assert.equal(await p.locator(".ov-hchart .ov-trend-chart").first().locator("path.chart-line, polyline, path[stroke]").count() >= 2, true, "two lines");
      const diff = await text(".ov-ba-table .ov-vs-row td");
      assert.equal(diff[0], "Difference");
      // Leave and On-call read as two small charts in A vs B
      await p.locator(".ov-htiles:not(.ov-eng-tiles) .ov-htile", { hasText: "Leave / day" }).click();
      assert.equal(await p.locator(".ov-small").count(), 2);
      await p.locator(".ov-htiles:not(.ov-eng-tiles) .ov-htile", { hasText: /^Deployed \/ day/ }).click();
    });

    await step("A vs B asks Compare with for nothing; Combined brings it back", async () => {
      await view("Combined").click();
      assert.equal(await p.locator(".ov-history-compare .btn:disabled").count(), 0);
      assert.equal(await p.locator(".ov-small").count(), 0);
    });

    await step("a board in a small chart or in Boards & areas shows only that board: the page while linked, the Period when unlinked", async () => {
      await view("Side by side").click();
      await p.locator(".ov-small-head .ov-linkbtn", { hasText: "Board Four" }).click();
      assert.equal(await p.evaluate(() => ovPeriodBoards().map((b) => b.id).join(",")), "b4");
      assert.equal(await p.evaluate(() => state.overview.boardIds.join(",")), "b1,b3", "the page's own boards did not change");
      await p.locator(".ov-period-scope .btn", { hasText: "Own boards" }).click();      // relink
      assert.equal(await p.evaluate(() => ovPeriodBoards().map((b) => b.id).join(",")), "b1,b3");
      await p.locator(".ov-ba-table tr[data-i='1']").click();
      assert.equal(await p.evaluate(() => state.overview.boardIds.join(",")), "b3", "linked: the page's selector follows");
      await p.evaluate(() => setOvBoard(""));
    });

    await step("the Report names the Period's boards", async () => {
      await p.evaluate(() => { setOvBoard(["b1", "b2"]); });
      await p.locator(".ov-period-scope .btn", { hasText: "Linked to page" }).click();
      await p.locator(".ov-period-boards .btn", { hasText: "Board Three" }).click();
      await p.locator(".ov-period-boards .btn", { hasText: "Board One" }).click();
      await p.locator(".ov-period-boards .btn", { hasText: "Board Two" }).click();   // Board Three alone
      await p.locator("#btn-report").click();
      await p.waitForSelector("#modal-report:not(.hidden) #rp-month");
      assert.match((await text(".rp-scope"))[0], /Scope Board Three \(the Period's boards\)/, "the Report follows the Period's boards, and says so");
      await p.evaluate(() => closeModal());
    });

    await step("in Thai nothing new is left in English", async () => {
      await p.evaluate(() => { setOvBoard(["b1", "b3", "b4"]); setOvPeriod({ linked: true, view: "together" }); });
      await p.evaluate(() => I18N.setLang("th"));
      await p.waitForTimeout(250);
      const english = (xs) => xs.filter((x) => /[A-Za-z]{3}/.test(x.replace(/\bOC\b|Person [A-S]|Board (One|Two|Three|Four)|Eng (One|Two)|Host (Alpha|Beta|Gamma)|AREA1/g, "")));
      await p.click("#btn-ov-board");
      assert.deepEqual(english(await text("#ov-board-menu, #btn-ov-board")), [], "the picker in Thai");
      await p.click("#btn-ov-board");
      assert.deepEqual(english(await text(".ov-period .ov-period-scope, .ov-period .ov-group-head")), [], "the Period scope in Thai");
      await p.evaluate(() => setOvPeriod({ linked: false, ids: ["b3", "b4"], view: "vs" }));
      await p.waitForTimeout(250);
      assert.deepEqual(english(await text(".ov-period .ov-history-compare, .ov-htiles:not(.ov-eng-tiles), .ov-hchart .ov-legend, .ov-vs-diff, .ov-ba-table")), [], "A vs B in Thai");
      await p.evaluate(() => I18N.setLang("en"));
      await p.waitForTimeout(150);
    });

    await step("on a phone (400 px) the picker and the Period scope fit without sideways scroll", async () => {
      await p.setViewportSize({ width: 400, height: 800 });
      await p.evaluate(() => setOvPeriod({ linked: false, ids: ["b3", "b4"], view: "vs" }));
      await p.waitForTimeout(300);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no sideways page scroll");
      await p.setViewportSize({ width: 1400, height: 900 });
    });

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all overview-multi-board checks passed");
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
})();
