/* Acceptance run for the Signal restyle, driving the real app in Chromium against the
   shared fake backend:
     NODE_PATH=$(npm root -g) node tests/e2e/signal-chrome.e2e.js
   It covers: light only (no theme toggle, no data-theme), Geist as the one font family,
   the record dialogs as a side panel (right-aligned, full height, footer pinned), Shift and
   Contract as segmented controls that follow their select, the leave zones as a band whose
   empty types are still drop targets, and the stats strip with its proportion bar and
   area chips. Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
const FUT = h.nextWorking(h.nextWorking(T));
const ADMIN = { id: "00000000-0000-0000-0000-0000000000ad", email: "admin.z@example.com", role: "admin" };

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 6).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  try {
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    db.seed("profiles", [{ id: ADMIN.id, email: ADMIN.email, full_name: "Admin Z", display_name: "Admin.Z", role_key: "admin", status: "active" }]);
    const a = await env.openAs(db, ADMIN, { viewport: { width: 1400, height: 900 } });
    const p = a.page;
    await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);

    await step("light only: no theme toggle, no theme attribute, and a stored dark theme is cleared", async () => {
      assert.equal(await p.locator("#btn-theme").count(), 0);
      assert.equal(await p.evaluate(() => document.documentElement.getAttribute("data-theme")), null);
      await p.evaluate(() => { localStorage.setItem("mpm-theme", "dark"); initTheme(); });
      assert.equal(await p.evaluate(() => localStorage.getItem("mpm-theme")), null);
    });

    await step("one font family: Geist leads the UI font and Noto Sans Thai backs Thai", async () => {
      const f = await p.evaluate(() => getComputedStyle(document.body).fontFamily);
      assert.match(f, /^"?Geist"?,/);
      assert.match(f, /Noto Sans Thai/);
      assert.doesNotMatch(f, /"Noto Sans",/);
    });

    await step("stats: a proportion bar under the numbers, and area chips carry the area colour", async () => {
      assert.equal(await p.locator("#stats-bar .st-split i").count() > 0, true);
      const chips = await p.evaluate(() => [...document.querySelectorAll("#area-bar .area-chip")].map((c) => ({ dot: !!c.querySelector(".ac-dot"), n: Number(c.querySelector("b").textContent) })));
      assert.ok(chips.length >= 1 && chips.every((c) => c.dot && c.n > 0), JSON.stringify(chips));
    });

    await step("leave: a band, and an empty type is a small dashed chip that is still a drop target", async () => {
      const r = await p.evaluate(() => {
        const z = document.querySelector('#status-zones .zone-leave.zone-empty[data-zone="unpaid"]');
        const body = z.querySelector(".zone-body");
        const zr = z.getBoundingClientRect(), br = body.getBoundingClientRect();
        return { chipH: Math.round(zr.height), coversChip: Math.abs(zr.width - br.width) <= 3 && Math.abs(zr.height - br.height) <= 3, drop: body.dataset.drop };
      });
      assert.ok(r.chipH <= 40, "chip height " + r.chipH);
      assert.equal(r.coversChip, true, "the drop body fills the chip");
      assert.equal(r.drop, "zone:unpaid");
      const band = await p.evaluate(() => document.getElementById("status-zones").getBoundingClientRect().height);
      assert.ok(band < 200, "the leave band is compact: " + band);
    });

    await step("a record dialog is a side panel: right-aligned, full height, footer pinned", async () => {
      await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, FUT);
      await p.click("#btn-new-mission");
      await p.waitForSelector("#modal-mission:not(.hidden)");
      await p.waitForTimeout(450);   // the slide-in
      const r = await p.evaluate(() => {
        const m = document.querySelector("#modal-mission").getBoundingClientRect();
        const f = document.querySelector("#modal-mission .modal-actions").getBoundingClientRect();
        return { right: Math.round(m.right), w: Math.round(m.width), top: Math.round(m.top), bottom: Math.round(m.bottom), fBottom: Math.round(f.bottom), vw: innerWidth, vh: innerHeight };
      });
      assert.equal(r.right, r.vw, "flush with the right edge");
      assert.ok(r.w <= 520 && r.w >= 400, "width " + r.w);
      assert.ok(r.top <= 1 && r.bottom >= r.vh - 1, "full height");
      assert.ok(r.fBottom >= r.vh - 2, "footer sits at the bottom");
    });

    await step("Shift is a segmented control that follows its select, both ways", async () => {
      assert.equal(await p.locator('#modal-mission [name=shift]').evaluate((s) => s.value), "day");
      await p.click('#modal-mission .seg-pick button[data-v="night"]');
      assert.equal(await p.locator('#modal-mission [name=shift]').evaluate((s) => s.value), "night");
      assert.equal(await p.locator('#modal-mission .seg-pick button[data-v="night"]').getAttribute("aria-pressed"), "true");
      await p.evaluate(() => { const s = document.querySelector("#modal-mission [name=shift]"); s.value = "day"; syncSegmented(document.querySelector("#modal-mission")); });
      assert.equal(await p.locator('#modal-mission .seg-pick button[data-v="day"]').getAttribute("aria-pressed"), "true");
    });

    await step("Escape and a click on the scrim both close it", async () => {
      await p.keyboard.press("Escape");
      await p.waitForSelector("#modal-backdrop", { state: "hidden" });
      await p.click("#btn-new-mission");
      await p.waitForSelector("#modal-mission:not(.hidden)");
      await p.mouse.click(60, 450);
      await p.waitForSelector("#modal-backdrop", { state: "hidden" });
    });

    await step("New Employee opens the same panel, with Contract as a segmented control", async () => {
      await p.click(".tab-emplist");
      await p.click("#btn-new-employee");
      await p.waitForSelector("#modal-employee:not(.hidden)");
      await p.waitForTimeout(450);
      const r = await p.evaluate(() => { const m = document.querySelector("#modal-employee").getBoundingClientRect(); return { right: Math.round(m.right), bottom: Math.round(m.bottom), vw: innerWidth, vh: innerHeight }; });
      assert.equal(r.right, r.vw);
      assert.ok(r.bottom >= r.vh - 1, "full height, not capped at 90vh");
      await p.click('#modal-employee .seg-pick button[data-v="oncall"]');
      assert.equal(await p.locator('#modal-employee [name=contract]').evaluate((s) => s.value), "oncall");
      await p.keyboard.press("Escape");
    });

    await step("on a phone the panel is a bottom sheet", async () => {
      await p.setViewportSize({ width: 390, height: 800 });
      await p.evaluate(() => openEmployeeModal());
      await p.waitForTimeout(450);
      const r = await p.evaluate(() => { const m = document.querySelector("#modal-employee").getBoundingClientRect(); return { w: Math.round(m.width), bottom: Math.round(m.bottom), top: Math.round(m.top), vw: innerWidth, vh: innerHeight }; });
      assert.equal(r.w, r.vw);
      assert.ok(r.bottom >= r.vh - 1 && r.top > 0, "anchored to the bottom, with the board showing above");
      await p.keyboard.press("Escape");
    });

    await step("no page errors", async () => { assert.deepEqual(a.errors, []); });
    console.log("all signal-chrome checks passed");
  } finally {
    await env.close();
  }
})().catch(() => { process.exitCode = 1; });
