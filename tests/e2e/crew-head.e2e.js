/* Acceptance run for the Leader of a mission's crew: right-click a person on a
   mission → Make Leader / Make Leader (replaces …) / Remove as Leader,
   the teal crown badge on their card, the head first in the crew, one head per
   mission, the head cleared when they leave the mission, live sync to a second
   user, Carry over, who gets the menu item, Thai, the Org Chart (and its
   PowerPoint), and a database without
   migration-2026-11-16. Real app in Chromium against the shared fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/crew-head.e2e.js
   Seed: harness.seedBase (Board One: 101 day with A and B, 102 day with C, 103
   night with D, E on annual leave, F on Standby). Exits non-zero on the first
   failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
const NEXT = h.nextWorking(SRC);

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 5).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });

    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const openDay = (pg, d) => pg.evaluate((d) => { state.date = d; state.unlockedDates.add(d); return refreshAndRender(); }, d);
    await openDay(p, SRC);

    const card = (num, pg = p) => pg.locator("#missions-grid .mission-card", { has: pg.locator(".m-number", { hasText: new RegExp("^" + num + "$") }) });
    const person = (num, id, pg = p) => card(num, pg).locator(`.emp-card[data-emp-id="${id}"]`);
    const anywhere = (id, pg = p) => pg.locator(`.emp-card[data-emp-id="${id}"]`).first();
    const menu = p.locator("#context-menu");
    const menuLabels = async (pg = p) => (await pg.locator("#context-menu .ctx-item").allInnerTexts()).map((s) => s.trim());
    const item = (label) => menu.locator(".ctx-item", { hasText: new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    const rightClick = async (loc) => { await loc.click({ button: "right" }); await menu.waitFor(); };
    const lead = (id) => db.t("missions").find((m) => m.id === id).lead_employee_id ?? null;
    const crewOrder = (num, pg = p) => card(num, pg).locator(".emp-card").evaluateAll((els) => els.map((e) => e.dataset.empId));
    const badges = (pg = p) => pg.locator("#missions-grid .emp-card .emp-lead").count();

    await step("no mission starts with a head: no badge anywhere", async () => {
      assert.equal(await badges(), 0);
    });

    await step("a person on a mission gets Make Leader, right after Profile", async () => {
      await rightClick(person("101", "e2"));
      const labels = await menuLabels();
      assert.equal(labels[0], "Profile");
      assert.equal(labels[1], "Make Leader");
      await p.keyboard.press("Escape");
    });

    await step("Make Leader: saved on the mission, a teal crown badge, and they move to the front", async () => {
      assert.deepEqual(await crewOrder("101"), ["e1", "e2"]);
      await rightClick(person("101", "e2"));
      await item("Make Leader").click();
      await person("101", "e2").locator(".emp-lead").waitFor();
      assert.equal(lead("s101"), "e2");
      assert.deepEqual(await crewOrder("101"), ["e2", "e1"], "the head goes first");
      assert.equal(await badges(), 1);
      const look = await person("101", "e2").locator(".emp-lead").evaluate((el) => {
        const cs = getComputedStyle(el), r = el.getBoundingClientRect(), c = el.parentElement.getBoundingClientRect();
        return { bg: cs.backgroundColor, left: Math.round(r.left - c.left), top: Math.round(r.top - c.top), svg: !!el.querySelector("svg") };
      });
      assert.equal(look.bg, "rgb(15, 118, 110)");
      assert.ok(look.left < 0 && look.top < 0, "the badge hangs off the top-left corner");
      assert.equal(look.svg, true, "a crown icon");
      assert.match(await person("101", "e2").getAttribute("title"), /Leader/);
    });

    await step("the head's own menu offers Remove as Leader", async () => {
      await rightClick(person("101", "e2"));
      assert.equal((await menuLabels())[1], "Remove as Leader");
      await p.keyboard.press("Escape");
    });

    await step("one head per mission: a new head replaces the old one, and the menu says whom", async () => {
      await rightClick(person("101", "e1"));
      assert.equal((await menuLabels())[1], "Make Leader (replaces Person)");
      await item("Make Leader").click();
      await person("101", "e1").locator(".emp-lead").waitFor();
      assert.equal(lead("s101"), "e1");
      assert.equal(await person("101", "e2").locator(".emp-lead").count(), 0);
      assert.equal(await badges(), 1);
      assert.deepEqual(await crewOrder("101"), ["e1", "e2"]);
    });

    await step("another user's board shows the head and follows a change live", async () => {
      const b = await env.openAs(db, h.USERS.b);
      await openDay(b.page, SRC);
      await person("101", "e1", b.page).locator(".emp-lead").waitFor();
      await rightClick(person("101", "e2"));
      await item("Make Leader").click();
      await person("101", "e2", b.page).locator(".emp-lead").waitFor();
      assert.equal(await badges(b.page), 1);
      assert.deepEqual(b.errors, []);
      await b.close();
    });

    await step("Remove as Leader clears it", async () => {
      await rightClick(person("101", "e2"));
      await item("Remove as Leader").click();
      await person("101", "e2").locator(".emp-lead").waitFor({ state: "detached" });
      assert.equal(lead("s101"), null);
      assert.equal(await badges(), 0);
    });

    await step("moving the head to another mission clears the head", async () => {
      await rightClick(person("101", "e1"));
      await item("Make Leader").click();
      await person("101", "e1").locator(".emp-lead").waitFor();
      await rightClick(person("101", "e1"));
      await menu.locator(".ctx-sub", { hasText: "Assign to mission" }).click();
      await item("102").click();
      await person("102", "e1").waitFor();
      assert.equal(lead("s101"), null);
      assert.equal(lead("s102"), null, "they are not head of the new mission");
      assert.equal(await badges(), 0);
    });

    await step("sending the head back to Standby clears it", async () => {
      await rightClick(person("102", "e3"));
      await item("Make Leader").click();
      await person("102", "e3").locator(".emp-lead").waitFor();
      await rightClick(person("102", "e3"));
      await item("Return to Standby").click();
      await card("102").locator('.emp-card[data-emp-id="e3"]').waitFor({ state: "detached" });
      assert.equal(lead("s102"), null);
      assert.equal(await badges(), 0);
    });

    await step("Standby, leave and a multi-selection get no Make Leader", async () => {
      for (const id of ["e3", "e5"]) {
        await rightClick(anywhere(id));
        assert.equal((await menuLabels()).some((l) => /Leader/.test(l)), false, id);
        await p.keyboard.press("Escape");
      }
      await p.evaluate(() => { state.selectedEmps = new Set(["e1", "e2"]); markSelectedCards(); });
      await rightClick(person("101", "e2"));
      assert.equal((await menuLabels()).some((l) => /Leader/.test(l)), false, "two people selected");
      await p.keyboard.press("Escape");
      await p.evaluate(() => clearSelection());
    });

    await step("a night mission's head gets the same badge", async () => {
      await rightClick(person("103", "e4"));
      await item("Make Leader").click();
      await person("103", "e4").locator(".emp-lead").waitFor();
      assert.equal(await card("103").evaluate((el) => el.classList.contains("night")), true);
      assert.equal(lead("s103"), "e4");
    });

    await step("a head who is no longer on the crew is refused, and the board says why", async () => {
      // someone else's change has not reached this board yet: e3 is on Standby, not on 101
      await p.evaluate(() => setMissionLead(getPlan().missions.find((m) => m.number === "101"), D().employees.find((e) => e.id === "e3")));
      await p.locator(".toast", { hasText: "no longer on this mission's crew" }).waitFor();
      assert.equal(lead("s101"), null);
    });

    await step("Carry over brings the head across with the crew, and the preview agrees", async () => {
      const preview = await p.evaluate(([s, d]) => cloud.buildCarryPreview("b1", s, d), [SRC, NEXT]);
      assert.equal(preview.missions.find((m) => m.number === "103").leadId, "e4");
      assert.equal(preview.missions.find((m) => m.number === "101").leadId, null);
      await p.evaluate(([s, d]) => cloud.applyCarry("b1", s, d), [SRC, NEXT]);
      const carried = db.t("missions").filter((m) => m.plan_date === NEXT && m.board_id === "b1");
      assert.equal(carried.find((m) => m.number === "103").lead_employee_id, "e4");
      assert.equal(carried.find((m) => m.number === "101").lead_employee_id ?? null, null);
      await openDay(p, NEXT);
      await person("103", "e4").locator(".emp-lead").waitFor();
      await openDay(p, SRC);
    });

    await step("a viewer sees the badge, but no Make Leader", async () => {
      const v = await env.openAs(db, h.USERS.v);
      await openDay(v.page, SRC);
      await person("103", "e4", v.page).locator(".emp-lead").waitFor();
      await person("103", "e4", v.page).click({ button: "right" });
      await v.page.locator("#context-menu").waitFor();
      assert.equal((await menuLabels(v.page)).some((l) => /Leader/.test(l)), false);
      assert.deepEqual(v.errors, []);
      await v.close();
    });

    await step("in Thai: the menu items and the card's tooltip are Thai", async () => {
      await p.evaluate(() => I18N.setLang("th"));
      await rightClick(person("103", "e4"));
      assert.equal((await menuLabels())[1], "ยกเลิกหัวหน้าทีม");
      await p.keyboard.press("Escape");
      await rightClick(person("101", "e2"));
      assert.equal((await menuLabels())[1], "ตั้งเป็นหัวหน้าทีม");
      await p.keyboard.press("Escape");
      assert.match(await person("103", "e4").getAttribute("title"), /หัวหน้าทีม/);
      await p.evaluate(() => I18N.setLang("en"));
    });

    await step("the Org Chart marks the Leader: a teal Leader chip, the crown on their tile, first in the crew", async () => {
      // 101 gets a crew of two, B and C, with C (second by name) as its Leader
      await p.evaluate(async () => {
        await assignEmployeesTo(["e3"], { missionId: getPlan().missions.find((m) => m.number === "101").id });
        await setMissionLead(getPlan().missions.find((m) => m.number === "101"), D().employees.find((e) => e.id === "e3"));
      });
      assert.equal(lead("s101"), "e3");
      await p.click(".tab-orgchart");
      await p.waitForSelector("#oc-outline .oc-ol-row");
      await p.selectOption("#oc-level", "all");
      const row = (name) => p.locator("#oc-outline .oc-ol-row.l-employee", { hasText: name });
      await row("Person C").locator(".oc-chip.oc-lead").waitFor();
      assert.equal((await row("Person C").locator(".oc-chip.oc-lead").innerText()).trim(), "Leader");
      assert.equal(await row("Person C").locator(".oc-chip.oc-lead").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(15, 118, 110)");
      assert.equal(await row("Person C").locator(".oc-lead-badge").count(), 1, "the crown on the tile");
      assert.equal(await row("Person D").locator(".oc-chip.oc-lead").count(), 1, "the night mission's Leader too");
      assert.equal(await row("Person B").locator(".oc-chip.oc-lead, .oc-lead-badge").count(), 0);
      const names = await p.locator("#oc-outline .oc-ol-row.l-employee").allInnerTexts();
      const at = (n) => names.findIndex((t) => t.includes(n));
      assert.ok(at("Person C") < at("Person B"), "the Leader comes first in 101's crew");
      // the PowerPoint is built from the same tree: the Leader's line starts with Leader
      const pp = await p.evaluate(() => {
        const out = [];
        const walk = (n) => { if (n.type === "employee") out.push({ name: n.name, lead: n.lead, line: OrgPptx.cardText(n).line }); (n.children || []).forEach(walk); };
        orgPptxBoards().forEach(walk);
        return out;
      });
      assert.match(pp.find((x) => x.name.includes("Person C")).line, /^Leader · /);
      assert.equal(pp.find((x) => x.name.includes("Person B")).lead, false);
      await p.evaluate(() => I18N.setLang("th"));
      await p.waitForFunction(() => document.querySelector("#oc-outline .oc-chip.oc-lead")?.textContent.trim() === "หัวหน้าทีม");
      await p.evaluate(() => I18N.setLang("en"));
    });

    await step("no page errors", async () => {
      // the refused head above is a 400 from the fake database, on purpose
      assert.deepEqual(a.errors.filter((e) => !/missions_lead_on_crew|23514|400/.test(e)), []);
    });

    await step("a database without migration-2026-11-16: the board works, no Make Leader", async () => {
      const old = new h.FakeDb({ lead: false });
      h.seedBase(old, { src: SRC });
      const o = await env.openAs(old, h.USERS.a);
      await openDay(o.page, SRC);
      await person("101", "e1", o.page).click({ button: "right" });
      await o.page.locator("#context-menu").waitFor();
      const labels = await menuLabels(o.page);
      assert.equal(labels.includes("Profile"), true);
      assert.equal(labels.some((l) => /Leader/.test(l)), false);
      await o.page.keyboard.press("Escape");
      assert.equal(await badges(o.page), 0);
      // Carry over still works without the column
      await o.page.evaluate(([s, d]) => cloud.applyCarry("b1", s, d), [SRC, NEXT]);
      assert.ok(old.t("missions").some((m) => m.plan_date === NEXT && m.number === "101"));
      // the probe's failed read is expected; nothing else may go wrong
      assert.deepEqual(o.errors.filter((e) => !/lead_employee_id/.test(e)), []);
      await o.close();
    });
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
})();
