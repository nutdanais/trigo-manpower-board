/* Acceptance run for the forward-planning release (brief §4.4, §5.4, §6.6),
   driving the real app in Chromium against the shared fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/forward-planning.e2e.js
   Each scenario starts from a fresh database. Exits non-zero on the first
   failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;   // the day carried from
const H = h.nextWorking(T);                          // horizon end: last confirmed day
const F = h.nextWorking(H);                          // first forecast working day

let failures = 0;
async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { failures++; console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 4).join("\n   ")); throw e; }
}
async function until(fn, what, ms = 8000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out waiting for: " + what + (last instanceof Error ? " (" + last.message + ")" : ""));
}
async function gotoDate(page, date) {
  await page.evaluate((d) => { state.date = d; clearSelection(); return refreshAndRender(); }, date);
}
async function gotoBoard(page, id) {
  await page.evaluate((b) => { D().activeBoardId = b; return refreshAndRender(); }, id);
}
const missionCard = (page, number) => page.locator("#missions-grid .mission-card", { has: page.locator(".m-number", { hasText: new RegExp("^" + number + "$") }) });
function placeOf(db, table, empId, date) {
  const a = db.t(table).find((r) => r.employee_id === empId && r.plan_date === date);
  if (!a) return "standby";
  if (a.zone) return "zone:" + a.zone;
  const m = db.t(table === "assignments" ? "missions" : "forecast_missions").find((x) => x.id === (a.mission_id || a.forecast_mission_id));
  return m ? m.number : "?";
}
function asUser(db, user) { return (q) => { const r = db.exec(q, user); if (r.error) throw new Error(r.error.message); return r; }; }

(async () => {
  const env = await h.launch();
  try {
    /* ================= Part A: staleness + Review changes ================= */
    {
      const db = new h.FakeDb();
      h.seedBase(db, { src: SRC });
      const a = await env.openAs(db, h.USERS.a);
      const pa = a.page;
      await gotoDate(pa, H);

      await step("A: Carry over copies the source day and stamps the carry", async () => {
        await pa.click("#btn-reset-board");
        await until(async () => (await pa.locator("#missions-grid .mission-card").count()) === 3, "3 carried missions");
        const s = db.t("plan_day_stamps").find((x) => x.board_id === "b1" && x.plan_date === H);
        assert.equal(s.carried_from, SRC);
        assert.equal(await pa.locator(".plan-banner-stale").count(), 0, "no banner straight after a carry");
      });

      await step("A1: another engineer moving one person and deleting one assignment on the source day raises the banner (live)", async () => {
        const exec = asUser(db, h.USERS.b);
        exec({ table: "assignments", op: "update", values: { mission_id: "s102" }, filters: [["eq", "employee_id", "e1"], ["eq", "plan_date", SRC]] });
        exec({ table: "assignments", op: "delete", filters: [["eq", "employee_id", "e4"], ["eq", "plan_date", SRC]] });
        await until(async () => (await pa.locator(".plan-banner-stale").count()) === 1, "stale banner");
        const text = await pa.textContent(".plan-banner-stale");
        assert.match(text, /has been edited since/);
        assert.match(text, /by eng\.b/);
      });

      await step("A1b: a delete alone is enough to trigger the banner", async () => {
        const db2 = new h.FakeDb();
        h.seedBase(db2, { src: SRC });
        const c = (q) => db2.exec(q, h.USERS.a);
        // replay the stamp a carry leaves (after the seed's own edits), then
        // delete one source row — nothing else
        c({ op: "rpc", fn: "stamp_carry", args: { p_board_id: "b1", p_plan_date: H, p_carried_from: SRC } });
        c({ table: "assignments", op: "delete", filters: [["eq", "employee_id", "e3"], ["eq", "plan_date", SRC]] });
        const src = db2.t("plan_day_stamps").find((x) => x.plan_date === SRC);
        const dest = db2.t("plan_day_stamps").find((x) => x.plan_date === H);
        assert.ok(src.last_edited_at > dest.carried_at, "delete bumped the source stamp past the carry");
      });

      await step("A2: Review changes lists exactly those two differences; applying one changes only that one", async () => {
        await pa.click(".plan-banner-stale >> text=Review changes");
        await until(() => pa.isVisible("#modal-plandiff"), "review panel");
        const items = await pa.$$eval("#plandiff-body .pd-item .pd-text", (els) => els.map((e) => e.textContent));
        assert.deepEqual(items.sort(), ["Move Person A: mission 101 → mission 102", "Move Person D: mission 103 (night) → Standby"]);
        await pa.click("#btn-plandiff-none");
        await pa.locator("#plandiff-body .pd-item", { hasText: "Person A" }).locator("input").check();
        assert.equal((await pa.textContent("#btn-plandiff-apply")).trim(), "Apply 1 change");
        await pa.click("#btn-plandiff-apply");
        await until(async () => !(await pa.isVisible("#modal-plandiff")), "panel closes");
        assert.equal(placeOf(db, "assignments", "e1", H), "102", "ticked move applied");
        assert.equal(placeOf(db, "assignments", "e4", H), "103", "unticked move left alone");
        await until(async () => (await pa.locator(".plan-banner-stale").count()) === 0, "banner cleared by the re-sync stamp");
      });

      await step("A3: no banner on a locked day, a past day, a weekend, or a day with no carry record", async () => {
        asUser(db, h.USERS.b)({ table: "assignments", op: "update", values: { zone: "sick", mission_id: null }, filters: [["eq", "employee_id", "e2"], ["eq", "plan_date", SRC]] });
        await until(async () => (await pa.locator(".plan-banner-stale").count()) === 1, "stale again");
        await pa.click("#btn-lock");
        await until(async () => (await pa.locator(".plan-banner-stale").count()) === 0, "locked day: no banner");
        await gotoDate(pa, h.addDays(T, -1));
        assert.equal(await pa.locator(".plan-banner").count(), 0, "past day");
        let sat = T; while (new Date(sat + "T00:00:00").getDay() !== 6) sat = h.addDays(sat, 1);
        await gotoDate(pa, sat);
        assert.equal(await pa.locator(".plan-banner-stale").count(), 0, "weekend");
        await gotoBoard(pa, "b2");
        await gotoDate(pa, H);
        assert.equal(await pa.locator(".plan-banner-stale").count(), 0, "board with no carry record");
      });

      await step("A5: editing a day never writes plan_days (no lock-reload traffic)", async () => {
        const locks = db.t("plan_days").filter((r) => r.plan_date === H);
        assert.equal(locks.length, 1, "only the explicit lock above wrote plan_days");
        assert.equal(db.t("plan_days").length, 1);
      });
      assert.deepEqual(a.errors, [], "no console errors");
      await a.close();
    }

    /* ================= Part C: forecast mode, holds (D3) ================= */
    {
      const db = new h.FakeDb();
      h.seedBase(db, { src: SRC });
      const a = await env.openAs(db, h.USERS.a);
      const pa = a.page;
      await gotoDate(pa, F);

      await step("C1: a date beyond the horizon opens in Forecast mode — no export, no PDF, no lock", async () => {
        assert.equal((await pa.textContent("#mode-pill")).trim(), "FORECAST");
        assert.ok(await pa.evaluate(() => document.body.classList.contains("forecast-mode")));
        for (const sel of ["#btn-export", "#btn-print", "#btn-lock"]) assert.equal(await pa.isVisible(sel), false, sel + " hidden");
        assert.equal((await pa.textContent("#btn-reset-board")).trim(), "Start from confirmed");
      });

      await step("C1b: Start from confirmed writes only forecast rows — nothing confirmed, no Host Record", async () => {
        await pa.click("#btn-reset-board");
        await until(async () => (await pa.locator("#missions-grid .mission-card").count()) === 3, "3 forecast missions");
        assert.equal(db.t("forecast_missions").filter((m) => m.plan_date === F).length, 3);
        assert.equal(db.t("missions").filter((m) => m.plan_date === F).length, 0, "no confirmed missions");
        assert.equal(db.t("assignments").filter((m) => m.plan_date === F).length, 0, "no confirmed assignments");
        assert.equal(db.t("deployment_history").filter((m) => m.plan_date === F).length, 0, "no deployment history");
        assert.ok(db.t("forecast_assignments").filter((r) => r.plan_date === F).every((r) => r.held_by === "eng.a@example.com"));
        const refused = await pa.evaluate(async () => { await exportBoard(); return document.querySelector("#toast-stack").textContent; });
        assert.match(refused, /never exported/);
      });

      await step("C1c: the forecast never shows on Overview or Org Chart", async () => {
        await pa.evaluate(() => { D().activeBoardId = "__orgchart__"; return refreshAndRender(); });
        const crew = await pa.textContent("#stats-bar");
        assert.match(crew, /Missions: 0/);
        await gotoBoard(pa, "b1");
      });

      const b = await env.openAs(db, h.USERS.b);
      const pb = b.page;
      await gotoDate(pb, F);

      await step("C2: B placing a person A holds must confirm, and records the loss", async () => {
        await until(async () => (await pb.locator("#missions-grid .mission-card").count()) === 3, "B sees A's forecast live");
        await pb.click('#missions-grid .emp-card[data-emp-id="e1"]');
        await missionCard(pb, "102").locator(".mission-body").evaluate((el) => el.click());
        await until(() => pb.isVisible("#modal-confirm"), "hold confirmation");
        assert.match(await pb.textContent("#confirm-message"), /Person A — held by eng\.a@example\.com in mission 101/);
        await pb.click("#btn-confirm-yes");
        await until(() => db.t("forecast_hold_events").length === 1, "event recorded");
        const ev = db.t("forecast_hold_events")[0];
        assert.equal(ev.from_held_by, "eng.a@example.com");
        assert.equal(ev.taken_by, "eng.b@example.com");
        assert.equal(placeOf(db, "forecast_assignments", "e1", F), "102");
      });

      await step("C2b / D3 toast: only A gets the live toast; A's mission shows the red flag and the board-bar counter", async () => {
        await until(async () => /eng\.b moved Person A from your mission 101/.test(await pa.textContent("#toast-stack")), "toast for A");
        assert.doesNotMatch(await pb.textContent("#toast-stack"), /from your mission/, "no toast for B");
        await until(async () => (await missionCard(pa, "101").locator(".hold-badge").count()) === 1, "badge on A's mission");
        assert.equal((await missionCard(pa, "101").locator(".hold-badge").textContent()).trim(), "1 person taken by eng.b");
        assert.match(await pa.textContent("#btn-hold-alerts"), /1 hold taken from you/);
        assert.equal(await pb.isVisible("#btn-hold-alerts"), false, "B lost nothing");
      });

      await step("C2c: moving your own hold records no event", async () => {
        await pb.click('#missions-grid .emp-card[data-emp-id="e1"]');
        await missionCard(pb, "103").locator(".mission-body").evaluate((el) => el.click());
        await until(() => placeOf(db, "forecast_assignments", "e1", F) === "103", "B moved own hold");
        assert.equal(await pb.isVisible("#modal-confirm"), false);
        assert.equal(db.t("forecast_hold_events").length, 1);
      });

      await step("C7 / D3: the flag survives a reload and clears only on Acknowledge, recording who", async () => {
        await pa.reload();
        await pa.waitForSelector("#board-tabs .board-tab");
        await gotoDate(pa, F);
        await until(async () => (await missionCard(pa, "101").locator(".hold-badge").count()) === 1, "badge after reload");
        await missionCard(pa, "101").locator(".hold-badge").click();
        await until(() => pa.isVisible("#modal-holds"), "details");
        assert.match(await pa.textContent("#holds-list"), /eng\.b moved Person A from your mission 101/);
        await pa.click("#holds-list >> text=Acknowledge");
        await until(() => !!db.t("forecast_hold_events")[0].acknowledged_at, "acknowledged");
        assert.equal(db.t("forecast_hold_events")[0].acknowledged_by, "eng.a@example.com");
        await pa.click("#modal-holds [data-close].btn");
        await until(async () => (await pa.locator(".hold-badge").count()) === 0, "badge cleared");
        assert.equal(await pa.isVisible("#btn-hold-alerts"), false);
      });

      await step("C: Copy forecast to the next working days skips days that already have one", async () => {
        const next = h.nextWorking(F);
        asUser(db, h.USERS.b)({ table: "forecast_missions", op: "insert", values: { board_id: "b1", plan_date: next, number: "900", host: "Host Beta", customer: "Cust Beta", shift: "day" } });
        await pa.click("#btn-forecast-copy");
        await pa.fill("#forecast-copy-n", "2");
        await pa.click("#btn-forecast-copy-confirm");
        const after = h.nextWorking(next);
        await until(() => db.t("forecast_missions").filter((m) => m.plan_date === after).length === 3, "copied onto the empty day");
        assert.equal(db.t("forecast_missions").filter((m) => m.plan_date === next).length, 1, "non-empty day untouched");
      });
      assert.deepEqual(a.errors, [], "no console errors (A)");
      assert.deepEqual(b.errors, [], "no console errors (B)");
      await a.close();
      await b.close();
    }

    /* ================= Part C: merge a forecast into the confirmed day ================= */
    {
      const db = new h.FakeDb();
      h.seedBase(db, { src: SRC });
      db.seed("forecast_missions", [
        { id: "f101", board_id: "b1", plan_date: H, number: "101", host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1", created_by: "eng.b@example.com" },
        { id: "f201", board_id: "b1", plan_date: H, number: "201", host: "Host Beta", customer: "Cust Beta", shift: "day", engineer_id: "eng-2", created_by: "eng.b@example.com" },
      ]);
      db.seed("forecast_assignments", [
        { employee_id: "e1", plan_date: H, forecast_mission_id: "f101", zone: null, held_by: "eng.b@example.com" },
        { employee_id: "e6", plan_date: H, forecast_mission_id: "f201", zone: null, held_by: "eng.b@example.com" },
        { employee_id: "e7", plan_date: H, forecast_mission_id: null, zone: "sick", held_by: "eng.b@example.com" },
      ]);
      const a = await env.openAs(db, h.USERS.a);
      const pa = a.page;
      await gotoDate(pa, H);

      await step("C4: a confirmed day with an unmerged forecast shows the merge banner", async () => {
        await until(async () => (await pa.locator(".plan-banner-forecast").count()) === 1, "forecast banner");
        assert.match(await pa.textContent(".plan-banner-forecast"), /Forecast for this day by eng\.b: 2 missions, 3 people/);
      });

      await step("C4b: Carry over into it offers Review & merge; applying writes confirmed rows + history only for applied items", async () => {
        await pa.click("#btn-reset-board");
        await until(() => pa.isVisible("#modal-plandiff"), "merge panel opens after the carry");
        assert.match(await pa.textContent("#plandiff-title"), /Review & merge forecast/);
        const ticked = await pa.$$eval("#plandiff-body .pd-item", (els) => els.filter((e) => e.querySelector("input").checked).map((e) => e.querySelector(".pd-text").textContent));
        assert.ok(ticked.some((t) => /^Add mission 201/.test(t) && /Person F/.test(t)), "add ticked by default");
        assert.ok(ticked.some((t) => /^Sick Leave for Person G/.test(t)), "set leave ticked by default");
        const unticked = await pa.$$eval("#plandiff-body .pd-item", (els) => els.filter((e) => !e.querySelector("input").checked).map((e) => e.querySelector(".pd-text").textContent));
        assert.ok(unticked.some((t) => /^Remove mission 102/.test(t)), "remove unticked by default");
        await pa.click("#btn-plandiff-apply");
        await until(async () => !(await pa.isVisible("#modal-plandiff")), "applied");
        assert.equal(placeOf(db, "assignments", "e6", H), "201");
        assert.equal(placeOf(db, "assignments", "e7", H), "zone:sick");
        assert.ok(db.t("missions").some((m) => m.plan_date === H && m.number === "102"), "unticked removal not applied");
        const hist = db.t("deployment_history").filter((r) => r.plan_date === H).map((r) => r.employee_id).sort();
        assert.ok(hist.includes("e6"), "history for the applied placement");
        assert.ok(!hist.includes("e7"), "no history for leave");
        const stamp = db.t("plan_day_stamps").find((s) => s.plan_date === H);
        assert.ok(stamp.forecast_merged_at, "merge stamped");
        await until(async () => (await pa.locator(".plan-banner-merged").count()) === 1, "merged note replaces the banner");
        assert.equal(db.t("forecast_missions").filter((m) => m.plan_date === H).length, 2, "D6: forecast kept");
      });
      assert.deepEqual(a.errors, [], "no console errors");
      await a.close();
    }

    /* ================= Part B: Capacity ================= */
    {
      const db = new h.FakeDb();
      h.seedBase(db, { src: SRC });
      const a = await env.openAs(db, h.USERS.a);
      const b = await env.openAs(db, h.USERS.b);
      const v = await env.openAs(db, h.USERS.v);
      for (const p of [a.page, b.page, v.page]) await p.click("#board-tabs .tab-capacity");
      const pa = a.page, pb = b.page;
      const cell = (p, date) => p.locator(`input[data-cap-key^="b1\u0001${date}\u0001Host Alpha\u0001day"]`);
      const gapChip = async (p, date) => ((await p.textContent(`.cap-gapchip[data-date="${date}"]`)) || "").trim();

      await step("B0: the board to plan is picked in the toolbar, one board at a time", async () => {
        assert.ok(await pa.isVisible("#capacity-toolbar #cap-board-switch"));
        const btns = await pa.$$eval("#cap-board-switch .cap-board-btn", (els) => els.map((e) => [e.textContent.trim(), e.getAttribute("aria-pressed")]));
        assert.deepEqual(btns, [["Board One· 8", "true"], ["Board Two· 2", "false"]]);
        assert.match(await pa.textContent(".cap-card-title"), /Board One/);
      });

      await step("B1: enter demand for two hosts; the gap chip turns red and updates live, including for a second user", async () => {
        await pa.fill("#cap-add input", "Host Alpha");
        await pa.click("#cap-add button");
        await cell(pa, H).fill("12");
        await cell(pa, H).press("Enter");
        await until(() => db.t("capacity_demand").some((r) => r.plan_date === H && r.headcount === 12), "saved");
        await pa.fill("#cap-add input", "Host Beta");
        await pa.selectOption("#cap-add select", "night");
        await pa.click("#cap-add button");
        const beta = pa.locator(`input[data-cap-key^="b1\u0001${H}\u0001Host Beta\u0001night"]`);
        await beta.fill("3");
        await beta.press("Tab");
        await until(() => db.t("capacity_demand").length === 2, "second host saved");
        // 8 on the roster, nobody on leave on H yet: 8 - 15 = -7
        await until(async () => (await gapChip(pa, H)) === "▼ −7", "gap for A");
        await until(async () => (await gapChip(pb, H)) === "▼ −7", "gap for B, via Realtime");
        assert.ok(await pa.$eval(`.cap-gapchip[data-date="${H}"]`, (el) => el.classList.contains("short")), "short day is flagged");
        assert.equal(await pa.locator(".cap-col .cap-bar-over").count(), 1, "uncovered demand drawn in red on the chart");
        assert.match(await pa.textContent("#stats-bar"), /Short days: 1/);
        assert.match(await pa.textContent("#stats-bar"), /Biggest gap: −7/);
        assert.equal(await gapChip(pa, F), "▲ +8", "a day with no demand shows its spare people");
      });

      await step("B1c: a host that is not on the Host list is refused", async () => {
        await pa.fill("#cap-add input", "Nowhere Site");
        await pa.click("#cap-add button");
        await until(async () => /not in the Host list/.test(await pa.textContent("#toast-stack")), "refusal toast");
        assert.equal(await pa.locator('input[data-cap-key*="Nowhere Site"]').count(), 0, "no row added");
      });

      await step("B1b: Fill right to end of week writes the following working days only", async () => {
        await cell(pa, H).click({ button: "right" });
        await pa.click("#context-menu >> text=Fill right to end of week");
        const expected = [];
        for (let d = h.addDays(H, 1); new Date(d + "T00:00:00").getDay() !== 1; d = h.addDays(d, 1)) if (!h.isWeekend(d)) expected.push(d);
        await until(() => expected.every((d) => db.t("capacity_demand").some((r) => r.plan_date === d && r.host === "Host Alpha" && r.headcount === 12)), "filled right");
        assert.ok(!db.t("capacity_demand").some((r) => h.isWeekend(r.plan_date)), "never onto a weekend");
      });

      await step("B2: putting someone on confirmed annual leave that date reduces Available by 1", async () => {
        asUser(db, h.USERS.b)({ table: "assignments", op: "insert", values: { employee_id: "e8", plan_date: H, mission_id: null, zone: "annual" } });
        await until(async () => (await gapChip(pa, H)) === "▼ −8", "gap after leave");
      });

      await step("B3: switching board shows only that board's demand and people", async () => {
        await pa.click("#cap-board-switch .cap-board-btn:nth-child(2)");
        await until(async () => /Board Two/.test(await pa.textContent(".cap-card-title")), "board two");
        assert.equal(await pa.locator(".cap-cell input").count(), 0, "Board One's host rows are not shown");
        assert.equal(await gapChip(pa, H), "▲ +2", "Board Two's own roster of 2");
        await pa.click("#cap-board-switch .cap-board-btn:nth-child(1)");
        await until(async () => /Board One/.test(await pa.textContent(".cap-card-title")), "back to board one");
      });

      await step("B4: a viewer sees the grid read-only", async () => {
        await until(async () => (await v.page.locator(".cap-hostrow .cap-cell").count()) > 0, "viewer grid");
        assert.equal(await v.page.locator(".cap-grid2 input").count(), 0, "no inputs");
        assert.equal(await v.page.locator("#cap-add").count(), 0, "no add-row form");
        assert.equal(await v.page.isVisible("#btn-cap-copy-week"), false);
      });

      await step("B5 / layout: the wide grid scrolls in its own container, not the page", async () => {
        await pa.selectOption("#cap-range", "8");
        await until(async () => (await pa.locator(".cap-dayhead .cap-day").count()) > 30, "8 weeks of columns");
        const m = await pa.evaluate(() => {
          const s = document.querySelector(".cap-scroll");
          return { scrollW: s.scrollWidth, clientW: s.clientWidth, docW: document.documentElement.scrollWidth, winW: document.documentElement.clientWidth };
        });
        assert.ok(m.scrollW > m.clientW, "grid overflows its container");
        assert.ok(m.docW <= m.winW, "page itself has no horizontal scroll");
      });
      for (const p of [a, b, v]) assert.deepEqual(p.errors, [], "no console errors");
      await a.close(); await b.close(); await v.close();
    }

    /* ================= Part B: chips + start from the confirmed plan ================= */
    {
      const db = new h.FakeDb();
      h.seedBase(db, { src: SRC });
      // someone already typed Host Alpha for tomorrow: must survive the seeding
      db.seed("capacity_demand", [{ board_id: "b1", plan_date: H, host: "Host Alpha", shift: "day", headcount: 9 }]);
      const a = await env.openAs(db, h.USERS.a);
      const pa = a.page;
      await pa.click("#board-tabs .tab-capacity");
      await pa.waitForSelector(".cap-gapchip");

      await step("B6: every day carries a CONFIRMED or FORECAST chip", async () => {
        const chips = await pa.$$eval(".cap-dayhead .cap-day", (els) => els.map((e) => e.querySelector(".cap-mode").textContent));
        const dates = await pa.$$eval(".cap-gapchip", (els) => els.map((e) => e.dataset.date));
        dates.forEach((d, i) => assert.equal(chips[i], d <= H ? "CONFIRMED" : "FORECAST", d));
        assert.ok(chips.includes("FORECAST") && chips.includes("CONFIRMED"));
      });

      await step("B7: Start from confirmed plan fills empty cells from the latest confirmed day, keeping typed numbers", async () => {
        await pa.click("#btn-cap-seed");
        await until(() => pa.isVisible("#modal-confirm"), "confirmation");
        const msg = await pa.textContent("#confirm-message");
        assert.match(msg, /Host Alpha: 2, Host Beta: 1, Host Gamma \(night\): 1/);
        await pa.click("#btn-confirm-yes");
        const days = (await pa.$$eval(".cap-gapchip", (els) => els.length));
        await until(() => db.t("capacity_demand").length === days * 3, "every host x day filled");
        const at = (d, host, shift) => (db.t("capacity_demand").find((r) => r.plan_date === d && r.host === host && r.shift === shift) || {}).headcount;
        assert.equal(at(H, "Host Alpha", "day"), 9, "a number someone typed is kept");
        assert.equal(at(F, "Host Alpha", "day"), 2);
        assert.equal(at(F, "Host Gamma", "night"), 1);
        await until(async () => (await pa.locator(".cap-hostrow .cap-cell input").count()) === days * 3, "three host rows on screen");
      });

      await step("B8: Named on board explains itself", async () => {
        const tip = await pa.getAttribute(".cap-namedrow .cap-left", "title");
        assert.match(tip, /already put on a mission/);
      });

      // rows: 0 Host Alpha day, 1 Host Beta day, 2 Host Gamma night
      const dates = await pa.$$eval(".cap-gapchip", (els) => els.map((e) => e.dataset.date));
      const at = (d, host, shift) => (db.t("capacity_demand").find((r) => r.plan_date === d && r.host === host && r.shift === shift) || {}).headcount;
      const cellAt = (i, j) => pa.locator(`.cap-cell[data-r="${i}"][data-c="${j}"]`);
      // a save redraws the grid, so a cell can be swapped out between lookups: retry
      const centre = async (i, j) => {
        let b = null;
        await until(async () => (b = await cellAt(i, j).boundingBox().catch(() => null)) != null, "cell on screen");
        return [b.x + b.width / 2, b.y + b.height / 2];
      };
      const dispatchClip = (type, text) => pa.evaluate(([type, text]) => {
        const dt = new DataTransfer();
        if (text != null) dt.setData("text/plain", text);
        const ev = new ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true });
        document.activeElement.dispatchEvent(ev);
        return { data: dt.getData("text/plain"), handled: ev.defaultPrevented };
      }, [type, text]);

      await step("B9: drag across cells selects a block; Ctrl+C copies it as tab-separated text", async () => {
        await cellAt(0, 0).locator("input").fill("5");
        await cellAt(0, 0).locator("input").press("Tab");
        await until(() => at(dates[0], "Host Alpha", "day") === 5, "typed value saved");
        const [x0, y0] = await centre(0, 0), [x1, y1] = await centre(1, 1);
        await pa.mouse.move(x0, y0);
        await pa.mouse.down();
        await pa.mouse.move(x1, y1, { steps: 6 });
        await pa.mouse.up();
        assert.equal(await pa.locator(".cap-cell.cap-sel").count(), 4, "2 x 2 block selected");
        assert.equal(await pa.evaluate(() => document.activeElement.id), "cap-clip", "keyboard sits on the clipboard proxy");
        const c = await dispatchClip("copy");
        assert.ok(c.handled);
        const exp = [[at(dates[0], "Host Alpha", "day"), at(dates[1], "Host Alpha", "day")], [at(dates[0], "Host Beta", "day"), at(dates[1], "Host Beta", "day")]];
        assert.equal(c.data, exp.map((r) => r.join("\t")).join("\n"));
        assert.equal(c.data.split("\n")[0].split("\t")[0], "5");
      });

      await step("B10: Ctrl+V pastes the block with its top-left at the clicked cell, on later days", async () => {
        const text = (await dispatchClip("copy")).data;
        await cellAt(0, 3).locator("input").click();
        const p = await dispatchClip("paste", text);
        assert.ok(p.handled);
        await until(() => at(dates[3], "Host Alpha", "day") === 5, "pasted top-left");
        assert.equal(at(dates[4], "Host Alpha", "day"), at(dates[1], "Host Alpha", "day"));
        assert.equal(at(dates[3], "Host Beta", "day"), at(dates[0], "Host Beta", "day"));
        assert.equal(at(dates[4], "Host Beta", "day"), at(dates[1], "Host Beta", "day"));
        assert.equal(at(dates[5], "Host Alpha", "day"), 2, "nothing written outside the block");
        await until(async () => (await pa.locator(".cap-cell.cap-sel").count()) === 4, "the pasted block is selected");
        assert.equal(await cellAt(0, 3).locator("input").inputValue(), "5");
      });

      await step("B10b: pasting from Excel works too; a single number fills the whole selection; text is refused", async () => {
        const last = dates.length - 1;
        await cellAt(2, last).locator("input").click();
        await dispatchClip("paste", "7\t8\r\n9\t10\r\n");        // Excel's line endings; 2 x 2 at the bottom-right corner
        await until(() => at(dates[last], "Host Gamma", "night") === 7, "corner pasted");
        await until(async () => /1 did not fit|3 did not fit/.test(await pa.textContent("#toast-stack")), "overflow reported");
        // shift+click extends the selection: rows 0-1, days 6-7
        await cellAt(0, 6).locator("input").click();
        await cellAt(1, 7).click({ modifiers: ["Shift"] });
        assert.equal(await pa.locator(".cap-cell.cap-sel").count(), 4);
        await dispatchClip("paste", "4");
        await until(() => [at(dates[6], "Host Alpha", "day"), at(dates[7], "Host Alpha", "day"), at(dates[6], "Host Beta", "day"), at(dates[7], "Host Beta", "day")].every((v) => v === 4), "filled with 4");
        const before = JSON.stringify(db.t("capacity_demand"));
        await dispatchClip("paste", "Host Alpha\t3");
        await until(async () => /Only whole numbers/.test(await pa.textContent("#toast-stack")), "refused");
        assert.equal(JSON.stringify(db.t("capacity_demand")), before, "nothing written");
      });

      await step("B10c: Delete clears the selected block", async () => {
        await pa.keyboard.press("Delete");
        await until(() => [dates[6], dates[7]].every((d) => at(d, "Host Alpha", "day") === undefined && at(d, "Host Beta", "day") === undefined), "cleared");
        assert.equal(at(dates[6], "Host Gamma", "night"), 1, "row outside the selection kept");
        await pa.keyboard.press("Escape");
        assert.equal(await pa.locator(".cap-cell.cap-sel").count(), 0, "Escape drops the selection");
      });

      await step("B11: a row can be deleted: its numbers go from today on, after a confirmation", async () => {
        const past = h.addDays(dates[0], -1);
        db.seed("capacity_demand", [{ board_id: "b1", plan_date: past, host: "Host Gamma", shift: "night", headcount: 4 }]);
        await pa.click('.cap-row-del[aria-label="Remove the Host Gamma night row"]');
        await until(() => pa.isVisible("#modal-confirm"), "confirmation");
        assert.match(await pa.textContent("#confirm-message"), /Past days are kept/);
        await pa.click("#btn-confirm-yes");
        await until(() => !db.t("capacity_demand").some((r) => r.host === "Host Gamma" && r.plan_date >= dates[0]), "row's numbers deleted");
        assert.equal(at(past, "Host Gamma", "night"), 4, "history kept");
        await until(async () => (await pa.locator('.cap-hostname:text-is("Host Gamma")').count()) === 0, "row gone from the grid");
        // a row that was only added (no numbers yet) goes without a question
        await pa.fill("#cap-add input", "Host Gamma");
        await pa.click("#cap-add button");
        await until(async () => (await pa.locator('.cap-hostname:text-is("Host Gamma")').count()) === 1, "re-added");
        await pa.click('.cap-row-del[aria-label="Remove the Host Gamma day row"]');
        await until(async () => (await pa.locator('.cap-hostname:text-is("Host Gamma")').count()) === 0, "empty row removed");
        assert.equal(await pa.isVisible("#modal-confirm"), false);
      });
      assert.deepEqual(a.errors, [], "no console errors");
      await a.close();
    }

    /* ================= Missing-migration tolerance ================= */
    {
      const db = new h.FakeDb({ forwardPlanning: false });
      h.seedBase(db, { src: SRC });
      const a = await env.openAs(db, h.USERS.a);
      await step("no migration: the app works as before, the new features stay hidden", async () => {
        const tabs = await a.page.$$eval("#board-tabs .board-tab", (els) => els.map((e) => e.textContent.trim()));
        assert.ok(!tabs.includes("Capacity"));
        assert.equal(await a.page.isVisible("#mode-pill"), false);
        await gotoDate(a.page, F);
        assert.equal(await a.page.evaluate(() => isForecastView()), false, "no forecast mode without the tables");
        await gotoDate(a.page, H);
        await a.page.click("#btn-reset-board");
        await until(async () => (await a.page.locator("#missions-grid .mission-card").count()) === 3, "carry over still works");
        assert.deepEqual(a.errors, []);
      });
      await a.close();
    }
  } finally {
    await env.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL END-TO-END CHECKS PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e && e.message ? "" : e); process.exit(1); });
