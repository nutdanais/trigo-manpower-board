/* Acceptance run for Overview phase 2, batch A (People and the employee profile):
     - A0: the range control is in the Period heading (not inside History); the Engineer workload
       tiles say how they moved against the previous period; Manpower's Worked, Leave and
       Worked : Leave count planned working days only, so they equal History's People table for
       the same person and range (a custom History range equal to the Manpower period);
     - A1: the People section replaces Worked vs leave, Most called in and Workload alerts; the
       spread chart (median, 90% or more, under 50%, a band filters the table); one table with
       the five quick views; every flag (days in a row, mostly nights, leave above 30%, never
       called in, newcomer-only mission); an on-call person with 0 call-ins shows with 0; the
       nights total equals the sum of nightEmp over the range;
     - A2: the profile, from a name in People and from the Manpower List's menu: header, period
       switch, tiles against the previous period, the 12-month chart, flags, hosts (experienced
       from 5 days), loans, notes; the same numbers as the People row; no figures without the
       Overview History permission; full screen on a phone; Thai.
     - the chart follows the view (layout B): the chips sit above it and drive it with the one Who switch;
       every view has Spread and Over time (Leave also a Calendar, Alerts "By flag"); a click on a band, a
       day or a flag filters the table and a chip names the pick; On-call is on-call people only; Thai; a phone.
     NODE_PATH=$(npm root -g) node tests/e2e/overview-people.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 120).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    // a fixed week in the past, Monday to Sunday, and the week before it (the "previous period")
    const today = h.iso(new Date());
    const back = h.addDays(today, -21);
    const W = h.addDays(back, -((new Date(back + "T00:00:00").getDay() + 6) % 7));
    const d = [0, 1, 2, 3, 4, 5, 6].map((i) => h.addDays(W, i));        // d[0..4] Mon-Fri, d[5], d[6] the weekend
    const pw = [0, 1, 2, 3, 4, 5, 6].map((i) => h.addDays(W, i - 7));   // the week before
    const db = new h.FakeDb();
    h.seedBase(db, { src: h.isWeekend(today) ? h.prevWorking(today) : today });
    // Board One: Persons A-F permanent, G and H on-call (seedBase), K on-call and L permanent (added here).
    //   Every weekday: a day mission (Eng One, Host Alpha) and a night mission (Eng Two, Host Beta).
    //   A works every day of both weeks, weekends too: 14 days in a row, still going.
    //   C is on the night mission every weekday. D annual leave Mon+Tue, E sick Mon, F business Tue,
    //   H Exchange Working Day Mon. G is called in every weekday, H Tue (day) and Wed (night).
    //   K (on-call) is never called in. L started 100 days before the week and is alone on a
    //   mission on Wednesday: a newcomer-only mission. M and N have no mission at all.
    // Board Two has no mission: nobody planned it, so I's leave there is left out.
    db.seed("employees", [
      { id: "e11", name_th: "Person K", contract: "oncall", area_id: "area-1", board_id: "b1" },
      { id: "e12", name_th: "Person L", contract: "permanent", area_id: "area-1", board_id: "b1", start_date: h.addDays(W, -100) },
      { id: "e13", name_th: "Person M", contract: "permanent", area_id: "area-1", board_id: "b1" },   // M and N: nothing planned for
      { id: "e14", name_th: "Person N", contract: "permanent", area_id: "area-1", board_id: "b1" },   // them all week (Standby), to make twelve people
    ]);
    const missions = [], as = [];
    const on = (e, day, m) => as.push({ employee_id: e, plan_date: day, mission_id: m, zone: null });
    const off = (e, day, z) => as.push({ employee_id: e, plan_date: day, mission_id: null, zone: z });
    d.forEach((day, i) => {
      missions.push({ id: "D" + i, board_id: "b1", plan_date: day, number: "30" + i, host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" });
      if (i < 5) missions.push({ id: "N" + i, board_id: "b1", plan_date: day, number: "40" + i, host: "Host Beta", customer: "Cust Beta", shift: "night", engineer_id: "eng-2" });
    });
    missions.push({ id: "X3", board_id: "b1", plan_date: d[3], number: "503", host: "Host Gamma", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" });
    pw.forEach((day, i) => missions.push({ id: "P" + i, board_id: "b1", plan_date: day, number: "50" + i, host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" }));
    pw.forEach((day, i) => { on("e1", day, "P" + i); if (i < 5) on("e2", day, "P" + i); });
    d.forEach((day, i) => { on("e1", day, "D" + i); if (i < 5) { on("e2", day, "D" + i); on("e3", day, "N" + i); on("e7", day, "D" + i); } });
    off("e4", d[0], "annual"); off("e5", d[0], "sick"); off("e8", d[0], "exchange"); on("e6", d[0], "D0");
    off("e4", d[1], "annual"); off("e6", d[1], "business"); on("e5", d[1], "D1"); on("e8", d[1], "D1");
    on("e8", d[2], "N2");
    for (const i of [2, 3, 4]) for (const e of ["e4", "e5", "e6"]) on(e, d[i], "D" + i);
    on("e12", d[3], "X3");
    off("e9", d[0], "annual");
    db.seed("missions", missions);
    db.seed("assignments", as);
    // A's host record: Host Alpha 6 days (experienced from 5), Host Beta 2
    db.seed("deployment_history", [
      ...[pw[0], pw[1], pw[2], pw[3], pw[4], d[0]].map((day) => ({ employee_id: "e1", plan_date: day, mission_number: "300", host: "Host Alpha", customer: "Cust Alpha" })),
      ...[d[1], d[2]].map((day) => ({ employee_id: "e1", plan_date: day, mission_number: "400", host: "Host Beta", customer: "Cust Beta" })),
    ]);
    db.seed("employee_notes", [{ employee_id: "e1", note: "Prefers day shifts", created_by: "eng.a@example.com" }]);
    // K was lent to Board Two for three days, long before the range
    db.seed("employee_loans", [{ employee_id: "e11", to_board_id: "b2", start_date: h.addDays(W, -60), end_date: h.addDays(W, -58), note: "Training" }]);

    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const OVERVIEW = await p.evaluate(() => OVERVIEW_ID);
    const showOverview = (from, to) => p.evaluate(async ([day, ov, f, t]) => {
      state.date = day; D().activeBoardId = ov; state.filters.engineer = [];
      state.overview.boardIds = [];
      state.overview.historyPreset = "custom"; state.overview.historyFrom = f; state.overview.historyTo = t;
      state.overview.historyCacheKey = null;
      state.overview.pplView = "workload"; state.overview.pplWho = "all"; state.overview.pplChart = "spread"; state.overview.pplPick = null; state.overview.pplSort = null; state.overview.pplAll = true;
      await refreshAndRender();
    }, [d[6], OVERVIEW, from || d[0], to || d[6]]);
    await showOverview();
    const read = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, " ").trim()), sel);
    const rowsOf = (sel) => p.evaluate((s) => [...document.querySelectorAll(s + " tbody tr")].map((tr) => [...tr.cells].map((c) => c.textContent.replace(/\s+/g, " ").trim())), sel);
    const view = (label) => p.locator(".ov-people-bar .btn", { hasText: label }).first().click();
    const dayMon = (iso) => { const [, m, dd] = iso.split("-").map(Number); return `${dd} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`; };
    const dayName = (iso) => `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(iso + "T00:00:00").getDay()]} ${dayMon(iso)}`;
    const who = (label) => p.locator('.ov-people-bar [aria-label="Who"] .btn', { hasText: label }).click();
    const chart = (label) => p.locator(".ov-spread .ov-pview .btn", { hasText: label }).click();
    const bandCounts = () => p.evaluate(() => [...document.querySelectorAll(".ov-band")].map((b) => b.querySelector(".ov-band-n").textContent));
    const heads = () => read(".ov-spread .ov-hchart-head b");

    await step("A0: the range control sits in the Period heading; the sections follow in order; the old lists are gone", async () => {
      assert.equal(await p.locator(".ov-period .ov-history-controls").count(), 1, "the range control is in the Period heading");
      assert.equal(await p.locator(".ov-section .ov-history-controls").count(), 0, "and not inside History");
      assert.match((await read(".ov-period .ov-period-note"))[0], /apply to History, People and Engineer workload/);
      const order = await p.evaluate(() => [...document.querySelectorAll("#overview-panel > .ov-period, #overview-panel > .ov-section")]
        .map((el) => (el.classList.contains("ov-period") ? "Period" : el.querySelector("h3").textContent.trim())).slice(-5));
      assert.deepEqual(order, ["History", "People", "Engineer workload", "Workforce", "Boards & areas"]);
      for (const gone of ["Workload alerts"]) assert.equal(await p.locator("h3", { hasText: gone }).count(), 0, gone + " is gone");
      assert.equal(await p.locator(".ov-wl, .ov-alert-grid, .ov-hnames").count(), 0, "no per-person lists outside People");
    });

    await step("A0: the Engineer workload tiles say how they moved against the previous period", async () => {
      const tiles = await p.evaluate(() => [...document.querySelectorAll(".ov-eng-tiles .ov-htile")].map((t) => [t.querySelector(".ov-htile-label").textContent, t.querySelector(".ov-htile-delta") && t.querySelector(".ov-htile-delta").textContent]));
      assert.equal(tiles.length, 6);
      assert.ok(tiles.every(([, delta]) => delta && /previous period/.test(delta)), JSON.stringify(tiles));
      assert.equal(Object.fromEntries(tiles)["Missions"], "▲ 0.2 vs previous period", "Eng One: 6 missions over 5 days against 5");
      assert.equal(Object.fromEntries(tiles)["Active days"], "= previous period", "5 active days both weeks");
    });

    await step("A1: the chips sit above the chart; the Workload spread: median, 90% or more, under 50%; the one Who switch", async () => {
      assert.equal(await p.evaluate(() => { const bar = document.querySelector("#ov-people .ov-people-bar"), ch = document.querySelector("#ov-people .ov-spread"); return !!(bar.compareDocumentPosition(ch) & Node.DOCUMENT_POSITION_FOLLOWING); }), true, "the chips come before the chart");
      assert.deepEqual(await read(".ov-people-bar [aria-label='Who'] .btn"), ["Everyone", "Permanent", "On-call"], "one Who switch, and the chart has none of its own");
      assert.equal(await p.locator(".ov-spread .ov-trend-btns:not(.ov-pview)").count(), 0);
      assert.deepEqual(await heads(), ["Workload spread"]);
      assert.deepEqual(await read(".ov-spread .ov-pview .btn"), ["Spread", "Over time"], "Workload has a Spread and an Over time view");
      assert.deepEqual(await read(".ov-spread-sum"), ["Median 70.0% · 4 at 90% or more · 4 under 50%"], "everyone: A B C G 100%, E F 80%, D 60%, H 50%, L 20%, K M N 0%");
      assert.deepEqual(await bandCounts(), ["3", "", "1", "", "", "1", "1", "", "2", "4"]);
      assert.equal(await p.locator(".ov-band-median").getAttribute("data-band"), "7", "the median (70%) sits in the 70s band");
      await who("Permanent");
      assert.deepEqual(await read(".ov-spread-sum"), ["Median 80.0% · 3 at 90% or more · 3 under 50%"], "A B C 100%, E F 80%, D 60%, L 20%, M N 0%");
      assert.deepEqual(await bandCounts(), ["2", "", "1", "", "", "", "1", "", "2", "3"]);
      assert.equal(await p.locator(".ov-band-median").getAttribute("data-band"), "8", "the median sits in the 80s band");
      await who("On-call");
      assert.deepEqual(await read(".ov-spread-sum"), ["Median 50.0% · 1 at 90% or more · 1 under 50%"], "G 100%, H 50%, K 0%");
      await who("Everyone");
    });

    await step("A1: a band click filters the table; clicking it again clears it; the Who switch clears it", async () => {
      await who("Permanent");
      await p.locator(".ov-band[data-band='8']").click();
      assert.deepEqual((await rowsOf(".ov-people-table")).map((r) => r[0]), ["Person E", "Person F"], "80-89%");
      assert.deepEqual(await read(".ov-band-chip span"), ["Share worked 80–89%"]);
      assert.equal(await p.locator(".ov-band[data-band='8']").getAttribute("aria-pressed"), "true");
      await p.locator(".ov-band-chip .ov-linkbtn").click();
      assert.equal((await rowsOf(".ov-people-table")).length, 9, "the Who (Permanent) stays picked: nine permanent people");
      await who("Everyone");
      assert.equal((await rowsOf(".ov-people-table")).length, 10, "everyone again: ten rows and Show all");
      await p.locator(".ov-wl-more").click();
      assert.equal((await rowsOf(".ov-people-table")).length, 12);
      await p.locator(".ov-band[data-band='2']").click();
      assert.deepEqual((await rowsOf(".ov-people-table")).map((r) => r[0]), ["Person L"]);
      await p.locator(".ov-band[data-band='2']").click();
      assert.equal(await p.locator(".ov-band-chip").count(), 0);
      await p.locator(".ov-band[data-band='2']").click();
      await who("Permanent");
      assert.equal(await p.locator(".ov-band-chip").count(), 0, "changing Who clears the pick");
      await who("Everyone");
    });

    await step("A1: Workload view: working days, worked, share worked, nights, days in a row", async () => {
      await p.locator(".ov-people-bar .btn", { hasText: "Everyone" }).click();
      await p.locator(".ov-wl-more").click();
      const rows = (await rowsOf(".ov-people-table")).map((r) => r.slice(0, 6));
      assert.deepEqual(rows, [
        ["Person A", "5", "5", "100.0%", "0", "14 still going"],
        ["Person B", "5", "5", "100.0%", "0", "5"],
        ["Person C", "5", "5", "100.0%", "5", "5"],
        ["Person G OC", "5", "5", "100.0%", "0", "5"],
        ["Person E", "5", "4", "80.0%", "0", "4"],
        ["Person F", "5", "4", "80.0%", "0", "3"],
        ["Person D", "5", "3", "60.0%", "0", "3"],
        ["Person H OC", "4", "2", "50.0%", "1", "2"],
        ["Person L", "5", "1", "20.0%", "0", "1"],
        ["Person K OC", "5", "0", "0.0%", "0", "—"],
        ["Person M", "5", "0", "0.0%", "0", "—"],
        ["Person N", "5", "0", "0.0%", "0", "—"]], "most worked first; ties by name");
    });

    await step("A1: Leave view keeps the old columns, Exchange days off the working days", async () => {
      await view("Leave");
      const rows = (await rowsOf(".ov-people-table")).map((r) => r.slice(0, 7));
      assert.deepEqual(rows.slice(0, 3), [
        ["Person D", "5", "3", "2", "3 : 2 (1.5 : 1)", "40.0%", "—"],
        ["Person E", "5", "4", "1", "4 : 1 (4.0 : 1)", "20.0%", "1"],
        ["Person F", "5", "4", "1", "4 : 1 (4.0 : 1)", "20.0%", "—"]]);
      assert.equal(rows.length, 3, "only the people who took leave; the 0% rows are a count, not rows");
      assert.deepEqual(await read(".ov-spread-sum"), [`4 leave days · 3 people took leave · busiest ${dayName(d[0])} (2)`], "the line that sat above the table is the chart's headline now");
      assert.equal(await p.locator(".ov-leave-sum, .ov-people-sum").count(), 0, "no summary line between the chips and the table any more");
      assert.equal(rows.some((r) => /Person [IJ]\b/.test(r[0])), false, "Board Two was not planned: its people are left out");
    });

    await step("A1: every flag shows: days in a row, mostly nights, leave above 30%, never called in, newcomer-only mission", async () => {
      await view("Alerts only");
      const flags = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".ov-people-table tbody tr")].map((tr) => [tr.cells[0].textContent.replace(/\s+/g, " ").trim(), [...tr.querySelectorAll(".ov-flag")].map((f) => f.textContent.trim())])));
      assert.deepEqual(flags, {
        "Person A": ["14 in a row · still going"], "Person C": ["mostly nights"], "Person D": ["leave > 30%"],
        "Person K OC": ["never called in"], "Person L": ["newcomer-only mission"],
      });
      assert.equal(await p.locator(".ov-people-table .ov-flag-bad").count(), 2, "10+ in a row and leave above 30% are red");
      assert.match(await p.locator(".ov-flag", { hasText: "in a row" }).getAttribute("title"), new RegExp(`${dayMon(pw[0])} → still going`));
      assert.equal(await p.locator("h3", { hasText: "Workload alerts" }).count(), 0);
    });

    await step("A1: On-call view: a person with 0 call-ins shows with 0; on-call people only, with no Who switch", async () => {
      await view("On-call");
      // least called in first: Share called in, lowest first
      const rows = (await rowsOf(".ov-people-table")).map((r) => [r[0], r[3]]);
      assert.deepEqual(rows, [["Person K OC", "0"], ["Person H OC", "2"], ["Person G OC", "5"]]);
      const shares = (await rowsOf(".ov-people-table")).map((r) => parseInt(r[4], 10));
      assert.deepEqual(shares, shares.slice().sort((a, b) => a - b), "Share called in goes up the table");
      assert.equal(await p.locator('.ov-people-table .ov-sort[data-k="cshare"]').getAttribute("aria-sort"), "ascending", "the column says it is the sort");
      assert.equal(await p.locator(".ov-people-bar [aria-label='Who']").count(), 0, "the Who switch is hidden");
      assert.deepEqual(await read(".ov-people-bar .ov-locked"), ["On-call people only"]);
      assert.deepEqual(await heads(), ["Call-in spread"], "the Call-in spread, not the Workload spread");
      assert.deepEqual(await read(".ov-spread-sum"), ["Median 50.0% called in · 1 never called in · 0–5 days called in"], "K 0%, H 2 of 4 available days, G 5 of 5");
      assert.deepEqual(await bandCounts(), ["1", "", "", "", "", "", "1", "", "", "", "1"], "never, 50% and 100% of the available days");
      assert.equal(await p.locator(".ov-band[data-band='0']").evaluate((b) => b.classList.contains("ov-band-bad")), true, "Never is its own red band");
      assert.equal(await p.locator(".ov-band-median").getAttribute("data-band"), "6", "the median (50%) sits in the 50s band");
      await p.locator(".ov-band[data-band='0']").click();
      assert.deepEqual((await rowsOf(".ov-people-table")).map((r) => r[0]), ["Person K OC"], "Never called in");
      assert.deepEqual(await read(".ov-band-chip span"), ["Never called in"]);
      await p.locator(".ov-band-chip .ov-linkbtn").click();
      // back on Workload the Who switch is back, and with Everyone the permanent people (no share, "—") come after every on-call person
      await view("Workload");
      await who("Everyone");
      await view("On-call");
      assert.equal(await p.locator(".ov-people-table tbody tr").count(), 3, "On-call is on-call people whatever the Who was");
    });

    await step("A1: Nights view: the nights add up to the sum of nightEmp, and who shares them", async () => {
      await view("Nights");
      const total = (await rowsOf(".ov-people-table")).reduce((a, r) => a + Number(r[2]), 0);
      const sumNight = await p.evaluate(() => {
        const ov = state.overview, boards = ovScopeBoards();
        return historyDates(boards).reduce((a, dt) => { const r = historyDayRec(dt, boards, ov.history); return a + (r ? Object.keys(r.nightEmp).length : 0); }, 0);
      });
      assert.equal(total, sumNight, "the table's nights = sum of nightEmp over the range");
      assert.equal(total, 6, "C five nights, H one");
      assert.deepEqual(await read(".ov-spread-sum"), ["2 people share the 6 nights · the top 3 worked 100% of them · 10 worked none"], "the line that sat above the table is the chart's headline now");
      assert.deepEqual(await heads(), ["Nights spread"]);
      assert.deepEqual(await bandCounts(), ["1", "", "1", "", ""], "H one night, C five");
      assert.deepEqual((await rowsOf(".ov-people-table")).slice(0, 2).map((r) => [r[0], r[2], r[3]]), [["Person C", "5", "100%"], ["Person H OC", "1", "50%"]]);
      await view("Workload");
    });

    await step("B: Leave chart: people on leave per day by type; a day filters the table; Calendar; Spread", async () => {
      await view("Leave");
      assert.deepEqual(await heads(), ["People on leave, per day"], "Leave opens on Over time");
      assert.deepEqual(await read(".ov-spread .ov-pview .btn"), ["Over time", "Calendar", "Spread"]);
      assert.equal(await p.locator(".ov-spread .ov-pview .btn.active").textContent(), "Over time");
      assert.equal(await p.locator(".ov-spread .chart-column-chart rect.chart-mark").count(), 4, "Mon: annual + sick, Tue: annual + business");
      assert.deepEqual(await read(".ov-spread .ov-legend span"), ["Annual Leave", "Sick Leave", "Business Leave", "Unpaid Leave"]);
      // a day filters the table; the same day again clears it
      await p.locator(`.ov-spread rect.chart-mark[tabindex][data-date='${d[1]}']`).first().click();
      assert.deepEqual((await rowsOf(".ov-people-table")).map((r) => r[0]), ["Person D", "Person F"], "on leave on Tuesday");
      assert.deepEqual(await read(".ov-band-chip span"), [`On leave on ${dayName(d[1])}`]);
      assert.equal(await p.locator(".ov-band-chip .ov-linkbtn").count(), 1, "Clear is the one link button: the board link is not one (Present keeps it off a slide)");
      assert.equal(await p.locator(".ov-band-chip .ov-open-day").count(), 1, "Open that day's board");
      assert.equal(await p.locator(`.ov-spread rect.chart-hit.is-picked[data-date='${d[1]}']`).count(), 1, "the picked day is marked on the chart");
      await p.locator(`.ov-spread rect.chart-mark[tabindex][data-date='${d[1]}']`).first().click();
      assert.equal(await p.locator(".ov-band-chip").count(), 0, "the same day again clears it");
      await p.locator(`.ov-spread rect.chart-hit[data-date='${d[2]}']`).click();
      assert.equal(await p.locator(".ov-people-table").count(), 0, "nobody was on leave on Wednesday");
      assert.deepEqual(await read(".ov-empty"), ["Nobody matches."]);
      await p.locator(".ov-band-chip .ov-linkbtn").click();
      // the Calendar: History's own, for the people in scope
      await chart("Calendar");
      assert.deepEqual(await heads(), ["People on leave, by day"]);
      assert.deepEqual(await read(".ov-spread .ov-cal-cell[data-date] .ov-cal-n"), ["2", "2", "0", "0", "0"], "a cell per plotted day");
      assert.equal(await p.locator(".ov-spread .ov-cal-oc").count(), 0, "no on-call line: that is History's");
      await p.locator(`.ov-spread .ov-cal-cell[data-date='${d[0]}']`).click();
      assert.deepEqual((await rowsOf(".ov-people-table")).map((r) => r[0]), ["Person D", "Person E"]);
      assert.deepEqual(await read(".ov-band-chip span"), [`On leave on ${dayName(d[0])}`]);
      assert.equal(await p.locator(`.ov-spread .ov-cal-cell[data-date='${d[0]}']`).getAttribute("aria-pressed"), "true");
      // Spread: the people who took leave, by their share of the working days (amber above 20%, red above 30%)
      await chart("Spread");
      assert.equal(await p.locator(".ov-band-chip").count(), 0, "a new chart starts with no pick");
      assert.deepEqual(await heads(), ["Leave spread"]);
      assert.deepEqual(await read(".ov-spread-sum"), ["9 took no leave · 3 took leave · 1 above 20% · 1 above 30%"], "D 40%, E and F 20%");
      assert.deepEqual(await bandCounts(), ["", "2", "", "1", ""]);
      assert.equal(await p.locator(".ov-band[data-band='3']").evaluate((b) => b.classList.contains("ov-band-bad")), true, "30–50% is red");
      assert.equal(await p.locator(".ov-band[data-band='2']").evaluate((b) => b.classList.contains("ov-band-warn")), true, "20–30% is amber");
      await p.locator(".ov-band[data-band='1']").click();
      assert.deepEqual((await rowsOf(".ov-people-table")).map((r) => r[0]), ["Person E", "Person F"]);
      assert.deepEqual(await read(".ov-band-chip span"), ["Leave share 10–20%"]);
      await view("Workload");
    });

    await step("B: Workload, Nights and On-call over time: a column per day, a day filters the table", async () => {
      await view("Workload");
      await chart("Over time");
      assert.deepEqual(await heads(), ["People on a mission, per day"]);
      assert.deepEqual(await read(".ov-spread-sum"), ["6.8 of 11.8 people on a mission each day"], "5 6 8 8 7 of 11 12 12 12 12 (H's Exchange Working Day is not on the roster)");
      await p.locator(`.ov-spread rect.chart-mark[tabindex][data-date='${d[3]}']`).first().click();
      const thu = (await rowsOf(".ov-people-table")).map((r) => r[0].replace(" OC", ""));
      assert.equal(thu.length, 8, "A B C G D E F and L were on a mission on Thursday");
      assert.ok(thu.includes("Person L") && !thu.includes("Person H") && !thu.includes("Person K"));
      assert.deepEqual(await read(".ov-band-chip span"), [`On a mission on ${dayName(d[3])}`]);
      await view("Nights");
      await chart("Over time");
      assert.deepEqual(await heads(), ["People on nights, per day"]);
      assert.deepEqual(await read(".ov-spread-sum"), [`1.2 people on nights a day · busiest ${dayName(d[2])} (2)`], "C every night, H on Wednesday");
      await p.locator(`.ov-spread rect.chart-mark[tabindex][data-date='${d[2]}']`).first().click();
      assert.deepEqual((await rowsOf(".ov-people-table")).map((r) => r[0]), ["Person C", "Person H OC"]);
      await chart("Spread");
      await p.locator(".ov-band[data-band='2']").click();
      assert.deepEqual((await rowsOf(".ov-people-table")).map((r) => r[0]), ["Person C"], "5 to 6 nights");
      assert.deepEqual(await read(".ov-band-chip span"), ["5–6 nights"]);
      await view("On-call");
      await chart("Over time");
      assert.deepEqual(await heads(), ["On-call called in, per day"]);
      assert.deepEqual(await read(".ov-spread-sum"), ["Called in on 50% of the available on-call days · 21% of the people on missions"], "7 of 14 available on-call days; 7 of 34 person-days");
      assert.equal(await p.locator(".ov-people-bar [aria-label='Who']").count(), 0, "still on-call people only");
      await p.locator(`.ov-spread rect.chart-mark[tabindex][data-date='${d[1]}']`).first().click();
      assert.deepEqual((await rowsOf(".ov-people-table")).map((r) => r[0]), ["Person H OC", "Person G OC"], "called in on Tuesday, the least called in first");
      await view("Workload");
    });

    await step("B: Alerts chart: one bar per flag, split amber and red; a flag filters the table; Over time", async () => {
      await view("Alerts only");
      assert.deepEqual(await heads(), ["Alerts by flag"]);
      assert.deepEqual(await read(".ov-spread .ov-pview .btn"), ["By flag", "Over time"]);
      assert.deepEqual(await read(".ov-flagrow > b"), ["7+ days in a row", "Mostly nights", "Leave above 30%", "Never called in", "Newcomer-only mission"]);
      assert.deepEqual(await read(".ov-flagn b"), ["1", "1", "1", "1", "1"]);
      assert.deepEqual(await read(".ov-flagn small"), ["red", "amber", "red", "amber", "amber"], "14 in a row and leave above 30% are red; the count is beside the bar, the split shows only when a flag is both");
      assert.deepEqual(await read(".ov-spread-sum"), ["5 with a flag · 0 with two or more"]);
      const mixed = await p.evaluate(() => {
        const mk = (level) => ({ flags: [{ key: "run", level }] });
        const node = pplFlagsNode({ scope: [mk("warn"), mk("warn"), mk("bad")], pick: null });
        return [...node.querySelectorAll(".ov-flagrow")].slice(0, 2).map((r) => r.querySelector(".ov-flagn").textContent.replace(/\s+/g, " ").trim());
      });
      assert.deepEqual(mixed, ["3 2 amber · 1 red", "0 none"], "a flag that is both shows its split; a flag nobody has says none");
      await p.locator(".ov-flagrow", { hasText: "Mostly nights" }).click();
      assert.deepEqual((await rowsOf(".ov-people-table")).map((r) => r[0]), ["Person C"]);
      assert.deepEqual(await read(".ov-band-chip span"), ["Mostly nights"]);
      assert.equal(await p.locator(".ov-flagrow", { hasText: "Mostly nights" }).getAttribute("aria-pressed"), "true");
      await p.locator(".ov-flagrow", { hasText: "Mostly nights" }).click();
      assert.equal(await p.locator(".ov-band-chip").count(), 0);
      await chart("Over time");
      assert.deepEqual(await heads(), ["People on a long run, per day"]);
      assert.deepEqual(await read(".ov-spread-sum"), [`Up to 1 on a long run · busiest ${dayName(d[0])}`], "A has worked 14 days in a row, from the week before");
      await p.locator(`.ov-spread rect.chart-mark[tabindex][data-date='${d[2]}']`).first().click();
      assert.deepEqual((await rowsOf(".ov-people-table")).map((r) => r[0]), ["Person A"]);
      await view("Workload");
    });

    await step("A1: sortable, ten rows until Show all", async () => {
      await p.evaluate(() => { state.overview.pplAll = false; return render(); });
      assert.equal((await rowsOf(".ov-people-table")).length, 10);
      await p.locator(".ov-people-table .ov-sort", { hasText: "Name" }).click();
      assert.deepEqual((await rowsOf(".ov-people-table")).map((r) => r[0]).slice(0, 2), ["Person A", "Person B"]);
      await p.locator(".ov-wl-more").click();
      assert.equal((await rowsOf(".ov-people-table")).length, 12, "Show all lists everyone");
      await p.locator(".ov-wl-more").click();
      assert.equal((await rowsOf(".ov-people-table")).length, 10, "and Show fewer goes back to ten");
    });

    await step("A0 + A1: Manpower and People agree on worked, leave and working days for the same person and range", async () => {
      const from = h.addDays(today, -89);
      await showOverview(from, today);
      await p.locator(".ov-people-bar .btn", { hasText: "Workload" }).click();
      await p.locator(".ov-wl-more").click();
      const people = Object.fromEntries((await rowsOf(".ov-people-table")).map((r) => [r[0].replace(" OC", ""), { working: Number(r[1]), worked: Number(r[2]), leave: 0 }]));
      await p.locator(".ov-people-bar .btn", { hasText: "Leave" }).click();   // the Leave view lists only those who took leave
      for (const r of await rowsOf(".ov-people-table")) people[r[0].replace(" OC", "")].leave = Number(r[3]);
      await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      await p.locator("#emplist-period + .seg-pick button", { hasText: "90D" }).click();
      await p.waitForTimeout(500);
      const man = await p.evaluate(() => Object.fromEntries(D().employees.map((e) => [e.name, state.emplist.wl[e.id]])));
      for (const [name, x] of Object.entries(people)) {
        assert.deepEqual({ working: man[name].working, worked: man[name].worked, leave: man[name].leave }, x, name + " reads the same in Manpower and in People");
      }
      assert.equal(man["Person I"].leave, 0, "Board Two was not planned that day: the leave is left out of Manpower too");
      assert.equal(man["Person I"].working, 0);
      assert.ok(Object.keys(people).length >= 9, "the comparison covered everyone planned");
    });

    await step("A2: a name in People opens the profile: header, tiles equal the People row, hosts, loans, notes", async () => {
      await showOverview();
      await p.locator(".ov-person-link", { hasText: "Person A" }).click();
      await p.waitForSelector("#modal-profile:not(.hidden) .ov-prof-tiles");
      const facts = await read("#profile-body .ov-prof-id > div");
      assert.deepEqual(facts.slice(0, 4), ["TRIGO ID —", "Contract Permanent", "Position —", "Service area AREA1"]);
      assert.ok(facts[4].startsWith("Board Board One"), facts[4]);
      assert.equal(await p.locator("#profile-title").textContent(), "Person A");
      assert.equal(await p.locator("#profile-body .ov-prof-bar .btn.active").textContent(), "History range", "from People: History's range");
      const tiles = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".ov-prof-tiles .ov-htile")].map((t) => [t.querySelector(".ov-htile-label").textContent, [t.querySelector(".ov-htile-value").textContent, t.querySelector(".ov-htile-delta").textContent]])));
      assert.equal(tiles["Worked"][0], "5", "5 worked, as in the People row");
      assert.equal(tiles["Worked"][1], "= previous period", "5 the week before too");
      assert.equal(tiles["Leave"][0], "0");
      assert.equal(tiles["Worked : Leave"][0], "5 : 0");
      assert.equal(tiles["Standby"][0], "0");
      assert.equal(tiles["Nights"][0], "0");
      assert.equal(tiles["Weekend and holiday days"][0], "2", "worked Saturday and Sunday");
      assert.equal(tiles["Longest run"][0], "14");
      assert.match(tiles["Longest run"][1], /previous period/);
      assert.deepEqual(await read(".ov-prof-flags .ov-flag"), ["14 in a row · still going"], "the same flag as in People");
      assert.equal(await p.locator(".ov-prof-chart .chart-column-chart rect.chart-mark").count() > 0, true, "the 12-month chart is drawn");
      assert.equal(await p.locator(".ov-prof-chart .chart-column-chart polyline").count(), 1, "against the average of their contract type");
      assert.deepEqual(await rowsOf(".ov-prof-hosts").then((r) => r.map((x) => x.slice(0, 2).concat(x[3]))), [["Host Alpha", "6", "experienced"], ["Host Beta", "2", ""]], "experienced from 5 days");
      assert.ok((await read(".ov-prof-note"))[0].startsWith("Prefers day shifts eng.a@example.com"), "the note, read-only");
    });

    await step("A2: the profile matches the People row for every person; the loan shows; the period switch refetches nothing it has", async () => {
      await p.evaluate(() => closeModal());
      const people = (await rowsOf(".ov-people-table")).map((r) => ({ name: r[0].replace(" OC", ""), working: Number(r[1]), worked: Number(r[2]) }));
      for (const x of people) {
        await p.evaluate((name) => openProfile(D().employees.find((e) => e.name === name).id, "range"), x.name);
        await p.waitForSelector("#modal-profile:not(.hidden) .ov-prof-tiles");
        const t = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".ov-prof-tiles .ov-htile")].map((tl) => [tl.querySelector(".ov-htile-label").textContent, tl.querySelector(".ov-htile-value").textContent])));
        assert.equal(Number(t["Worked"]), x.worked, x.name + " worked");
        assert.ok(String(await p.locator(".ov-prof-bar .ov-muted").textContent()).includes(`${x.working} working days`), x.name + " working days");
        await p.evaluate(() => closeModal());
      }
      await p.evaluate(() => openProfile(D().employees.find((e) => e.name === "Person K").id, "range"));
      await p.waitForSelector("#modal-profile:not(.hidden) .ov-prof-tiles");
      const loanRows = await read("#profile-body .ov-prof-block tbody tr");
      assert.equal(loanRows.filter((x) => /Board One → Board Two/.test(x) && /Training/.test(x)).length, 1, "the loan to Board Two");
      assert.deepEqual(await read(".ov-prof-flags .ov-flag"), ["never called in"]);
      assert.equal((await read(".ov-prof-tiles .ov-htile-label")).includes("Not called in"), true, "on-call: not called in, not standby");
      await p.evaluate(() => closeModal());
    });

    await step("A2: 30D / 90D / YTD / History range; 30D equals Manpower's 30D", async () => {
      await p.evaluate(() => openProfile(D().employees.find((e) => e.name === "Person A").id, "range"));
      await p.waitForSelector("#modal-profile:not(.hidden) .ov-prof-tiles");
      assert.deepEqual(await read(".ov-prof-bar .btn"), ["30D", "90D", "YTD", "History range"]);
      await p.locator(".ov-prof-bar .btn", { hasText: "30D" }).click();
      await p.waitForFunction(() => document.querySelector(".ov-prof-bar .btn.active").textContent === "30D");
      const worked30 = Number(await p.locator(".ov-prof-tiles .ov-htile", { hasText: "Worked" }).first().locator(".ov-htile-value").textContent());
      await p.evaluate(() => closeModal());
      await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; state.emplist.period = "30"; state.emplist.utilCacheKey = null; return refreshAndRender(); });
      await p.waitForTimeout(400);
      const man = await p.evaluate(() => state.emplist.wl[D().employees.find((e) => e.name === "Person A").id].worked);
      assert.equal(worked30, man, "30D in the profile = 30D in Manpower");
    });

    await step("A2: the Manpower List's menu has Profile; it opens on the list's period", async () => {
      await p.evaluate(() => { state.emplist.search = ""; return refreshAndRender(); });
      // a real right-click scrolls the row into view first, and a scroll closes the menu: send the event itself
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(400);   // the page change leaves a late scroll event, which would close the menu
      await p.evaluate(() => {
        const tr = [...document.querySelectorAll("#emplist-body tr")].find((r) => r.textContent.includes("Person C"));
        const r = tr.getBoundingClientRect();
        tr.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 10 }));
      });
      await p.locator("#context-menu .ctx-item", { hasText: "Profile" }).click();
      await p.waitForSelector("#modal-profile:not(.hidden) .ov-prof-tiles");
      assert.equal(await p.locator("#profile-title").textContent(), "Person C");
      assert.equal(await p.locator(".ov-prof-bar .btn.active").textContent(), "30D");
      await p.locator("#modal-profile .modal-close").click();
      assert.equal(await p.locator("#modal-profile:not(.hidden)").count(), 0);
    });

    await step("A2: a role without Overview History opens the profile but sees no figures, in the page or the data", async () => {
      for (const r of db.t("role_permissions")) if (r.role_key === "viewer" && r.area === "ov.history") r.level = "none";
      const v = await env.openAs(db, h.USERS.v);
      await v.page.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      await v.page.waitForTimeout(300);
      await v.page.evaluate(() => openProfile(D().employees.find((e) => e.name === "Person A").id, "30"));
      await v.page.waitForSelector("#modal-profile:not(.hidden) .ov-prof-id");
      assert.equal(await v.page.locator(".ov-prof-tiles, .ov-prof-chart, .ov-prof-flags").count(), 0, "no per-person figures");
      assert.equal(await v.page.evaluate(() => state.profile.cache), null, "and nothing fetched for them");
      assert.equal(await v.page.locator("#profile-body .ov-prof-hosts").count(), 1, "the hosts are roster data and still show");
      assert.equal(await v.page.locator(".ov-prof-note").count(), 0, "notes are for roles that can edit the roster");
      assert.deepEqual(v.errors, []);
    });

    await step("in Thai the Period heading, People, the profile read in Thai", async () => {
      await showOverview();
      await p.evaluate(() => I18N.setLang("th"));
      await p.waitForTimeout(250);
      const english = (xs) => xs.filter((x) => /[A-Za-z]{3}/.test(x.replace(/\bOC\b|Person [A-N]|Board (One|Two)|Eng (One|Two)|Host (Alpha|Beta|Gamma)|AREA1|TRIGO ID|eng\.a@example\.com|Prefers day shifts/g, "")));
      assert.deepEqual(english(await read(".ov-period, #ov-people")), [], "Period and People in Thai");
      // titles and aria-labels are translated in place; a chart tooltip is translated when it is shown (read below)
      const labels = () => p.evaluate(() => [...document.querySelectorAll("#ov-people [title], #ov-people [aria-label]")]
        .flatMap((el) => ["title", "aria-label"].map((a) => el.getAttribute(a)).filter(Boolean)));
      const hoverTip = async (sel) => { await p.locator(sel).first().hover(); await p.waitForTimeout(120); return (await p.locator("#chart-tip").innerText()).replace(/\s+/g, " "); };
      // every view and every chart it offers, with a pick on it, reads in Thai: text, titles, labels and tooltips
      for (const label of ["Workload", "Leave", "Nights", "On-call", "Alerts only"]) {
        await p.locator(".ov-people-bar .btn").nth(["Workload", "Leave", "Nights", "On-call", "Alerts only"].indexOf(label)).click();
        await p.waitForTimeout(150);
        const n = await p.locator(".ov-spread .ov-pview .btn").count();
        for (let i = 0; i < n; i++) {
          await p.locator(".ov-spread .ov-pview .btn").nth(i).click();
          await p.waitForTimeout(150);
          assert.deepEqual(english(await read("#ov-people")), [], `${label}, chart ${i + 1}, in Thai`);
          assert.deepEqual(english((await labels()).map((x) => x.replace(/\s+/g, " "))), [], `${label}, chart ${i + 1}: titles and labels in Thai`);
          const mark = await p.locator(".ov-spread .ov-band, .ov-spread .ov-flagrow, .ov-spread rect.chart-mark[tabindex], .ov-spread .ov-cal-cell[data-date]").first();
          assert.deepEqual(english([await hoverTip(".ov-spread .ov-band, .ov-spread .ov-flagrow, .ov-spread rect.chart-mark[tabindex], .ov-spread .ov-cal-cell[data-date]")]), [], `${label}, chart ${i + 1}: the tooltip in Thai`);
          await mark.click();
          await p.waitForTimeout(150);
          assert.deepEqual(english(await read("#ov-people .ov-band-chip, #ov-people .ov-empty")), [], `${label}, chart ${i + 1}: the pick's chip in Thai`);
          await p.locator("#ov-people .ov-band-chip .ov-linkbtn").first().click().catch(() => {});
        }
      }
      assert.deepEqual(english(await read(".ov-eng-tiles")), [], "engineer tiles in Thai");
      await p.locator(".ov-people-bar .btn").nth(0).click();
      await p.waitForTimeout(150);
      await p.locator(".ov-band[data-band='8']").hover();
      await p.waitForTimeout(120);
      assert.deepEqual(english([(await p.locator("#chart-tip").innerText()).replace(/\s+/g, " ")]), [], "the spread chart's tooltip in Thai");
      await p.evaluate(() => openProfile(D().employees.find((e) => e.name === "Person A").id, "range"));
      await p.waitForSelector("#modal-profile:not(.hidden) .ov-prof-tiles");
      await p.waitForTimeout(250);
      assert.deepEqual(english(await read("#modal-profile")), [], "the profile in Thai");
      const attrs = await p.evaluate(() => [...document.querySelectorAll("#modal-profile [title], #modal-profile [aria-label], #ov-people [title], #ov-people [aria-label]")]
        .flatMap((el) => ["title", "aria-label"].map((a) => el.getAttribute(a)).filter(Boolean)));
      assert.deepEqual(english(attrs.map((x) => x.replace(/\s+/g, " "))), [], "titles and labels in Thai");
      // chart tooltips are drawn from data-tip-* when pointed at: read what is shown
      const tip = async (sel) => { await p.locator(sel).first().hover(); await p.waitForTimeout(120); return (await p.locator("#chart-tip").innerText()).replace(/\s+/g, " "); };
      assert.deepEqual(english([await tip("#modal-profile .ov-prof-chart rect.chart-mark"), await tip("#modal-profile .ov-prof-tiles .ov-share")]), [], "the profile chart's tooltip in Thai");
      await p.evaluate(() => { closeModal(); I18N.setLang("en"); });
    });

    await step("on a phone (400 px): People and the profile fit, the profile opens full screen", async () => {
      await p.setViewportSize({ width: 400, height: 800 });
      await showOverview();
      await p.waitForTimeout(300);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, "no sideways page scroll, over by " + over);
      for (const label of ["Workload", "Leave", "Nights", "On-call", "Alerts only"]) {
        await p.locator(".ov-people-bar .btn").nth(["Workload", "Leave", "Nights", "On-call", "Alerts only"].indexOf(label)).click();
        const n = await p.locator(".ov-spread .ov-pview .btn").count();
        for (let i = 0; i < n; i++) {
          await p.locator(".ov-spread .ov-pview .btn").nth(i).click();
          await p.waitForTimeout(120);
          const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          assert.ok(o <= 0, `${label}, chart ${i + 1}: no sideways page scroll at 400 px, over by ${o}`);
        }
      }
      await p.locator(".ov-people-bar .btn").nth(0).click();
      await p.evaluate(() => openProfile(D().employees.find((e) => e.name === "Person A").id, "range"));
      await p.waitForSelector("#modal-profile:not(.hidden) .ov-prof-tiles");
      await p.waitForTimeout(300);
      const box = await p.evaluate(() => { const r = document.querySelector("#modal-profile").getBoundingClientRect(); const b = document.querySelector("#profile-body"); return [Math.round(r.width), Math.round(r.height), b.scrollWidth - b.clientWidth]; });
      assert.deepEqual(box.slice(0, 2), [400, 800], "full screen");
      assert.ok(box[2] <= 0, "no sideways scroll inside the profile");
      await p.evaluate(() => closeModal());
    });

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all overview-people checks passed");
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
    if (failed) process.exit(1);
  }
})();
