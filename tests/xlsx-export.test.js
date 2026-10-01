// node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("../vendor/exceljs.min.js");   // the same bundle the browser loads
const X = require("../xlsx-export.js");

const LOGO = fs.readFileSync(path.join(__dirname, "..", "logo-on-navy.png"));
const row = (o) => ({
  empId: o.name, name: o.name, contract: "Permanent", position: "Inspector", area: "FTM", mission: "M-101", host: "AAT Rayong",
  customer: "Thai Oil", ppe: "Helmet", shift: "Day", start: "08:00", end: "17:00", engineer: "K. Wichai", remark: "", ...o,
});
const ROWS = [
  row({ name: "Somchai" }),
  row({ name: "Pichai", contract: "On-call" }),
  row({ name: "Malee", mission: "M-103", shift: "Night", start: "20:00", end: "05:00" }),
];
const BASE = { boardName: "LCB Port", dateEn: "Thu 01-Oct-2026", dateTh: "พฤหัสบดี 01-ตุลาคม-2569", rows: ROWS, logo: LOGO };

async function roundTrip(opts) {
  const { workbook, summary } = await X.buildWorkbook(ExcelJS, { ...BASE, ...opts });
  const buf = await workbook.xlsx.writeBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return { ws: wb.worksheets[0], summary };
}
async function roundTripAll(opts) {
  const { workbook, summary } = await X.buildWorkbook(ExcelJS, { ...BASE, ...opts });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await workbook.xlsx.writeBuffer());
  return { wb, sheets: wb.worksheets, summary };
}
const person = (o) => ({ empId: o.name, name: o.name, contract: "Permanent", position: "Inspector", area: "FTM", phone: "081-000-0000", ...o });
const GROUPS = {
  leave: [
    person({ name: "Anan", leaveKey: "annual", leave: "Annual Leave · ลาพักร้อน", leaveEn: "Annual Leave" }),
    person({ name: "Kanya", leaveKey: "sick", leave: "Sick Leave · ลาป่วย", leaveEn: "Sick Leave" }),
    person({ name: "Wirat", leaveKey: "exchange", leave: "Exchange Working Day · สลับวันหยุด", leaveEn: "Exchange Working Day", contract: "On-call" }),
  ],
  standby: [person({ name: "Suda" }), person({ name: "Niran" })],
  oncall: [person({ name: "Tawan", contract: "On-call" })],
};
const headerOf = (ws) => { const out = []; ws.getRow(6).eachCell((c) => out.push(c.value)); return out; };

test("all columns come out in the agreed order", async () => {
  const { ws } = await roundTrip({ columns: X.ALL_KEYS });
  assert.deepEqual(headerOf(ws), ["Name", "Contract Type", "Position", "Service Area", "Mission", "Host", "Customer", "PPE", "Shift", "Start", "End", "Engineer", "Remark"]);
});

test("ticked columns only, always in sheet order whatever order they were passed in", async () => {
  const { ws } = await roundTrip({ columns: ["remark", "name", "engineer", "mission"] });
  assert.deepEqual(headerOf(ws), ["Name", "Mission", "Engineer", "Remark"]);
  assert.equal(ws.getCell(7, 1).value, "Somchai");
  assert.equal(ws.getCell(7, 2).value, "M-101");
});

test("dropping Shift, Start and End leaves a sheet with no gaps", async () => {
  const keys = X.ALL_KEYS.filter((k) => !["shift", "start", "end"].includes(k));
  const { ws } = await roundTrip({ columns: keys });
  assert.equal(headerOf(ws).length, 10);
  assert.ok(!headerOf(ws).includes("Shift"));
  assert.equal(ws.getCell(7, 9).value, "K. Wichai");   // Engineer moved up
});

test("banner carries board, date and the total number of employees", async () => {
  const { ws } = await roundTrip({ columns: X.ALL_KEYS });
  const texts = [];
  ws.eachRow((r, n) => { if (n <= 3) r.eachCell((c) => texts.push(String(c.value))); });
  assert.ok(texts.includes("Manpower Board"));
  assert.ok(texts.includes("OPERATIONS PLANNING"));
  assert.ok(texts.includes("LCB Port"));
  assert.ok(texts.some((t) => t.includes("Thu 01-Oct-2026") && t.includes("พฤหัสบดี")));
  assert.ok(texts.includes("3"), "total employees");
  assert.ok(texts.includes("TOTAL EMPLOYEES"));
});

test("total row counts people once and splits permanent from on-call", async () => {
  const dup = [...ROWS, row({ name: "Somchai", mission: "M-104" })];   // same person on a second row
  const { ws, summary } = await roundTrip({ columns: X.ALL_KEYS, rows: dup });
  assert.deepEqual({ total: summary.total, permanent: summary.permanent, oncall: summary.oncall, missions: summary.missions }, { total: 3, permanent: 2, oncall: 1, missions: 3 });
  const total = ws.getCell(7 + dup.length, 1).value;
  assert.match(total.richText.map((r) => r.text).join(""), /TOTAL EMPLOYEES: 3\s+\(Permanent 2 · On-call 1\)/);
});

test("a very narrow selection still gets a complete banner (filler columns, nothing cut off)", async () => {
  const { ws } = await roundTrip({ columns: ["name", "shift"] });
  assert.deepEqual(headerOf(ws), ["Name", "Shift"]);
  const L = X.bannerLayout([30, 8]);
  assert.ok(L.fillers.length > 0);
  assert.ok(ws.columnCount >= 2 + L.fillers.length);
  let board = null;
  ws.getRow(2).eachCell((c) => { if (c.value === "LCB Port") board = c; });
  assert.ok(board, "board name present");
});

test("zero columns is refused", async () => {
  await assert.rejects(X.buildWorkbook(ExcelJS, { ...BASE, columns: [] }), /at least one column/);
});

test("no logo file falls back to a TRIGO wordmark instead of failing", async () => {
  const { ws } = await roundTrip({ columns: X.ALL_KEYS, logo: null });
  assert.equal(ws.getCell(2, 1).value, "TRIGO");
});

test("header row is frozen, filterable, and prints on every page", async () => {
  const { ws } = await roundTrip({ columns: X.ALL_KEYS });
  assert.equal(ws.views[0].state, "frozen");
  assert.equal(ws.views[0].ySplit, 6);
  assert.ok(ws.autoFilter);
  assert.equal(ws.pageSetup.printTitlesRow, "6:6");
});

test("sheet names are legal for Excel", () => {
  assert.equal(X.safeSheetName("A/B:C*D?[E]"), "A B C D E");
  assert.equal(X.safeSheetName("x".repeat(50)).length, 31);
  assert.equal(X.safeSheetName(""), "Manpower Board");
});

test("no merge is ever a single cell (Excel offers to 'repair' a file that has one)", async () => {
  const sets = [X.ALL_KEYS, ["name"], ["name", "shift"], ["name", "mission", "host"], X.ALL_KEYS.slice(0, 7)];
  for (const columns of sets) for (const logo of [LOGO, null]) {
    const { ws } = await roundTrip({ columns, logo });
    for (const m of Object.values(ws._merges)) {
      const { top, left, bottom, right } = m.model;
      assert.ok(bottom > top || right > left, `single-cell merge in ${JSON.stringify(columns)} logo=${!!logo}`);
    }
  }
});

const footerText = (ws, n) => ws.getCell(n, 1).value.richText.map((r) => r.text).join("");
const bannerTexts = (ws) => { const t = []; ws.eachRow((r, n) => { if (n <= 3) r.eachCell((c) => t.push(String(c.value))); }); return t; };

test("without the Contract Type column only the total is shown (no permanent / on-call split)", async () => {
  const noContract = X.ALL_KEYS.filter((k) => k !== "contract");
  const a = await roundTrip({ columns: noContract });
  assert.equal(footerText(a.ws, 7 + ROWS.length).trim(), "TOTAL EMPLOYEES: 3");
  assert.ok(bannerTexts(a.ws).includes("3"));
  assert.ok(!bannerTexts(a.ws).some((t) => /permanent|on-call/i.test(t)));
  const b = await roundTrip({ columns: X.ALL_KEYS });
  assert.match(footerText(b.ws, 7 + ROWS.length), /\(Permanent 2 · On-call 1\)/);
});

test("people not on a mission get one sheet per reason, after the mission sheet", async () => {
  const { sheets, summary } = await roundTripAll({ columns: X.ALL_KEYS, groups: GROUPS });
  assert.deepEqual(sheets.map((w) => w.name), ["LCB Port", "Leave & Exchange", "Standby", "Available On-call"]);
  assert.deepEqual(summary.groups.leave.types.map((t) => [t.label, t.n]), [["Annual Leave", 1], ["Sick Leave", 1], ["Exchange Working Day", 1]]);
  assert.equal(summary.groups.standby.total, 2);
  assert.equal(summary.groups.oncall.total, 1);
});

test("leave sheet: leave type and mobile number as details, tinted, with a per-type total", async () => {
  const { sheets } = await roundTripAll({ columns: X.ALL_KEYS, groups: GROUPS });
  const ws = sheets[1];
  assert.deepEqual(headerOf(ws), ["Name", "Contract Type", "Position", "Service Area", "Leave Type", "Mobile Number"]);
  assert.equal(ws.getCell(7, 1).value, "Anan");
  assert.equal(ws.getCell(7, 5).value, "Annual Leave · ลาพักร้อน");
  assert.equal(ws.getCell(7, 6).value, "081-000-0000");
  assert.notEqual(ws.getCell(7, 5).fill.fgColor.argb, ws.getCell(9, 5).fill.fgColor.argb, "exchange reads differently from leave");
  assert.match(footerText(ws, 10), /TOTAL: 3\s+\(Annual Leave 1 · Sick Leave 1 · Exchange Working Day 1\)/);
  assert.ok(bannerTexts(ws).includes("ON LEAVE / EXCHANGE"));
  assert.ok(bannerTexts(ws).includes("LEAVE & EXCHANGE WORKING DAY"));
});

test("standby and on-call sheets list their people with a total", async () => {
  const { sheets } = await roundTripAll({ columns: X.ALL_KEYS, groups: GROUPS });
  assert.deepEqual(headerOf(sheets[2]), ["Name", "Contract Type", "Position", "Service Area", "Mobile Number"]);
  assert.deepEqual([7, 8].map((r) => sheets[2].getCell(r, 1).value), ["Suda", "Niran"]);
  assert.equal(footerText(sheets[2], 9).trim(), "TOTAL: 2");
  assert.equal(sheets[3].getCell(7, 1).value, "Tawan");
  assert.ok(bannerTexts(sheets[3]).includes("AVAILABLE ON-CALL"));
});

test("the extra sheets follow the picked columns, but always keep Name", async () => {
  const { sheets } = await roundTripAll({ columns: ["mission", "host"], groups: GROUPS });
  assert.deepEqual(headerOf(sheets[0]), ["Mission", "Host"]);
  assert.deepEqual(headerOf(sheets[1]), ["Name", "Leave Type", "Mobile Number"]);
  assert.deepEqual(headerOf(sheets[2]), ["Name", "Mobile Number"]);
  const some = await roundTripAll({ columns: ["name", "position"], groups: GROUPS });
  assert.deepEqual(headerOf(some.sheets[2]), ["Name", "Position", "Mobile Number"]);
});

test("an empty or missing group adds no sheet", async () => {
  const { sheets } = await roundTripAll({ columns: X.ALL_KEYS, groups: { leave: [], standby: GROUPS.standby } });
  assert.deepEqual(sheets.map((w) => w.name), ["LCB Port", "Standby"]);
  assert.equal((await roundTripAll({ columns: X.ALL_KEYS })).sheets.length, 1);
});

test("a board named like an extra sheet does not collide with it", async () => {
  const { sheets } = await roundTripAll({ boardName: "Standby", columns: X.ALL_KEYS, groups: GROUPS });
  assert.deepEqual(sheets.map((w) => w.name), ["Standby", "Leave & Exchange", "Standby (2)", "Available On-call"]);
});

test("every sheet is free of single-cell merges and has a frozen, filterable header", async () => {
  for (const columns of [X.ALL_KEYS, ["name"], ["mission", "host", "shift"]]) {
    const { sheets } = await roundTripAll({ columns, groups: GROUPS });
    for (const ws of sheets) {
      for (const m of Object.values(ws._merges)) assert.ok(m.model.bottom > m.model.top || m.model.right > m.model.left, `${ws.name} ${JSON.stringify(columns)}`);
      assert.equal(ws.views[0].ySplit, 6);
      assert.ok(ws.autoFilter);
    }
  }
});
