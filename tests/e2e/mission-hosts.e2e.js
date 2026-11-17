/* Acceptance run for a mission at several hosts (migration-2026-11-19): one customer, several hosts.
   - the New Mission form takes other hosts, and the Missions list shows "+1";
   - Add to board asks which host every time; the same host twice is refused with an alert; another host is a second
     card on the same day;
   - a carried-over card of a mission with several hosts keeps the host it was at and shows "Confirm host" (never on a
     single-host mission), and confirming or changing the host clears it;
   - a database without the migration behaves as before (no other-host rows, no question).
   Real app in Chromium against the shared fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/mission-hosts.e2e.js
   Fixtures are fake. Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
const NEXT = h.nextWorking(SRC);
const YY = String(new Date().getFullYear()).slice(2);
const HM = `TSTTH.${YY}.0300`, HN = `TSTTH.${YY}.0310`, NEWM = `TSTTH.${YY}.0301`, SINGLE = `TSTTH.${YY}.0320`;

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
    // a mission with two hosts, on the board at Host Alpha with a crew; and a single-host mission beside it
    { id: "hm1", board_id: "b1", plan_date: SRC, number: HM, host: "Host Alpha", customer: "Cust Multi", shift: "day", engineer_id: "eng-1" },
    { id: "sg1", board_id: "b1", plan_date: SRC, number: SINGLE, host: "Host Gamma", customer: "Cust Single", shift: "day", engineer_id: "eng-1" },
  ]);
  db.seed("assignments", [
    { employee_id: "e6", plan_date: SRC, mission_id: "hm1", zone: null },
    { employee_id: "e7", plan_date: SRC, mission_id: "sg1", zone: null },
  ]);
  if (opts && opts.missionHosts === false) return db;
  db.t("mission_register").find((r) => r.number === HM).hosts = ["Host Alpha", "Host Beta"];
  // a registered mission with two hosts that is on no day yet (Add to board)
  db.seed("mission_register", [{ board_id: "b1", number: HN, shift: "day", host: "Host Alpha", customer: "Cust Off", status: "open", source: "list",
    hosts: ["Host Alpha", "Host Beta"], opened_on: SRC, last_on: null, start_time: "08:00:00", end_time: "17:00:00", engineer_id: "eng-1" }]);
  return db;
}

(async () => {
  const env = await h.launch();
  try {
    const db = seed();
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const goDay = (pg, date = SRC, boardId = "b1") => pg.evaluate(([d, b]) => { state.date = d; D().activeBoardId = b; return refreshAndRender(); }, [date, boardId]);
    const goMissions = (pg) => pg.evaluate(() => { D().activeBoardId = MISSIONS_ID; return refreshAndRender(); });
    const rx = (s) => new RegExp("^" + s.replace(/\./g, "\\.") + "$");
    const cards = (pg, num) => pg.locator("#missions-grid .mission-card", { has: pg.locator(".m-number", { hasText: rx(num) }) });
    const row = (pg, num) => pg.locator("#missions-body tr", { has: pg.locator(".ml-num", { hasText: rx(num) }) });
    const cardsOf = (num, date) => db.t("missions").filter((m) => m.number === num && m.plan_date === date && m.board_id === "b1");

    await step("the New Mission form takes other hosts: one customer, several hosts, listed on the Missions list", async () => {
      await goDay(p);
      await p.evaluate(() => openMissionModal(null));
      await p.locator("#modal-mission:not(.hidden)").waitFor();
      assert.equal(await p.locator("#mission-more-hosts-row").isVisible(), true, "the other-hosts block is there");
      await p.fill("#form-mission [name=number]", NEWM);
      await p.fill("#form-mission [name=host]", "Host Alpha");
      await p.fill("#form-mission [name=customer]", "Cust New");
      await p.fill("#form-mission [name=engineer]", "Eng One");
      await p.click("#btn-mission-add-host");
      await p.locator("#mission-more-hosts .mh-input").last().fill("Host Beta");
      await p.click("#btn-mission-add-host");
      await p.locator("#mission-more-hosts .mh-input").last().fill("Host Gamma");
      await p.locator("#mission-more-hosts .mh-remove").last().click();   // a row taken out again
      await p.click("#form-mission button[type=submit]");
      await cards(p, NEWM).first().waitFor();
      assert.deepEqual(cardsOf(NEWM, SRC).map((m) => m.host), ["Host Alpha"], "one card, at the host typed");
      const reg = db.t("mission_register").find((r) => r.number === NEWM);
      assert.deepEqual(reg.hosts, ["Host Alpha", "Host Beta"], "the Missions list row keeps both hosts");
      await goMissions(p);
      assert.match(await row(p, NEWM).locator(".ml-hosts-more").innerText(), /\+1/);
      assert.equal(await row(p, SINGLE).locator(".ml-hosts-more").count(), 0, "a single-host mission shows no +N");
    });

    await step("an unknown host in the other-hosts rows is refused with the way out", async () => {
      await goDay(p);
      await p.evaluate(() => openMissionModal(null));
      await p.locator("#modal-mission:not(.hidden)").waitFor();
      await p.fill("#form-mission [name=number]", `TSTTH.${YY}.0330`);
      await p.fill("#form-mission [name=host]", "Host Alpha");
      await p.fill("#form-mission [name=customer]", "Cust Odd");
      await p.fill("#form-mission [name=engineer]", "Eng One");
      await p.click("#btn-mission-add-host");
      await p.locator("#mission-more-hosts .mh-input").last().fill("Nowhere Plant");
      await p.click("#form-mission button[type=submit]");
      await p.locator(".toast", { hasText: `"Nowhere Plant" is not in the Host list` }).waitFor();
      assert.equal(db.t("missions").some((m) => m.number === `TSTTH.${YY}.0330`), false, "nothing saved");
      await p.evaluate(() => closeModal());
    });

    await step("carry over keeps the host and flags a mission with several hosts: Confirm host; a single-host mission is not flagged", async () => {
      await p.evaluate(([d, n]) => cloud.applyCarry("b1", d, n), [SRC, NEXT]);
      await goDay(p, NEXT);
      const flagged = cards(p, HM);
      await flagged.first().waitFor();
      assert.equal(await flagged.locator(".m-host-flag").count(), 1, "flagged");
      assert.match(await flagged.locator(".m-host-flag").innerText(), /confirm host[\s\S]*Host Alpha\?/i);
      assert.equal(cardsOf(HM, NEXT)[0].host, "Host Alpha", "carried at the host it was at");
      assert.equal(await cards(p, SINGLE).locator(".m-host-flag").count(), 0, "a single-host mission is not flagged");
      // the crew came across too
      assert.ok(db.t("assignments").some((x) => x.employee_id === "e6" && x.plan_date === NEXT), "the crew is carried");
      // confirm it at the other host
      await flagged.locator(".m-host-confirm").click();
      await p.locator("#modal-pick-host:not(.hidden)").waitFor();
      assert.equal(await p.locator("#pick-host-rows select").inputValue(), "Host Alpha", "the previous day's host is preselected");
      await p.selectOption("#pick-host-rows select", "Host Beta");
      await p.click("#btn-pick-host-go");
      await p.waitForFunction((n) => ![...document.querySelectorAll(".mission-card")].some((c) => c.querySelector(".m-number") && c.querySelector(".m-number").textContent === n && c.querySelector(".m-host-flag")), HM);
      assert.equal(cardsOf(HM, NEXT)[0].host, "Host Beta", "the host is changed");
      assert.equal(cardsOf(HM, NEXT)[0].host_unconfirmed, false, "and no longer asks");
      assert.ok(db.t("assignments").some((x) => x.employee_id === "e6" && x.plan_date === NEXT), "the crew stays");
    });

    await step("the same mission at the same host already on the day is refused when confirming", async () => {
      // a second card of HM on NEXT at Host Alpha, and the Beta card flagged again: confirming Beta -> Alpha is refused
      db.seed("missions", [{ id: "hm-extra", board_id: "b1", plan_date: NEXT, number: HM, host: "Host Alpha", customer: "Cust Multi", shift: "day", engineer_id: "eng-1" }]);
      db.t("missions").find((m) => m.plan_date === NEXT && m.number === HM && m.host === "Host Beta").host_unconfirmed = true;
      await goDay(p, NEXT);
      await cards(p, HM).first().waitFor();
      assert.equal(await cards(p, HM).count(), 2, "two cards of one mission");
      await p.locator(".m-host-confirm").first().click();
      await p.locator("#modal-pick-host:not(.hidden)").waitFor();
      await p.selectOption("#pick-host-rows select", "Host Alpha");
      await p.click("#btn-pick-host-go");
      await p.locator(".toast", { hasText: /is already on the board at Host Alpha on this day/ }).waitFor();
      assert.equal(cardsOf(HM, NEXT).filter((m) => m.host === "Host Alpha").length, 1, "nothing changed");
    });

    await step("Add to board asks which host; the same host twice is refused with an alert; another host is a second card", async () => {
      await goMissions(p);
      await p.evaluate((n) => openMissionAddModal(D().register.find((r) => r.number === n)), HN);
      await p.locator("#modal-mission-add:not(.hidden)").waitFor();
      assert.equal(await p.locator("#mission-add-host-row").isVisible(), true, "a mission with two hosts asks");
      assert.deepEqual(await p.locator("#mission-add-host option").allInnerTexts(), ["Host Alpha", "Host Beta"]);
      const date = await p.inputValue("#mission-add-date");
      await p.selectOption("#mission-add-host", "Host Beta");
      await p.click("#form-mission-add button[type=submit]");
      await p.locator(".toast", { hasText: "at Host Beta" }).waitFor();
      assert.deepEqual(cardsOf(HN, date).map((m) => m.host), ["Host Beta"]);
      // the same host again: refused, an alert
      await p.evaluate((n) => openMissionAddModal(D().register.find((r) => r.number === n)), HN);
      await p.locator("#modal-mission-add:not(.hidden)").waitFor();
      await p.fill("#mission-add-date", date);
      await p.selectOption("#mission-add-host", "Host Beta");
      await p.click("#form-mission-add button[type=submit]");
      await p.locator(".toast", { hasText: /is already on Board One on .* at Host Beta/ }).waitFor();
      assert.equal(cardsOf(HN, date).length, 1, "not added twice");
      // another host the same day: a second card of the same mission
      await p.evaluate((n) => openMissionAddModal(D().register.find((r) => r.number === n)), HN);
      await p.locator("#modal-mission-add:not(.hidden)").waitFor();
      await p.fill("#mission-add-date", date);
      await p.selectOption("#mission-add-host", "Host Alpha");
      await p.click("#form-mission-add button[type=submit]");
      await p.locator(".toast", { hasText: "at Host Alpha" }).waitFor();
      assert.deepEqual(cardsOf(HN, date).map((m) => m.host).sort(), ["Host Alpha", "Host Beta"], "two cards of one mission on one day");
      await goDay(p, date);
      assert.equal(await cards(p, HN).count(), 2, "both cards are on the board");
    });

    await step("a single-host mission is added without a question", async () => {
      db.seed("mission_register", [{ board_id: "b1", number: `TSTTH.${YY}.0340`, shift: "day", host: "Host Gamma", customer: "Cust One", status: "open", source: "list",
        hosts: [], opened_on: SRC, last_on: null, start_time: "08:00:00", end_time: "17:00:00", engineer_id: "eng-1" }]);
      await p.evaluate(() => cloud.loadMissionRegister());
      await p.evaluate((n) => openMissionAddModal(D().register.find((r) => r.number === n)), `TSTTH.${YY}.0340`);
      await p.locator("#modal-mission-add:not(.hidden)").waitFor();
      assert.equal(await p.locator("#mission-add-host-row").isVisible(), false);
      await p.evaluate(() => closeModal());
    });

    await step("Start from the Missions list on an empty day asks the host of each mission that has several, and only those", async () => {
      const MULTI = `TSTTH.${YY}.0350`, ONE = `TSTTH.${YY}.0351`;
      db.seed("mission_register", [
        { board_id: "b2", number: MULTI, shift: "day", host: "Host Alpha", customer: "Cust Two", status: "open", source: "list", hosts: ["Host Alpha", "Host Beta"], opened_on: SRC, last_on: null, start_time: "08:00:00", end_time: "17:00:00", engineer_id: "eng-2" },
        { board_id: "b2", number: ONE, shift: "day", host: "Host Gamma", customer: "Cust One", status: "open", source: "list", hosts: [], opened_on: SRC, last_on: null, start_time: "08:00:00", end_time: "17:00:00", engineer_id: "eng-2" },
      ]);
      await p.evaluate(() => cloud.loadMissionRegister());
      await goDay(p, SRC, "b2");
      await p.evaluate(() => startDayFromRegister());
      await p.locator("#modal-pick-host:not(.hidden)").waitFor();
      assert.equal(await p.locator("#pick-host-rows select").count(), 1, "one question: the single-host mission needs none");
      assert.match(await p.locator("#pick-host-rows .ph-what").innerText(), new RegExp(MULTI.replace(/\./g, "\\.")));
      assert.deepEqual(await p.locator("#pick-host-rows option").allInnerTexts(), ["Host Alpha", "Host Beta"]);
      await p.selectOption("#pick-host-rows select", "Host Beta");
      await p.click("#btn-pick-host-go");
      await p.locator(".toast", { hasText: "Added 2 missions from the Missions list" }).waitFor();
      const onB2 = db.t("missions").filter((m) => m.board_id === "b2" && m.plan_date === SRC);
      assert.deepEqual(onB2.map((m) => m.number + "@" + m.host).sort(), [`${MULTI}@Host Beta`, `${ONE}@Host Gamma`].sort());
    });

    await step("the host rows and the chip are in Thai", async () => {
      const th = await p.evaluate(() => { I18N.setLang("th"); const r = [I18N.t("Confirm host"), I18N.t("Also at (other hosts of this mission)"), I18N.t("+ Add another host"), I18N.t("Which host?")]; I18N.setLang("en"); return r; });
      for (const s of th) assert.match(s, /[฀-๿]/, "translated: " + s);
    });

    await step("a database without the migration: no other-hosts rows, no question, and the old duplicate rule", async () => {
      const old = seed({ missionHosts: false });
      const o = await env.openAs(old, h.USERS.a);
      await goDay(o.page);
      await o.page.evaluate(() => openMissionModal(null));
      await o.page.locator("#modal-mission:not(.hidden)").waitFor();
      assert.equal(await o.page.locator("#mission-more-hosts-row").isVisible(), false, "no other-hosts block");
      await o.page.fill("#form-mission [name=number]", SINGLE);
      await o.page.fill("#form-mission [name=host]", "Host Alpha");
      await o.page.fill("#form-mission [name=customer]", "Cust Other");
      await o.page.fill("#form-mission [name=engineer]", "Eng One");
      await o.page.click("#form-mission button[type=submit]");
      await o.page.locator(".toast", { hasText: `A mission "${SINGLE}" already exists on the Day shift for this date` }).waitFor();
      assert.equal(old.t("missions").filter((m) => m.number === SINGLE).length, 1, "the old rule: one card per number and shift");
      await o.page.evaluate(() => closeModal());
      // carry over writes no flag and works with the old key
      await o.page.evaluate(([d, n]) => cloud.applyCarry("b1", d, n), [SRC, NEXT]);
      assert.ok(old.t("missions").some((m) => m.number === HM && m.plan_date === NEXT), "carried with the old key");
      await o.close();
    });

    assert.deepEqual(a.errors, [], "page errors");
    console.log("ALL MISSION HOSTS CHECKS PASSED");
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await env.close();
  }
})();
