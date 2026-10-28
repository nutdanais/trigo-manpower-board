/* Acceptance run for highlighting a mission: the card's right-click →
   Highlight › New customer / Focus activity / Other… / Remove highlight, the
   gold frame and the tag on the card, what does not copy it, who gets the menu
   item, Thai, and a database without migration-2026-10-28. Real app in
   Chromium against the shared fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/mission-highlight.e2e.js
   Seed: harness.seedBase (Board One: 101 day with A and B, 102 day with C, 103
   night with D). Exits non-zero on the first failed check. */
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
    const menu = p.locator("#context-menu");
    const item = (label) => menu.locator(".ctx-item", { hasText: new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    const menuLabels = async () => (await menu.locator(".ctx-item").allInnerTexts()).map((s) => s.trim());
    const rightClick = async (num) => { await card(num).locator(".mission-header .m-line2").click({ button: "right" }); await menu.waitFor(); };
    const openHighlight = async (num) => { await rightClick(num); await item("Highlight").click(); };
    const row = (id) => db.t("missions").find((m) => m.id === id);
    const tag = (num, pg = p) => card(num, pg).locator(".m-hl-tag");

    await step("a card starts plain: no frame, no tag", async () => {
      assert.equal(await card("101").evaluate((el) => el.classList.contains("hl")), false);
      assert.equal(await tag("101").count(), 0);
    });

    await step("Highlight sits after Crew and opens its own submenu", async () => {
      await rightClick("101");
      const labels = await menuLabels();
      assert.equal(labels[labels.indexOf("Crew") + 1], "Highlight");
      await item("Highlight").click();
      assert.deepEqual(await menuLabels(), ["Highlight", "New customer", "Focus activity", "Other…"]);
      await p.keyboard.press("Escape");
    });

    await step("New customer: saved on the mission, gold frame and a tag on the card", async () => {
      await openHighlight("101");
      await item("New customer").click();
      await tag("101").waitFor();
      assert.equal(row("s101").highlight, "new");
      assert.equal(row("s101").highlight_note, null);
      assert.equal(await tag("101").innerText(), "New customer");
      const look = await card("101").evaluate((el) => {
        const cs = getComputedStyle(el);
        return { left: cs.borderLeftColor, bottom: cs.borderBottomColor, top: cs.borderTopColor, width: cs.borderLeftWidth, shadow: cs.boxShadow };
      });
      assert.equal(look.left, "rgb(227, 160, 8)");
      assert.equal(look.bottom, "rgb(227, 160, 8)");
      assert.equal(look.width, "2px");
      assert.notEqual(look.top, "rgb(227, 160, 8)", "the top edge keeps the engineer's colour");
      assert.match(look.shadow, /rgba\(227, 160, 8, 0\.3\)/);
      // the other cards are untouched
      assert.equal(await card("102").evaluate((el) => el.classList.contains("hl")), false);
    });

    await step("the submenu ticks the current reason and offers Remove highlight", async () => {
      await openHighlight("101");
      assert.deepEqual(await menuLabels(), ["Highlight", "New customer", "Focus activity", "Other…", "Remove highlight"]);
      assert.equal(await item("New customer").evaluate((el) => el.classList.contains("ctx-on")), true);
      assert.equal(await item("Focus activity").evaluate((el) => el.classList.contains("ctx-on")), false);
      await item("Focus activity").click();
      await p.waitForFunction(() => document.querySelector(".mission-card.hl .m-hl-text")?.textContent === "Focus activity");
      assert.equal(row("s101").highlight, "focus");
    });

    await step("a night card gets the same frame and tag", async () => {
      await openHighlight("103");
      await item("New customer").click();
      await tag("103").waitFor();
      assert.equal(await card("103").evaluate((el) => el.classList.contains("night") && el.classList.contains("hl")), true);
    });

    await step("Other… asks why, refuses an empty note, and shows the note on the card", async () => {
      await openHighlight("102");
      await item("Other…").click();
      const dlg = p.locator("#modal-highlight:not(.hidden)");
      await dlg.waitFor();
      assert.equal(await p.locator("#highlight-sub").innerText(), "102");
      assert.equal(await p.getAttribute("#form-highlight [name=note]", "maxlength"), "40");
      await p.click("#form-highlight button[type=submit]");
      assert.equal(await p.locator("#highlight-error").isVisible(), true);
      assert.equal(row("s102").highlight ?? null, null, "nothing saved yet");
      await p.fill("#form-highlight [name=note]", "  VIP visit  ");
      await p.click("#form-highlight button[type=submit]");
      await tag("102").waitFor();
      assert.equal(row("s102").highlight, "other");
      assert.equal(row("s102").highlight_note, "VIP visit");
      assert.equal(await tag("102").innerText(), "VIP visit");
      assert.equal(await dlg.count(), 0);
    });

    await step("Other… on a card that has a note opens with it filled in", async () => {
      await openHighlight("102");
      assert.equal(await item("Other…").evaluate((el) => el.classList.contains("ctx-on")), true);
      await item("Other…").click();
      await p.locator("#modal-highlight:not(.hidden)").waitFor();
      assert.equal(await p.inputValue("#form-highlight [name=note]"), "VIP visit");
      await p.keyboard.press("Escape");
      assert.equal(row("s102").highlight_note, "VIP visit", "Cancel changes nothing");
    });

    await step("Remove highlight clears it", async () => {
      await openHighlight("103");
      await item("Remove highlight").click();
      await tag("103").waitFor({ state: "detached" });
      assert.equal(row("s103").highlight, null);
      assert.equal(await card("103").evaluate((el) => el.classList.contains("hl")), false);
    });

    await step("editing the mission keeps its highlight", async () => {
      await card("101").locator(".mission-header .m-line2").click();
      await p.locator("#modal-mission:not(.hidden)").waitFor();
      await p.fill("#form-mission [name=ppe]", "Hard hat");
      await p.click("#form-mission button[type=submit]");
      await p.locator("#modal-mission").waitFor({ state: "hidden" });
      await card("101").locator(".m-ppe").waitFor();
      assert.equal(row("s101").highlight, "focus");
      assert.equal(await tag("101").innerText(), "Focus activity");
    });

    await step("Duplicate mission leaves the highlight behind", async () => {
      await rightClick("102");
      await item("Duplicate mission").click();
      await p.locator("#modal-mission:not(.hidden)").waitFor();
      await p.fill("#form-mission [name=number]", "102B");
      await p.click("#form-mission button[type=submit]");
      await card("102B").waitFor();
      assert.equal(db.t("missions").find((m) => m.number === "102B").highlight ?? null, null);
      assert.equal(await tag("102B").count(), 0);
    });

    await step("Carry over to the next day starts it plain", async () => {
      await p.evaluate(([s, d]) => cloud.applyCarry("b1", s, d), [SRC, NEXT]);
      const carried = db.t("missions").filter((m) => m.plan_date === NEXT && m.board_id === "b1");
      assert.ok(carried.some((m) => m.number === "101"), "101 was carried");
      assert.deepEqual(carried.filter((m) => m.highlight).map((m) => m.number), []);
    });

    await step("a viewer sees the highlight, but no Highlight in the menu", async () => {
      const v = await env.openAs(db, h.USERS.v);
      await openDay(v.page, SRC);
      await tag("101", v.page).waitFor();
      assert.equal(await tag("102", v.page).innerText(), "VIP visit");
      await card("101", v.page).locator(".mission-header .m-line2").click({ button: "right" });
      const labels = (await v.page.locator("#context-menu .ctx-item").allInnerTexts()).map((s) => s.trim());
      assert.deepEqual(labels, ["Copy as text", "Open host location"]);
      assert.deepEqual(v.errors, []);
      await v.close();
    });

    await step("Filter & sort › Highlighted only fades the rest and puts highlighted cards first", async () => {
      await p.click("#btn-filter-pop");
      await p.locator("#filter-pop:not(.hidden)").waitFor();
      assert.equal(await p.locator("#filter-hl").isVisible(), true);
      assert.equal(await p.isChecked("#filter-hl-box"), false);
      await p.click("#filter-hl");
      assert.equal(await p.isChecked("#filter-hl-box"), true);
      assert.equal(await p.locator("#filter-pop").isVisible(), true, "the popover stays open");
      const dim = (num) => card(num).evaluate((el) => el.classList.contains("dimmed"));
      assert.equal(await dim("101"), false);
      assert.equal(await dim("102"), false);
      assert.equal(await dim("103"), true);
      assert.equal(await dim("102B"), true);
      assert.equal(await p.locator("#filter-count").innerText(), "1");
      const order = await p.locator("#missions-grid .mission-card .m-number").allInnerTexts();
      assert.deepEqual(order.slice(0, 2).sort(), ["101", "102"]);
      await p.click("#filter-hl");
      assert.equal(await dim("103"), false);
      assert.equal(await p.locator("#filter-count").isVisible(), false);
      await p.keyboard.press("Escape");
    });

    await step("clearing every filter turns Highlighted only off too", async () => {
      await p.evaluate(() => { state.filters.highlight = ["on"]; renderFilterOptions(); renderMissions(); });
      assert.equal(await p.isChecked("#filter-hl-box"), true);
      await p.evaluate(() => clearViewFilters());
      assert.equal(await p.isChecked("#filter-hl-box"), false);
      assert.deepEqual(await p.evaluate(() => state.filters.highlight), []);
      assert.equal(await card("103").evaluate((el) => el.classList.contains("dimmed")), false);
    });

    await step("in Thai: the submenu, the dialog and the tag are Thai; a typed note stays as typed", async () => {
      await p.evaluate(() => I18N.setLang("th"));
      await card("101").locator(".mission-header .m-line2").click({ button: "right" });
      await menu.waitFor();
      await menu.locator(".ctx-sub", { hasText: "ไฮไลต์" }).click();
      const sub = (await menuLabels()).join("|");
      assert.equal(sub, "ไฮไลต์|ลูกค้าใหม่|งานที่ต้องเน้น|อื่นๆ…|เอาไฮไลต์ออก");
      await menu.locator(".ctx-item", { hasText: "อื่นๆ…" }).click();
      await p.locator("#modal-highlight:not(.hidden)").waitFor();
      const shown = await p.evaluate(() => {
        const el = document.querySelector("#modal-highlight");
        const attrs = [...el.querySelectorAll("[title],[aria-label],[placeholder]")].map((x) => [x.title, x.getAttribute("aria-label"), x.placeholder].join(" "));
        return el.innerText + "\n" + attrs.join("\n");
      });
      // the mission number and "VIP" (in the Thai example) are the only Latin letters
      assert.deepEqual((shown.replace(/VIP|null|undefined/g, "").match(/[A-Za-z]{2,}/g) || []), []);
      await p.keyboard.press("Escape");
      assert.equal(await tag("101").innerText(), "งานที่ต้องเน้น");
      assert.equal((await p.locator("#filter-hl .filter-hl-text").textContent()).trim(), "เฉพาะที่ไฮไลต์");
      assert.equal(await tag("102").innerText(), "VIP visit");
      await p.evaluate(() => I18N.setLang("en"));
    });

    await step("no page errors", async () => {
      assert.deepEqual(a.errors, []);
    });

    await step("a database without migration-2026-10-28: the board works, no Highlight offered", async () => {
      const old = new h.FakeDb({ highlight: false });
      h.seedBase(old, { src: SRC });
      const o = await env.openAs(old, h.USERS.a);
      await openDay(o.page, SRC);
      await card("101", o.page).waitFor();
      await card("101", o.page).locator(".mission-header .m-line2").click({ button: "right" });
      const labels = (await o.page.locator("#context-menu .ctx-item").allInnerTexts()).map((s) => s.trim());
      assert.equal(labels.includes("Highlight"), false);
      assert.equal(labels.includes("Crew"), true);
      await o.page.keyboard.press("Escape");
      assert.equal(await o.page.locator("#filter-hl").evaluate((el) => el.classList.contains("hidden")), true, "no Highlighted only switch");
      // the probe's failed read is expected; nothing else may go wrong
      assert.deepEqual(o.errors.filter((e) => !/highlight/.test(e)), []);
      await o.close();
    });
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
})();
