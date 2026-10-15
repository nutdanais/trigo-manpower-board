/* Acceptance run for the English / Thai language switch: the selector in the
   avatar menu, the whole screen turning Thai (text, tooltips, placeholders, dates),
   typed data left alone, the choice kept after a reload, and back to English
   restoring every string. Also on a phone, where the switch lives in "Me".
     NODE_PATH=$(npm root -g) node tests/e2e/language.e2e.js */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 5).join("\n   ")); throw e; }
}
const text = (p, sel) => p.$eval(sel, (e) => e.textContent.trim());

(async () => {
  const env = await h.launch();
  try {
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);

    await step("English is the default and the avatar menu offers ไทย / English", async () => {
      assert.equal(await p.evaluate(() => document.documentElement.lang), "en");
      await p.click("#btn-avatar");
      assert.deepEqual(await p.$$eval("#user-menu .tb-seg-btn", (els) => els.map((e) => e.textContent)), ["ไทย", "English"]);
      assert.equal(await text(p, "#user-menu .tb-seg-btn.active"), "English");
      assert.equal(await text(p, "#btn-signout"), "Sign out");
    });

    await step("choosing ไทย translates the menu, the board chrome, tooltips and dates", async () => {
      await p.click("#user-menu .tb-seg-btn[data-lang=th]");
      assert.equal(await p.evaluate(() => document.documentElement.lang), "th");
      assert.equal(await text(p, "#btn-signout"), "ออกจากระบบ");
      assert.equal(await text(p, "#btn-settings"), "ตั้งค่า");
      assert.equal(await text(p, "#user-menu .tb-seg-btn.active"), "ไทย");
      assert.equal(await p.getAttribute("#btn-date-prev", "aria-label"), "วันก่อนหน้า");
      assert.match(await text(p, "#btn-date"), /[ก-๙]/, "the date button is in Thai");
      assert.equal(await p.evaluate(() => localStorage.getItem("manpower.lang")), "th");
    });

    await step("names people typed in are left as written", async () => {
      await p.keyboard.press("Escape");
      assert.ok((await p.$$eval(".emp-name", (els) => els.map((e) => e.textContent))).includes("Person"), "names still read Person");
      assert.ok(await p.locator("#board-tabs", { hasText: "Board One" }).count() || await p.locator("#board-dd-label", { hasText: "Board One" }).count());
    });

    await step("new content drawn after the switch is translated too (Settings page)", async () => {
      await p.click("#btn-avatar");
      await p.click("#btn-settings");
      await p.waitForSelector("#settings-view:not(.hidden)");
      assert.equal(await text(p, ".sv-rail-title"), "ตั้งค่า");
      await p.click("#btn-settings-back");
    });

    await step("the choice survives a reload", async () => {
      await p.reload();
      await p.waitForSelector("#board-tabs .board-tab", { state: "attached" });
      assert.equal(await p.evaluate(() => document.documentElement.lang), "th");
      await p.click("#btn-avatar");
      assert.equal(await text(p, "#btn-signout"), "ออกจากระบบ");
    });

    await step("switching back to English restores the original text exactly", async () => {
      await p.click("#user-menu .tb-seg-btn[data-lang=en]");
      assert.equal(await text(p, "#btn-signout"), "Sign out");
      assert.equal(await p.getAttribute("#btn-date-prev", "aria-label"), "Previous day");
      assert.doesNotMatch(await text(p, "#btn-date"), /[ก-๙]/);
      assert.equal(await p.evaluate(() => localStorage.getItem("manpower.lang")), "en");
    });

    await step("on a phone the switch is in the Me menu", async () => {
      await p.setViewportSize({ width: 390, height: 844 });
      await p.click("#btn-bn-more");
      await p.click("#more-menu .tb-seg-btn[data-lang=th]");
      const labels = await p.$$eval("#bottom-nav .bn-label", (els) => els.map((e) => e.textContent));
      assert.deepEqual(labels.slice(0, 2), ["บอร์ด", "ภาพรวม"]);
    });

    assert.deepEqual(a.errors, [], "no console errors");
  } finally { await env.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
