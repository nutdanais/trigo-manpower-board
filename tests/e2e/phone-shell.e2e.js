/* Acceptance run for the phone layout (styles.css "Phone shell"): the light top
   bar, the navy bottom bar with More, the available-people drawer, and
   full-screen record dialogs — at a 390px phone width.
     NODE_PATH=$(npm root -g) node tests/e2e/phone-shell.e2e.js
   Pass SHOTS=<dir> to also save screenshots. Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
const SHOTS = process.env.SHOTS;

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 5).join("\n   ")); throw e; }
}
const shot = (p, name) => SHOTS ? p.screenshot({ path: path.join(SHOTS, name + ".png") }) : null;
const visible = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); if (!el || getComputedStyle(el).visibility === "hidden") return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, sel);
const navLabels = (p) => p.$$eval("#bottom-nav .bn-item .bn-label", (els) => els.map((e) => e.textContent));
const activeNav = (p) => p.$eval("#bottom-nav .bn-item.active .bn-label", (e) => e.textContent);
const tapNav = (p, label) => p.locator("#bottom-nav .bn-item", { hasText: label }).click();
const rect = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, width: r.width }; });

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);

    await step("the header tabs give way to a bottom bar: Board, Overview, Manpower, Host, More", async () => {
      assert.equal(await visible(p, "#board-tabs"), false);
      assert.equal(await visible(p, "#bottom-nav"), true);
      assert.deepEqual(await navLabels(p), ["Board", "Overview", "Manpower", "Host", "More"]);
      assert.equal(await activeNav(p), "Board");
      const nav = await rect(p, "#bottom-nav");
      assert.ok(Math.abs(nav.bottom - 844) < 1, "pinned to the bottom edge");
    });

    await step("the top bar is one light row plus the board name as a large title", async () => {
      assert.equal(await visible(p, "#app-logo"), false);
      assert.equal(await visible(p, "#btn-settings"), false);
      assert.equal(await visible(p, "#btn-date"), true);
      const fs = await p.$eval("#btn-board-dd", (e) => parseFloat(getComputedStyle(e).fontSize));
      assert.ok(fs >= 20, "large title, got " + fs);
      assert.equal(await p.$eval("#board-dd-label", (e) => e.textContent), "Board One");
      assert.ok((await rect(p, "#topbar")).height < 110, "top bar stays compact");
      await shot(p, "1-board");
    });

    await step("the page never scrolls sideways", async () => {
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 390));
    });

    await step("New Mission floats above the drawer's peek", async () => {
      assert.equal(await p.$eval("#btn-new-mission", (e) => getComputedStyle(e).position), "fixed");
      const fab = await rect(p, "#btn-new-mission"), pool = await rect(p, "#float-pool");
      assert.ok(fab.bottom <= pool.top, "FAB clears the drawer");
    });

    await step("the drawer peeks with the counts, opens, and closes again", async () => {
      const pool = await rect(p, "#float-pool");
      assert.ok(pool.height <= 60, "peek only, got " + pool.height);
      assert.match(await p.textContent("#fp-drawer-sum"), /Standby \d+ · On-call \d+/);
      assert.equal(await visible(p, "#emp-search"), false, "contents hidden while closed");
      await p.click("#fp-drawer-handle");
      await p.waitForTimeout(350);
      assert.ok((await rect(p, "#float-pool")).height > 400, "opened");
      assert.equal(await p.getAttribute("#fp-drawer-handle", "aria-expanded"), "true");
      assert.equal(await visible(p, "#emp-search"), true);
      await shot(p, "2-drawer-open");
    });

    await step("picking someone turns the handle into Place, which closes the drawer to show the missions", async () => {
      const card = p.locator('#float-pool [data-pool="standby"] .emp-card').first();
      const id = await card.getAttribute("data-emp-id");
      await card.click();
      assert.equal(await p.textContent("#fp-drawer-handle .fp-drawer-cue"), "Place");
      await p.click("#fp-drawer-handle");
      await p.waitForTimeout(350);
      assert.ok((await rect(p, "#float-pool")).height <= 60, "closed");
      await shot(p, "3-placing");
      await p.locator(".mission-body.dropzone").first().click({ position: { x: 8, y: 8 } });
      // today's plan is already running, so the app asks before editing it
      if (await visible(p, "#modal-confirm")) await p.click("#btn-confirm-yes");
      await p.waitForTimeout(400);
      assert.ok(await p.evaluate((i) => !!document.querySelector(`.mission-body .emp-card[data-emp-id="${i}"]`), id), "placed on the mission");
    });

    await step("Manpower and back to the board through the bottom bar", async () => {
      await tapNav(p, "Manpower");
      assert.equal(await activeNav(p), "Manpower");
      assert.equal(await visible(p, "#emplist-panel"), true);
      assert.equal(await visible(p, "#float-pool"), false);
      await tapNav(p, "Board");
      assert.equal(await activeNav(p), "Board");
      assert.equal(await visible(p, "#missions-grid"), true);
    });

    await step("More holds Org Chart, Lock, Settings and Sign out; Settings hides the bar", async () => {
      await tapNav(p, "More");
      assert.equal(await visible(p, "#more-menu"), true);
      const items = await p.$$eval("#more-menu .tb-item", (els) => els.map((e) => e.textContent.trim()));
      for (const want of ["Org Chart", "Settings", "Sign out"]) assert.ok(items.includes(want), want + " in " + items);
      assert.ok(items.some((t) => /Lock this board|Unlock this board/.test(t)), "Lock in " + items);
      await shot(p, "4-more");
      await p.evaluate(() => document.body.click());
      assert.equal(await visible(p, "#more-menu"), false, "a tap elsewhere closes it");
      await tapNav(p, "More");
      await p.locator("#more-menu .tb-item", { hasText: "Settings" }).click();
      assert.ok(await p.evaluate(() => document.body.classList.contains("settings-open")));
      assert.equal(await visible(p, "#bottom-nav"), false);
      await p.click("#btn-settings-back-icon").catch(() => p.click("#btn-settings-back"));
      assert.equal(await visible(p, "#bottom-nav"), true);
    });

    await step("a record dialog opens full screen with its Save in view", async () => {
      await p.click("#btn-new-mission");
      await p.waitForSelector("#modal-mission:not(.hidden)");
      await p.waitForTimeout(350);
      const m = await rect(p, "#modal-mission");
      assert.ok(m.height >= 840 && m.top <= 1, "full screen, got " + JSON.stringify(m));
      const save = await rect(p, "#modal-mission .modal-actions");
      assert.ok(save.bottom <= 844 + 1, "Save row on screen");
      await shot(p, "5-mission-form");
    });

    await step("no errors in the page", async () => {
      assert.deepEqual(a.errors, []);
    });

    await step("desktop is unchanged: no bottom bar, header tabs back", async () => {
      await p.keyboard.press("Escape");
      await p.setViewportSize({ width: 1400, height: 900 });
      assert.equal(await visible(p, "#bottom-nav"), false);
      assert.equal(await visible(p, "#board-tabs"), true);
      assert.equal(await visible(p, "#fp-drawer-handle"), false);
    });
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
})();
