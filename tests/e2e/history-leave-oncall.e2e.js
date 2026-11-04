/* Acceptance run for Overview → History's Leave / day and On-call deployed / day:
     - two more tiles: Leave / day (all five types, Exchange Working Day included) and
       On-call deployed / day ("today N of M": M is the on-call roster minus on-call leave);
     - picking Leave draws the leave by type, with a button per type that shows or hides it,
       a by-type table (person-days, average, share, different people, peak day) and the
       people with the most days on leave;
     - Chart | Calendar: the calendar has a cell per day with the leave count (the types
       shown) and the on-call people deployed, and grey cells for days History leaves out;
     - picking On-call draws called in against available and lists who was called in most;
     - a board-day nobody planned is left out here too, and it all reads in Thai.
     NODE_PATH=$(npm root -g) node tests/e2e/history-leave-oncall.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
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
    const P2 = h.prevWorking(SRC);
    const P1 = h.prevWorking(P2);
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    // Board One: Persons A-F permanent, G and H on-call.
    //   P1: A, B, C and G on a mission; D annual leave, E sick leave, H exchange working day.
    //   P2: A, B, G and H on a mission; D annual leave, F business leave.
    // Board Two (I, J) has no mission on P1 or P2: nobody planned it, so I's leave there is left out.
    db.seed("missions", [
      { id: "m1", board_id: "b1", plan_date: P1, number: "201", host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" },
      { id: "m2", board_id: "b1", plan_date: P2, number: "201", host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" },
    ]);
    const on = (e, d, m) => ({ employee_id: e, plan_date: d, mission_id: m, zone: null });
    const off = (e, d, z) => ({ employee_id: e, plan_date: d, mission_id: null, zone: z });
    db.seed("assignments", [
      on("e1", P1, "m1"), on("e2", P1, "m1"), on("e3", P1, "m1"), on("e7", P1, "m1"),
      off("e4", P1, "annual"), off("e5", P1, "sick"), off("e8", P1, "exchange"),
      on("e1", P2, "m2"), on("e2", P2, "m2"), on("e7", P2, "m2"), on("e8", P2, "m2"),
      off("e4", P2, "annual"), off("e6", P2, "business"),
      off("e9", P1, "annual"),   // Board Two, not planned: not counted
    ]);
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const OVERVIEW = await p.evaluate(() => OVERVIEW_ID);
    await p.evaluate(async ([d, ov, from, to]) => {
      state.date = d; D().activeBoardId = ov;
      state.overview.boardId = "";
      state.overview.historyPreset = "custom"; state.overview.historyFrom = from; state.overview.historyTo = to;
      state.overview.historyCacheKey = null;
      await refreshAndRender();
    }, [SRC, OVERVIEW, P1, P2]);
    const text = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, " ").trim()), sel);
    const tiles = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".ov-htile")].map((t) => {
      const q = (c) => t.querySelector(c).textContent.replace(/\s+/g, " ").trim();
      return [q(".ov-htile-label"), { value: q(".ov-htile-value"), sub: q(".ov-htile-sub") }];
    })));
    const pick = async (label) => { await p.locator(".ov-htile", { hasText: label }).first().click(); await p.waitForTimeout(150); };

    await step("two more tiles: Leave / day and On-call deployed / day, over planned days only", async () => {
      const t = await tiles();
      assert.equal(Object.keys(t).length, 6, "six History tiles");
      assert.equal(t["Leave / day"].value, "2.5 avg", "3 on P1 (Exchange included), 2 on P2; Board Two's leave is left out");
      assert.equal(t["On-call deployed / day"].value, "1.5 avg", "G on P1; G and H on P2");
      assert.match(t["On-call deployed / day"].sub, / 2 of 2$/, "both on-call people were available on P2");
    });

    await step("Leave: one column per type, a button per type, the by-type table and the names", async () => {
      await pick("Leave / day");
      const chips = await text(".ov-lv-chip");
      assert.deepEqual(chips, ["Annual Leave 1.0 / day", "Sick Leave 0.5 / day", "Business Leave 0.5 / day", "Unpaid Leave 0.0 / day", "Exchange Working Day 0.5 / day"]);
      const rows = await p.evaluate(() => [...document.querySelectorAll(".ov-lv-table tbody tr")].map((tr) => [...tr.cells].map((c) => c.textContent.replace(/\s+/g, " ").trim())));
      assert.deepEqual(rows[0], ["Annual Leave", "2", "1.0", "40%", "1", rows[0][5]]);
      assert.match(rows[0][5], /\(1\)$/, "the peak day has 1 on Annual Leave");
      assert.deepEqual(rows[3].slice(0, 5), ["Unpaid Leave", "0", "0.0", "0%", "0"]);
      assert.deepEqual(rows[4].slice(0, 5), ["Exchange Working Day", "1", "0.5", "20%", "1"]);
      assert.deepEqual(rows[5].slice(0, 5), ["All leave", "5", "2.5", "", "4"], "D, E, F and H: four different people, five person-days");
      const segs = await p.locator(".ov-section .chart-column-chart rect.chart-mark").count();
      assert.equal(segs, 5, "P1: annual, sick, exchange; P2: annual, business");
      const names = await p.evaluate(() => [...document.querySelectorAll(".ov-hnames-table tbody tr")].map((tr) => tr.cells[0].textContent.trim() + " | " + tr.cells[1].textContent.trim()));
      assert.equal(names[0], "Person D | 2", "D was on annual leave both days");
      assert.equal(names.length, 4);
      assert.ok(names.includes("Person H OC | 1"), "an on-call person carries the OC tag");
    });

    await step("a type button hides that type, and the last one shown can't be switched off", async () => {
      await p.locator(".ov-lv-chip", { hasText: "Annual Leave" }).click();
      assert.equal(await p.locator(".ov-lv-chip", { hasText: "Annual Leave" }).getAttribute("aria-pressed"), "false");
      assert.equal(await p.locator(".ov-section .chart-column-chart rect.chart-mark").count(), 3);
      for (const t of ["Sick Leave", "Business Leave", "Unpaid Leave", "Exchange Working Day"]) await p.locator(".ov-lv-chip", { hasText: t }).click();
      const pressed = await p.evaluate(() => [...document.querySelectorAll(".ov-lv-chip")].map((c) => c.getAttribute("aria-pressed")));
      assert.deepEqual(pressed, ["false", "false", "false", "false", "true"], "Exchange, the last one on, stays on");
      for (const t of ["Annual Leave", "Sick Leave", "Business Leave", "Unpaid Leave"]) await p.locator(".ov-lv-chip", { hasText: t }).click();
    });

    await step("Calendar: a cell per day with the leave and the on-call deployed; other days grey", async () => {
      await p.locator(".ov-hview .btn", { hasText: "Calendar" }).click();
      const cells = await p.evaluate(() => [...document.querySelectorAll(".ov-cal-cell.chart-mark")].map((c) => ({
        n: c.querySelector(".ov-cal-n").textContent, oc: c.querySelector(".ov-cal-oc").textContent, tip: c.dataset.tipLabel })));
      assert.equal(cells.length, 2, "P1 and P2");
      assert.deepEqual(cells.map((c) => [c.n, c.oc]), [["3", "1 on-call"], ["2", "2 on-call"]]);
      assert.match(cells[0].tip, /Annual Leave 1 · Sick Leave 1 · Exchange Working Day 1 · 1 on-call deployed of 1$/);
      assert.ok(await p.locator(".ov-cal-off").count() > 0, "the rest of the month is grey");
      await p.locator(".ov-lv-chip", { hasText: "Sick Leave" }).click();
      assert.deepEqual(await text(".ov-cal-cell.chart-mark .ov-cal-n"), ["2", "2"], "hiding Sick Leave takes it off the count");
      await p.locator(".ov-lv-chip", { hasText: "Sick Leave" }).click();
      await p.locator(".ov-hview .btn", { hasText: "Chart" }).click();
    });

    await step("On-call: called in against available, and who was called in most", async () => {
      await pick("On-call deployed / day");
      const marks = await p.evaluate(() => [...document.querySelectorAll(".ov-section .chart-column-chart rect.chart-mark")].map((r) => r.dataset.tipLabel.split(" — ")[0] + "=" + r.dataset.tipValue));
      assert.deepEqual(marks, ["On-call available=1", "Called in=1", "On-call available=2", "Called in=2"]);
      const head = (await text(".ov-hchart-head-row .ov-muted"))[0];
      assert.equal(head, "Called in on 100% of the available on-call days · 38% of the people on missions", "3 of 3 on-call days; 3 of the 8 people on missions");
      const names = await p.evaluate(() => [...document.querySelectorAll(".ov-hnames-table tbody tr")].map((tr) => tr.cells[0].textContent.trim() + " | " + tr.cells[1].textContent.trim()));
      assert.deepEqual(names, ["Person G OC | 2", "Person H OC | 1"]);
    });

    await step("in Thai the new tiles, views and tables read in Thai", async () => {
      await p.evaluate(() => I18N.setLang("th"));
      await p.waitForTimeout(200);
      const read = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.replace(/\s+/g, " ").trim()), sel);
      const labels = await read(".ov-htile-label");
      assert.deepEqual(labels.slice(4), ["ลา / วัน", "ออนคอลที่ปฏิบัติงาน / วัน"]);
      // On-call is picked: its heading line, legend and name list
      assert.deepEqual(await read(".ov-hchart-head-row .ov-muted"), ["เรียกตัว 100% ของวันที่ออนคอลพร้อม · 38% ของคนที่ปฏิบัติมิชชั่น"]);
      assert.deepEqual(await read(".ov-hnames .ov-hchart-head"), ["ถูกเรียกตัวมากที่สุด เรียกตัวออนคอล 2 คน"]);
      const english = (xs) => xs.filter((x) => /[A-Za-z]{3}/.test(x.replace(/\bOC\b|Person [A-J]|Board (One|Two)/g, "")));
      assert.deepEqual(english(await read(".ov-htile-help, .ov-hchart .ov-legend")), [], "help line and legend in Thai");
      // Leave, chart then calendar
      await p.locator(".ov-htile").nth(4).click();
      await p.waitForTimeout(200);
      assert.deepEqual(await read(".ov-hview .btn"), ["กราฟ", "ปฏิทิน"]);
      assert.equal((await read(".ov-lv-chip"))[0], "ลาพักร้อน 1.0 / วัน");
      assert.deepEqual((await read(".ov-lv-table th")).slice(0, 3), ["ประเภทการลา", "คน-วัน", "เฉลี่ย / วัน"]);
      assert.deepEqual(english(await read(".ov-htile-help, .ov-lv-table td, .ov-hnames")), [], "the table and the names in Thai");
      await p.locator(".ov-hview .btn").nth(1).click();
      await p.waitForTimeout(200);
      assert.deepEqual(english(await read(".ov-cal-cell, .ov-cal-key, .ov-cal-dow")), [], "the calendar in Thai");
      await p.evaluate(() => I18N.setLang("en"));
    });

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all history-leave-oncall checks passed");
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
    if (failed) process.exit(1);
  }
})();
