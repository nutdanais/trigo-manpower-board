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

    await step("line 1 never wraps: a long name shortens with …, the date stays beside it (360pt, on a holiday too); one status pill", async () => {
      await p.setViewportSize({ width: 360, height: 800 });
      const board = await p.evaluate(() => D().boards.find((b) => b.id === D().activeBoardId).name);
      const line = () => p.evaluate(() => {
        const mid = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2); };
        const l = document.querySelector("#board-dd-label");
        return { same: Math.abs(mid("#btn-board-dd") - mid("#btn-date")) < 6, cut: l.scrollWidth > l.clientWidth };
      });
      let weekend = SRC; while (!h.isWeekend(weekend)) weekend = h.addDays(weekend, 1);
      const setup = (name, date) => p.evaluate(([n, d]) => {
        D().boards.find((b) => b.id === D().activeBoardId).name = n;
        state.date = d;
        return refreshAndRender();
      }, [name, date]);
      for (const date of [SRC, weekend]) {
        await setup("Non-Rayong", date);
        assert.deepEqual(await line(), { same: true, cut: false }, "Non-Rayong fits whole on " + date);
        await setup("Eastern Seaboard North", date);
        assert.deepEqual(await line(), { same: true, cut: true }, "a long name shortens on " + date);
      }
      // the one pill carries the holiday itself (there is no second HOLIDAY pill)
      assert.equal(await p.locator("#topbar .mode-pill:not(.hidden)").count(), 1, "one status pill");
      assert.match(await p.textContent("#mode-pill"), /Holiday/);
      await setup(board, SRC);
      await p.setViewportSize({ width: 390, height: 844 });
    });

    await step("line 2: the summary card, Filter and ⋯; the old toolbar and stats are gone from the board", async () => {
      assert.equal(await visible(p, "#toolbar"), false);
      for (const sel of ["#m-summary", "#m-filter", "#m-more"]) assert.equal(await visible(p, sel), true, sel);
      const card = await rect(p, "#m-summary"), more = await rect(p, "#m-more");
      assert.ok(Math.abs(card.top - more.top) < 2, "one line");
      // closed: assigned with utilization beside it, Assigned ÷ (Assigned + Standby) as a whole percentage
      const c = await p.evaluate(() => ({ s: boardStats(D().activeBoardId), t: document.querySelector("#m-summary .ms-t").textContent }));
      const want = c.s.assigned + c.s.standby > 0 ? Math.round(c.s.assigned / (c.s.assigned + c.s.standby) * 100) : 0;
      assert.equal(c.t, `${c.s.assigned} (${want}%) assigned`);
      assert.ok((await rect(p, "#sticky-header")).height < 130, "two compact lines, got " + (await rect(p, "#sticky-header")).height);
      await shot(p, "1-board");
    });

    await step("the summary card opens to the details and remembers it", async () => {
      assert.equal(await visible(p, "#m-details"), false);
      await p.click("#m-summary");
      assert.equal(await visible(p, "#m-details"), true);
      // opened: one row of status counts, then Total / Day / Night / utilization on one line
      const d = await p.evaluate(() => {
        const tiles = [...document.querySelectorAll("#m-details .md-t")];
        const tops = new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top)));
        return { labels: tiles.map((t) => t.dataset.stat), rows: tops.size, line: document.querySelector("#m-details .md-line").textContent, h: document.querySelector("#m-details").getBoundingClientRect().height };
      });
      assert.deepEqual(d.labels, ["Assigned", "Leave", "Standby", "On-call"]);
      assert.equal(d.rows, 1, "the counts share one row");
      assert.match(d.line, /Total \d+.*day.*night.*% utilized/s);
      assert.ok(d.h < 150, "compact, got " + d.h);
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

    await step("Overview, Manpower and Host share the board's header: title, date, summary card, ⋯", async () => {
      for (const [label, title] of [["Overview", "Overview"], ["Manpower", "Manpower"], ["Host", "Host"]]) {
        await tapNav(p, label);
        await p.waitForTimeout(300);
        assert.equal((await p.textContent("#m-title")).trim(), title, "title on " + label);
        assert.equal(await visible(p, "#m-title"), true, "title shown on " + label);
        assert.equal(await visible(p, "#m-summary"), true, "summary card on " + label);
        assert.equal(await visible(p, "#toolbar-row2"), false, "row 2 folded into the card on " + label);
        assert.equal(await visible(p, "#m-filter"), label !== "Overview", "Filter only on the lists");
        const d = await rect(p, "#btn-date"), t = await rect(p, "#m-title");
        assert.ok(Math.abs(d.top - t.top) < 20, "date on the title's line on " + label);
        await p.click("#m-more");
        const items = await menuItems(p, "#m-more-menu");
        assert.ok(items.some((x) => /Export/.test(x)), "Export in ⋯ on " + label + ": " + items);
        if (label !== "Overview") assert.ok(items.some((x) => /Bulk edit/.test(x)), "Bulk edit in ⋯ on " + label);
        await p.click("#m-more");
        await shot(p, "5-" + label.toLowerCase());
      }
      // record cards fold their rarer fields behind More details
      await tapNav(p, "Manpower");
      const tid = "#emplist-body tr:first-child td.el-tid";
      assert.equal(await visible(p, tid), false, "TRIGO ID folded");
      await p.click("#emplist-body tr:first-child .m-fold");
      assert.equal(await visible(p, tid), true, "TRIGO ID shown after More details");
      await tapNav(p, "Board");
    });

    await step("Org Chart has the same header (summary card, Filter, ⋯ with Export); Filter is a bottom sheet with Clear all and Done", async () => {
      await p.evaluate(() => { D().activeBoardId = ORGCHART_ID; return refreshAndRender(); });
      await p.waitForTimeout(300);
      assert.equal((await p.textContent("#m-title")).trim(), "Org Chart");
      for (const sel of ["#m-summary", "#m-filter", "#m-more"]) assert.equal(await visible(p, sel), true, sel + " on Org Chart");
      assert.equal(await visible(p, ".oc-filterbox"), false, "the filters wait behind Filter");
      await p.click("#m-more");
      assert.ok((await menuItems(p, "#m-more-menu")).some((x) => /Export/.test(x)), "Export in ⋯");
      await p.click("#m-more");
      await p.click("#m-filter");
      const sheet = await rect(p, ".oc-filterbox");
      assert.ok(Math.abs(sheet.bottom - 844) < 2, "the sheet sits on the bottom edge");
      assert.equal((await p.textContent(".oc-filterbox .m-sheet-title")).trim(), "Filter");
      await p.click(".oc-filterbox .m-sheet-done");
      assert.equal(await p.evaluate(() => document.body.classList.contains("m-filter-open")), false, "Done closes it");
      // the board's sheet: same head and foot, from the bottom
      await tapNav(p, "Board");
      await p.click("#m-filter");
      assert.equal((await p.textContent("#toolbar .m-sheet-title")).trim(), "Filter & sort");
      assert.ok(Math.abs((await rect(p, "#toolbar")).bottom - 844) < 2, "board sheet on the bottom edge");
      await p.evaluate(() => { state.filters.engineer = ["eng-1"]; renderFilterOptions(); renderMissions(); });
      await p.click("#toolbar .m-sheet-clear");
      assert.deepEqual(await p.evaluate(() => state.filters.engineer), [], "Clear all empties the filters");
      await p.click("#toolbar .m-sheet-done");
    });

    await step("no tab is wider than a narrow phone (320px, or a larger text size)", async () => {
      await p.setViewportSize({ width: 320, height: 700 });
      for (const tab of ["overview", "emplist", "hostlist", "orgchart", "capacity"]) {
        await p.evaluate((t) => document.querySelector("#board-tabs .tab-" + t).onclick(), tab);
        await p.waitForTimeout(400);
        const w = await p.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(w <= 320, tab + " is " + w + "px wide");
      }
      await p.setViewportSize({ width: 390, height: 844 });
      await tapNav(p, "Board");
    });

    await step("Overview's By engineer table fits its card at 390px and 320px, with no sideways scroll", async () => {
      await p.evaluate(() => document.querySelector("#board-tabs .tab-overview").onclick());
      await p.waitForTimeout(400);
      for (const w of [390, 320]) {
        await p.setViewportSize({ width: w, height: 844 });
        await p.waitForTimeout(200);
        const m = await p.evaluate(() => {
          const t = [...document.querySelectorAll("#overview-panel .ov-table")].find((x) => x.querySelector("th.ov-mcell"));
          const wrap = t && t.parentElement;
          return wrap && { sw: wrap.scrollWidth, cw: wrap.clientWidth };
        });
        assert.ok(m, "By engineer table is on the Overview");
        assert.ok(m.sw <= m.cw, "By engineer scrolls sideways at " + w + "px: " + m.sw + " > " + m.cw);
      }
      await p.setViewportSize({ width: 390, height: 844 });
      await tapNav(p, "Board");
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
