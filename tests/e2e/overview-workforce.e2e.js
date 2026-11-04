/* Acceptance run for Overview phase 2, batch B (Resigned, Workforce, the skills matrix):
     - B1: Deactivate asks why (Resigned or Inactive for now) from the right-click menu, the Edit
       Employee panel, the bulk bar and the Status switch (cancelling puts the switch back); Resigned
       shows as its own pill, status filter option and tile, and is stored with the leaving date;
       reactivating clears both; a database without the migration works as before, with Resigned
       disabled and a note naming the file;
     - B2: the Workforce section: headcount at each month's end by years of service (the roster rule,
       from the start date), joiners above and resigned leavers under the bar, inactive people as a
       muted line and not as leavers, names on hover, tiles (headcount now, joiners, leavers,
       turnover, share under 1 year), the last 12 months or History's range, the board selector;
     - B3: the Host tab's List | Skills matrix, the one experienced rule (5+ days; at risk when 2 or
       fewer ACTIVE people are experienced) shared with Overview's Host coverage, the person filter,
       the people × hosts Excel file;
     - Thai, and a 400 px phone.
     NODE_PATH=$(npm root -g) node tests/e2e/overview-workforce.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const h = require("./harness");
const ExcelJS = require("../../vendor/exceljs.min.js");

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 60).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const today = h.iso(new Date());
    const src = h.isWeekend(today) ? h.prevWorking(today) : today;
    // the first day of the month `off` months from this one
    const ms = (off) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + off); return h.iso(d); };
    const db = new h.FakeDb();
    h.seedBase(db, { src });
    const emp = (id) => db.t("employees").find((e) => e.id === id);
    // e1 3+ years, e2 1-3 years, e3 joined last month (under 1 year), e4 no start date but added to the app two months ago,
    // e5 resigned last month (3+ years), e6 inactive for now since last month; the rest predate the records
    Object.assign(emp("e1"), { start_date: h.addDays(today, -4 * 365) });
    Object.assign(emp("e2"), { start_date: h.addDays(today, -2 * 365) });
    Object.assign(emp("e3"), { start_date: h.addDays(ms(-1), 2) });
    Object.assign(emp("e4"), { added_on: h.addDays(ms(-2), 5) });
    Object.assign(emp("e5"), { start_date: h.addDays(today, -3 * 365), active: false, deactivated_on: h.addDays(ms(-1), 3), exit_reason: "resigned" });
    Object.assign(emp("e6"), { active: false, deactivated_on: h.addDays(ms(-1), 4) });
    // who worked which host, for how many days (one row per person per day; every date is unique per person)
    const dh = [];
    let off = 30;
    const days = (e, host, n) => { for (let i = 0; i < n; i++) dh.push({ employee_id: e, plan_date: h.addDays(today, -(off++)), mission_number: "9", host, customer: "Cust Alpha", board_id: "b1" }); };
    days("e1", "Host Alpha", 6); days("e2", "Host Alpha", 5); days("e3", "Host Alpha", 5);   // three experienced, all active: covered
    days("e1", "Host Beta", 5); days("e2", "Host Beta", 4);                                  // one experienced
    days("e1", "Host Gamma", 6); days("e5", "Host Gamma", 6); days("e6", "Host Gamma", 6);   // three experienced, one active
    days("e1", "Host Delta", 3);                                                              // none experienced
    db.seed("deployment_history", dh);

    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const OVERVIEW = await p.evaluate(() => OVERVIEW_ID);
    const showOverview = (opts = {}) => p.evaluate(async ([day, ov, o]) => {
      state.date = day; D().activeBoardId = ov; state.filters.engineer = [];
      state.overview.boardIds = o.board ? [o.board] : []; state.overview.wfWindow = o.window || "12";
      state.overview.historyPreset = "custom"; state.overview.historyFrom = o.from; state.overview.historyTo = o.to;
      state.overview.historyCacheKey = null; state.overview.hostCoverageCacheKey = null;
      await refreshAndRender();
    }, [src, OVERVIEW, { from: ms(-2), to: today, ...opts }]);
    await showOverview();
    const read = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, " ").trim()), sel);
    const goHosts = () => p.evaluate(() => { D().activeBoardId = HOSTLIST_ID; return refreshAndRender(); });

    await step("B3: Host coverage uses the shared rule: 5+ days is experienced, 2 or fewer active experienced is at risk", async () => {
      const risk = await read(".ov-host .ov-host-name");
      assert.deepEqual(risk, ["Host Beta", "Host Gamma"], "Alpha has three experienced and active; Delta is not on today's missions");
      assert.deepEqual(await read(".ov-host .ov-tag"), ["at risk", "at risk"]);
      const notes = await read(".ov-host-note");
      assert.ok(notes[0].startsWith("Only one person is experienced here (5+ days)"), notes[0]);
      assert.match((await read(".ov-avail-ok"))[0], /Host Alpha \(3 experienced\) is well covered/);
      assert.deepEqual(await read(".ov-host-all"), ["See all hosts"]);
      const gamma = await read(".ov-host:nth-of-type(2) .ov-person");
      assert.equal(gamma.length, 3, "the experienced people are listed, resigned and inactive ones too");
      assert.ok(gamma.some((x) => /Person F/.test(x) && /no longer active/.test(x)), gamma.join(" / "));
    });

    await step("B3: See all hosts opens the Skills matrix, which agrees with the card on which of today's hosts are at risk", async () => {
      const cardRisk = await read(".ov-host .ov-host-name");
      await p.locator(".ov-host-all").click();
      await p.waitForSelector("#hostlist-matrix-wrap:not(.hidden) .mx-table");
      assert.equal(await p.locator("#hostlist-views .btn.active").textContent(), "Skills matrix");
      const rows = await p.evaluate(() => [...document.querySelectorAll(".mx-row")].map((tr) => [tr.dataset.host, tr.classList.contains("is-risk"), [...tr.cells].map((c) => c.textContent.replace(/\s+/g, " ").trim()).slice(1)]));
      assert.deepEqual(rows.map((r) => r[0]), ["Host Delta", "Host Beta", "Host Gamma", "Host Alpha"], "at risk first, fewest active experienced first");
      assert.deepEqual(rows.filter((r) => r[1]).map((r) => r[0]).sort(), ["Host Beta", "Host Delta", "Host Gamma"]);
      const todays = ["Host Alpha", "Host Beta", "Host Gamma"];
      assert.deepEqual(rows.filter((r) => r[1] && todays.includes(r[0])).map((r) => r[0]).sort(), cardRisk.slice().sort(), "card and matrix agree");
      const by = Object.fromEntries(rows.map((r) => [r[0], r[2]]));
      assert.deepEqual(by["Host Gamma"].slice(0, 2), ["3 · 18 days", "3 · 1 active"], "people (days), experienced");
      assert.deepEqual(by["Host Alpha"].slice(0, 2), ["3 · 16 days", "3"]);
      assert.equal(by["Host Delta"][1], "0");
      assert.match(by["Host Beta"][3], /at risk/);
      assert.equal(by["Host Alpha"][3], "—");
    });

    await step("B3: a row opens its people with days, last date, experienced; inactive and resigned people are greyed and named", async () => {
      await p.locator(".mx-host", { hasText: "Host Gamma" }).click();
      const people = await p.evaluate(() => [...document.querySelectorAll(".mx-detail .mx-people tbody tr")].map((tr) => [tr.cells[0].textContent.replace(/\s+/g, " ").trim(), tr.cells[1].textContent, tr.classList.contains("is-off"), tr.cells[3].textContent.trim()]));
      assert.deepEqual(people, [["Person A", "6", false, "experienced"], ["Person E Resigned", "6", true, "experienced"], ["Person F Inactive", "6", true, "experienced"]]);
      await p.locator(".mx-host", { hasText: "Host Gamma" }).click();
      assert.equal(await p.locator(".mx-detail").count(), 0, "it folds again");
    });

    await step("B3: sorting, and the Person box shows one person's hosts with their own days", async () => {
      await p.locator(".mx-table .ov-sort", { hasText: "People who worked there" }).click();
      assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll(".mx-row")].map((tr) => tr.dataset.host)), ["Host Alpha", "Host Gamma", "Host Beta", "Host Delta"], "most people first (3, 3, 2, 1; ties by name)");
      await p.locator("#hostlist-person").selectOption({ label: "Person B" });
      const rows = await p.evaluate(() => [...document.querySelectorAll(".mx-row")].map((tr) => [tr.dataset.host, tr.cells[5].textContent, tr.cells[6].textContent.trim() ? "date" : ""]));
      assert.deepEqual(rows.map((r) => [r[0], r[1]]).sort(), [["Host Alpha", "5"], ["Host Beta", "4"]], "Person B worked Alpha 5 days and Beta 4");
      assert.equal(await p.evaluate(() => state.hostlist.filters.empId.length), 1, "the Inspector filter of the Filter popover, one filter");
      await p.locator("#hostlist-person").selectOption({ label: "Everyone" });
    });

    await step("B3: the matrix's Excel file is people × hosts days; the List view and its file are unchanged", async () => {
      await p.evaluate(() => openHostlistExportModal());
      assert.match(await p.locator("#hostlist-export-summary").textContent(), /^Skills matrix: the days each person has worked at the 4 hosts/);
      await p.evaluate(() => closeModal());
      const [dl] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => exportHostMatrixXlsx())]);
      await dl.saveAs("/tmp/mx-e2e.xlsx");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(fs.readFileSync("/tmp/mx-e2e.xlsx"));
      const ws = wb.worksheets[0];
      assert.equal(ws.name, "Skills matrix");
      const row = (n) => { const o = []; ws.getRow(n).eachCell({ includeEmpty: true }, (c) => o.push(c.value)); return o; };
      const head = row(1);
      assert.deepEqual(head.slice(0, 3), ["Name", "Status", "Hosts worked"]);
      const hosts = head.slice(3);
      assert.deepEqual(hosts.slice().sort(), ["Host Alpha", "Host Beta", "Host Delta", "Host Gamma"]);
      const find = (name) => { for (let r = 2; r < 20; r++) { const x = row(r); if (x[0] === name) return Object.fromEntries(hosts.map((hh, i) => [hh, x[3 + i]])); } };
      assert.deepEqual(find("Person A"), { "Host Alpha": 6, "Host Beta": 5, "Host Gamma": 6, "Host Delta": 3 });
      const e = (() => { for (let r = 2; r < 20; r++) if (row(r)[0] === "Person E") return row(r); })();
      assert.equal(e[1], "Resigned");
      await p.locator("#hostlist-views .btn", { hasText: "List" }).click();
      assert.equal(await p.locator("#hostlist-matrix-wrap.hidden").count(), 1);
      assert.equal(await p.locator("#hostlist-table tbody tr").count() > 0, true, "the list is back");
      await p.evaluate(() => { localStorage.removeItem("manpower.hostView"); state.hostlist.view = "list"; });
    });

    await step("B2: the Workforce section follows Engineer workload; tiles from a hand count", async () => {
      await showOverview();
      const order = await p.evaluate(() => [...document.querySelectorAll("#overview-panel > .ov-section")].map((s) => s.querySelector("h3").textContent.trim()).slice(-5));
      assert.deepEqual(order, ["History", "People", "Engineer workload", "Workforce", "Boards & areas"]);
      const t = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".ov-wf-tiles .ov-htile")].map((x) => [x.querySelector(".ov-htile-label").textContent, [x.querySelector(".ov-htile-value").textContent, (x.querySelector(".ov-htile-sub") || { textContent: "" }).textContent, (x.querySelector(".ov-htile-delta") || { textContent: "" }).textContent]])));
      // 8 people through the window, 9 at the end of two months ago, 8 since e5 resigned and e6 paused (e3 joined)
      assert.equal(t["Headcount now"][0], "8");
      assert.match(t["Headcount now"][2], /^= since /, "8 at the start of the window too");
      assert.equal(t["Joiners"][0], "2", "e4 added two months ago (no start date), e3 started last month");
      assert.equal(t["Leavers"][0], "1", "only e5 resigned; e6 is inactive for now");
      assert.equal(t["Turnover"][0], "12.4%", "1 leaver ÷ average headcount (97 ÷ 12 months = 8.08)");
      assert.equal(t["Under 1 year"][0], "13%");
      assert.equal(t["Under 1 year"][1], "1 of 8 people");
    });

    await step("B2: bars: joiners above, resigned leavers under, the inactive line, names on hover", async () => {
      const notes = await read(".ov-wf-chart .chart-note");
      assert.deepEqual(notes.slice().sort(), ["+1", "+1", "−1"], "e4 (2 months ago), e3 (last month), e5 left last month");
      const tips = await p.evaluate(() => [...document.querySelectorAll(".ov-wf-chart rect.chart-mark")].map((r) => r.getAttribute("data-tip-label")));
      const lastMonth = tips.find((x) => /joined Person C/.test(x));
      assert.ok(lastMonth, tips.join("\n"));
      assert.match(lastMonth, /8 people/);
      assert.match(lastMonth, /resigned Person E/);
      assert.match(lastMonth, /inactive for now Person F/, "the inactive person is named, apart from the leaver");
      assert.ok(tips.some((x) => /joined Person D/.test(x) && /9 people/.test(x)), "the month before: 9 people");
      assert.equal(await p.locator(".ov-wf-chart polyline").count(), 1, "the muted line for people inactive for now");
      const bands = await p.evaluate(() => [...document.querySelectorAll(".ov-wf-chart rect.chart-mark")].filter((r) => /Under 1 year/.test(r.getAttribute("data-tip-label"))).length);
      assert.equal(bands, 2, "the under-1-year band is drawn in the two months Person C (started last month) is counted");
    });

    await step("B2: History range window, and the board selector", async () => {
      await p.locator(".ov-wf-bar .btn", { hasText: "History range" }).click();
      assert.deepEqual((await read(".ov-wf-tiles .ov-htile-value")).slice(0, 3), ["8", "2", "1"], "range = two months ago to today");
      assert.equal(await p.evaluate(() => document.querySelectorAll(".ov-wf-chart .chart-axis-label").length > 0), true);
      await showOverview({ board: "b2" });
      assert.deepEqual((await read(".ov-wf-tiles .ov-htile-value")).slice(0, 3), ["2", "0", "0"], "Board Two: its two people, no joiners or leavers");
      await showOverview();
    });

    await step("B1: Manpower shows Resigned apart from Inactive: status, filter option, tile, count", async () => {
      await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      await p.waitForTimeout(400);
      const status = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll("#emplist-body tr")].map((tr) => [tr.querySelector("td.el-name").textContent.trim(), tr.querySelector(".el-status .toggle-text").textContent.trim()])));
      const st = await status();
      assert.equal(st["Person E"], "Resigned");
      assert.equal(st["Person F"], "Inactive");
      assert.equal(st["Person A"], "Active");
      assert.deepEqual(await p.evaluate(() => emplistFilterOptions("status").map((o) => o.label)), ["Active", "Inactive", "Resigned"]);
      assert.equal(await p.locator(".stat-tile[data-stat=Resigned] b").textContent(), "1");
      assert.equal(await p.locator(".stat-tile[data-stat=Inactive] b").textContent(), "1");
      assert.match(await p.locator("#emplist-count").textContent(), /1 inactive · 1 resigned/);
      await p.evaluate(() => { state.emplist.filters.status = ["resigned"]; renderEmployeeRows(); });
      assert.deepEqual(Object.keys(await status()), ["Person E"], "the Resigned filter");
      await p.evaluate(() => { state.emplist.filters.status = ["inactive"]; renderEmployeeRows(); });
      assert.deepEqual(Object.keys(await status()), ["Person F"], "Inactive no longer includes the resigned");
      await p.evaluate(() => { state.emplist.filters.status = []; renderEmployeeRows(); });
      assert.deepEqual(await p.evaluate(() => emplistXlsxRows().filter((r) => r.exitReason).map((r) => r.name)), ["Person E"], "the Excel rows carry it");
    });

    const row = (name) => p.locator("#emplist-body tr", { hasText: name }).first();
    const dbRow = (id) => { const e = db.t("employees").find((x) => x.id === id); return [e.active, e.deactivated_on || null, e.exit_reason || null]; };

    await step("B1: the Status switch asks why; Cancel puts the switch back; Resigned stores the reason and the date; switching on clears both", async () => {
      await row("Person H").locator(".toggle-track").click();
      await p.waitForSelector("#modal-deactivate:not(.hidden)");
      assert.equal(await p.locator("#modal-deactivate input[value=inactive]").isChecked(), true, "Inactive for now is the default");
      assert.equal(await p.locator("#deactivate-resigned").isDisabled(), false);
      await p.locator("#btn-deactivate-no").click();
      await p.waitForTimeout(250);
      assert.deepEqual(dbRow("e8"), [true, null, null], "nothing changed");
      assert.equal(await row("Person H").locator(".el-status input").isChecked(), true, "the switch is back on");
      await row("Person H").locator(".toggle-track").click();
      await p.waitForSelector("#modal-deactivate:not(.hidden)");
      await p.locator("#modal-deactivate label", { hasText: "Resigned" }).click();
      await p.locator("#btn-deactivate-yes").click();
      await p.waitForTimeout(400);
      assert.deepEqual(dbRow("e8"), [false, today, "resigned"]);
      assert.equal((await row("Person H").locator(".toggle-text").textContent()).trim(), "Resigned");
      assert.match(await p.locator("#emplist-count").textContent(), /2 resigned/);
      await row("Person H").locator(".toggle-track").click();
      await p.waitForTimeout(400);
      assert.deepEqual(dbRow("e8"), [true, null, null], "reactivating clears the reason and the date");
    });

    await step("B1: the right-click menu, the Edit Employee panel and the bulk bar ask too; a mixed bulk selection keeps the dates people already have", async () => {
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(400);
      await p.evaluate(() => {
        const tr = [...document.querySelectorAll("#emplist-body tr")].find((r) => r.textContent.includes("Person G"));
        const r = tr.getBoundingClientRect();
        tr.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 10 }));
      });
      await p.locator("#context-menu .ctx-item", { hasText: "Deactivate employee" }).click();
      await p.waitForSelector("#modal-deactivate:not(.hidden)");
      await p.locator("#btn-deactivate-yes").click();
      await p.waitForTimeout(400);
      assert.deepEqual(dbRow("e7"), [false, today, null], "Inactive for now: no reason");
      // Edit Employee panel
      await p.evaluate(() => openEmployeeModal("e10"));
      await p.locator("#employee-tabs [data-tab=edit]").click();
      await p.locator("#btn-deactivate-employee").click();
      await p.waitForSelector("#modal-deactivate:not(.hidden)");
      await p.locator("#modal-deactivate label", { hasText: "Resigned" }).click();
      await p.locator("#btn-deactivate-yes").click();
      await p.waitForTimeout(400);
      assert.deepEqual(dbRow("e10"), [false, today, "resigned"]);
      // bulk bar over e2 (active) and e6 (inactive for now since last month): Resigned for both; e6 keeps its date
      const e6date = dbRow("e6")[1];
      await p.evaluate(() => { state.selectedEmps = new Set(["e2", "e6"]); updateEmplistBulkBar(); });
      await p.locator("#emplist-bulk-deactivate").click();
      await p.waitForSelector("#modal-deactivate:not(.hidden)");
      await p.locator("#modal-deactivate label", { hasText: "Resigned" }).click();
      await p.locator("#btn-deactivate-yes").click();
      await p.waitForTimeout(400);
      assert.deepEqual(dbRow("e2"), [false, today, "resigned"]);
      assert.deepEqual(dbRow("e6"), [false, e6date, "resigned"], "already off: only the reason is added");
      // Inactive for now never takes a reason away
      await p.evaluate(() => { state.selectedEmps = new Set(["e6"]); updateEmplistBulkBar(); });
      await p.locator("#emplist-bulk-deactivate").click();
      await p.locator("#btn-deactivate-yes").click();
      await p.waitForTimeout(400);
      assert.deepEqual(dbRow("e6"), [false, e6date, "resigned"]);
    });

    await step("B1: a database without the migration works as before: Resigned disabled with a note, Inactive still saves", async () => {
      const db2 = new h.FakeDb({ exitReason: false });
      h.seedBase(db2, { src });
      const b = await env.openAs(db2, h.USERS.a);
      assert.equal(await b.page.evaluate(() => feat().exitReason), false);
      await b.page.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      await b.page.waitForTimeout(300);
      await b.page.evaluate(() => askDeactivate("Deactivate employee?", "x", () => {}));
      assert.equal(await b.page.locator("#deactivate-resigned").isDisabled(), true);
      assert.match(await b.page.locator("#deactivate-resigned-note").textContent(), /migration-2026-11-04-employee-exit\.sql/);
      await b.page.evaluate(() => closeModal());
      const err = await b.page.evaluate(async () => { try { await cloud.setEmployeesActive(["e7"], false, "resigned"); return ""; } catch (e) { return e.message; } });
      assert.match(err, /migration-2026-11-04-employee-exit\.sql/, "asking for Resigned anyway says what to run");
      await b.page.evaluate(() => cloud.setEmployeesActive(["e7"], false, "inactive"));
      const e7 = db2.t("employees").find((x) => x.id === "e7");
      assert.equal(e7.active, false, "Inactive for now still saves");
      assert.equal(e7.deactivated_on, today, "with its date");
      assert.deepEqual(b.errors, []);
    });

    await step("in Thai Workforce, the matrix, Host coverage, the dialog and Manpower's Resigned read in Thai", async () => {
      await showOverview();
      await p.evaluate(() => I18N.setLang("th"));
      await p.waitForTimeout(300);
      const english = (xs) => xs.filter((x) => /[A-Za-z]{3}/.test(x.replace(/\bOC\b|Person [A-J]|Board (One|Two)|Eng (One|Two)|Host (Alpha|Beta|Gamma|Delta)|AREA1/g, "")));
      assert.deepEqual(english(await read("#ov-workforce")), [], "Workforce in Thai");
      await p.locator(".ov-wf-chart rect.chart-mark").nth(11).hover();
      await p.waitForTimeout(120);
      assert.deepEqual(english([(await p.locator("#chart-tip").innerText()).replace(/\s+/g, " ")]), [], "the bar's tooltip in Thai");
      assert.deepEqual(english(await read(".ov-host, .ov-avail-ok, .ov-host-all")), [], "Host coverage in Thai");
      await p.locator(".ov-host-all").click();
      await p.waitForSelector("#hostlist-matrix-wrap:not(.hidden) .mx-table");
      await p.locator(".mx-host", { hasText: "Host Gamma" }).click();
      await p.waitForTimeout(200);
      assert.deepEqual(english(await read("#hostlist-viewbar, #hostlist-matrix-wrap")), [], "the matrix in Thai");
      await p.evaluate(() => { state.hostlist.mxOpen.clear(); state.hostlist.view = "list"; localStorage.removeItem("manpower.hostView"); D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      await p.waitForTimeout(400);
      assert.ok((await read(".stat-tile .st-l")).includes("ลาออก"), "the Resigned tile");
      assert.ok((await read(".el-status .toggle-text")).includes("ลาออก"), "the Resigned pill");
      await p.evaluate(() => askDeactivate("Deactivate employee?", "Deactivate Person A? Hidden from today's and future boards; past dates keep them.", () => {}));
      await p.waitForTimeout(200);
      assert.deepEqual(english(await read("#modal-deactivate")), [], "the Deactivate dialog in Thai");
      await p.evaluate(() => closeModal());
      await p.evaluate(() => I18N.setLang("en"));
    });

    await step("on a phone (400 px): Workforce and the matrix fit the page", async () => {
      await p.setViewportSize({ width: 400, height: 800 });
      await showOverview();
      await p.waitForTimeout(300);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, "Overview: no sideways page scroll");
      await goHosts();
      await p.locator("#hostlist-views .btn", { hasText: "Skills matrix" }).click();
      await p.waitForTimeout(300);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, "the matrix: no sideways page scroll");
    });

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all overview-workforce checks passed");
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
    if (failed) process.exit(1);
  }
})();
