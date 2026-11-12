/* Acceptance run for the stricter mission numbers (migration-2026-11-11): the Wrong number and
   Temporary number flags on the board's cards (left out of an export), a new mission on a temporary
   number made from the site code, Fix number from a card, from a Missions row and from the mission
   form (every day renamed, "was …" beside the new number), a wrong number turned into a temporary
   one, the Missions tab's banner, tile, alerts and filter, a viewer seeing the flags without Fix
   number, a database without the migration, and Thai.
   Real app in Chromium against the shared fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/mission-number-rules.e2e.js
   Seed: harness.seedBase (missions 101, 102 and 103: numbers typed before the rule was strict) plus
   TSTTH.<yy>.0007 (an Etraq number), TSTTH.<yy>.TMP001 (temporary, made four days ago) and
   TSTTH.<yy>.TMP002 (temporary, made today). Fixtures are fake. Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
const PREV = h.prevWorking(SRC);
const YY = String(new Date().getFullYear()).slice(2);
const M7 = `TSTTH.${YY}.0007`, TMP1 = `TSTTH.${YY}.TMP001`, TMP2 = `TSTTH.${YY}.TMP002`;

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 6).join("\n   ")); throw e; }
}

function seed(opts) {
  const db = new h.FakeDb(opts);
  h.seedBase(db, { src: SRC });
  db.seed("roles", [{ key: "siteadmin", label: "Site Admin", rank: 35, protected: false }]);
  db.seed("role_permissions", [
    ["admin", "edit", "edit"], ["manager", "edit", "edit"], ["engineer", "edit", "none"], ["siteadmin", "edit", "edit"], ["viewer", "view", "none"],
  ].flatMap(([role, m, ma]) => [{ role_key: role, area: "missions", level: m }, { role_key: role, area: "missionadmin", level: ma }]));
  db.seed("missions", [
    { id: "p101", board_id: "b1", plan_date: PREV, number: "101", host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" },
    { id: "s7", board_id: "b1", plan_date: SRC, number: M7, host: "Host Beta", customer: "Cust Seven", shift: "day", engineer_id: "eng-2" },
    { id: "st1", board_id: "b1", plan_date: SRC, number: TMP1, host: "Host Gamma", customer: "Cust Temp One", shift: "day", engineer_id: "eng-1" },
    { id: "pt1", board_id: "b1", plan_date: PREV, number: TMP1, host: "Host Gamma", customer: "Cust Temp One", shift: "day", engineer_id: "eng-1" },
    { id: "st2", board_id: "b2", plan_date: SRC, number: TMP2, host: "Host Gamma", customer: "Cust Temp Two", shift: "day", engineer_id: "eng-2" },
  ]);
  db.seed("deployment_history", [{ employee_id: "e1", plan_date: PREV, mission_number: TMP1, host: "Host Gamma", customer: "Cust Temp One", board_id: "b1" }]);
  // the temporary number's three days count from when the mission was first registered
  for (const r of db.t("mission_register")) r.created_at = r.number === TMP1 ? new Date(Date.now() - 4 * 86400e3).toISOString() : new Date().toISOString();
  return db;
}

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const db = seed();
    const a = await env.openAs(db, h.USERS.a);   // an engineer: Missions = edit
    const p = a.page;
    const goDay = (pg, boardId = "b1") => pg.evaluate(([d, b]) => { state.date = d; D().activeBoardId = b; return refreshAndRender(); }, [SRC, boardId]);
    const goMissions = (pg) => pg.evaluate(() => { D().activeBoardId = MISSIONS_ID; return refreshAndRender(); });
    const card = (pg, num) => pg.locator("#missions-grid .mission-card", { has: pg.locator(".m-number", { hasText: new RegExp("^" + num.replace(/\./g, "\\.") + "$") }) });
    const row = (pg, num) => pg.locator("#missions-body tr", { has: pg.locator(".ml-num", { hasText: new RegExp("^" + num.replace(/\./g, "\\.") + "$") }) });
    const numbers = (t) => [...new Set(db.t(t).map((m) => m.number))];

    await step("the board flags a wrong number and a temporary one, red from the third day; an Etraq number has no flag", async () => {
      await goDay(p);
      const bad = card(p, "101").locator(".m-num-flag");
      assert.match(await bad.innerText(), /Wrong number[\s\S]*Not in Etraq format[\s\S]*Fix number/i);
      assert.ok(await bad.evaluate((e) => e.classList.contains("bad")));
      const late = card(p, TMP1).locator(".m-num-flag");
      assert.match(await late.innerText(), /Temporary number[\s\S]*4 days: enter the Etraq number/i);
      assert.ok(await late.evaluate((e) => e.classList.contains("late")), "four days old: red");
      assert.equal(await card(p, M7).locator(".m-num-flag").count(), 0);
      await goDay(p, "b2");
      const fresh = card(p, TMP2).locator(".m-num-flag");
      assert.match(await fresh.innerText(), /Temporary number[\s\S]*Etraq number to follow/i);
      assert.ok(await fresh.evaluate((e) => e.classList.contains("temp")), "made today: quiet");
      // never baked into the JPG / PDF
      assert.equal(await p.evaluate(() => { document.body.classList.add("exporting"); const d = getComputedStyle(document.querySelector(".m-num-flag")).display; document.body.classList.remove("exporting"); return d; }), "none");
    });

    await step("a new mission without its Etraq number gets the next temporary number for the site code", async () => {
      await goDay(p);
      await p.evaluate(() => openMissionModal(null));
      await p.locator("#modal-mission:not(.hidden)").waitFor();
      assert.equal(await p.locator("#mission-number-mode").isVisible(), true, "a new mission offers the choice");
      await p.check("#form-mission [name=numMode][value=temp]");
      assert.equal(await p.locator("#mission-number-row").isVisible(), false, "the number box makes way for the site code");
      await p.fill("#form-mission [name=sitecode]", "tst");
      assert.match(await p.locator("#mission-number-note").innerText(), /5 capital letters or digits/);
      await p.fill("#form-mission [name=host]", "Host Alpha");
      await p.fill("#form-mission [name=customer]", "Cust New Temp");
      await p.fill("#form-mission [name=engineer]", "Eng One");
      await p.click("#form-mission button[type=submit]");
      await p.locator(".toast", { hasText: "5 capital letters or digits" }).waitFor();
      await p.fill("#form-mission [name=sitecode]", "tstth");
      const TMP3 = `TSTTH.${YY}.TMP003`;
      assert.match(await p.locator("#mission-number-note").innerText(), new RegExp(`temporary number ${TMP3.replace(/\./g, "\\.")}`), "the next one after TMP001 and TMP002, on any board");
      await p.click("#form-mission button[type=submit]");
      await card(p, TMP3).waitFor();
      assert.ok(db.t("missions").some((m) => m.number === TMP3 && m.plan_date === SRC && m.customer === "Cust New Temp"));
      assert.match(await card(p, TMP3).locator(".m-num-flag").innerText(), /Etraq number to follow/);
    });

    await step("the mission form refuses a wrong number for a new mission and a temporary one typed by hand", async () => {
      await p.evaluate(() => openMissionModal(null));
      await p.fill("#form-mission [name=number]", `TST.${YY}.0001`);
      await p.fill("#form-mission [name=host]", "Host Alpha");
      await p.fill("#form-mission [name=customer]", "Cust X");
      await p.fill("#form-mission [name=engineer]", "Eng One");
      await p.click("#form-mission button[type=submit]");
      await p.locator(".toast", { hasText: "5-character site code" }).waitFor();
      await p.fill("#form-mission [name=number]", `TSTTH.${YY}.TMP050`);
      await p.click("#form-mission button[type=submit]");
      await p.locator(".toast", { hasText: "is a temporary number" }).waitFor();
      await p.evaluate(() => closeModal());
    });

    await step("a mission number and a site code turn into capitals as they are typed, and are saved in capitals", async () => {
      await goDay(p);
      await p.evaluate(() => openMissionModal(null));
      await p.locator("#modal-mission:not(.hidden)").waitFor();
      const num = p.locator("#form-mission [name=number]");
      await num.pressSequentially("esie1.26.04");
      assert.equal(await num.inputValue(), "ESIE1.26.04", "typed lower case, shown in capitals");
      await num.press("Home"); await num.press("ArrowRight");
      await num.pressSequentially("xy");
      assert.equal(await num.inputValue(), "EXYSIE1.26.04", "typed in the middle: the cursor stays after what was typed");
      await p.check("#form-mission [name=numMode][value=temp]");
      const site = p.locator("#form-mission [name=sitecode]");
      await site.fill("esie1");
      assert.equal(await site.inputValue(), "ESIE1", "the site code too");
      assert.match(await p.locator("#mission-number-note").innerText(), new RegExp(`temporary number ESIE1\\.${YY}\\.TMP001`), "the note reads the capitals");
      await p.check("#form-mission [name=numMode][value=etraq]");
      await num.fill(`esie1.${YY}.0417`);
      assert.equal(await num.inputValue(), `ESIE1.${YY}.0417`);
      await p.fill("#form-mission [name=host]", "Host Alpha");
      await p.fill("#form-mission [name=customer]", "Cust Capitals");
      await p.fill("#form-mission [name=engineer]", "Eng One");
      await p.click("#form-mission button[type=submit]");
      await card(p, `ESIE1.${YY}.0417`).waitFor();
      assert.ok(db.t("missions").some((m) => m.number === `ESIE1.${YY}.0417` && m.customer === "Cust Capitals"));
      assert.ok(!numbers("missions").some((n) => n !== n.toUpperCase()), "no lower-case number is saved");
      assert.equal(await card(p, `ESIE1.${YY}.0417`).locator(".m-num-flag").count(), 0, "an Etraq number: no flag");
      // a pasted lower-case number from a script or a file lands in capitals too (the database's trigger)
      await p.evaluate(async ([d, y]) => { await cloud.saveMission(D().activeBoardId, d, null, { number: "amata." + y + ".0042", host: "Host Alpha", customer: "Cust Pasted", shift: "day", startTime: "08:00", endTime: "17:00", engineerId: "eng-1" }); }, [SRC, YY]);
      assert.ok(db.t("missions").some((m) => m.number === `AMATA.${YY}.0042`), "the trigger capitalises on the way in");
    });

    await step("Fix number on a card replaces a temporary number on every day, and the card shows the old one beside it", async () => {
      await card(p, TMP1).locator(".m-num-fix").click();
      await p.locator("#modal-fix-number:not(.hidden)").waitFor();
      assert.match(await p.locator("#fix-number-why").innerText(), /temporary number, made 4 days ago/);
      assert.equal(await p.locator("#fix-number-mode").isVisible(), false, "a temporary number only takes the Etraq number");
      await p.fill("#fix-number-input", `TSTTH.${YY}.123`);
      assert.match(await p.locator("#fix-number-preview").innerText(), /looks like BANGN/);
      assert.equal(await p.locator("#btn-fix-number-go").isDisabled(), true);
      await p.fill("#fix-number-input", M7.toLowerCase());
      assert.match(await p.locator("#fix-number-preview").innerText(), /already used by another mission/);
      await p.fill("#fix-number-input", `tstth.${YY}.0123`);
      assert.match(await p.locator("#fix-number-preview").innerText(), new RegExp(`becomes TSTTH\\.${YY}\\.0123`));
      await p.click("#btn-fix-number-go");
      await p.locator(".toast", { hasText: `is now TSTTH.${YY}.0123 on every day` }).waitFor();
      const N = `TSTTH.${YY}.0123`;
      assert.ok(!numbers("missions").includes(TMP1), "no day left on the temporary number");
      assert.equal(db.t("missions").filter((m) => m.number === N).length, 2, "both days renamed, the earlier one too");
      assert.equal(db.t("deployment_history").find((x) => x.employee_id === "e1").mission_number, N, "the Host Record too");
      assert.ok(db.t("mission_number_history").some((x) => x.old_number === TMP1 && x.new_number === N));
      await card(p, N).waitFor();
      assert.equal(await card(p, N).locator(".m-num-flag").count(), 0, "the flag is gone");
      assert.match(await card(p, N).locator(".m-was-line").innerText(), new RegExp(`was\\s+${TMP1.replace(/\./g, "\\.")}`));
    });

    await step("changing a wrong number in the mission form asks, then renames every day", async () => {
      await p.evaluate(() => openMissionModal("s101", { edit: true }));
      await p.locator("#modal-mission:not(.hidden)").waitFor();
      assert.equal(await p.locator("#mission-number-mode").isVisible(), false, "editing: no temporary-number choice");
      assert.match(await p.locator("#mission-number-note").innerText(), /not in the Etraq format/);
      const N = `TSTTH.${YY}.0101`;
      await p.fill("#form-mission [name=number]", N);
      assert.match(await p.locator("#mission-number-note").innerText(), /replaces the wrong one on every day/);
      await p.click("#form-mission button[type=submit]");
      await p.locator("#modal-confirm:not(.hidden)").waitFor();
      assert.match(await p.locator("#confirm-message").innerText(), new RegExp(`101 becomes ${N.replace(/\./g, "\\.")} on every day`));
      await p.click("#btn-confirm-yes");
      await card(p, N).waitFor();
      assert.deepEqual(db.t("missions").filter((m) => m.number === N).map((m) => m.plan_date).sort(), [PREV, SRC], "both days");
      assert.ok(!numbers("missions").includes("101"));
      assert.equal(db.t("mission_register").filter((r) => r.number === N).length, 1);
    });

    await step("the Missions tab: a banner and a tile for the numbers to fix, the alerts, and Show them", async () => {
      await goMissions(p);
      // left to fix: 102 and 103 (wrong); TMP002 and TMP003 are new
      const banner = p.locator("#missions-numfix");
      assert.match(await banner.innerText(), /2 missions have a wrong number\./);
      assert.doesNotMatch(await banner.innerText(), /temporary number after 3 days/, "a temporary number under three days old is not yet asked about");
      assert.match(await p.locator('[data-stat="Number to fix"]').first().innerText(), /2/);
      assert.match(await row(p, "102").locator(".ml-alerts").innerText(), /Wrong number/);
      // a new temporary number is a grey note (level 0), listed after the row's worse alerts
      const tmp2 = await p.evaluate((n) => missionInfo(D().register.find((r) => r.number === n)).alerts.map((x) => `${x.level}:${x.text}`), TMP2);
      assert.ok(tmp2.includes("0:Temporary number"), JSON.stringify(tmp2));
      await banner.locator("button", { hasText: "Show them" }).click();
      assert.deepEqual((await p.locator("#missions-body .ml-num").allInnerTexts()).sort(), ["102", "103"]);
      await banner.locator("button", { hasText: "Show all" }).click();
      assert.ok(await p.locator("#missions-body tr").count() > 2);
    });

    await step("a wrong number may become a temporary one from its Missions row, while Etraq has none yet", async () => {
      await row(p, "102").hover();
      await row(p, "102").locator("[data-act=more]").click();
      await p.locator("#context-menu .ctx-item", { hasText: "Fix mission number…" }).click();
      await p.locator("#modal-fix-number:not(.hidden)").waitFor();
      assert.equal(await p.locator("#fix-number-mode").isVisible(), true);
      await p.check("#form-fix-number [name=numMode][value=temp]");
      assert.equal(await p.locator("#form-fix-number [name=sitecode]").inputValue(), "TSTTH", "the board's own site code");
      const TMP4 = `TSTTH.${YY}.TMP004`;
      assert.match(await p.locator("#fix-number-preview").innerText(), new RegExp(`temporary number ${TMP4.replace(/\./g, "\\.")}`));
      await p.click("#btn-fix-number-go");
      await row(p, TMP4).waitFor();
      assert.ok(numbers("missions").includes(TMP4) && !numbers("missions").includes("102"));
    });

    await step("the row's ⋯ menu offers Fix number too; the Alerts filter has the kinds", async () => {
      await row(p, "103").hover();
      await row(p, "103").locator("[data-act=more]").click();
      await p.locator("#context-menu .ctx-item", { hasText: "Fix mission number…" }).click();
      await p.locator("#modal-fix-number:not(.hidden)").waitFor();
      assert.match(await p.locator("#fix-number-title").innerText(), /Fix mission number 103/);
      await p.evaluate(() => closeModal());
      const opts = await p.evaluate(() => missionFilterOptions("alerts").map((o) => o.value));
      for (const k of ["numberFix", "numberBad", "numberTemp"]) assert.ok(opts.includes(k), k);
    });

    await step("a viewer sees the flags with no Fix number", async () => {
      const v = await env.openAs(db, h.USERS.v);
      await goDay(v.page);
      const f = card(v.page, "103").locator(".m-num-flag");
      assert.match(await f.innerText(), /Wrong number/i);
      assert.equal(await f.locator(".m-num-fix").count(), 0);
      await v.page.evaluate(() => openFixNumberModal("103"));
      await v.page.locator(".toast", { hasText: "cannot change mission numbers" }).waitFor();
      await v.close();
    });

    await step("the Missions tab shows a number to fix in bold red with a warning mark; an Etraq number stays plain", async () => {
      await goMissions(p);
      const n103 = row(p, "103").locator(".ml-num");
      assert.ok(await n103.evaluate((e) => e.classList.contains("ml-num-fix")), "103 is marked");
      assert.equal(await n103.evaluate((e) => getComputedStyle(e).fontWeight), "800");
      assert.equal(await row(p, "103").locator(".ml-num-mark").count(), 1);
      assert.equal(await row(p, M7).locator(".ml-num-fix, .ml-num-mark").count(), 0);
      assert.equal(await row(p, TMP2).locator(".ml-num-fix").count(), 0, "a new temporary number is not red yet");
    });

    await step("the crew never see the warnings: not in the PDF (print) nor in Present mode", async () => {
      await goDay(p);
      const shown = () => card(p, "103").locator(".m-num-flag").evaluate((e) => getComputedStyle(e).display);
      assert.notEqual(await shown(), "none");
      await p.emulateMedia({ media: "print" });
      assert.equal(await shown(), "none", "print / PDF");
      await p.emulateMedia({ media: "screen" });
      await p.evaluate(() => document.body.classList.add("presenting"));
      assert.equal(await shown(), "none", "Present mode");
      await p.evaluate(() => document.body.classList.remove("presenting"));
    });

    await step("Settings › Mission numbers: the site code length, a draft that says what it would flag, saved for everyone", async () => {
      await p.click("#btn-avatar");
      await p.click("#btn-settings");
      await p.waitForSelector("#settings-view:not(.hidden)");
      await p.click("#settings-tabs [data-tab=missionnum]");
      await p.waitForFunction(() => state.settingsTab === "missionnum");
      assert.equal(await p.inputValue("#missionnum-length"), "5");
      assert.match(await p.locator("#missionnum-note").innerText(), /BANGN\.26\.0007.*BANGN\.26\.TMP001/);
      await p.fill("#missionnum-length", "11");
      assert.equal(await p.getAttribute("#missionnum-length", "aria-invalid"), "true");
      await p.fill("#missionnum-length", "4");
      assert.match(await p.locator("#missionnum-note").innerText(), /BANG\.26\.0007/);
      assert.match(await p.locator("#missionnum-effect").innerText(), /With 4, \d+ open missions would have a wrong number/);
      await p.click("#btn-sv-save");
      await p.waitForFunction(() => /All changes saved/.test(document.querySelector("#sv-status").textContent));
      assert.equal(db.t("app_settings").find((r) => r.key === "mission_prefix_length").value, 4);
      assert.equal(await p.evaluate(() => MissionNumber.prefixLength), 4);
      await p.click("#btn-settings-back");
      await p.waitForSelector("#settings-view", { state: "hidden" });
      await goDay(p);
      assert.match(await card(p, M7).locator(".m-num-flag").innerText(), /Wrong number/i, "a 5-character code is wrong at 4");
      // a change reaches another browser that is open
      const b = await env.openAs(db, h.USERS.b);
      await goDay(b.page);
      assert.equal(await b.page.evaluate(() => MissionNumber.prefixLength), 4);
      await b.close();
      // and back to 5
      await p.click("#btn-avatar");
      await p.click("#btn-settings");
      await p.waitForSelector("#settings-view:not(.hidden)");
      await p.fill("#missionnum-length", "5");
      await p.click("#btn-sv-save");
      await p.waitForFunction(() => /All changes saved/.test(document.querySelector("#sv-status").textContent));
      await p.click("#btn-settings-back");
      await p.waitForSelector("#settings-view", { state: "hidden" });
      await goDay(p);
      assert.equal(await card(p, M7).locator(".m-num-flag").count(), 0);
    });

    await step("Thai: the flag and the banner are translated", async () => {
      await p.evaluate(() => I18N.setLang("th"));
      await goDay(p);
      assert.match(await card(p, "103").locator(".m-num-flag").innerText(), /หมายเลขผิด[\s\S]*ไม่ตรงรูปแบบ Etraq[\s\S]*แก้หมายเลข/);
      await goMissions(p);
      assert.match(await p.locator("#missions-numfix").innerText(), /1 มิชชั่นมีหมายเลขผิด/);
      await p.evaluate(() => I18N.setLang("en"));
    });

    await step("a database without the migration: the flags show, and Fix number says to run it", async () => {
      const old = seed({ numberFix: false });
      const o = await env.openAs(old, h.USERS.a);
      await goDay(o.page);
      await card(o.page, "101").locator(".m-num-fix").click();
      await o.page.fill("#fix-number-input", `TSTTH.${YY}.0101`);
      await o.page.click("#btn-fix-number-go");
      await o.page.locator(".toast", { hasText: "migration-2026-11-11-mission-number-rules.sql" }).waitFor();
      assert.ok(old.t("missions").some((m) => m.number === "101"), "nothing changed");
      await o.close();
    });

    assert.deepEqual(a.errors, [], "page errors");
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
  }
  if (failed) process.exit(1);
  console.log("ALL MISSION NUMBER CHECKS PASSED");
})();
