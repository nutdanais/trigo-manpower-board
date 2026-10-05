/* Acceptance run for "Export to Excel", driving the real app in Chromium
   against the shared fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/excel-export.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const h = require("./harness");
const ExcelJS = require("../../vendor/exceljs.min.js");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;   // a day the seed has missions on

/* the board's one Export button, then "Excel" as the file type */
async function openBoardXlsx(page) {
  await page.click("#btn-export");
  await page.waitForSelector("#modal-xlsx:not(.hidden)");
  await page.check('#board-export-type input[value="xlsx"]');
}

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 5).join("\n   ")); throw e; }
}
async function readSheet(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(path));
  return wb.worksheets[0];
}
const headerOf = (ws) => { const out = []; ws.getRow(6).eachCell((c) => out.push(c.value)); return out; };

(async () => {
  const env = await h.launch();
  try {
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    // give one mission a PPE line and a remark so those columns have something to show
    db.t("missions").find((m) => m.id === "s101").ppe = "Helmet, Boots";
    db.t("missions").find((m) => m.id === "s101").remark = "Bring torque tools";
    db.t("employees").find((e) => e.id === "e1").phone = "081-234-5678";
    db.t("employees").find((e) => e.id === "e1").start_date = "2023-04-20";
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);

    await step("the Export button is on a board, Excel is a file type, and the dialog lists all 16 columns ticked", async () => {
      assert.equal(await p.locator("#btn-export").isVisible(), true);
      await openBoardXlsx(p);
      const labels = await p.locator("#xlsx-cols .import-info").allTextContents();
      assert.deepEqual(labels, ["Name", "Contract Type", "Position", "Mobile Number", "Start Date", "Years of Service", "Service Area", "Mission", "Host", "Customer", "PPE", "Shift", "Start", "End", "Engineer", "Remark"]);
      assert.equal(await p.locator("#xlsx-cols input:checked").count(), 16);
      assert.match(await p.textContent("#xlsx-count"), /16 of 16/);
      assert.match(await p.textContent("#xlsx-summary"), /Board One .* 4 employees on 3 missions/);
      const sheets = await p.locator("#xlsx-sheets .import-row").allTextContents();
      assert.deepEqual(sheets.map((t) => t.replace(/\s+/g, " ").trim()), [
        "Leave & Exchange Working Day 1 person", "Standby (permanent, unassigned) 1 person", "Available On-call (unassigned) 2 people"]);
      assert.equal(await p.locator("#xlsx-sheets input:checked").count(), 3);
      await p.screenshot({ path: "/tmp/xlsx-dialog.png" });
    });

    await step("Untick all disables Export; ticking one re-enables it", async () => {
      await p.click("#btn-xlsx-none");
      assert.equal(await p.locator("#btn-xlsx-go").isDisabled(), true);
      assert.match(await p.textContent("#xlsx-count"), /0 of 16/);
      await p.click("#btn-xlsx-all");
      assert.equal(await p.locator("#btn-xlsx-go").isDisabled(), false);
    });

    let file;
    await step("exporting with Shift, Start and End unticked downloads a sheet without them", async () => {
      for (const k of ["shift", "start", "end"]) await p.uncheck(`#xlsx-cols input[value=${k}]`);
      assert.match(await p.textContent("#xlsx-count"), /13 of 16/);
      const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-xlsx-go")]);
      assert.equal(dl.suggestedFilename(), `Board_One_${SRC}.xlsx`);
      file = "/tmp/xlsx-e2e.xlsx";
      await dl.saveAs(file);
      assert.ok(fs.statSync(file).size > 5000);
      await p.waitForSelector("#modal-xlsx", { state: "hidden" });
    });

    await step("the file has the banner, the thirteen chosen columns and one row per person", async () => {
      const ws = await readSheet(file);
      assert.deepEqual(headerOf(ws), ["Name", "TRIGO ID", "Contract Type", "Position", "Mobile Number", "Start Date", "Years of Service", "Service Area", "Mission", "Host", "Customer", "PPE", "Engineer", "Remark"]);
      const banner = [];
      ws.eachRow((r, n) => { if (n <= 3) r.eachCell((c) => banner.push(String(c.value))); });
      assert.ok(banner.includes("Manpower Board") && banner.includes("OPERATIONS PLANNING") && banner.includes("Board One"));
      assert.ok(banner.some((t) => /^\w{3} \d\d-\w{3}-\d{4}/.test(t)), "date in banner");
      assert.ok(banner.includes("4") && banner.includes("TOTAL EMPLOYEES"));
      const names = [];
      for (let r = 7; r <= 10; r++) names.push(ws.getCell(r, 1).value);
      assert.deepEqual(names, ["Person A", "Person B", "Person C", "Person D"]);   // missions 101,101,102,103
      assert.equal(ws.getCell(7, 5).value, "081-234-5678");   // Person A's mobile, kept as text
      assert.equal(ws.getCell(8, 5).value, "", "no number on file = empty cell");
      // Start Date is a real Excel date; Years of Service counts from it up to the real today
      const sd = ws.getCell(7, 6).value;
      assert.ok(sd instanceof Date && sd.toISOString().slice(0, 10) === "2023-04-20", "Person A start date: " + sd);
      assert.equal(ws.getCell(7, 6).numFmt, "dd-mmm-yyyy");
      assert.equal(ws.getCell(7, 7).value, require("../../xlsx-export.js").serviceLength("2023-04-20", T));
      assert.match(ws.getCell(7, 7).value, /^\d+ years? \d+ months? \d+ days?$/);
      assert.equal(ws.getCell(8, 6).value, "", "no start date on file = empty cell");
      assert.equal(ws.getCell(8, 7).value, "");
      assert.equal(ws.getCell(7, 9).value, "101");
      assert.equal(ws.getCell(7, 12).value, "Helmet, Boots");
      assert.equal(ws.getCell(7, 14).value, "Bring torque tools");
      assert.equal(ws.getCell(7, 13).value, "Eng One");
      assert.equal(ws.getCell(11, 1).value.richText.map((x) => x.text).join("").includes("TOTAL EMPLOYEES: 4"), true);
      assert.equal(ws.getImages().length, 1, "TRIGO logo embedded");
    });

    await step("the same file has the three extra sheets: leave + exchange, permanent standby, available on-call", async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(fs.readFileSync(file));
      assert.deepEqual(wb.worksheets.map((w) => w.name), ["Board One", "Leave & Exchange", "Standby", "Available On-call"]);
      const [, leave, standby, oncall] = wb.worksheets;
      const col = (ws, c, from, to) => { const o = []; for (let r = from; r <= to; r++) o.push(ws.getCell(r, c).value); return o; };
      const head = (ws) => { const o = []; ws.getRow(6).eachCell((c) => o.push(c.value)); return o; };
      assert.deepEqual(head(leave), ["Name", "TRIGO ID", "Contract Type", "Position", "Mobile Number", "Start Date", "Years of Service", "Service Area", "Leave Type"]);
      assert.deepEqual(col(leave, 1, 7, 7), ["Person E"]);
      assert.equal(leave.getCell(7, 9).value, "Annual Leave");
      assert.equal(leave.getCell(7, 5).value, "", "Person E has no number on file");
      assert.deepEqual(col(standby, 1, 7, 7), ["Person F"]);
      assert.deepEqual(col(oncall, 1, 7, 8), ["Person G", "Person H"]);
      assert.deepEqual(col(oncall, 3, 7, 8), ["On-call", "On-call"]);
      for (const ws of [leave, standby, oncall]) {
        const t = []; ws.eachRow((r, n) => { if (n <= 3) r.eachCell((c) => t.push(String(c.value))); });
        assert.ok(t.includes("Manpower Board") && t.includes("Board One") && t.some((x) => /^\w{3} \d\d-\w{3}-\d{4}/.test(x)), ws.name + " banner");
        assert.equal(ws.getImages().length, 1, ws.name + " logo");
      }
    });

    await step("choosing Thai in the dialog downloads a Thai file, and the choice is remembered", async () => {
      await openBoardXlsx(p);
      assert.equal(await p.locator("#xlsx-lang input[value=en]").isChecked(), true, "English by default");
      await p.check("#xlsx-lang input[value=th]");
      const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-xlsx-go")]);
      assert.equal(dl.suggestedFilename(), `Board_One_${SRC}_TH.xlsx`);
      await dl.saveAs("/tmp/xlsx-e2e-th.xlsx");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(fs.readFileSync("/tmp/xlsx-e2e-th.xlsx"));
      assert.deepEqual(wb.worksheets.map((w) => w.name), ["Board One", "ลาและสลับวันหยุด", "สแตนด์บาย", "ออนคอลที่ว่าง"]);
      const ws = wb.worksheets[0];
      assert.deepEqual(headerOf(ws), ["ชื่อ", "รหัส TRIGO", "ประเภทสัญญา", "ตำแหน่ง", "เบอร์มือถือ", "วันที่เริ่มงาน", "อายุงาน", "พื้นที่บริการ", "ภารกิจ", "โฮสต์", "ลูกค้า", "PPE", "วิศวกร", "หมายเหตุ"]);
      assert.equal(ws.getCell(7, 1).value, "Person A");
      assert.equal(ws.getCell(7, 3).value, "ประจำ");
      assert.match(ws.getCell(7, 7).value, /^\d+ ปี \d+ เดือน \d+ วัน$/);
      await openBoardXlsx(p);
      assert.equal(await p.locator("#xlsx-lang input[value=th]").isChecked(), true, "Thai remembered");
      await p.click("#modal-xlsx [data-close].btn");
    });

    await step("the column choice is remembered next time the dialog opens", async () => {
      await openBoardXlsx(p);
      assert.equal(await p.locator("#xlsx-cols input:checked").count(), 13);
      assert.equal(await p.locator("#xlsx-cols input[value=shift]").isChecked(), false);
      await p.check("#xlsx-lang input[value=en]");   // the Thai choice was remembered; this step checks the English sheet names
      await p.uncheck("#xlsx-sheets input[value=standby]");
      await p.uncheck("#xlsx-sheets input[value=oncall]");
      const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-xlsx-go")]);
      await dl.saveAs("/tmp/xlsx-e2e-2.xlsx");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(fs.readFileSync("/tmp/xlsx-e2e-2.xlsx"));
      assert.deepEqual(wb.worksheets.map((w) => w.name), ["Board One", "Leave & Exchange"], "unticked sheets are left out");
      await openBoardXlsx(p);   // and that choice is remembered too
      assert.equal(await p.locator("#xlsx-sheets input[value=leave]").isChecked(), true);
      assert.equal(await p.locator("#xlsx-sheets input[value=standby]").isChecked(), false);
      assert.equal(await p.locator("#xlsx-sheets input[value=oncall]").isChecked(), false);
      await p.click("#modal-xlsx [data-close].btn");
    });

    await step("Excel is not offered on Overview; a non-working day with nobody on leave says Excel has nothing to write", async () => {
      await p.evaluate(() => { D().activeBoardId = OVERVIEW_ID; return refreshAndRender(); });
      await p.click("#btn-export");
      await p.waitForSelector("#modal-xlsx:not(.hidden)");
      assert.equal(await p.locator('#board-export-type input[value="xlsx"]').count(), 0, "no Excel on Overview");
      assert.equal(await p.locator('#board-export-type input[value="jpg"]').count(), 1, "JPG / PDF are");
      await p.click("#modal-xlsx [data-close].btn");
      let weekend = SRC;   // a past weekend: confirmed (not a forecast), and nobody is expected in
      while (!h.isWeekend(weekend)) weekend = h.addDays(weekend, -1);
      await p.evaluate((d) => { D().activeBoardId = "b2"; state.date = d; return refreshAndRender(); }, weekend);
      await openBoardXlsx(p);
      assert.match(await p.textContent("#xlsx-summary"), /Nobody is on this board/);
      assert.equal(await p.locator("#btn-xlsx-go").isDisabled(), true, "Excel has nothing to write");
      await p.check('#board-export-type input[value="jpg"]');
      assert.equal(await p.locator("#btn-xlsx-go").isDisabled(), false, "a JPG can still be taken");
      await p.click("#modal-xlsx [data-close].btn");
    });

    await step("a read-only viewer can export", async () => {
      const v = await env.openAs(db, h.USERS.v);
      await v.page.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);
      assert.equal(await v.page.locator("#btn-export").isVisible(), true);
      await openBoardXlsx(v.page);
      const [dl] = await Promise.all([v.page.waitForEvent("download"), v.page.click("#btn-xlsx-go")]);
      assert.ok(dl.suggestedFilename().endsWith(".xlsx"));
      assert.deepEqual(v.errors, []);
    });

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all excel export checks passed");
  } finally {
    await env.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
