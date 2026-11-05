/* Acceptance run for Present mode (present.js):
     - the Present button is on the Overview and on a confirmed board, not on the other tabs;
     - the start sheet lists the slides the role may see, by chapter (a slide needs the Overview permission of its
       section) and a Show / Hide names choice that starts on Show;
     - Overview slides are the page's OWN sections on a stage: In detail, then History, People, Engineer workload,
       Workforce and Boards & areas. They move with the arrow keys, the dots, the chapter tabs and the number keys;
     - the board chips set the board selector (All is exclusive) and every slide follows it;
     - the page's own filters are live on a slide (Group by, a History tile, the period strip, People's views, the
       engineer picker...), B G C M change a filter by key, and a key with no control on that slide says so;
     - a click that would leave (a day, a name, See all hosts, an engineer row) does nothing;
     - Reset filters and Esc put every filter back as it was, including the two saved on the device and the panel's place;
     - Hide names replaces staff names in the text and the tooltips, and N brings them back;
     - a slide taller than the screen scrolls (More below, ↑ ↓);
     - on a board it is the board itself, read-only, and ← → switch board; a forecast day cannot be presented;
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
      { id: "e23", name_th: "Person R", contract: "permanent", area_id: "area-1", board_id: "b3" },
    ]);
    // Board One (seedBase): day 101 (2 crew) + 102 (1), night 103 (1). Board Three adds day 301 (1), a night 302 with 2 crew,
    // and a hidden day 303.
    db.seed("missions", [
      { id: "s301", board_id: "b3", plan_date: SRC, number: "301", host: "Host Gamma", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" },
      { id: "s302", board_id: "b3", plan_date: SRC, number: "302", host: "Host Alpha", customer: "Cust Beta", shift: "night", engineer_id: "eng-2" },
      { id: "s303", board_id: "b3", plan_date: SRC, number: "303", host: "Host Beta", customer: "Cust Beta", shift: "day", engineer_id: "eng-2", hidden: true },
    ]);
    db.seed("assignments", [
      { employee_id: "e21", plan_date: SRC, mission_id: "s301", zone: null },
      { employee_id: "e22", plan_date: SRC, mission_id: "s302", zone: null },
      { employee_id: "e23", plan_date: SRC, mission_id: "s302", zone: null },
    ]);
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const OVERVIEW = await p.evaluate(() => OVERVIEW_ID);
    const showOverview = () => p.evaluate(async ([day, ov]) => {
      localStorage.removeItem("manpower.present");
      state.date = day; D().activeBoardId = ov; setOvBoard("");
      Object.assign(state.overview, { historyPreset: "last30", historyCacheKey: null, historyGroup: "day", historyMeasure: "util", historyCompare: "prev" });
      await refreshAndRender();
    }, [SRC, OVERVIEW]);
    await showOverview();
    const stage = () => p.locator("#present-stage");
    const which = async () => (await p.locator("#present-stage .pr-count").innerText()).replace(/\s+/g, " ").trim();
    const goTo = async (n) => { await p.keyboard.press(String(n)); assert.match(await which(), new RegExp("^" + n + " / 6")); };
    const sheetStart = async () => { await p.locator("#btn-present").click(); await p.waitForSelector("#modal-present:not(.hidden) #pr-names-show"); };
    const present = async () => { await sheetStart(); await p.locator("#btn-present-go").click(); await stage().waitFor(); };
    const leave = async () => { await p.keyboard.press("Escape"); await p.waitForFunction(() => !document.getElementById("present-stage")); };
    const ov = (k) => p.evaluate((x) => JSON.parse(JSON.stringify(state.overview[x] === undefined ? null : state.overview[x])), k);
    const boardIds = () => ov("boardIds");
    const chips = () => p.locator("#present-stage .pr-chip");
    const chipOn = () => p.$$eval("#present-stage .pr-chip.on", (els) => els.map((e) => e.textContent.trim()));
    const note = () => p.locator("#present-stage .pr-note").innerText();
    const nameWords = /Person [A-Z]\b/;
    // the Overview state a presenter can change (present.js FIELDS): what Reset filters and leaving put back
    const FIELDS = ["boardIds", "period", "historyPreset", "historyFrom", "historyTo", "historyMeasure", "historyLeaveView", "historyLeaveHidden", "historyGroup", "historyCompare",
      "historyOncallMode", "baView", "baLoansOpen", "wfWindow", "wfHidden", "pplView", "pplWho", "pplSpread", "pplBand", "pplSort", "pplAll", "engPick", "engGroup", "engMeasure"];
    const filters = () => p.evaluate((f) => JSON.stringify(f.map((k) => (state.overview[k] === undefined ? null : state.overview[k]))), FIELDS);
    let startFilters = null;
    const SLIDE_NAMES = ["In detail", "History", "People", "Engineer workload", "Workforce", "Boards & areas"];

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

    await step("the start sheet lists six slides by chapter and Show names; no slide chosen means no Start", async () => {
      await sheetStart();
      const body = await p.locator("#present-body").innerText();
      assert.match(body, /All boards/);
      assert.deepEqual(await p.$$eval("#present-body input[data-slide]", (els) => els.map((e) => [e.dataset.slide, e.checked])),
        [["detail", true], ["history", true], ["people", true], ["engineer", true], ["workforce", true], ["areas", true]]);
      assert.match(body, /In detail\s+In detail/, "the first slide sits in the In detail chapter");
      assert.equal((body.match(/Period/g) || []).length >= 5, true, "five slides sit in the Period chapter");
      assert.equal(await p.locator("#pr-names-show").getAttribute("aria-pressed"), "true", "names start shown");
      for (const k of ["detail", "history", "people", "engineer", "workforce", "areas"]) await p.uncheck(`#pr-sl-${k}`);
      assert.equal(await p.locator("#btn-present-go").isDisabled(), true);
      await p.check("#pr-sl-people");
      assert.equal(await p.locator("#btn-present-go").isDisabled(), false);
      await p.evaluate(() => closeModal());
      await showOverview();
    });

    await step("In detail is the page's own group of four sections on a stage; the panel itself is the slide", async () => {
      await present();
      startFilters = await filters();
      assert.equal(await p.evaluate(() => document.body.classList.contains("presenting")), true);
      assert.equal(await p.evaluate(() => !!document.querySelector("#present-stage #overview-panel")), true, "the page's panel was moved onto the stage");
      assert.match(await which(), /^1 \/ 6 · In detail$/);
      const on = await p.evaluate(() => [...document.querySelectorAll("#overview-panel > .pr-on")].map((c) => c.dataset.pslide + ": " + [...c.querySelectorAll("h3")].map((x) => x.textContent.trim()).join(" | ")));
      assert.deepEqual(on, ["detail: By engineer | By service area | Shifts | Host coverage"]);
      const shown = await p.evaluate(() => [...document.querySelectorAll("#overview-panel > *")].filter((c) => getComputedStyle(c).display !== "none").length);
      assert.equal(shown, 1, "nothing else of the page shows");
      const k = await p.evaluate(() => { const t = document.getElementById("overview-panel").style.transform; return parseFloat(t.replace(/[^0-9.]/g, "")); });
      // the stage is 1400 px wide here: (1400 - 2 * 28 gutter) / 1280 = 1.05, and the section never fills a stage taller than it needs
      assert.ok(k > 1 && k <= 1.06, "the section is scaled to the stage's width: " + k);
      assert.deepEqual(await p.$$eval("#present-stage .pr-chip", (els) => els.map((e) => e.textContent.trim())), ["All boards", "Board One", "Board Two", "Board Three"]);
      assert.deepEqual(await chipOn(), ["All boards"]);
      assert.equal(await p.locator("#present-stage .pr-r2").count(), 0, "no period strip on a day slide");
    });

    await step("arrow keys, the dots, the chapter tabs and the number keys move between slides", async () => {
      for (let i = 1; i < 6; i++) { await p.keyboard.press("ArrowRight"); assert.equal(await which(), `${i + 1} / 6 · ${SLIDE_NAMES[i]}`); }
      await p.keyboard.press("ArrowRight");
      assert.match(await which(), /^1 \/ 6 · In detail$/, "wraps round");
      await p.locator('#present-stage .pr-dots button[aria-label^="Slide 4"]').click();
      assert.match(await which(), /^4 \/ 6 · Engineer workload$/);
      await p.locator('#present-stage .pr-tabs button', { hasText: "In detail" }).click();
      assert.match(await which(), /^1 \/ 6/, "the In detail tab");
      await p.locator('#present-stage .pr-tabs button', { hasText: "Period" }).click();
      assert.match(await which(), /^2 \/ 6 · History$/, "the Period tab opens its first slide");
      await p.keyboard.press("End"); assert.match(await which(), /^6 \/ 6/);
      await p.keyboard.press("Home"); assert.match(await which(), /^1 \/ 6/);
      await goTo(5); await goTo(2);
      assert.equal(await p.locator("#present-stage .pr-r2").count(), 1, "a Period slide has the period strip");
      assert.equal(await p.locator("#present-stage .pr-strip .ov-history-controls .btn", { hasText: "Last 30d" }).count(), 1, "range presets in the strip");
      assert.equal(await p.locator("#present-stage .pr-strip .ov-history-dates").evaluate((e) => getComputedStyle(e).display), "none", "no date pickers on a wall");
    });

    await step("the board chips set the board selector: All is exclusive, then boards are added and taken away", async () => {
      await goTo(1);
      assert.equal(await p.locator("#overview-panel .ov-daynight-row").count(), 3, "Shifts lists the three boards");
      await chips().filter({ hasText: "Board Two" }).click();
      assert.deepEqual(await boardIds(), ["b2"], "from All, a board means only that board");
      assert.deepEqual(await chipOn(), ["Board Two"]);
      assert.match(await p.locator(".pr-hover .pr-sc").innerText(), /Board Two/);
      assert.equal(await p.locator("#overview-panel .ov-daynight-row").count(), 0, "the slide follows: one board has no per-board rows");
      await chips().filter({ hasText: "Board Three" }).click();
      assert.deepEqual(await boardIds(), ["b2", "b3"], "another board is added");
      await chips().filter({ hasText: "Board Two" }).click();
      assert.deepEqual(await boardIds(), ["b3"], "a board is taken away");
      await chips().filter({ hasText: "Board Three" }).click();
      assert.deepEqual(await boardIds(), [], "none left means All boards");
      assert.deepEqual(await chipOn(), ["All boards"]);
      await chips().filter({ hasText: "Board One" }).click();
      await chips().filter({ hasText: "All boards" }).click();
      assert.deepEqual(await boardIds(), []);
      // B walks them: all → each board → all
      const seen = [];
      for (let i = 0; i < 4; i++) { await p.keyboard.press("b"); seen.push(await boardIds()); }
      assert.deepEqual(seen, [["b1"], ["b2"], ["b3"], []]);
    });

    await step("the Period slides follow the chips: People lists only the chosen board's people", async () => {
      await goTo(3);
      assert.equal(await p.evaluate(() => state.overview.period.linked), true, "the Period follows the stage's boards while presenting");
      await chips().filter({ hasText: "Board Three" }).click();
      const t = await p.locator("#overview-panel > .pr-on .ov-people-table").innerText();
      assert.match(t, /Person P\b/);
      assert.match(t, /Person Q\b/);
      assert.doesNotMatch(t, /Person [A-H]\b/, "Board One's people are not on it");
      await chips().filter({ hasText: "All boards" }).click();
      assert.match(await p.locator("#overview-panel > .pr-on .ov-people-table").innerText(), /Person A\b/);
    });

    await step("History: the page's own Group by and tile are live, and so are G, M and C", async () => {
      await goTo(2);
      assert.equal(await p.locator("#overview-panel > .pr-on .ov-htile").count(), 6, "six tiles");
      await p.locator("#overview-panel .ov-htile", { hasText: "Leave / day" }).click();
      assert.equal(await ov("historyMeasure"), "leave");
      await p.locator("#overview-panel .ov-htoolbar .btn", { hasText: "Week" }).click();
      assert.equal(await ov("historyGroup"), "week");
      assert.match(await p.locator("#overview-panel > .pr-on .ov-hchart-head b").first().innerText(), /week by week/);
      await p.keyboard.press("g"); assert.equal(await ov("historyGroup"), "month");
      await p.keyboard.press("g"); assert.equal(await ov("historyGroup"), "day");
      await p.keyboard.press("m"); assert.equal(await ov("historyMeasure"), "oncall", "next tile after Leave");
      await p.keyboard.press("c");
      assert.equal(await ov("historyCompare"), "ly");
      await p.waitForTimeout(300);
      assert.equal(await p.evaluate(() => state.overview.historyLY !== null), true, "last year is fetched when it is chosen");
      await p.keyboard.press("c"); assert.equal(await ov("historyCompare"), "prev");
      await p.locator("#present-stage .pr-strip .ov-history-controls .btn", { hasText: "Last 90d" }).click();
      await p.waitForFunction(() => state.overview.historyPreset === "last90");
      await p.waitForTimeout(300);
      const cap = await p.locator("#present-stage .pr-pc").innerText();
      assert.ok(cap.includes(await p.evaluate(() => fmtDate(state.overview.historyFrom))), "the strip names the range: " + cap);
      assert.equal(await p.locator("#present-stage .pr-reset").count(), 1, "Reset filters appears once something changed");
    });

    await step("People, Engineer workload, Workforce and Boards & areas: their own switches are live", async () => {
      await goTo(3);
      await p.locator("#overview-panel .ov-people-bar .btn", { hasText: "Nights" }).click();
      assert.equal(await ov("pplView"), "nights");
      assert.equal(await p.evaluate(() => { const e = document.querySelector("#overview-panel .ov-wl-more"); return e ? getComputedStyle(e).display : "none"; }), "none", "Show all is not offered");
      await goTo(4);
      await p.selectOption("#overview-panel .ov-eng-select", "eng-2");
      assert.equal(await ov("engPick"), "eng-2");
      await p.locator("#overview-panel .ov-hchart-head-row .btn", { hasText: "Monthly" }).click();
      assert.equal(await ov("engGroup"), "month");
      await p.keyboard.press("g"); assert.equal(await ov("engGroup"), "day", "G cycles the engineer view too");
      await goTo(5);
      await p.locator("#overview-panel .ov-trend-btns .btn", { hasText: "History range" }).click();
      assert.equal(await ov("wfWindow"), "range");
      await goTo(6);
      await p.locator("#overview-panel .ov-trend-btns .btn", { hasText: "By service area" }).click();
      assert.equal(await ov("baView"), "area");
    });

    await step("a key with no control on the slide says so", async () => {
      await goTo(3);
      await p.keyboard.press("g"); assert.match(await note(), /Group by is on the History and Engineer workload slides/);
      await p.keyboard.press("m"); assert.match(await note(), /tiles are on the History and Engineer workload slides/);
      await goTo(1);
      await p.keyboard.press("c"); assert.match(await note(), /Compare is on the Period slides/);
    });

    await step("a click that would leave does nothing: a day, a name, See all hosts, an engineer row", async () => {
      const before = await p.evaluate(() => [state.date, D().activeBoardId, state.hostlist.view, JSON.stringify(state.filters.engineer)]);
      await goTo(2);
      await p.locator("#overview-panel .ov-htile", { hasText: "Missions / day" }).click();
      await p.evaluate(() => { const m = document.querySelector("#overview-panel > .pr-on [data-date]"); if (!m) throw new Error("no day mark"); m.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
      await goTo(3);
      await p.evaluate(() => document.querySelector("#overview-panel .ov-person-link").click());
      assert.equal(await p.locator("#modal-profile:not(.hidden)").count(), 0, "a name does not open a profile");
      await goTo(1);
      await p.evaluate(() => { document.querySelector("#overview-panel .ov-host-all").click(); const r = document.querySelector("#overview-panel tr.ov-row-click"); if (r) r.click(); });
      const after = await p.evaluate(() => [state.date, D().activeBoardId, state.hostlist.view, JSON.stringify(state.filters.engineer)]);
      assert.deepEqual(after, before, "nothing opened, nothing changed");
      assert.equal(await p.evaluate(() => isOverview()), true);
    });

    await step("Reset filters puts every filter back as it was when the screen started", async () => {
      await p.locator("#present-stage .pr-reset").click();
      await p.waitForTimeout(300);
      assert.equal(await filters(), startFilters, "every filter is as it was when the screen started");
      assert.equal(await p.locator("#present-stage .pr-reset").count(), 0, "and the chip goes");
    });

    await step("Esc leaves and every filter goes back, with the two saved on the device and the panel's place", async () => {
      await leave();
      assert.equal(await p.evaluate(() => document.body.classList.contains("presenting")), false);
      const set = () => p.evaluate(async () => {
        setOvBoard(["b1", "b3"]);
        Object.assign(state.overview, { period: { linked: false, ids: ["b2"], view: "side" }, historyPreset: "last30", historyGroup: "month", historyCompare: "prev", pplView: "leave" });
        try { localStorage.setItem(OV_PERIOD_KEY, JSON.stringify(state.overview.period)); } catch (e) { /* none */ }
        state.overview.historyCacheKey = null;
        await refreshAndRender();
      });
      await set();
      const home = () => p.evaluate(() => { const e = document.getElementById("overview-panel"); return e.parentElement.tagName + "#" + e.parentElement.id; });
      const state0 = () => p.evaluate(() => JSON.stringify([state.overview.boardIds, state.overview.period, state.overview.historyPreset, state.overview.historyGroup, state.overview.historyCompare, state.overview.pplView, localStorage.getItem("manpower.ovBoard"), localStorage.getItem(OV_PERIOD_KEY)]));
      const s0 = await state0(), home0 = await home();
      await present();
      assert.equal(await p.evaluate(() => state.overview.period.linked), true, "linked while presenting");
      await goTo(2);
      await chips().filter({ hasText: "All boards" }).click();
      await p.keyboard.press("g");
      await p.locator("#present-stage .pr-strip .ov-history-controls .btn", { hasText: "Last 90d" }).click();
      await p.waitForFunction(() => state.overview.historyPreset === "last90");
      await p.locator("#overview-panel .ov-htile", { hasText: "Leave / day" }).click();
      assert.notEqual(await state0(), s0, "changed while presenting");
      await leave();
      await p.waitForTimeout(300);
      assert.equal(await state0(), s0, "everything is back, localStorage included");
      assert.equal(await home(), home0, "the panel is back where it was");
      assert.equal(await p.evaluate(() => document.querySelectorAll("#overview-panel .pr-on").length), 0);
      assert.equal(await p.locator("#overview-panel .ov-attn, #overview-panel .ov-kpi-row").count() > 0, true, "the page shows its sections again");
      assert.equal(await p.locator("#present-root").count(), 0);
      assert.equal(await p.locator("#btn-present").isVisible(), true, "the toolbar is back");
      await showOverview();
      await p.evaluate(() => { state.overview.period = { linked: true, ids: [], view: "together" }; try { localStorage.removeItem(OV_PERIOD_KEY); } catch (e) { /* none */ } });
    });

    await step("the keys do not reach the page underneath", async () => {
      await present();
      const before = await p.evaluate(() => D().activeBoardId);
      await p.keyboard.press("Control+z"); await p.keyboard.press("Delete");
      assert.equal(await p.evaluate(() => D().activeBoardId), before);
      await p.keyboard.press("?");
      assert.equal(await p.locator("#present-stage .pr-keys").isVisible(), true, "? lists the keys");
      assert.match(await p.locator("#present-stage .pr-keys").innerText(), /Group by/);
      await p.keyboard.press("Escape");
      assert.equal(await p.locator("#present-stage .pr-keys").isVisible(), false, "Esc closes the list first");
      assert.equal(await stage().count(), 1, "and does not leave");
      await leave();
    });

    await step("Hide names replaces staff names in the text and the tooltips, and N brings them back", async () => {
      await present();
      await goTo(3);
      assert.match(await p.locator("#overview-panel > .pr-on").innerText(), nameWords, "names show to begin with");
      await p.locator(".pr-hover .pr-tg").evaluate((b) => b.click());
      const t = await p.locator("#overview-panel > .pr-on").innerText();
      assert.doesNotMatch(t, nameWords, "no name on the slide");
      assert.match(t, /•••/);
      const attrs = await p.evaluate(() => [...document.querySelectorAll("#overview-panel *")].flatMap((e) => ["title", "aria-label", "data-tip-label", "data-tip-value"].map((a) => e.getAttribute(a) || "")).join("\n"));
      assert.doesNotMatch(attrs, nameWords, "none in a tooltip or a label either");
      assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("manpower.present")).names), false, "remembered");
      await p.locator('#present-stage .pr-dots button[aria-label^="Slide 2"]').click();
      await p.locator("#overview-panel .ov-htile", { hasText: "Leave / day" }).click();
      assert.doesNotMatch(await p.locator("#overview-panel > .pr-on").innerText(), nameWords, "still none after a filter redraws the slide");
      await p.keyboard.press("n");
      await goTo(3);
      assert.match(await p.locator("#overview-panel > .pr-on").innerText(), nameWords, "N brings them back");
      await leave();
    });

    await step("a slide taller than the screen scrolls: More below, and ↑ ↓", async () => {
      await p.setViewportSize({ width: 1400, height: 560 });
      await showOverview();
      await present();
      await goTo(3);
      const m = await p.evaluate(() => { const s = document.querySelector(".pr-scroll"); return { over: s.scrollHeight - s.clientHeight, more: !document.querySelector(".pr-more").hidden }; });
      assert.ok(m.over > 20, "People is taller than a 560 px screen: " + m.over);
      assert.equal(m.more, true, "More below shows");
      await p.keyboard.press("ArrowDown");
      await p.waitForFunction(() => document.querySelector(".pr-scroll").scrollTop > 20);
      await p.keyboard.press("ArrowUp");
      await p.waitForFunction(() => document.querySelector(".pr-scroll").scrollTop < 5);
      await p.keyboard.press("ArrowRight");
      assert.equal(await p.evaluate(() => document.querySelector(".pr-scroll").scrollTop), 0, "a new slide starts at the top");
      await leave();
      await p.setViewportSize({ width: 1400, height: 900 });
    });

    await step("a slide follows live data while it is up", async () => {
      await showOverview();
      await present();
      const before = await p.locator("#overview-panel > .pr-on").innerText();
      await p.evaluate(() => { const b = D().boards.find((x) => x.id === "b1"); b.name = "Board Uno"; render(); });
      const after = await p.locator("#overview-panel > .pr-on").innerText();
      assert.notEqual(after, before, "the board's new name reaches the slide at once");
      assert.match(after, /Board Uno/);
      assert.deepEqual(await p.$$eval("#present-stage .pr-chip", (els) => els.map((e) => e.textContent.trim())), ["All boards", "Board Uno", "Board Two", "Board Three"], "and the chip");
      await leave();
      await p.evaluate(() => { D().boards.find((x) => x.id === "b1").name = "Board One"; render(); });
    });

    await step("a role without a section's permission has no slide for it, and no Present without any", async () => {
      db.t("role_permissions").find((r) => r.role_key === "viewer" && r.area === "ov.history").level = "none";
      const v = await env.openAs(db, h.USERS.v);
      await v.page.evaluate(([d, ov]) => { state.date = d; D().activeBoardId = ov; return refreshAndRender(); }, [SRC, OVERVIEW]);
      await v.page.locator("#btn-present").click();
      await v.page.waitForSelector("#modal-present:not(.hidden)");
      assert.deepEqual(await v.page.$$eval("#present-body input[data-slide]", (els) => els.map((e) => e.dataset.slide)), ["detail"], "no Period slides without History + Engineer workload");
      await v.page.locator("#btn-present-go").click();
      await v.page.waitForSelector("#present-stage");
      assert.equal(await v.page.locator("#present-stage .pr-tabs").count(), 0, "one chapter: no tabs");
      assert.equal(await v.page.locator("#present-stage .pr-r2").count(), 0);
      await v.page.keyboard.press("Escape");
      for (const area of ["ov.byEngineer", "ov.byArea", "ov.dayNight", "ov.hostRisk"]) db.t("role_permissions").find((r) => r.role_key === "viewer" && r.area === area).level = "none";
      const v2 = await env.openAs(db, h.USERS.v);
      await v2.page.evaluate(([d, ov]) => { state.date = d; D().activeBoardId = ov; return refreshAndRender(); }, [SRC, OVERVIEW]);
      assert.equal(await v2.page.locator("#btn-present.hidden").count(), 1, "nothing to present, so no button");
      assert.deepEqual(v.errors.concat(v2.errors), []);
    });

    await step("a stale saved slide list from the old four-slide Present is ignored", async () => {
      await p.evaluate(() => localStorage.setItem("manpower.present", JSON.stringify({ slides: ["today", "boards"], names: true })));
      await sheetStart();
      assert.equal(await p.locator("#present-body input[data-slide]:checked").count(), 6, "every slide is on, as when nothing is remembered");
      await p.evaluate(() => closeModal());
      await showOverview();
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

    await step("in Thai the sheet and every slide leave nothing in English", async () => {
      await showOverview();
      await p.evaluate(() => I18N.setLang("th"));
      await p.waitForTimeout(250);
      const english = (xs) => xs.filter((x) => /[A-Za-z]{3}/.test(x.replace(/\bEsc\b|Person [A-Z]|Board (One|Two|Three)|Eng (One|Two)|Host (Alpha|Beta|Gamma)|AREA1|OC\b|Home|End/g, "")));
      const read = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.replace(/\s+/g, " ").trim()), sel);
      await sheetStart();
      assert.deepEqual(english(await read("#modal-present h3, #present-body, #modal-present .modal-actions")), [], "the sheet in Thai");
      await p.locator("#btn-present-go").click();
      await stage().waitFor();
      for (let i = 0; i < 6; i++) {
        await p.waitForTimeout(150);
        // Present's own text and the slide's headings; the sections' own copy is the page's (language.e2e.js), not Present's
        assert.deepEqual(english(await read("#present-stage .pr-head, #present-stage .pr-nav, .pr-hover, #overview-panel > .pr-on > h3, #overview-panel > .pr-on .ov-section > h3")), [], "slide " + (i + 1) + " in Thai");
        await p.keyboard.press("ArrowRight");
      }
      await p.keyboard.press("?");
      await p.waitForTimeout(150);
      assert.deepEqual(english(await read("#present-stage .pr-keys")), [], "the key list in Thai");
      await p.keyboard.press("g");   // on In detail: the note says so
      await p.waitForTimeout(150);
      assert.deepEqual(english(await read("#present-stage .pr-note")), [], "a note in Thai");
      await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
      await p.evaluate(() => I18N.setLang("en"));
    });

    await step("on a phone (400 px) the sheet and the slides fit without sideways scroll, at their own width", async () => {
      await p.setViewportSize({ width: 400, height: 800 });
      await showOverview();
      await p.evaluate(() => Present.open());
      await p.waitForSelector("#modal-present:not(.hidden)");
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "the sheet");
      await p.locator("#btn-present-go").click();
      await stage().waitFor();
      for (let i = 0; i < 6; i++) {
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "slide " + (i + 1));
        const over = await p.evaluate(() => { const s = document.querySelector("#present-stage .pr-scroll"); return s.scrollWidth - s.clientWidth; });
        assert.ok(over <= 2, "slide " + (i + 1) + " has no sideways scroll, " + over + "px");
        assert.equal(await p.evaluate(() => document.getElementById("overview-panel").style.transform), "", "not scaled on a phone");
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
