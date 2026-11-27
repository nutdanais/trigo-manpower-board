/* Acceptance run for on-call contract terms (employees.oncall_terms, migration-2026-11-27):
     - a board card shows Daily / Monthly in the first line's corner (option A of
       design/oncall-contract-terms-options.html), nothing when not set, never on a permanent card;
     - the Available On-call pool lists Monthly first, then Daily, then not set;
     - the employee form shows On-call terms only for On-call, saves it, and a person made
       permanent has their terms cleared;
     - the Profile and the Manpower List show it; the Manpower List filters by it and its
       "Set contract…" menu sets it for many people at once;
     - Bulk edit by file reads and plans the column;
     - in Thai the card reads รายวัน / รายเดือน;
     - before the migration, saving without a term still works and choosing one says what to run;
     - the term is only shown: the board's counts are the same with and without it.
     NODE_PATH=$(npm root -g) node tests/e2e/oncall-terms.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 6).join("\n   ")); throw e; }
}

/* base seed plus three more on-call people on Board One: e7 (Person G) and e8 (Person H) come on-call already */
function seed(db, src) {
  h.seedBase(db, { src });
  const emps = db.t("employees");
  Object.assign(emps.find((e) => e.id === "e7"), { oncall_terms: "daily" });
  Object.assign(emps.find((e) => e.id === "e8"), { oncall_terms: null });
  emps.push({ id: "e11", name_th: "Person K", contract: "oncall", oncall_terms: "monthly", area_id: "area-1", board_id: "b1", active: true, position: null });
  emps.push({ id: "e12", name_th: "Person L", contract: "oncall", oncall_terms: "daily", area_id: "area-1", board_id: "b1", active: true, position: null });
}

(async () => {
  const env = await h.launch();
  try {
    const T = h.iso(new Date());
    const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
    const db = new h.FakeDb();
    seed(db, SRC);
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);
    const row = (id) => db.t("employees").find((e) => e.id === id);
    // after changing the fake database behind the app's back: reload the roster, then draw
    const reload = () => p.evaluate(() => cloud._loadEmployees().then(() => refreshAndRender()));
    const poolNames = () => p.$$eval('[data-pool="oncall"] .emp-card', (els) => els.map((e) => [e.dataset.empId, (e.querySelector(".emp-ct") || {}).textContent || ""]));

    await step("the card shows the term in its corner, Monthly filled and Daily outlined; none when not set or permanent", async () => {
      const card = (id) => p.locator(`.emp-card[data-emp-id="${id}"]`).first();
      assert.equal(await card("e11").locator(".emp-ct.emp-ct-monthly").textContent(), "Monthly");
      assert.equal(await card("e7").locator(".emp-ct.emp-ct-daily").textContent(), "Daily");
      assert.equal(await card("e8").locator(".emp-ct").count(), 0, "not set: no tag");
      assert.equal(await card("e1").locator(".emp-ct").count(), 0, "permanent: no tag");
      assert.match(await card("e11").getAttribute("title"), /On-call · Monthly/);
      const bg = await card("e11").locator(".emp-ct").evaluate((el) => getComputedStyle(el).backgroundColor);
      assert.equal(bg, "rgb(138, 79, 16)", "Monthly is filled");
    });

    await step("the Available On-call pool lists Monthly first, then Daily, then not set", async () => {
      assert.deepEqual(await poolNames(), [["e11", "Monthly"], ["e7", "Daily"], ["e12", "Daily"], ["e8", ""]]);
    });

    await step("the form shows On-call terms only for On-call, and saves it", async () => {
      await h.editEmployee(p, "e8");
      const field = p.locator("#form-employee .emp-terms-field");
      assert.ok(await field.isVisible(), "on-call: shown");
      assert.equal(await p.inputValue("#form-employee select[name=oncallTerms]"), "");
      await field.locator('.seg-pick button[data-v="monthly"]').click();
      await h.submitEmployeeForm(p);
      await p.waitForFunction(() => D().employees.find((e) => e.id === "e8").oncallTerms === "monthly");
      assert.equal(row("e8").oncall_terms, "monthly");
      assert.deepEqual((await poolNames()).map((x) => x[0]), ["e8", "e11", "e7", "e12"], "now Monthly: sorted with Monthly");
    });

    await step("the Profile shows the term, or says it is not set", async () => {
      await p.evaluate(() => openProfile("e8"));
      await p.waitForSelector("#modal-profile:not(.hidden) .ct-chip-monthly");
      assert.match(await p.textContent("#profile-body"), /On-call\s*Monthly/);
      await p.evaluate(() => closeModal());
      db.t("employees").push({ id: "e13", name_th: "Person M", contract: "oncall", oncall_terms: null, area_id: "area-1", board_id: "b1", active: true });
      await reload();
      await p.evaluate(() => openProfile("e13"));
      await p.waitForSelector("#modal-profile:not(.hidden) #profile-body");
      assert.match(await p.textContent("#profile-body"), /On-call\s*terms not set/);
      await p.evaluate(() => closeModal());
    });

    await step("switching to Permanent hides the terms and clears them on save", async () => {
      await h.editEmployee(p, "e12");
      await p.locator('#form-employee select[name=contract] + .seg-pick button[data-v="permanent"]').click();
      assert.ok(!(await p.locator("#form-employee .emp-terms-field").isVisible()), "permanent: hidden");
      await p.locator('#form-employee select[name=contract] + .seg-pick button[data-v="oncall"]').click();
      assert.equal(await p.inputValue("#form-employee select[name=oncallTerms]"), "daily", "back to On-call: the term is still there");
      await p.locator('#form-employee select[name=contract] + .seg-pick button[data-v="permanent"]').click();
      await h.submitEmployeeForm(p);
      await p.waitForFunction(() => D().employees.find((e) => e.id === "e12").contract === "permanent");
      assert.equal(row("e12").oncall_terms, null);
    });

    await step("the Manpower List shows the term, filters by it and sets it in bulk", async () => {
      await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      await p.waitForSelector("#emplist-body tr");
      const cell = (id) => p.locator(`#emplist-body tr[data-emp-id="${id}"] td[data-col="contract"]`);
      assert.match(await cell("e11").innerText(), /On-call\s*Monthly/);
      assert.match(await cell("e7").innerText(), /On-call\s*Daily/);
      assert.doesNotMatch(await cell("e1").innerText(), /Daily|Monthly/);
      // filter: On-call terms = Daily
      await p.evaluate(() => { state.emplist.filters.terms = ["daily"]; renderEmployeeRows(); });
      assert.deepEqual(await p.$$eval("#emplist-body tr[data-emp-id]", (els) => els.map((e) => e.dataset.empId)), ["e7"]);
      await p.evaluate(() => { state.emplist.filters.terms = ["__none__"]; renderEmployeeRows(); });
      assert.deepEqual(await p.$$eval("#emplist-body tr[data-emp-id]", (els) => els.map((e) => e.dataset.empId)), ["e13"]);
      await p.evaluate(() => { state.emplist.filters.terms = []; renderEmployeeRows(); });
      // bulk: select e7 and e13, Set contract → On-call · Monthly
      await p.evaluate(() => { state.selectedEmps = new Set(["e7", "e13"]); renderEmployeeRows(); });
      await p.evaluate(() => { const s = document.querySelector("#emplist-bulk-contract"); s.value = "oncall:monthly"; s.dispatchEvent(new Event("change")); });
      await p.waitForFunction(() => D().employees.find((e) => e.id === "e13").oncallTerms === "monthly");
      assert.equal(row("e7").oncall_terms, "monthly");
      // Set contract → plain On-call keeps the term; Permanent clears it
      await p.evaluate(() => { state.selectedEmps = new Set(["e7"]); const s = document.querySelector("#emplist-bulk-contract"); s.value = "oncall"; s.dispatchEvent(new Event("change")); });
      await p.waitForTimeout(300);
      assert.equal(row("e7").oncall_terms, "monthly");
      await p.evaluate(() => { state.selectedEmps = new Set(["e13"]); const s = document.querySelector("#emplist-bulk-contract"); s.value = "permanent"; s.dispatchEvent(new Event("change")); });
      await p.waitForFunction(() => D().employees.find((e) => e.id === "e13").contract === "permanent");
      assert.equal(row("e13").oncall_terms, null);
      await p.evaluate(() => { state.selectedEmps = new Set(); });
    });

    await step("the Manpower List export carries an On-call Terms column", async () => {
      const r = await p.evaluate(() => emplistXlsxRows().filter((x) => ["Person K", "Person A", "Person H"].includes(x.name)).map((x) => [x.name, x.oncallTerms]));
      assert.deepEqual(r.sort(), [["Person A", ""], ["Person H", "Monthly"], ["Person K", "Monthly"]]);
      assert.ok(await p.evaluate(() => ManpowerXlsx.LIST_COLUMNS.some((c) => c.key === "oncallTerms" && c.label === "On-call Terms")));
    });

    await step("Bulk edit by file reads On-call terms, and leaves them empty for a permanent person", async () => {
      const plan = await p.evaluate(() => {
        const cols = new Set(["id", "name", "contract", "oncallTerms"]);
        const rec = (n, cells) => ({ rowNumber: n, cells });
        const table = { cols, fatal: [], ignored: [], records: [
          rec(2, { id: "e8", name: "Person H", contract: "On-call", oncallTerms: "Daily" }),
          rec(3, { id: "e1", name: "Person A", contract: "Permanent", oncallTerms: "Monthly" }),
          rec(4, { id: "e11", name: "Person K", contract: "On-call", oncallTerms: "รายวัน" }),
          rec(5, { id: "e7", name: "Person G", contract: "On-call", oncallTerms: "Weekly" }),
        ] };
        const res = BulkEdit.planEmployees(table, bulkCtx("employees", D().employees));
        return res.rows.map((r) => ({ kind: r.kind, patch: r.patch, warnings: r.warnings, errors: r.errors }));
      });
      assert.deepEqual(plan[0].patch, { oncallTerms: "daily" });
      assert.equal(plan[1].kind, "same", "a permanent person's term is not stored");
      assert.match(plan[1].warnings.join(" "), /only kept for on-call people/);
      assert.deepEqual(plan[2].patch, { oncallTerms: "daily" }, "Thai รายวัน reads as Daily");
      assert.equal(plan[3].kind, "error");
      assert.match(plan[3].errors.join(" "), /must be Daily, Monthly or blank/);
    });

    await step("the term is only shown: the board's counts do not change with it", async () => {
      await p.evaluate(() => { D().activeBoardId = "b1"; return refreshAndRender(); });
      const counts = () => p.evaluate(() => { const s = boardStats("b1"); return [s.assigned, s.standby, s.oncallAvailable, s.leave]; });
      const before = await counts();
      for (const e of db.t("employees")) if (e.contract === "oncall") e.oncall_terms = null;
      await reload();
      assert.deepEqual(await counts(), before);
    });

    await step("in Thai the card reads รายวัน / รายเดือน", async () => {
      Object.assign(row("e7"), { oncall_terms: "daily" });
      Object.assign(row("e11"), { oncall_terms: "monthly" });
      await reload();
      await p.evaluate(() => I18N.setLang("th"));
      await p.waitForTimeout(300);
      assert.equal(await p.locator('.emp-card[data-emp-id="e7"] .emp-ct').first().textContent(), "รายวัน");
      assert.equal(await p.locator('.emp-card[data-emp-id="e11"] .emp-ct').first().textContent(), "รายเดือน");
      await p.evaluate(() => I18N.setLang("en"));
    });

    assert.deepEqual(a.errors, [], "no page errors");

    // ---- a database without migration-2026-11-27 ----
    const old = new h.FakeDb({ oncallTerms: false });
    seed(old, SRC);
    for (const e of old.t("employees")) delete e.oncall_terms;
    const b = await env.openAs(old, h.USERS.a);
    const q = b.page;
    await q.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);

    await step("before the migration: no tags, saving without a term works, choosing one says what to run", async () => {
      assert.equal(await q.locator(".emp-card .emp-ct").count(), 0);
      await h.editEmployee(q, "e8");
      await q.fill("#form-employee input[name=phone]", "081-555-0000");
      await h.submitEmployeeForm(q);
      await q.waitForFunction(() => D().employees.find((e) => e.id === "e8").phone === "081-555-0000");
      await h.editEmployee(q, "e8");
      await q.locator('#form-employee .emp-terms-field .seg-pick button[data-v="daily"]').click();
      await h.submitEmployeeForm(q);
      await q.waitForSelector(".toast", { timeout: 5000 });
      assert.match(await q.locator(".toast").last().textContent(), /migration-2026-11-27-oncall-terms\.sql/);
    });
  } finally {
    await env.close();
  }
})().catch(() => process.exit(1));
