/* Acceptance run for Overview phase 2, batch D2: click a day, everywhere.
   Every chart of days in the Overview opens the board on that day (the busiest board of the scope that
   day, or the board of a small chart in Side by side; with an engineer picked, filtered to them), by mouse
   and by keyboard (the mark takes focus, Enter opens it), and a week or month column opens its first day:
     - History: a tile's chart by Day, Week and Month (also over a range long enough to draw no dots),
       Side by side;
     - the Leave columns (a day with leave and a day with none) and the Calendar;
     - the On-call columns, by Count and by Share, on a day nobody was called in;
     - the one-engineer chart by Day, Week and Month.
   NODE_PATH=$(npm root -g) node tests/e2e/overview-click-day.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 30).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const today = h.iso(new Date());
    const back = h.addDays(today, -21);
    const W = h.addDays(back, -((new Date(back + "T00:00:00").getDay() + 6) % 7));
    const d = [0, 1, 2, 3, 4, 5, 6].map((i) => h.addDays(W, i));
    const db = new h.FakeDb();
    h.seedBase(db, { src: h.isWeekend(today) ? h.prevWorking(today) : today });
    // Board One: a day mission (A, B, C and on-call G Mon-Wed) and a night mission (D); Board Two: I and J. E on annual leave Mon and Tue.
    // So on Thu and Fri nobody on-call was called in and nobody was on leave; Board One is the busier board every day.
    const missions = [], as = [];
    const on = (e, day, m) => as.push({ employee_id: e, plan_date: day, mission_id: m, zone: null });
    const m = (id, board, day, num, host, shift) => missions.push({ id, board_id: board, plan_date: day, number: num, host, customer: "Cust Alpha", shift, engineer_id: "eng-1" });
    d.slice(0, 5).forEach((day, i) => {
      m("D" + i, "b1", day, "30" + i, "Host Alpha", "day"); m("N" + i, "b1", day, "40" + i, "Host Beta", "night"); m("T" + i, "b2", day, "60" + i, "Host Beta", "day");
      for (const e of ["e1", "e2", "e3"]) on(e, day, "D" + i);
      if (i < 3) on("e7", day, "D" + i);
      on("e4", day, "N" + i); on("e9", day, "T" + i); on("e10", day, "T" + i);
    });
    as.push({ employee_id: "e5", plan_date: d[0], mission_id: null, zone: "annual" }, { employee_id: "e5", plan_date: d[1], mission_id: null, zone: "annual" });
    db.seed("missions", missions);
    db.seed("assignments", as);

    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const OVERVIEW = await p.evaluate(() => OVERVIEW_ID);
    const showOverview = (o = {}) => p.evaluate(async ([day, ov, f, t, opts]) => {
      state.date = day; D().activeBoardId = ov; state.filters.engineer = [];
      state.overview.boardId = ""; state.overview.historyPreset = "custom"; state.overview.historyFrom = opts.from || f; state.overview.historyTo = t;
      state.overview.historyCacheKey = null; state.overview.historyMeasure = opts.measure || "deployed";
      state.overview.historyGroup = opts.group || "day"; state.overview.historyBoards = opts.side ? "side" : "together"; state.overview.historyCompare = "prev";
      state.overview.historyOncallMode = opts.share ? "share" : "count"; state.overview.historyLeaveView = opts.calendar ? "calendar" : "chart";
      state.overview.engGroup = opts.eng || "day"; state.overview.engPick = "eng-1";
      await refreshAndRender();
    }, [d[6], OVERVIEW, d[0], d[6], o]);
    const where = () => p.evaluate(() => [state.date, D().activeBoardId, state.filters.engineer.slice()]);
    /* opens the day by mouse, then again (fresh) by keyboard: focus the mark and press Enter */
    const both = async (sel, expectDate, expectBoard, expectEng) => {
      for (const how of ["click", "enter"]) {
        const el = p.locator(sel).first();
        await el.scrollIntoViewIfNeeded();
        if (how === "click") await el.click({ force: true }); else { await el.focus(); await p.keyboard.press("Enter"); }
        await p.waitForTimeout(250);
        assert.deepEqual(await where(), [expectDate, expectBoard, expectEng || []], `${how} on ${sel}`);
        await p.evaluate(([day, ov]) => { state.date = day; D().activeBoardId = ov; state.filters.engineer = []; return refreshAndRender(); }, [d[6], OVERVIEW]);
      }
    };
    const chart = ".ov-hchart:not(.ov-eng):not(.ov-spread)";
    await showOverview();

    await step("History line chart: a point opens that day on the busiest board, by click and by Enter", async () => {
      await both(`${chart} circle.chart-dot[data-date="${d[2]}"]`, d[2], "b1");
    });

    await step("History by Week and by Month: the column opens its first day", async () => {
      for (const group of ["week", "month"]) {
        await showOverview({ group });
        await both(`${chart} circle.chart-dot[data-date]`, d[0], "b1");
      }
    });

    await step("History over a range long enough to draw no dots: a day still opens", async () => {
      const from = h.addDays(d[6], -100);
      await showOverview({ from });
      assert.equal(await p.locator(`${chart} circle.chart-dot`).count(), 0, "no dots past 70 points");
      assert.ok(await p.locator(`${chart} rect.chart-hit[data-date="${d[2]}"]`).count() >= 1, "a hit area per day");
      await p.locator(`${chart} rect.chart-hit[data-date="${d[2]}"]`).first().click({ force: true });
      await p.waitForTimeout(250);
      assert.deepEqual((await where()).slice(0, 2), [d[2], "b1"]);
    });

    await step("History Side by side: a day in a board's own chart opens that board", async () => {
      await showOverview({ side: true });
      await both(`${chart} .ov-small[data-board=b2] circle.chart-dot[data-date="${d[3]}"]`, d[3], "b2");
    });

    await step("Leave columns: a day with leave and a day with none, by click and by Enter; the Calendar too", async () => {
      await showOverview({ measure: "leave" });
      await both(`${chart} rect.chart-mark[data-date="${d[0]}"][tabindex]`, d[0], "b1");
      await both(`${chart} rect.chart-hit[data-date="${d[3]}"]`, d[3], "b1");
      await showOverview({ measure: "leave", group: "week" });
      await both(`${chart} rect.chart-mark[data-date][tabindex]`, d[0], "b1");
      await showOverview({ measure: "leave", calendar: true });
      await both(`.ov-cal-cell[data-date="${d[3]}"]`, d[3], "b1");
    });

    await step("On-call columns (Count and Share): a day nobody was called in opens too", async () => {
      await showOverview({ measure: "oncall" });
      await both(`${chart} rect.chart-hit[data-date="${d[3]}"]`, d[3], "b1");
      await both(`${chart} rect.chart-mark[data-date="${d[1]}"][tabindex]`, d[1], "b1");
      await showOverview({ measure: "oncall", share: true });
      await both(`${chart} rect.chart-hit[data-date="${d[4]}"]`, d[4], "b1");
      await showOverview({ measure: "oncall", share: true, group: "month" });
      await both(`${chart} rect.chart-mark[data-date][tabindex]`, d[0], "b1");
    });

    await step("One engineer: Day opens that day filtered to them; Week and Month open their first day", async () => {
      for (const eng of ["day", "week", "month"]) {
        await showOverview({ eng });
        const sel = `.ov-eng rect.chart-mark[data-date]${eng === "day" ? `[data-date="${d[2]}"]` : ""}`;
        const date = eng === "day" ? d[2] : d[0];
        for (const how of ["click", "enter"]) {
          const el = p.locator(sel + "[tabindex]").first();
          await el.scrollIntoViewIfNeeded();
          if (how === "click") await el.click({ force: true }); else { await el.focus(); await p.keyboard.press("Enter"); }
          await p.waitForTimeout(250);
          assert.deepEqual(await where(), [date, "b1", ["eng-1"]], `${eng}/${how}`);
          await showOverview({ eng });
        }
      }
    });

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all overview-click-day checks passed");
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
    if (failed) process.exit(1);
  }
})();
