// node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("../vendor/exceljs.min.js");   // the same bundle the browser loads
const X = require("../xlsx-export.js");

const LOGO = fs.readFileSync(path.join(__dirname, "..", "logo-on-navy.png"));
const row = (o) => ({
  empId: o.name, name: o.name, contract: "Permanent", position: "Inspector", phone: "081-111-1111", area: "FTM", mission: "M-101", host: "AAT Rayong",
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
    person({ name: "Anan", leaveKey: "annual", leaveEn: "Annual Leave", leaveTh: "ลาพักร้อน" }),
    person({ name: "Kanya", leaveKey: "sick", leaveEn: "Sick Leave", leaveTh: "ลาป่วย" }),
    person({ name: "Wirat", leaveKey: "exchange", leaveEn: "Exchange Working Day", leaveTh: "สลับวันหยุด", contract: "On-call" }),
  ],
  standby: [person({ name: "Suda" }), person({ name: "Niran" })],
  oncall: [person({ name: "Tawan", contract: "On-call" })],
};
const headerOf = (ws) => { const out = []; ws.getRow(6).eachCell((c) => out.push(c.value)); return out; };

test("all columns come out in the agreed order", async () => {
  const { ws } = await roundTrip({ columns: X.ALL_KEYS });
  assert.deepEqual(headerOf(ws), ["Name", "TRIGO ID", "Contract Type", "Position", "Mobile Number", "Start Date", "Years of Service", "Service Area", "Mission", "Host", "Customer", "PPE", "Shift", "Start", "End", "Engineer", "Remark"]);
});

test("ticked columns only, always in sheet order whatever order they were passed in", async () => {
  const { ws } = await roundTrip({ columns: ["remark", "name", "engineer", "mission"] });
  assert.deepEqual(headerOf(ws), ["Name", "TRIGO ID", "Mission", "Engineer", "Remark"]);
  assert.equal(ws.getCell(7, 1).value, "Somchai");
  assert.equal(ws.getCell(7, 3).value, "M-101");
});

test("dropping Shift, Start and End leaves a sheet with no gaps", async () => {
  const keys = X.ALL_KEYS.filter((k) => !["shift", "start", "end"].includes(k));
  const { ws } = await roundTrip({ columns: keys });
  assert.equal(headerOf(ws).length, 14);
  assert.ok(!headerOf(ws).includes("Shift"));
  assert.equal(ws.getCell(7, 13).value, "K. Wichai");   // Engineer moved up
});

test("banner carries board, date and the total number of employees", async () => {
  const { ws } = await roundTrip({ columns: X.ALL_KEYS });
  const texts = [];
  ws.eachRow((r, n) => { if (n <= 3) r.eachCell((c) => texts.push(String(c.value))); });
  assert.ok(texts.includes("Manpower Board"));
  assert.ok(texts.includes("OPERATIONS PLANNING"));
  assert.ok(texts.includes("LCB Port"));
  assert.ok(texts.some((t) => t.includes("Thu 01-Oct-2026") && !t.includes("พฤหัสบดี")), "English file: English date only");
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
  assert.deepEqual(headerOf(ws), ["Name", "TRIGO ID", "Shift"]);
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
  assert.deepEqual(headerOf(ws), ["Name", "TRIGO ID", "Contract Type", "Position", "Mobile Number", "Start Date", "Years of Service", "Service Area", "Leave Type"]);
  assert.equal(ws.getCell(7, 1).value, "Anan");
  assert.equal(ws.getCell(7, 9).value, "Annual Leave");
  assert.equal(ws.getCell(7, 5).value, "081-000-0000");
  assert.notEqual(ws.getCell(7, 9).fill.fgColor.argb, ws.getCell(9, 9).fill.fgColor.argb, "exchange reads differently from leave");
  assert.match(footerText(ws, 10), /TOTAL: 3\s+\(Annual Leave 1 · Sick Leave 1 · Exchange Working Day 1\)/);
  assert.ok(bannerTexts(ws).includes("ON LEAVE / EXCHANGE"));
  assert.ok(bannerTexts(ws).includes("LEAVE & EXCHANGE WORKING DAY"));
});

test("standby and on-call sheets list their people with a total", async () => {
  const { sheets } = await roundTripAll({ columns: X.ALL_KEYS, groups: GROUPS });
  assert.deepEqual(headerOf(sheets[2]), ["Name", "TRIGO ID", "Contract Type", "Position", "Mobile Number", "Start Date", "Years of Service", "Service Area"]);
  assert.deepEqual([7, 8].map((r) => sheets[2].getCell(r, 1).value), ["Suda", "Niran"]);
  assert.equal(footerText(sheets[2], 9).trim(), "TOTAL: 2");
  assert.equal(sheets[3].getCell(7, 1).value, "Tawan");
  assert.ok(bannerTexts(sheets[3]).includes("AVAILABLE ON-CALL"));
});

test("the extra sheets follow the picked columns, but always keep Name and TRIGO ID", async () => {
  const { sheets } = await roundTripAll({ columns: ["mission", "host"], groups: GROUPS });
  assert.deepEqual(headerOf(sheets[0]), ["TRIGO ID", "Mission", "Host"]);
  assert.deepEqual(headerOf(sheets[1]), ["Name", "TRIGO ID", "Leave Type"]);
  assert.deepEqual(headerOf(sheets[2]), ["Name", "TRIGO ID"]);
  const some = await roundTripAll({ columns: ["name", "position"], groups: GROUPS });
  assert.deepEqual(headerOf(some.sheets[2]), ["Name", "TRIGO ID", "Position"]);
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

test("TRIGO ID is on every sheet right after Name, filled in or blank, and never a picker column", async () => {
  assert.ok(!X.ALL_KEYS.includes("trigoId"), "not offered in the column picker");
  const rows = [row({ name: "Somchai", trigoId: "T329" }), row({ name: "Pichai" })];
  const groups = { leave: [], standby: [person({ name: "Anan", trigoId: "T9" })], oncall: [] };
  const { sheets } = await roundTripAll({ columns: X.ALL_KEYS, rows, groups });
  assert.equal(headerOf(sheets[0])[1], "TRIGO ID");
  assert.equal(sheets[0].getCell(7, 2).value, "T329");
  assert.equal(sheets[0].getCell(8, 2).value, "", "no ID yet: blank, not a dash");
  assert.equal(sheets[1].getCell(7, 2).value, "T9");
});

test("Mobile Number is a picker column: shown on every sheet when ticked, on none when not", async () => {
  const withPhone = await roundTripAll({ columns: ["name", "phone"], groups: GROUPS });
  assert.deepEqual(withPhone.sheets.map(headerOf), [["Name", "TRIGO ID", "Mobile Number"], ["Name", "TRIGO ID", "Mobile Number", "Leave Type"], ["Name", "TRIGO ID", "Mobile Number"], ["Name", "TRIGO ID", "Mobile Number"]]);
  assert.equal(withPhone.sheets[0].getCell(7, 3).value, "081-111-1111");
  const without = await roundTripAll({ columns: X.ALL_KEYS.filter((k) => k !== "phone"), groups: GROUPS });
  for (const ws of without.sheets) assert.ok(!headerOf(ws).includes("Mobile Number"), ws.name);
  // a number with a leading zero stays text, not a number Excel would strip
  const lead = await roundTrip({ columns: ["name", "phone"], rows: [row({ name: "Z", phone: "0812345678" })] });
  assert.equal(lead.ws.getCell(7, 3).value, "0812345678");
});

test("serviceLength counts whole calendar years, months and days up to today", () => {
  const f = X.serviceLength;
  assert.equal(f("2023-04-20", "2026-10-02"), "3 years 5 months 12 days");
  assert.equal(f("2026-09-23", "2026-10-02"), "0 years 0 months 9 days");
  assert.equal(f("2026-10-02", "2026-10-02"), "0 years 0 months 0 days", "first day");
  assert.equal(f("2025-10-02", "2026-11-03"), "1 year 1 month 1 day", "singular for exactly 1");
  assert.equal(f("2024-02-29", "2026-02-28"), "1 year 11 months 30 days", "leap-day start");
  assert.equal(f("2026-01-31", "2026-03-01"), "0 years 1 month 1 day", "31st start, short month: never negative");
  assert.equal(f("2025-12-31", "2026-02-28"), "0 years 1 month 28 days");
  assert.equal(f("2020-03-15", "2026-03-15"), "6 years 0 months 0 days", "exact anniversary");
  assert.equal(f("2026-10-03", "2026-10-02"), "", "start date in the future");
  for (const bad of ["", null, undefined, "2026-02-30", "20/04/2023", "garbage"]) assert.equal(f(bad, "2026-10-02"), "", String(bad));
  assert.equal(f("2023-04-20", undefined), "", "no today given");
});

test("Start Date is a real date cell and Years of Service reads from it, on every sheet; blank without a start date", async () => {
  const rows = [row({ name: "Old", startDate: "2023-04-20" }), row({ name: "New", startDate: "2026-09-23" }), row({ name: "None" }), row({ name: "Bad", startDate: "soon" })];
  const groups = { standby: [person({ name: "Suda", startDate: "2024-03-05" }), person({ name: "Niran" })] };
  const { sheets } = await roundTripAll({ columns: ["name", "startDate", "service"], rows, groups, today: "2026-10-02" });
  assert.deepEqual(sheets.map(headerOf), [["Name", "TRIGO ID", "Start Date", "Years of Service"], ["Name", "TRIGO ID", "Start Date", "Years of Service"]]);
  const [main, standby] = sheets;
  assert.ok(main.getCell(7, 3).value instanceof Date);
  assert.equal(main.getCell(7, 3).value.toISOString().slice(0, 10), "2023-04-20", "no time-zone shift");
  assert.equal(main.getCell(7, 3).numFmt, "dd-mmm-yyyy");
  assert.equal(main.getCell(7, 4).value, "3 years 5 months 12 days");
  assert.equal(main.getCell(8, 4).value, "0 years 0 months 9 days");
  for (const r of [9, 10]) { assert.equal(main.getCell(r, 3).value, "", "no start date"); assert.equal(main.getCell(r, 4).value, ""); }
  assert.equal(standby.getCell(7, 4).value, "2 years 6 months 27 days");
  assert.equal(standby.getCell(8, 4).value, "");
  const without = await roundTripAll({ columns: X.ALL_KEYS.filter((k) => k !== "startDate" && k !== "service"), rows, groups, today: "2026-10-02" });
  for (const ws of without.sheets) assert.ok(!headerOf(ws).some((h) => h === "Start Date" || h === "Years of Service"), ws.name);
});

/* ---------- language: English / Thai ---------- */
const THAI_HEAD = ["ชื่อ", "รหัส TRIGO", "ประเภทสัญญา", "ตำแหน่ง", "เบอร์มือถือ", "วันที่เริ่มงาน", "อายุงาน", "พื้นที่บริการ", "ภารกิจ", "โฮสต์", "ลูกค้า", "PPE", "กะ", "เริ่ม", "สิ้นสุด", "วิศวกร", "หมายเหตุ"];

test("serviceLength speaks Thai on request, and parts are exposed for filtering", () => {
  assert.equal(X.serviceLength("2023-04-20", "2026-10-02", "th"), "3 ปี 5 เดือน 12 วัน");
  assert.equal(X.serviceLength("2023-04-20", "2026-10-02", "en"), "3 years 5 months 12 days");
  assert.equal(X.serviceLength("2023-04-20", "2026-10-02", "fr"), "3 years 5 months 12 days", "unknown language = English");
  assert.equal(X.serviceLength("", "2026-10-02", "th"), "");
  assert.deepEqual(X.serviceParts("2023-04-20", "2026-10-02"), { years: 3, months: 5, days: 12 });
  assert.equal(X.serviceParts("2026-10-03", "2026-10-02"), null);
});

test("a Thai board file: Thai headers, values, banner, footer and sheet names — data stays as typed", async () => {
  const rows = [row({ name: "สมชาย", startDate: "2023-04-20" }), row({ name: "Pichai", contract: "On-call", position: "Team Leader", shift: "Night" })];
  const { sheets, summary } = await roundTripAll({ lang: "th", columns: X.ALL_KEYS, rows, groups: GROUPS, today: "2026-10-02" });
  assert.deepEqual(sheets.map((w) => w.name), ["LCB Port", "ลาและสลับวันหยุด", "สแตนด์บาย", "ออนคอลที่ว่าง"]);
  const ws = sheets[0];
  assert.deepEqual(headerOf(ws), THAI_HEAD);
  assert.equal(ws.getCell(7, 1).value, "สมชาย");
  assert.equal(ws.getCell(7, 3).value, "ประจำ");
  assert.equal(ws.getCell(8, 3).value, "ออนคอล");
  assert.equal(ws.getCell(7, 4).value, "ผู้ตรวจสอบ");
  assert.equal(ws.getCell(8, 4).value, "หัวหน้าทีม");
  assert.equal(ws.getCell(7, 7).value, "3 ปี 5 เดือน 12 วัน");
  assert.equal(ws.getCell(7, 8).value, "FTM", "service area is the user's own data");
  assert.equal(ws.getCell(7, 9).value, "M-101");
  assert.equal(ws.getCell(7, 10).value, "AAT Rayong");
  assert.equal(ws.getCell(7, 13).value, "กลางวัน");
  assert.equal(ws.getCell(8, 13).value, "กลางคืน");
  const banner = bannerTexts(ws);
  assert.ok(banner.includes("บอร์ดกำลังคน") && banner.includes("การวางแผนปฏิบัติการ") && banner.includes("พนักงานทั้งหมด"));
  assert.ok(banner.some((t) => t.includes("พฤหัสบดี") && !t.includes("Thu")), "Thai file: Thai date only");
  assert.equal(footerText(ws, 9).trim(), "พนักงานทั้งหมด: 2   (ประจำ 1 · ออนคอล 1)");
  const leave = sheets[1];
  assert.equal(headerOf(leave).at(-1), "ประเภทการลา");
  assert.equal(leave.getCell(7, 9).value, "ลาพักร้อน");
  assert.match(footerText(leave, 10), /^รวม: 3\s+\(ลาพักร้อน 1 · ลาป่วย 1 · สลับวันหยุด 1\)/);
  assert.ok(bannerTexts(sheets[2]).includes("สแตนด์บาย"));
  assert.equal(summary.groups.leave.types[0].label, "ลาพักร้อน");
});

test("English stays the default and an unknown language falls back to it", async () => {
  for (const lang of [undefined, "en", "xx"]) {
    const { ws } = await roundTrip({ lang, columns: ["name", "contract", "shift"] });
    assert.deepEqual(headerOf(ws), ["Name", "TRIGO ID", "Contract Type", "Shift"]);
    assert.equal(ws.getCell(7, 3).value, "Permanent");
  }
});

/* ---------- Manpower List sheet ---------- */
const LIST_ROWS = [
  { name: "สมชาย ใจดี", trigoId: "T329", contract: "Permanent", position: "Inspector", phone: "0812345678", startDate: "2023-04-20", area: "FTM", board: "LCB Port", util: 42, active: true },
  { name: "Pichai", trigoId: "", contract: "On-call", position: "", phone: "", startDate: "", area: "LCB", board: "LCB Port", util: null, active: false },
  { name: "Malee", trigoId: "", contract: "Permanent", position: "Team Leader", phone: "", startDate: "2026-09-23", area: "", board: "", util: undefined, active: true },
];
async function listRoundTrip(opts) {
  const { workbook, summary } = await X.buildListWorkbook(ExcelJS, { rows: LIST_ROWS, today: "2026-10-02", ...opts });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await workbook.xlsx.writeBuffer());
  return { wb, ws: wb.worksheets[0], summary };
}
const rowOf = (ws, n) => { const o = []; for (let c = 1; c <= X.LIST_COLUMNS.length; c++) o.push(ws.getCell(n, c).value); return o; };

test("Manpower List sheet: plain table from row 1 — no banner, no logo — in the board's navy/green design", async () => {
  const { ws, summary } = await listRoundTrip({});
  assert.equal(ws.name, "Manpower List");
  assert.deepEqual(rowOf(ws, 1), ["Name", "TRIGO ID", "Contract Type", "Position", "Mobile Number", "Start Date", "Years of Service", "Service Area", "Current Board", "30D Utilization", "Status"]);
  assert.equal(ws.getImages().length, 0, "no logo");
  assert.equal(Object.keys(ws._merges).length, 1, "only the total row label is merged");
  assert.equal(ws.getCell(1, 1).fill.fgColor.argb, "FF004983", "TRIGO navy header");
  assert.equal(ws.getCell(1, 1).border.bottom.color.argb, "FFA8C855", "TRIGO green rule");
  assert.equal(ws.getCell(1, 1).font.color.argb, "FFFFFFFF");
  assert.equal(ws.views[0].ySplit, 1, "header frozen");
  assert.equal(ws.autoFilter, "A1:K4", "filter over the header and the people, not the total row");
  assert.equal(ws.getCell(3, 1).fill.fgColor.argb, "FFF2F5F8", "alternate rows tinted like the board");
  assert.equal(summary.total, 3);
});

test("Manpower List sheet: values", async () => {
  const { ws } = await listRoundTrip({});
  const r2 = rowOf(ws, 2);
  assert.equal(r2[0], "สมชาย ใจดี");
  assert.equal(r2[1], "T329");
  assert.equal(r2[4], "0812345678", "phone stays text");
  assert.ok(r2[5] instanceof Date && r2[5].toISOString().slice(0, 10) === "2023-04-20");
  assert.equal(r2[6], "3 years 5 months 12 days");
  assert.equal(r2[9], 0.42);
  assert.equal(ws.getCell(2, 10).numFmt, "0%");
  assert.equal(r2[10], "Active");
  const r3 = rowOf(ws, 3);
  assert.deepEqual([r3[1], r3[5], r3[6], r3[9], r3[10]], ["", "", "", "", "Inactive"]);
  assert.equal(rowOf(ws, 4)[9], "", "utilization still loading = blank");
  const total = ws.getCell(5, 1).value.richText.map((x) => x.text).join("");
  assert.equal(total.trim(), "TOTAL EMPLOYEES: 3   (Permanent 2 · On-call 1)");
});

test("Manpower List sheet in Thai", async () => {
  const { ws } = await listRoundTrip({ lang: "th" });
  assert.equal(ws.name, "รายชื่อพนักงาน");
  assert.deepEqual(rowOf(ws, 1), ["ชื่อ", "รหัส TRIGO", "ประเภทสัญญา", "ตำแหน่ง", "เบอร์มือถือ", "วันที่เริ่มงาน", "อายุงาน", "พื้นที่บริการ", "บอร์ดปัจจุบัน", "การใช้งาน 30 วัน", "สถานะ"]);
  const r2 = rowOf(ws, 2), r3 = rowOf(ws, 3);
  assert.deepEqual([r2[2], r2[3], r2[6], r2[10]], ["ประจำ", "ผู้ตรวจสอบ", "3 ปี 5 เดือน 12 วัน", "ใช้งาน"]);
  assert.deepEqual([r3[2], r3[10]], ["ออนคอล", "ไม่ใช้งาน"]);
  assert.equal(r2[7], "FTM");
  assert.equal(ws.getCell(5, 1).value.richText.map((x) => x.text).join("").trim(), "พนักงานทั้งหมด: 3   (ประจำ 2 · ออนคอล 1)");
});

test("Manpower List sheet with nobody in it is just the header and a zero total", async () => {
  const { ws } = await listRoundTrip({ rows: [] });
  assert.equal(rowOf(ws, 1)[0], "Name");
  assert.equal(ws.getCell(2, 1).value.richText[0].text, "TOTAL EMPLOYEES: 0");
  assert.equal(ws.autoFilter, undefined);
});

/* ---------- generic table sheet (Host List, Users) ---------- */
test("table sheet: header on row 1 in the list design, values as text (never formulas), filter and total", async () => {
  const { workbook, summary } = await X.buildTableWorkbook(ExcelJS, {
    sheetName: "Host List",
    columns: [{ label: "Host name", width: 30 }, { label: "Missions", width: 10, center: true }, { label: "Note", width: 20 }],
    rows: [["AAT Rayong", 12, "=HYPERLINK(\"x\")"], ["Fortune Co", 0, ""]],
    totalText: "TOTAL HOSTS: 2",
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await workbook.xlsx.writeBuffer());
  const ws = wb.worksheets[0];
  assert.equal(summary.total, 2);
  assert.equal(ws.name, "Host List");
  assert.deepEqual([1, 2, 3].map((c) => ws.getCell(1, c).value), ["Host name", "Missions", "Note"]);
  assert.equal(ws.getCell(1, 1).fill.fgColor.argb, "FF004983");
  assert.equal(ws.views[0].ySplit, 1);
  assert.equal(ws.getCell(2, 2).value, 12, "numbers stay numbers");
  assert.equal(ws.getCell(2, 3).value, '=HYPERLINK("x")', "text starting with = is kept as plain text");
  assert.equal(typeof ws.getCell(2, 3).value, "string");
  assert.equal(ws.autoFilter, "A1:C3");
  assert.equal(ws.getCell(4, 1).value.richText.map((x) => x.text).join("").trim(), "TOTAL HOSTS: 2");
});
