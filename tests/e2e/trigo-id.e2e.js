/* Acceptance run for the TRIGO ID: its own field on the Edit Employee form (full
   name only in the Name field), the per-user choice to show it on employee cards,
   the Manpower List column / search / sort, and the Excel exports that replaced
   every CSV export.
     NODE_PATH=$(npm root -g) node tests/e2e/trigo-id.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const h = require("./harness");
const ExcelJS = require("../../vendor/exceljs.min.js");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tid-"));

(async () => {
  const env = await h.launch();
  try {
    const T = h.iso(new Date());
    const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    db.t("employees").find((e) => e.id === "e1").trigo_id = "T101";
    db.t("employees").find((e) => e.id === "e2").trigo_id = "T9";
    db.t("employees").find((e) => e.id === "e3").trigo_id = "T20";
    db.seed("employees", [{ id: "short1", name_th: "Pichai", contract: "permanent", area_id: "area-1", board_id: "b1" }]);   // saved before the full-name rule
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    await p.evaluate((d) => { state.date = d; D().activeBoardId = "b1"; return cloud._loadEmployees().then(refreshAndRender); }, SRC);

    // ---- no CSV anywhere ----
    for (const id of ["btn-emplist-csv", "btn-hostlist-csv", "btn-users-csv", "btn-bulk-dl-csv"]) assert.equal(await p.locator("#" + id).count(), 0, id);
    console.log("ok - no CSV export buttons are left");

    // ---- the card always shows the ID ----
    assert.equal(await p.locator("#btn-trigo-id").count(), 0, "no show/hide button");
    const chips = await p.locator(".emp-card .emp-tid").allTextContents();
    assert.ok(chips.includes("T101") && chips.includes("T9") && chips.includes("T20"));
    assert.equal(await p.locator('.emp-card[data-emp-id="e4"] .emp-tid').count(), 0, "no chip for someone with no ID");
    const title = await p.locator('.emp-card[data-emp-id="e1"]').first().getAttribute("title");
    assert.match(title, /Person A \(T101\)/, "the ID is in the hover title too");
    console.log("ok - every card shows its TRIGO ID, with no button to hide it");

    // ---- the form: full name only, ID in its own field ----
    const toasts = () => p.locator("#toast-stack .toast-msg").allTextContents();
    const fill = async (name, tid) => {
      await p.evaluate(() => openEmployeeModal(null));
      await p.fill("#form-employee input[name=name]", name);
      await p.fill("#form-employee input[name=trigoId]", tid);
      await h.submitEmployeeForm(p);
    };
    await fill("Somchai", "");
    await p.waitForFunction(() => /full name/.test(document.querySelector("#toast-stack").textContent));
    await p.evaluate(() => closeModal());
    await fill("Somchai Newname T999", "");
    await p.waitForFunction(() => /own field/.test(document.querySelector("#toast-stack").textContent));
    await p.evaluate(() => closeModal());
    await fill("Somchai Newname", "329");
    await p.waitForFunction(() => /letter T and digits/.test(document.querySelector("#toast-stack").textContent));
    await p.evaluate(() => closeModal());
    await fill("Somchai Newname", "t101");
    await p.waitForFunction(() => /T101 already belongs to Person A/.test(document.querySelector("#toast-stack").textContent));
    await p.evaluate(() => closeModal());
    assert.equal(db.t("employees").some((e) => e.name_th.startsWith("Somchai")), false, "nothing was saved");
    console.log("ok - a short name, an ID in the name, a malformed ID and a taken ID are all refused");

    await fill("Somchai Newname", " t-777 ");
    await p.waitForSelector("#modal-employee", { state: "hidden" });
    const created = db.t("employees").find((e) => e.name_th === "Somchai Newname");
    assert.equal(created.trigo_id, "T777", "tidied to T777");
    await fill("Somchai Newname", "");
    await p.waitForFunction(() => /already exists/.test(document.querySelector("#toast-stack").textContent));
    await p.evaluate(() => closeModal());
    await fill("somchai newname", "T778");
    await p.waitForSelector("#modal-employee", { state: "hidden" });
    assert.equal(db.t("employees").filter((e) => e.name_th.toLowerCase() === "somchai newname").length, 2, "namesakes are fine once both have a TRIGO ID");
    console.log("ok - the ID is saved tidied, and namesakes need a TRIGO ID each");

    // a short name saved earlier can still be edited, but not renamed to another short name
    await p.evaluate(() => { openEmployeeModal("short1"); state.employeeTab = "edit"; applyEmployeeTab(); });
    await p.fill("#form-employee input[name=phone]", "081-222-2222");
    await p.fill("#form-employee input[name=trigoId]", "T555");
    await h.submitEmployeeForm(p);
    await p.waitForSelector("#modal-employee", { state: "hidden" });
    const short = db.t("employees").find((e) => e.id === "short1");
    assert.deepEqual([short.name_th, short.phone, short.trigo_id], ["Pichai", "081-222-2222", "T555"]);
    await p.evaluate(() => { openEmployeeModal("short1"); state.employeeTab = "edit"; applyEmployeeTab(); });
    await p.fill("#form-employee input[name=name]", "Pichai2");
    await h.submitEmployeeForm(p);
    await p.waitForFunction(() => /full name/.test(document.querySelector("#toast-stack").textContent));
    await p.evaluate(() => closeModal());
    console.log("ok - an existing short name is grandfathered until someone changes it");

    // ---- Manpower List ----
    await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
    const heads = await p.locator("#emplist-table thead th").allTextContents();
    assert.equal(heads[2], "TRIGO ID");
    const col = () => p.locator("#emplist-body td.el-tid").allTextContents();
    await p.fill("#emplist-search", "t101");
    assert.deepEqual((await p.locator("#emplist-body td[data-label=Name]").allTextContents()), ["Person A"], "search finds the TRIGO ID");
    await p.fill("#emplist-search", "");
    await p.click('#emplist-table th[data-sort="trigoId"]');
    const sorted = (await col()).filter((x) => x !== "—");
    assert.deepEqual(sorted.slice(0, 3), ["T9", "T20", "T101"], "T9 sorts before T20 before T101");
    console.log("ok - the Manpower List has a TRIGO ID column that searches and sorts numerically");

    // ---- Excel exports replace CSV ----
    await p.evaluate(() => { D().activeBoardId = HOSTLIST_ID; return refreshAndRender(); });
    await p.waitForFunction(() => allHostRows().length >= 2);
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-hostlist-xlsx")]);
    assert.match(dl.suggestedFilename(), /^host_list_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const hp = path.join(TMP, "hosts.xlsx");
    await dl.saveAs(hp);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fs.readFileSync(hp));
    const ws = wb.worksheets[0];
    assert.equal(ws.name, "Host List");
    assert.deepEqual([1, 2, 3, 4].map((c) => ws.getCell(1, c).value), ["Host name", "Status", "Location", "Google Maps link"]);
    assert.ok(["Host Alpha", "Host Beta", "Host Gamma"].includes(ws.getCell(2, 1).value));
    console.log("ok - the Host List exports to Excel");

    // the Users list (an admin screen) exports the same way; feed it rows directly
    await p.evaluate(() => { D().users = [{ email: "somchai.p@example.com", fullName: "Somchai Pol", displayName: "Somchai.P", roleKey: "engineer", status: "active", lastSeenAt: "", requestedAt: "", approvedAt: "", approvedBy: "" }]; });
    const [dlu] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => exportUsersXlsx())]);
    assert.match(dlu.suggestedFilename(), /^users_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const up = path.join(TMP, "users.xlsx");
    await dlu.saveAs(up);
    const wbu = new ExcelJS.Workbook();
    await wbu.xlsx.load(fs.readFileSync(up));
    assert.deepEqual([1, 3].map((c) => wbu.worksheets[0].getCell(1, c).value), ["Name", "Email"]);
    assert.equal(wbu.worksheets[0].getCell(2, 3).value, "somchai.p@example.com");
    console.log("ok - the Users list exports to Excel");

    // ---- the Excel list carries the ID ----
    await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
    await p.click("#btn-emplist-xlsx");
    await p.waitForSelector("#modal-emplist-xlsx:not(.hidden)");
    const [dl2] = await Promise.all([p.waitForEvent("download"), p.click("#btn-emplist-xlsx-go")]);
    const lp = path.join(TMP, "list.xlsx");
    await dl2.saveAs(lp);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(fs.readFileSync(lp));
    const ws2 = wb2.worksheets[0];
    assert.deepEqual([1, 2, 3].map((c) => ws2.getCell(1, c).value), ["Thai Name", "English Name", "TRIGO ID"]);
    const idsInSheet = []; for (let r = 2; r < ws2.rowCount; r++) idsInSheet.push(ws2.getCell(r, 3).value);
    assert.ok(idsInSheet.includes("T101") && idsInSheet.includes("T777"));
    console.log("ok - the Manpower List Excel has a TRIGO ID column");

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all TRIGO ID checks passed");
  } finally {
    await env.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
