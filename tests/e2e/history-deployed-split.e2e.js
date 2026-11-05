/* Acceptance run for Overview → History: Deployed / day split, and On-call free.
     - Deployed / day: chips for Total, Permanent and On-call (each shows or hides, never all off), each with its
       average a day; Total alone is the plain line it always was; any other pick draws one line a series, or
       bars side by side with one colour a series, or Stacked: Permanent and On-call piled in one bar a day
       with the day's total above it (Line | Bars | Stacked);
     - Split by Service area: a stacked column a day, one colour per area, each day's total above it, a chip per
       area (with its average) that shows or hides it, counted by the person's OWN area (not the host's);
     - both follow Side by side (one small chart a board on one scale);
     - On-call deployed / day → Free: the on-call people available and not on a mission each day (on-call leave is
       neither called in nor free), with its average, a legend and the share of available days;
     - the choices are among the state Present mode puts back, and all of it reads in Thai.
     NODE_PATH=$(npm root -g) node tests/e2e/history-deployed-split.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 18).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    // a fixed week in the past (Monday to Sunday); Saturday and Sunday are not plotted
    const back = h.addDays(h.iso(new Date()), -21);
    const W = h.addDays(back, -((new Date(back + "T00:00:00").getDay() + 6) % 7));
    const d = [0, 1, 2, 3, 4, 5, 6].map((i) => h.addDays(W, i));
    const db = new h.FakeDb();
    h.seedBase(db, { src: h.isWeekend(h.iso(new Date())) ? h.prevWorking(h.iso(new Date())) : h.iso(new Date()) });
    // Board One: A-F permanent (e1-e6), G and H on-call (e7, e8). Board Two: I, J (planned on Monday only).
    // Service areas (seedBase has AREA1): AREA1 = A B G I; AREA2 = D E F H; C and J have no area.
    db.seed("service_areas", [{ id: "area-2", name: "AREA2", color: "#f0a05a" }]);
    for (const e of db.t("employees")) e.area_id = ["e4", "e5", "e6", "e8"].includes(e.id) ? "area-2" : ["e3", "e10"].includes(e.id) ? null : "area-1";
    const missions = [], as = [];
    const on = (e, day, m) => as.push({ employee_id: e, plan_date: day, mission_id: m, zone: null });
    const off = (e, day, z) => as.push({ employee_id: e, plan_date: day, mission_id: null, zone: z });
    for (let i = 0; i < 5; i++) missions.push({ id: "D" + i, board_id: "b1", plan_date: d[i], number: "30" + i, host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" });
    missions.push({ id: "B0", board_id: "b2", plan_date: d[0], number: "700", host: "Host Beta", customer: "Cust Beta", shift: "day", engineer_id: "eng-2" });
    //            Total Perm On-call | AREA1 AREA2 No area
    on("e1", d[0], "D0"); on("e4", d[0], "D0"); on("e7", d[0], "D0"); on("e9", d[0], "B0"); on("e10", d[0], "B0");   // Mon 5 4 1 | 3 1 1
    on("e1", d[1], "D1"); on("e2", d[1], "D1"); on("e5", d[1], "D1"); on("e8", d[1], "D1");                         // Tue 4 3 1 | 2 2 0
    on("e1", d[2], "D2"); on("e2", d[2], "D2"); on("e3", d[2], "D2"); on("e6", d[2], "D2");                         // Wed 4 4 0 | 2 1 1
    on("e1", d[3], "D3"); on("e7", d[3], "D3"); on("e8", d[3], "D3");                                               // Thu 3 1 2 | 2 1 0
    on("e2", d[4], "D4"); off("e8", d[4], "annual");                                                                // Fri 1 1 0 | 1 0 0, H on leave
    db.seed("missions", missions);
    db.seed("assignments", as);

    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const OVERVIEW = await p.evaluate(() => OVERVIEW_ID);
    const showOverview = (extra = {}) => p.evaluate(async ([day, ov, from, to, more]) => {
      state.date = day; D().activeBoardId = ov; state.filters.engineer = [];
      state.overview.boardIds = [];
      state.overview.historyPreset = "custom"; state.overview.historyFrom = from; state.overview.historyTo = to;
      state.overview.historyCacheKey = null; state.overview.historyGroup = "day"; state.overview.historyCompare = "prev";
      state.overview.historyMeasure = "deployed"; state.overview.historyOncallMode = "count";
      state.overview.historyDeployedBy = "contract"; state.overview.historyDeployedShow = ["total"];
      state.overview.historyDeployedStyle = "line"; state.overview.historyAreaHidden = [];
      Object.assign(state.overview, more);
      setOvPeriod({ ids: [], linked: true, view: "together" });
      await refreshAndRender();
    }, [d[6], OVERVIEW, d[0], d[6], extra]);
    await showOverview();
    const read = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, " ").trim()), sel);
    const chips = () => read(".ov-dep-chips .ov-lv-chip");
    const pressed = () => p.evaluate(() => [...document.querySelectorAll(".ov-dep-chips .ov-lv-chip")].map((c) => c.getAttribute("aria-pressed")));
    const chip = async (label) => { await p.locator(".ov-dep-chips .ov-lv-chip", { hasText: label }).click(); await p.waitForTimeout(120); };
    const seg = async (label) => { await p.locator(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head-row .ov-trend-btns .btn, .ov-dep-chips .ov-trend-btns .btn", { hasText: label }).first().click(); await p.waitForTimeout(150); };
    const dayMon = (iso) => { const [, m, dd] = iso.split("-").map(Number); return `${dd} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`; };
    const [MON, TUE, WED, THU, FRI] = d.slice(0, 5).map(dayMon);
    // "Series — 5 Oct · 5 deployed" -> the day
    const dayOf = (x) => x.label.split(" — ")[1].split(" · ")[0];
    const title = () => read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head b");
    const dots = () => p.evaluate(() => [...document.querySelectorAll(".chart-line-chart circle.chart-dot")].map((c) => c.dataset.tipLabel.split(" — ")[0] + "=" + c.dataset.tipValue));
    // every column segment of the chart: "Series — day · total" → value
    const marks = () => p.evaluate(() => [...document.querySelectorAll(".ov-hchart:not(.ov-eng):not(.ov-spread) .chart-column-chart rect.chart-mark")].map((r) => ({ label: r.dataset.tipLabel, value: r.dataset.tipValue, fill: r.getAttribute("fill"), x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")), h: Number(r.getAttribute("height")) })));
    const totalsText = () => read(".ov-hchart:not(.ov-eng):not(.ov-spread) .chart-column-chart .chart-total");
    const totalsY = () => p.evaluate(() => [...document.querySelectorAll(".ov-hchart:not(.ov-eng):not(.ov-spread) .chart-column-chart .chart-total")].map((t) => Number(t.getAttribute("y"))));

    await step("Total alone is the plain line: chips with their averages, Split by and Line | Bars", async () => {
      assert.deepEqual(await title(), ["Deployed / day, day by day"]);
      assert.deepEqual(await chips(), ["Total 3.4 / day", "Permanent 2.6 / day", "On-call 0.8 / day"], "17, 13 and 4 person-days over 5 working days");
      assert.deepEqual(await pressed(), ["true", "false", "false"]);
      assert.deepEqual(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head-row .ov-htool .btn"), ["Permanent / on-call", "Service area"]);
      assert.deepEqual(await read(".ov-dep-chips .ov-htool .btn"), ["Line", "Bars", "Stacked"]);
      assert.equal(await p.locator(".ov-hchart:not(.ov-eng):not(.ov-spread) .chart-line-chart polyline").count(), 1, "the one line");
      assert.ok((await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .chart-line-chart text.chart-axis-label")).includes("avg"), "and its average rule");
      assert.equal(await p.locator(".ov-hchart:not(.ov-eng):not(.ov-spread) .chart-column-chart").count(), 0);
      assert.deepEqual(await dots(), ["Deployed / day=5", "Deployed / day=4", "Deployed / day=4", "Deployed / day=3", "Deployed / day=1"]);
    });

    await step("Permanent alone is its own line, in its own colour", async () => {
      await chip("Permanent");
      await chip("Total");
      assert.deepEqual(await pressed(), ["false", "true", "false"]);
      assert.deepEqual(await title(), ["Permanent deployed / day, day by day"]);
      assert.deepEqual(await dots(), ["Permanent deployed / day=4", "Permanent deployed / day=3", "Permanent deployed / day=4", "Permanent deployed / day=1", "Permanent deployed / day=1"]);
      assert.equal(await p.locator('.ov-hchart:not(.ov-eng):not(.ov-spread) .chart-line-chart circle.chart-dot[fill="var(--chart-cat-3)"]').count(), 5);
    });

    await step("all three as lines: one line a series, no average rule", async () => {
      await chip("Total"); await chip("On-call");
      assert.deepEqual(await pressed(), ["true", "true", "true"]);
      assert.equal(await p.locator(".ov-hchart:not(.ov-eng):not(.ov-spread) .chart-line-chart polyline.chart-line").count(), 3);
      const colours = await p.evaluate(() => [...new Set([...document.querySelectorAll(".chart-line-chart circle.chart-dot")].map((c) => c.getAttribute("fill")))]);
      assert.deepEqual(colours.sort(), ["var(--chart-assigned)", "var(--chart-cat-3)", "var(--chart-oncall)"].sort());
      assert.equal(await p.locator(".ov-dep-note").count(), 0, "no comparison to explain: the week before was not planned");
    });

    await step("Bars: Total, Permanent and On-call side by side in a day, each from the baseline in its own colour", async () => {
      await seg("Bars");
      const m = await marks();
      assert.equal(m.length, 13, "5 Total + 5 Permanent + 3 On-call (Mon, Tue, Thu)");
      const wed = m.filter((x) => dayOf(x) === WED);
      assert.deepEqual(wed.map((x) => [x.label.split(" — ")[0], x.value, x.fill]), [["Total", "4", "var(--chart-assigned)"], ["Permanent", "4", "var(--chart-cat-3)"]], "nobody on-call on Wednesday: no On-call bar");
      const mon = m.filter((x) => dayOf(x) === MON);
      assert.deepEqual(mon.map((x) => x.value), ["5", "4", "1"]);
      assert.equal(new Set(mon.map((x) => x.x)).size, 3, "three different positions: side by side, not stacked");
      assert.deepEqual(mon.map((x) => x.fill), ["var(--chart-assigned)", "var(--chart-cat-3)", "var(--chart-oncall)"]);
      assert.deepEqual(await title(), ["Deployed / day, day by day"]);
    });

    await step("never all off: the last series stays on, and a single series as bars is still bars", async () => {
      await chip("Total"); await chip("Permanent");
      assert.deepEqual(await pressed(), ["false", "false", "true"]);
      await chip("On-call");
      assert.deepEqual(await pressed(), ["false", "false", "true"], "On-call, the last one on, stays on");
      assert.equal((await marks()).length, 3, "On-call bars: Mon 1, Tue 1, Thu 2");
      await chip("Total");
    });

    await step("Stacked: Permanent and On-call piled in one bar a day, the day's total behind and above it", async () => {
      await p.evaluate(() => { state.overview.historyDeployedShow = ["total", "perm", "oncall"]; state.overview.historyDeployedStyle = "line"; render(); });
      await p.waitForTimeout(200);
      await seg("Stacked");
      assert.equal(await p.evaluate(() => state.overview.historyDeployedStyle), "stacked");
      let m = await marks();
      const of = (name) => m.filter((x) => x.label.startsWith(name + " — "));
      const mon = (name) => of(name).find((x) => dayOf(x) === MON);
      assert.deepEqual(of("Permanent").map((x) => x.value), ["4", "3", "4", "1", "1"]);
      assert.deepEqual(of("On-call").map((x) => x.value), ["1", "1", "2"], "Mon, Tue, Thu");
      assert.deepEqual(of("Total").map((x) => x.value), ["5", "4", "4", "3", "1"], "the pale bar behind each stack is the day's total");
      assert.equal(mon("Permanent").x, mon("On-call").x, "one bar: the same place, not side by side");
      assert.ok(Math.abs(mon("Permanent").y - (mon("On-call").y + mon("On-call").h)) < 0.3, "On-call sits on top of Permanent");
      assert.ok(Math.abs(mon("Total").y - mon("On-call").y) < 0.3, "the stack reaches the total");
      assert.deepEqual([mon("Permanent").fill, mon("On-call").fill, mon("Total").fill], ["var(--chart-cat-3)", "var(--chart-oncall)", "var(--chart-assigned-ghost)"]);
      assert.equal(mon("Permanent").label, `Permanent — ${MON} · 5 deployed`, "the total in the tooltip");
      assert.deepEqual(await totalsText(), ["5", "4", "4", "3", "1"], "the day's total above each bar");

      await chip("Total");   // off: just the two parts
      m = await marks();
      assert.equal(of("Total").length, 0, "no pale bar");
      assert.equal(m.length, 8, "5 Permanent + 3 On-call");
      assert.deepEqual(await totalsText(), [], "no totals above the bars");
      assert.equal(of("Permanent")[0].label, `Permanent — ${MON}`, "no total in the tooltip either");

      await chip("Total"); await chip("On-call");   // Total on, On-call off: Permanent is a share of the total
      m = await marks();
      assert.equal(of("On-call").length, 0);
      assert.deepEqual(of("Total").map((x) => x.value), ["5", "4", "4", "3", "1"]);
      assert.ok(mon("Total").y < mon("Permanent").y - 1, "the pale total bar stands above the Permanent bar");
      assert.deepEqual(await totalsText(), ["5", "4", "4", "3", "1"], "the total, not the Permanent figure");
      assert.ok((await totalsY())[0] < mon("Total").y, "and the figure sits above the pale bar");

      await chip("Permanent");   // only Total on: it is the bar
      m = await marks();
      assert.deepEqual(m.map((x) => [x.label.split(" — ")[0], x.value, x.fill]), ["5", "4", "4", "3", "1"].map((v) => ["Total", v, "var(--chart-assigned)"]));
      assert.deepEqual(await totalsText(), []);
      await chip("Permanent"); await chip("On-call");
      assert.deepEqual(await pressed(), ["true", "true", "true"]);
    });

    await step("Split by Service area: a stacked column a day, an area per colour, the day's total above it", async () => {
      await seg("Service area");
      assert.deepEqual(await title(), ["Deployed by service area, day by day"]);
      assert.deepEqual(await chips(), ["AREA1 2.0 / day", "AREA2 1.0 / day", "No area 0.4 / day"], "the person's own area: 10 + 5 + 2 = 17 person-days");
      assert.deepEqual(await pressed(), ["true", "true", "true"]);
      assert.deepEqual(await read(".ov-dep-note"), ["By each person's own service area, not the area of the host they were sent to."]);
      const m = await marks();
      assert.equal(m.length, 11, "Mon 3 areas, Tue 2, Wed 3, Thu 2, Fri 1");
      const mon = m.filter((x) => dayOf(x) === MON);
      assert.deepEqual(mon.map((x) => [x.label.split(" — ")[0], x.value]), [["AREA1", "3"], ["AREA2", "1"], ["No area", "1"]]);
      assert.deepEqual(mon.map((x) => x.fill), ["#7fb8ec", "#f0a05a", "var(--muted)"], "each area in its own colour");
      assert.match(mon[0].label, /5 deployed$/, "the day's total in the tooltip");
      assert.deepEqual(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .chart-column-chart .chart-total"), ["5", "4", "4", "3", "1"]);
    });

    await step("an area chip shows or hides it; the totals follow, and the last one on stays on", async () => {
      await chip("AREA2");
      assert.deepEqual(await pressed(), ["true", "false", "true"]);
      assert.deepEqual(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .chart-column-chart .chart-total"), ["4", "2", "3", "2", "1"]);
      assert.equal((await marks()).length, 7, "AREA1 on five days, No area on two");
      await chip("AREA1");
      await chip("No area");
      assert.deepEqual(await pressed(), ["false", "false", "true"], "No area, the last one on, stays on");
      await chip("AREA1"); await chip("AREA2");
      assert.deepEqual(await pressed(), ["true", "true", "true"]);
    });

    await step("a week groups the days: the average a day, and Group by still applies", async () => {
      await p.locator(".ov-htoolbar .btn", { hasText: "Week" }).click();
      await p.waitForTimeout(150);
      assert.equal(await p.evaluate(() => state.overview.historyGroup), "week");
      assert.deepEqual(await title(), ["Deployed by service area, week by week"]);
      const m = await marks();
      assert.deepEqual(m.map((x) => [x.label.split(" — ")[0], x.value]), [["AREA1", "2"], ["AREA2", "1"], ["No area", "0.4"]], "one column for the week: the day's average");
      assert.match(m[0].label, /3\.4 deployed \/ day$/);
      await p.locator(".ov-htoolbar .btn", { hasText: "Day" }).click();
      await p.waitForTimeout(150);
    });

    await step("Side by side: one small chart a board on one scale, for the area stack and for the bars", async () => {
      await showOverview({ historyDeployedBy: "area" });
      await p.evaluate(() => setOvPeriod({ ids: ["b1", "b2"], linked: false, view: "side" }));
      await p.waitForTimeout(300);
      assert.equal(await p.locator(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-small").count(), 2);
      assert.deepEqual(await read(".ov-small-head .ov-linkbtn"), ["Board One", "Board Two"]);
      assert.equal(await p.locator('.ov-small[data-board="b2"] .chart-column-chart rect.chart-mark').count(), 2, "Board Two: Monday only, I (AREA1) and J (no area)");
      assert.equal(await p.locator('.ov-small[data-board="b1"] .chart-column-chart rect.chart-mark').count(), 10, "Board One: Mon 2, Tue 2, Wed 3, Thu 2, Fri 1 (without I and J)");
    });

    await step("Side by side on the contract split: each board names its averages", async () => {
      await p.evaluate(() => { state.overview.historyDeployedBy = "contract"; state.overview.historyDeployedShow = ["total", "perm"]; state.overview.historyDeployedStyle = "bars"; render(); });
      await p.waitForTimeout(300);
      assert.deepEqual(await read(".ov-small-head .ov-muted"), ["Total 3.0", "Permanent 2.2", "Total 2.0", "Permanent 2.0"]);
      assert.equal(await p.locator(".ov-small .chart-column-chart").count(), 2);
      await p.evaluate(() => { state.overview.historyDeployedStyle = "stacked"; render(); });
      await p.waitForTimeout(300);
      assert.equal(await p.locator(".ov-small .chart-column-chart").count(), 2, "Stacked follows Side by side too");
      assert.deepEqual(await read(".ov-small-head .ov-muted"), ["Total 3.0", "Permanent 2.2", "Total 2.0", "Permanent 2.0"]);
    });

    await step("A vs B: one series as a line is two lines, a board each", async () => {
      await p.evaluate(() => { state.overview.historyDeployedShow = ["perm"]; state.overview.historyDeployedStyle = "line"; setOvPeriod({ ids: ["b1", "b2"], linked: false, view: "vs" }); });
      await p.waitForTimeout(300);
      assert.equal(await p.locator(".ov-hchart:not(.ov-eng):not(.ov-spread) .chart-line-chart polyline.chart-line").count(), 1, "Board One's line; Board Two was planned one day, so one dot");
      assert.deepEqual([...new Set((await dots()).map((x) => x.split("=")[0]))].sort(), ["Board One", "Board Two"], "a series a board");
      assert.equal((await dots()).filter((x) => x.startsWith("Board Two")).length, 1);
      assert.deepEqual(await title(), ["Permanent deployed / day, day by day"]);
    });

    await step("On-call → Free: available and not called in, on-call leave neither", async () => {
      await showOverview({ historyMeasure: "oncall" });
      assert.deepEqual(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head-row .ov-trend-btns .btn"), ["Count", "Share", "Free"]);
      await p.locator(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head-row .ov-trend-btns .btn", { hasText: "Free" }).click();
      await p.waitForTimeout(200);
      assert.deepEqual(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head b"), ["On-call free, day by day"]);
      assert.deepEqual(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head-row .ov-muted"), ["Free on 56% of the available on-call days · avg 1.0 / day"], "4 called in of 9 available days (H on leave Friday); 5 free");
      assert.deepEqual(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-legend"), ["On-call free · 1.0 / day"]);
      const m = await marks();
      assert.deepEqual(m.map((x) => x.value), ["1", "1", "2", "1"], "Mon 1, Tue 1, Wed 2, Thu none (no bar), Fri 1");
      assert.equal(m[3].label, `On-call free — ${FRI} · 1 of 1 on-call`, "Friday: H is on leave, so one is available and H is not counted free");
      assert.equal(m[2].label, `On-call free — ${WED} · 2 of 2 on-call`);
      assert.ok(m.every((x) => x.fill === "var(--oncall-free)"));
      assert.equal(await p.locator(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head-row .ov-trend-btns .btn.active").textContent(), "Free");
    });

    await step("Count and Share still read as before", async () => {
      await p.locator(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head-row .ov-trend-btns .btn", { hasText: "Count" }).click();
      await p.waitForTimeout(150);
      assert.deepEqual(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head-row .ov-muted"), ["Called in on 44% of the available on-call days · 24% of the people on missions"]);
      await p.locator(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head-row .ov-trend-btns .btn", { hasText: "Share" }).click();
      await p.waitForTimeout(150);
      assert.deepEqual(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head b"), ["On-call share, day by day"]);
    });

    await step("Free follows Side by side and the week grouping", async () => {
      await p.evaluate(() => { state.overview.historyOncallMode = "free"; state.overview.historyGroup = "week"; setOvPeriod({ ids: ["b1", "b2"], linked: false, view: "side" }); });
      await p.waitForTimeout(300);
      assert.equal(await p.locator(".ov-small").count(), 2);
      assert.deepEqual(await read('.ov-small[data-board="b1"] .ov-small-head .ov-muted'), ["avg 1.0"]);
      const m = await marks();
      assert.ok(m.some((x) => x.value === "1" && /On-call free/.test(x.label)), "one column for the week: the average free a day");
    });

    await step("Present mode puts the new choices back when it ends", async () => {
      const keys = await p.evaluate(() => ["historyDeployedBy", "historyDeployedShow", "historyDeployedStyle", "historyAreaHidden"].every((k) => k in state.overview));
      assert.equal(keys, true, "state keys exist");
      const listed = await p.evaluate(() => fetch("present.js").then((r) => r.text()));
      for (const k of ["historyDeployedBy", "historyDeployedShow", "historyDeployedStyle", "historyAreaHidden"]) assert.ok(listed.includes(`"${k}"`), k + " is in Present's FIELDS");
    });

    await step("in Thai the split, the chips, the note, Free and its tooltips read in Thai", async () => {
      await showOverview();
      await p.evaluate(() => I18N.setLang("th"));
      await p.waitForTimeout(250);
      const english = (xs) => xs.filter((x) => /[A-Za-z]{3}/.test(x.replace(/AREA\d|Board (One|Two)/g, "")));
      assert.deepEqual(english(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head, .ov-dep-chips, .ov-hchart:not(.ov-eng):not(.ov-spread) .ov-legend")), [], "Deployed by contract in Thai");
      await p.evaluate(() => { state.overview.historyDeployedShow = ["total", "perm", "oncall"]; state.overview.historyDeployedStyle = "bars"; state.overview.historyDeployedBy = "contract"; render(); });
      await p.waitForTimeout(250);
      assert.deepEqual(english(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head, .ov-dep-chips")), [], "Bars in Thai");
      await p.evaluate(() => { state.overview.historyDeployedStyle = "stacked"; render(); });
      await p.waitForTimeout(250);
      assert.deepEqual(english(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head, .ov-dep-chips")), [], "Stacked in Thai");
      await p.evaluate(() => { state.overview.historyDeployedBy = "area"; render(); });
      await p.waitForTimeout(250);
      assert.deepEqual(english(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head, .ov-dep-chips, .ov-dep-note")), [], "by service area in Thai");
      const tips = await p.evaluate(() => [...document.querySelectorAll(".ov-hchart:not(.ov-eng):not(.ov-spread) [title], .ov-hchart:not(.ov-eng):not(.ov-spread) [aria-label]")]
        .filter((el) => !el.closest("svg")).map((el) => el.getAttribute("title") || el.getAttribute("aria-label")).filter(Boolean));
      assert.deepEqual(english(tips), [], "chip, button and group titles in Thai");
      await p.evaluate(() => { state.overview.historyMeasure = "oncall"; state.overview.historyOncallMode = "free"; render(); });
      await p.waitForTimeout(250);
      assert.deepEqual(english(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head-row, .ov-hchart:not(.ov-eng):not(.ov-spread) .ov-legend")), [], "Free in Thai");
      await p.evaluate(() => I18N.setLang("en"));
    });

    await step("on a phone (400 px) the chips, Bars, Stacked, the area stack and Free fit the page", async () => {
      await p.setViewportSize({ width: 400, height: 800 });
      for (const more of [
        { historyDeployedShow: ["total", "perm", "oncall"], historyDeployedStyle: "bars" },
        { historyDeployedShow: ["total", "perm", "oncall"], historyDeployedStyle: "stacked" },
        { historyDeployedBy: "area" },
        { historyMeasure: "oncall", historyOncallMode: "free" },
      ]) {
        await showOverview(more);
        await p.waitForTimeout(300);
        assert.ok(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, "no sideways page scroll: " + JSON.stringify(more));
        const chart = await p.evaluate(() => { const c = document.querySelector(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-trend-chart"); const r = c.getBoundingClientRect(); return [r.left >= 0, r.right <= window.innerWidth, c.querySelectorAll("rect.chart-mark").length > 0]; });
        assert.deepEqual(chart, [true, true, true], "the chart sits inside the screen and has bars");
      }
    });

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all history-deployed-split checks passed");
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
    if (failed) process.exit(1);
  }
})();
