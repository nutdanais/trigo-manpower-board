/* Acceptance run for the Settings page (the "workspace": a full page under the top
   bar, not a dialog), driving the real app in Chromium against the shared fake
   backend.
     NODE_PATH=$(npm root -g) node tests/e2e/settings-workspace.e2e.js
   It covers: the page opening over the app and handing the board back untouched,
   the remembered section, drafts with Save / Discard, the unsaved-changes guard,
   a failed save keeping its draft and retrying, service areas / boards / engineers
   / roles end to end (the permission review included), the sections each role may
   open, focus handling in the dialogs over the page, the password form, and the
   phone layout. Engineers, areas and boards are rows that open in place; Roles is
   one role at a time with Off / View / Edit buttons. Exits non-zero on the first failed check. */
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
    const openSettings = async () => { await p.click("#btn-avatar"); await p.click("#btn-settings"); await p.waitForSelector("#settings-view:not(.hidden)"); };
    const tab = async (t) => { await p.click(`#settings-tabs [data-tab=${t}]`); await p.waitForFunction((x) => state.settingsTab === x, t); };
    // a list row reads as the thing itself and opens in place to edit it
    const openRow = async (list, n) => {
      const row = p.locator(`#settings-${list} .sv-row`).nth(n);
      if (!(await row.evaluate((e) => e.classList.contains("open")))) await row.locator(".sv-row-toggle").click();
      return row;
    };
    const closeDialog = async () => { await p.keyboard.press("Escape"); await p.waitForSelector("#modal-backdrop", { state: "hidden" }); };

    await step("one navy: the top bar, the export header and the main buttons share it; the rail marks where you are with it", async () => {
      const navy = await p.evaluate(() => {
        const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
        const probe = document.createElement("button"); probe.className = "btn btn-primary"; document.body.appendChild(probe);
        const button = getComputedStyle(probe).backgroundColor; probe.remove();   // a main button; New Mission is white-on-navy inside the deck
        return { top: bg("#topbar"), capture: bg("#capture-header"), button, token: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() };
      });
      assert.equal(navy.token, "#003a66");
      assert.deepEqual([navy.top, navy.capture, navy.button], ["rgb(0, 58, 102)", "rgb(0, 58, 102)", "rgb(0, 58, 102)"]);
      await openSettings();
      // where you are is a tint with navy text, so navy stays the colour of what you press
      const active = await p.evaluate(() => { const c = getComputedStyle(document.querySelector("#settings-tabs .settings-tab.active")); return { bg: c.backgroundColor, ink: c.color }; });
      assert.equal(active.ink, "rgb(0, 58, 102)");
      assert.notEqual(active.bg, "rgb(0, 58, 102)", "the selected section is not a navy block");
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
      assert.equal(after.focus, "btn-avatar", "focus returns to the avatar menu that holds Settings");
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
      assert.equal(await p.locator("#sv-foot").isVisible(), false, "no action bar while there is nothing to save");
      await p.fill("#acct-display-name", "Zed.A");
      assert.equal(await p.locator("#sv-foot").isVisible(), true);
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
      // the confirmation is the one thing the bar says once saved, and then it goes
      assert.match(await status(), /All changes saved/);
      await p.waitForSelector("#sv-foot", { state: "hidden", timeout: 8000 });
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

    await step("the rail counts each list and flags the access requests waiting on somebody", async () => {
      for (const [i, [name, mail]] of [["Waiting One", "waiting.one"], ["Waiting Two", "waiting.two"]].entries()) {
        db.t("profiles").push({ id: "00000000-0000-0000-0000-00000000010" + i, email: mail + "@example.com", full_name: name, display_name: "Wait." + (i + 1), role_key: "engineer", status: "pending", requested_at: new Date().toISOString() });
      }
      await p.evaluate(() => cloud.loadUsers().then(() => renderSettings()));
      const n = (t) => p.locator(`#settings-tabs [data-tab=${t}] .st-n`).innerText();
      assert.equal(await n("users"), "2");
      assert.equal(await p.locator('#settings-tabs [data-tab=users] .st-n').evaluate((e) => e.classList.contains("st-badge")), true, "waiting people are a badge, not a count");
      assert.equal(await n("areas"), String(await p.evaluate(() => D().areas.length)));
      assert.equal(await n("boards"), String(await p.evaluate(() => D().boards.length)));
      assert.equal(await n("engineers"), String(await p.evaluate(() => engineerPaneRows().length)));
    });

    await step("Users: people waiting for access are a queue with its own buttons, not rows in the list", async () => {
      await tab("users");
      assert.match(await p.locator("#users-pending").innerText(), /Waiting for access · 2/);
      assert.equal(await p.locator("#users-body tr.status-pending").count(), 0, "not in the list");
      assert.deepEqual(await p.locator("#users-table thead th").allInnerTexts(), ["Person", "Role", "Status", "Last seen", "Actions"]);
      assert.equal(await p.locator('#users-chips [data-chip="status:pending"]').innerText().then((t) => t.replace(/\s+/g, " ")), "Waiting 2");
      await p.locator("#users-pending .sv-queue-row", { hasText: "Waiting One" }).getByRole("button", { name: /Approve/ }).click();
      await p.waitForFunction(() => /Waiting for access · 1/.test(document.querySelector("#users-pending").textContent));
      assert.equal(profile("waiting.one@example.com").status, "active");
      assert.equal(await p.locator("#users-body tr", { hasText: "Waiting One" }).count(), 1, "approved: now in the list");
      assert.equal(await p.locator('#settings-tabs [data-tab=users] .st-n').innerText(), "1", "the badge follows");
      // the Waiting chip is how the same people are listed with a row each
      await p.click('#users-chips [data-chip="status:pending"]');
      assert.equal(await p.locator("#users-pending").isVisible(), false, "listed once, not twice");
      assert.equal(await p.locator("#users-body tr.status-pending").count(), 1);
      await p.click('#users-chips [data-chip="all"]');
      await p.locator("#users-pending .sv-queue-row", { hasText: "Waiting Two" }).getByRole("button", { name: /Reject/ }).click();
      await p.click("#btn-confirm-yes");
      await p.waitForFunction(() => document.querySelector("#users-pending").classList.contains("hidden"));
      assert.equal(profile("waiting.two@example.com").status, "disabled");
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
      assert.equal(await p.locator("#settings-areas .sv-row").count(), 2);
      assert.equal(await p.locator("#settings-areas .sv-row input[type=text]:visible").count(), 0, "fields are not on show until a row is opened");

      const rayong = await openRow("areas", 1);
      assert.equal(await p.locator("#settings-areas .sv-row.open").count(), 1);
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
      const row = await openRow("areas", 1);
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
      const row = await openRow("areas", 1);
      await row.locator('input[type=text]').fill("Typing…");
      await p.evaluate(() => refreshAndRender());
      await p.waitForTimeout(150);
      assert.equal(await p.locator("#settings-areas .sv-row").nth(1).locator('input[type=text]').inputValue(), "Typing…", "the open row stays open around the draft");
      assert.match(await status(), /Unsaved changes/);
      await p.click("#btn-sv-discard");
      assert.equal(await p.locator("#settings-areas .sv-row").nth(1).locator('input[type=text]').inputValue(), "Rayong West");
    });

    await step("deleting an area: refused while it has employees, otherwise confirmed", async () => {
      const first = await openRow("areas", 0);
      assert.match(await first.locator(".sv-why").innerText(), /Move them first/, "an area in use says so before you try");
      await first.locator(".sv-del").click();
      assert.match(await p.locator("#confirm-title").innerText(), /Cannot delete/);
      await closeDialog();
      const second = await openRow("areas", 1);
      assert.equal(await second.locator(".sv-why").count(), 0, "an empty area has nothing to explain");
      await second.locator(".sv-del").click();
      assert.match(await p.locator("#confirm-title").innerText(), /Delete Rayong West/);
      await p.click("#btn-confirm-yes");
      await p.waitForFunction(() => document.querySelectorAll("#settings-areas .sv-row").length === 1);
      assert.equal(db.t("service_areas").some((r) => r.name === "Rayong West"), false);
    });

    await step("Boards: names and non-working days are staged; duplicates are refused; deletion keeps its guards", async () => {
      await tab("boards");
      const first = p.locator("#settings-boards .sv-row").nth(0);
      // the strip shows the days the board WORKS: Sun and Sat (its weekend) are off
      assert.deepEqual(await first.locator(".sv-day.on").allInnerTexts(), ["Mon", "Tue", "Wed", "Thu", "Fri"]);
      assert.match(await first.locator(".sv-row-main small").innerText(), /Mon–Fri · 5 working days/);
      await first.locator(".sv-day", { hasText: "Mon" }).click();   // Monday stops being a working day
      assert.match(await status(), /Unsaved changes \(1\)/);
      assert.match(await first.locator(".sv-row-main small").innerText(), /4 working days/);
      assert.deepEqual(db.t("boards").find((b) => b.id === "b1").weekend_days, [0, 6], "not written yet");
      await openRow("boards", 0);
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
      await p.locator("#settings-boards .sv-row").nth(0).locator(".sv-del").click();
      assert.match(await p.locator("#confirm-message").innerText(), /still has \d+ employee/);
      await closeDialog();
    });

    await step("Boards: \"+ Board\" in the page header creates a board and the table shows it", async () => {
      await tab("boards");
      assert.equal(await p.locator("#btn-add-board-settings").isVisible(), true, "button is on the Boards section");
      await tab("areas");
      assert.equal(await p.locator("#btn-add-board-settings").isVisible(), false, "and only there");
      await tab("boards");
      const before = await p.locator("#settings-boards .sv-row").count();
      await p.click("#btn-add-board-settings");
      await p.waitForSelector("#modal-board:not(.hidden)");
      await p.fill("#form-board [name=name]", "Board Three");
      await p.click("#form-board button[type=submit]");
      await p.waitForFunction((n) => document.querySelectorAll("#settings-boards .sv-row").length === n + 1, before);
      assert.equal(db.t("boards").some((b) => b.name === "Board Three"), true, "saved");
      assert.equal(await p.locator("#settings-view").isVisible(), true, "still on the Settings page");
    });

    await step("Engineers: a colour is staged and saved from the page", async () => {
      await tab("engineers");
      const row = await openRow("engineers", 0);
      const name = (await row.locator(".sv-row-main b").innerText()).trim();
      await row.locator('input[type=color]').fill("#112233");
      assert.equal(await row.locator(".sv-sq").evaluate((e) => getComputedStyle(e).backgroundColor), "rgb(17, 34, 51)", "the row's tile follows the colour");
      assert.match(await status(), /Unsaved changes \(1\)/);
      await p.click("#btn-sv-save");
      await p.waitForFunction(() => /All changes saved/.test(document.querySelector("#sv-status").textContent));
      assert.equal(db.t("engineers").find((e) => e.name === name).color, "#112233");
    });

    await step("Roles & permissions: changes are staged, reviewed before / after, then applied", async () => {
      await tab("roles");
      // every role side by side: roles across, areas down, a cell is the level
      assert.deepEqual(await p.locator("#roles-matrix thead .rm-role-h b").allInnerTexts(), ["Admin", "Manager", "Engineer", "Viewer"]);
      assert.equal(await p.locator("#roles-matrix tbody tr.rm-row").count(), 19, "every permission area is a row");
      assert.equal(await p.locator("#roles-matrix select").count(), 0, "no grid of dropdowns");
      assert.equal(await p.locator("#roles-matrix td[data-role=admin] button").count(), 0, "Admin's column is shown but locked");
      assert.match(await p.locator("#roles-matrix td[data-role=admin]").first().innerText(), /Edit/);
      const cell = (area, role) => p.locator(`#roles-matrix button[aria-label^="${area} for ${role}:"]`);
      assert.equal(await cell("Settings", "Manager").innerText(), "Edit");
      assert.equal(await cell("Settings", "Viewer").innerText(), "Off", "a row reads across the roles");
      // "Differences only" drops the rows where every role is the same
      const rowsAll = await p.locator("#roles-matrix tbody tr.rm-row").count();
      await p.click("#rm-diff");
      const rowsDiff = await p.locator("#roles-matrix tbody tr.rm-row").count();
      assert.ok(rowsDiff > 0 && rowsDiff < rowsAll, `${rowsDiff} of ${rowsAll}`);
      assert.equal(await p.locator("#rm-diff-n").innerText(), String(rowsDiff));
      assert.equal(await p.locator("#roles-matrix tbody tr.rm-row", { hasText: "Org Chart" }).count(), 0, "an area every role sees the same is hidden");
      await p.click("#rm-diff");
      assert.equal(await p.locator("#roles-matrix tbody tr.rm-row").count(), rowsAll);
      // a press steps the cell: Edit -> Off -> View -> Edit
      await cell("Settings", "Manager").click();
      assert.equal(await cell("Settings", "Manager").innerText(), "Off");
      await cell("Settings", "Manager").click();
      assert.equal(await cell("Settings", "Manager").innerText(), "View");
      assert.equal(await cell("Settings", "Manager").evaluate((e) => e.parentElement.classList.contains("rm-changed")), true, "a staged cell is marked");
      assert.match(await status(), /1 permission change ready to review/);
      assert.equal(await p.locator("#btn-sv-save").innerText(), "Review changes");
      assert.equal(perm("manager", "settings"), "edit", "nothing is written before Apply");
      await p.click("#btn-sv-save");
      await p.waitForSelector("#modal-perm-review:not(.hidden)");
      const rows = await p.locator("#perm-review-body .pr-row").allInnerTexts();
      assert.equal(rows.length, 1);
      assert.match(await p.locator("#perm-review-body .hm-group-title").innerText(), /^Manager$/);
      assert.match(rows[0].replace(/\s+/g, " "), /Settings Edit View/);
      await p.click("#btn-perm-cancel");
      assert.equal(await cell("Settings", "Manager").innerText(), "View", "Keep editing keeps the staged change");
      assert.equal(perm("manager", "settings"), "edit");
      // a staged change survives the filter redrawing the grid
      await p.click("#rm-diff"); await p.click("#rm-diff");
      assert.equal(await cell("Settings", "Manager").innerText(), "View");
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
      // putting a value back un-stages it
      await cell("Host", "Manager").click();   // Edit -> Off
      assert.match(await status(), /1 permission change/);
      await cell("Host", "Manager").click();   // Off -> View
      await cell("Host", "Manager").click();   // View -> Edit
      assert.equal(await p.evaluate(() => sdCount("roles")), 0);
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

    await step("on a phone Settings opens on a section list, a section has the screen, and nothing leaves it", async () => {
      await p.setViewportSize({ width: 390, height: 844 });
      // reopen so it starts the way a phone does: on the list
      await p.evaluate(() => { closeSettingsView(); openSettingsView(); });
      await p.waitForSelector("#settings-view.sv-at-home #sv-home .svh-row");
      assert.equal(await p.locator("#settings-rail").isVisible(), false);
      assert.equal(await p.locator("#sv-scroll").isVisible(), false, "the list replaces the pane");
      assert.equal(await p.locator("#sticky-header").isVisible(), false, "Settings takes the whole phone screen");
      const rows = await p.$$eval("#sv-home .svh-row", (r) => r.map((x) => x.dataset.tab));
      assert.deepEqual(rows, ["account", "engineers", "areas", "boards", "users", "roles"]);
      const open = async (t) => {
        if (!(await p.locator("#settings-view.sv-at-home").count())) { await p.click("#btn-settings-back-icon"); await p.waitForSelector("#settings-view.sv-at-home"); }
        await p.click(`#sv-home .svh-row[data-tab=${t}]`);
        await p.waitForFunction((x) => state.settingsTab === x && !state.svHome, t);
      };
      for (const t of rows) {
        await open(t);
        const m = await p.evaluate(() => ({
          page: document.documentElement.scrollWidth - innerWidth,
          pane: document.querySelector("#sv-scroll").scrollWidth - document.querySelector("#sv-scroll").clientWidth,
          foot: innerHeight - document.querySelector("#sv-foot").getBoundingClientRect().bottom,
        }));
        assert.ok(m.page <= 0 && m.pane <= 1, `${t}: overflows by ${JSON.stringify(m)}`);
        assert.ok(Math.abs(m.foot) <= 1, `${t}: the footer sits ${m.foot}px above the bottom edge`);
      }
      // Boards: the week is one row of seven
      await open("boards");
      const tops = await p.$$eval("#settings-boards .sv-row:first-child .sv-day", (c) => [...new Set(c.map((x) => Math.round(x.getBoundingClientRect().top)))]);
      assert.equal(tops.length, 1, "all seven days on one line");
      // Users: chips filter, rows have no header
      await open("users");
      assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#users-table thead")).display), "none");
      await p.click('#users-chips [data-chip="role:admin"]');
      assert.ok((await p.$$eval("#users-body tr.user-row", (r) => r.length)) >= 1);
      assert.ok(await p.$$eval("#users-body tr.user-row", (r) => r.every((x) => x.querySelector(".role-admin"))));
      await p.click('#users-chips [data-chip="all"]');
      // permissions: one role at a time, chosen by chip, levels as buttons
      await open("roles");
      const heads = await p.$$eval("#roles-matrix thead .rm-role-h", (c) => c.map((x) => Math.round(x.getBoundingClientRect().top)));
      assert.equal(heads.length, 4);
      assert.equal(new Set(heads).size, 1, "all four roles sit side by side on a phone too");
      const btn = p.locator("#roles-matrix tbody tr.rm-row").first().locator("button").first();
      assert.ok((await btn.boundingBox()).height >= 36, "a cell is a touch target");
      await btn.click();
      await p.waitForFunction(() => sdCount("roles") === 1);
      await p.click("#btn-sv-discard");
      // Save stays in the footer, disabled until there is something to save; the
      // back chevron asks first when there is
      await open("account");
      assert.equal(await p.locator("#btn-sv-save").isDisabled(), true);
      await p.fill("#acct-phone", "092-222-2222");
      const save = await p.locator("#btn-sv-save").boundingBox();
      assert.ok(save.height >= 40, "save is " + save.height + "px tall");
      await p.click("#btn-settings-back-icon");
      await p.waitForSelector("#modal-unsaved:not(.hidden)");
      await closeDialog();
      assert.equal(await p.evaluate(() => state.svHome), false, "declining keeps the section open");
      await p.click("#btn-sv-discard");
      await p.click("#btn-settings-back-icon");
      await p.waitForSelector("#settings-view.sv-at-home");
      await p.click("#btn-settings-back-icon");
      await p.waitForSelector("#settings-view", { state: "hidden" });
      await p.setViewportSize({ width: 1400, height: 900 });
    });

    await a.close();

    await step("a view-only Users section stays read-only; Roles is not offered", async () => {
      const m = await env.openAs(db, MANAGER);
      await m.page.click("#btn-avatar"); await m.page.click("#btn-settings");
      await m.page.waitForSelector("#settings-view:not(.hidden)");
      const tabs = await m.page.evaluate(() => [...document.querySelectorAll("#settings-tabs .settings-tab")].filter((e) => e.getClientRects().length).map((e) => e.dataset.tab));
      // (the Roles step above took the Manager's Settings down to View, so the board-setup sections are gone)
      assert.deepEqual(tabs, ["account", "users"]);
      await m.page.click('#settings-tabs [data-tab=users]');
      await m.page.waitForSelector("#users-table");
      assert.equal(await m.page.locator("#btn-add-user").isVisible(), false);
      assert.equal(await m.page.locator("#users-body .user-actions .btn").count(), 0, "no edit / approve buttons");
      assert.equal(await m.page.locator("#users-viewonly").isVisible(), true, "the page says it is view only");
      assert.match(await m.page.locator("#users-viewonly").innerText(), /View only/);
      assert.equal(await m.page.locator("#sv-foot").isVisible(), false);
      assert.deepEqual(m.errors, []);
      await m.close();
    });

    await step("a viewer sees only My account, with no empty group headings", async () => {
      const v = await env.openAs(db, h.USERS.v);
      await v.page.click("#btn-avatar"); await v.page.click("#btn-settings");
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
