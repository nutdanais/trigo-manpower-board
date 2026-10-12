/* Acceptance run for Hide/Unhide missions: the dialog (grouped list with the
   missions that have no crew suggested first, search, filters, what Save will
   do), the card's own Hide on a mission with no crew (with Undo), the toolbar's
   no-crew count, and the full-screen dialog on a phone. Real app in Chromium
   against the shared fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/hide-missions.e2e.js
   Seed: harness.seedBase (101 and 102 day with crew, 103 night with crew) plus
   104 with nobody on it and 105 already hidden. Exits non-zero on the first
   failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;

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
      { id: "s104", board_id: "b1", plan_date: SRC, number: "104", host: "Host Beta", customer: "Cust Gamma", shift: "day", engineer_id: "eng-2" },
      { id: "s105", board_id: "b1", plan_date: SRC, number: "105", host: "Host Gamma", customer: "Cust Beta", shift: "day", engineer_id: "eng-1", hidden: true },
    ]);
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    // SRC is today or earlier, so it opens read-only; unlock it as "Edit anyway" would
    const openDay = (unlock) => p.evaluate(([d, u]) => { state.date = d; if (u) state.unlockedDates.add(d); else state.unlockedDates.delete(d); return refreshAndRender(); }, [SRC, unlock]);
    await openDay(true);

    const card = (num) => p.locator("#missions-grid .mission-card", { has: p.locator(".m-number", { hasText: num }) });
    const badge = p.locator("#btn-hide-missions .hide-empty-badge");
    const dlg = p.locator("#modal-hide-missions");
    const groupRows = (title) => dlg.locator(".hm-group", { has: p.locator(".hm-group-title", { hasText: new RegExp("^" + title) }) }).locator(".hm-no");
    const summary = () => p.locator("#hide-missions-summary").innerText();

    await step("the toolbar counts the missions on the board with no crew", async () => {
      assert.equal(await badge.innerText(), "1");
      assert.match(await p.locator("#btn-hide-missions").innerText(), /Hidden 1/);
      assert.match(await p.locator("#btn-hide-missions").getAttribute("title"), /1 mission has no crew/);
    });

    await step("only the card with no crew offers Hide, in its body", async () => {
      assert.equal(await card("104").locator(".mission-body .m-empty .m-empty-hide").count(), 1);
      assert.match(await card("104").locator(".m-empty-hint").innerText(), /No crew yet/);
      for (const n of ["101", "102", "103"]) assert.equal(await card(n).locator(".m-empty").count(), 0, n);
      assert.equal(await card("104").locator(".mission-header .m-empty-hide").count(), 0, "not in the header");
    });

    await step("a read-only day shows no Hide on the card", async () => {
      await openDay(false);
      assert.equal(await p.locator("#missions-grid .m-empty").count(), 0);
      await openDay(true);
      assert.equal(await card("104").locator(".m-empty").count(), 1);
    });

    await step("Hide on the card takes the mission off at once, and Undo puts it back", async () => {
      await card("104").locator(".m-empty-hide").click();
      await p.waitForFunction(() => ![...document.querySelectorAll("#missions-grid .m-number")].some((e) => e.textContent === "104"));
      assert.equal(db.t("missions").find((m) => m.id === "s104").hidden, true);
      assert.equal(await badge.count(), 0, "no empty missions left on the board");
      assert.match(await p.locator("#btn-hide-missions").innerText(), /Hidden 2/);
      const t = p.locator(".toast", { hasText: "104 hidden" });
      await t.locator(".toast-action", { hasText: "Undo" }).click();
      await card("104").waitFor();
      assert.equal(db.t("missions").find((m) => m.id === "s104").hidden, false);
      assert.equal(await badge.innerText(), "1");
    });

    await step("the dialog suggests the mission with no crew first, then the board, then hidden", async () => {
      await p.click("#btn-hide-missions");
      await dlg.waitFor({ state: "visible" });
      assert.deepEqual(await groupRows("Suggested").allInnerTexts(), ["104"]);
      assert.deepEqual(await groupRows("On the board").allInnerTexts(), ["101", "102", "103"]);
      assert.deepEqual(await groupRows("Hidden").allInnerTexts(), ["105"]);
      assert.equal(await summary(), "No changes yet.");
      assert.equal(await p.locator("#btn-hide-missions-save").isDisabled(), true);
    });

    await step("search and the No crew filter narrow the list", async () => {
      await p.fill("#hide-missions-q", "cust beta");
      assert.deepEqual(await dlg.locator(".hm-no").allInnerTexts(), ["102", "105"]);
      await p.fill("#hide-missions-q", "");
      await dlg.locator('.hm-filter[data-f="empty"]').click();
      assert.deepEqual(await dlg.locator(".hm-no").allInnerTexts(), ["104"]);
      await dlg.locator('.hm-filter[data-f="all"]').click();
      assert.equal(await dlg.locator(".hm-row").count(), 5);
    });

    await step("ticking tags rows in place and the footer says what Save will do", async () => {
      await dlg.locator(".hm-select", { hasText: "Select all 1" }).click();
      assert.equal(await summary(), "Hide 1 · nobody returns to Standby");
      await dlg.locator('.hm-row[data-id="s101"] input').check();
      assert.match(await dlg.locator('.hm-row[data-id="s101"] .hm-tag').innerText(), /Will hide · 2 → Standby/);
      assert.deepEqual(await groupRows("On the board").allInnerTexts(), ["101", "102", "103"], "row did not move");
      await dlg.locator('.hm-row[data-id="s105"] input').uncheck();
      assert.equal(await summary(), "Hide 2 · Unhide 1 · 2 people return to Standby");
      assert.equal(await dlg.locator(".hm-select").innerText(), "Clear selection");
    });

    await step("Save hides, unhides and returns the crew to Standby", async () => {
      await p.click("#btn-hide-missions-save");
      await dlg.waitFor({ state: "hidden" });
      const hidden = (id) => db.t("missions").find((m) => m.id === id).hidden;
      assert.equal(hidden("s101"), true);
      assert.equal(hidden("s104"), true);
      assert.equal(hidden("s105"), false);
      assert.equal(db.t("assignments").filter((r) => r.mission_id === "s101").length, 0);
      await card("105").waitFor();
      assert.equal(await card("101").count(), 0);
    });

    await step("a viewer sees no Hide on cards and no toolbar button", async () => {
      const v = await env.openAs(db, h.USERS.v);
      await v.page.evaluate((d) => { state.date = d; state.unlockedDates.add(d); return refreshAndRender(); }, SRC);
      assert.equal(await v.page.locator("#missions-grid .m-empty").count(), 0);
      assert.equal(await v.page.locator("#btn-hide-missions").isVisible(), false);
      assert.deepEqual(v.errors, []);
      await v.close();
    });

    await step("on a phone the dialog fills the screen", async () => {
      const m = await env.openAs(db, h.USERS.a, { viewport: { width: 390, height: 780 } });
      await m.page.evaluate((d) => { state.date = d; state.unlockedDates.add(d); return refreshAndRender(); }, SRC);
      await m.page.evaluate(() => openHideMissionsModal());
      const box = await m.page.locator("#modal-hide-missions").boundingBox();
      assert.ok(box && Math.round(box.x) === 0 && Math.round(box.y) === 0, "pinned to the corner");
      assert.equal(Math.round(box.width), 390);
      assert.equal(Math.round(box.height), 780);
      assert.equal(await m.page.locator("#btn-hide-missions-save").isVisible(), true, "Save stays on screen");
      assert.deepEqual(m.errors, []);
      await m.close();
    });

    await step("on a desktop the dialog is wide", async () => {
      await p.click("#btn-hide-missions");
      const box = await dlg.boundingBox();
      assert.equal(Math.round(box.width), 920);
    });

    await step("no page errors", async () => { assert.deepEqual(a.errors, []); });
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
})();
