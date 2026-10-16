/* Acceptance run for the board toolbar: the stats tiles and the tidied row 1,
   driving the real app in Chromium against the shared fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/stats-tiles.e2e.js
   Seed (harness.seedBase) plus one person with no service area and one deactivated
   person, both on Board One. Checks the relationships the tiles are built on
   (Total = Assigned + Leave + Standby [+ Holiday] + On-call free; Day + Night =
   Assigned; the area chips add up to Total, with a "No area" chip), Standby flagged
   only when it is not 0, and the row-1 / row-2 layout changes. Exits non-zero on the
   first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
const FUTURE = h.nextWorking(T);

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 5).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  try {
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    db.seed("employees", [
      { id: "e11", name_th: "No Area Person", contract: "permanent", area_id: null, board_id: "b1" },
      { id: "e12", name_th: "Deactivated Person", contract: "permanent", area_id: "area-1", board_id: "b1", active: false },
    ]);
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const go = (d) => p.evaluate((x) => { state.date = x; return refreshAndRender(); }, d);

    /* every number on the stats row, as the user sees it */
    const read = () => p.evaluate(() => {
      const n = (k) => { const t = document.querySelector('#stats-bar [data-stat="' + k + '"]'); return t ? Number(t.querySelector("b").textContent) : null; };
      const areas = [...document.querySelectorAll("#area-bar .area-chip")].map((c) => ({ name: c.dataset.area, n: Number(c.querySelector("b").textContent) }));
      return {
        total: n("Total"), assigned: n("Assigned"), leave: n("Leave"), standby: n("Standby"), holiday: n("Holiday"), free: n("On-call free"),
        day: n("Day"), night: n("Night"), areas,
        alert: !!document.querySelector("#stats-bar .stat-tile.st-alert"),
        zero: [...document.querySelectorAll("#stats-bar .stat-tile.st-zero")].map((t) => t.dataset.stat),
      };
    });

    for (const [label, date] of [["a past working day", SRC], ["today", T], ["a future day", FUTURE]]) {
      await step("the tiles and the area line add up to Total on " + label, async () => {
        await go(date);
        const s = await read();
        assert.ok(s.total > 0, "has people");
        assert.equal(s.assigned + s.leave + s.standby + (s.holiday || 0) + s.free, s.total, "status tiles sum to Total: " + JSON.stringify(s));
        assert.equal(s.day + s.night, s.assigned, "Day + Night = Assigned");
        assert.equal(s.areas.reduce((x, c) => x + c.n, 0), s.total, "area chips sum to Total: " + JSON.stringify(s.areas));
        assert.equal(s.areas.find((c) => c.name === "No area").n, 1, "the person with no area is counted as No area");
      });
    }

    await step("a deactivated person is out of Total and out of the area chips from today on, but still counted on a past day", async () => {
      await go(SRC);
      const past = await read();
      await go(FUTURE);
      const future = await read();
      if (SRC < T) assert.equal(past.total, future.total + 1, "the deactivated person shows only on the past day");
      assert.equal(future.areas.reduce((x, c) => x + c.n, 0), future.total);
    });

    await step("Standby is flagged (colour + icon) only when it is not 0; zero tiles go quiet", async () => {
      await go(SRC);
      const s = await read();
      assert.ok(s.standby > 0, "seed leaves permanent people unplaced");
      assert.equal(s.alert, true, "Standby > 0 is flagged");
      assert.equal(await p.locator('#stats-bar [data-stat="Standby"] svg').count(), 1, "with an icon, not colour alone");
      // Board Two has no leave
      await p.evaluate(() => { D().activeBoardId = "b2"; return refreshAndRender(); });
      const b2 = await read();
      assert.equal(b2.leave, 0);
      assert.ok(b2.zero.includes("Leave"), "a 0 tile is marked quiet");
      await p.evaluate(() => { D().activeBoardId = "b1"; return refreshAndRender(); });
    });

    await step("the area line sits under the stats, on a line of its own", async () => {
      const stats = await p.locator("#stats-bar").boundingBox();
      const area = await p.locator("#area-bar").boundingBox();
      const exp = await p.locator("#btn-export").boundingBox();
      assert.ok(area.y >= stats.y + stats.height - 1, "below the tiles");
      assert.ok(area.y >= exp.y + exp.height - 1, "below the right-hand cluster too");
    });

    await step("one filled primary on a board: New Employee is outlined next to New Mission", async () => {
      assert.match(await p.getAttribute("#btn-new-mission", "class"), /btn-primary/);
      const cls = await p.getAttribute("#btn-new-employee", "class");
      assert.match(cls, /btn-outline-primary/);
      assert.doesNotMatch(cls, /btn-primary/);
      await p.click(".tab-emplist");
      assert.match(await p.getAttribute("#btn-new-employee", "class"), /\bbtn-primary\b/, "on Manpower it is the only create button, so it stays filled");
      assert.match(await p.locator("#stats-bar .stat-lead").innerText(), /Total/, "Manpower uses the board's stats design: a Total lead");
      assert.deepEqual(await p.$$eval("#stats-bar .stat-tile", (t) => t.map((x) => x.dataset.stat)), ["Permanent", "On-call", "Inactive"]);
      await p.evaluate(() => { D().activeBoardId = "b1"; return refreshAndRender(); });
    });

    await step("Hide/Unhide sits with the filters and reads like a filter in effect", async () => {
      assert.equal(await p.locator("#filters #btn-hide-missions").count(), 1);
      assert.equal((await p.innerText("#btn-hide-missions")).trim(), "Hide/Unhide");
      await p.evaluate(() => { getPlan().missions[0].hidden = true; updateHideMissionsButton(); });
      assert.equal((await p.innerText("#btn-hide-missions")).trim(), "Hidden 1");
      assert.match(await p.getAttribute("#btn-hide-missions", "class"), /is-on/);
      await p.evaluate(() => { getPlan().missions[0].hidden = false; updateHideMissionsButton(); });
    });

    await step("a filter keeps its text, quiet at All and tinted once something is selected", async () => {
      const btn = p.locator('#filters .ms[data-filter="engineer"] .ms-btn');
      assert.equal((await btn.textContent()).trim(), "Engineer: All");
      assert.doesNotMatch(await btn.getAttribute("class"), /ms-active/);
      await p.evaluate(() => { state.filters.engineer = ["eng-1"]; renderFilterOptions(); });
      assert.equal((await btn.textContent()).trim(), "Engineer: 1 selected");
      assert.match(await btn.getAttribute("class"), /ms-active/);
      await p.evaluate(() => { state.filters.engineer = []; renderFilterOptions(); });
    });

    await step("row 1 ends Names → Undo → Reset Board → Export, Export at the right edge", async () => {
      const row = await p.locator("#toolbar-row1").boundingBox();
      const names = await p.locator("#card-names + .seg-pick").boundingBox();
      const undo = await p.locator("#btn-undo").boundingBox();
      const reset = await p.locator("#btn-reset-board").boundingBox();
      const exp = await p.locator("#btn-export").boundingBox();
      assert.ok(row.x + row.width - (exp.x + exp.width) <= 24, "Export at the right edge");
      assert.ok(names.x < undo.x && undo.x < reset.x && reset.x < exp.x, "Names, Undo, Reset Board, Export");
      for (const b of [names, undo, reset, exp]) assert.ok(Math.abs((b.y + b.height / 2) - (undo.y + undo.height / 2)) <= 4, "all on one line");
    });

    await step("row 1 stays on ONE line at laptop width on an editable future day (Holiday toggle showing)", async () => {
      await go(FUTURE);
      await p.setViewportSize({ width: 1520, height: 900 });   // about 1250px of toolbar beside the right-hand panel
      assert.equal(await p.isVisible("#holiday-toggle"), true, "the widest case: Holiday toggle visible");
      const tops = await p.evaluate(() => [...document.querySelectorAll("#toolbar-row1 button:not(.hidden), #toolbar-row1 label:not(.hidden), #toolbar-row1 select")]
        .filter((e) => e.offsetWidth && e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return Math.round((r.top + r.height / 2) / 8) * 8; }));   // centres, bucketed: controls differ a little in height
      assert.ok(tops.length >= 7, "all the controls are there (the filters sit in one popover): " + tops.length);
      assert.equal(new Set(tops).size, 1, "every control on the same line, centres: " + [...new Set(tops)]);
      assert.equal((await p.innerText("#btn-undo")).trim(), "Undo", "the Undo word is still there for screen readers");
      // and with a couple of filters switched on (they are wider while active)
      await p.evaluate(() => { state.filters.engineer = ["eng-1"]; state.filters.host = ["Host Alpha"]; renderFilterOptions(); });
      const tops2 = await p.evaluate(() => [...document.querySelectorAll("#toolbar-row1 button:not(.hidden), #toolbar-row1 label:not(.hidden), #toolbar-row1 select")]
        .filter((e) => e.offsetWidth && e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return Math.round((r.top + r.height / 2) / 8) * 8; }));
      assert.equal(new Set(tops2).size, 1, "still one line with two filters on, centres: " + [...new Set(tops2)]);
      assert.equal((await p.locator('#filters .ms[data-filter="engineer"] .ms-btn').textContent()).trim(), "Engineer: 1 selected", "full text kept");
      await p.evaluate(() => { state.filters.engineer = []; state.filters.host = []; renderFilterOptions(); });
      await p.setViewportSize({ width: 1400, height: 900 });
      await go(SRC);
    });

    await step("the tiles are compact (under 44px tall)", async () => {
      const hgt = await p.evaluate(() => Math.max(...[...document.querySelectorAll("#stats-bar .stat-tile")].map((t) => t.getBoundingClientRect().height)));
      assert.ok(hgt < 44, "tile height " + hgt);
    });

    for (const width of [1400, 1100, 900]) {
      await step("Export stays at the right edge of row 2 at " + width + "px, even when the row wraps", async () => {
        await p.setViewportSize({ width, height: 900 });
        const row = await p.locator("#toolbar-row2").boundingBox();
        const exp = await p.locator("#btn-export").boundingBox();
        assert.ok(row.x + row.width - (exp.x + exp.width) <= 16, "Export right edge " + (exp.x + exp.width) + " vs row " + (row.x + row.width));
      });
    }
    await p.setViewportSize({ width: 1400, height: 900 });

    await step("the Names control is a compact Thai | English toggle", async () => {
      const w = await p.evaluate(() => document.querySelector("#card-names + .seg-pick").getBoundingClientRect().width);
      assert.ok(w > 0 && w < 190, "compact, was " + w);
      assert.deepEqual(await p.$$eval("#card-names + .seg-pick button", (b) => b.map((x) => x.textContent)), ["ไทย", "English"]);
    });

    await step("Overview shows the day across every board in row 2 (layout A), no board tiles or areas", async () => {
      await p.click(".tab-overview");
      assert.match(await p.textContent("#stats-bar"), /Boards: \d+.*Utilization: \d+%.*Assigned: \d+.*Standby: \d+/s);
      assert.equal(await p.locator("#stats-bar .stat-tile").count(), 0);
      assert.equal(await p.evaluate(() => document.querySelector("#area-bar").children.length), 0);
    });

    await step("Assigned shows utilization as Assigned ÷ (Assigned + Standby), status chips leave Standby out", async () => {
      await p.evaluate((id) => { D().activeBoardId = id; return refreshAndRender(); }, await p.evaluate(() => D().boards[0].id));
      const r = await p.evaluate(() => {
        const s = boardStats(D().activeBoardId);
        return { s, pct: document.querySelector("#stats-bar .st-pct").textContent, chips: document.querySelector("#board-status").textContent };
      });
      // two decimals, trailing zeros dropped (97.85, 98.5, 100)
      const want = r.s.assigned + r.s.standby > 0 ? Math.round(r.s.assigned / (r.s.assigned + r.s.standby) * 10000) / 100 : 0;
      assert.equal(r.pct, want + "% utilized");
      assert.ok(!/standby/i.test(r.chips), "no Standby status chip: " + r.chips);
    });

    for (const width of [1024, 1100, 1280, 1366]) {
      await step("every module tab is in full view in the top bar at " + width + "px (no tab scrolled out of sight)", async () => {
        await p.setViewportSize({ width, height: 900 });
        await p.evaluate(() => { D().activeBoardId = "b1"; return refreshAndRender(); });
        const r = await p.evaluate(() => {
          const strip = document.querySelector("#board-tabs").getBoundingClientRect();
          const pill = document.querySelector("#mode-pill").getBoundingClientRect();
          return {
            hidden: [...document.querySelectorAll("#board-tabs .board-tab")]
              .filter((t) => { const b = t.getBoundingClientRect(); return b.left < strip.left - 1 || b.right > strip.right + 1; })
              .map((t) => t.title),
            underPill: pill.width > 0 && strip.right > pill.left + 1,
          };
        });
        assert.deepEqual(r.hidden, [], "tabs out of sight");
        assert.equal(r.underPill, false, "the tab strip runs under the status pill");
      });
    }
    await p.setViewportSize({ width: 1400, height: 900 });

    assert.deepEqual(a.errors, [], "no page errors");
    console.log("all stats-tiles checks passed");
  } catch (e) {
    process.exitCode = 1;
  } finally {
    await env.close();
  }
})();
