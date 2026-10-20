/* Acceptance run for the mission card's quick panel and Move/Copy mission, plus
   click-again-to-unselect on employee cards. Real app in Chromium against the
   shared fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/mission-menu.e2e.js
   Seed: harness.seedBase (Board One: 101 day with A and B, 102 day with C, 103
   night with D; E on annual leave; F standby) plus 104 with nobody on it; Board
   Two with 201 and a hidden 202; Board Three with nothing on the day but a plan
   on the working day before; Board Four, which never works. Exits non-zero on
   the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
const PREV = h.prevWorking(SRC);
const FC = h.nextWorking(h.nextWorking(h.nextWorking(T)));   // past the confirm horizon: a forecast date

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
    db.seed("boards", [
      { id: "b3", name: "Board Three", weekend_days: [0, 6] },
      { id: "b4", name: "Board Four", weekend_days: [0, 1, 2, 3, 4, 5, 6] },
    ]);
    db.seed("missions", [
      { id: "s104", board_id: "b1", plan_date: SRC, number: "104", host: "Host Beta", customer: "Cust Gamma", shift: "day", engineer_id: "eng-2" },
      { id: "s201", board_id: "b2", plan_date: SRC, number: "201", host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" },
      { id: "s202", board_id: "b2", plan_date: SRC, number: "202", host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1", hidden: true },
      { id: "s301", board_id: "b3", plan_date: PREV, number: "301", host: "Host Gamma", customer: "Cust Gamma", shift: "day", engineer_id: "eng-2" },
    ]);
    db.seed("forecast_missions", [
      { id: "f901", board_id: "b1", plan_date: FC, number: "901", host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1", created_by: "eng.a@example.com" },
    ]);
    db.t("hosts").find((x) => x.name === "Host Alpha").location = "Laem Chabang Industrial Estate";

    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    await a.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: env.base });
    const openDay = (d, unlock = true) => p.evaluate(([d, u]) => { state.date = d; if (u) state.unlockedDates.add(d); return refreshAndRender(); }, [d, unlock]);
    const goBoard = (id) => p.evaluate((id) => { D().activeBoardId = id; return refreshAndRender(); }, id);
    await openDay(SRC);

    const card = (num) => p.locator("#missions-grid .mission-card", { has: p.locator(".m-number", { hasText: new RegExp("^" + num + "$") }) });
    const emp = (id) => p.locator(`.emp-card[data-emp-id="${id}"]`).first();
    const menu = p.locator("#context-menu");
    // starts-with and case-sensitive: "Hide mission" must not also match "Hide/Unhide missions…"
    const item = (label) => menu.locator(".ctx-item", { hasText: new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    const menuLabels = async () => (await menu.locator(".ctx-item").allInnerTexts()).map((s) => s.trim());
    const rightClick = async (num) => { await card(num).locator(".mission-header .m-line2").click({ button: "right" }); await menu.waitFor(); };
    const selected = () => p.evaluate(() => [...state.selectedEmps].sort());
    const mission = (id) => db.t("missions").find((m) => m.id === id);
    const assigned = (empId) => db.t("assignments").find((x) => x.employee_id === empId && x.plan_date === SRC);

    await step("clicking a selected card again unselects it", async () => {
      await emp("e1").click();
      assert.deepEqual(await selected(), ["e1"]);
      await emp("e1").click();
      assert.deepEqual(await selected(), []);
      assert.equal(await emp("e1").evaluate((el) => el.classList.contains("selected")), false);
    });

    await step("in a group, clicking a selected card takes only that one out", async () => {
      await emp("e1").click();
      await emp("e2").click({ modifiers: ["Control"] });
      await emp("e3").click({ modifiers: ["Control"] });
      assert.deepEqual(await selected(), ["e1", "e2", "e3"]);
      await emp("e2").click();
      assert.deepEqual(await selected(), ["e1", "e3"]);
      await emp("e6").click();   // a plain click on an unselected card still replaces
      assert.deepEqual(await selected(), ["e6"]);
      await emp("e6").click();
    });

    await step("double-click still opens Edit Employee, and its second click doesn't unselect", async () => {
      await p.evaluate(() => clearSelection());
      await emp("e6").click();
      assert.deepEqual(await selected(), ["e6"]);
      // the browser's second click of a double-click carries detail 2
      await emp("e6").evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 })));
      assert.deepEqual(await selected(), ["e6"]);
      await emp("e6").dispatchEvent("dblclick");
      await p.locator("#modal-employee:not(.hidden)").waitFor();
      await p.keyboard.press("Escape");
      await p.evaluate(() => clearSelection());
    });

    await step("right-click on a mission opens its quick panel", async () => {
      await rightClick("101");
      assert.match(await menu.locator(".ctx-title").innerText(), /101 · Day · 2 crew/);
      assert.deepEqual(await menuLabels(), ["Edit mission", "Duplicate mission", "Move or copy to board", "Crew",
        "Copy as text", "Open host location", "Hide mission", "Hide/Unhide missions…", "Delete mission"]);
      await p.keyboard.press("Escape");
    });

    await step("right-click on a person inside a mission keeps the person's own menu", async () => {
      await card("101").locator('.emp-card[data-emp-id="e1"]').click({ button: "right" });
      assert.match(await menu.locator(".ctx-title").innerText(), /Person A/);
      await p.keyboard.press("Escape");
      await p.evaluate(() => clearSelection());
    });

    await step("Copy as text puts the mission on the clipboard", async () => {
      await rightClick("101");
      await item("Copy as text").click();
      await p.locator(".toast", { hasText: "101 copied" }).waitFor();
      const text = await p.evaluate(() => navigator.clipboard.readText());
      assert.match(text, /^Board One · /);
      assert.match(text, /101 \| Host Alpha → Cust Alpha/);
      assert.match(text, /Day 08:00–17:00 · Engineer: Eng One/);
      assert.match(text, /Map: https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Laem%20Chabang/);
      assert.match(text, /Crew \(2\): Person A, Person B/);
    });

    await step("Duplicate opens New Mission filled in from it, number blank", async () => {
      await rightClick("102");
      await item("Duplicate mission").click();
      await p.locator("#modal-mission:not(.hidden)").waitFor();
      assert.equal(await p.locator("#mission-modal-title").innerText(), "New Mission");
      assert.equal(await p.inputValue("#form-mission [name=number]"), "");
      assert.equal(await p.inputValue("#form-mission [name=host]"), "Host Beta");
      assert.equal(await p.inputValue("#form-mission [name=customer]"), "Cust Beta");
      await p.fill("#form-mission [name=number]", "102B");
      await p.click("#form-mission button[type=submit]");
      await card("102B").waitFor();
      const dup = db.t("missions").find((m) => m.number === "102B");
      assert.equal(dup.host, "Host Beta");
      assert.equal(dup.board_id, "b1");
    });

    await step("Crew › Select crew selects everyone on the mission", async () => {
      await rightClick("101");
      await item("Crew").click();
      await item("Select crew (2)").click();
      assert.deepEqual(await selected(), ["e1", "e2"]);
      await p.evaluate(() => clearSelection());
    });

    await step("Place N selected here assigns the selection", async () => {
      await emp("e6").click();
      await rightClick("104");
      await item("Place 1 selected here").click();
      await p.waitForFunction(() => document.querySelectorAll("#missions-grid .mission-card .emp-card").length >= 5);
      assert.equal(assigned("e6").mission_id, "s104");
    });

    await step("Crew › Return crew to Standby asks first, then unassigns", async () => {
      await rightClick("104");
      await item("Crew").click();
      await item("Return crew to Standby").click();
      await p.click("#btn-confirm-yes");
      await p.waitForFunction(() => !state.selectedEmps.size);
      await p.waitForTimeout(300);
      assert.equal(assigned("e6"), undefined);
    });

    await step("Hide on a mission with crew asks first, and its crew return to Standby", async () => {
      await rightClick("102");
      await item("Hide mission").click();
      await p.locator("#modal-confirm:not(.hidden)").waitFor();
      await p.click("#btn-confirm-yes");
      await card("102").waitFor({ state: "detached" });
      assert.equal(mission("s102").hidden, true);
      assert.equal(assigned("e3"), undefined);
    });

    await step("Move or copy lists the other boards, and says why one can't take it", async () => {
      await rightClick("101");
      await item("Move or copy to board").click();
      const rows = await menuLabels();
      assert.deepEqual(rows, ["Move or copy to board", "Board Two", "Board Three", "Board Four\nNot working"]);
      assert.equal(await item("Board Four").evaluate((el) => el.classList.contains("ctx-off")), true);
      await item("Board Four").click();   // does nothing, the menu stays open
      assert.equal(await menu.isVisible(), true);
      await item("Board Two").click();
      await p.locator("#modal-move-mission:not(.hidden)").waitFor();
    });

    const dlg = p.locator("#modal-move-mission");
    const note = p.locator("#move-mission-num-note");
    const go = p.locator("#btn-move-mission");

    await step("the Move dialog checks the number against the other board, hidden missions included", async () => {
      assert.match(await dlg.locator("h3").innerText(), /Move or copy 101/);
      assert.equal(await dlg.locator(".mm-board[aria-pressed=true] b").innerText(), "Board Two");
      assert.equal(await dlg.locator(".mm-board", { hasText: "Board Four" }).isDisabled(), true);
      await p.waitForFunction(() => !document.querySelector("#btn-move-mission").disabled);
      assert.match(await p.locator("#move-mission-summary").innerText(), /Move 101 to Board Two · 2 people return to Standby/);
      assert.match(await p.locator("#move-mission-crew-hint").innerText(), /Person, Person return to Standby on Board One/);
      await p.fill("#move-mission-number", "201");
      assert.match(await note.innerText(), /201 is already on Board Two's Day shift/);
      assert.equal(await go.isDisabled(), true);
      await p.fill("#move-mission-number", "202");
      assert.match(await note.innerText(), /202 is a hidden mission on Board Two/);
      assert.equal(await go.isDisabled(), true);
      await p.fill("#move-mission-number", "205");
      assert.match(await note.innerText(), /Free on Board Two's Day shift/);
      assert.equal(await go.isDisabled(), false);
    });

    await step("Move takes the mission to the other board, renamed, crew back to Standby", async () => {
      await go.click();
      await p.locator(".toast", { hasText: "205 moved to Board Two" }).waitFor();
      assert.equal(mission("s101").board_id, "b2");
      assert.equal(mission("s101").number, "205");
      assert.equal(assigned("e1"), undefined);
      assert.equal(assigned("e2"), undefined);
      assert.equal(await card("101").count(), 0);
      await p.locator(".toast .toast-action", { hasText: "Go to Board Two" }).click();
      await card("205").waitFor();
      assert.equal(await card("205").locator(".emp-card").count(), 0);
      await goBoard("b1");
    });

    await step("Copy keeps the original and its crew", async () => {
      await rightClick("103");
      await item("Move or copy to board").click();
      await item("Board Two").click();
      await p.waitForFunction(() => !document.querySelector("#btn-move-mission").disabled);
      await dlg.locator("input[name=mode][value=copy]").check();
      assert.equal(await go.innerText(), "Copy");
      assert.match(await p.locator("#move-mission-crew-hint").innerText(), /stays on 103 on Board One/);
      await go.click();
      await p.locator(".toast", { hasText: "103 copied to Board Two" }).waitFor();
      const rows = db.t("missions").filter((m) => m.number === "103" && m.plan_date === SRC);
      assert.deepEqual(rows.map((m) => m.board_id).sort(), ["b1", "b2"]);
      assert.equal(rows.find((m) => m.board_id === "b2").shift, "night");
      assert.equal(assigned("e4").mission_id, "s103");
    });

    await step("an untouched day on the other board is carried over first", async () => {
      await rightClick("104");
      await item("Move or copy to board").click();
      await item("Board Three").click();
      await p.locator("#move-mission-carry:not(.hidden)").waitFor();
      assert.match(await p.locator("#move-mission-carry-text").innerText(), /Board Three has no plan for .* yet\. Carry over its last working day/);
      assert.match(await p.locator("#move-mission-summary").innerText(), /after carrying over/);
      await dlg.locator("input[name=det][value=edit]").check();
      await go.click();
      // Edit after moving: lands on Board Three with the mission open
      await p.locator("#modal-mission:not(.hidden)").waitFor();
      assert.equal(await p.evaluate(() => D().activeBoardId), "b3");
      assert.equal(await p.inputValue("#form-mission [name=number]"), "104");
      await p.keyboard.press("Escape");
      const b3 = db.t("missions").filter((m) => m.board_id === "b3" && m.plan_date === SRC).map((m) => m.number).sort();
      assert.deepEqual(b3, ["104", "301"]);
      await goBoard("b1");
    });

    await step("Delete asks first, then removes the mission", async () => {
      await rightClick("102B");
      await item("Delete mission").click();
      await p.click("#btn-confirm-yes");
      await card("102B").waitFor({ state: "detached" });
      assert.equal(db.t("missions").find((m) => m.number === "102B"), undefined);
    });

    await step("the mission form's own Delete and Hide still work", async () => {
      await card("103").locator(".mission-header .m-line2").click();
      await p.locator("#modal-mission:not(.hidden)").waitFor();
      await p.click("#btn-hide-mission");
      await p.click("#btn-confirm-yes");
      await card("103").waitFor({ state: "detached" });
      assert.equal(mission("s103").hidden, true);
    });

    await step("on a forecast date: no Move, Crew or Hide", async () => {
      await openDay(FC);
      await rightClick("901");
      const labels = await menuLabels();
      assert.deepEqual(labels, ["Edit mission", "Duplicate mission", "Copy as text", "Open host location", "Delete mission"]);
      await p.keyboard.press("Escape");
      await openDay(SRC);
    });

    await step("a viewer gets only Copy as text and Open host location", async () => {
      const v = await env.openAs(db, h.USERS.v);
      // Board One has been emptied by now; Board Two still has 201
      await v.page.evaluate((d) => { state.date = d; D().activeBoardId = "b2"; return refreshAndRender(); }, SRC);
      await v.page.locator("#missions-grid .mission-card", { hasText: "201" }).first().locator(".mission-header .m-line2").click({ button: "right" });
      const labels = (await v.page.locator("#context-menu .ctx-item").allInnerTexts()).map((s) => s.trim());
      assert.deepEqual(labels, ["Copy as text", "Open host location"]);
      assert.deepEqual(v.errors, []);
      await v.close();
    });

    await step("on a phone, holding the mission header opens the panel", async () => {
      const ph = await env.openAs(db, h.USERS.a, { viewport: { width: 390, height: 844 }, touch: true });
      await ph.page.evaluate((d) => { state.date = d; state.unlockedDates.add(d); D().activeBoardId = "b2"; return refreshAndRender(); }, SRC);
      const head = ph.page.locator("#missions-grid .mission-card", { hasText: "201" }).first().locator(".mission-header");
      await head.scrollIntoViewIfNeeded();
      const box = await head.boundingBox();
      const x = box.x + 20, y = box.y + box.height - 8;
      const cdp = await ph.ctx.newCDPSession(ph.page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await ph.page.waitForTimeout(700);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await ph.page.locator("#context-menu:not(.hidden)").waitFor();
      assert.match(await ph.page.locator("#context-menu .ctx-title").innerText(), /201/);
      assert.equal(await ph.page.locator("#modal-mission:not(.hidden)").count(), 0, "the release did not also open Edit");
      await ph.close();
    });

    await step("in Thai, the panel and the Move dialog leave no English behind", async () => {
      await goBoard("b2");
      const before = new Set(await p.evaluate(() => I18N.missing()));
      await p.evaluate(() => I18N.setLang("th"));
      await card("201").locator(".mission-header .m-line2").click({ button: "right" });
      await menu.waitFor();
      assert.match(await menu.innerText(), /แก้ไขมิชชั่น/);
      await menu.locator(".ctx-sub").first().click();   // Move or copy to board
      await p.waitForTimeout(150);
      await p.keyboard.press("Escape");
      await p.evaluate(() => openMoveMissionModal("s201", "b1"));
      await p.waitForFunction(() => !document.querySelector("#btn-move-mission").disabled);
      await p.fill("#move-mission-number", "205");   // a clash on Board One? no: a free number
      await p.fill("#move-mission-number", "");
      await p.fill("#move-mission-number", "9");
      await dlg.locator("input[name=det][value=edit]").check();
      await p.waitForTimeout(300);
      // every word the dialog shows (text, tooltips, labels) is Thai, except data
      // people typed (board, host, customer names, numbers) and PPE / LINE
      const shown = await p.evaluate(() => {
        const el = document.querySelector("#modal-move-mission");
        const attrs = [...el.querySelectorAll("[title],[aria-label],[placeholder]")].map((x) => [x.title, x.getAttribute("aria-label"), x.placeholder].join(" "));
        return el.innerText + "\n" + attrs.join("\n");
      });
      console.log(shown);
      const english = shown.replace(/Board (One|Two|Three|Four)|Host (Alpha|Beta|Gamma)|Cust (Alpha|Beta|Gamma)|Eng (One|Two)|PPE|LINE|undefined|null/g, "")
        .match(/[A-Za-z]{2,}/g) || [];
      assert.deepEqual(english, []);
      await p.keyboard.press("Escape");
      await p.evaluate(() => I18N.setLang("en"));
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
