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
      state.overview.pplView = "workload"; state.overview.pplWho = "all"; state.overview.pplBand = null; state.overview.pplSort = null; state.overview.pplAll = true;
      await refreshAndRender();
    }, [d[6], OVERVIEW, from || d[0], to || d[6]]);
    await showOverview();
    const read = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, " ").trim()), sel);
    const rowsOf = (sel) => p.evaluate((s) => [...document.querySelectorAll(s + " tbody tr")].map((tr) => [...tr.cells].map((c) => c.textContent.replace(/\s+/g, " ").trim())), sel);
    const view = (label) => p.locator(".ov-people-bar .btn", { hasText: label }).first().click();
    const dayMon = (iso) => { const [, m, dd] = iso.split("-").map(Number); return `${dd} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`; };

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

    await step("A1: the spread chart: median, 90% or more, under 50%; the group switch", async () => {
      assert.deepEqual(await read(".ov-spread-sum"), ["Median 80.0% · 3 at 90% or more · 3 under 50%"], "A B C 100%, E F 80%, D 60%, L 20%, M N 0%");
      const bands = await p.evaluate(() => [...document.querySelectorAll(".ov-band")].map((b) => b.querySelector(".ov-band-n").textContent));
      assert.deepEqual(bands, ["2", "", "1", "", "", "", "1", "", "2", "3"]);
      assert.equal(await p.locator(".ov-band-median").getAttribute("data-band"), "8", "the median sits in the 80s band");
      await p.locator(".ov-spread .btn", { hasText: "On-call" }).click();
      assert.deepEqual(await read(".ov-spread-sum"), ["Median 50.0% · 1 at 90% or more · 1 under 50%"], "G 100%, H 50%, K 0%");
      await p.locator(".ov-spread .btn", { hasText: "Permanent" }).click();
    });

    await step("A1: a band click filters the table; clicking it again clears it", async () => {
      await p.locator(".ov-band[data-band='8']").click();
      assert.deepEqual((await rowsOf(".ov-people-table")).map((r) => r[0]), ["Person E", "Person F"], "80-89%");
      assert.deepEqual(await read(".ov-band-chip span"), ["Share worked 80–89%"]);
      await p.locator(".ov-band-chip .ov-linkbtn").click();
      assert.equal((await rowsOf(".ov-people-table")).length, 9, "the band's group (Permanent) stays picked: nine permanent people");
      await p.locator(".ov-people-bar .btn", { hasText: "Everyone" }).click();
      assert.equal((await rowsOf(".ov-people-table")).length, 10, "everyone again: ten rows and Show all");
      await p.locator(".ov-wl-more").click();
      assert.equal((await rowsOf(".ov-people-table")).length, 12);
      await p.locator(".ov-band[data-band='2']").click();
      assert.deepEqual((await rowsOf(".ov-people-table")).map((r) => r[0]), ["Person L"]);
      await p.locator(".ov-band[data-band='2']").click();
      assert.equal(await p.locator(".ov-band-chip").count(), 0);
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
      assert.deepEqual(await read(".ov-leave-sum"), ["3 of 12 people had leave in this range · Highest leave share first"]);
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

    await step("A1: On-call view: a person with 0 call-ins shows with 0; median, range and who was never called in", async () => {
      await view("On-call");
      const rows = (await rowsOf(".ov-people-table")).map((r) => [r[0], r[3]]);
      assert.deepEqual(rows, [["Person G OC", "5"], ["Person H OC", "2"], ["Person K OC", "0"]]);
      assert.deepEqual(await read(".ov-people-sum"), ["Days called in: median 2.0 · 0–5 · Never called in (1): Person K"]);
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
      assert.deepEqual(await read(".ov-people-sum"), ["2 people share the 6 nights · the top 3 worked 100% of them"]);
      assert.deepEqual((await rowsOf(".ov-people-table")).slice(0, 2).map((r) => [r[0], r[2], r[3]]), [["Person C", "5", "100%"], ["Person H OC", "1", "50%"]]);
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
      for (const label of ["Leave", "Nights", "On-call", "Alerts only"]) {
        await p.locator(".ov-people-bar .btn").nth(["Workload", "Leave", "Nights", "On-call", "Alerts only"].indexOf(label)).click();
        await p.waitForTimeout(150);
        assert.deepEqual(english(await read("#ov-people")), [], label + " view in Thai");
      }
      assert.deepEqual(english(await read(".ov-eng-tiles")), [], "engineer tiles in Thai");
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
