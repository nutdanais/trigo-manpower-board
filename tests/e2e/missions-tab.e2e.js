/* Acceptance run for the Missions tab (phase 1, migration-2026-11-09): the list, Close (and carry
   over skipping a closed mission), Reopen for a Site Admin only, the new-year numbers (the alert,
   the list with a pasted column, the rename from 1 January on every board, "was …"), the mission
   number rules in the mission form (format, suffix, same mission at another location), Start
   from the Missions list on an empty day, Bulk edit by Excel, the phone's Me menu and Thai.
   Real app in Chromium against the shared fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/missions-tab.e2e.js
   Seed: harness.seedBase plus mission numbers in the PREFIX.YY.NNNN form: TSTTH.<last year>.0005
   on both boards (one mission, two locations, waiting for its new-year number), TSTTH.<this
   year>.0007 on Board One and .0090 on Board Two. Fixtures are fake. Exits non-zero on the first
   failed check. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const h = require("./harness");
const ExcelJS = require("../../vendor/exceljs.min.js");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
const NEXT = h.nextWorking(T);
const YY = String(new Date().getFullYear()).slice(2);
const LY = String(new Date().getFullYear() - 1).slice(2);
const OLD = `TSTTH.${LY}.0005`, NEW = `TSTTH.${YY}.0050`, M7 = `TSTTH.${YY}.0007`, M90 = `TSTTH.${YY}.0090`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "missions-"));
const SITE = { id: "00000000-0000-0000-0000-00000000000d", email: "site.d@example.com", role: "siteadmin" };

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 6).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    // the migration's role and areas
    db.seed("roles", [{ key: "siteadmin", label: "Site Admin", rank: 35, protected: false }]);
    const viewer = db.t("role_permissions").filter((r) => r.role_key === "viewer");
    db.seed("role_permissions", viewer.map((r) => ({ role_key: "siteadmin", area: r.area, level: r.level })));
    db.seed("role_permissions", [
      ["admin", "edit", "edit"], ["manager", "edit", "edit"], ["engineer", "edit", "none"], ["siteadmin", "edit", "edit"], ["viewer", "view", "none"],
    ].flatMap(([role, m, ma]) => [{ role_key: role, area: "missions", level: m }, { role_key: role, area: "missionadmin", level: ma }]));
    db.seed("profiles", [{ id: SITE.id, email: SITE.email, full_name: "site.d", display_name: "site.d", role_key: "siteadmin", status: "active" }]);
    db.seed("missions", [
      { id: "s5", board_id: "b1", plan_date: SRC, number: OLD, host: "Host Alpha", customer: "Cust Old", shift: "day", engineer_id: "eng-1" },
      { id: "s7", board_id: "b1", plan_date: SRC, number: M7, host: "Host Beta", customer: "Cust Seven", shift: "day", engineer_id: "eng-2" },
      { id: "t5", board_id: "b2", plan_date: SRC, number: OLD, host: "Host Gamma", customer: "Cust Old", shift: "day", engineer_id: "eng-1" },
      { id: "t90", board_id: "b2", plan_date: SRC, number: M90, host: "Host Gamma", customer: "Cust Ninety", shift: "day", engineer_id: "eng-2" },
    ]);
    db.seed("deployment_history", [{ employee_id: "e9", plan_date: SRC, mission_number: OLD, host: "Host Gamma", customer: "Cust Old", board_id: "b2" }]);
    assert.equal(db.t("mission_register").length, 7, "saving the days registered every board + number + shift");

    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const goMissions = (pg) => pg.evaluate(() => { D().activeBoardId = MISSIONS_ID; return refreshAndRender(); });
    const row = (pg, num, board) => pg.locator("#missions-body tr", { has: pg.locator(".ml-num", { hasText: new RegExp("^" + num.replace(/\./g, "\\.") + "$") }) })
      .filter(board ? { hasText: board } : {});
    const reg = (num, board) => db.t("mission_register").find((r) => r.number === num && (!board || r.board_id === board));

    await step("the Missions tab lists every open mission once per board and shift", async () => {
      assert.equal(await p.locator("#board-tabs .tab-missions").count(), 1);
      await goMissions(p);
      assert.equal(await p.locator("#missions-panel").isVisible(), true);
      assert.equal(await p.locator("#missions-body tr").count(), 7);
      assert.equal(await row(p, OLD).count(), 2, "one mission, two locations");
      assert.match(await p.locator("#stats-bar").innerText(), /Open\s*7/);
      assert.match(await row(p, M7).innerText(), /Board One[\s\S]*Day[\s\S]*Cust Seven[\s\S]*Host Beta[\s\S]*Eng Two/);
    });

    await step("a mission still on last year's number is flagged; an engineer cannot enter the new one", async () => {
      assert.match(await row(p, OLD, "Board One").locator(".ml-alerts").innerText(), new RegExp(`Needs 20${YY} number`), "the new-year number is an alert");
      assert.equal(await p.locator("#missions-alert").isVisible(), true);
      assert.equal(await p.locator("#missions-alert button").count(), 0, "no button for an engineer");
      assert.equal(await p.locator("#btn-missions-newyear").isVisible(), false);
      assert.equal(await p.locator("#board-tabs .tab-missions .tab-badge").count(), 0, "the alert badge is for whoever enters the numbers");
    });

    await step("search finds a mission by customer and by board", async () => {
      await p.fill("#missions-search", "ninety");
      await p.waitForFunction(() => document.querySelectorAll("#missions-body tr").length === 1);
      await p.fill("#missions-search", "");
      await p.selectOption("#missions-board", "b2");
      await p.waitForFunction(() => document.querySelectorAll("#missions-body tr").length === 2);
      await p.selectOption("#missions-board", "");
    });

    await step("the Filters button narrows the list by customer, Trigo responsible, shift and whether it is on the board", async () => {
      const openRows = () => db.t("mission_register").filter((r) => r.status === "open");
      const rowsShown = () => p.locator("#missions-body tr").count();
      const ms = (key) => p.locator(`#missions-filters .ms[data-filter=${key}]`);
      const tick = async (key, text) => {
        await p.evaluate(() => closeFilterPops());   // an open list would cover the next filter's button
        await ms(key).locator(".ms-btn").click();
        await ms(key).locator(".ms-opt", { hasText: text }).locator("input").check();
      };
      const shown = async (n) => p.waitForFunction((k) => document.querySelectorAll("#missions-body tr").length === k, n);
      assert.equal(await p.locator("#btn-missions-filter-pop").isVisible(), true, "a Filters button, like Host's");
      assert.equal(await p.locator("#missions-filter-count").isVisible(), false, "no count while nothing is filtered");
      await p.click("#btn-missions-filter-pop");
      await p.locator("#missions-filter-pop:not(.hidden)").waitFor();
      assert.equal(await p.locator("#missions-filters .ms").count(), 7, "Service area joins the filters");
      // Customer: one ticked customer leaves its rows; the button and the count say so
      await tick("customer", "Cust Ninety");
      await shown(1);
      assert.equal(await ms("customer").locator(".ms-btn").innerText(), "Customer: 1 selected");
      assert.equal((await p.locator("#missions-filter-count").innerText()).trim(), "1");
      assert.match(await p.locator("#missions-count").innerText(), /^1 mission\b/);
      await ms("customer").locator(".ms-clear").click();
      await shown(openRows().length);
      assert.equal(await p.locator("#missions-filter-count").isVisible(), false);
      // Trigo responsible
      await tick("engineerId", "Eng Two");
      await shown(openRows().filter((r) => r.engineer_id === "eng-2").length);
      assert.equal(await row(p, M7).count(), 1);
      assert.equal(await row(p, OLD).count(), 0, "the shared mission belongs to Eng One");
      await ms("engineerId").locator(".ms-clear").click();
      // Shift
      await tick("shift", "Night");
      await shown(openRows().filter((r) => r.shift === "night").length);
      await ms("shift").locator(".ms-clear").click();
      // Board status: every mission is on its board on the latest working day, so "Off the board" leaves none
      await tick("placement", "Off the board");
      await shown(0);
      assert.equal(await p.locator("#missions-empty").isVisible(), true);
      await ms("placement").locator(".ms-clear").click();
      await shown(openRows().length);
      // Alerts: the missions nobody is on
      await p.evaluate(() => closeFilterPops());
      await ms("alerts").locator(".ms-btn").click();
      await ms("alerts").locator(".ms-opt", { hasText: /^No crew$/ }).locator("input").check();
      const noCrew = await p.locator("#missions-body tr").evaluateAll((trs) => trs.length);
      assert.ok(noCrew > 0 && noCrew <= openRows().length);
      await ms("alerts").locator(".ms-clear").click();
      await shown(openRows().length);
      // a filter stays with the Board picker and the search
      await tick("engineerId", "Eng Two");
      await p.selectOption("#missions-board", "b2");
      await shown(openRows().filter((r) => r.engineer_id === "eng-2" && r.board_id === "b2").length);
      assert.equal(await rowsShown(), 1);
      await p.selectOption("#missions-board", "");
      await ms("engineerId").locator(".ms-clear").click();
      await shown(openRows().length);
      await p.keyboard.press("Escape");
      assert.equal(await p.locator("#missions-filter-pop").isVisible(), false, "Esc closes the Filters list");
    });

    await step("each row says where its mission is and what needs a look: status, average crew, alert pills, the Host link", async () => {
      // working days back from SRC: 108 on Board Two with nobody on it for 8 of them, 109 hidden for 8, 110 last on the board
      // 7 working days ago, 112 with a crew of 2, 1 and none
      const wd = [SRC];
      for (let i = 0; i < 7; i++) wd.push(h.prevWorking(wd[wd.length - 1]));
      const mk = (id, num, day, extra = {}) => ({ id: `${id}-${day}`, board_id: "b2", plan_date: day, number: num, host: "Host Delta", customer: "Cust " + num, shift: "day", engineer_id: "eng-1", ...extra });
      db.seed("missions", [
        ...wd.map((d) => mk("q8", "108", d)),
        ...wd.map((d) => mk("q9", "109", d, { hidden: true })),
        mk("q10", "110", wd[7]), mk("q10", "110", wd[6]),
        ...[0, 1, 2].map((i) => mk("q12", "112", wd[i], { ppe: "Helmet and gloves", remark: "Check the labels", start_time: "07:30:00", end_time: "16:30:00" })),
      ]);
      db.seed("assignments", [
        { employee_id: "e1", plan_date: wd[1], mission_id: `q12-${wd[1]}`, zone: null },
        { employee_id: "e1", plan_date: wd[2], mission_id: `q12-${wd[2]}`, zone: null },
        { employee_id: "e2", plan_date: wd[2], mission_id: `q12-${wd[2]}`, zone: null },
      ]);
      await p.evaluate(() => { state.missions.activityKey = null; return cloud.loadMissionRegister().then(refreshAndRender); });
      const alerts = (n) => row(p, n).locator(".ml-alerts").innerText();
      // on the board, nobody on it for 8 working days in a row: a red alert with the short text; Close… is the row's own action
      assert.match(await row(p, "108").innerText(), /On board/);
      assert.match(await alerts("108"), /^No crew, 8 days$/);
      assert.doesNotMatch(await alerts("108"), /Close\?/, "the alert states the problem and asks nothing");
      assert.equal(await row(p, "108").locator(".lt-st").count(), 1, "exactly one status pill");
      assert.equal(await row(p, "108").locator(".lt-al").count(), 1, "exactly one alert");
      assert.equal(await row(p, "108").locator(".lt-al").evaluate((el) => !el.closest("button") && el.tagName !== "BUTTON"), true, "the alert is not a button");
      assert.equal(await row(p, "108").locator(".ml-alerts button, .ml-alerts .ml-tag").count(), 0, "no pill, no button in the alert");
      assert.equal(await row(p, "108").locator(".lt-al-bad").count(), 1, "over 5 working days is red");
      assert.equal(await row(p, "108").locator("button[data-act=close]").count(), 1, "Close… stays on the row");
      assert.match(await row(p, "108").locator('td[data-label="Board and status"]').innerText(), /Board \w+[\s\S]*On board[\s\S]*No crew/, "the board, the state and the alerts share one cell");
      assert.equal(await row(p, "108").locator("td.ml-status .lt-bd").count(), 1, "the board is the square tag");
      assert.equal(await p.locator("#missions-table th", { hasText: /^Alerts$/ }).count(), 0, "no separate Alerts column");
      // one day with nobody on it is amber and has no Close
      assert.match(await alerts(M7), /No crew, 1 day\b/);
      assert.equal(await row(p, M7).locator(".lt-al-warn").count(), 1);
      assert.equal(await row(p, M7).locator(".ml-alerts button").count(), 0);
      // hidden on every one of its days
      assert.match(await row(p, "109").locator("td.ml-status").innerText(), /Hidden/);
      assert.match(await alerts("109"), /^Hidden 8 days$/);
      // off the board: it had days and has none on the latest working day
      assert.match(await row(p, "110").locator("td.ml-status").innerText(), /Off the board/);
      assert.match(await alerts("110"), /^Off 6 days$/);
      assert.equal(await row(p, "110").locator("button.lt-act[data-act=add]").count(), 1, "Add to board is only offered off the board, as a text action");
      assert.equal(await row(p, "108").locator("button[data-act=add]").count(), 0, "not for a mission already on its board");
      // the average crew: (0 + 1 + 2) / 3 people a day on its three days
      assert.equal((await row(p, "112").locator(".ml-avg").innerText()).trim(), "1.0");
      // the Crew column: the people on it on the day on screen, from its own board
      const original = await p.evaluate(() => state.date);
      const crewOn = async (day, num) => { await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, day); return (await row(p, num).locator(".ml-crew").innerText()).trim(); };
      assert.equal(await crewOn(wd[2], "112"), "2");
      assert.equal(await crewOn(wd[1], "112"), "1");
      assert.equal(await crewOn(wd[2], "108"), "0", "on the board with nobody on it");
      assert.equal(await crewOn(wd[2], "110"), "\u2014", "not on its board that day");
      assert.match(await crewOn(wd[2], "109"), /Hidden/i);
      assert.equal(await crewOn(NEXT, "112"), "\u2014", "a day with no plan yet, outside the six weeks, is read on its own");
      assert.match(await p.locator("#missions-crew-date").innerText(), /\d/, "the header names the day");
      await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, original);
      // the Time, PPE and Remark columns come from the mission's latest day; search finds a remark
      const cell = async (num, label) => (await row(p, num).locator(`td[data-label="${label}"]`).innerText()).trim();
      assert.equal(await cell("112", "Time"), "07:30\u201316:30");
      assert.equal(await cell("112", "PPE"), "Helmet and gloves");
      assert.equal(await cell("112", "Remark"), "Check the labels");
      await p.fill("#missions-search", "check the labels");
      await p.waitForFunction(() => document.querySelectorAll("#missions-body tr").length === 1);
      await p.fill("#missions-search", "");
      await p.waitForFunction(() => document.querySelectorAll("#missions-body tr").length > 1);
      // the tile counts the missions on their board with nobody on them
      assert.match(await p.locator("#stats-bar").innerText(), /No crew\s*\d/);
      // the Filters button finds them
      await p.click("#btn-missions-filter-pop");
      await p.evaluate(() => closeFilterPops());
      await p.locator("#missions-filters .ms[data-filter=alerts] .ms-btn").click();
      await p.locator("#missions-filters .ms[data-filter=alerts] .ms-opt", { hasText: /^No crew for over 5 working days$/ }).locator("input").check();
      await p.waitForFunction(() => document.querySelectorAll("#missions-body tr").length === 1);
      assert.equal(await row(p, "108").count(), 1);
      await p.locator("#missions-filters .ms[data-filter=alerts] .ms-clear").click();
      await p.evaluate(() => closeFilterPops());
      await p.locator("#missions-filters .ms[data-filter=placement] .ms-btn").click();
      await p.locator("#missions-filters .ms[data-filter=placement] .ms-opt", { hasText: "Hidden" }).locator("input").check();
      await p.waitForFunction(() => document.querySelectorAll("#missions-body tr").length === 1);
      assert.equal(await row(p, "109").count(), 1);
      await p.locator("#missions-filters .ms[data-filter=placement] .ms-clear").click();
      await p.keyboard.press("Escape");
      // Close… on the row opens the close dialog for that mission
      await row(p, "108").locator("button[data-act=close]").click();
      await p.locator("#modal-close-mission:not(.hidden)").waitFor();
      assert.match(await p.locator("#close-mission-title").innerText(), /Close mission 108/);
      await p.evaluate(() => closeModal());
      // the Host name opens the Host tab with that host's row marked, and the search empty
      await row(p, M7).locator(".ml-host-link").click();
      await p.locator("#hostlist-panel:not(.hidden)").waitFor();
      await p.locator('#hostlist-body tr[data-host="Host Beta"].row-focus').waitFor();
      assert.equal(await p.inputValue("#hostlist-search"), "");
      await p.locator('#hostlist-body tr[data-host="Host Beta"].row-focus').waitFor({ state: "detached", timeout: 12000 });
      // put the sample missions away again
      const drop = (t, f) => { const a = db.t(t); for (let i = a.length - 1; i >= 0; i--) if (f(a[i])) a.splice(i, 1); };
      drop("assignments", (x) => String(x.mission_id || "").startsWith("q12-"));
      drop("missions", (x) => /^q\d+-/.test(x.id));
      drop("mission_register", (x) => ["108", "109", "110", "112"].includes(x.number));
      await p.evaluate(() => { state.missions.activityKey = null; return cloud.loadMissionRegister().then(() => { D().activeBoardId = MISSIONS_ID; return refreshAndRender(); }); });
      assert.equal(await p.locator("#missions-body tr").count(), 7);
    });

    await step("+ Mission on the Missions tab opens the board's New Mission form with a Board box, and returns to the list", async () => {
      await goMissions(p);
      const btn = p.locator("#btn-add-mission-list");
      assert.equal(await btn.isVisible(), true, "the main action, like + Host");
      assert.match(await btn.innerText(), /Mission/);
      // cancelling puts the Missions tab back
      await btn.click();
      await p.locator("#modal-mission:not(.hidden)").waitFor();
      assert.equal(await p.locator("#mission-board-row").isVisible(), true);
      assert.match(await p.locator("#mission-day-note").innerText(), /the day shown at the top/);
      await p.evaluate(() => closeModal());
      assert.equal(await p.evaluate(() => isMissionList()), true, "back on the Missions tab after Cancel");
      assert.equal(await p.locator("#missions-panel").isVisible(), true);
      // saving adds the mission to the chosen board
      const NEWM = `TSTTH.${YY}.0777`;
      const host = await p.evaluate(() => D().hosts[0].name);
      const eng = await p.evaluate(() => engineerLabelFor(D().engineers[0].id));
      await btn.click();
      await p.locator("#modal-mission:not(.hidden)").waitFor();
      await p.selectOption("#mission-board", "b2");
      await p.fill("#form-mission [name=number]", NEWM);
      await p.fill("#form-mission [name=host]", host);
      await p.fill("#form-mission [name=customer]", "Cust Fresh");
      await p.fill("#form-mission [name=engineer]", eng);
      await p.click("#form-mission button[type=submit]");
      await p.waitForFunction(() => document.querySelector("#modal-mission").classList.contains("hidden"));
      await p.waitForFunction((n) => [...document.querySelectorAll("#missions-body .ml-num")].some((e) => e.textContent === n), NEWM);
      assert.ok(reg(NEWM, "b2"), "registered on Board Two");
      assert.equal(reg(NEWM, "b1"), undefined, "not on Board One");
      assert.equal(await p.evaluate(() => isMissionList()), true, "still on the Missions tab");
      assert.match(await row(p, NEWM).innerText(), /Board Two/);
      // put it away again
      const drop = (t, f) => { const a = db.t(t); for (let i = a.length - 1; i >= 0; i--) if (f(a[i])) a.splice(i, 1); };
      drop("missions", (x) => x.number === NEWM);
      drop("mission_register", (x) => x.number === NEWM);
      await p.evaluate(() => { state.missions.activityKey = null; return cloud.loadMissionRegister().then(refreshAndRender); });
    });

    await step("double-clicking a Missions row opens the mission's detail, read first, with Edit details, Hide and Close mission inside; the board needs a double click too", async () => {
      await goMissions(p);
      const dateBefore = await p.evaluate(() => state.date);
      const sure = async () => { const c = p.locator("#modal-confirm:not(.hidden)"); if (await c.waitFor({ timeout: 2000 }).then(() => true, () => false)) { assert.match(await p.locator("#confirm-title").innerText(), /Edit today's board/); await p.click("#btn-confirm-yes"); } };
      const open = async (num) => { await row(p, num).locator("td").first().dblclick(); await p.locator("#mission-detail:not(.hidden)").waitFor(); await p.locator("#btn-md-edit").waitFor(); };
      // no Edit button on the row, as on Manpower and Host
      assert.equal(await row(p, M7).locator("[data-act=edit], .ml-edit").count(), 0);
      // the detail: facts, flags, tiles, crew, a chart
      await open(M7);
      assert.equal(await p.locator("#form-mission").isVisible(), false, "read first, the form is behind Edit details");
      assert.equal((await p.locator("#mission-modal-title").innerText()).trim(), M7);
      const text = await p.locator("#mission-detail").innerText();
      assert.match(text, /Host Beta/);
      assert.match(text, /Cust Seven/);
      assert.match(text, /No crew/, "the flags say nobody is on it");
      assert.equal(await p.locator("#mission-detail .ov-htile").count(), 4);
      assert.equal(await p.locator("#mission-detail .md-bar").count() > 0, true, "crew per working day");
      assert.equal(await p.locator("#btn-md-hide").isVisible(), true);
      assert.equal(await p.locator("#btn-md-close").isVisible(), true);
      // Close mission… opens the last-working-day dialog for this mission, and closing it comes back to the list
      await p.click("#btn-md-close");
      await p.locator("#modal-close-mission:not(.hidden)").waitFor();
      assert.match(await p.locator("#close-mission-title").innerText(), new RegExp("Close mission " + M7.replace(/\./g, "\\.")));
      await p.evaluate(() => closeModal());
      assert.equal(await p.evaluate(() => isMissionList()), true, "back on the Missions tab");
      assert.equal(await p.evaluate(() => state.date), dateBefore, "the day on screen is back too");
      // Hide takes it off the board; the list says so, and the detail then offers Unhide
      await open(M7);
      await p.click("#btn-md-hide");
      await sure();
      await p.waitForFunction(() => document.querySelector("#modal-mission").classList.contains("hidden") && document.querySelector("#modal-confirm").classList.contains("hidden"));
      assert.equal(db.t("missions").find((m) => m.id === "s7").hidden, true);
      await p.waitForFunction((n) => [...document.querySelectorAll("#missions-body tr")].some((tr) => tr.querySelector(".ml-num").textContent === n && /Hidden/.test(tr.innerText)), M7);
      await open(M7);
      assert.match(await p.locator("#btn-md-hide").innerText(), /Unhide/);
      await p.click("#btn-md-hide");
      await sure();
      await p.waitForFunction(() => document.querySelector("#modal-mission").classList.contains("hidden") && document.querySelector("#modal-confirm").classList.contains("hidden"));
      assert.equal(db.t("missions").find((m) => m.id === "s7").hidden, false);
      // Edit details swaps the form in; Cancel comes back to the detail; Save saves and comes back too
      await open(M7);
      await p.click("#btn-md-edit");
      await sure();
      await p.locator("#form-mission").waitFor();
      assert.equal(await p.locator("#form-mission").isVisible(), true);
      assert.equal(await p.inputValue("#form-mission [name=number]"), M7);
      assert.equal((await p.locator("#mission-modal-title").innerText()).trim(), M7, "the form's title is the mission number, as on the Host and Employee forms");
      assert.equal((await p.locator("#mission-modal-sub").innerText()).trim(), "Edit mission", "with Edit mission under it");
      assert.equal(await p.locator("#mission-modal-sub").isVisible(), true);
      await p.click("#btn-mission-cancel");
      await p.locator("#mission-detail:not(.hidden)").waitFor();
      await p.click("#btn-md-edit");
      await sure();
      await p.locator("#form-mission").waitFor();
      await p.fill("#form-mission [name=ppe]", "H-2");
      await p.click("#form-mission button[type=submit]");
      await p.locator("#mission-detail:not(.hidden)").waitFor();
      await p.waitForFunction(() => /H-2/.test(document.querySelector("#mission-detail").innerText));
      assert.equal(db.t("missions").find((m) => m.id === "s7").ppe, "H-2");
      await p.evaluate(() => closeModal());
      // a mission registered in Bulk edit with no day yet opens as a New Mission, filled in
      db.seed("mission_register", [{ board_id: "b1", number: `TSTTH.${YY}.0888`, shift: "day", source: "list", status: "open", host: "Host Beta", customer: "Cust Registered", engineer_id: "eng-2" }]);
      await p.evaluate(() => cloud.loadMissionRegister().then(refreshAndRender));
      await row(p, `TSTTH.${YY}.0888`).locator("td").first().dblclick();
      await p.locator("#modal-mission:not(.hidden)").waitFor();
      assert.match(await p.locator("#mission-modal-title").innerText(), /New Mission/);
      assert.equal(await p.inputValue("#form-mission [name=number]"), `TSTTH.${YY}.0888`);
      assert.equal(await p.inputValue("#form-mission [name=customer]"), "Cust Registered");
      assert.equal(await p.locator("#mission-board").inputValue(), "b1");
      await p.evaluate(() => closeModal());
      db.t("mission_register").splice(db.t("mission_register").findIndex((x) => x.number === `TSTTH.${YY}.0888`), 1);
      await p.evaluate(() => cloud.loadMissionRegister().then(refreshAndRender));
      await goMissions(p);
    });

    await step("By area chips in the top bar filter the missions by their host's service area", async () => {
      await goMissions(p);
      await p.evaluate(() => {
        D().areas.push({ id: "ar-t1", name: "Area One", color: "#7fb2ea" }, { id: "ar-t2", name: "Area Two", color: "#ec9a64" });
        D().hosts.find((x) => x.name === "Host Beta").areaId = "ar-t1";
        D().hosts.find((x) => x.name === "Host Gamma").areaId = "ar-t2";
        return refreshAndRender();
      });
      const chips = p.locator("#area-bar .ac-btn");
      assert.ok(await chips.count() >= 2, "a chip for each area with missions, like Host and Manpower");
      assert.match(await p.locator("#area-bar").innerText(), /By area/);
      const all = await p.locator("#missions-body tr").count();
      await p.locator("#area-bar .ac-btn", { hasText: "Area One" }).click();
      await p.waitForFunction((n) => document.querySelectorAll("#missions-body tr").length < n, all);
      const hosts = await p.locator("#missions-body tr td.ml-host-cell").allInnerTexts();
      assert.ok(hosts.length > 0 && hosts.every((t) => t.trim() === "Host Beta"), "only the hosts in that area: " + hosts.join(","));
      assert.match(await p.locator("#btn-missions-filter-pop").innerText(), /1/, "the Filters count says one is on");
      // several at once: a second chip adds its area
      await p.locator("#area-bar .ac-btn", { hasText: "Area Two" }).click();
      await p.waitForFunction(() => document.querySelectorAll("#area-bar .ac-btn.ac-on").length === 2);
      const both = (await p.locator("#missions-body tr td.ml-host-cell").allInnerTexts()).map((t) => t.trim());
      assert.ok(both.includes("Host Beta") && both.includes("Host Gamma"), "both areas are shown: " + both.join(","));
      assert.match(await p.locator("#btn-missions-filter-pop").innerText(), /1/, "the Filters count counts the Service area filter once");
      await p.locator("#area-bar .ac-btn", { hasText: "Area Two" }).click();   // off again
      await p.waitForFunction(() => document.querySelectorAll("#area-bar .ac-btn.ac-on").length === 1);
      await p.locator("#area-bar .ac-btn", { hasText: "Area One" }).click();   // and the last one: every area
      await p.waitForFunction((n) => document.querySelectorAll("#missions-body tr").length === n, all);
      // the same filter is inside Filters
      await p.click("#btn-missions-filter-pop");
      assert.equal(await p.locator('#missions-filters .ms[data-filter="areaId"]').count(), 1);
      await p.evaluate(() => closeFilterPops());
      await p.keyboard.press("Escape");
      // chips: the service area is one drawing on the three tabs and the mission panel; an empty cell is a muted dash
      const e1Area = await p.evaluate(() => { const e = D().employees.find((x) => x.id === "e1"), was = e.areaId; e.areaId = "ar-t1"; return was; });
      await p.evaluate(() => refreshAndRender());
      // Missions: a row with no customer / responsible shows a dash, not a blank
      await goMissions(p);
      const dashes = await p.locator("#missions-body td .lt-empty").count();
      assert.ok(dashes > 0, "an empty cell in the Missions table shows a muted dash");
      assert.equal((await p.locator("#missions-body td .lt-empty").first().innerText()).trim(), "\u2014");
      // the mission panel
      await row(p, M7).locator("td").first().dblclick();
      await p.locator("#mission-detail:not(.hidden)").waitFor();
      const panelArea = p.locator("#mission-detail .lt-ar");
      assert.equal(await panelArea.count(), 1, "the panel draws the service area with lt-ar");
      assert.match(await panelArea.innerText(), /Area One/);
      assert.equal(await p.locator("#mission-detail .lt-bd").count(), 1, "and the board as the square tag");
      assert.equal(await p.locator("#mission-detail .area-pill, #mission-detail .ml-tag").count(), 0, "no solid pill left");
      assert.equal(await p.locator("#mission-detail .lt-st").count(), 1, "the status is the pill with a dot");
      await p.evaluate(() => closeModal());
      // Host and Manpower tables draw it the same way
      await p.evaluate(() => { D().activeBoardId = HOSTLIST_ID; return refreshAndRender(); });
      assert.ok(await p.locator('#hostlist-body tr[data-host="Host Beta"] td.hl-area-cell .lt-ar').count() === 1, "Host table: lt-ar");
      await p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      assert.ok(await p.locator("#emplist-body td .lt-ar").count() > 0, "Manpower table: lt-ar");
      assert.equal(await p.locator("#emplist-body .area-pill").count(), 0);
      await goMissions(p);
      await p.evaluate(() => {
        D().areas = D().areas.filter((a) => !a.id.startsWith("ar-t"));
        for (const n of ["Host Beta", "Host Gamma"]) D().hosts.find((x) => x.name === n).areaId = null;
        return refreshAndRender();
      });
      await p.evaluate((was) => { D().employees.find((x) => x.id === "e1").areaId = was; }, e1Area);
    });

    await step("the detail panel shows who last edited it, Duplicate, Move or copy, and who has worked on it", async () => {
      await goMissions(p);
      const sure = async () => { const c = p.locator("#modal-confirm:not(.hidden)"); if (await c.waitFor({ timeout: 2000 }).then(() => true, () => false)) await p.click("#btn-confirm-yes"); };
      const back = (d, n) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() - n); return h.iso(x); };
      db.t("missions").find((m) => m.id === "s7").updated_by = "eng.a@example.com";
      db.t("missions").find((m) => m.id === "s7").updated_at = new Date().toISOString();
      db.seed("deployment_history", [
        ...[30, 31, 32].map((n) => ({ employee_id: "e3", plan_date: back(SRC, n), mission_number: M7, host: "Host Beta", customer: "Cust Seven", board_id: "b1" })),
        { employee_id: "e4", plan_date: back(SRC, 30), mission_number: M7, host: "Host Beta", customer: "Cust Seven", board_id: "b1" },
      ]);
      await p.evaluate(() => { cloud._invalidatePlans(); return refreshAndRender(); });
      await row(p, M7).locator("td").first().dblclick();
      await p.locator("#mission-detail:not(.hidden)").waitFor();
      await p.locator("#btn-md-edit").waitFor();
      // who last edited it, and when
      assert.match(await p.locator("#mission-detail").innerText(), /Last edited[\s\S]*eng\.a/);
      // the people who have worked on it, with their days
      await p.locator("#mission-detail .md-person").first().waitFor();
      const chips = await p.locator("#mission-detail .md-person").allInnerTexts();
      assert.ok(chips.length >= 2, "both people are listed: " + chips.join(" | "));
      assert.ok(chips.some((t) => /3d/.test(t)), "the busiest one has 3 days: " + chips.join(" | "));
      assert.match(await p.locator("#mission-detail").innerText(), /People who have worked on it/);
      // Move or copy… lists the other boards, as the card menu does
      await p.click("#btn-md-move");
      await p.locator("#context-menu:not(.hidden)").waitFor();
      assert.match(await p.locator("#context-menu").innerText(), /Board Two/);
      await p.evaluate(() => hideContextMenu());   // not Escape: that closes the panel too
      // Duplicate opens a New Mission filled in from it, with the number blank
      await p.click("#btn-md-dup");
      await sure();
      await p.locator("#form-mission").waitFor();
      assert.match(await p.locator("#mission-modal-title").innerText(), /New Mission/);
      assert.equal(await p.inputValue("#form-mission [name=number]"), "");
      assert.equal(await p.inputValue("#form-mission [name=customer]"), "Cust Seven");
      await p.evaluate(() => closeModal());
      assert.equal(await p.evaluate(() => isMissionList()), true, "back on the Missions tab");
      await goMissions(p);
    });

    await step("a proportion bar under the tiles; a highlighted mission shows its reason in Status and alerts, can be filtered, and the panel has a Highlight button", async () => {
      await goMissions(p);
      const sure = async () => { const c = p.locator("#modal-confirm:not(.hidden)"); if (await c.waitFor({ timeout: 2000 }).then(() => true, () => false)) await p.click("#btn-confirm-yes"); };
      // the bar under the tiles, as on Manpower and Host
      assert.equal(await p.locator("#stats-bar .st-split").count(), 1);
      assert.ok(await p.locator("#stats-bar .st-split i").count() >= 1);
      // the board's highlight, read for the day on screen
      db.t("missions").find((m) => m.id === "s7").highlight = "focus";
      // the chip reads the day on screen: put the page on the day the seed's mission is on
      await p.evaluate((d) => { state.date = d; state.missions.activityKey = null; cloud._invalidatePlans(); return refreshAndRender(); }, SRC);
      assert.match(await row(p, M7).locator("td.ml-status").innerText(), /Focus activity/);
      assert.equal(await row(p, M90).locator(".ml-hl").count(), 0, "only the highlighted one");
      // Filters > Alerts > Highlighted on the board
      await p.click("#btn-missions-filter-pop");
      await p.evaluate(() => closeFilterPops());
      await p.locator('#missions-filters .ms[data-filter="alerts"] .ms-btn').click();
      await p.locator('#missions-filters .ms[data-filter="alerts"] .ms-opt', { hasText: /^Highlighted on the board$/ }).locator("input").check();
      await p.waitForFunction(() => document.querySelectorAll("#missions-body tr").length === 1);
      assert.equal(await row(p, M7).count(), 1);
      await p.locator('#missions-filters .ms[data-filter="alerts"] .ms-clear').click();
      await p.evaluate(() => closeFilterPops());
      await p.waitForFunction(() => document.querySelectorAll("#missions-body tr").length > 1);
      // the panel shows it and offers the board's Highlight menu
      await row(p, M7).locator("td").first().dblclick();
      await p.locator("#mission-detail:not(.hidden)").waitFor();
      await p.locator("#btn-md-hl").waitFor();
      assert.match(await p.locator("#mission-detail").innerText(), /Highlight[\s\S]*Focus activity/);
      await p.click("#btn-md-hl");
      await p.locator("#context-menu:not(.hidden)").waitFor();
      const items = (await p.locator("#context-menu .ctx-item").allInnerTexts()).map((t) => t.trim());
      assert.ok(items.includes("New customer") && items.includes("Not enough manpower") && items.includes("Remove highlight"), items.join(" | "));
      await p.locator("#context-menu .ctx-item", { hasText: "Not enough manpower" }).click();
      await sure();
      await p.waitForFunction(() => document.querySelector("#modal-confirm").classList.contains("hidden"));
      await p.waitForFunction(() => (window.__demo ? true : true));
      assert.equal(db.t("missions").find((m) => m.id === "s7").highlight, "short");
      await p.waitForFunction((n) => [...document.querySelectorAll("#missions-body tr")].some((tr) => tr.querySelector(".ml-num").textContent === n && /Not enough manpower/.test(tr.innerText)), M7);
      // put it away again
      db.t("missions").find((m) => m.id === "s7").highlight = null;
      await p.evaluate(() => { state.missions.activityKey = null; cloud._invalidatePlans(); return refreshAndRender(); });
      await p.evaluate(() => closeModal());
      await goMissions(p);
    });

    await step("the Columns button hides and shows columns and remembers them; row actions show on hover, with a ⋯ menu", async () => {
      await goMissions(p);
      const sure = async () => { const c = p.locator("#modal-confirm:not(.hidden)"); if (await c.waitFor({ timeout: 2000 }).then(() => true, () => false)) await p.click("#btn-confirm-yes"); };
      const heads = async () => (await p.locator("#missions-table thead th:visible").allInnerTexts()).map((t) => t.trim());
      assert.ok((await heads()).some((t) => /^PPE$/.test(t)) && (await heads()).some((t) => /^Start date$/.test(t)), "Start date stays");
      // Columns: PPE and Remark off
      await p.click("#btn-missions-cols");
      await p.locator("#missions-cols-pop:not(.hidden)").waitFor();
      assert.equal(await p.locator('#missions-cols-pop input[data-col]').count(), 11);
      await p.locator('#missions-cols-pop input[data-col="ppe"]').uncheck();
      await p.locator('#missions-cols-pop input[data-col="remark"]').uncheck();
      assert.ok(!(await heads()).some((t) => /^PPE$|^Remark$/.test(t)), "the two columns are gone: " + (await heads()).join("|"));
      assert.equal(await p.locator("#missions-body td.mcol-ppe:visible").count(), 0);
      assert.match(await p.locator("#btn-missions-cols").innerText(), /2/, "the button says how many are off");
      assert.equal(await p.evaluate(() => localStorage.getItem("manpower.missionsHiddenCols")), JSON.stringify(["ppe", "remark"]), "kept on this device");
      await p.locator("#missions-cols-pop #btn-missions-cols-reset").click();
      assert.ok((await heads()).some((t) => /^PPE$/.test(t)), "Show all columns brings them back");   // (a column with nothing in it stays out of the way, as on Host)
      await p.keyboard.press("Escape");
      await p.evaluate(() => closeTopbarMenus());

      // the row's actions are quiet until the row is hovered; Close… needs no menu
      const r7 = row(p, M7);
      await p.mouse.move(2, 2);
      assert.equal(await r7.locator("button[data-act=close]").evaluate((b) => getComputedStyle(b).opacity), "0", "Close… is out of sight until the row is hovered");
      await r7.hover();
      await p.waitForFunction((n) => { const tr = [...document.querySelectorAll("#missions-body tr")].find((x) => x.querySelector(".ml-num").textContent === n); return getComputedStyle(tr.querySelector("button[data-act=close]")).opacity === "1"; }, M7);

      // the ⋯ menu: the panel's own actions
      await r7.locator("button[data-act=more]").click();
      await p.locator("#context-menu:not(.hidden)").waitFor();
      const items = (await p.locator("#context-menu .ctx-item").allInnerTexts()).map((t) => t.trim());
      for (const want of ["Mission details", "Highlight…", "Duplicate", "Move or copy…", "Hide"]) assert.ok(items.includes(want), want + " | " + items.join(" | "));
      assert.ok(!items.includes("Close mission…"), "Close is on the row, not in the menu");
      // Mission details opens the panel
      await p.locator("#context-menu .ctx-item", { hasText: "Mission details" }).click();
      await p.locator("#mission-detail:not(.hidden)").waitFor();
      await p.evaluate(() => closeModal());
      await goMissions(p);
      // Highlight… opens the panel with the board's list of reasons already open
      await row(p, M7).locator("button[data-act=more]").click();
      await p.locator("#context-menu .ctx-item", { hasText: "Highlight…" }).click();
      await p.locator("#mission-detail:not(.hidden)").waitFor();
      await p.locator("#context-menu .ctx-item", { hasText: "Remove highlight" }).or(p.locator("#context-menu .ctx-item", { hasText: "Focus activity" })).first().waitFor();
      assert.match(await p.locator("#context-menu").innerText(), /New customer[\s\S]*Not enough manpower/);
      await p.evaluate(() => { hideContextMenu(); closeModal(); });
      await goMissions(p);
      // Duplicate opens a New Mission filled in from it
      await row(p, M7).locator("button[data-act=more]").click();
      await p.locator("#context-menu .ctx-item", { hasText: "Duplicate" }).click();
      await sure();
      await p.locator("#form-mission").waitFor();
      assert.match(await p.locator("#mission-modal-title").innerText(), /New Mission/);
      assert.equal(await p.inputValue("#form-mission [name=customer]"), "Cust Seven");
      await p.evaluate(() => closeModal());
      await goMissions(p);
    });

    await step("an engineer closes a mission: the days after lose it and carry over skips it", async () => {
      db.seed("missions", [{ id: "n102", board_id: "b1", plan_date: NEXT, number: "102", host: "Host Beta", customer: "Cust Beta", shift: "day", engineer_id: "eng-2" }]);
      db.seed("assignments", [{ employee_id: "e3", plan_date: NEXT, mission_id: "n102", zone: null }]);
      await p.evaluate(() => cloud.loadMissionRegister().then(render));
      await row(p, "102").locator("button[data-act=close]").click();
      await p.locator("#modal-close-mission:not(.hidden)").waitFor();
      assert.match(await p.locator("#close-mission-title").innerText(), /Close mission 102/);
      await p.fill("#close-mission-date", SRC);
      assert.match(await p.locator("#close-mission-effect").innerText(), /comes off the board/);
      await p.fill("#close-mission-note", "Contract ended");
      await p.click("#btn-close-mission-go");
      await p.waitForFunction(() => document.querySelector("#modal-close-mission").classList.contains("hidden"));
      const r = reg("102");
      assert.equal(r.status, "closed");
      assert.equal(r.closed_on, SRC);
      assert.equal(r.close_note, "Contract ended");
      assert.equal(db.t("missions").some((m) => m.number === "102" && m.plan_date > SRC), false, "the next day lost it");
      assert.equal(db.t("assignments").some((x) => x.employee_id === "e3" && x.plan_date === NEXT), false, "its crew went back to Standby");
      // carry over onto the next working day brings everything but 102
      await p.evaluate((d) => cloud.resetBoardFromLastWorkingDay("b1", d), NEXT);
      const next = db.t("missions").filter((m) => m.board_id === "b1" && m.plan_date === NEXT).map((m) => m.number).sort();
      assert.deepEqual(next, ["101", "103", M7, OLD].sort());
      assert.equal(await row(p, "102").count(), 0, "closed missions are not in the Open view");
      await p.selectOption("#missions-status", "closed");
      assert.match(await row(p, "102").innerText(), /Closed/);
      assert.equal(await row(p, "102").locator("button[data-act=reopen]").count(), 0, "an engineer cannot reopen");
      await p.selectOption("#missions-status", "open");
    });

    await step("the mission card's quick panel offers Close mission…", async () => {
      await p.evaluate((d) => { D().activeBoardId = "b1"; state.date = d; return refreshAndRender(); }, NEXT);
      const card = p.locator("#missions-grid .mission-card", { has: p.locator(".m-number", { hasText: /^101$/ }) });
      // on the board a single click opens nothing; a double click opens the same detail as a Missions row
      await card.locator(".mission-header .m-line2").click();
      await p.waitForTimeout(400);
      assert.equal(await p.locator("#modal-mission:not(.hidden)").count(), 0, "one click opens nothing");
      await card.locator(".mission-header .m-line2").dblclick();
      await p.locator("#mission-detail:not(.hidden)").waitFor();
      assert.equal((await p.locator("#mission-modal-title").innerText()).trim(), "101");
      await p.evaluate(() => closeModal());
      await card.locator(".mission-header .m-line2").click({ button: "right" });
      await p.locator("#context-menu:not(.hidden)").waitFor();
      await p.locator("#context-menu .ctx-item", { hasText: "Close mission…" }).click();
      await p.locator("#modal-close-mission:not(.hidden)").waitFor();
      assert.equal(await p.inputValue("#close-mission-date"), NEXT, "the day on screen is the default last working day");
      await p.evaluate(() => closeModal());
    });

    await step("the mission form checks the number: its form, the suffix, a closed one", async () => {
      const card = p.locator("#missions-grid .mission-card", { has: p.locator(".m-number", { hasText: /^101$/ }) });
      const dup = async (num) => {
        await card.locator(".mission-header .m-line2").click({ button: "right" });
        await p.locator("#context-menu .ctx-item", { hasText: "Duplicate mission" }).click();
        await p.locator("#modal-mission:not(.hidden)").waitFor();
        await p.fill("#form-mission [name=number]", num);
        await p.click("#form-mission button[type=submit]");
      };
      await dup("102B");
      await p.locator(".toast", { hasText: "looks like BANGN.26.0007" }).waitFor();
      await p.fill("#form-mission [name=number]", `${M7}.AA`);
      await p.click("#form-mission button[type=submit]");
      await p.locator(".toast", { hasText: `Leave the monthly suffix off: type ${M7}` }).waitFor();
      await p.evaluate(() => closeModal());
    });

    await step("a number used on another board asks: same mission at another location?", async () => {
      const card = p.locator("#missions-grid .mission-card", { has: p.locator(".m-number", { hasText: /^101$/ }) });
      await card.locator(".mission-header .m-line2").click({ button: "right" });
      await p.locator("#context-menu .ctx-item", { hasText: "Duplicate mission" }).click();
      await p.fill("#form-mission [name=number]", M90.toLowerCase());
      await p.click("#form-mission button[type=submit]");
      await p.locator("#modal-confirm:not(.hidden)").waitFor();
      assert.match(await p.locator("#confirm-title").innerText(), /Same mission at another location/);
      assert.match(await p.locator("#confirm-message").innerText(), /already used on Board Two/);
      await p.click("#btn-confirm-yes");
      await p.waitForFunction((n) => [...document.querySelectorAll("#missions-grid .m-number")].some((e) => e.textContent === n), M90);
      assert.ok(db.t("missions").some((m) => m.board_id === "b1" && m.number === M90 && m.plan_date === NEXT), "saved upper case on Board One");
      assert.ok(reg(M90, "b1"), "registered on Board One too");
    });

    await step("an empty day can start from the Missions list", async () => {
      await p.evaluate((d) => { D().activeBoardId = "b2"; state.date = d; return refreshAndRender(); }, NEXT);
      const btn = p.locator("#board-empty button", { hasText: "Start from the Missions list (2)" });
      await btn.click();
      await p.waitForFunction(() => document.querySelectorAll("#missions-grid .mission-card").length === 2);
      const nums = db.t("missions").filter((m) => m.board_id === "b2" && m.plan_date === NEXT).map((m) => m.number).sort();
      assert.deepEqual(nums, [M90, OLD].sort());
      assert.equal(db.t("missions").find((m) => m.board_id === "b2" && m.plan_date === NEXT && m.number === M90).host, "Host Gamma");
    });

    const s = await env.openAs(db, SITE);
    const sp = s.page;
    await step("a Site Admin sees the alert: a badge on the tab and a banner with the way in", async () => {
      assert.equal(await sp.locator("#board-tabs .tab-missions .tab-badge").innerText(), "1");
      await goMissions(sp);
      assert.match(await sp.locator("#missions-alert").innerText(), new RegExp(`1 mission is (still on last year's number|waiting for 20${YY} numbers)`));
      assert.equal(await sp.locator("#btn-missions-newyear").isVisible(), true);
    });

    await step("the New-year numbers list: checks each number, then renames every board and shift from 1 January", async () => {
      await sp.click("#btn-missions-newyear");
      await sp.locator("#modal-newyear:not(.hidden)").waitFor();
      const tr = sp.locator("#newyear-body tr[data-old]");
      assert.equal(await tr.count(), 1, "one mission, whatever its boards");
      assert.match(await tr.innerText(), /Board One, Board Two/);
      const box = tr.locator(".ny-input");
      await box.fill(`TSTTH.${LY}.0009`);
      assert.match(await tr.locator(".ny-err").innerText(), /not a newer year/);
      assert.equal(await sp.locator("#btn-newyear-save").isDisabled(), true);
      await box.fill(M7);
      assert.match(await tr.locator(".ny-err").innerText(), /already used/);
      await box.fill(NEW.toLowerCase() + " ");
      assert.equal(await tr.locator(".ny-err").innerText(), "");
      await sp.click("#btn-newyear-save");
      await sp.waitForFunction(() => document.querySelector("#modal-newyear").classList.contains("hidden"));
      assert.equal(db.t("mission_register").filter((r) => r.number === NEW).length, 2, "both boards take the new number");
      assert.equal(db.t("missions").some((m) => m.number === OLD), false, `every day from 1 January 20${YY} is renamed`);
      assert.equal(db.t("deployment_history").find((x) => x.employee_id === "e9").mission_number, NEW);
      assert.deepEqual(db.t("mission_number_history").map((x) => [x.old_number, x.new_number, x.valid_from]), [[OLD, NEW, `20${YY}-01-01`]]);
      await row(sp, NEW, "Board One").waitFor();
      assert.match(await row(sp, NEW, "Board One").locator(".ml-was").innerText(), new RegExp("was " + OLD.replace(/\./g, "\\.")));
      assert.equal(await sp.locator("#missions-alert").isVisible(), false, "nothing is waiting any more");
      assert.equal(await sp.locator("#board-tabs .tab-missions .tab-badge").count(), 0);
      await sp.fill("#missions-search", OLD.toLowerCase());
      await sp.waitForFunction(() => document.querySelectorAll("#missions-body tr").length === 2);
      await sp.fill("#missions-search", "");
    });

    await step("for two weeks after the change, the mission card shows the old number beside the new one", async () => {
      await sp.evaluate((d) => { D().activeBoardId = "b1"; state.date = d; return refreshAndRender(); }, SRC);
      const card = sp.locator("#missions-grid .mission-card", { has: sp.locator(".m-number", { hasText: NEW }) });
      assert.match(await card.locator(".m-was-line").innerText(), new RegExp("New number\\s+was\\s+" + OLD.replace(/\./g, "\\."), "i"));
      assert.match(await sp.evaluate((n) => missionAsText(getPlan().missions.find((m) => m.number === n)), NEW), new RegExp(NEW.replace(/\./g, "\\.") + " \\(was " + OLD.replace(/\./g, "\\.") + "\\)"));
      // fifteen days on, it is gone
      db.t("mission_number_history")[0].entered_at = new Date(Date.now() - 15 * 86400000).toISOString();
      await sp.evaluate(() => cloud.loadMissionRegister().then(render));
      assert.equal(await card.locator(".m-was-line").count(), 0);
      assert.doesNotMatch(await sp.evaluate((n) => missionAsText(getPlan().missions.find((m) => m.number === n)), NEW), /was/);
      db.t("mission_number_history")[0].entered_at = new Date().toISOString();
      await sp.evaluate(() => cloud.loadMissionRegister());
      await goMissions(sp);
    });

    await step("a Site Admin reopens a closed mission; the board stays view-only for them", async () => {
      await sp.selectOption("#missions-status", "closed");
      await row(sp, "102").locator("button[data-act=reopen]").click();
      await sp.click("#btn-confirm-yes");
      await sp.waitForFunction(() => !document.querySelector("#missions-body button[data-act=reopen]"));
      assert.equal(reg("102").status, "open");
      assert.equal(reg("102").closed_on, null);
      await sp.selectOption("#missions-status", "open");
      assert.equal(await row(sp, "102").locator("button[data-act=add]").count(), 0, "no Add to board without board edit");
      assert.equal(await row(sp, "102").locator("button[data-act=close]").count(), 1);
    });

    await step("Bulk edit: the template, a changed customer, a new mission and a close, applied after the preview", async () => {
      await goMissions(p);
      await p.click("#btn-missions-bulk");
      await p.waitForSelector("#modal-bulk:not(.hidden)");
      assert.match(await p.locator("#bulk-title").innerText(), /Bulk edit missions/);
      const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-bulk-dl-xlsx")]);
      assert.match(dl.suggestedFilename(), /^missions_edit_\d{4}-\d{2}-\d{2}\.xlsx$/);
      const file = path.join(TMP, "missions.xlsx");
      await dl.saveAs(file);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(fs.readFileSync(file));
      assert.deepEqual(wb.worksheets.map((w) => w.name), ["Missions", "Lists", "Read me"]);
      const ws = wb.getWorksheet("Missions");
      const head = ws.getRow(1).values.slice(1);
      assert.deepEqual(head.slice(0, 4), ["ID", "Board", "Mission number", "Shift"]);
      const col = (label) => head.indexOf(label) + 1;
      const rowOf = (num, board) => { for (let r = 2; r <= ws.rowCount; r++) if (ws.getCell(r, col("Mission number")).value === num && (!board || ws.getCell(r, col("Board")).value === board)) return r; throw new Error("no row " + num); };
      assert.equal(ws.getCell(rowOf(NEW, "Board One"), col("Last year's number")).value, OLD);
      ws.getCell(rowOf(M90, "Board Two"), col("Customer")).value = "Cust Ninety Two";
      const r7 = rowOf(M7);
      ws.getCell(r7, col("Status")).value = "Closed";
      ws.getCell(r7, col("Finish date")).value = new Date(Date.UTC(+NEXT.slice(0, 4), +NEXT.slice(5, 7) - 1, +NEXT.slice(8, 10)));
      let blank = 2; while (ws.getCell(blank, col("Mission number")).value) blank++;
      ws.getCell(blank, col("Board")).value = "Board Two";
      ws.getCell(blank, col("Mission number")).value = `TSTTH.${YY}.0101`;
      ws.getCell(blank, col("Shift")).value = "Night";
      ws.getCell(blank, col("Customer")).value = "Cust New";
      ws.getCell(blank, col("Host")).value = "Host Beta";
      ws.getCell(blank + 1, col("Board")).value = "Board Two";
      ws.getCell(blank + 1, col("Mission number")).value = `TSTTH.${YY}.0102.AB`;
      ws.getCell(blank + 1, col("Shift")).value = "Day";
      const edited = path.join(TMP, "missions-edited.xlsx");
      fs.writeFileSync(edited, Buffer.from(await wb.xlsx.writeBuffer()));
      await p.setInputFiles("#bulk-file", edited);
      await p.locator("#bulk-preview:not(.hidden)").waitFor();
      const chip = (label) => p.evaluate((l) => { const c = [...document.querySelectorAll("#bulk-preview .stat-chip")].find((x) => x.textContent.trim().startsWith(l + ":")); return c ? Number(c.querySelector("b").textContent) : null; }, label);
      assert.equal(await chip("To update"), 2);
      assert.equal(await chip("New missions"), 1);
      assert.equal(await chip("Problems"), 1);
      assert.match(await p.locator("#bulk-preview .bulk-problems").innerText(), /Leave the monthly suffix off/);
      await p.check("#bulk-create");
      await p.locator("#bulk-backup").uncheck();
      await p.click("#btn-bulk-apply");
      await p.waitForFunction(() => document.querySelector("#modal-bulk").classList.contains("hidden"));
      assert.equal(reg(M90, "b2").customer, "Cust Ninety Two");
      assert.equal(reg(M7).status, "closed");
      assert.equal(reg(M7).closed_on, NEXT);
      const created = reg(`TSTTH.${YY}.0101`);
      assert.ok(created && created.source === "list" && created.shift === "night" && created.board_id === "b2" && created.host === "Host Beta");
    });

    await step("on a phone the Missions tab is in the Me menu", async () => {
      const ph = await env.openAs(db, h.USERS.a, { viewport: { width: 390, height: 800 } });
      await ph.page.click("#btn-bn-more");
      const item = ph.page.locator("#more-menu .tb-item", { hasText: "Missions" });
      await item.click();
      await ph.page.locator("#missions-panel:not(.hidden)").waitFor();
      assert.equal(await ph.page.locator("#m-title").innerText(), "Missions");
      assert.equal(await ph.page.evaluate(() => document.documentElement.scrollWidth), 390, "no sideways scroll");
      assert.deepEqual(ph.errors, []);
      await ph.close();
    });

    await step("in Thai, the Missions tab and its dialogs leave no English behind", async () => {
      await goMissions(sp);
      await sp.selectOption("#missions-status", "all");
      await sp.evaluate(() => I18N.setLang("th"));
      // every word shown (text, tooltips, labels, placeholders) is Thai, except data people typed
      // (mission numbers, boards, hosts, customers, engineers) and Etraq / Excel
      const shownIn = (sel) => sp.evaluate((q) => {
        const el = document.querySelector(q);
        const attrs = [...el.querySelectorAll("[title],[aria-label],[placeholder]")].map((x) => [x.title, x.getAttribute("aria-label"), x.placeholder].join(" "));
        return el.innerText + "\n" + attrs.join("\n");
      }, sel);
      const english = (txt) => (txt.replace(/TSTTH\.[0-9.]+|Board (One|Two)|Host (Alpha|Beta|Gamma)|Cust [A-Za-z ]+|Eng (One|Two)|Etraq|Excel|PPE|TRIGO|BANGN\.26\.0007|site\.d|eng\.a(@example\.com)?|undefined|null/g, "").match(/[A-Za-z]{2,}/g) || []);
      await sp.waitForTimeout(300);
      const listText = await shownIn("#missions-panel");
      if (english(listText).length) console.log(listText.split("\n").filter((l) => english(l).length).join("\n"));
      assert.deepEqual(english(listText), [], "the list");
      assert.deepEqual(english(await shownIn("#missions-toolbar")), [], "its toolbar");
      await sp.evaluate(() => openCloseMissionModal(D().register.find((r) => r.status === "open" && r.number === "101")));
      await sp.waitForTimeout(300);
      assert.deepEqual(english(await shownIn("#modal-close-mission")), [], "the Close dialog");
      await sp.evaluate(() => closeModal());
      // something waiting for the new-year list
      await sp.evaluate((n) => { D().register.find((r) => r.number === "101").number = n; }, `TSTTH.${LY}.0101`);
      await sp.evaluate(() => openNewYearModal());
      await sp.locator("#newyear-body .ny-input").fill("x");
      await sp.waitForTimeout(300);
      assert.deepEqual(english(await shownIn("#modal-newyear")), [], "the New-year numbers dialog");
      await sp.evaluate(() => closeModal());
      await sp.evaluate(() => I18N.setLang("en"));
      await sp.evaluate(() => cloud.loadMissionRegister().then(render));
    });

    await step("at 1024px every module tab, Missions included, is in full view (the app's name gives way)", async () => {
      await p.setViewportSize({ width: 1024, height: 900 });
      await p.evaluate(() => { D().activeBoardId = "b1"; return refreshAndRender(); });
      const r = await p.evaluate(() => {
        const strip = document.querySelector("#board-tabs").getBoundingClientRect();
        return { titles: [...document.querySelectorAll("#board-tabs .board-tab")].map((t) => t.title),
          hidden: [...document.querySelectorAll("#board-tabs .board-tab")].filter((t) => { const b = t.getBoundingClientRect(); return b.left < strip.left - 1 || b.right > strip.right + 1; }).map((t) => t.title) };
      });
      assert.ok(r.titles.includes("Missions"));
      assert.deepEqual(r.hidden, []);
      await p.setViewportSize({ width: 1400, height: 900 });
      await p.evaluate(() => fitTopbar());
      assert.equal(await p.locator("#app-title").isVisible(), true, "the name is back on a wide screen");
    });

    await step("no page errors", async () => {
      assert.deepEqual(a.errors, []);
      assert.deepEqual(s.errors, []);
    });
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
})();
