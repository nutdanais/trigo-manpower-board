/* Acceptance run for the adjustable available-employee panel, driving the real
   app in Chromium against the shared fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/pool-resize.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 5).join("\n   ")); throw e; }
}

/* how many cards sit on the first row of the Standby list = number of columns */
const columns = (p) => p.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-pool="standby"] .emp-card')];
  const top = cards[0].getBoundingClientRect().top;
  return cards.filter((c) => Math.abs(c.getBoundingClientRect().top - top) < 2).length;
});
const panelWidth = (p) => p.evaluate(() => document.querySelector("#float-pool").getBoundingClientRect().width);

(async () => {
  const env = await h.launch();
  try {
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    // plenty of unassigned permanent staff so Standby is a long list
    const extra = [];
    for (let i = 20; i < 60; i++) extra.push({ id: "x" + i, name_th: "Spare " + i, contract: "permanent", area_id: "area-1", board_id: "b1" });
    db.seed("employees", db.t("employees").concat(extra));
    const a = await env.openAs(db, h.USERS.a, { viewport: { width: 2000, height: 1000 } });
    const p = a.page;
    await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);

    await step("starts at the original 264px with only one or two columns of cards", async () => {
      assert.equal(await panelWidth(p), 264);
      assert.equal(await p.locator("#fp-resizer").isVisible(), true);
      // (one with a classic scrollbar, two with an overlay one like headless Chromium)
      assert.ok((await columns(p)) <= 2);
    });

    await step("dragging the handle left widens the panel, the cards wrap and the board follows", async () => {
      const box = await p.locator("#fp-resizer").boundingBox();
      const y = box.y + box.height / 2;
      await p.mouse.move(box.x + box.width / 2, y);
      await p.mouse.down();
      await p.mouse.move(2000 - 560, y, { steps: 8 });
      await p.mouse.up();
      assert.equal(await panelWidth(p), 560);
      assert.ok((await columns(p)) >= 4, "expected 4+ columns at 560px");
      const margin = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector("#app-root")).marginRight));
      assert.equal(margin, 560);
      await p.screenshot({ path: "/tmp/pool-resize.png" });
    });

    await step("the width is clamped to the 264px minimum and the maximum", async () => {
      await p.focus("#fp-resizer");
      for (let i = 0; i < 40; i++) await p.keyboard.press("ArrowRight");
      assert.equal(await panelWidth(p), 264);
      await p.keyboard.press("End");
      assert.equal(await panelWidth(p), 760);   // min(760, 60% of 2000)
    });

    await step("the width survives a reload", async () => {
      await p.keyboard.press("Home");
      await p.keyboard.press("Shift+ArrowLeft");
      assert.equal(await panelWidth(p), 384);
      await p.reload();
      await p.waitForSelector("#board-tabs .board-tab");
      await p.waitForSelector('[data-pool="standby"] .emp-card');
      assert.equal(await panelWidth(p), 384);
    });

    await step("double-click on the handle resets it", async () => {
      await p.locator("#fp-resizer").dblclick();
      assert.equal(await panelWidth(p), 264);
    });

    await step("no handle on a narrow (stacked) layout", async () => {
      await p.setViewportSize({ width: 800, height: 900 });
      assert.equal(await p.locator("#fp-resizer").isVisible(), false);
    });

    assert.deepEqual(a.errors, [], "no console errors");
  } finally {
    await env.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
