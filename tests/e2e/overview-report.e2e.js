/* Acceptance run for Overview phase 2, batch D1 (the monthly management report):
     - a Report button next to Export on Overview, for roles with the History permission only;
     - the dialog: a month (last month to begin with) or History's range, Compare with and the board
       scope shown from the Period heading and the board selector, one checkbox per section (Summary,
       History with its tiles and charts, People, Engineer workload, Workforce, Boards & areas, Skills
       risks), "include names" off by default, PDF or Excel, English or Thai; all remembered;
     - the PDF (the printable sheet) and the Excel file are built from one model, so each checkbox
       adds or removes its section in both, and the numbers are the ones on the screen for the same
       range (Summary tiles with their deltas, Boards & areas, People, Workforce);
     - names only when ticked, in the sheet and in the file;
     - Compare with: same period last year is honoured; Thai; a 400 px phone.
     NODE_PATH=$(npm root -g) node tests/e2e/overview-report.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const h = require("./harness");
const ExcelJS = require("../../vendor/exceljs.min.js");

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
    const d = [0, 1, 2, 3, 4, 5, 6].map((i) => h.addDays(W, i));
    const pw = [0, 1, 2, 3, 4].map((i) => h.addDays(W, i - 7));
    const ly = [0, 1, 2, 3, 4].map((i) => h.addDays(d[i], -364));
    const db = new h.FakeDb();
    h.seedBase(db, { src: h.isWeekend(today) ? h.prevWorking(today) : today });
    db.seed("service_areas", [{ id: "area-2", name: "AREA2", color: "#f0a05a" }]);
    for (const hh of db.t("hosts")) { if (hh.name === "Host Alpha") hh.area_id = "area-1"; if (hh.name === "Host Beta") hh.area_id = "area-2"; }
    for (const e of db.t("employees")) if (e.id === "e9" || e.id === "e10") e.area_id = "area-2";
    // the same seeded week as overview-controls.e2e.js: Board One 4.6 deployed a day, Board Two 2.0, 6.6 together, F lent to Board Two
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
    ly.forEach((day, i) => { m("Y" + i, "b1", day, "70" + i, "Host Alpha", "day"); on("e1", day, "Y" + i); on("e2", day, "Y" + i); });
    db.seed("missions", missions);
    db.seed("assignments", as);
    db.seed("employee_loans", [{ employee_id: "e6", to_board_id: "b2", start_date: d[1], end_date: d[2], note: "" }]);
    // Host Alpha has three experienced active people; Host Beta and Host Gamma have none
    const dh = [];
    let off = 40;
    for (const e of ["e1", "e2", "e3"]) for (let i = 0; i < 5; i++) dh.push({ employee_id: e, plan_date: h.addDays(today, -(off++)), mission_number: "9", host: "Host Alpha", customer: "Cust Alpha", board_id: "b1" });
    db.seed("deployment_history", dh);

    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const OVERVIEW = await p.evaluate(() => OVERVIEW_ID);
    await p.evaluate(() => { localStorage.removeItem("manpower.report"); window.__printed = []; window.print = () => { const s = document.getElementById("report-sheet"); window.__printed.push({ html: s ? s.outerHTML : "", text: s ? s.innerText : "", sections: s ? [...s.querySelectorAll("h2")].map((x) => x.textContent) : [] }); setTimeout(() => window.dispatchEvent(new Event("afterprint")), 0); }; });
    const showOverview = (o = {}) => p.evaluate(async ([day, ov, f, t, opts]) => {
      state.date = day; D().activeBoardId = ov; state.filters.engineer = [];
      state.overview.boardId = opts.board || "";
      state.overview.historyPreset = "custom"; state.overview.historyFrom = f; state.overview.historyTo = t;
      state.overview.historyCacheKey = null; state.overview.historyMeasure = "deployed";
      state.overview.historyGroup = "day"; state.overview.historyBoards = "together"; state.overview.historyCompare = opts.compare || "prev";
      await refreshAndRender();
    }, [d[6], OVERVIEW, d[0], d[6], o]);
    await showOverview();
    const read = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, " ").trim()), sel);
    const tile = (label) => p.evaluate((l) => { const t = [...document.querySelectorAll(".ov-htiles:not(.ov-eng-tiles) .ov-htile")].find((x) => x.querySelector(".ov-htile-label").textContent === l); return [t.querySelector(".ov-htile-value").textContent.replace(/\s+/g, " "), t.querySelector(".ov-htile-delta").textContent]; }, label);
    const ALL = ["Summary", "History", "People", "Engineer workload", "Workforce", "Boards & areas", "Skills risks"];
    const openDialog = async () => { await p.locator("#btn-report").click(); await p.waitForSelector("#modal-report:not(.hidden) #rp-month"); };
    const choose = (opts) => p.evaluate((o) => {
      if (o.period) document.querySelector(`input[name="rp-period"][value="${o.period}"]`).click();
      if (o.month) { const i = document.querySelector("#rp-month"); i.value = o.month; i.dispatchEvent(new Event("change", { bubbles: true })); }
      for (const [k, v] of Object.entries(o.sections || {})) { const c = document.querySelector("#rp-sec-" + k); if (c.checked !== v) c.click(); }
      if (o.names != null) { const c = document.querySelector("#rp-names"); if (c.checked !== o.names) c.click(); }
      if (o.format) document.querySelector(`input[name="rp-format"][value="${o.format}"]`).click();
      if (o.lang) document.querySelector(`input[name="rp-lang"][value="${o.lang}"]`).click();
    }, opts);
    const makePdf = async () => { const n = await p.evaluate(() => window.__printed.length); await p.locator("#btn-report-go").click(); await p.waitForFunction((k) => window.__printed.length > k, n); return p.evaluate(() => window.__printed[window.__printed.length - 1]); };
    const makeXlsx = async (name) => {
      const [dl] = await Promise.all([p.waitForEvent("download"), p.locator("#btn-report-go").click()]);
      await dl.saveAs(name);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(fs.readFileSync(name));
      return wb;
    };
    const rowsOf = (ws) => { const out = []; ws.eachRow({ includeEmpty: false }, (r) => { const o = []; r.eachCell({ includeEmpty: true }, (c) => o.push(c.value)); out.push(o); }); return out; };

    await step("a Report button next to Export, for Overview and the History permission only", async () => {
      assert.equal(await p.locator("#btn-report:not(.hidden)").count(), 1);
      assert.equal(await p.locator("#btn-report + #btn-export").count(), 1, "right next to Export, which keeps the edge");
      await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      assert.equal(await p.locator("#btn-report.hidden").count(), 1, "not on another tab");
      for (const r of db.t("role_permissions")) if (r.role_key === "viewer" && r.area === "ov.history") r.level = "none";
      const v = await env.openAs(db, h.USERS.v);
      await v.page.evaluate((ov) => { D().activeBoardId = ov; return refreshAndRender(); }, OVERVIEW);
      assert.equal(await v.page.locator("#btn-report:not(.hidden)").count(), 0, "a role without History does not see it");
      assert.equal(await v.page.evaluate(() => { OvReport.open(); return document.querySelector("#modal-report").classList.contains("hidden"); }), true, "and cannot open it");
      for (const r of db.t("role_permissions")) if (r.role_key === "viewer" && r.area === "ov.history") r.level = "view";
      await showOverview();
    });

    await step("the dialog: last month, every section, names off, PDF, English; Compare with and the scope shown", async () => {
      await openDialog();
      const lastMonth = await p.evaluate(() => { const x = addDays(monthStart(todayStr()), -1); return x.slice(0, 7); });
      assert.equal(await p.locator("#rp-month").inputValue(), lastMonth);
      assert.equal(await p.locator('input[name="rp-period"]:checked').getAttribute("value"), "month");
      for (const k of ["summary", "history", "people", "engineer", "workforce", "boards", "skills"]) assert.equal(await p.locator("#rp-sec-" + k).isChecked(), true, k);
      assert.equal(await p.locator("#rp-names").isChecked(), false, "names are off until ticked");
      assert.equal(await p.locator('input[name="rp-format"]:checked').getAttribute("value"), "pdf");
      assert.equal(await p.locator('input[name="rp-lang"]:checked').getAttribute("value"), "en");
      assert.match((await read(".rp-scope"))[0], /Compared with previous period .*Scope All boards/);
      assert.deepEqual(await read("#rp-hist-opts .import-info"), ["Utilization", "Deployed / day", "Standby / day", "Missions / day", "Leave / day", "On-call deployed / day", "Include charts (PDF)"]);
      assert.equal(await p.locator("#modal-report #btn-report-go").textContent(), "Make report");
      await p.evaluate(() => closeModal());
    });

    await step("the PDF sheet: title, every section, and the Summary equals the screen's tiles and deltas", async () => {
      await openDialog();
      await choose({ period: "range" });
      const out = await makePdf();
      assert.deepEqual(out.sections, ALL, "one heading per section, in the Overview's order");
      assert.match(out.text, new RegExp(`Manpower report · ${(await p.evaluate(([f, t]) => `${fmtDate(f)} → ${fmtDate(t)}`, [d[0], d[6]])).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · All boards`));
      const t = await tile("Deployed / day");
      assert.ok(out.text.replace(/\s+/g, " ").includes(t[1]), "the delta on the screen, " + t[1]);
      const tiles = await p.evaluate(() => { const s = document.createElement("div"); s.innerHTML = window.__printed[window.__printed.length - 1].html; return [...s.querySelectorAll(".rp-tile")].map((x) => x.textContent.replace(/\s+/g, " ").trim()); });
      assert.ok(tiles.some((x) => x.startsWith("Deployed / day 6.6 avg ▲ 5.6 vs previous period")), tiles.join(" | "));
      assert.equal(await p.locator(".rp").count(), 0, "the sheet is taken down after printing");
      assert.equal(await p.evaluate(() => document.body.classList.contains("printing-report")), false);
    });

    await step("People names only when ticked: not in the sheet by default, in it when included", async () => {
      assert.doesNotMatch((await p.evaluate(() => window.__printed[window.__printed.length - 1].text)), /Person [A-J]/, "no names");
      await openDialog();
      await choose({ names: true });
      const out = await makePdf();
      assert.match(out.text, /Person A/);
      assert.match(out.text, /Eng One/, "engineers are always named: they are the people who run the missions");
      await openDialog();
      await choose({ names: false });
      await p.evaluate(() => closeModal());
    });

    await step("each checkbox adds or removes its section in the PDF", async () => {
      for (const [k, title] of [["summary", "Summary"], ["history", "History"], ["people", "People"], ["engineer", "Engineer workload"], ["workforce", "Workforce"], ["boards", "Boards & areas"], ["skills", "Skills risks"]]) {
        await openDialog();
        await choose({ period: "range", sections: { [k]: false } });
        const out = await makePdf();
        assert.deepEqual(out.sections, ALL.filter((x) => x !== title), "without " + title);
        await openDialog();
        await choose({ sections: { [k]: true } });
        await p.evaluate(() => closeModal());
      }
      await openDialog();
      await choose({ sections: Object.fromEntries(["summary", "history", "people", "engineer", "workforce", "boards", "skills"].map((k) => [k, false])) });
      assert.equal(await p.locator("#btn-report-go").isDisabled(), true, "nothing ticked: nothing to make");
      await choose({ sections: Object.fromEntries(["summary", "history", "people", "engineer", "workforce", "boards", "skills"].map((k) => [k, true])) });
      await p.evaluate(() => closeModal());
    });

    await step("History: only the picked tiles, and charts only when asked", async () => {
      await openDialog();
      await choose({ period: "range", sections: { people: false, engineer: false, workforce: false, boards: false, skills: false } });
      await p.evaluate(() => { for (const k of ["util", "idle", "missions", "leave", "oncall"]) { const c = document.querySelector("#rp-tile-" + k); if (c.checked) c.click(); } });
      const withCharts = await makePdf();
      assert.deepEqual(await p.evaluate(() => { const s = document.createElement("div"); s.innerHTML = window.__printed[window.__printed.length - 1].html; return [...s.querySelectorAll(".rp-block h3")].map((x) => x.textContent); }), ["Deployed / day"]);
      assert.equal(await p.evaluate(() => { const s = document.createElement("div"); s.innerHTML = window.__printed[window.__printed.length - 1].html; return s.querySelectorAll(".rp-block svg").length; }), 1, "a chart");
      await openDialog();
      await p.evaluate(() => document.querySelector("#rp-charts").click());
      await makePdf();
      assert.equal(await p.evaluate(() => { const s = document.createElement("div"); s.innerHTML = window.__printed[window.__printed.length - 1].html; return s.querySelectorAll(".rp-block svg").length; }), 0, "no chart");
      await openDialog();
      await p.evaluate(() => { for (const k of ["util", "deployed", "idle", "missions", "leave", "oncall"]) { const c = document.querySelector("#rp-tile-" + k); if (!c.checked) c.click(); } document.querySelector("#rp-charts").click(); });
      await choose({ sections: { people: true, engineer: true, workforce: true, boards: true, skills: true } });
      await p.evaluate(() => closeModal());
    });

    await step("Excel: one sheet per section, with the screen's numbers", async () => {
      await openDialog();
      await choose({ format: "xlsx", period: "range" });
      const wb = await makeXlsx("/tmp/report-e2e.xlsx");
      assert.deepEqual(wb.worksheets.map((w) => w.name), ["Report", ...ALL.map((x) => (x === "History" ? "Daily history" : x))], "History is a reserved sheet name in Excel");
      const sheet = (n) => rowsOf(wb.getWorksheet(n));
      const sum = Object.fromEntries(sheet("Summary").slice(1).map((r) => [r[0], r]));
      assert.equal(sum["Deployed / day"][1], 6.6);
      assert.equal(sum["Deployed / day"][2], "▲ 5.6 vs previous period", "the same change as the screen's tile");
      assert.equal(sum["Leave / day"][1], 0.4);
      const boards = sheet("Boards & areas");
      const find = (rows, name) => rows.find((r) => r[0] === name);
      const b1 = find(boards, "Board One");
      assert.deepEqual([b1[2], b1[4], b1[5], b1[6]], [4.6, 0.4, 13, -2], "deployed 4.6, leave 0.4, on-call share 13.0, net loans -2");
      assert.equal(find(boards, "Board Two")[6], 2, "net loans +2");
      assert.equal(find(boards, "All boards")[5], 9.1);
      assert.deepEqual(find(boards, "AREA2").slice(1, 7).map(Number), [3, 2, 2, 0, -1, 1], "demand 3, supply 2 (2 permanent, 0 on-call), gap -1, covered by others 1");
      assert.ok(boards.some((r) => r[0] === "Board One" && r[1] === "Board Two" && r[2] === 2 && r[3] === 1), "the loan Board One → Board Two: 2 person-days, 1 person");
      const hist = sheet("Daily history");
      assert.equal(hist[0][1], "Utilization");
      assert.equal(hist.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[0])).length, 5, "a row per working day");
      const people = sheet("People");
      assert.equal(people.some((r) => r.some((c) => typeof c === "string" && /Person [A-J]/.test(c))), false, "no names in the file");
      const eng = sheet("Engineer workload");
      assert.deepEqual([eng.length, eng[1][0]], [2, "Eng One"], "the header and the one engineer who ran missions");
      const skills = sheet("Skills risks");
      assert.deepEqual(skills.filter((r) => /^Host /.test(r[0])).map((r) => r[0]), ["Host Beta", "Host Gamma"], "Host Alpha has three experienced active people");
      const wf = sheet("Workforce");
      assert.equal(wf.filter((r) => /^[A-Z][a-z]+ \d{4}$/.test(r[0])).length, 12, "twelve months");
      assert.deepEqual(sheet("Report").find((r) => r[0] === "Names"), ["Names", "Left out"]);
    });

    await step("Excel: each checkbox adds or removes its sheet; names are in the file only when ticked", async () => {
      await openDialog();
      await choose({ sections: { people: false, skills: false, workforce: false }, names: true });
      await p.evaluate(() => { document.querySelector("#rp-sec-people").click(); document.querySelector("#rp-sec-workforce").click(); });
      const wb = await makeXlsx("/tmp/report-e2e2.xlsx");
      assert.deepEqual(wb.worksheets.map((w) => w.name), ["Report", "Summary", "Daily history", "People", "Engineer workload", "Workforce", "Boards & areas"], "without Skills risks");
      const people = rowsOf(wb.getWorksheet("People"));
      assert.ok(people.some((r) => r[0] === "Person A"), "names included");
      assert.ok(people.some((r) => r[0] === "Person K" || r[0] === "Person G"));
      assert.deepEqual(rowsOf(wb.getWorksheet("Report")).find((r) => r[0] === "Names"), ["Names", "Included"]);
      await openDialog();
      await choose({ names: false, sections: { skills: true } });
      await p.evaluate(() => closeModal());
    });

    await step("the choices are remembered on this device", async () => {
      await openDialog();
      await choose({ period: "range", names: true, format: "xlsx", lang: "th", sections: { skills: false } });
      await p.evaluate(() => closeModal());
      await p.reload();
      await p.waitForSelector("#board-tabs .board-tab", { state: "attached" });
      await p.evaluate((ov) => { D().activeBoardId = ov; return refreshAndRender(); }, OVERVIEW);
      await p.waitForTimeout(300);
      await p.locator("#btn-report").click();
      await p.waitForSelector("#modal-report:not(.hidden) #rp-month");
      assert.equal(await p.locator('input[name="rp-period"]:checked').getAttribute("value"), "range");
      assert.equal(await p.locator("#rp-names").isChecked(), true);
      assert.equal(await p.locator('input[name="rp-format"]:checked').getAttribute("value"), "xlsx");
      assert.equal(await p.locator('input[name="rp-lang"]:checked').getAttribute("value"), "th");
      assert.equal(await p.locator("#rp-sec-skills").isChecked(), false);
      await choose({ names: false, format: "pdf", lang: "en", sections: { skills: true } });
      await p.evaluate(() => closeModal());
      await p.evaluate(() => { window.__printed = []; window.print = () => { const s = document.getElementById("report-sheet"); window.__printed.push({ html: s ? s.outerHTML : "", text: s ? s.innerText : "", sections: s ? [...s.querySelectorAll("h2")].map((x) => x.textContent) : [] }); setTimeout(() => window.dispatchEvent(new Event("afterprint")), 0); }; });
    });

    await step("Compare with: same period last year is the comparison in the report", async () => {
      await showOverview({ compare: "ly" });
      await p.waitForFunction(() => state.overview.historyLY);
      const t = await tile("Deployed / day");
      await openDialog();
      await choose({ period: "range", sections: { history: false, people: false, engineer: false, workforce: false, boards: false, skills: false } });
      assert.match((await read(".rp-scope"))[0], /Compared with same period last year/);
      const out = await makePdf();
      assert.ok(out.text.replace(/\s+/g, " ").includes(t[1]) && /same period last year/.test(t[1]), "the screen says " + t[1]);
      assert.match(out.text, /compared with same period last year/);
      await showOverview();
    });

    await step("in Thai the dialog, the sheet and the file are in Thai", async () => {
      await openDialog();
      await choose({ period: "range", lang: "th", format: "pdf", names: true, sections: { summary: true, history: true, people: true, engineer: true, workforce: true, boards: true, skills: true } });
      const english = (xs) => xs.filter((x) => /[A-Za-z]{3}/.test(x.replace(/\bOC\b|Person [A-J]|Board (One|Two)|Eng (One|Two)|Host (Alpha|Beta|Gamma)|AREA[12]|Excel|PDF/g, "")));
      const out = await makePdf();
      const parts = out.text.split(/\s*\n+\s*/).filter(Boolean);
      assert.deepEqual(english(parts).slice(0, 12), [], "the Thai sheet");
      assert.ok(/[ก-๙]/.test(out.sections.join("")), "Thai headings: " + out.sections.join(" | "));
      await openDialog();
      await choose({ format: "xlsx" });
      const wb = await makeXlsx("/tmp/report-e2e-th.xlsx");
      assert.ok(wb.worksheets.every((w) => /[ก-๙]/.test(w.name)), "Thai sheet names: " + wb.worksheets.map((w) => w.name).join(" | "));
      const all = [];
      for (const w of wb.worksheets) w.eachRow((r) => r.eachCell((c) => { if (typeof c.value === "string") all.push(c.value); }));
      assert.deepEqual(english(all).slice(0, 12), [], "the Thai file");
      await openDialog();
      await choose({ lang: "en", format: "pdf" });
      await p.evaluate(() => closeModal());
    });

    await step("with the app in Thai the Report button and dialog read in Thai", async () => {
      await p.evaluate(() => I18N.setLang("th"));
      await p.waitForTimeout(250);
      const english = (xs) => xs.filter((x) => /[A-Za-z]{3}/.test(x.replace(/\bOC\b|Person [A-J]|Board (One|Two)|PDF|Excel|English|ไทย/g, "")));
      assert.deepEqual(english(await read("#btn-report")), []);
      assert.deepEqual(await p.evaluate(() => document.querySelector("#btn-report").title), "รายงานผู้บริหารประจำเดือน: เลือกส่วนที่ต้องการ แล้วสร้างเป็น PDF หรือ Excel");
      await openDialog();
      await p.waitForTimeout(250);
      assert.deepEqual(english(await read("#modal-report")), [], "the dialog in Thai");
      await p.evaluate(() => { closeModal(); I18N.setLang("en"); });
    });

    await step("on a phone (400 px) Report is in the ⋯ menu, and the dialog fits", async () => {
      await p.setViewportSize({ width: 400, height: 800 });
      await showOverview();
      await p.waitForTimeout(300);
      await p.locator("#m-more").click();
      const items = await read("#m-more-menu .tb-item");
      assert.ok(items.some((x) => /Report/.test(x)) && items.some((x) => /Export/.test(x)), items.join(" | "));
      await p.locator("#m-more-menu .tb-item", { hasText: "Report" }).click();
      await p.waitForSelector("#modal-report:not(.hidden) #rp-month");
      assert.ok(await p.evaluate(() => { const m = document.querySelector("#modal-report"); const r = m.getBoundingClientRect(); return Math.round(r.width) <= 400 && m.scrollWidth - m.clientWidth <= 0; }), "fits");
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0);
      await p.evaluate(() => closeModal());
    });

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all overview-report checks passed");
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
    if (failed) process.exit(1);
  }
})();
