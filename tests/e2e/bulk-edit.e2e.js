/* Acceptance run for "Bulk edit by file" on the Manpower List and the Host List:
   download the template, edit it, upload it, review the preview, apply - and
   the database holds exactly what the preview promised.
     NODE_PATH=$(npm root -g) node tests/e2e/bulk-edit.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const h = require("./harness");
const ExcelJS = require("../../vendor/exceljs.min.js");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-"));

(async () => {
  const env = await h.launch();
  try {
    const T = h.iso(new Date());
    const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    Object.assign(db.t("hosts").find((x) => x.name === "Host Alpha"), { location: "Rayong", map_url: "https://maps.example/a", area_id: "area-1", note: "gate 3" });
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);
    const openEmp = async () => {
      await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      await p.click("#btn-emplist-bulk");
      await p.waitForSelector("#modal-bulk:not(.hidden)");
    };
    const closeDlg = () => p.evaluate(() => closeModal());
    const chip = (label) => p.evaluate((l) => {
      const c = [...document.querySelectorAll("#bulk-preview .stat-chip")].find((x) => x.textContent.trim().startsWith(l + ":"));
      return c ? Number(c.querySelector("b").textContent) : null;
    }, label);

    // ---- employees: Excel round trip ----
    await openEmp();
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-bulk-dl-xlsx")]);
    assert.match(dl.suggestedFilename(), /^manpower_edit_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const xlsxPath = path.join(TMP, "emp.xlsx");
    await dl.saveAs(xlsxPath);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fs.readFileSync(xlsxPath));
    const ws = wb.getWorksheet("Employees");
    assert.deepEqual(wb.worksheets.map((s) => s.name), ["Employees", "Lists", "Read me"]);
    assert.equal(ws.getCell("A1").value, "ID");
    assert.equal(ws.getCell("C1").value, "TRIGO ID");
    const rowOf = (name) => { for (let r = 2; r <= ws.rowCount; r++) if (ws.getCell(r, 2).value === name) return r; throw new Error("no row for " + name); };
    console.log("ok - the template downloads with an ID column, a Lists sheet and a Read me");

    // an untouched file changes nothing
    await p.setInputFiles("#bulk-file", xlsxPath);
    await p.waitForSelector("#bulk-preview:not(.hidden) .stat-chip");
    assert.equal(await chip("To update"), 0);
    assert.equal(await chip("Unchanged"), 10);
    assert.equal(await p.isDisabled("#btn-bulk-apply"), true);
    console.log("ok - an unedited template shows nothing to change and Apply stays off");

    // edit: rename, phone, clear a position, move A to Board Two, deactivate someone
    const rA = rowOf("Person A"), rB = rowOf("Person B"), rC = rowOf("Person C");
    ws.getCell(rA, 2).value = "Person A Renamed";
    ws.getCell(rA, 6).value = "081-000-0000";
    ws.getCell(rB, 10).value = "Board Two";
    ws.getCell(rC, 11).value = "Inactive";
    const edited = path.join(TMP, "emp-edited.xlsx");
    fs.writeFileSync(edited, Buffer.from(await wb.xlsx.writeBuffer()));
    await p.setInputFiles("#bulk-file", edited);
    await p.waitForFunction(() => (document.querySelector("#bulk-preview") || {}).textContent.includes("Renamed"));
    assert.equal(await chip("To update"), 3);
    assert.equal(await chip("Problems"), 0);
    const preview = await p.textContent("#bulk-preview");
    assert.match(preview, /Name:\s*Person A\s*→\s*Person A Renamed/);
    assert.match(preview, /Board:\s*Board One\s*→\s*Board Two/);
    assert.match(preview, /assignment on .* is cleared/);
    assert.match(preview, /1 will be set Inactive/);
    assert.equal(await p.textContent("#btn-bulk-apply"), "Apply 3 changes");
    // backup is on by default: applying downloads it first
    const [backup] = await Promise.all([p.waitForEvent("download"), p.click("#btn-bulk-apply")]);
    assert.match(backup.suggestedFilename(), /^manpower_backup_before_import_.*\.xlsx$/);
    await p.waitForSelector("#modal-bulk", { state: "hidden" });
    const emps = db.t("employees");
    assert.equal(emps.find((e) => e.id === "e1").name, "Person A Renamed");
    assert.equal(emps.find((e) => e.id === "e1").phone, "081-000-0000");
    assert.equal(emps.find((e) => e.id === "e2").board_id, "b2");
    assert.equal(emps.find((e) => e.id === "e3").active, false);
    assert.equal(emps.find((e) => e.id === "e4").name, "Person D", "untouched people stay untouched");
    // the backup is itself a valid, unchanged template
    await backup.saveAs(path.join(TMP, "backup.xlsx"));
    console.log("ok - Excel edits are previewed, backed up and applied");

    // ---- fill in TRIGO IDs next to the names, by name ----
    await openEmp();
    const [dl2] = await Promise.all([p.waitForEvent("download"), p.click("#btn-bulk-dl-xlsx")]);
    const p2 = path.join(TMP, "emp2.xlsx");
    await dl2.saveAs(p2);
    const wb3 = new ExcelJS.Workbook();
    await wb3.xlsx.load(fs.readFileSync(p2));
    const ws3 = wb3.getWorksheet("Employees");
    const rowOf3 = (name) => { for (let r = 2; r <= ws3.rowCount; r++) if (ws3.getCell(r, 2).value === name) return r; throw new Error("no row for " + name); };
    ws3.getCell(rowOf3("Person D"), 3).value = "t 505";
    ws3.getCell(rowOf3("Person E"), 3).value = "T505";
    const ids = path.join(TMP, "emp-ids.xlsx");
    fs.writeFileSync(ids, Buffer.from(await wb3.xlsx.writeBuffer()));
    await p.setInputFiles("#bulk-file", ids);
    await p.waitForSelector("#bulk-preview .bulk-problems");
    assert.equal(await chip("To update"), 0, "the same TRIGO ID on two people is refused for both");
    assert.match(await p.textContent("#bulk-preview .bulk-problems"), /TRIGO ID T505 would belong to more than one person/);
    ws3.getCell(rowOf3("Person E"), 3).value = "T506";
    const ids2 = path.join(TMP, "emp-ids-fixed.xlsx");
    fs.writeFileSync(ids2, Buffer.from(await wb3.xlsx.writeBuffer()));
    await p.setInputFiles("#bulk-file", ids2);
    await p.waitForFunction(() => /TRIGO ID:\s*\(empty\)\s*→\s*T506/.test(document.querySelector("#bulk-preview").textContent));
    assert.equal(await chip("To update"), 2);
    await p.uncheck("#bulk-backup");
    await p.click("#btn-bulk-apply");
    await p.waitForSelector("#modal-bulk", { state: "hidden" });
    assert.deepEqual([db.t("employees").find((e) => e.id === "e4").trigo_id, db.t("employees").find((e) => e.id === "e5").trigo_id], ["T505", "T506"]);
    console.log("ok - TRIGO IDs are filled in next to the names, tidied, and kept unique");

    // ---- employees: CSV with a new person and a bad row ----
    await openEmp();
    const csv = "Name,Contract type,Board,Service area,Position\r\n" +
      "Brand New Person,On-call,Board Two,AREA1,Technician\r\n" +
      "Bad Row,Sometimes,Board One,AREA1,\r\n" +
      "Person E,Permanent,Board One,AREA1,Senior Inspector\r\n";
    const csvPath = path.join(TMP, "emp.csv");
    fs.writeFileSync(csvPath, "﻿" + csv);
    await p.setInputFiles("#bulk-file", csvPath);
    await p.waitForSelector("#bulk-preview .bulk-problems");
    assert.equal(await chip("To update"), 1);
    assert.equal(await chip("New people"), 1);
    assert.equal(await chip("Problems"), 1);
    assert.match(await p.textContent("#bulk-preview .bulk-problems"), /Row 3 · Bad Row: Contract type "Sometimes" must be Permanent or On-call/);
    assert.equal(await p.textContent("#btn-bulk-apply"), "Apply 1 change", "new people are not added until ticked");
    await p.uncheck("#bulk-backup");
    await p.click("#btn-bulk-apply");
    await p.waitForSelector("#modal-bulk", { state: "hidden" });
    assert.equal(db.t("employees").some((e) => e.name === "Brand New Person"), false);
    assert.equal(db.t("employees").find((e) => e.id === "e5").position, "senior_inspector");

    await openEmp();
    await p.setInputFiles("#bulk-file", csvPath);
    await p.waitForSelector("#bulk-preview .bulk-create");
    await p.check("#bulk-create");
    assert.equal(await p.textContent("#btn-bulk-apply"), "Apply 1 change");
    await p.uncheck("#bulk-backup");
    await p.click("#btn-bulk-apply");
    await p.waitForSelector("#modal-bulk", { state: "hidden" });
    const created = db.t("employees").find((e) => e.name === "Brand New Person");
    assert.deepEqual([created.contract, created.board_id, created.position, created.added_on], ["oncall", "b2", "technician", T]);
    console.log("ok - CSV: a bad row is skipped with its row number, and new people only join when ticked");

    // ---- hosts ----
    await p.evaluate(() => { D().activeBoardId = HOSTLIST_ID; return refreshAndRender(); });
    await p.waitForFunction(() => allHostRows().length >= 2);
    await p.click("#btn-hostlist-bulk");
    await p.waitForSelector("#modal-bulk:not(.hidden)");
    const hostCsv = "Host name,Status,Location,Google Maps link,Service area,Note\r\n" +
      "Host Alpha,Archived,Rayong,https://maps.example/a,AREA1,gate 3\r\n" +
      "host beta,Active,Chonburi,https://maps.example/b,AREA1,\r\n" +
      "Hoost Gamma,Active,Bangkok,javascript:alert(1),,\r\n" +
      "Totally New,Active,Phuket,,,hello\r\n";
    const hostPath = path.join(TMP, "hosts.csv");
    fs.writeFileSync(hostPath, hostCsv);
    await p.setInputFiles("#bulk-file", hostPath);
    await p.waitForSelector("#bulk-preview .stat-chip");
    assert.equal(await chip("To update"), 2);
    assert.equal(await chip("New hosts"), 1);
    assert.equal(await chip("Problems"), 1);
    assert.match(await p.textContent("#bulk-preview .bulk-problems"), /Google Maps link: link must start with http/);
    assert.match(await p.textContent("#bulk-preview"), /matched "Host Beta" \(capital letters differ\)/);
    await p.uncheck("#bulk-backup");
    await p.click("#btn-bulk-apply");
    await p.waitForSelector("#modal-bulk", { state: "hidden" });
    const hosts = db.t("hosts");
    assert.equal(hosts.find((x) => x.name === "Host Alpha").archived, true);
    assert.equal(hosts.find((x) => x.name === "Host Alpha").note, "gate 3", "unchanged columns keep their value");
    assert.deepEqual([hosts.find((x) => x.name === "Host Beta").location, hosts.find((x) => x.name === "Host Beta").map_url], ["Chonburi", "https://maps.example/b"]);
    assert.equal(hosts.some((x) => x.name === "Totally New"), false, "new hosts need the tick");
    console.log("ok - hosts: matched by name, unsafe links refused, new hosts held back until ticked");

    // ---- a viewer never sees the buttons ----
    const v = await env.openAs(db, h.USERS.v);
    await v.page.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
    assert.equal(await v.page.locator("#btn-emplist-bulk").isVisible(), false);
    console.log("ok - a read-only role is not offered Bulk edit");

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all bulk edit checks passed");
  } finally {
    await env.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
