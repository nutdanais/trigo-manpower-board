/* Acceptance run for the optional employee Start date: the New / Edit Employee
   form saves it (and can clear it), and the Manpower List shows it.
     NODE_PATH=$(npm root -g) node tests/e2e/employee-start-date.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

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
      await p.click("#form-employee button[type=submit]");
      await p.waitForSelector("#modal-employee", { state: "hidden" });
    };

    await p.evaluate(() => openEmployeeModal(null));
    await p.fill("#form-employee input[name=name]", "Dated Person");
    await p.fill("#form-employee input[name=startDate]", "2024-02-29");
    await save();
    const dated = db.t("employees").find((e) => e.name === "Dated Person");
    assert.equal(dated.start_date, "2024-02-29");
    console.log("ok - a new employee is saved with a start date");

    await p.evaluate(() => openEmployeeModal(null));
    await p.fill("#form-employee input[name=name]", "Undated Person");
    await save();
    assert.equal(db.t("employees").find((e) => e.name === "Undated Person").start_date, null);
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

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all start date checks passed");
  } finally {
    await env.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
