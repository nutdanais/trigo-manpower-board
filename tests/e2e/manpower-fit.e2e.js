/* The Manpower List keeps to the page's width (desktop):
     - at 1600 px the whole table fits beside the header: the page has no sideways scroll and the box isn't a
       scroller (so the headers can stay sticky under the top bar);
     - someone lent out reads "LCB Port → Rayong" with "until …" on its own line, so one loan doesn't widen
       the Current board column for everyone;
     - Years of service reads "7y 8m" on one line, and copies with plain spaces;
     - at 1100 px, too narrow for every column, the table's own box scrolls sideways (.tw-scroll), never the page.
   Run: node tests/e2e/manpower-fit.e2e.js */
"use strict";
const assert = require("assert");
const h = require("./harness");

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 6).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const TODAY = h.iso(new Date());
    const SRC = h.isWeekend(TODAY) ? h.prevWorking(TODAY) : TODAY;
    const seed = () => {
      const db = new h.FakeDb();
      h.seedBase(db, { src: SRC });
      db.tables.boards.length = 0;
      db.seed("boards", [{ id: "b1", name: "Non-Rayong", weekend_days: [0, 6] }, { id: "b2", name: "Rayong", weekend_days: [0, 6] }]);
      const pos = ["inspector", "senior_inspector", "technician", "team_leader", "assistant_site_engineer"];
      db.tables.employees.forEach((e, i) => Object.assign(e, { position: pos[i % 5], phone: "082-2149903", start_date: "2019-03-0" + (1 + (i % 9)), trigo_id: "T" + (300 + i), name_en: i % 2 ? "Fake English Name" : null }));
      db.seed("employee_loans", [{ id: "l1", employee_id: "e1", to_board_id: "b2", start_date: SRC, end_date: h.addDays(SRC, 25), note: null, created_by: "eng.a@example.com" }]);
      return db;
    };
    const open = async (width) => {
      const a = await env.openAs(seed(), h.USERS.a, { viewport: { width, height: 900 } });
      await a.page.evaluate((d) => { state.date = d; D().activeBoardId = EMPLIST_ID; return refreshAndRender(); }, SRC);
      await a.page.waitForSelector("#emplist-body tr");
      return a;
    };
    const measure = (p) => p.evaluate(() => {
      const t = document.querySelector("#emplist-table");
      return { page: document.documentElement.scrollWidth, vw: innerWidth, scroller: t.parentElement.classList.contains("tw-scroll"),
        overflowX: getComputedStyle(t.parentElement).overflowX, th: getComputedStyle(t.querySelector("thead th")).position };
    });

    await step("1600 px: the table fits the page, no sideways scroll, headers stay sticky", async () => {
      const a = await open(1600);
      const m = await measure(a.page);
      assert.equal(m.page, m.vw, "the page is no wider than the window");
      assert.equal(m.scroller, false);
      assert.equal(m.overflowX, "visible", "the box doesn't scroll, so the headers can stick under the top bar");
      assert.equal(m.th, "sticky");

      const cell = a.page.locator("#emplist-body tr", { hasText: "T300" }).locator('td[data-label="Current board"]');
      assert.equal((await cell.textContent()).replace(/\s+/g, " ").trim().startsWith("Non-Rayong → Rayong until"), true);
      const lines = await cell.evaluate((td) => {
        const small = td.querySelector(".el-loan small"), to = td.querySelector(".el-loan");
        return { untilBelow: small.getBoundingClientRect().top >= to.getBoundingClientRect().top + 8, block: getComputedStyle(small).display };
      });
      assert.deepEqual(lines, { untilBelow: true, block: "block" }, '"until …" sits on its own line');
      // the loan's column is no wider than one without it would need for "Non-Rayong → Rayong"
      const col = await cell.evaluate((td) => td.getBoundingClientRect().width);
      assert.ok(col < 240, `Current board stays narrow (${Math.round(col)} px)`);

      const svc = await a.page.evaluate(() => [...document.querySelectorAll('#emplist-body td[data-label="Years of service"]')].map((td) => td.textContent));
      assert.ok(svc.every((t) => /^(\d+y( \d+m)?|\d+m|\d+d)$/.test(t)), "short, with plain spaces: " + svc.map((t) => JSON.stringify(t)).join(", "));
      await a.close();
    });

    await step("1100 px: too narrow for every column, so the table's box scrolls sideways, never the page", async () => {
      const a = await open(1100);
      const m = await measure(a.page);
      assert.equal(m.page, m.vw, "the page is no wider than the window");
      assert.equal(m.scroller, true);
      assert.equal(m.overflowX, "auto");
      assert.equal(m.th, "static", "a scrolling box can't hold the headers under the page's top bar");
      // Years of service and Position take two lines at most
      const tall = await a.page.evaluate(() => [...document.querySelectorAll('#emplist-body td:is([data-label="Years of service"], [data-label="Position"])')]
        .map((td) => { const r = document.createRange(); r.selectNodeContents(td); return r.getClientRects().length ? Math.round(r.getBoundingClientRect().height / (parseFloat(getComputedStyle(td).lineHeight) || parseFloat(getComputedStyle(td).fontSize) * 1.3)) : 0; }));
      assert.ok(tall.every((n) => n <= 2), "lines per cell: " + tall.join(", "));
      // widening the window brings the full-page layout back
      await a.page.setViewportSize({ width: 1700, height: 900 });
      await a.page.waitForFunction(() => !document.querySelector("#emplist-table").parentElement.classList.contains("tw-scroll"));
      await a.close();
    });
  } catch (e) { failed = true; }
  await env.close();
  if (failed) process.exit(1);
  console.log("all manpower-fit checks passed");
})();
