/* Regression: opening the app on a wide screen lays the mission cards out in
   columns, not one stacked column. document.fonts.ready used to call
   layoutMasonry with its FontFaceSet as the column count, which packed every
   card into column 0 until a refresh or a tab switch re-rendered the board.
     NODE_PATH=$(npm root -g) node tests/e2e/masonry-on-open.e2e.js */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const day = h.nextWorking(h.iso(new Date()));   // the app opens on the next working day
    const db = new h.FakeDb();
    h.seedBase(db, { src: day });
    const ms = [];
    for (let i = 0; i < 8; i++) ms.push({ id: "m" + i, board_id: "b1", plan_date: day, number: "20" + i, host: "Host Alpha", customer: "Cust", shift: "day", engineer_id: "eng-1" });
    db.seed("missions", ms);
    const a = await env.openAs(db, h.USERS.a, { viewport: { width: 2000, height: 1040 } });
    await a.page.evaluate(() => document.fonts.ready);
    await a.page.waitForTimeout(300);
    const lefts = await a.page.$$eval("#missions-grid .mission-card", (cs) => [...new Set(cs.map((c) => c.style.left))]);
    try {
      assert.ok(lefts.length >= 3, "cards sit in several columns, got lefts " + JSON.stringify(lefts));
      assert.deepEqual(a.errors, []);
      console.log("ok - the board opens with its missions in columns");
    } catch (e) { failed = true; console.log("FAIL - the board opens with its missions in columns\n   " + e.message); }
  } finally { await env.close(); }
  process.exit(failed ? 1 : 0);
})();
