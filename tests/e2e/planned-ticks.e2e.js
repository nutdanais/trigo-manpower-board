/* Acceptance run for the "my part is planned" ticks (design/engineer-planned-ticks.html, A2):
   the line at the end of "By area" with your own tick, the count, who is left and "All n";
   ticking and unticking, the tick reaching a second user live, "Ready to share with crew",
   who may tick (your own name; a Manager anyone; a Viewer nobody), a past day, the phone's two
   rows, Thai, that it is never inside the exported area, and a database without
   migration-2026-11-12. Real app in Chromium against the shared fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/planned-ticks.e2e.js
   Seed: harness.seedBase, plus a day on the next working day with 201 (Eng One) and 202 (Eng Two),
   Eng One linked to eng.a's account and Eng Two to eng.b's. Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
const NEXT = h.nextWorking(SRC);
const PAST = h.prevWorking(h.prevWorking(SRC));
const MANAGER = { id: "00000000-0000-0000-0000-0000000000ae", email: "mgr.m@example.com", role: "manager" };

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 5).join("\n   ")); throw e; }
}

function seed(db) {
  h.seedBase(db, { src: SRC });
  db.seed("profiles", [{ id: MANAGER.id, email: MANAGER.email, full_name: "mgr.m", display_name: "mgr.m", role_key: "manager", status: "active" }]);
  db.t("engineers").find((e) => e.id === "eng-1").profile_id = h.USERS.a.id;
  db.t("engineers").find((e) => e.id === "eng-2").profile_id = h.USERS.b.id;
  for (const date of [NEXT, PAST]) {
    db.seed("missions", [
      { id: "n201-" + date, board_id: "b1", plan_date: date, number: "201", host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" },
      { id: "n202-" + date, board_id: "b1", plan_date: date, number: "202", host: "Host Beta", customer: "Cust Beta", shift: "day", engineer_id: "eng-2" },
    ]);
  }
}

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const db = new h.FakeDb();
    seed(db);
    const openDay = (pg, d) => pg.evaluate((d) => { state.date = d; state.unlockedDates.add(d); return refreshAndRender(); }, d);
    const bar = (pg) => pg.locator("#ready-bar");
    const text = async (pg) => (await bar(pg).innerText()).replace(/\s+/g, " ").trim();
    const tick = (pg, eng, root = "#ready-bar") => pg.locator(`${root} .rd-tk[data-ready="${eng}"]`).first();
    const rows = () => db.t("plan_day_ready").filter((r) => r.board_id === "b1" && r.plan_date === NEXT);
    const until = async (fn, ms = 4000) => { const end = Date.now() + ms; for (;;) { if (await fn()) return; if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 50)); } };

    const a = await env.openAs(db, h.USERS.a);
    const b = await env.openAs(db, h.USERS.b);
    await openDay(a.page, NEXT);
    await openDay(b.page, NEXT);

    await step("the line sits at the end of By area: Planned, your own tick, 0 of 2, who is left, All 2", async () => {
      await bar(a.page).waitFor();
      assert.equal(await a.page.locator("#area-bar #ready-bar").count(), 1);
      const t = await text(a.page);
      assert.match(t, /^Planned /);
      assert.match(t, /\(you\)/);
      assert.match(t, /0 of 2 planned/);
      assert.match(t, /Waiting for /);
      assert.match(t, /All 2/);
      assert.equal(await tick(a.page, "eng-1").getAttribute("aria-pressed"), "false");
      assert.equal(await tick(a.page, "eng-1").isEnabled(), true);
      assert.equal(await a.page.locator("#ready-bar > .rd-tk").count(), 1, "only your own tick is on the line");
    });

    await step("the line is never inside the exported area", async () => {
      assert.equal(await a.page.locator("#board-capture #ready-bar, #board-capture .rd-tk").count(), 0);
    });

    await step("ticking your name saves it with who ticked, and the count moves", async () => {
      await tick(a.page, "eng-1").click();
      await until(async () => /1 of 2 planned/.test(await text(a.page)));
      assert.equal(rows().length, 1);
      assert.equal(rows()[0].engineer_id, "eng-1");
      assert.equal(rows()[0].ticked_by, h.USERS.a.email);
      assert.equal(await tick(a.page, "eng-1").getAttribute("aria-pressed"), "true");
      assert.match(await tick(a.page, "eng-1").getAttribute("title"), /^Ticked by eng\.a at \d{2}:\d{2}/);
    });

    await step("a second engineer sees the tick live, without a refresh", async () => {
      await until(async () => /1 of 2 planned/.test(await text(b.page)));
      assert.match(await text(b.page), /Only you left/);
    });

    await step("All lists every engineer; another engineer's tick is not yours to change", async () => {
      await a.page.locator("#ready-bar .rd-all").click();
      const list = a.page.locator("#ready-bar .rd-list");
      await list.waitFor();
      assert.equal(await list.locator(".rd-tk").count(), 2);
      assert.equal(await list.locator('.rd-tk[data-ready="eng-2"]').isDisabled(), true);
      assert.equal(await list.locator('.rd-tk[data-ready="eng-1"]').isEnabled(), true);
      await a.page.keyboard.press("Escape");
      await until(async () => (await a.page.locator("#ready-bar .rd-list").count()) === 0);
    });

    await step("when the last engineer ticks, everyone sees Ready to share with crew", async () => {
      await tick(b.page, "eng-2").click();
      await until(async () => /Ready to share with crew/.test(await text(b.page)));
      await until(async () => /Ready to share with crew/.test(await text(a.page)));
      assert.match(await text(a.page), /2 of 2 planned/);
      assert.doesNotMatch(await text(a.page), /Waiting for/);
    });

    await step("unticking takes the tick away again", async () => {
      await tick(a.page, "eng-1").click();
      await until(async () => /1 of 2 planned/.test(await text(a.page)));
      assert.deepEqual(rows().map((r) => r.engineer_id), ["eng-2"]);
      await until(async () => /Waiting for/.test(await text(b.page)));
    });

    await step("a Manager has no own tick but can tick anyone from All", async () => {
      const m = await env.openAs(db, MANAGER);
      await openDay(m.page, NEXT);
      await bar(m.page).waitFor();
      assert.equal(await m.page.locator("#ready-bar > .rd-tk").count(), 0);
      await m.page.locator("#ready-bar .rd-all").click();
      const one = m.page.locator('#ready-bar .rd-list .rd-tk[data-ready="eng-1"]');
      assert.equal(await one.isEnabled(), true);
      await one.click();
      await until(() => rows().some((r) => r.engineer_id === "eng-1" && r.ticked_by === MANAGER.email));
      await until(async () => /Ticked by mgr\.m/.test(await tick(a.page, "eng-1").getAttribute("title") || ""));
      assert.deepEqual(m.errors, []);
    });

    await step("a Viewer sees the ticks but cannot change any", async () => {
      const v = await env.openAs(db, h.USERS.v);
      await openDay(v.page, NEXT);
      await bar(v.page).waitFor();
      await v.page.locator("#ready-bar .rd-all").click();
      const all = v.page.locator("#ready-bar .rd-list .rd-tk");
      assert.equal(await all.count(), 2);
      for (let i = 0; i < 2; i++) assert.equal(await all.nth(i).isDisabled(), true);
      assert.deepEqual(v.errors, []);
    });

    await step("a past day shows its ticks but they cannot be changed", async () => {
      db.seed("plan_day_ready", [{ board_id: "b1", plan_date: PAST, engineer_id: "eng-2", ticked_by: h.USERS.b.email, ticked_at: new Date().toISOString() }]);
      await openDay(a.page, PAST);
      await bar(a.page).waitFor();
      assert.match(await text(a.page), /1 of 2 planned/);
      assert.equal(await tick(a.page, "eng-1").isDisabled(), true);
      await openDay(a.page, NEXT);
    });

    await step("a phone: two rows under the summary card, All on the second, never a third", async () => {
      const ph = await env.openAs(db, h.USERS.a, { viewport: { width: 360, height: 780 } });
      await openDay(ph.page, NEXT);
      const box = ph.page.locator("#m-ready");
      await box.locator(".rd-r1").waitFor();
      assert.equal(await ph.page.locator("#ready-bar").isVisible().catch(() => false), false);
      assert.equal(await box.locator(".rd-r1 .rd-tk.me").count(), 1);
      assert.equal(await box.locator(".rd-r2 .rd-all").count(), 1);
      const r1 = await box.locator(".rd-r1").boundingBox();
      const r2 = await box.locator(".rd-r2").boundingBox();
      const all = await box.locator(".rd-r2 .rd-all").boundingBox();
      assert.ok(r1.height <= 34 && r2.height <= 34, `each row is one line (${r1.height}, ${r2.height})`);
      assert.ok(all.y >= r2.y - 1 && all.y + all.height <= r2.y + r2.height + 1, "All is on the second row");
      const sum = await ph.page.locator("#m-summary").boundingBox();
      assert.ok(r1.y > sum.y + sum.height - 1, "it sits under the summary card");
      await box.locator(".rd-all").click();
      await box.locator(".rd-list .rd-tk").first().waitFor();
      assert.equal(await box.locator(".rd-list .rd-tk").count(), 2);
      assert.deepEqual(ph.errors, []);
    });

    await step("Thai: the line is translated, the names are not", async () => {
      const th = await env.openAs(db, h.USERS.b);
      await th.page.evaluate(() => localStorage.setItem("manpower.lang", "th"));
      await th.page.reload();
      await th.page.waitForSelector("#board-tabs .board-tab", { state: "attached" });
      await openDay(th.page, NEXT);
      await bar(th.page).waitFor();
      await until(async () => !/planned/.test(await text(th.page)));
      const t = await text(th.page);
      assert.doesNotMatch(t, /planned|Waiting for|All 2|\(you\)/, t);
      const missing = await th.page.evaluate(() => (window.I18N && I18N.missing ? I18N.missing() : []).filter((s) => /planned|Waiting|Ready to share|Only you|Tick|Ticked|All \d/.test(s)));
      assert.deepEqual(missing, []);
    });

    await step("no errors on the way", async () => {
      assert.deepEqual(a.errors, []);
      assert.deepEqual(b.errors, []);
    });

    await step("a database without migration-2026-11-12: no line, nothing breaks", async () => {
      const old = new h.FakeDb({ ready: false });
      seed(old);
      const o = await env.openAs(old, h.USERS.a);
      await openDay(o.page, NEXT);
      await o.page.locator("#missions-grid .mission-card").first().waitFor();
      assert.equal(await o.page.locator("#ready-bar").count(), 0);
      assert.equal(await o.page.locator("#m-ready").innerHTML(), "");
      assert.deepEqual(o.errors.filter((e) => !/plan_day_ready unavailable/.test(e)), []);
    });
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
})();
