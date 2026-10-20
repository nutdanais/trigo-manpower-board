/* Acceptance run for lending people to another board (employee_loans): the
   employee menu's Lend to board… / End loan / Change loan dates…, the Lend
   dialog, the Lent out group and the badges, the stats, the Manpower List,
   carry-over during and after a loan, Move mission "with crew", a permanent
   move ending a loan, and a database without the loans table. Real app in
   Chromium against the shared fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/loans.e2e.js
   Seed: harness.seedBase (Board One: 101 day with A and B, 102 day with C, 103
   night with D; E on annual leave; F standby; G, H on-call. Board Two: I, J)
   plus 201 on Board Two with I. Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
const D1 = h.nextWorking(SRC);   // still a confirmed date (the next working day)

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 5).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    db.seed("missions", [
      { id: "s201", board_id: "b2", plan_date: SRC, number: "201", host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" },
    ]);
    db.seed("assignments", [{ employee_id: "e9", plan_date: SRC, mission_id: "s201", zone: null }]);

    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const open = (board, d) => p.evaluate(([b, d]) => { D().activeBoardId = b; state.date = d; state.unlockedDates.add(d); return refreshAndRender(); }, [board, d]);
    await open("b1", SRC);

    const emp = (id) => p.locator(`.emp-card[data-emp-id="${id}"]`).first();
    const card = (num) => p.locator("#missions-grid .mission-card", { has: p.locator(".m-number", { hasText: new RegExp("^" + num + "$") }) });
    const menu = p.locator("#context-menu");
    const menuLabels = async () => (await menu.locator(".ctx-item").allInnerTexts()).map((s) => s.trim());
    const item = (label) => menu.locator(".ctx-item", { hasText: new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    const dlg = p.locator("#modal-lend");
    const total = () => p.locator('#stats-bar [data-stat="Total"]').innerText();
    const loans = (empId) => db.t("employee_loans").filter((l) => l.employee_id === empId).sort((x, y) => x.start_date.localeCompare(y.start_date));
    const assigned = (empId, d = SRC) => db.t("assignments").find((x) => x.employee_id === empId && x.plan_date === d);

    await step("on a board, the employee menu offers Lend to board… instead of Move to board", async () => {
      await emp("e3").click({ button: "right" });
      const labels = await menuLabels();
      assert.ok(labels.includes("Lend to board…"), labels.join(" | "));
      assert.ok(!labels.includes("Move to board"), labels.join(" | "));
      await p.keyboard.press("Escape");
    });

    await step("the Lend dialog: board, From the date on screen, Until the same day, what it takes them off", async () => {
      await emp("e3").click({ button: "right" });
      await item("Lend to board…").click();
      await dlg.waitFor({ state: "visible" });
      assert.match(await p.locator("#lend-title").innerText(), /Lend Person C/);
      assert.equal(await dlg.locator(".mm-board[aria-pressed=true] b").innerText(), "Board Two");
      assert.equal(await p.inputValue("#lend-from"), SRC);
      assert.equal(await p.inputValue("#lend-until"), SRC);
      assert.match(await p.locator("#lend-notes").innerText(), /Person C is on 102 today\. Lending takes them off it\./);
      assert.match(await p.locator("#lend-summary").innerText(), /Lend Person C to Board Two · .* only/);
      await p.fill("#lend-until", h.addDays(SRC, -1));
      assert.match(await p.locator("#lend-notes").innerText(), /Until can't be before From/);
      assert.equal(await p.locator("#btn-lend").isDisabled(), true);
      await p.fill("#lend-until", SRC);
      await p.fill("#lend-note", "Audit week");
      await p.click("#btn-lend");
      await p.locator(".toast", { hasText: "Person C lent to Board Two for" }).waitFor();
      const l = loans("e3");
      assert.equal(l.length, 1);
      assert.deepEqual([l[0].to_board_id, l[0].start_date, l[0].end_date, l[0].note], ["b2", SRC, SRC, "Audit week"]);
      assert.equal(l[0].created_by, "eng.a@example.com");
      assert.equal(assigned("e3"), undefined, "taken off 102");
    });

    await step("their own board lists them under Lent out, not in Standby or the Total", async () => {
      assert.equal(await card("102").locator(".emp-card").count(), 0);
      await p.locator("#lent-section:not(.hidden)").waitFor();
      assert.equal(await p.locator("#lent-count").innerText(), "1");
      const lent = p.locator('#lent-body .emp-card[data-emp-id="e3"]');
      assert.equal(await lent.evaluate((el) => el.classList.contains("lent-out")), true);
      assert.match(await lent.locator(".emp-loan").innerText(), /→ Board Two/);
      assert.equal(await p.locator('#float-pool [data-pool="standby"] .emp-card[data-emp-id="e3"]').count(), 0);
      assert.match(await total(), /^Total\s*7\s*1 lent out/);
    });

    await step("a lent-out card can't be selected, and its menu is about the loan", async () => {
      const lent = p.locator('#lent-body .emp-card[data-emp-id="e3"]');
      await lent.click();
      assert.deepEqual(await p.evaluate(() => [...state.selectedEmps]), []);
      await lent.click({ button: "right" });
      assert.deepEqual(await menuLabels(), ["Edit employee", "End loan (back to Board One)", "Change loan dates…"]);
      await p.keyboard.press("Escape");
    });

    await step("the borrowing board has them in Standby with a badge, and counts them", async () => {
      await open("b2", SRC);
      const c = p.locator('#float-pool [data-pool="standby"] .emp-card[data-emp-id="e3"]');
      await c.waitFor();
      assert.equal(await c.evaluate((el) => el.classList.contains("borrowed")), true);
      assert.match(await c.locator(".emp-loan").innerText(), /↔ Board One/);
      assert.match(await c.getAttribute("title"), /On loan from Board One/);
      assert.match(await total(), /^Total\s*3\s*incl\. 1 borrowed/);
    });

    await step("they can be placed on the borrowing board's mission like anyone there", async () => {
      await emp("e3").click();
      await card("201").locator(".mission-body").click({ position: { x: 300, y: 10 } });
      await card("201").locator('.emp-card[data-emp-id="e3"]').waitFor();
      assert.equal(assigned("e3").mission_id, "s201");
      // and the day's stamp goes to the borrowing board
      assert.ok(db.t("plan_day_stamps").some((s) => s.board_id === "b2" && s.plan_date === SRC));
    });

    await step("Overview numbers count them on the board they work on that day", async () => {
      const u = await p.evaluate((d) => cloud.getUtilizationRange(["b1", "b2"], d, d), SRC);
      assert.equal(u.b1[SRC].headcount, 7);
      assert.equal(u.b2[SRC].headcount, 3);
      assert.equal(u.b2[SRC].assigned, 2);
    });

    await step("the Manpower List shows the loan next to their own board", async () => {
      await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      const row = p.locator('#emplist-body tr[data-emp-id="e3"]');
      await row.waitFor();
      assert.match(await row.innerText(), /Board One\s*→ Board Two\s*.* only/);
    });

    await step("Change loan dates… moves the last day", async () => {
      await open("b2", SRC);
      await card("201").locator('.emp-card[data-emp-id="e3"]').click({ button: "right" });
      await item("Change loan dates…").click();
      await dlg.waitFor({ state: "visible" });
      assert.match(await p.locator("#lend-title").innerText(), /Change loan dates: Person C/);
      assert.equal(await dlg.locator(".mm-board").count(), 1);
      await p.fill("#lend-until", D1);
      await p.click("#btn-lend");
      await p.locator(".toast", { hasText: "Loan to Board Two now ends" }).waitFor();
      assert.equal(loans("e3")[0].end_date, D1);
      assert.equal(assigned("e3").mission_id, "s201", "today's place is kept");
    });

    await step("carry-over keeps them on the borrowing board while the loan runs", async () => {
      await p.evaluate(([d]) => cloud.resetBoardFromLastWorkingDay("b2", d), [D1]);
      await p.evaluate(([d]) => cloud.resetBoardFromLastWorkingDay("b1", d), [D1]);
      const m201 = db.t("missions").find((m) => m.board_id === "b2" && m.plan_date === D1 && m.number === "201");
      assert.ok(m201);
      assert.equal(assigned("e3", D1).mission_id, m201.id);
    });

    await step("End loan sends them home from the date on screen", async () => {
      await open("b2", D1);
      await card("201").locator('.emp-card[data-emp-id="e3"]').click({ button: "right" });
      await item("End loan").click();
      await p.click("#btn-confirm-yes");
      await p.waitForFunction(() => !document.querySelector('#missions-grid .emp-card[data-emp-id="e3"]'));
      const l = loans("e3");
      assert.equal(l.length, 1);
      assert.equal(l[0].end_date, h.addDays(D1, -1));
      assert.equal(assigned("e3", D1), undefined);
      await open("b1", D1);
      await p.locator('#float-pool [data-pool="standby"] .emp-card[data-emp-id="e3"]').waitFor();
    });

    await step("Move mission with crew lends the crew with it", async () => {
      await open("b1", SRC);
      await card("101").locator(".mission-header .m-line2").click({ button: "right" });
      await item("Move or copy to board").click();
      await item("Board Two").click();
      await p.waitForFunction(() => !document.querySelector("#btn-move-mission").disabled);
      const withCrew = p.locator("#move-mission-with-crew");
      assert.equal(await withCrew.isVisible(), true);
      assert.match(await p.locator("#move-mission-with-label").innerText(), /With crew: lend them to Board Two/);
      await withCrew.locator("input[type=radio]").check();
      assert.match(await p.locator("#move-mission-summary").innerText(), /Move 101 to Board Two · 2 people lent for/);
      await p.click("#btn-move-mission");
      await p.locator(".toast", { hasText: "101 moved to Board Two" }).waitFor();
      for (const id of ["e1", "e2"]) {
        const l = loans(id);
        assert.deepEqual([l.length, l[0].to_board_id, l[0].start_date, l[0].end_date], [1, "b2", SRC, SRC], id);
        assert.equal(assigned(id).mission_id, "s101", id);
      }
      await open("b2", SRC);
      assert.equal(await card("101").locator(".emp-card.borrowed").count(), 2);
      // Person C is still lent on this day too (the loan was ended from the next one)
      assert.match(await total(), /^Total\s*5\s*incl\. 3 borrowed/);
    });

    await step("a move for good from the Manpower List ends the loan", async () => {
      await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      await p.locator('#emplist-body tr[data-emp-id="e1"]').click({ button: "right" });
      assert.ok((await menuLabels()).includes("Move to board"));
      await item("Move to board").click();
      await item("Board Two").click();
      await p.waitForFunction(() => D().employees.find((e) => e.id === "e1").boardId === "b2");
      assert.equal(loans("e1").length, 0);
    });

    await step("in Thai, the Lend dialog leaves no English behind", async () => {
      await open("b1", SRC);
      await p.evaluate(() => I18N.setLang("th"));
      await p.evaluate(() => openLendModal(["e6"]));
      await dlg.waitFor({ state: "visible" });
      await p.fill("#lend-until", D1);
      await p.waitForTimeout(200);
      const shown = await p.evaluate(() => {
        const el = document.querySelector("#modal-lend");
        const attrs = [...el.querySelectorAll("[title],[aria-label],[placeholder]")].map((x) => [x.title, x.getAttribute("aria-label"), x.placeholder].join(" "));
        return el.innerText + "\n" + attrs.join("\n");
      });
      const english = shown.replace(/Board (One|Two)|Person [A-J]|undefined|null/g, "").match(/[A-Za-z]{2,}/g) || [];
      assert.deepEqual(english, [], shown);
      await p.keyboard.press("Escape");
      await p.evaluate(() => I18N.setLang("en"));
    });

    await step("without the loans table nothing changes: Move to board stays, no With crew", async () => {
      const db2 = new h.FakeDb({ loans: false });
      h.seedBase(db2, { src: SRC });
      const b = await env.openAs(db2, h.USERS.a);
      await b.page.evaluate((d) => { state.date = d; state.unlockedDates.add(d); return refreshAndRender(); }, SRC);
      await b.page.locator('.emp-card[data-emp-id="e3"]').first().click({ button: "right" });
      const labels = (await b.page.locator("#context-menu .ctx-item").allInnerTexts()).map((s) => s.trim());
      assert.ok(labels.includes("Move to board") && !labels.includes("Lend to board…"), labels.join(" | "));
      await b.page.keyboard.press("Escape");
      await b.page.evaluate(() => openMoveMissionModal("s101", "b2"));
      await b.page.locator("#modal-move-mission:not(.hidden)").waitFor();
      assert.equal(await b.page.locator("#move-mission-with-crew").isVisible(), false);
      assert.deepEqual(b.errors, []);
      await b.close();
    });

    await step("no page errors", async () => {
      assert.deepEqual(a.errors, []);
    });
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
})();
