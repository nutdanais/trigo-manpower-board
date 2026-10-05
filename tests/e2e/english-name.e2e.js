/* Acceptance run for the employee English name: the New / Edit Employee form (Thai name required and
   explained, English name optional), the Manpower List's Thai / English / both display (Thai by default,
   remembered, searchable in both languages), and the Excel exports using the English name in an English
   file and the Thai name in a Thai one.
     NODE_PATH=$(npm root -g) node tests/e2e/english-name.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const h = require("./harness");
const ExcelJS = require("../../vendor/exceljs.min.js");

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 6).join("\n   ")); throw e; }
}
async function sheetOf(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(path));
  return wb;
}

(async () => {
  const env = await h.launch();
  try {
    const T = h.iso(new Date());
    const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    // e1 has both names, e2 only a Thai one, e3 an English-only person whose Thai column holds the same text
    Object.assign(db.t("employees").find((e) => e.id === "e1"), { name_th: "สมชาย ใจดี", name_en: "Somchai Jaidee" });
    Object.assign(db.t("employees").find((e) => e.id === "e2"), { name_th: "มาลี สุขใจ", name_en: null });
    Object.assign(db.t("employees").find((e) => e.id === "e3"), { name_th: "Pichai Rakdee", name_en: "Pichai Rakdee" });
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);

    await step("the form: Thai name is required and explained, English name is optional", async () => {
      await p.evaluate(() => openEmployeeModal(null));
      assert.equal(await p.locator("#form-employee input[name=name]").getAttribute("required"), "");
      assert.equal(await p.locator("#form-employee input[name=nameEn]").getAttribute("required"), null);
      assert.match(await p.textContent("#hint-name-th"), /Required.*shown in the app by default/);
      assert.match(await p.textContent("#hint-name-en"), /English.*Thai name is used/);
      assert.match(await p.textContent("#form-employee"), /Thai name\s*\*/);
      await p.locator("#modal-employee [data-close].btn:visible").first().click();
    });

    await step("a new employee is saved with both names; the English one can be left empty", async () => {
      const save = async () => { await p.click("#form-employee button[type=submit]"); await p.waitForSelector("#modal-employee", { state: "hidden" }); };
      await p.evaluate(() => openEmployeeModal(null));
      await p.fill("#form-employee input[name=name]", "สมหญิง รักงาน");
      await p.fill("#form-employee input[name=nameEn]", "  Somying   Rakngan ");
      await save();
      let row = db.t("employees").find((e) => e.name_th === "สมหญิง รักงาน");
      assert.equal(row.name_en, "Somying Rakngan");
      await p.evaluate(() => openEmployeeModal(null));
      await p.fill("#form-employee input[name=name]", "วิชัย ทดสอบ");
      await save();
      row = db.t("employees").find((e) => e.name_th === "วิชัย ทดสอบ");
      assert.equal(row.name_en, null, "left empty -> nothing stored");
      // editing shows the stored English name, and clearing it clears it
      const id = db.t("employees").find((e) => e.name_th === "สมหญิง รักงาน").id;
      await p.evaluate((i) => { openEmployeeModal(i); state.employeeTab = "edit"; applyEmployeeTab(); }, id);
      assert.equal(await p.inputValue("#form-employee input[name=nameEn]"), "Somying Rakngan");
      await p.fill("#form-employee input[name=nameEn]", "");
      await save();
      assert.equal(db.t("employees").find((e) => e.id === id).name_en, null);
    });

    await step("a name typed into the wrong field earns a warning (Cancel keeps the form), but can be saved anyway", async () => {
      const confirmUp = async () => (await p.locator("#modal-confirm:not(.hidden)").count()) === 1;
      const submit = () => p.click("#form-employee button[type=submit]");
      // English in the Thai field
      await p.evaluate(() => openEmployeeModal(null));
      await p.fill("#form-employee input[name=name]", "Plain English");
      await submit();
      assert.equal(await confirmUp(), true, "warned");
      assert.match(await p.textContent("#confirm-message"), /Thai name "Plain English" has no Thai letters/);
      assert.equal(await p.textContent("#btn-confirm-yes"), "Save anyway");
      await p.click("#btn-confirm-no");
      assert.equal(await p.locator("#modal-employee:not(.hidden)").count(), 1, "Cancel returns to the form");
      assert.equal(await p.inputValue("#form-employee input[name=name]"), "Plain English", "what was typed is still there");
      assert.equal(db.t("employees").some((e) => e.name_th === "Plain English"), false, "nothing saved yet");
      await submit();
      await p.click("#btn-confirm-yes");
      await p.waitForSelector("#modal-employee", { state: "hidden" });
      assert.equal(db.t("employees").some((e) => e.name_th === "Plain English"), true, "saved anyway");
      // Thai in the English field
      await p.evaluate(() => openEmployeeModal(null));
      await p.fill("#form-employee input[name=name]", "สมศรี มีสุข");
      await p.fill("#form-employee input[name=nameEn]", "สมศรี");
      await submit();
      assert.match(await p.textContent("#confirm-message"), /English name "สมศรี" has Thai letters/);
      await p.click("#btn-confirm-yes");
      await p.waitForSelector("#modal-employee", { state: "hidden" });
      assert.equal(db.t("employees").find((e) => e.name_th === "สมศรี มีสุข").name_en, "สมศรี");
      // both wrong: one dialog, two lines
      await p.evaluate(() => openEmployeeModal(null));
      await p.fill("#form-employee input[name=name]", "Both Wrong");
      await p.fill("#form-employee input[name=nameEn]", "ทั้งคู่");
      await submit();
      assert.match(await p.textContent("#confirm-message"), /no Thai letters[\s\S]*has Thai letters/);
      await p.click("#btn-confirm-no");
      await p.locator("#modal-employee [data-close].btn:visible").first().click();
      // each in its own field: no dialog
      await p.evaluate(() => openEmployeeModal(null));
      await p.fill("#form-employee input[name=name]", "ถูกต้อง ครบถ้วน");
      await p.fill("#form-employee input[name=nameEn]", "Correct Complete");
      await submit();
      assert.equal(await confirmUp(), false, "no warning when each name is in its own language");
      await p.waitForSelector("#modal-employee", { state: "hidden" });
    });

    await step("editing: only a name that was changed is checked (the migration's English copies are not nagged)", async () => {
      // e3's Thai column still holds the English copy; changing only the phone must save without a dialog
      await p.evaluate(() => { openEmployeeModal("e3"); state.employeeTab = "edit"; applyEmployeeTab(); });
      await p.fill("#form-employee input[name=phone]", "081-999-9999");
      await p.click("#form-employee button[type=submit]");
      await p.waitForSelector("#modal-employee", { state: "hidden" });
      assert.equal(db.t("employees").find((e) => e.id === "e3").phone, "081-999-9999");
      // changing that English-in-Thai name to another English one does warn
      await p.evaluate(() => { openEmployeeModal("e3"); state.employeeTab = "edit"; applyEmployeeTab(); });
      await p.fill("#form-employee input[name=name]", "Pichai R.");
      await p.click("#form-employee button[type=submit]");
      assert.equal(await p.locator("#modal-confirm:not(.hidden)").count(), 1);
      await p.click("#btn-confirm-no");
      await p.locator("#modal-employee [data-close].btn:visible").first().click();
    });

    await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return cloud._loadEmployees().then(refreshAndRender); });
    const names = () => p.locator("#emplist-body tr td[data-label=Name]").allTextContents();
    const cellOf = (thai) => p.locator(`#emplist-body tr:has(td[data-label=Name]:has-text("${thai}")) td[data-label=Name]`).first();

    await step("the Manpower List shows Thai names by default", async () => {
      assert.equal(await p.inputValue("#emplist-name-view"), "th");
      const all = await names();
      assert.ok(all.includes("สมชาย ใจดี") && all.includes("มาลี สุขใจ"));
      assert.ok(!all.some((n) => n.includes("Somchai")));
    });

    await step("English shows the English name, falling back to the Thai one when there is none", async () => {
      await p.selectOption("#emplist-name-view", "en");
      const all = await names();
      assert.ok(all.includes("Somchai Jaidee"), "e1 in English");
      assert.ok(all.includes("มาลี สุขใจ"), "e2 has no English name: Thai is shown rather than a blank");
      assert.ok(!all.includes("สมชาย ใจดี"));
      assert.ok(all.every((n) => n.trim() !== ""));
    });

    await step("Thai + English shows both (English only where it adds something)", async () => {
      await p.selectOption("#emplist-name-view", "both");
      assert.equal((await cellOf("สมชาย").textContent()).replace(/\s+/g, " ").trim(), "สมชาย ใจดีSomchai Jaidee");
      assert.equal(await cellOf("สมชาย").locator(".el-name-en").textContent(), "Somchai Jaidee");
      assert.equal(await cellOf("มาลี").locator(".el-name-en").count(), 0, "no English name: nothing extra");
      assert.equal(await cellOf("Pichai").locator(".el-name-en").count(), 0, "same text in both: shown once");
    });

    await step("the choice is remembered, and search finds a person by either name", async () => {
      await p.reload();
      await p.waitForFunction(() => { try { return D().employees.length > 0; } catch (e) { return false; } });   // the app has started and loaded
      await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      assert.equal(await p.inputValue("#emplist-name-view"), "both");
      await p.fill("#emplist-search", "somchai");
      assert.equal((await names()).length, 1);
      await p.fill("#emplist-search", "สมชาย");
      assert.equal((await names()).length, 1);
      await p.fill("#emplist-search", "");
      await p.selectOption("#emplist-name-view", "th");
    });

    const exportList = async (lang, file) => {
      await p.click("#btn-emplist-xlsx");
      await p.waitForSelector("#modal-emplist-xlsx:not(.hidden)");
      await p.check(`#emplist-xlsx-lang input[value=${lang}]`);
      const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-emplist-xlsx-go")]);
      await dl.saveAs(file);
      return (await sheetOf(file)).worksheets[0];
    };

    await step("the Manpower List Excel has both name columns, in an English and in a Thai file", async () => {
      const both = (ws) => { const o = {}; for (let r = 2; r <= ws.rowCount; r++) if (typeof ws.getCell(r, 1).value === "string") o[ws.getCell(r, 1).value] = ws.getCell(r, 2).value || ""; return o; };
      const en = await exportList("en", "/tmp/names-en.xlsx");
      assert.deepEqual([1, 2].map((c) => en.getCell(1, c).value), ["Thai Name", "English Name"]);
      const e = both(en);
      assert.equal(e["สมชาย ใจดี"], "Somchai Jaidee", "Thai name beside its English name");
      assert.equal(e["มาลี สุขใจ"], "", "no English name yet: left empty, not copied from the Thai one");
      assert.equal(e["Pichai Rakdee"], "Pichai Rakdee");
      const th = await exportList("th", "/tmp/names-th.xlsx");
      assert.deepEqual([1, 2].map((c) => th.getCell(1, c).value), ["ชื่อ (ไทย)", "ชื่อ (อังกฤษ)"]);
      assert.deepEqual(both(th), e, "the same two columns in the Thai file");
    });

    await step("the board Excel uses the same rule", async () => {
      await p.evaluate((d) => { D().activeBoardId = "b1"; state.date = d; return refreshAndRender(); }, SRC);
      const board = async (lang, file) => {
        await p.click("#btn-xlsx");
        await p.waitForSelector("#modal-xlsx:not(.hidden)");
        await p.check(`#xlsx-lang input[value=${lang}]`);
        const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-xlsx-go")]);
        await dl.saveAs(file);
        const wb = await sheetOf(file);
        const out = [];
        for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => { if (typeof c.value === "string") out.push(c.value); }));
        return out;
      };
      const en = await board("en", "/tmp/board-en.xlsx");
      assert.ok(en.includes("Somchai Jaidee"), "English board file has the English name");
      assert.ok(!en.includes("สมชาย ใจดี"));
      assert.ok(en.includes("มาลี สุขใจ"), "fallback to Thai where there is no English name");
      const th = await board("th", "/tmp/board-th.xlsx");
      assert.ok(th.includes("สมชาย ใจดี") && !th.includes("Somchai Jaidee"), "Thai board file has the Thai name");
    });

    await step("board cards: Thai by default, English / both on request, remembered, hidden outside a board", async () => {
      await p.evaluate((d) => { D().activeBoardId = "b1"; state.date = d; return refreshAndRender(); }, SRC);
      const card = (thai) => p.locator(`.emp-card[data-emp-id="e1"]`).first();
      assert.equal(await p.locator("#card-names").isVisible(), true);
      assert.equal(await p.inputValue("#card-names"), "th");
      assert.match(await card().textContent(), /สมชาย\s*ใจดี/);
      assert.ok(!/Somchai/.test(await card().textContent()));
      await p.selectOption("#card-names", "en");
      assert.match(await card().textContent(), /Somchai\s*Jaidee/);
      assert.ok(!/สมชาย/.test(await card().textContent()));
      assert.match(await p.locator('.emp-card[data-emp-id="e2"]').first().textContent(), /มาลี/, "no English name: the Thai one, not a blank card");
      await p.selectOption("#card-names", "both");
      assert.equal(await card().locator(".emp-name-en").textContent(), "Somchai Jaidee");
      assert.match(await card().textContent(), /สมชาย/);
      assert.equal(await p.locator('.emp-card[data-emp-id="e3"] .emp-name-en').count(), 0, "same text in both: shown once");
      assert.match(await card().getAttribute("title"), /สมชาย ใจดี \/ Somchai Jaidee/);
      await p.reload();
      await p.waitForFunction(() => { try { return D().employees.length > 0; } catch (e) { return false; } });   // the app has started and loaded
      await p.waitForSelector(".emp-card");
      await p.evaluate((d) => { D().activeBoardId = "b1"; state.date = d; return refreshAndRender(); }, SRC);
      assert.equal(await p.inputValue("#card-names"), "both");
      assert.equal(await card().locator(".emp-name-en").count(), 1, "still both after a reload");
      await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      assert.equal(await p.locator("#card-names").isVisible(), false, "not offered on the Manpower List");
      await p.evaluate((d) => { D().activeBoardId = "b1"; state.date = d; return refreshAndRender(); }, SRC);
      await p.selectOption("#card-names", "th");
    });

    console.log("all English name checks passed");
  } finally {
    await env.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
