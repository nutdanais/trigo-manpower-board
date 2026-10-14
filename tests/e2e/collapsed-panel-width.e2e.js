/* Regression: on a day where nobody is free (Standby 0, On-call 0) the people
   panel collapses to a 44px rail. The header and toolbar row 1 still reached
   over the full --fp-w, so the page ran ~220px past the window and Settings,
   the avatar, Reset Board and Export sat off screen.
     NODE_PATH=$(npm root -g) node tests/e2e/collapsed-panel-width.e2e.js */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const day = h.nextWorking(h.iso(new Date()));
    const db = new h.FakeDb();
    h.seedBase(db, { src: day });
    // everyone on Board One not already placed goes onto a mission, so both pools are empty
    db.seed("assignments", ["e6", "e7", "e8"].map((id) => ({ employee_id: id, plan_date: day, mission_id: "s102", zone: null })));
    const a = await env.openAs(db, h.USERS.a, { viewport: { width: 1600, height: 900 } });
    await a.page.waitForTimeout(500);
    const r = await a.page.evaluate(() => ({
      collapsed: document.body.classList.contains("fp-collapsed"),
      vw: document.documentElement.clientWidth,
      sw: document.documentElement.scrollWidth,
      row1: Math.round(document.querySelector("#toolbar-row1").getBoundingClientRect().right),
      topbar: Math.round(document.querySelector("#topbar").getBoundingClientRect().right),
    }));
    try {
      assert.ok(r.collapsed, "the panel is collapsed: " + JSON.stringify(r));
      assert.ok(r.sw <= r.vw, "no horizontal overflow: " + JSON.stringify(r));
      assert.ok(r.row1 <= r.vw && r.topbar <= r.vw, "header and toolbar end at the window edge: " + JSON.stringify(r));
      assert.deepEqual(a.errors, []);
      console.log("ok - a collapsed people panel keeps the page within the window");
    } catch (e) { failed = true; console.log("FAIL - a collapsed people panel keeps the page within the window\n   " + e.message); }
  } finally { await env.close(); }
  process.exit(failed ? 1 : 0);
})();
