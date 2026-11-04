/* Acceptance run for Present mode (present.js):
     - the Present button is on the Overview and on a confirmed board, not on the other tabs;
     - the start sheet shows the page's boards, the slides the role may see (a slide needs the Overview
       permission of its section) and a Show / Hide names choice that starts on Show;
     - Overview slides (Today, Idle people, Boards, Trend) carry the same numbers as the page, follow the
       board selector, move with the arrow keys and the dots, and Esc leaves;
     - Hide names swaps every name for dots, and the choice is remembered on the device;
     - on a board it is the board itself, read-only (not clickable, keys swallowed), ← → switch board;
     - Thai shows no English; a phone has no sideways scroll.
     NODE_PATH=$(npm root -g) node tests/e2e/present-mode.e2e.js
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
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    db.seed("boards", [{ id: "b3", name: "Board Three", weekend_days: [0, 6] }]);
    db.seed("employees", [
      { id: "e21", name_th: "Person P", contract: "permanent", area_id: "area-1", board_id: "b3" },
      { id: "e22", name_th: "Person Q", contract: "permanent", area_id: "area-1", board_id: "b3" },
    ]);
    db.seed("missions", [{ id: "s301", board_id: "b3", plan_date: SRC, number: "301", host: "Host Gamma", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" }]);
    db.seed("assignments", [{ employee_id: "e21", plan_date: SRC, mission_id: "s301", zone: null }]);
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const OVERVIEW = await p.evaluate(() => OVERVIEW_ID);
    const showOverview = () => p.evaluate(async ([day, ov]) => {
      localStorage.removeItem("manpower.present");
      state.date = day; D().activeBoardId = ov; state.overview.boardIds = [];
      await refreshAndRender();
    }, [SRC, OVERVIEW]);
    await showOverview();
    const stage = () => p.locator("#present-stage");
    const slideText = () => p.locator("#present-stage .pr-slide").innerText();
    const which = () => p.locator("#present-stage .pr-count").innerText();
    const sheetStart = async () => { await p.locator("#btn-present").click(); await p.waitForSelector("#modal-present:not(.hidden) #pr-names-show"); };
    const nameWords = /Person [A-Z]/;

    await step("the Present button is on the Overview and on a board, and nowhere else", async () => {
      assert.equal(await p.locator("#btn-present:not(.hidden)").count(), 1, "Overview");
      assert.equal(await p.locator("#btn-present + #btn-report").count(), 1, "left of Report, which sits left of Export");
      for (const tab of [".tab-emplist", ".tab-orgchart"]) {
        if (await p.locator(tab).count()) { await p.click(tab); assert.equal(await p.locator("#btn-present.hidden").count(), 1, tab); }
      }
      await p.evaluate(() => { D().activeBoardId = "b1"; return refreshAndRender(); });
      assert.equal(await p.locator("#btn-present:not(.hidden)").count(), 1, "a board");
      await showOverview();
    });

    await step("the start sheet shows the boards, four slides and Show names; no slide chosen means no Start", async () => {
      await sheetStart();
      const body = await p.locator("#present-body").innerText();
      assert.match(body, /All boards/);
      assert.deepEqual(await p.$$eval("#present-body input[data-slide]", (els) => els.map((e) => [e.dataset.slide, e.checked])), [["today", true], ["idle", true], ["boards", true], ["trend", true]]);
      assert.equal(await p.locator("#pr-names-show").getAttribute("aria-pressed"), "true", "names start shown");
      for (const k of ["today", "idle", "boards", "trend"]) await p.uncheck(`#pr-sl-${k}`);
      assert.equal(await p.locator("#btn-present-go").isDisabled(), true);
      await p.check("#pr-sl-today"); await p.check("#pr-sl-idle"); await p.check("#pr-sl-boards"); await p.check("#pr-sl-trend");
      assert.equal(await p.locator("#btn-present-go").isDisabled(), false);
      await p.evaluate(() => closeModal());
    });

    await step("the Today slide matches the page: same headline and numbers", async () => {
      const page = await p.evaluate(() => ({ title: document.querySelector(".ov-attn-title").textContent.trim(),
        util: document.querySelector(".ov-kpi-tile .ov-kpi-value").textContent.trim(), tiles: [...document.querySelectorAll(".ov-kpi-tile .ov-kpi-value")].map((e) => e.textContent.replace(/\s+/g, "")) }));
      await sheetStart();
      await p.locator("#btn-present-go").click();
      await stage().waitFor();
      assert.equal(await p.evaluate(() => document.body.classList.contains("presenting")), true);
      const t = await slideText();
      assert.ok(t.includes(page.title), "headline: " + page.title + " in " + t);
      assert.ok(t.includes(page.util), "utilization " + page.util);
      const [deployed, total] = page.tiles[1].split("/");
      assert.match(t.replace(/\s+/g, ""), new RegExp(deployed + "/" + total), "deployed on a mission");
      assert.match(await which(), /1 \/ 4 · Today/);
    });

    await step("arrow keys and the dots move between slides; Idle people lists the names", async () => {
      await p.keyboard.press("ArrowRight");
      assert.match(await which(), /2 \/ 4 · Idle people/);
      const idle = await slideText();
      const names = await p.evaluate(() => [...document.querySelectorAll(".ov-attn .ov-mini")].map((m) => m.firstChild.textContent));
      assert.ok(names.length > 0 && names.every((n) => idle.includes(n)), "every idle name from the page is on the slide: " + names.join(", "));
      await p.keyboard.press("ArrowRight");
      assert.match(await which(), /3 \/ 4 · Boards/);
      const boards = await p.locator("#present-stage .pr-brow .nmx").allInnerTexts();
      assert.deepEqual(boards.map((x) => x.trim()), ["Board One", "Board Two", "Board Three"]);
      await p.keyboard.press("ArrowRight");
      assert.match(await which(), /4 \/ 4 · Trend/);
      assert.equal(await p.locator("#present-stage .pr-chart svg, #present-stage .pr-empty").count(), 1, "a chart, or the plain note when there are too few days");
      await p.keyboard.press("ArrowRight");
      assert.match(await which(), /1 \/ 4 · Today/, "wraps round");
      await p.locator('#present-stage .pr-dots button[aria-label^="Slide 3"]').click();
      assert.match(await which(), /3 \/ 4/);
      await p.keyboard.press("ArrowLeft");
      assert.match(await which(), /2 \/ 4/);
    });

    await step("Hide names swaps every name for dots, and is remembered", async () => {
      await p.locator(".pr-hover .pr-tg").evaluate((b) => b.click());
      const t = await slideText();
      assert.doesNotMatch(t, nameWords, "no name on the slide");
      assert.match(t, /•••/);
      assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("manpower.present")).names), false);
      assert.equal(await p.evaluate(() => document.body.classList.contains("pres-hide-names")), true);
      await p.keyboard.press("n");
      assert.match(await slideText(), nameWords, "N brings them back");
    });

    await step("the keys do not reach the page underneath; Esc leaves", async () => {
      const before = await p.evaluate(() => D().activeBoardId);
      await p.keyboard.press("Control+z"); await p.keyboard.press("Delete");
      assert.equal(await p.evaluate(() => D().activeBoardId), before);
      await p.keyboard.press("Escape");
      assert.equal(await stage().count(), 0, "the stage is gone");
      assert.equal(await p.evaluate(() => document.body.classList.contains("presenting")), false);
      assert.equal(await p.locator("#btn-present").isVisible(), true, "the toolbar is back");
    });

    await step("slides follow the board selector", async () => {
      await p.evaluate(() => setOvBoard(["b1", "b3"]));
      await sheetStart();
      assert.match(await p.locator("#present-body").innerText(), /Board One \+ Board Three/);
      await p.locator("#btn-present-go").click();
      await stage().waitFor();
      assert.match(await p.locator("#present-stage .pr-bar2").innerText(), /Board One \+ Board Three/);
      await p.keyboard.press("ArrowRight"); await p.keyboard.press("ArrowRight");
      assert.deepEqual((await p.locator("#present-stage .pr-brow .nmx").allInnerTexts()).map((x) => x.trim()), ["Board One", "Board Three"]);
      await p.evaluate(() => Present.exit());
      await p.evaluate(() => setOvBoard(""));
    });

    await step("a slide follows live data while it is up", async () => {
      await p.locator("#btn-present").click();
      await p.locator("#btn-present-go").click();
      await stage().waitFor();
      await p.keyboard.press("ArrowRight"); await p.keyboard.press("ArrowRight");   // the Boards slide names every board
      const before = await slideText();
      await p.evaluate(() => { const b = D().boards.find((x) => x.id === "b1"); b.name = "Board Uno"; render(); });
      assert.notEqual(await slideText(), before, "the board's new name reaches the slide at once");
      await p.keyboard.press("Escape");
      await p.evaluate(() => { D().boards.find((x) => x.id === "b1").name = "Board One"; render(); });
    });

    await step("a role without a section's permission has no slide for it, and no Present without any", async () => {
      db.t("role_permissions").find((r) => r.role_key === "viewer" && r.area === "ov.actionQueue").level = "none";
      const v = await env.openAs(db, h.USERS.v);
      await v.page.evaluate(([d, ov]) => { state.date = d; D().activeBoardId = ov; return refreshAndRender(); }, [SRC, OVERVIEW]);
      await v.page.locator("#btn-present").click();
      await v.page.waitForSelector("#modal-present:not(.hidden)");
      assert.deepEqual(await v.page.$$eval("#present-body input[data-slide]", (els) => els.map((e) => e.dataset.slide)), ["today", "boards", "trend"], "no Idle people slide without idle names");
      await v.page.evaluate(() => closeModal());
      for (const area of ["ov.status", "ov.byBoard", "ov.kpi"]) db.t("role_permissions").find((r) => r.role_key === "viewer" && r.area === area).level = "none";
      const v2 = await env.openAs(db, h.USERS.v);
      await v2.page.evaluate(([d, ov]) => { state.date = d; D().activeBoardId = ov; return refreshAndRender(); }, [SRC, OVERVIEW]);
      assert.equal(await v2.page.locator("#btn-present.hidden").count(), 1, "nothing to present, so no button");
      assert.deepEqual(v.errors.concat(v2.errors), []);
    });

    await step("on a board: the board alone, bigger, not clickable; ← → switch board; Esc leaves", async () => {
      await p.evaluate(() => { D().activeBoardId = "b1"; return refreshAndRender(); });
      await p.locator("#btn-present").click();
      await p.waitForSelector("#modal-present:not(.hidden)");
      assert.match(await p.locator("#present-body").innerText(), /Board One/);
      assert.equal(await p.locator("#present-body input[data-slide]").count(), 0, "no slides on a board");
      await p.locator("#btn-present-go").click();
      await p.waitForSelector("body.presenting-board");
      assert.equal(await p.locator("#sticky-header").isVisible(), false, "no banner or toolbar");
      assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById("board-capture")).pointerEvents), "none", "not clickable");
      assert.equal(await p.locator("#present-stage").count(), 0, "the board itself, not slides");
      await p.keyboard.press("ArrowRight");
      await p.waitForFunction(() => D().activeBoardId === "b2");
      await p.keyboard.press("ArrowLeft");
      await p.waitForFunction(() => D().activeBoardId === "b1");
      // Hide names: dots on the cards
      await p.keyboard.press("n");
      const size = await p.evaluate(() => { const n = document.querySelector("#missions-grid .emp-name"); return n ? getComputedStyle(n).fontSize : "none"; });
      assert.ok(size === "0px" || size === "none", "names are not drawn: " + size);
      await p.keyboard.press("n");
      await p.keyboard.press("Escape");
      assert.equal(await p.evaluate(() => document.body.classList.contains("presenting")), false);
      assert.equal(await p.locator("#sticky-header").isVisible(), true, "the banner is back");
    });

    await step("a forecast day cannot be presented", async () => {
      await p.evaluate(async () => { D().activeBoardId = "b1"; state.date = addDays(todayStr(), 400); await refreshAndRender(); });
      assert.equal(await p.locator("#btn-present.hidden").count(), 1);
      await p.evaluate(([d]) => { state.date = d; return refreshAndRender(); }, [SRC]);
    });

    await step("in Thai the sheet and the slides leave nothing in English", async () => {
      await showOverview();
      await p.evaluate(() => I18N.setLang("th"));
      await p.waitForTimeout(250);
      const english = (xs) => xs.filter((x) => /[A-Za-z]{3}/.test(x.replace(/\bEsc\b|Person [A-Z]|Board (One|Two|Three)|Eng (One|Two)|Host (Alpha|Beta|Gamma)|AREA1/g, "")));
      const read = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.replace(/\s+/g, " ").trim()), sel);
      await sheetStart();
      assert.deepEqual(english(await read("#modal-present h3, #present-body, #modal-present .modal-actions")), [], "the sheet in Thai");
      await p.locator("#btn-present-go").click();
      await stage().waitFor();
      for (let i = 0; i < 4; i++) {
        await p.waitForTimeout(120);
        assert.deepEqual(english(await read("#present-stage, .pr-hover")), [], "slide " + (i + 1) + " in Thai");
        await p.keyboard.press("ArrowRight");
      }
      await p.keyboard.press("Escape");
      await p.evaluate(() => I18N.setLang("en"));
    });

    await step("on a phone (400 px) the sheet and the slides fit without sideways scroll", async () => {
      await p.setViewportSize({ width: 400, height: 800 });
      await showOverview();
      await p.evaluate(() => Present.open());
      await p.waitForSelector("#modal-present:not(.hidden)");
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "the sheet");
      await p.locator("#btn-present-go").click();
      await stage().waitFor();
      for (let i = 0; i < 4; i++) {
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "slide " + (i + 1));
        const over = await p.evaluate(() => { const s = document.querySelector("#present-stage .pr-slide"); return s.scrollHeight - s.clientHeight; });
        assert.ok(over <= 2, "slide " + (i + 1) + " fits its screen, overflow " + over + "px");
        await p.keyboard.press("ArrowRight");
      }
      await p.keyboard.press("Escape");
      await p.setViewportSize({ width: 1400, height: 900 });
    });

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all present-mode checks passed");
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
})();
