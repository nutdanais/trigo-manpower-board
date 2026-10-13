/* Acceptance run for the phone layout (styles.css "Phone shell"): the two-line
   header (name, status and date; summary card, Filter and ⋯) that folds to one
   line on scroll, the navy bottom bar with the Me tab, the available-people
   drawer, and full-screen record dialogs — at a 390px phone width.
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
const menuItems = (p, sel) => p.$$eval(sel + " .tb-item", (els) => els.map((e) => e.textContent.trim()));
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

    await step("the header tabs give way to a bottom bar: Board, Overview, Manpower, Host, Me", async () => {
      assert.equal(await visible(p, "#board-tabs"), false);
      assert.equal(await visible(p, "#bottom-nav"), true);
      assert.deepEqual(await navLabels(p), ["Board", "Overview", "Manpower", "Host", "Me"]);
      assert.equal(await p.textContent("#btn-bn-more .bn-me"), "EA", "Me shows the account's initials");
      assert.equal(await activeNav(p), "Board");
      const nav = await rect(p, "#bottom-nav");
      assert.ok(Math.abs(nav.bottom - 844) < 1, "pinned to the bottom edge");
    });

    await step("line 1: board name, status pill and date share one row; the avatar has left the header", async () => {
      assert.equal(await visible(p, "#app-logo"), false);
      assert.equal(await visible(p, "#btn-settings"), false);
      assert.equal(await visible(p, "#btn-avatar"), false);
      assert.equal(await p.$eval("#board-dd-label", (e) => e.textContent), "Board One");
      const name = await rect(p, "#btn-board-dd"), date = await rect(p, "#btn-date");
      assert.ok(Math.abs((name.top + name.bottom) / 2 - (date.top + date.bottom) / 2) < 6, "same line");
      assert.ok(await p.$eval("#board-dd-label", (e) => e.scrollWidth <= e.clientWidth), "the name fits whole");
    });

    await step("line 1 never wraps: a long name shortens with …, the date stays beside it (360pt, with HOLIDAY too)", async () => {
      await p.setViewportSize({ width: 360, height: 800 });
      const board = await p.evaluate(() => D().boards.find((b) => b.id === D().activeBoardId).name);
      const line = () => p.evaluate(() => {
        const mid = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2); };
        const l = document.querySelector("#board-dd-label");
        return { same: Math.abs(mid("#btn-board-dd") - mid("#btn-date")) < 6, cut: l.scrollWidth > l.clientWidth };
      });
      const setup = (name, hol) => p.evaluate(([n, hol]) => {
        D().boards.find((b) => b.id === D().activeBoardId).name = n;
        renderBoardPill();
        document.querySelector("#m-hol-pill").classList.toggle("hidden", !hol);
      }, [name, hol]);
      for (const hol of [false, true]) {
        await setup("Non-Rayong", hol);
        assert.deepEqual(await line(), { same: true, cut: false }, "Non-Rayong fits whole, holiday=" + hol);
        await setup("Eastern Seaboard North", hol);
        assert.deepEqual(await line(), { same: true, cut: true }, "a long name shortens, holiday=" + hol);
      }
      assert.equal(await visible(p, "#mode-pill"), false, "HOLIDAY stands in for CONFIRMED on a phone");
      await setup(board, false);
      await p.evaluate(() => renderModePill());
      await p.setViewportSize({ width: 390, height: 844 });
    });

    await step("line 2: the summary card, Filter and ⋯; the old toolbar and stats are gone from the board", async () => {
      assert.equal(await visible(p, "#toolbar"), false);
      for (const sel of ["#m-summary", "#m-filter", "#m-more"]) assert.equal(await visible(p, sel), true, sel);
      const card = await rect(p, "#m-summary"), more = await rect(p, "#m-more");
      assert.ok(Math.abs(card.top - more.top) < 2, "one line");
      assert.match(await p.textContent("#m-summary"), /^\d+\/\d+ assigned/);
      assert.ok((await rect(p, "#sticky-header")).height < 130, "two compact lines, got " + (await rect(p, "#sticky-header")).height);
      await shot(p, "1-board");
    });

    await step("the summary card opens to the details and remembers it", async () => {
      assert.equal(await visible(p, "#m-details"), false);
      await p.click("#m-summary");
      assert.equal(await visible(p, "#m-details"), true);
      assert.match(await p.textContent("#m-details"), /Total.*Assigned.*Leave.*Standby.*On-call free/s);
      // the desktop strip's own markup, plus utilization = Assigned ÷ (Assigned + Standby), one decimal
      const r = await p.evaluate(() => ({ s: boardStats(D().activeBoardId), pct: document.querySelector("#m-details .st-pct").textContent, tiles: document.querySelectorAll("#m-details .stat-tile").length }));
      const want = r.s.assigned + r.s.standby > 0 ? Math.round(r.s.assigned / (r.s.assigned + r.s.standby) * 1000) / 10 : 0;
      assert.equal(r.pct, want + "% utilized");
      assert.ok(r.tiles >= 4, "the stat tiles, got " + r.tiles);
      assert.equal(await p.evaluate(() => localStorage.getItem("mpm-m-details")), "1");
      await shot(p, "1b-details");
      await p.click("#m-summary");
      assert.equal(await visible(p, "#m-details"), false);
    });

    await step("⋯ leads with New mission and New employee, then the board's other actions", async () => {
      await p.click("#m-more");
      assert.equal(await visible(p, "#m-more-menu"), true);
      const items = await menuItems(p, "#m-more-menu");
      assert.deepEqual(items.slice(0, 2), ["New mission", "New employee"]);
      for (const want of ["Export", "Undo last change"]) assert.ok(items.includes(want), want + " in " + items);
      await shot(p, "1c-more");
      await p.evaluate(() => document.body.click());
      assert.equal(await visible(p, "#m-more-menu"), false, "a tap elsewhere closes it");
    });

    await step("Filter opens the filter list as a sheet, and a filter on shows a count", async () => {
      await p.click("#m-filter");
      assert.equal(await visible(p, "#filter-pop"), true);
      assert.equal(await visible(p, "#btn-reset-board"), false, "only the filters, no toolbar buttons");
      await p.evaluate(() => { state.filters.shift = ["day"]; render(); });
      assert.equal(await p.getAttribute("#m-filter", "data-count"), "1");
      await p.evaluate(() => { state.filters.shift = []; render(); });
      await p.evaluate(() => document.body.click());
      assert.equal(await visible(p, "#filter-pop"), false);
    });

    await step("scrolled down, the header folds into one line with the count, Filter and ⋯", async () => {
      await p.evaluate(() => { document.body.style.minHeight = "3000px"; window.scrollTo(0, 400); });
      await p.waitForTimeout(150);
      assert.ok(await p.evaluate(() => document.body.classList.contains("hdr-compact")));
      assert.equal(await visible(p, "#m-summary"), false);
      assert.equal(await visible(p, "#m-count"), true);
      const head = await rect(p, "#sticky-header"), more = await rect(p, "#m-more"), name = await rect(p, "#btn-board-dd");
      assert.ok(head.height < 60, "one line, got " + head.height);
      assert.ok(Math.abs(more.top - name.top) < 8, "⋯ on the same line");
      await shot(p, "1d-compact");
      await p.evaluate(() => { window.scrollTo(0, 0); document.body.style.minHeight = ""; });
      await p.waitForTimeout(150);
      assert.ok(await p.evaluate(() => !document.body.classList.contains("hdr-compact")), "unfolds at the top");
    });

    await step("the page never scrolls sideways", async () => {
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 390));
    });

    await step("leave tabs are one row of short names", async () => {
      const r = await p.$eval("#leave-tabs", (e) => ({ h: e.getBoundingClientRect().height, text: e.querySelector(".lv-tab span").innerText.trim() }));
      assert.ok(r.h < 45, "one row, got " + r.h);
      assert.equal(r.text, "Annual");
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

    await step("Me holds the account, Org Chart, Lock, Settings and Sign out; Settings hides the bar", async () => {
      await tapNav(p, "Me");
      assert.equal(await visible(p, "#more-menu"), true);
      assert.equal(await p.textContent("#more-menu .tb-who b"), await p.textContent("#user-menu-name"), "the account's name on top");
      const items = await menuItems(p, "#more-menu");
      for (const want of ["Org Chart", "Settings", "Sign out"]) assert.ok(items.includes(want), want + " in " + items);
      assert.ok(items.some((t) => /Lock this board|Unlock this board/.test(t)), "Lock in " + items);
      await shot(p, "4-more");
      await p.evaluate(() => document.body.click());
      assert.equal(await visible(p, "#more-menu"), false, "a tap elsewhere closes it");
      await tapNav(p, "Me");
      await p.locator("#more-menu .tb-item", { hasText: "Settings" }).click();
      assert.ok(await p.evaluate(() => document.body.classList.contains("settings-open")));
      assert.equal(await visible(p, "#bottom-nav"), false);
      await p.click("#btn-settings-back-icon").catch(() => p.click("#btn-settings-back"));
      assert.equal(await visible(p, "#bottom-nav"), true);
    });

    await step("New mission from ⋯ opens full screen with its Save in view", async () => {
      await p.click("#m-more");
      await p.locator("#m-more-menu .tb-item", { hasText: "New mission" }).click();
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
      assert.equal(await visible(p, "#m-row2"), false);
      assert.equal(await visible(p, "#toolbar"), true);
      assert.equal(await visible(p, "#btn-avatar"), true);
    });
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
})();
