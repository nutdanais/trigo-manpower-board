/* Acceptance run for the optional employee Start date: the New / Edit Employee
   form saves it (and can clear it), and the Manpower List shows it with Years
   of service, filters on it and exports it to Excel in English or Thai.
     NODE_PATH=$(npm root -g) node tests/e2e/employee-start-date.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const h = require("./harness");
const ExcelJS = require("../../vendor/exceljs.min.js");
const X = require("../../xlsx-export.js");

(async () => {
  const env = await h.launch();
  try {
    const T = h.iso(new Date());
    const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);
    const save = async () => {
      await h.submitEmployeeForm(p);
      await p.waitForSelector("#modal-employee", { state: "hidden" });
    };

    await p.evaluate(() => openEmployeeModal(null));
    await p.fill("#form-employee input[name=name]", "Dated Person");
    await p.fill("#form-employee input[name=startDate]", "2024-02-29");
    await save();
    const dated = db.t("employees").find((e) => e.name_th === "Dated Person");
    assert.equal(dated.start_date, "2024-02-29");
    console.log("ok - a new employee is saved with a start date");

    await p.evaluate(() => openEmployeeModal(null));
    await p.fill("#form-employee input[name=name]", "Undated Person");
    await save();
    assert.equal(db.t("employees").find((e) => e.name_th === "Undated Person").start_date, null);
    console.log("ok - the start date is optional");

    await p.evaluate((id) => { openEmployeeModal(id); state.employeeTab = "edit"; applyEmployeeTab(); }, dated.id);
    assert.equal(await p.inputValue("#form-employee input[name=startDate]"), "2024-02-29");
    await p.fill("#form-employee input[name=startDate]", "2023-04-20");
    await save();
    assert.equal(db.t("employees").find((e) => e.id === dated.id).start_date, "2023-04-20");
    await p.evaluate((id) => { openEmployeeModal(id); state.employeeTab = "edit"; applyEmployeeTab(); }, dated.id);
    await p.fill("#form-employee input[name=startDate]", "");
    await save();
    assert.equal(db.t("employees").find((e) => e.id === dated.id).start_date, null);
    console.log("ok - editing changes and clears it");

    db.t("employees").find((e) => e.id === dated.id).start_date = "2023-04-20";
    await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return cloud._loadEmployees().then(refreshAndRender); });
    const cells = await p.locator("#emplist-body tr:has(td:text-is(\"Dated Person\"))").locator("td[data-label='Start date']").allTextContents();
    assert.deepEqual(cells, ["20-Apr-2023"]);
    const none = await p.locator("#emplist-body tr:has(td:text-is(\"Undated Person\"))").locator("td[data-label='Start date']").allTextContents();
    assert.deepEqual(none, ["—"]);
    console.log("ok - the Manpower List shows it");

    // ---- Years of service, its filter, and the Excel export of the list ----
    const ago = (y, m, d) => { const t = new Date(); t.setFullYear(t.getFullYear() - y, t.getMonth() - m, t.getDate() - d); return h.iso(t); };
    const set = (name, start) => { db.t("employees").find((e) => e.name_th === name).start_date = start; };
    set("Dated Person", ago(3, 5, 12));
    set("Undated Person", null);
    set("Person A", ago(0, 3, 0));
    set("Person B", ago(1, 6, 0));
    set("Person C", ago(2, 1, 0));
    await p.evaluate(() => cloud._loadEmployees().then(refreshAndRender));
    const rowsText = async () => p.locator("#emplist-body tr td[data-label=Name]").allTextContents();
    const cell = (name, label) => p.locator(`#emplist-body tr:has(td:text-is("${name}")) td[data-label="${label}"]`).textContent();

    assert.equal(await cell("Dated Person", "Years of service"), X.serviceLength(ago(3, 5, 12), T));
    assert.equal(await cell("Undated Person", "Years of service"), "—");
    console.log("ok - the Manpower List shows Years of service");

    const pick = async (key, labels) => {
      await p.click(`#emplist-filters .ms[data-filter=${key}] .ms-btn`);
      for (const l of labels) await p.locator(`#emplist-filters .ms[data-filter=${key}] .ms-opt`, { hasText: l }).locator("input").check();
      await p.click("body", { position: { x: 5, y: 5 } });
    };
    await pick("service", ["Under 1 year"]);
    assert.deepEqual(await rowsText(), ["Person A"]);
    await p.click("#emplist-filters .ms[data-filter=service] .ms-btn");
    await p.locator("#emplist-filters .ms[data-filter=service] .ms-opt", { hasText: "Under 1 year" }).locator("input").uncheck();
    await p.locator("#emplist-filters .ms[data-filter=service] .ms-opt", { hasText: "3 years or more" }).locator("input").check();
    assert.deepEqual(await rowsText(), ["Dated Person"]);
    await p.locator("#emplist-filters .ms[data-filter=service] .ms-opt", { hasText: "3 years or more" }).locator("input").uncheck();
    await p.locator("#emplist-filters .ms[data-filter=service] .ms-opt", { hasText: "no start date" }).locator("input").check();
    assert.ok((await rowsText()).includes("Undated Person") && !(await rowsText()).includes("Person A"));
    await p.click("#emplist-filters .ms[data-filter=service] .ms-pop .ms-clear");
    await p.click("body", { position: { x: 5, y: 5 } });
    console.log("ok - the Years of service filter");

    await p.click('#emplist-table th[data-sort=service]');
    let sorted = await rowsText();
    assert.equal(sorted[0], "Person A", "ascending: shortest service first");
    assert.ok(sorted.indexOf("Undated Person") > sorted.indexOf("Dated Person"), "no start date sorts after people who have one");
    await p.click('#emplist-table th[data-sort=service]');
    sorted = await rowsText();
    assert.equal(sorted[0], "Dated Person", "descending: longest service first");
    assert.ok(sorted.indexOf("Undated Person") > sorted.indexOf("Person A"), "still after people who have one");
    console.log("ok - sorting by Years of service");

    // Excel export: the rows on screen, English then Thai
    await p.fill("#emplist-search", "Person");
    await p.click("#btn-emplist-xlsx");
    await p.waitForSelector("#modal-emplist-xlsx:not(.hidden)");
    assert.match(await p.textContent("#emplist-xlsx-summary"), /^\d+ employees/);
    assert.equal(await p.locator("#emplist-xlsx-lang input[value=en]").isChecked(), true);
    let [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-emplist-xlsx-go")]);
    assert.equal(dl.suggestedFilename(), `manpower_list_${T}.xlsx`);
    await dl.saveAs("/tmp/emplist-en.xlsx");
    let wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fs.readFileSync("/tmp/emplist-en.xlsx"));
    let ws = wb.worksheets[0];
    assert.equal(ws.name, "Manpower List");
    const head = (w) => { const o = []; w.getRow(1).eachCell((c) => o.push(c.value)); return o; };
    assert.deepEqual(head(ws), ["Thai Name", "English Name", "TRIGO ID", "Contract Type", "Position", "Mobile Number", "Start Date", "Years of Service", "Service Area", "Current Board", "30D Utilization", "Status"]);
    const names = []; const shown = (await rowsText()).length;
    for (let r = 2; r <= 1 + shown; r++) names.push(ws.getCell(r, 1).value);
    assert.deepEqual(names, await rowsText(), "same rows, same order as the table");
    assert.equal(ws.getImages().length, 0, "no banner or logo");
    console.log("ok - the Manpower List exports to Excel in English");

    await p.click("#btn-emplist-xlsx");
    await p.waitForSelector("#modal-emplist-xlsx:not(.hidden)");
    await p.check("#emplist-xlsx-lang input[value=th]");
    [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-emplist-xlsx-go")]);
    assert.equal(dl.suggestedFilename(), `manpower_list_${T}_TH.xlsx`);
    await dl.saveAs("/tmp/emplist-th.xlsx");
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fs.readFileSync("/tmp/emplist-th.xlsx"));
    ws = wb.worksheets[0];
    assert.equal(ws.name, "รายชื่อพนักงาน");
    assert.deepEqual(head(ws), ["ชื่อ (ไทย)", "ชื่อ (อังกฤษ)", "รหัส TRIGO", "ประเภทสัญญา", "ตำแหน่ง", "เบอร์มือถือ", "วันที่เริ่มงาน", "อายุงาน", "พื้นที่บริการ", "บอร์ดปัจจุบัน", "การใช้งาน 30 วัน", "สถานะ"]);
    const row = {}; for (let r = 2; r <= 1 + shown; r++) row[ws.getCell(r, 1).value] = r;
    assert.equal(ws.getCell(row["Dated Person"], 4).value, "ประจำ");
    assert.equal(ws.getCell(row["Dated Person"], 8).value, X.serviceLength(ago(3, 5, 12), T, "th"));
    assert.equal(ws.getCell(row["Dated Person"], 12).value, "ใช้งาน");
    // the Thai choice is remembered by both exports
    await p.click("#btn-emplist-xlsx");
    await p.waitForSelector("#modal-emplist-xlsx:not(.hidden)");
    assert.equal(await p.locator("#emplist-xlsx-lang input[value=th]").isChecked(), true);
    await p.click("#modal-emplist-xlsx [data-close].btn");
    await p.fill("#emplist-search", "zzzz-nobody");
    await p.click("#btn-emplist-xlsx");
    await p.waitForSelector(".toast, #toast-stack > *");
    assert.equal(await p.locator("#modal-emplist-xlsx:not(.hidden)").count(), 0, "nothing to export opens no dialog");
    console.log("ok - the Manpower List exports to Excel in Thai");

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all start date checks passed");
  } finally {
    await env.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
