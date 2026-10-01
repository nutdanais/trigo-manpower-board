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
  assert.deepEqual(summary, { total: 3, permanent: 2, oncall: 1, missions: 3 });
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
