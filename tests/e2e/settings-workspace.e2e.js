/* Acceptance run for the Settings page (the "workspace": a full page under the top
   bar, not a dialog), driving the real app in Chromium against the shared fake
   backend.
     NODE_PATH=$(npm root -g) node tests/e2e/settings-workspace.e2e.js
   It covers: the page opening over the app and handing the board back untouched,
   the remembered section, drafts with Save / Discard, the unsaved-changes guard,
   a failed save keeping its draft and retrying, service areas / boards / engineers
   / roles end to end (the permission review included), the sections each role may
   open, focus handling in the dialogs over the page, the password form, and the
   phone layout. Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
const ADMIN = { id: "00000000-0000-0000-0000-0000000000ad", email: "admin.z@example.com", role: "admin" };
const MANAGER = { id: "00000000-0000-0000-0000-0000000000ae", email: "mgr.m@example.com", role: "manager" };

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 6).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  try {
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    db.seed("profiles", [
      { id: ADMIN.id, email: ADMIN.email, full_name: "Admin Z", display_name: "Admin.Z", role_key: "admin", status: "active" },
      { id: MANAGER.id, email: MANAGER.email, full_name: "Mgr M", display_name: "Mgr.M", role_key: "manager", status: "active" },
    ]);
    // Rename & delete boards is its own permission; the Users area is "view" for the manager
    db.seed("role_permissions", [{ role_key: "admin", area: "boarddelete", level: "edit" }]);
    db.t("role_permissions").find((r) => r.role_key === "manager" && r.area === "users").level = "view";
    // the profile RPC the app saves My account through (not part of the shared fake)
    db.rpcs.update_my_profile = (a, u) => {
      const row = db.t("profiles").find((x) => x.email === u.email);
      row.full_name = a.p_full_name;
      if (a.p_display_name != null) row.display_name = a.p_display_name;
      if (a.p_phone != null) row.phone = a.p_phone;
      return null;
    };
    const profile = (email) => db.t("profiles").find((x) => x.email === email);
    const perm = (role, area) => db.t("role_permissions").find((r) => r.role_key === role && r.area === area).level;

    const a = await env.openAs(db, ADMIN);
    const p = a.page;
    await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);
    const status = () => p.locator("#sv-status").innerText();
    const openSettings = async () => { await p.click("#btn-settings"); await p.waitForSelector("#settings-view:not(.hidden)"); };
    const tab = async (t) => { await p.click(`#settings-tabs [data-tab=${t}]`); await p.waitForFunction((x) => state.settingsTab === x, t); };
    const closeDialog = async () => { await p.keyboard.press("Escape"); await p.waitForSelector("#modal-backdrop", { state: "hidden" }); };

    await step("one navy: the top bar, the export header, the sidebar selection and the main buttons share it", async () => {
      const navy = await p.evaluate(() => {
        const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
        const probe = document.createElement("button"); probe.className = "btn btn-primary"; document.body.appendChild(probe);
        const button = getComputedStyle(probe).backgroundColor; probe.remove();   // a main button; New Mission is white-on-navy inside the deck
        return { top: bg("#topbar"), capture: bg("#capture-header"), button, token: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() };
      });
      assert.equal(navy.token, "#003a66");
      assert.deepEqual([navy.top, navy.capture, navy.button], ["rgb(0, 58, 102)", "rgb(0, 58, 102)", "rgb(0, 58, 102)"]);
      await openSettings();
      assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#settings-tabs .settings-tab.active")).backgroundColor), "rgb(0, 58, 102)");
      await p.click("#btn-settings-back");
    });

    await step("Settings opens as a page over the app and Back to board hands the board back untouched", async () => {
      await p.evaluate(() => { document.querySelector("#board-capture").style.minHeight = "3000px"; window.scrollTo(0, 320); });
      const before = await p.evaluate(() => ({ date: state.date, board: D().activeBoardId, y: Math.round(window.scrollY) }));
      assert.ok(before.y > 100, "the board should be scrolled for this check");
      await openSettings();
      assert.equal(await p.locator("#modal-backdrop").isVisible(), false, "a page, not a dialog");
      assert.equal(await p.locator("#board-capture").isVisible(), false);
      assert.equal(await p.locator("#toolbar").isVisible(), false);
      assert.equal(await p.evaluate(() => document.activeElement.id), "sv-title", "focus moves to the page heading");
      assert.equal(await p.evaluate(() => state.settingsTab), "account", "My account is where a first visit starts");
      await p.click("#btn-settings-back");
      await p.waitForSelector("#settings-view", { state: "hidden" });
      const after = await p.evaluate(() => ({ date: state.date, board: D().activeBoardId, y: Math.round(window.scrollY), focus: document.activeElement.id }));
      assert.equal(after.date, before.date);
      assert.equal(after.board, before.board);
      assert.ok(Math.abs(after.y - before.y) <= 2, `scroll ${before.y} -> ${after.y}`);
      assert.equal(after.focus, "btn-settings", "focus returns to the Settings button");
      assert.equal(await p.locator("#board-capture").isVisible(), true);
    });

    await step("the last section is remembered, and a section that is no longer allowed falls back to My account", async () => {
      await openSettings();
      await tab("boards");
      await p.click("#btn-settings-back");
      await openSettings();
      assert.equal(await p.evaluate(() => state.settingsTab), "boards");
      // lose the Settings area under an open page
      await p.evaluate(() => { D().perms.admin.settings = "none"; renderSettings(); });
      assert.equal(await p.evaluate(() => state.settingsTab), "account");
      assert.equal(await p.locator('#settings-tabs [data-tab=boards]').isVisible(), false);
      await p.evaluate(() => cloud._loadIdentity().then(() => renderSettings()));
      assert.equal(await p.locator('#settings-tabs [data-tab=boards]').isVisible(), true);
      await p.click("#btn-settings-back");
    });

    await step("My account: edits are a draft until Save; Discard puts the saved value back", async () => {
      await openSettings();
      await tab("account");
      assert.equal(await p.inputValue("#acct-display-name"), "Admin.Z");
      assert.match(await status(), /Changes apply when you save/);
      await p.fill("#acct-display-name", "Zed.A");
      assert.match(await status(), /Unsaved changes \(1\)/);
      assert.equal(await p.locator("#btn-sv-save").isVisible(), true);
      assert.equal(profile(ADMIN.email).display_name, "Admin.Z", "nothing is written before Save");
      await p.click("#btn-sv-discard");
      assert.equal(await p.inputValue("#acct-display-name"), "Admin.Z");
      assert.equal(await p.locator("#btn-sv-save").isVisible(), false);
      await p.fill("#acct-display-name", "Zed.A");
      await p.fill("#acct-phone", "081-234-5678");
      await p.click("#btn-sv-save");
      await p.waitForFunction(() => /All changes saved/.test(document.querySelector("#sv-status").textContent));
      assert.equal(profile(ADMIN.email).display_name, "Zed.A");
      assert.equal(profile(ADMIN.email).phone, "081-234-5678");
      assert.equal(profile(ADMIN.email).full_name, "Admin Z", "the full name goes back unchanged");
      assert.equal(await p.inputValue("#acct-display-name"), "Zed.A");
      assert.equal(await p.locator("#btn-sv-save").isVisible(), false);
    });

    await step("leaving with unsaved changes asks: keep editing, discard, or save and continue", async () => {
      await p.fill("#acct-phone", "090-000-0000");
      await p.click('#settings-tabs [data-tab=areas]');
      await p.waitForSelector("#modal-unsaved:not(.hidden)");
      assert.match(await p.locator("#unsaved-text").innerText(), /My account/);
      assert.equal(await p.evaluate(() => document.activeElement.closest(".modal").id), "modal-unsaved", "focus is inside the dialog");
      await p.click("#btn-unsaved-keep");
      assert.equal(await p.evaluate(() => state.settingsTab), "account");
      assert.equal(await p.inputValue("#acct-phone"), "090-000-0000", "the draft is kept");
      // Back to board is guarded the same way
      await p.click("#btn-settings-back");
      await p.waitForSelector("#modal-unsaved:not(.hidden)");
      await closeDialog();                         // Esc is "keep editing"
      assert.equal(await p.locator("#settings-view").isVisible(), true);
      // Discard moves on and drops the draft
      await p.click('#settings-tabs [data-tab=areas]');
      await p.click("#btn-unsaved-discard");
      await p.waitForFunction(() => state.settingsTab === "areas");
      await tab("account");
      assert.equal(await p.inputValue("#acct-phone"), "081-234-5678");
      // Save & continue writes, then moves
      await p.fill("#acct-phone", "090-000-0000");
      await p.click('#settings-tabs [data-tab=areas]');
      await p.click("#btn-unsaved-save");
      await p.waitForFunction(() => state.settingsTab === "areas");
      assert.equal(profile(ADMIN.email).phone, "090-000-0000");
    });

    await step("a dirty page also guards signing out", async () => {
      await tab("account");
      await p.fill("#acct-phone", "091-111-1111");
      await p.click("#btn-avatar");
      await p.click("#btn-signout");
      await p.waitForSelector("#modal-unsaved:not(.hidden)");
      await p.click("#btn-unsaved-keep");
      assert.equal(await p.locator("#settings-view").isVisible(), true, "still signed in");
      await p.click("#btn-sv-discard");
    });

    await step("Service areas: a named add form, edits staged and saved together, validation that keeps the draft", async () => {
      await tab("areas");
      await p.click("#btn-add-area");
      await p.waitForSelector("#modal-add-area:not(.hidden)");
      assert.equal(await p.evaluate(() => document.activeElement.name), "areaName", "focus goes to the name");
      await p.fill("#form-add-area [name=areaName]", "   ");   // (an empty box is stopped by the browser's own `required`)
      await p.click("#form-add-area button[type=submit]");
      assert.match(await p.locator("#add-area-error").innerText(), /name/i);
      await p.fill("#form-add-area [name=areaName]", "area1");
      await p.click("#form-add-area button[type=submit]");
      assert.match(await p.locator("#add-area-error").innerText(), /already/i);
      await p.fill("#form-add-area [name=areaName]", "Rayong");
      await p.fill("#form-add-area [name=areaColor]", "#ff0000");
      await p.click("#form-add-area button[type=submit]");
      await p.waitForSelector("#modal-backdrop", { state: "hidden" });
      const row = db.t("service_areas").find((r) => r.name === "Rayong");
      assert.ok(row, "created with its own name");
      assert.equal(row.color, "#ff0000", "and its own colour, in the same write");
      assert.equal(db.t("service_areas").some((r) => r.name === "New Area"), false, "no placeholder row");
      assert.equal(await p.locator("#settings-areas tr").count(), 2);

      const rayong = p.locator("#settings-areas tr", { has: p.locator('input[type=text]') }).nth(1);
      await rayong.locator('input[type=text]').fill("Rayong East");
      await rayong.locator('input[type=color]').fill("#00aa00");
      assert.match(await status(), /Unsaved changes \(2\)/);
      assert.equal(await rayong.evaluate((e) => e.classList.contains("st-dirty")), true, "the row is marked");
      assert.equal(db.t("service_areas").find((r) => r.id === row.id).name, "Rayong");
      // a blank name is refused on Save, says so, and keeps everything typed
      await rayong.locator('input[type=text]').fill("   ");
      await p.click("#btn-sv-save");
      await p.waitForFunction(() => /needs a name/i.test(document.querySelector("#sv-status").textContent));
      assert.equal(db.t("service_areas").find((r) => r.id === row.id).color, "#ff0000", "nothing was saved");
      assert.equal(await p.locator("#btn-sv-save").isVisible(), true);
      await rayong.locator('input[type=text]').fill("Rayong East");
      await p.click("#btn-sv-save");
      await p.waitForFunction(() => /All changes saved/.test(document.querySelector("#sv-status").textContent));
      const saved = db.t("service_areas").find((r) => r.id === row.id);
      assert.equal(saved.name, "Rayong East");
      assert.equal(saved.color, "#00aa00");
    });

    await step("a failed save keeps the draft, says what failed, and Retry sends it once", async () => {
      await p.evaluate(() => {
        window.__calls = 0;
        window.__orig = cloud.saveAreaField;
        cloud.saveAreaField = async () => { window.__calls++; throw new Error("network down"); };
      });
      const row = p.locator("#settings-areas tr").nth(1);
      await row.locator('input[type=text]').fill("Rayong West");
      await p.click("#btn-sv-save");
      await p.waitForFunction(() => /network down/.test(document.querySelector("#sv-status").textContent));
      assert.match(await status(), /Nothing was saved/);
      assert.match(await status(), /Retry/);
      assert.equal(await p.locator("#btn-sv-save").innerText(), "Retry");
      assert.equal(await row.locator('input[type=text]').inputValue(), "Rayong West", "the draft survives");
      assert.equal(await p.evaluate(() => window.__calls), 1);
      await p.evaluate(() => { cloud.saveAreaField = window.__orig; });
      await p.click("#btn-sv-save");
      await p.waitForFunction(() => /All changes saved/.test(document.querySelector("#sv-status").textContent));
      assert.equal(db.t("service_areas").find((r) => r.name === "Rayong West") ? true : false, true);
    });

    await step("a live refresh redraws around a draft instead of over it", async () => {
      const row = p.locator("#settings-areas tr").nth(1);
      await row.locator('input[type=text]').fill("Typing…");
      await p.evaluate(() => refreshAndRender());
      await p.waitForTimeout(150);
      assert.equal(await p.locator("#settings-areas tr").nth(1).locator('input[type=text]').inputValue(), "Typing…");
      assert.match(await status(), /Unsaved changes/);
      await p.click("#btn-sv-discard");
      assert.equal(await p.locator("#settings-areas tr").nth(1).locator('input[type=text]').inputValue(), "Rayong West");
    });

    await step("deleting an area: refused while it has employees, otherwise confirmed", async () => {
      await p.locator("#settings-areas tr").nth(0).locator(".st-del").click();
      assert.match(await p.locator("#confirm-title").innerText(), /Cannot delete/);
      await closeDialog();
      await p.locator("#settings-areas tr").nth(1).locator(".st-del").click();
      assert.match(await p.locator("#confirm-title").innerText(), /Delete Rayong West/);
      await p.click("#btn-confirm-yes");
      await p.waitForFunction(() => document.querySelectorAll("#settings-areas tr").length === 1);
      assert.equal(db.t("service_areas").some((r) => r.name === "Rayong West"), false);
    });

    await step("Boards: names and non-working days are staged; duplicates are refused; deletion keeps its guards", async () => {
      await tab("boards");
      const first = p.locator("#settings-boards tr").nth(0);
      await first.locator("label.weekday-chip", { hasText: "Mon" }).click();
      assert.match(await status(), /Unsaved changes \(1\)/);
      assert.deepEqual(db.t("boards").find((b) => b.id === "b1").weekend_days, [0, 6], "not written yet");
      await first.locator('input[type=text]').fill("Board Two");
      await p.click("#btn-sv-save");
      await p.waitForFunction(() => /already a board called Board Two/.test(document.querySelector("#sv-status").textContent));
      assert.equal(db.t("boards").find((b) => b.id === "b1").name, "Board One", "nothing was saved");
      await first.locator('input[type=text]').fill("Board 1");
      await p.click("#btn-sv-save");
      await p.waitForFunction(() => /All changes saved/.test(document.querySelector("#sv-status").textContent));
      const b1 = db.t("boards").find((b) => b.id === "b1");
      assert.equal(b1.name, "Board 1");
      assert.deepEqual(b1.weekend_days.slice().sort(), [0, 1, 6]);
      await p.locator("#settings-boards tr").nth(0).locator(".st-del").click();
      assert.match(await p.locator("#confirm-message").innerText(), /still has \d+ employee/);
      await closeDialog();
    });

    await step("Boards: \"+ Board\" in the page header creates a board and the table shows it", async () => {
      await tab("boards");
      assert.equal(await p.locator("#btn-add-board-settings").isVisible(), true, "button is on the Boards section");
      await tab("areas");
      assert.equal(await p.locator("#btn-add-board-settings").isVisible(), false, "and only there");
      await tab("boards");
      const before = await p.locator("#settings-boards tr").count();
      await p.click("#btn-add-board-settings");
      await p.waitForSelector("#modal-board:not(.hidden)");
      await p.fill("#form-board [name=name]", "Board Three");
      await p.click("#form-board button[type=submit]");
      await p.waitForFunction((n) => document.querySelectorAll("#settings-boards tr").length === n + 1, before);
      assert.equal(db.t("boards").some((b) => b.name === "Board Three"), true, "saved");
      assert.equal(await p.locator("#settings-view").isVisible(), true, "still on the Settings page");
    });

    await step("Engineers: a colour is staged and saved from the page", async () => {
      await tab("engineers");
      const row = p.locator("#settings-engineers tr").nth(0);
      const name = await row.locator('input[type=text]').inputValue();
      await row.locator('input[type=color]').fill("#112233");
      assert.match(await status(), /Unsaved changes \(1\)/);
      await p.click("#btn-sv-save");
      await p.waitForFunction(() => /All changes saved/.test(document.querySelector("#sv-status").textContent));
      assert.equal(db.t("engineers").find((e) => e.name === name).color, "#112233");
    });

    await step("Roles & permissions: changes are staged, reviewed before / after, then applied", async () => {
      await tab("roles");
      assert.equal(await p.locator("#roles-matrix .rm-level:disabled").count() > 10, true, "Admin's column is read-only");
      const sel = p.locator('select[aria-label="Settings for Manager"]');
      assert.equal(await sel.inputValue(), "edit");
      await sel.selectOption("view");
      assert.match(await status(), /1 permission change ready to review/);
      assert.equal(await p.locator("#btn-sv-save").innerText(), "Review changes");
      assert.equal(perm("manager", "settings"), "edit", "nothing is written before Apply");
      await p.click("#btn-sv-save");
      await p.waitForSelector("#modal-perm-review:not(.hidden)");
      const rows = await p.locator("#perm-review-body tr").allInnerTexts();
      assert.equal(rows.length, 1);
      assert.match(rows[0].replace(/\s+/g, " "), /Manager Settings Edit View/);
      await p.click("#btn-perm-cancel");
      assert.equal(await sel.inputValue(), "view", "Keep editing keeps the staged change");
      assert.equal(perm("manager", "settings"), "edit");
      // someone else changes the same cell while this is open: the review says so
      db.t("role_permissions").find((r) => r.role_key === "manager" && r.area === "settings").level = "none";
      await p.evaluate(() => cloud._loadIdentity());
      await p.click("#btn-sv-save");
      await p.waitForSelector("#modal-perm-review:not(.hidden)");
      assert.match(await p.locator("#perm-review-warn").innerText(), /changed by someone else/);
      assert.match(await p.locator("#perm-review-body").innerText(), /was Edit when you started/);
      await p.click("#btn-perm-apply");
      await p.waitForFunction(() => /All changes saved/.test(document.querySelector("#sv-status").textContent));
      assert.equal(perm("manager", "settings"), "view");
      assert.equal(await p.locator("#btn-sv-save").isVisible(), false);
    });

    await step("dialogs over the page: focus goes in, Tab stays in, Esc closes and focus goes back", async () => {
      await tab("engineers");
      await p.focus("#btn-add-engineer");
      await p.keyboard.press("Enter");
      await p.waitForSelector("#modal-add-engineer:not(.hidden)");
      assert.equal(await p.evaluate(() => !!document.activeElement.closest("#modal-add-engineer")), true);
      for (let i = 0; i < 6; i++) {
        await p.keyboard.press("Tab");
        assert.equal(await p.evaluate(() => !!document.activeElement.closest("#modal-add-engineer")), true, "Tab " + (i + 1));
      }
      await p.keyboard.press("Shift+Tab");
      assert.equal(await p.evaluate(() => !!document.activeElement.closest("#modal-add-engineer")), true);
      assert.equal(await p.getAttribute("#modal-add-engineer", "role"), "dialog");
      await p.keyboard.press("Escape");
      await p.waitForSelector("#modal-backdrop", { state: "hidden" });
      assert.equal(await p.evaluate(() => document.activeElement.id), "btn-add-engineer");
    });

    await step("the password is a separate form: validated, never kept", async () => {
      await tab("account");
      await p.click("#btn-change-password");
      await p.waitForSelector("#modal-password:not(.hidden)");
      await p.fill("#form-account-password [name=password]", "short");
      await p.fill("#form-account-password [name=confirm]", "short");
      await p.click("#form-account-password button[type=submit]");
      assert.match(await p.locator("#password-error").innerText(), /at least 8/i);
      await p.fill("#form-account-password [name=password]", "longenough1");
      await p.fill("#form-account-password [name=confirm]", "different11");
      await p.click("#form-account-password button[type=submit]");
      assert.match(await p.locator("#password-error").innerText(), /don't match/);
      assert.equal(await p.locator("#btn-sv-save").isVisible(), false, "a password is never part of the draft");
      await closeDialog();
      assert.equal(await p.inputValue("#form-account-password [name=password]"), "", "cleared on close");
      await p.click("#btn-change-password");
      assert.equal(await p.inputValue("#form-account-password [name=password]"), "");
      await closeDialog();
    });

    await step("on a phone the rail is a section picker, lists are cards, and nothing leaves the screen", async () => {
      await p.setViewportSize({ width: 390, height: 844 });
      assert.equal(await p.locator("#settings-rail").isVisible(), false);
      assert.equal(await p.locator("#sv-select").isVisible(), true);
      for (const t of ["account", "engineers", "areas", "boards", "users", "roles"]) {
        await p.selectOption("#sv-select", t);
        await p.waitForFunction((x) => state.settingsTab === x, t);
        const m = await p.evaluate(() => ({
          page: document.documentElement.scrollWidth - innerWidth,
          pane: document.querySelector("#sv-scroll").scrollWidth - document.querySelector("#sv-scroll").clientWidth,
        }));
        assert.ok(m.page <= 0 && m.pane <= 1, `${t}: overflows by ${JSON.stringify(m)}`);
      }
      // a list is cards: no header row, each cell labelled
      await p.selectOption("#sv-select", "users");
      assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#users-table thead")).display), "none");
      // permissions: one role at a time
      await p.selectOption("#sv-select", "roles");
      const shown = await p.evaluate(() => [...document.querySelectorAll("#roles-matrix .rm-head th[data-role]")].filter((e) => e.getClientRects().length).length);
      assert.equal(shown, 1);
      await p.selectOption("#rm-role-select", "engineer");
      assert.equal(await p.evaluate(() => [...document.querySelectorAll("#roles-matrix .rm-head th[data-role]")].filter((e) => e.getClientRects().length).map((e) => e.dataset.role).join()), "engineer");
      // 44px touch targets, and the section picker snaps back if the guard is declined
      await p.selectOption("#sv-select", "account");
      await p.fill("#acct-phone", "092-222-2222");
      const save = await p.locator("#btn-sv-save").boundingBox();
      assert.ok(save.height >= 44, "save is " + save.height + "px tall");
      await p.selectOption("#sv-select", "boards");
      await p.waitForSelector("#modal-unsaved:not(.hidden)");
      await closeDialog();
      assert.equal(await p.inputValue("#sv-select"), "account");
      await p.click("#btn-sv-discard");
      await p.click("#btn-settings-back-icon");
      await p.waitForSelector("#settings-view", { state: "hidden" });
      await p.setViewportSize({ width: 1400, height: 900 });
    });

    await a.close();

    await step("a view-only Users section stays read-only; Roles is not offered", async () => {
      const m = await env.openAs(db, MANAGER);
      await m.page.click("#btn-settings");
      await m.page.waitForSelector("#settings-view:not(.hidden)");
      const tabs = await m.page.evaluate(() => [...document.querySelectorAll("#settings-tabs .settings-tab")].filter((e) => e.getClientRects().length).map((e) => e.dataset.tab));
      // (the Roles step above took the Manager's Settings down to View, so the board-setup sections are gone)
      assert.deepEqual(tabs, ["account", "users"]);
      await m.page.click('#settings-tabs [data-tab=users]');
      await m.page.waitForSelector("#users-table");
      assert.equal(await m.page.locator("#btn-add-user").isVisible(), false);
      assert.equal(await m.page.locator("#users-body .user-actions .btn").count(), 0, "no edit / approve buttons");
      assert.match(await m.page.locator("#sv-status").innerText(), /View only/);
      assert.deepEqual(m.errors, []);
      await m.close();
    });

    await step("a viewer sees only My account, with no empty group headings", async () => {
      const v = await env.openAs(db, h.USERS.v);
      await v.page.click("#btn-settings");
      await v.page.waitForSelector("#settings-view:not(.hidden)");
      const vis = await v.page.evaluate(() => [...document.querySelectorAll("#settings-tabs .settings-tab, #settings-tabs .settings-group")].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim()));
      assert.deepEqual(vis, ["Personal", "My account"]);
      assert.deepEqual(v.errors, []);
      await v.close();
    });

    assert.deepEqual(a.errors, [], "no page errors: " + a.errors.join(" | "));
    console.log("all settings workspace checks passed");
  } finally {
    await env.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
