/* Acceptance run for Overview phase 2, batch C (History's chart toolbar and Boards & areas):
     - Group by Day · Week · Month on every tile and view (a week or month column opens its first
       day; the Calendar is only offered with Day);
     - Compare with: Previous period | Same period last year, in the Period heading: tile, engineer
       and profile deltas and the charts name what they compare with (a dashed line, outlines on the
       columns); last year is the range moved back 364 days and is fetched only when chosen, with a
       loading state, and once;
     - Boards: Together | Side by side, one small chart per board on one shared scale, its name sets
       the board selector, a day opens that board; only offered for All boards with more than one;
     - the On-call view's Count | Share (on-call person-days ÷ all person-days on missions, pooled);
     - Boards & areas: a period table per board with net loans, By service area (demand, supply, gap,
       covered by other areas) and the from → to loan table;
     - Thai and a 400 px phone.
     NODE_PATH=$(npm root -g) node tests/e2e/overview-controls.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 40).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const today = h.iso(new Date());
    const back = h.addDays(today, -21);
    const W = h.addDays(back, -((new Date(back + "T00:00:00").getDay() + 6) % 7));
    const d = [0, 1, 2, 3, 4, 5, 6].map((i) => h.addDays(W, i));                 // the week: d[0..4] Mon-Fri
    const pw = [0, 1, 2, 3, 4].map((i) => h.addDays(W, i - 7));                    // the week before
    const ly = [0, 1, 2, 3, 4].map((i) => h.addDays(d[i], -364));                  // the same weekdays a year earlier
    const db = new h.FakeDb();
    h.seedBase(db, { src: h.isWeekend(today) ? h.prevWorking(today) : today });
    db.seed("service_areas", [{ id: "area-2", name: "AREA2", color: "#f0a05a" }]);
    for (const hh of db.t("hosts")) { if (hh.name === "Host Alpha") hh.area_id = "area-1"; if (hh.name === "Host Beta") hh.area_id = "area-2"; }
    for (const e of db.t("employees")) if (e.id === "e9" || e.id === "e10") e.area_id = "area-2";
    // Board One: every weekday a day mission (Host Alpha: A, B, C, plus on-call G Mon-Wed) and a night mission (Host Beta: D).
    // Board Two: every weekday a mission at Host Beta with I and J. E on annual leave Mon and Tue. F lent to Board Two Tue and Wed.
    const missions = [], as = [];
    const on = (e, day, m) => as.push({ employee_id: e, plan_date: day, mission_id: m, zone: null });
    const m = (id, board, day, num, host, shift) => missions.push({ id, board_id: board, plan_date: day, number: num, host, customer: "Cust Alpha", shift, engineer_id: "eng-1" });
    d.slice(0, 5).forEach((day, i) => {
      m("D" + i, "b1", day, "30" + i, "Host Alpha", "day"); m("N" + i, "b1", day, "40" + i, "Host Beta", "night"); m("T" + i, "b2", day, "60" + i, "Host Beta", "day");
      for (const e of ["e1", "e2", "e3"]) on(e, day, "D" + i);
      if (i < 3) on("e7", day, "D" + i);
      on("e4", day, "N" + i); on("e9", day, "T" + i); on("e10", day, "T" + i);
    });
    as.push({ employee_id: "e5", plan_date: d[0], mission_id: null, zone: "annual" }, { employee_id: "e5", plan_date: d[1], mission_id: null, zone: "annual" });
    pw.forEach((day, i) => { m("P" + i, "b1", day, "50" + i, "Host Alpha", "day"); on("e1", day, "P" + i); });
    ly.forEach((day, i) => { m("Y" + i, "b1", day, "70" + i, "Host Alpha", "day"); on("e1", day, "Y" + i); on("e2", day, "Y" + i); if (i === 0) on("e7", day, "Y" + i); });
    db.seed("missions", missions);
    db.seed("assignments", as);
    db.seed("employee_loans", [{ employee_id: "e6", to_board_id: "b2", start_date: d[1], end_date: d[2], note: "" }]);

    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const OVERVIEW = await p.evaluate(() => OVERVIEW_ID);
    await p.evaluate(() => { window.__ur = []; window.__slow = false; const o = cloud.getUtilizationRange.bind(cloud); cloud.getUtilizationRange = async (ids, f, t) => { window.__ur.push([f, t]); if (window.__slow) await new Promise((r) => setTimeout(r, 700)); return o(ids, f, t); }; });
    const showOverview = (o = {}) => p.evaluate(async ([day, ov, f, t, opts]) => {
      state.date = day; D().activeBoardId = ov; state.filters.engineer = [];
      state.overview.boardIds = opts.board ? [opts.board] : [];
      state.overview.historyPreset = "custom"; state.overview.historyFrom = opts.from || f; state.overview.historyTo = opts.to || t;
      state.overview.historyCacheKey = null; state.overview.historyMeasure = opts.measure || "deployed";
      state.overview.historyGroup = "day"; state.overview.period.view = "together"; state.overview.historyCompare = opts.compare || "prev";
      state.overview.historyOncallMode = "count"; state.overview.baView = "board"; state.overview.baLoansOpen = false;
      await refreshAndRender();
    }, [d[6], OVERVIEW, d[0], d[6], o]);
    await showOverview();
    const read = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, " ").trim()), sel);
    const tile = (label) => p.evaluate((l) => { const t = [...document.querySelectorAll(".ov-htiles:not(.ov-eng-tiles) .ov-htile")].find((x) => x.querySelector(".ov-htile-label").textContent === l); return [t.querySelector(".ov-htile-value").textContent, (t.querySelector(".ov-htile-delta") || { textContent: "" }).textContent]; }, label);
    const periodView = (label) => p.locator('.ov-period-scope [aria-label="Period board view"] .btn', { hasText: label }).first().click();
    const tool = (group, label) => p.locator(`.ov-htoolbar [aria-label="${group}"] .btn`, { hasText: label }).first().click();
    const dots = (prefix) => p.evaluate((pf) => [...document.querySelectorAll(".ov-hchart:not(.ov-eng):not(.ov-spread) circle.chart-dot")].filter((c) => (c.getAttribute("data-tip-label") || "").startsWith(pf)).length, prefix);
    const monthsIn = new Set(d.slice(0, 5).map((x) => x.slice(0, 7))).size;

    await step("Compare with sits in the Period heading; the previous period is the default and nothing for last year is fetched", async () => {
      assert.equal(await p.locator(".ov-period .ov-history-compare .btn.active").textContent(), "Previous period");
      assert.deepEqual(await read(".ov-period .ov-history-compare .btn"), ["Previous period", "Same period last year"]);
      assert.deepEqual(await tile("Deployed / day"), ["6.6 avg", "▲ 5.6 vs previous period"], "Mon-Fri: 7, 7, 7, 6, 6 against 1 the week before");
      assert.equal(await p.evaluate(() => state.overview.historyLY), null);
      assert.equal(await p.evaluate(([f]) => window.__ur.some(([from]) => from === f), [ly[0]]), false, "last year is not asked for until it is chosen");
    });

    await step("Group by: Day, Week, Month on a tile; a week or month column opens its first day", async () => {
      assert.equal(await dots("Deployed"), 5, "a point a day");
      await tool("Group by", "Week");
      assert.equal(await dots("Deployed"), 1, "one week");
      assert.deepEqual(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head b"), ["Deployed / day, week by week"]);
      await tool("Group by", "Month");
      assert.equal(await dots("Deployed"), monthsIn);
      await tool("Group by", "Week");
      await p.locator(`.ov-hchart:not(.ov-eng):not(.ov-spread) circle.chart-dot[data-date="${d[0]}"]`).first().click();
      await p.waitForTimeout(300);
      assert.deepEqual(await p.evaluate(() => [state.date, D().activeBoardId]), [d[0], "b1"], "the first plotted day of the week, on the busiest board that day");
      await showOverview();
    });

    await step("Same period last year: fetched once, only now, with a loading state; deltas and the chart name it", async () => {
      await p.evaluate(() => { window.__slow = true; });
      await p.locator(".ov-period .ov-history-compare .btn", { hasText: "Same period last year" }).click();
      assert.equal((await tile("Deployed / day"))[1], "loading last year…");
      assert.match((await read(".ov-loading"))[0] || "Loading the same period last year…", /Loading the same period last year/);
      await p.waitForFunction(() => /vs same period last year/.test((document.querySelector(".ov-htiles:not(.ov-eng-tiles) .ov-htile-delta") || { textContent: "" }).textContent));
      await p.evaluate(() => { window.__slow = false; });
      assert.deepEqual(await tile("Deployed / day"), ["6.6 avg", "▲ 4.4 vs same period last year"], "Mon 3, then 2 a day a year ago: 2.2");
      assert.equal(await p.locator(".ov-hchart:not(.ov-eng):not(.ov-spread) polyline[stroke-dasharray]").count(), 1, "the dashed comparison line");
      assert.ok((await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-legend"))[0].includes("Same period last year"));
      assert.match((await read(".ov-eng-tiles .ov-htile-delta"))[0], /vs same period last year/, "the engineer tiles follow");
      assert.deepEqual(await p.evaluate(([f, t]) => window.__ur.filter(([a, b]) => a === f && b === t).length, [ly[0], h.addDays(d[6], -364)]), 1, "one fetch, over the range moved back 364 days");
      await p.locator(".ov-period .ov-history-compare .btn", { hasText: "Previous period" }).click();
      await p.locator(".ov-period .ov-history-compare .btn", { hasText: "Same period last year" }).click();
      await p.waitForTimeout(300);
      assert.equal(await p.evaluate(([f, t]) => window.__ur.filter(([a, b]) => a === f && b === t).length, [ly[0], h.addDays(d[6], -364)]), 1, "and not fetched again");
    });

    await step("Boards: Side by side: a small chart per board on one scale, with its name and average; the name sets the selector", async () => {
      await periodView("Side by side");
      assert.equal(await p.locator(".ov-small").count(), 2);
      assert.deepEqual(await read(".ov-small-head"), ["Board One avg 4.6", "Board Two avg 2.0"]);
      const tops = await p.evaluate(() => [...document.querySelectorAll(".ov-small svg")].map((svg) => Math.max(...[...svg.querySelectorAll("text.chart-axis-label")].map((t) => Number(t.textContent)).filter((x) => !Number.isNaN(x)))));
      assert.equal(tops[0], tops[1], "one shared scale");
      await p.locator(".ov-small[data-board=b2] circle.chart-dot[data-date]").first().click();
      await p.waitForTimeout(300);
      assert.equal(await p.evaluate(() => D().activeBoardId), "b2", "a day opens that board");
      await showOverview({ compare: "ly" });
      await periodView("Side by side");
      await p.locator(".ov-small-head .ov-linkbtn", { hasText: "Board Two" }).click();
      await p.waitForTimeout(200);
      assert.equal(await p.evaluate(() => state.overview.boardIds.join(",")), "b2", "the name sets the board selector");
      assert.equal(await p.locator('.ov-period-scope [aria-label="Period board view"] .btn', { hasText: "Side by side" }).isDisabled(), true, "Side by side needs two or more boards in the Period scope");
      await showOverview();
    });

    await step("Leave: the Calendar only with Day; Group by changes its columns", async () => {
      await p.locator(".ov-htiles:not(.ov-eng-tiles) .ov-htile", { hasText: "Leave / day" }).click();
      assert.deepEqual(await read(".ov-hview .btn"), ["Chart", "Calendar"]);
      await tool("Group by", "Week");
      assert.equal(await p.locator(".ov-hview").count(), 0, "no Calendar with Week");
      assert.deepEqual(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head b"), ["Leave, week by week"]);
      assert.equal(await p.locator(".ov-hchart:not(.ov-eng):not(.ov-spread) .chart-column-chart rect.chart-mark").count(), 1, "one week: annual leave");
      assert.match(await p.locator(".ov-hchart:not(.ov-eng):not(.ov-spread) .chart-column-chart rect.chart-mark").first().getAttribute("data-tip-value"), /^0\.4$/, "2 person-days over 5 working days");
      await tool("Group by", "Day");
      assert.deepEqual(await read(".ov-hview .btn"), ["Chart", "Calendar"]);
    });

    await step("On-call: Count | Share; share is on-call person-days ÷ all person-days on missions, pooled over a bucket", async () => {
      await p.locator(".ov-htiles:not(.ov-eng-tiles) .ov-htile", { hasText: "On-call deployed" }).click();
      assert.deepEqual(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head-row .btn").then((x) => x.slice(-2)), ["Count", "Share"]);
      await p.locator(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head-row .btn", { hasText: "Share" }).click();
      assert.deepEqual(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head b"), ["On-call share, day by day"]);
      assert.match((await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head .ov-muted"))[0], /On-call is 9% of the person-days on missions/, "3 of 33");
      const tips = () => p.evaluate(() => [...document.querySelectorAll(".ov-hchart:not(.ov-eng):not(.ov-spread) .chart-column-chart rect.chart-mark")].map((r) => r.getAttribute("data-tip-value")));
      assert.deepEqual(await tips(), ["14.3%", "14.3%", "14.3%"], "Mon-Wed: 1 of 7; Thu and Fri nobody on-call");
      await tool("Group by", "Month");
      assert.deepEqual((await tips()).slice(0, 1), ["9.1%"], "pooled, not an average of daily percentages");
      await p.locator(".ov-period .ov-history-compare .btn", { hasText: "Same period last year" }).click();
      await p.waitForFunction(() => document.querySelector(".ov-hchart:not(.ov-eng):not(.ov-spread) .chart-compare"));
      await p.locator(".ov-period .ov-history-compare .btn", { hasText: "Previous period" }).click();
      await showOverview();
    });

    await step("Boards & areas: a row per board: deployed, leave, on-call share and net loans, a total, a row sets the selector", async () => {
      const order = await p.evaluate(() => [...document.querySelectorAll("#overview-panel > .ov-section")].map((s) => s.querySelector("h3").textContent.trim()).slice(-3));
      assert.deepEqual(order, ["Engineer workload", "Workforce", "Boards & areas"]);
      const rows = await p.evaluate(() => [...document.querySelectorAll(".ov-ba-table tbody tr")].map((tr) => [...tr.cells].map((c) => c.textContent.replace(/\s+/g, " ").trim())));
      assert.deepEqual(rows.map((r) => [r[0], r[2], r[4], r[5], r[6]]), [
        ["Board One", "4.6", "0.4", "13.0%", "−2"],
        ["Board Two", "2.0", "0.0", "0.0%", "+2"],
        ["All boards", "6.6", "0.4", "9.1%", ""]], "net loans: F lent to Board Two on Tue and Wed (2 person-days each way)");
      await p.locator(".ov-ba-table tr[data-i='1']").click();
      assert.equal(await p.evaluate(() => state.overview.boardIds.join(",")), "b2");
      await showOverview();
    });

    await step("Boards & areas: the from → to loan table, when a loan touches the range", async () => {
      assert.equal(await p.locator(".ov-loans-from-to").count(), 0, "closed to begin with");
      await p.locator(".ov-ba-loans .ov-linkbtn").click();
      assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll(".ov-loans-from-to tbody tr")].map((tr) => [...tr.cells].map((c) => c.textContent.replace(/\s+/g, " ").trim()))), [["Board One → Board Two", "2", "1"]]);
      await showOverview({ from: pw[0], to: pw[4] });
      assert.equal(await p.locator(".ov-ba-loans").count(), 0, "no loan in that range: no table");
      await showOverview();
    });

    await step("Boards & areas: By service area: demand, supply, gap and the crew other areas covered", async () => {
      await p.locator(".ov-section#ov-boards-areas .btn", { hasText: "By service area" }).click();
      const rows = await p.evaluate(() => [...document.querySelectorAll(".ov-ba-table tbody tr")].map((tr) => [...tr.cells].map((c) => c.textContent.replace(/\s+/g, " ").trim())));
      assert.equal(rows.length, 2, "Host Gamma has no area and nobody: no No-area row");
      assert.deepEqual(rows[0], ["AREA2", "3.0", "2.0 2.0 permanent · 0.0 on-call", "-1.0", "1.0"], "Host Beta: 3 a day, 2 of the area's people; D (AREA1) covered 1 a day; the shortest first");
      assert.deepEqual(rows[1], ["AREA1", "3.6", "8.0 6.0 permanent · 2.0 on-call", "+4.4", "0.0"], "Host Alpha: 4, 4, 4, 3, 3");
      assert.equal(await p.locator(".ov-ba-table .ov-share-bad").count(), 1, "only the area short of people is red");
    });

    await step("the employee profile's deltas follow Compare with too", async () => {
      await showOverview({ compare: "ly" });
      await p.evaluate(() => openProfile(D().employees.find((e) => e.name === "Person C").id, "range"));
      await p.waitForSelector("#modal-profile:not(.hidden) .ov-prof-tiles");
      assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll(".ov-prof-tiles .ov-htile")].slice(0, 2).map((t) => t.querySelector(".ov-htile-delta").textContent)), ["▲ 5 vs same period last year", "= same period last year"], "Person C worked all five days against none a year ago; no leave either time");
      await p.evaluate(() => closeModal());
    });

    await step("in Thai the toolbar, Compare with, side by side, the share view and Boards & areas read in Thai", async () => {
      await showOverview({ compare: "ly" });
      await p.evaluate(() => I18N.setLang("th"));
      await p.waitForTimeout(300);
      const english = (xs) => xs.filter((x) => /[A-Za-z]{3}/.test(x.replace(/\bOC\b|Person [A-J]|Board (One|Two)|Eng (One|Two)|Host (Alpha|Beta|Gamma)|AREA[12]/g, "")));
      assert.deepEqual(english(await read(".ov-period, .ov-htoolbar, .ov-htile-delta")), [], "Compare with, the toolbar and the deltas in Thai");
      await p.locator('.ov-period-scope [aria-label="มุมมองบอร์ดของช่วงเวลา"] .btn').nth(1).click();   // View: Side by side (the label is Thai now)
      await p.waitForTimeout(200);
      assert.deepEqual(english(await read(".ov-small-multiples")), [], "side by side in Thai");
      await p.locator(".ov-htiles:not(.ov-eng-tiles) .ov-htile").nth(5).click();
      await p.locator(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head-row .btn").last().click();
      await p.waitForTimeout(200);
      assert.deepEqual(english(await read(".ov-hchart:not(.ov-eng):not(.ov-spread)")), [], "the on-call share view in Thai");
      assert.deepEqual(english(await read("#ov-boards-areas")), [], "Boards & areas, by board, in Thai");
      await p.locator("#ov-boards-areas .btn").nth(1).click();
      await p.waitForTimeout(200);
      assert.deepEqual(english(await read("#ov-boards-areas")), [], "by service area in Thai");
      const tip = async (sel) => { await p.locator(sel).first().hover(); await p.waitForTimeout(120); return (await p.locator("#chart-tip").innerText()).replace(/\s+/g, " "); };
      assert.deepEqual(english([await tip(".ov-small-multiples circle.chart-dot, .ov-hchart:not(.ov-eng):not(.ov-spread) rect.chart-mark")]), [], "a chart tooltip in Thai");
      await p.evaluate(() => I18N.setLang("en"));
    });

    await step("on a phone (400 px) the toolbar, side by side and Boards & areas fit the page", async () => {
      await p.setViewportSize({ width: 400, height: 800 });
      await showOverview();
      await periodView("Side by side");
      await p.waitForTimeout(300);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, "no sideways page scroll");
    });

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all overview-controls checks passed");
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
    if (failed) process.exit(1);
  }
})();
