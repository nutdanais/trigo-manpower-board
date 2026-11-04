/* Acceptance run for Overview → History, Phase 1 (leave, on-call, engineers, alerts):
     - six History tiles, each with its change against the previous period of the same length;
     - Leave / day counts annual, sick, business and unpaid leave: Exchange Working Day is not
       leave (a note and its own row, outside every total); a button per type shows or hides it;
       Chart | Calendar; the by-type table;
     - the People table's Leave view (the old Worked vs leave): working days (roster less Exchange
       days), worked, leave, Worked : Leave, leave share (amber above 20%, red above 30%), sortable,
       Everyone / Permanent / On-call;
     - On-call deployed / day: called in against available, and a link to People's On-call view;
     - click a day in a chart or the calendar to open that board on that date;
     - Engineer workload → one engineer: a row or the picker picks them, six measures, day /
       week / month against the average engineer, hosts and facts; a day opens their board
       filtered to them;
     - People's flags (the old Workload alerts): days in a row (weekends and the period before the
       range included) and people working mostly nights;
     (tests/e2e/overview-people.e2e.js covers the rest of People, the profile and Manpower's counting rule)
     - a board-day nobody planned is left out, and it all reads in Thai.
     NODE_PATH=$(npm root -g) node tests/e2e/history-leave-oncall.e2e.js
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
    // a fixed week in the past, Monday to Sunday, and the week before it (the "previous period")
    const back = h.addDays(h.iso(new Date()), -21);
    const W = h.addDays(back, -((new Date(back + "T00:00:00").getDay() + 6) % 7));
    const d = [0, 1, 2, 3, 4, 5, 6].map((i) => h.addDays(W, i));        // d[0..4] Mon-Fri, d[5], d[6] the weekend
    const pw = [0, 1, 2, 3, 4, 5, 6].map((i) => h.addDays(W, i - 7));   // the week before
    const db = new h.FakeDb();
    h.seedBase(db, { src: h.isWeekend(h.iso(new Date())) ? h.prevWorking(h.iso(new Date())) : h.iso(new Date()) });
    // Board One: Persons A-F permanent (e1-e6), G and H on-call (e7, e8).
    //   Every weekday: a day mission (Eng One, Host Alpha) and a night mission (Eng Two, Host Beta).
    //   A (e1) works every day of both weeks, weekends too: 14 days in a row, still going.
    //   C (e3) is on the night mission every weekday. D annual leave Mon+Tue, E sick Mon,
    //   F business Tue, H Exchange Working Day Mon. G is called in every weekday, H Tue (day) and Wed (night).
    // Board Two (I, J) has no mission: nobody planned it, so I's leave there is left out.
    const missions = [], as = [];
    const on = (e, day, m) => as.push({ employee_id: e, plan_date: day, mission_id: m, zone: null });
    const off = (e, day, z) => as.push({ employee_id: e, plan_date: day, mission_id: null, zone: z });
    d.forEach((day, i) => {
      missions.push({ id: "D" + i, board_id: "b1", plan_date: day, number: "30" + i, host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" });
      if (i < 5) missions.push({ id: "N" + i, board_id: "b1", plan_date: day, number: "40" + i, host: "Host Beta", customer: "Cust Beta", shift: "night", engineer_id: "eng-2" });
    });
    pw.forEach((day, i) => missions.push({ id: "P" + i, board_id: "b1", plan_date: day, number: "50" + i, host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" }));
    pw.forEach((day, i) => { on("e1", day, "P" + i); if (i < 5) on("e2", day, "P" + i); });
    d.forEach((day, i) => { on("e1", day, "D" + i); if (i < 5) { on("e2", day, "D" + i); on("e3", day, "N" + i); on("e7", day, "D" + i); } });
    off("e4", d[0], "annual"); off("e5", d[0], "sick"); off("e8", d[0], "exchange"); on("e6", d[0], "D0");
    off("e4", d[1], "annual"); off("e6", d[1], "business"); on("e5", d[1], "D1"); on("e8", d[1], "D1");
    on("e8", d[2], "N2");
    for (const i of [2, 3, 4]) for (const e of ["e4", "e5", "e6"]) on(e, d[i], "D" + i);
    off("e9", d[0], "annual");
    db.seed("missions", missions);
    db.seed("assignments", as);

    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const OVERVIEW = await p.evaluate(() => OVERVIEW_ID);
    const showOverview = () => p.evaluate(async ([day, ov, from, to]) => {
      state.date = day; D().activeBoardId = ov; state.filters.engineer = [];
      state.overview.boardId = "";
      state.overview.historyPreset = "custom"; state.overview.historyFrom = from; state.overview.historyTo = to;
      state.overview.historyCacheKey = null;
      await refreshAndRender();
    }, [d[6], OVERVIEW, d[0], d[6]]);
    await showOverview();
    const read = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, " ").trim()), sel);
    const tiles = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".ov-htiles:not(.ov-eng-tiles) .ov-htile")].map((t) => {
      const q = (c) => (t.querySelector(c) || { textContent: "" }).textContent.replace(/\s+/g, " ").trim();
      return [q(".ov-htile-label"), { value: q(".ov-htile-value"), sub: q(".ov-htile-sub"), delta: q(".ov-htile-delta"), cls: (t.querySelector(".ov-htile-delta") || { className: "" }).className }];
    })));
    const pick = async (label) => { await p.locator(".ov-htiles:not(.ov-eng-tiles) .ov-htile", { hasText: label }).first().click(); await p.waitForTimeout(150); };
    const rowsOf = (sel) => p.evaluate((s) => [...document.querySelectorAll(s + " tbody tr")].map((tr) => [...tr.cells].map((c) => c.textContent.replace(/\s+/g, " ").trim())), sel);
    const dayMon = (iso) => { const [, m, dd] = iso.split("-").map(Number); return `${dd} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`; };

    await step("six tiles, each against the previous period; Leave / day leaves Exchange Working Day out", async () => {
      const t = await tiles();
      assert.equal(Object.keys(t).length, 6, "six History tiles");
      assert.equal(t["Leave / day"].value, "0.8 avg", "Mon 2, Tue 2 (Exchange not counted), Wed-Fri 0; Board Two's leave is left out");
      assert.equal(t["Leave / day"].delta, "▲ 0.8 vs previous period");
      assert.match(t["Leave / day"].cls, /\bbad\b/, "more leave reads red");
      assert.equal(t["On-call deployed / day"].value, "1.4 avg", "G every day, H on Tue and Wed");
      assert.equal(t["On-call deployed / day"].delta, "▲ 1.4 vs previous period");
      assert.doesNotMatch(t["On-call deployed / day"].cls, /good|bad/, "more on-call is neither good nor bad");
      assert.match(t["On-call deployed / day"].sub, / 1 of 2$/, "Friday: G called in, both on-call people available");
      assert.equal(t["Missions / day"].delta, "▲ 1 vs previous period", "2 a day against 1 the week before");
    });

    await step("Leave: four types, Exchange as a note and its own row, the by-type table", async () => {
      await pick("Leave / day");
      assert.deepEqual(await read(".ov-lv-chip"), ["Annual Leave 0.4 / day", "Sick Leave 0.2 / day", "Business Leave 0.2 / day", "Unpaid Leave 0.0 / day"]);
      assert.deepEqual(await read(".ov-lv-exchange"), ["1 Exchange Working Day · not counted as leave"]);
      const rows = await rowsOf(".ov-lv-table");
      assert.deepEqual(rows.map((r) => r.slice(0, 5)), [
        ["Annual Leave", "2", "0.4", "50%", "1"], ["Sick Leave", "1", "0.2", "25%", "1"], ["Business Leave", "1", "0.2", "25%", "1"],
        ["Unpaid Leave", "0", "0.0", "0%", "0"], ["All leave", "4", "0.8", "", "3"], ["Exchange Working Day", "1", "0.2", "not leave", "1"]]);
      assert.equal(await p.locator(".ov-hchart:not(.ov-eng) .chart-column-chart rect.chart-mark").count(), 4, "Mon: annual + sick; Tue: annual + business");
    });

    await step("People → Leave view: per person, sorted by leave share, amber / red, Exchange days out of working days", async () => {
      assert.deepEqual(await read(".ov-hchart:not(.ov-eng) .ov-people-link"), ["Per person → People"], "a link where the list used to be");
      await p.locator(".ov-people-bar .btn", { hasText: "Leave" }).click();
      const rows = (await rowsOf(".ov-people-table")).map((r) => r.slice(0, 7));
      assert.deepEqual(rows, [
        ["Person D", "5", "3", "2", "3 : 2 (1.5 : 1)", "40.0%", "—"],
        ["Person E", "5", "4", "1", "4 : 1 (4.0 : 1)", "20.0%", "1"],
        ["Person F", "5", "4", "1", "4 : 1 (4.0 : 1)", "20.0%", "—"],
      ], "only the people who took leave, the highest leave share first (no 0% rows)");
      assert.deepEqual(await read(".ov-leave-sum"), ["3 of 8 people had leave in this range · Highest leave share first"]);
      const pills = await p.evaluate(() => [...document.querySelectorAll(".ov-people-table .ov-share")].slice(0, 3).map((x) => x.className.split(" ").pop()));
      assert.deepEqual(pills, ["ov-share-bad", "ov-share-ok", "ov-share-ok"], "40% is red; exactly 20% is not above 20%");
      await p.locator(".ov-people-table .ov-sort", { hasText: "Name" }).click();
      assert.deepEqual((await rowsOf(".ov-people-table")).map((r) => r[0]).slice(0, 2), ["Person D", "Person E"], "sorted by name");
      await p.locator(".ov-people-bar .btn", { hasText: "On-call" }).nth(1).click();
      assert.equal(await p.locator(".ov-people-table").count(), 0, "no on-call person took leave: no table");
      assert.equal(await p.getByText("Nobody took leave in this range.").count(), 1);
      await p.locator(".ov-people-bar .btn", { hasText: "Everyone" }).click();
    });

    await step("a type button hides that type, never the last one; the calendar counts the types shown", async () => {
      await p.locator(".ov-lv-chip", { hasText: "Annual Leave" }).click();
      assert.equal(await p.locator(".ov-hchart:not(.ov-eng) .chart-column-chart rect.chart-mark").count(), 2);
      for (const t of ["Sick Leave", "Business Leave", "Unpaid Leave"]) await p.locator(".ov-lv-chip", { hasText: t }).click();
      assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll(".ov-lv-chip")].map((c) => c.getAttribute("aria-pressed"))), ["false", "false", "false", "true"], "Unpaid, the last one on, stays on");
      for (const t of ["Annual Leave", "Sick Leave", "Business Leave"]) await p.locator(".ov-lv-chip", { hasText: t }).click();
      await p.locator(".ov-hview .btn", { hasText: "Calendar" }).click();
      const cells = await p.evaluate(() => [...document.querySelectorAll(".ov-cal-cell.chart-mark")].map((c) => [c.querySelector(".ov-cal-n").textContent, c.querySelector(".ov-cal-oc").textContent, c.dataset.tipLabel]));
      assert.deepEqual(cells.map((c) => c.slice(0, 2)), [["2", "1 on-call"], ["2", "2 on-call"], ["0", "2 on-call"], ["0", "1 on-call"], ["0", "1 on-call"]]);
      assert.match(cells[0][2], /Annual Leave 1 · Sick Leave 1 · 1 on-call deployed of 1$/, "no Exchange in the day's leave");
      await p.locator(".ov-hview .btn", { hasText: "Chart" }).click();
    });

    await step("click a day in the leave chart to open that board on that date", async () => {
      await p.locator(`.ov-hchart:not(.ov-eng) .chart-column-chart rect.chart-mark[data-date="${d[1]}"]`).first().click();
      await p.waitForTimeout(300);
      const at = await p.evaluate(() => [state.date, D().activeBoardId, state.filters.engineer.length]);
      assert.deepEqual(at, [d[1], "b1", 0]);
      await showOverview();
    });

    await step("On-call: called in against available, and People's On-call view says who was called in most", async () => {
      await pick("On-call deployed / day");
      assert.deepEqual(await read(".ov-hchart:not(.ov-eng):not(.ov-spread) .ov-hchart-head-row .ov-muted"), ["Called in on 78% of the available on-call days · 21% of the people on missions"], "7 of 9 on-call days (Mon: H on Exchange); 7 of 33 people on missions");
      assert.equal(await p.locator(".ov-hnames").count(), 0, "the Most called in list is gone");
      await p.locator(".ov-hchart:not(.ov-eng) .ov-people-link .ov-linkbtn").click();
      assert.equal(await p.locator(".ov-people-bar .btn.active").first().textContent(), "On-call", "the link opens People's On-call view");
      const rows = await rowsOf(".ov-people-table");
      assert.deepEqual(rows.map((r) => r[0] + " | " + r[3]), ["Person G OC | 5", "Person H OC | 2"], "Called in");
    });

    await step("Engineer workload → one engineer: tiles, chart against the average, hosts, facts", async () => {
      const eng = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".ov-eng-tiles .ov-htile")].map((t) => [t.querySelector(".ov-htile-label").textContent, t.querySelector(".ov-htile-value").textContent])));
      assert.equal(await p.evaluate(() => document.querySelector(".ov-eng-select").selectedOptions[0].textContent), "Eng One", "the busiest engineer to begin with");
      assert.deepEqual(await eng(), { "Missions": "1.0", "Crew (person-days)": "5.4", "Crew per mission": "5.4", "Active days": "5", "Night share": "0.0%", "On-call share": "22.2%" });
      assert.deepEqual(await read(".ov-eng-hosts > span"), ["Host Alpha 5"]);
      assert.deepEqual(await read(".ov-eng-facts > div"), ["Rank by missions 1 of 2", "Missions in the range 5", "Person-days managed 27", "Longest run of active days 5"]);
      await p.locator("tr[data-eng='eng-2']").click();
      await p.waitForTimeout(150);
      assert.equal((await eng())["Night share"], "100.0%", "a row picks the engineer");
      assert.equal(await p.locator("tr[data-eng='eng-2'].is-picked").count(), 1);
      await p.locator(".ov-eng .btn", { hasText: "Daily" }).click();
      assert.equal(await p.locator(".ov-eng .chart-column-chart rect.chart-mark").count(), 5, "one column a day");
      assert.equal(await p.locator(".ov-eng .chart-column-chart polyline").count(), 1, "the average engineer");
      await p.locator(`.ov-eng .chart-column-chart rect.chart-mark[data-date="${d[2]}"]`).click();
      await p.waitForTimeout(300);
      assert.deepEqual(await p.evaluate(() => [state.date, D().activeBoardId, state.filters.engineer]), [d[2], "b1", ["eng-2"]], "opens their board on that day, filtered to them");
      await showOverview();
    });

    await step("People flags: 14 days in a row (the week before and the weekend included), mostly nights, leave above 30%", async () => {
      assert.equal(await p.locator("h3", { hasText: "Workload alerts" }).count(), 0, "the Workload alerts section is gone");
      await p.locator(".ov-people-bar .btn", { hasText: "Alerts only" }).click();
      const flags = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".ov-people-table tbody tr")].map((tr) => [tr.cells[0].textContent.replace(/\s+/g, " ").trim(), [...tr.querySelectorAll(".ov-flag")].map((f) => f.textContent.trim())])));
      assert.deepEqual(flags, { "Person A": ["14 in a row · still going"], "Person C": ["mostly nights"], "Person D": ["leave > 30%"] });
      assert.equal(await p.locator(".ov-people-table .ov-flag-bad").count(), 2, "10 or more days in a row and leave above 30% are red");
      assert.match(await p.locator(".ov-people-table .ov-flag", { hasText: "in a row" }).getAttribute("title"), new RegExp(`${dayMon(pw[0])} → still going`));
    });

    await step("in Thai the new tiles, views, tables and alerts read in Thai", async () => {
      await p.evaluate(() => I18N.setLang("th"));
      await p.waitForTimeout(200);
      const english = (xs) => xs.filter((x) => /[A-Za-z]{3}/.test(x.replace(/\bOC\b|Person [A-J]|Board (One|Two)|Eng (One|Two)|Host (Alpha|Beta)/g, "")));
      const labels = await read(".ov-htiles:not(.ov-eng-tiles) .ov-htile-label");
      assert.deepEqual(labels.slice(4), ["ลา / วัน", "ออนคอลที่ปฏิบัติงาน / วัน"]);
      assert.deepEqual(english(await read(".ov-htile-delta, .ov-htile-help")), [], "deltas and help in Thai");
      assert.deepEqual(english(await read(".ov-hchart-head-row .ov-muted, .ov-hchart .ov-legend, .ov-people-link")), [], "on-call view in Thai");
      assert.deepEqual(english(await read(".ov-eng")), [], "one-engineer view in Thai");
      assert.deepEqual(english(await read("#ov-people")), [], "People in Thai");
      await p.locator(".ov-htiles:not(.ov-eng-tiles) .ov-htile").nth(4).click();
      await p.waitForTimeout(200);
      assert.deepEqual(await read(".ov-hview .btn"), ["กราฟ", "ปฏิทิน"]);
      assert.deepEqual(english(await read(".ov-lv-chips, .ov-lv-table, .ov-people-link")), [], "leave view and by-type table in Thai");
      await p.locator(".ov-hview .btn").nth(1).click();
      await p.waitForTimeout(200);
      assert.deepEqual(english(await read(".ov-cal-cell, .ov-cal-key, .ov-cal-dow")), [], "the calendar in Thai");
      await p.evaluate(() => I18N.setLang("en"));
    });

    await step("Manpower List: Worked, Leave, Leave share over the period (90D), Exchange not leave, in the Excel rows", async () => {
      await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      await p.locator("#emplist-period + .seg-pick button", { hasText: "90D" }).click();
      await p.waitForTimeout(500);
      const heads = (await p.locator("#emplist-table thead th:not(.hidden)").allTextContents()).map((x) => x.trim());
      for (const hd of ["90D utilization", "Worked", "Leave", "Leave share"]) assert.ok(heads.includes(hd), hd + " in " + heads.join(" | "));
      assert.ok(!heads.includes("Worked : Leave"), "the ratio column is gone: the leave share replaces it");
      const cells = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll("#emplist-body tr")].map((tr) =>
        [tr.querySelector("td[data-label=Name]").textContent.trim().split(/\s{2,}|\n/)[0], [...tr.querySelectorAll("td.el-wl")].map((td) => td.textContent.replace(/\s+/g, " ").trim())])));
      // seedBase also puts D on a mission and E on annual leave today
      assert.deepEqual(cells["Person D"].slice(0, 2), ["4", "2"], "Wed-Fri and today worked; annual leave Mon and Tue");
      assert.deepEqual(cells["Person E"].slice(0, 2), ["4", "2"], "sick Monday and annual leave today");
      assert.deepEqual(cells["Person H"].slice(0, 2), ["2", "0"], "Exchange Working Day is not leave");
      assert.match(cells["Person D"][2], /^\d+\.\d%$/, "the Leave share column");
      assert.equal(cells["Person H"][2], "0.0%");
      const x = await p.evaluate(() => { const r = emplistXlsxRows().find((y) => y.name === "Person D"); return [r.worked, r.leaveDays, ManpowerXlsx.listColumns([r], "90D").map((c) => c.label)]; });
      assert.deepEqual(x.slice(0, 2), [4, 2]);
      for (const l of ["90D Utilization", "Worked (days)", "Leave (days)", "Leave Share"]) assert.ok(x[2].includes(l), l);
    });

    await step("Manpower List: a role without History doesn't see Worked : Leave, in the table or the file", async () => {
      for (const r of db.t("role_permissions")) if (r.role_key === "viewer" && r.area === "ov.history") r.level = "none";
      const v = await env.openAs(db, h.USERS.v);
      await v.page.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      await v.page.waitForTimeout(400);
      assert.equal(await v.page.locator("#emplist-table th.el-wl:not(.hidden)").count(), 0, "headers hidden");
      assert.equal(await v.page.locator("#emplist-body td.el-wl").count(), 0, "no cells");
      assert.equal(await v.page.evaluate(() => emplistXlsxRows().some((r) => "worked" in r)), false, "not in the Excel rows");
      assert.deepEqual(v.errors, []);
    });

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all history-leave-oncall checks passed");
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
    if (failed) process.exit(1);
  }
})();
