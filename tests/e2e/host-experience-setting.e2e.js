/* Acceptance run for Settings -> Host experience: the number of days at a host that make someone
   "experienced" (migration-2026-11-09b, app_settings), driving the real app in Chromium against the
   shared fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/host-experience-setting.e2e.js
   Checked: 5 days until somebody changes it; the section is in Settings for a role that may edit
   Settings and absent for one that may not; the box is a draft written by Save changes (and Enter);
   whole numbers 1-365 only; the new value drives the Host tab's Skills matrix, Overview's Host
   coverage and a person's host list; a second signed-in person sees the change live; the database
   refuses a write from a role without Edit on Settings; on a database that has not run the
   migration the app keeps 5 and says why the box is locked; Thai reads in Thai. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 30).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const today = h.iso(new Date());
    const src = h.isWeekend(today) ? h.prevWorking(today) : today;
    const makeDb = (opts) => {
      const db = new h.FakeDb(opts);
      h.seedBase(db, { src });
      // who worked which host, for how many days (one row per person per day)
      const dh = [];
      let off = 30;
      const days = (e, host, n) => { for (let i = 0; i < n; i++) dh.push({ employee_id: e, plan_date: h.addDays(today, -(off++)), mission_number: "9", host, customer: "Cust Alpha", board_id: "b1" }); };
      days("e1", "Host Alpha", 8); days("e2", "Host Alpha", 6); days("e3", "Host Alpha", 5);   // 3 at 5 days, 2 at 6, 1 at 7-8
      days("e1", "Host Beta", 5); days("e2", "Host Beta", 4);                                 // 1 at 5 days, 2 at 3-4
      db.seed("deployment_history", dh);
      return db;
    };
    const db = makeDb();

    const a = await env.openAs(db, h.USERS.a);   // an Engineer: may edit Settings
    const p = a.page;
    const read = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.replace(/\s+/g, " ").trim()), sel);
    const openSettings = async () => { await p.click("#btn-avatar"); await p.click("#btn-settings"); await p.waitForSelector("#settings-view:not(.hidden)"); };
    const tab = async (t) => { await p.click(`#settings-tabs [data-tab=${t}]`); await p.waitForFunction((x) => state.settingsTab === x, t); };
    const backToBoard = async () => { await p.click("#btn-settings-back"); await p.waitForSelector("#settings-view", { state: "hidden" }); };
    const matrix = async (page) => {
      await page.evaluate(() => { state.hostlist.view = "matrix"; D().activeBoardId = HOSTLIST_ID; return refreshAndRender(); });
      await page.waitForSelector("#hostlist-matrix-wrap:not(.hidden) .mx-row");
      return page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".mx-row")].map((tr) => [tr.dataset.host, { risk: tr.classList.contains("is-risk"), exp: tr.cells[2].textContent.replace(/\s+/g, " ").trim() }])));
    };
    const type = async (v) => { await p.fill("#hostexp-days", v); };
    const save = async () => { await p.click("#btn-sv-save"); };

    await step("until somebody changes it, 5 days make someone experienced", async () => {
      assert.equal(await p.evaluate(() => hostExperiencedDays()), 5);
      const m = await matrix(p);
      assert.equal(m["Host Alpha"].exp, "3", "8, 6 and 5 days are all 5 or more");
      assert.equal(m["Host Alpha"].risk, false);
      assert.equal(m["Host Beta"].exp, "1");
      assert.equal(m["Host Beta"].risk, true);
    });

    await step("Settings has a Host experience section showing 5, with nothing waiting to save", async () => {
      await openSettings();
      await tab("hostexp");
      assert.equal(await p.locator("#sv-title").innerText(), "Host experience");
      assert.equal(await p.inputValue("#hostexp-days"), "5");
      assert.match(await p.locator("#hostexp-note").innerText(), /once they have worked 5 or more days there/);
      assert.equal(await p.locator("#btn-sv-save").isVisible(), false);
      assert.equal(await p.locator("#hostexp-migrate").isVisible(), false);
    });

    await step("typing is a draft: nothing is written until Save changes, and Discard puts 5 back", async () => {
      await type("6");
      assert.match(await p.locator("#sv-status").innerText(), /Unsaved changes \(1\)/);
      assert.equal(db.t("app_settings").length, 0, "nothing written yet");
      assert.equal(await p.evaluate(() => hostExperiencedDays()), 5);
      await p.click("#btn-sv-discard");
      assert.equal(await p.inputValue("#hostexp-days"), "5");
      assert.equal(await p.locator("#btn-sv-save").isVisible(), false);
    });

    await step("only whole numbers from 1 to 365 are accepted", async () => {
      for (const bad of ["0", "366", "5.5", "-2", ""]) {
        await type(bad);
        assert.equal(await p.getAttribute("#hostexp-days", "aria-invalid"), "true", `"${bad}" is flagged as you type`);
        assert.match(await p.locator("#hostexp-note").innerText(), /Enter a whole number from 1 to 365/);
        await save();
        await p.waitForFunction(() => /whole number from 1 to 365/.test(document.querySelector("#sv-status").textContent));
        assert.equal(db.t("app_settings").length, 0, `"${bad}" was not written`);
      }
      for (const good of ["1", "365"]) {
        await type(good);
        assert.equal(await p.getAttribute("#hostexp-days", "aria-invalid"), "false");
      }
      await p.click("#btn-sv-discard");
    });

    // a second person, signed in at the same time, to see the change arrive live
    const b = await env.openAs(db, h.USERS.b);
    const pb = b.page;
    await matrix(pb);

    await step("Save changes writes it for everyone: 6 days", async () => {
      await type("6");
      await save();
      await p.waitForFunction(() => /All changes saved/.test(document.querySelector("#sv-status").textContent));
      const rows = db.t("app_settings");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].key, "host_experienced_days");
      assert.equal(rows[0].value, 6);
      assert.equal(rows[0].updated_by, "eng.a@example.com", "who changed it is recorded");
      assert.equal(await p.evaluate(() => hostExperiencedDays()), 6);
      assert.equal(await p.locator("#btn-sv-save").isVisible(), false, "the draft is gone once saved");
      assert.match(await p.locator("#hostexp-note").innerText(), /6 or more days/);
    });

    await step("the Skills matrix follows: Alpha now has 2 experienced and is at risk; Beta has none", async () => {
      await backToBoard();
      const m = await matrix(p);
      assert.equal(m["Host Alpha"].exp, "2");
      assert.equal(m["Host Alpha"].risk, true);
      assert.equal(m["Host Beta"].exp, "0");
      const detail = await p.evaluate(() => { document.querySelector('.mx-row[data-host="Host Alpha"] .mx-host').click(); return [...document.querySelectorAll(".mx-people tbody tr")].map((tr) => [tr.cells[0].textContent.trim(), tr.cells[1].textContent.trim(), tr.cells[3].textContent.trim()]); });
      assert.deepEqual(detail, [["Person A", "8", "experienced"], ["Person B", "6", "experienced"], ["Person C", "5", ""]], "the tag follows the setting, person by person");
      assert.match(await p.locator('.mx-row[data-host="Host Alpha"] .ov-flag-bad').getAttribute("title"), /\(6\+ days\)/);
    });

    await step("a second signed-in person sees the new value live, without reloading", async () => {
      await pb.waitForFunction(() => hostExperiencedDays() === 6);
      const rows = await pb.evaluate(() => Object.fromEntries([...document.querySelectorAll(".mx-row")].map((tr) => [tr.dataset.host, tr.cells[2].textContent.replace(/\s+/g, " ").trim()])));
      assert.equal(rows["Host Alpha"], "2");
    });

    await step("Overview's Host coverage heading names the new days", async () => {
      const wording = await p.evaluate(async ([day]) => { state.date = day; D().activeBoardId = OVERVIEW_ID; state.overview.hostCoverageCacheKey = null; await refreshAndRender(); return document.querySelector("#ov-body, main, body").innerText; }, [src]);
      assert.match(wording, /experienced \(6\+ days there\)/, "the Host coverage heading names the days");
    });

    await step("Enter in the box saves it, and lowering it works: 3 days makes Beta's two people experienced", async () => {
      await openSettings();
      await tab("hostexp");
      await type("3");
      await p.press("#hostexp-days", "Enter");
      await p.waitForFunction(() => /All changes saved/.test(document.querySelector("#sv-status").textContent));
      assert.equal(db.t("app_settings")[0].value, 3);
      assert.equal(db.t("app_settings").length, 1, "the same row is updated, not a second one added");
      await backToBoard();
      const m = await matrix(p);
      assert.equal(m["Host Beta"].exp, "2");
    });

    await step("someone who may not edit Settings has no such section, and the database refuses them too", async () => {
      const v = await env.openAs(db, h.USERS.v);
      await v.page.click("#btn-avatar");
      await v.page.click("#btn-settings");
      await v.page.waitForSelector("#settings-view:not(.hidden)");
      assert.equal(await v.page.locator('#settings-tabs [data-tab=hostexp]').isVisible(), false);
      const refused = await v.page.evaluate(async () => { try { await cloud.saveHostExperiencedDays(9); return "saved"; } catch (e) { return e.message; } });
      assert.match(refused, /row-level security/);
      assert.equal(db.t("app_settings")[0].value, 3, "unchanged");
    });

    await step("a value outside 1-365 is refused by the database even if the app were bypassed", async () => {
      const res = await db.exec({ op: "upsert", table: "app_settings", values: { key: "host_experienced_days", value: 0 }, onConflict: "key" }, h.USERS.a);
      assert.equal(res.error && res.error.code, "23514");
      const res2 = await db.exec({ op: "upsert", table: "app_settings", values: { key: "host_experienced_days", value: 2.5 }, onConflict: "key" }, h.USERS.a);
      assert.equal(res2.error && res2.error.code, "23514");
      assert.equal(db.t("app_settings")[0].value, 3);
    });

    await step("on Thai the section reads in Thai", async () => {
      await p.evaluate(() => I18N.setLang("th"));
      await openSettings();
      await tab("hostexp");
      await p.waitForTimeout(400);
      const english = (xs) => xs.filter((x) => /[A-Za-z]{3}/.test(x.replace(/supabase\/migration-[\w-]+\.sql|Supabase SQL Editor/g, "")));
      assert.deepEqual(english(await read("#sv-head, #sv-title, #sv-hint, .settings-pane[data-pane=hostexp]")), [], "the section in Thai");
      assert.deepEqual(english(await read("#settings-tabs .settings-tab")), [], "the rail in Thai");
      await p.evaluate(() => I18N.setLang("en"));
      await backToBoard();
    });

    await step("a database without the migration keeps 5 and says why the box is locked", async () => {
      const old = makeDb({ appSettings: false });
      const o = await env.openAs(old, h.USERS.a);
      assert.equal(await o.page.evaluate(() => hostExperiencedDays()), 5);
      await o.page.click("#btn-avatar");
      await o.page.click("#btn-settings");
      await o.page.waitForSelector("#settings-view:not(.hidden)");
      await o.page.click("#settings-tabs [data-tab=hostexp]");
      assert.equal(await o.page.isDisabled("#hostexp-days"), true);
      assert.equal(await o.page.locator("#hostexp-migrate").isVisible(), true);
      assert.match(await o.page.locator("#hostexp-migrate").innerText(), /migration-2026-11-09b-app-settings\.sql/);
      assert.deepEqual(o.errors, [], "no console errors on the old database");
    });

    assert.deepEqual(a.errors, [], "no console errors");
    assert.deepEqual(b.errors, [], "no console errors for the second person");
    console.log("all host-experience-setting checks passed");
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
    if (failed) process.exit(1);
  }
})();
