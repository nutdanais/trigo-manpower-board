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

    await step("leave: tabs with counts, opening on the busiest type; each tab is a drop target", async () => {
      const r = await p.evaluate(() => {
        const tabs = [...document.querySelectorAll("#leave-tabs .lv-tab")];
        const zoneN = (z) => document.querySelectorAll(`#status-zones [data-drop="zone:${z}"] .emp-card`).length;
        return {
          tabs: tabs.map((t) => ({ z: t.dataset.lv, n: Number(t.querySelector("b").textContent), real: zoneN(t.dataset.lv), on: t.classList.contains("on"), drop: t.dataset.drop, cls: t.classList.contains("dropzone") })),
          shown: [...document.querySelectorAll("#status-zones .zone-leave")].filter((z) => getComputedStyle(z).display !== "none").map((z) => z.dataset.zone),
          band: document.getElementById("status-zones").getBoundingClientRect().height + document.getElementById("leave-tabs").getBoundingClientRect().height,
        };
      });
      assert.equal(r.tabs.length, 5);
      assert.ok(r.tabs.every((t) => t.n === t.real && t.cls && t.drop === "zone:" + t.z), JSON.stringify(r.tabs));
      assert.deepEqual(r.tabs.filter((t) => t.on).map((t) => t.z), ["annual"], "opens on the busiest type");
      assert.deepEqual(r.shown, ["annual"], "one lane at a time");
      assert.ok(r.band < 220, "compact: " + r.band);
      await p.click('#leave-tabs [data-lv="unpaid"]');
      assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#status-zones .zone-leave")].filter((z) => getComputedStyle(z).display !== "none").map((z) => z.dataset.zone)), ["unpaid"]);
      const body = await p.locator('#status-zones [data-drop="zone:unpaid"]').boundingBox();
      assert.ok(body.height >= 80 && body.width > 300, "the open lane is a real drop area");
      await p.click('#leave-tabs [data-lv="annual"]');
    });

    await step("leave: dropping a person on a tab files them under that type, even with the lane closed", async () => {
      await p.evaluate(() => { guardEdit = (fn) => fn(); });   // the day is read-only; this checks the drop wiring, not the date rules
      const id = await p.evaluate(() => document.querySelector("#missions-grid .emp-card").dataset.empId);
      await p.evaluate((emp) => {
        const tab = document.querySelector('#leave-tabs [data-lv="sick"]');
        const dt = new DataTransfer(); dt.setData("text/plain", JSON.stringify([emp]));
        tab.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
        tab.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      }, id);
      await p.waitForFunction((emp) => getPlan().zones.sick.includes(emp), id);
      assert.equal(await p.evaluate(() => state.leaveTab), "sick", "the lane the person went to opens");
      assert.equal(await p.locator('#leave-tabs [data-lv="sick"] b').textContent(), "1");
    });

    await step("leave: while exporting, the tabs go away and every lane with people is drawn", async () => {
      await p.evaluate(() => document.body.classList.add("exporting"));
      const r = await p.evaluate(() => ({
        tabs: getComputedStyle(document.getElementById("leave-tabs")).display,
        shown: [...document.querySelectorAll("#status-zones .zone-leave:not(.zone-empty)")].filter((z) => getComputedStyle(z).display !== "none").map((z) => z.dataset.zone),
      }));
      await p.evaluate(() => document.body.classList.remove("exporting"));
      assert.equal(r.tabs, "none");
      assert.deepEqual(r.shown.sort(), ["annual", "sick"]);
    });

    await step("the banner: module tabs, a board pill that opens the boards, and Sign out inside the avatar menu", async () => {
      assert.equal(await p.isVisible("#btn-signout"), false, "Sign out is not in the banner itself");
      assert.equal((await p.textContent("#btn-board-dd")).trim(), "Board One");
      await p.click("#btn-board-dd");
      assert.deepEqual(await p.$$eval("#board-menu .tab-board", (e) => e.map((x) => x.textContent.trim())), ["Board One", "Board Two"]);
      assert.equal(await p.isVisible("#btn-add-board"), true);
      await p.keyboard.press("Escape");
      assert.equal(await p.isVisible("#board-menu"), false);
      await p.click("#btn-avatar");
      assert.equal(await p.isVisible("#btn-signout"), true);
      assert.match(await p.textContent("#user-menu-name"), /Admin/);
      await p.click("body", { position: { x: 600, y: 500 } });
      assert.equal(await p.isVisible("#user-menu"), false);
    });

    await step("Filter & sort is one popover with a count of the filters that are on", async () => {
      assert.equal(await p.isVisible("#filter-pop"), false);
      assert.equal(await p.isVisible("#filter-count"), false);
      await p.click("#btn-filter-pop");
      assert.equal(await p.isVisible("#filter-pop"), true);
      await p.click('#filter-pop .ms[data-filter="engineer"] .ms-btn');
      await p.click('#filter-pop .ms[data-filter="engineer"] .ms-opt input >> nth=0');
      assert.equal((await p.textContent("#filter-count")).trim(), "1");
      assert.equal(await p.locator("#missions-grid .mission-card.dimmed").count(), 1, "the non-matching mission is dimmed");
      await p.click("body", { position: { x: 700, y: 700 } });
      assert.equal(await p.isVisible("#filter-pop"), false);
      assert.equal((await p.textContent("#filter-count")).trim(), "1", "the count stays on the closed button");
      await p.evaluate(() => { state.filters.engineer = []; renderFilterOptions(); renderMissions(); });
      assert.equal(await p.isVisible("#filter-count"), false);
    });

    await step("the people panel starts under the banner, and the Names control is a Thai | English toggle", async () => {
      const r = await p.evaluate(() => ({ pool: document.getElementById("float-pool").getBoundingClientRect().top, bar: document.getElementById("sticky-header").getBoundingClientRect().bottom, bannerRight: document.getElementById("topbar").getBoundingClientRect().right, vw: innerWidth }));
      assert.ok(Math.abs(r.pool - r.bar) <= 1, JSON.stringify(r));
      assert.ok(r.bannerRight >= r.vw - 1, "the banner spans the full width");
      assert.deepEqual(await p.$$eval("#card-names + .seg-pick button", (b) => b.map((x) => x.textContent)), ["Thai", "English"]);
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

    await step("quiet tables: sentence-case headers, a colour key for the area, empty columns left out", async () => {
      await p.setViewportSize({ width: 1400, height: 900 });
      await p.evaluate((d) => { state.date = d; D().activeBoardId = EMPLIST_ID; return refreshAndRender(); }, SRC);
      const emp = await p.evaluate(() => {
        const th = document.querySelector("#emplist-table th[data-sort=name]");
        const pill = document.querySelector("#emplist-table .area-pill");
        return { tt: getComputedStyle(th).textTransform, top: getComputedStyle(th).position, key: getComputedStyle(pill, "::before").width, bg: getComputedStyle(pill).backgroundColor, ac: pill.style.getPropertyValue("--ac"), box: getComputedStyle(document.querySelector("#emplist-panel .table-wrap")).borderTopWidth };
      });
      assert.equal(emp.tt, "none");
      assert.equal(emp.top, "sticky");
      assert.equal(emp.key, "10px");
      assert.equal(emp.bg, "rgba(0, 0, 0, 0)");
      assert.ok(emp.ac, "the area colour is handed to CSS");
      assert.equal(emp.box, "0px");
      await p.evaluate(() => { D().activeBoardId = HOSTLIST_ID; return refreshAndRender(); });
      const hidden = await p.evaluate(() => [...document.querySelectorAll("#hostlist-table th.col-off")].map((t) => t.textContent.trim()));
      assert.ok(hidden.includes("Note") && hidden.includes("Inspectors deployed"), "columns empty on every row are left out: " + hidden);
      assert.ok(await p.evaluate(() => [...document.querySelectorAll("#hostlist-table th:not(.col-off)")].some((t) => /Host name/.test(t.textContent))));
    });

    await step("no page errors", async () => { assert.deepEqual(a.errors, []); });
    console.log("all signal-chrome checks passed");
  } finally {
    await env.close();
  }
})().catch(() => { process.exitCode = 1; });
