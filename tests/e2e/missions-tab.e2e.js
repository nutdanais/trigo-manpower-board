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
      assert.match(await row(p, OLD, "Board One").locator(".ml-tag").last().innerText(), new RegExp(`No 20${YY} number|Waiting for 20${YY} number`));
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
