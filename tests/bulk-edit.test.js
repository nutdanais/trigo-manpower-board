// node --test tests/*.test.js
// Bulk edit by file: template -> spreadsheet -> plan. Pure logic, no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("../vendor/exceljs.min.js");
const B = require("../bulk-edit.js");
const { parseCsv } = require("./helpers/csv");

const POSITIONS = {
  inspector: { label: "Inspector", short: "Ins" },
  senior_inspector: { label: "Senior Inspector", short: "SI" },
  technician: { label: "Technician", short: "Tec" },
};
const AREAS = [{ id: "a1", name: "ESIE1" }, { id: "a2", name: "FTM" }, { id: "a3", name: "LCB" }];
const BOARDS = [{ id: "b1", name: "LCB Port" }, { id: "b2", name: "Rayong" }];
const EMPS = [
  { id: "11111111-1111-1111-1111-111111111111", name: "สมชาย ใจดี", contract: "permanent", position: "inspector", phone: "081-111-1111", startDate: "2023-04-20", addedOn: "2026-10-01", areaId: "a1", boardId: "b1", active: true },
  { id: "22222222-2222-2222-2222-222222222222", name: "Malee Sukjai", contract: "oncall", position: "", phone: "", startDate: "", addedOn: "", areaId: "a2", boardId: "b1", active: true },
  { id: "33333333-3333-3333-3333-333333333333", name: "Old Timer", contract: "permanent", position: "technician", phone: "0899999999", startDate: "2019-01-02", addedOn: "", areaId: null, boardId: "b2", active: false },
];
const ctx = () => ({ employees: EMPS.map((e) => ({ ...e })), areas: AREAS, boards: BOARDS, positions: POSITIONS });
const HEAD = "ID,Name,Contract type,Position,Mobile number,Start date,On the board from,Service area,Board,Status";
const plan = (csv, c = ctx()) => B.planEmployees(B.readTable(parseCsv(csv), B.EMP_COLUMNS), c);

test("round trip: the Excel template read straight back changes nothing", async () => {
  const wb = await B.buildTemplateWorkbook(ExcelJS, "employees", ctx());
  const buf = await wb.xlsx.writeBuffer();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf);
  assert.deepEqual(wb2.worksheets.map((s) => s.name), ["Employees", "Lists", "Read me"]);
  const p = B.planEmployees(B.readTable(B.rowsFromWorkbook(wb2, "employees"), B.EMP_COLUMNS), ctx());
  assert.deepEqual(p.fatal, []);
  assert.equal(p.counts.total, 3, "the 300 blank validated rows are not counted as data");
  assert.deepEqual(p.rows.map((r) => r.kind), ["same", "same", "same"]);
  assert.deepEqual(p.rows.map((r) => r.errors), [[], [], []]);
});

test("editing cells in the Excel template is picked up (dates, text phone, dropdown values)", async () => {
  const wb = await B.buildTemplateWorkbook(ExcelJS, "employees", ctx());
  const ws = wb.getWorksheet("Employees");
  ws.getCell("G3").value = 812345678;                                // Excel ate the leading zero
  ws.getCell("H3").value = new Date(Date.UTC(2024, 1, 29));          // a real date cell
  ws.getCell("K2").value = "Rayong";
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(await wb.xlsx.writeBuffer());
  const p = B.planEmployees(B.readTable(B.rowsFromWorkbook(wb2, "employees"), B.EMP_COLUMNS), ctx());
  assert.equal(p.rows[0].patch.boardId, "b2");
  assert.equal(p.rows[1].patch.phone, "0812345678");
  assert.ok(p.rows[1].warnings.some((w) => /leading 0/.test(w)));
  assert.equal(p.rows[1].patch.startDate, "2024-02-29");
});

test("matches by ID first, so a rename updates the person instead of adding a duplicate", () => {
  const p = plan(`${HEAD}\n${EMPS[0].id},สมชาย ใจเย็น,Permanent,Inspector,081-111-1111,2023-04-20,2026-10-01,ESIE1,LCB Port,Active`);
  assert.equal(p.rows[0].kind, "update");
  assert.deepEqual(p.rows[0].patch, { name: "สมชาย ใจเย็น" });
  assert.deepEqual(p.rows[0].changes, [{ field: "name", label: "Thai name", from: "สมชาย ใจดี", to: "สมชาย ใจเย็น" }]);
});

test("without an ID column it matches by name (the app's own CSV works as it is)", () => {
  const p = plan("Name,Contract type,Position,Mobile number,Start date,Years of service,Service area,Current board,30D utilization,Status\n" +
    "Malee Sukjai,On-call,Senior Inspector,,,3 years,FTM,Rayong,12,Active");
  assert.deepEqual(p.ignored.sort(), ["30D utilization", "Years of service"]);
  assert.equal(p.rows[0].kind, "update");
  assert.deepEqual(p.rows[0].patch, { position: "senior_inspector", boardId: "b2" });
  assert.equal(p.counts.moves, 1);
});

test("a column that is absent is untouched; a present blank cell clears an optional field", () => {
  const p = plan(`ID,Name,Mobile number,Position\n${EMPS[0].id},สมชาย ใจดี,,`);
  assert.deepEqual(p.rows[0].patch, { phone: "", position: "" });
  assert.equal(p.counts.clears, 2);
  assert.equal(p.rows[0].patch.startDate, undefined);
});

test("Thai values, Thai headers, Buddhist-era and day-first dates", () => {
  const p = plan("ชื่อ,ประเภทสัญญา,วันที่เริ่มงาน,สถานะ\nMalee Sukjai,ประจำ,20/04/2566,ไม่ใช้งาน");
  assert.deepEqual(p.rows[0].patch, { contract: "permanent", startDate: "2023-04-20", active: false });
  assert.ok(p.rows[0].warnings.some((w) => /Buddhist/.test(w)));
  assert.equal(p.counts.deactivate, 1);
  assert.equal(B.parseDate("20-Apr-2023").value, "2023-04-20");
  assert.equal(B.parseDate("31/02/2023").error !== undefined, true);
  assert.equal(B.parseDate("2023-13-01").error !== undefined, true);
});

test("a blank Status never deactivates or reactivates anyone", () => {
  const p = plan(`ID,Name,Status\n${EMPS[2].id},Old Timer,`);
  assert.equal(p.rows[0].kind, "same");
});

test("errors name the row and the reason, and good rows still plan", () => {
  const p = plan(`${HEAD}\n` +
    `${EMPS[0].id},สมชาย ใจดี,Sometimes,,,,,ESIE1,LCB Port,Active\n` +                 // bad contract
    `${EMPS[1].id},Malee Sukjai,On-call,Wizard,,,,FTM,LCB Port,Active\n` +             // bad position
    `${EMPS[2].id},Old Timer,Permanent,Technician,,,,Nowhere,LCB Port,Inactive\n` +   // bad area
    `99999999-0000-0000-0000-000000000000,Ghost,Permanent,,,,,FTM,LCB Port,Active\n` + // unknown ID
    `,Fine Person,On-call,,,,,FTM,Rayong,Active`);                                      // fine: new
  assert.deepEqual(p.rows.map((r) => r.kind), ["error", "error", "error", "error", "create"]);
  assert.match(p.rows[0].errors[0], /Permanent or On-call/);
  assert.match(p.rows[1].errors[0], /Position "Wizard"/);
  assert.match(p.rows[2].errors[0], /Service area "Nowhere"/);
  assert.match(p.rows[3].errors[0], /ID not found/);
  assert.equal(p.rows[4].create.boardId, "b2");
  assert.equal(p.rows[4].create.addedOn, "", "blank = the database default (today)");
  assert.equal(p.rows[0].rowNumber, 2);
});

test("a new person needs a contract and a board", () => {
  const p = plan("Name,Position\nBrand New,Inspector");
  assert.equal(p.rows[0].kind, "error");
  assert.match(p.rows[0].errors.join(" "), /Contract type/);
});

test("duplicates: same ID twice, same name twice, a clash with someone else, but a swap is fine", () => {
  const dupId = plan(`ID,Name\n${EMPS[0].id},Anan Aaa\n${EMPS[0].id},Bobby Bbb`);
  assert.deepEqual(dupId.rows.map((r) => r.kind), ["update", "error"]);
  assert.match(dupId.rows[1].errors[0], /row 2/);

  const dupNew = plan("Name,Contract type,Board\nTwin Peaks,Permanent,LCB Port\nTWIN PEAKS,Permanent,LCB Port");
  assert.deepEqual(dupNew.rows.map((r) => r.kind), ["error", "error"], "neither of two identical new names is guessed to be the right one");

  const clash = plan(`ID,Name\n${EMPS[0].id},malee sukjai`);
  assert.equal(clash.rows[0].kind, "error");
  assert.match(clash.rows[0].errors[0], /shared with another employee/);

  const swap = plan(`ID,Name\n${EMPS[0].id},Malee Sukjai\n${EMPS[1].id},สมชาย ใจดี`);
  assert.deepEqual(swap.rows.map((r) => r.kind), ["update", "update"]);
});

test("two existing people with one name need the ID to tell them apart", () => {
  const c = ctx(); c.employees.push({ ...EMPS[1], id: "44444444-4444-4444-4444-444444444444" });
  const p = plan("Name,Position\nMalee Sukjai,Inspector", c);
  assert.equal(p.rows[0].kind, "error");
  assert.match(p.rows[0].errors[0], /2 existing employees/);
});

test("a service area can't be blanked on someone who has one, but stays blank where there is none", () => {
  const p = plan(`ID,Name,Service area\n${EMPS[0].id},สมชาย ใจดี,\n${EMPS[2].id},Old Timer,`);
  assert.equal(p.rows[0].kind, "error");
  assert.equal(p.rows[1].kind, "same");
});

test("structural problems stop the whole file", () => {
  assert.match(B.planEmployees(B.readTable(parseCsv("foo,bar\n1,2"), B.EMP_COLUMNS), ctx()).fatal[0], /header row/);
  const big = B.readTable([["Name", "Board"], ...Array.from({ length: 6 }, (_, i) => ["P" + i, "LCB Port"])], B.EMP_COLUMNS, { maxRows: 5 });
  assert.match(big.fatal[0], /limit is 5/);
});

test("a banner above the header is skipped and row numbers still match the file", () => {
  const p = plan(`TRIGO export,,\n,,\n${HEAD}\n${EMPS[1].id},Malee Sukjai,On-call,,,,,FTM,LCB Port,Active`);
  assert.equal(p.rows[0].rowNumber, 4);
});

test("hosts: update by name, new hosts are flagged, links are checked, the name is the key", () => {
  const hosts = [
    { name: "Fortune Co", hasRecord: true, location: "Rayong", mapUrl: "", areaId: "a1", archived: false, note: "gate 3" },
    { name: "Plant 7", hasRecord: false, location: "", mapUrl: "", areaId: "", archived: false, note: "" },
  ];
  const hctx = { hosts, areas: AREAS, similarKey: (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "") };
  const csv = "Host name,Status,Location,Google Maps link,Service area,Note\n" +
    "Fortune Co,Archived,Rayong,https://maps.app.goo.gl/x,FTM,\n" +
    "plant 7,Active,Map Ta Phut,,,\n" +
    "Fortune-Co,Active,,,,\n" +
    "Bad Link Ltd,Active,,javascript:alert(1),,\n" +
    "Brand New Host,Active,Bangkok,https://example.com/m,LCB,hello";
  const p = B.planHosts(B.readTable(parseCsv(csv), B.HOST_COLUMNS), hctx);
  assert.deepEqual(p.rows.map((r) => r.kind), ["update", "update", "create", "error", "create"]);
  assert.deepEqual(p.rows[0].patch, { mapUrl: "https://maps.app.goo.gl/x", areaId: "a2", note: "", archived: true });
  assert.equal(p.rows[1].name, "Plant 7");
  assert.ok(p.rows[1].warnings[0].includes("capital letters"));
  assert.ok(p.rows[2].warnings.some((w) => /looks like the existing host "Fortune Co"/.test(w)));
  assert.match(p.rows[3].errors[0], /http/);
  assert.equal(p.rows[4].create.areaId, "a3");
  assert.equal(p.counts.create, 2);
});

test("hosts: round trip through Excel changes nothing", async () => {
  const hosts = [{ name: "Fortune Co", location: "Rayong", mapUrl: "https://x.example/m", areaId: "a1", archived: true, note: "n" }, { name: "Plain", location: "", mapUrl: "", areaId: "", archived: false, note: "" }];
  const c = { hosts, areas: AREAS };
  const wb = await B.buildTemplateWorkbook(ExcelJS, "hosts", c);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(await wb.xlsx.writeBuffer());
  const p = B.planHosts(B.readTable(B.rowsFromWorkbook(wb2, "hosts"), B.HOST_COLUMNS), c);
  assert.deepEqual(p.rows.map((r) => r.kind), ["same", "same"]);
});

test("a blank 'On the board from' leaves the date alone, but a filled one is applied", () => {
  const p = plan(`ID,Name,On the board from\n${EMPS[0].id},สมชาย ใจดี,\n${EMPS[1].id},Malee Sukjai,2026-08-15`);
  assert.deepEqual(p.rows.map((r) => r.kind), ["same", "update"]);
  assert.deepEqual(p.rows[1].patch, { addedOn: "2026-08-15" });
});

test("a Thai mobile that lost its leading 0 (number or text) gets it back; other numbers are left alone", () => {
  assert.deepEqual(B.parsePhone(812345678), { value: "0812345678", warn: "leading 0 restored" });
  assert.deepEqual(B.parsePhone("812345678"), { value: "0812345678", warn: "leading 0 restored" });
  assert.deepEqual(B.parsePhone("081-234-5678"), { value: "081-234-5678", warn: "" });
  assert.deepEqual(B.parsePhone("123456789"), { value: "123456789", warn: "" });
  assert.deepEqual(B.parsePhone(""), { value: "" });
});

/* ---------- TRIGO ID ---------- */
const TEMPS = [
  { id: "t-1", name: "Somchai Jaidee", trigoId: "T329", contract: "permanent", position: "", phone: "", startDate: "", addedOn: "", areaId: "a1", boardId: "b1", active: true },
  { id: "t-2", name: "Somchai Jaidee", trigoId: "T330", contract: "permanent", position: "", phone: "", startDate: "", addedOn: "", areaId: "a1", boardId: "b1", active: true },   // a namesake, told apart by TRIGO ID
  { id: "t-3", name: "Malee Sukjai", trigoId: "", contract: "oncall", position: "", phone: "", startDate: "", addedOn: "", areaId: "a2", boardId: "b1", active: true },
  { id: "t-4", name: "Pichai", trigoId: "", contract: "permanent", position: "", phone: "", startDate: "", addedOn: "", areaId: "a2", boardId: "b1", active: true },   // grandfathered short name
];
const tctx = () => ({ employees: TEMPS.map((e) => ({ ...e })), areas: AREAS, boards: BOARDS, positions: POSITIONS });
const tplan = (csv) => B.planEmployees(B.readTable(parseCsv(csv), B.EMP_COLUMNS), tctx());

test("the template carries ID and TRIGO ID, and reads back unchanged", async () => {
  const c = tctx();
  const wb = await B.buildTemplateWorkbook(ExcelJS, "employees", c);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(await wb.xlsx.writeBuffer());
  const ws = wb2.getWorksheet("Employees");
  assert.deepEqual([1, 2, 3, 4].map((i) => ws.getCell(1, i).value), ["ID", "Thai name", "English name", "TRIGO ID"]);
  assert.equal(ws.getCell(2, 4).value, "T329");
  const p = B.planEmployees(B.readTable(B.rowsFromWorkbook(wb2, "employees"), B.EMP_COLUMNS), c);
  assert.deepEqual(p.rows.map((r) => r.kind), ["same", "same", "same", "same"]);
  assert.equal(p.counts.noTrigoId, 2);
});

test("TRIGO ID identifies a row: rename by TRIGO ID, fill IDs in by name", () => {
  const p = tplan("TRIGO ID,Name\nT329,Somchai Jaidee Junior\nT555,Malee Sukjai");
  assert.deepEqual(p.rows.map((r) => r.kind), ["update", "update"]);
  assert.deepEqual(p.rows[0].patch, { name: "Somchai Jaidee Junior" });
  assert.equal(p.rows[0].id, "t-1");
  assert.deepEqual(p.rows[1].patch, { trigoId: "T555" }, "a person without an ID gets it by name");
  assert.equal(p.rows[1].changes[0].label, "TRIGO ID");
});

test("TRIGO ID: lower case and spacing are tidied; a bad one is refused; blank leaves it alone", () => {
  const ok = tplan("Name,TRIGO ID\nMalee Sukjai,t 777");
  assert.deepEqual(ok.rows[0].patch, { trigoId: "T777" });
  assert.match(tplan("Name,TRIGO ID\nMalee Sukjai,329").rows[0].errors[0], /must be the letter T and digits/);
  assert.equal(tplan("Name,TRIGO ID\nSomchai Jaidee,").rows[0].errors.length, 1, "two Somchais and no ID to tell them apart");
  assert.equal(tplan("ID,Name,TRIGO ID\nt-1,Somchai Jaidee,").rows[0].kind, "same");
});

test("two people with one name need their TRIGO ID; the right one is found by it", () => {
  const p = tplan("Name,TRIGO ID,Position\nSomchai Jaidee,T330,Inspector\nSomchai Jaidee,T329,Technician");
  assert.deepEqual(p.rows.map((r) => [r.kind, r.id]), [["update", "t-2"], ["update", "t-1"]]);
  assert.deepEqual(p.rows.map((r) => r.patch.position), ["inspector", "technician"]);
  const amb = tplan("Name,Position\nSomchai Jaidee,Inspector");
  assert.match(amb.rows[0].errors[0], /fill in their TRIGO ID/);
});

test("a name that already has another TRIGO ID is not silently merged with a same-named newcomer", () => {
  const p = tplan("Name,TRIGO ID\nMalee Sukjai,T700\nSomchai Jaidee,T999");
  assert.equal(p.rows[0].kind, "update");
  assert.equal(p.rows[1].kind, "error");
  assert.match(p.rows[1].errors[0], /ambiguous|fill in their TRIGO ID|2 existing/);
  const clash = tplan("ID,Name,TRIGO ID\nt-3,Malee Sukjai,T329");
  assert.equal(clash.rows[0].kind, "error");
  assert.match(clash.rows[0].errors[0], /TRIGO ID T329 would belong to more than one person/);
  const dupInFile = tplan("Name,TRIGO ID\nMalee Sukjai,T800\nPichai,T800");
  assert.deepEqual(dupInFile.rows.map((r) => r.kind), ["error", "error"]);
  const conflict = tplan("ID,Name,TRIGO ID\nt-1,Somchai Jaidee,T330\n");
  assert.equal(conflict.rows[0].kind, "error");
});

test("new people: full name enforced, namesakes need an ID, the ID is stored", () => {
  const p = tplan("Name,TRIGO ID,Contract type,Board\nNew Person,T901,Permanent,LCB Port\nSolo,T902,Permanent,LCB Port\nMalee Sukjai,,Permanent,LCB Port\nSomchai Jaidee T903,,Permanent,LCB Port");
  assert.deepEqual(p.rows.map((r) => r.kind), ["create", "error", "update", "error"]);
  assert.equal(p.rows[0].create.trigoId, "T901");
  assert.match(p.rows[1].errors[0], /full name/);
  assert.match(p.rows[3].errors[0], /own field/);
  const twin = tplan("Name,TRIGO ID,Contract type,Board\nMalee Sukjai,T910,On-call,LCB Port");
  assert.equal(twin.rows[0].kind, "update", "matched to the existing Malee, who gets T910");
  const newTwin = tplan("Name,TRIGO ID,Contract type,Board\nSomchai Jaidee,T911,Permanent,LCB Port");
  assert.equal(newTwin.rows[0].kind, "error", "two Somchais exist and none has T911");
});

test("a rename must give a full name, but a short name that is left alone only earns a warning", () => {
  const rename = tplan("ID,Name\nt-4,Pichai Sompong\nt-3,Malee");
  assert.equal(rename.rows[0].kind, "update");
  assert.equal(rename.rows[1].kind, "error");
  assert.match(rename.rows[1].errors[0], /full name/);
  const same = tplan("ID,Name,Position\nt-4,Pichai,Inspector");
  assert.equal(same.rows[0].kind, "update");
  assert.ok(same.rows[0].warnings.some((w) => /full name/.test(w)));
  assert.equal(same.counts.shortName, 1);
});

test("the pasted CSV of the old list is still readable (TRIGO ID absent)", () => {
  const p = tplan("Name,Contract type\nMalee Sukjai,Permanent");
  assert.deepEqual(p.rows[0].patch, { contract: "permanent" });
});

test("English name: a column in the template, read back unchanged, set / changed / cleared by a file, and a bare Name header is still the Thai name", async () => {
  const c = ctx(); c.employees[1].nameEn = "Malee Sukjai";
  const wb = await B.buildTemplateWorkbook(ExcelJS, "employees", c);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(await wb.xlsx.writeBuffer());
  const ws = wb2.getWorksheet("Employees");
  assert.equal(ws.getCell(1, 3).value, "English name");
  assert.equal(ws.getCell(3, 3).value, "Malee Sukjai");
  const same = B.planEmployees(B.readTable(B.rowsFromWorkbook(wb2, "employees"), B.EMP_COLUMNS), c);
  assert.deepEqual(same.rows.map((r) => r.kind), ["same", "same", "same"]);

  const head = "ID,Thai name,English name,Contract type,Board";
  const p = B.planEmployees(B.readTable(parseCsv(
    `${head}\n${EMPS[0].id},สมชาย ใจดี,Somchai Jaidee,Permanent,LCB Port\n${EMPS[1].id},Malee Sukjai,,On-call,LCB Port`), B.EMP_COLUMNS), c);
  assert.deepEqual(p.rows[0].patch, { nameEn: "Somchai Jaidee" });
  assert.deepEqual(p.rows[0].changes, [{ field: "nameEn", label: "English name", from: "", to: "Somchai Jaidee" }]);
  assert.deepEqual(p.rows[1].patch, { nameEn: "" }, "an empty cell clears it");

  // "Name (English)" is the English name, never the Thai one; a file without the column leaves it alone
  const t = B.readTable(parseCsv("Name (English),Name (Thai),Contract type\nSomchai,สมชาย ใจดี,Permanent"), B.EMP_COLUMNS);
  assert.deepEqual(t.records[0].cells.nameEn, "Somchai");
  assert.deepEqual(t.records[0].cells.name, "สมชาย ใจดี");
  const none = plan("Name,Contract type\nMalee Sukjai,On-call", c);
  assert.equal(none.rows[0].kind, "same");

  // a new person carries it
  const n = B.planEmployees(B.readTable(parseCsv(`${head}\n,คนใหม่ ทดสอบ,Khon Mai,Permanent,LCB Port`), B.EMP_COLUMNS), c);
  assert.equal(n.rows[0].kind, "create");
  assert.equal(n.rows[0].create.nameEn, "Khon Mai");
});
