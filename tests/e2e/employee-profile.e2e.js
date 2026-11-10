/* Acceptance run for the employee Profile as the one place a person is checked and edited:
     - the Manpower List's right-click menu is about the person (Profile, Move to board,
       Deactivate): no Assign to mission, Leave or Return to Standby; a board's menu keeps them;
     - double-click and the menu open the Profile; Edit details is the form that used to be the
       Edit employee dialog (same checks, same save), Cancel leaves it, a period switch while it
       is open keeps what was typed; Deactivate and Reactivate are there; a viewer sees the facts
       and no edit buttons;
     - the Leave record: each stretch of leave (type, dates, days) in the period, a stretch
       running across a weekend as one line, the days by type, the same count as the Leave tile,
       an Exchange Working Day listed but not counted as leave;
     - notes can be added and deleted in the Profile.
     NODE_PATH=$(npm root -g) node tests/e2e/employee-profile.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 40).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  try {
    const today = h.iso(new Date());
    const SRC = h.isWeekend(today) ? h.prevWorking(today) : today;
    // the Monday of the week four weeks back, and the ten weekdays from it: all in the past, all inside 90 days
    const back = h.addDays(today, -28);
    const W = h.addDays(back, -((new Date(back + "T00:00:00").getDay() + 6) % 7));
    const wd = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map((i) => h.addDays(W, i));   // Mon-Fri, then Mon-Fri the week after
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    // a mission on every one of those days, so each is a planned working day; Person B works all of them
    db.seed("missions", [
      ...wd.map((d, i) => ({ id: "w" + i, board_id: "b1", plan_date: d, number: "7" + i, host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" })),
    ]);
    const as = [];
    wd.forEach((d, i) => as.push({ employee_id: "e2", plan_date: d, mission_id: "w" + i, zone: null }));
    // Person A: annual Mon-Wed, works Thu, sick Fri and the Monday after (one stretch across the weekend),
    // business the Tuesday after, an Exchange Working Day the Wednesday after
    const leave = (d, z) => as.push({ employee_id: "e1", plan_date: d, mission_id: null, zone: z });
    leave(wd[0], "annual"); leave(wd[1], "annual"); leave(wd[2], "annual");
    as.push({ employee_id: "e1", plan_date: wd[3], mission_id: "w3", zone: null });
    leave(wd[4], "sick"); leave(wd[5], "sick");
    leave(wd[6], "business");
    leave(wd[7], "exchange");
    db.seed("assignments", as);
    db.seed("employee_notes", [{ id: "n1", employee_id: "e1", note: "Prefers day shifts", created_by: "eng.a@example.com", created_at: new Date().toISOString() }]);
    Object.assign(db.t("employees").find((e) => e.id === "e1"), { name_th: "สมชาย ใจดี", name_en: "Somchai Jaidee", phone: "081-234-5678", trigo_id: "T101" });

    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const toList = () => p.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
    const menu = p.locator("#context-menu");
    const menuLabels = async () => (await menu.locator(".ctx-item").allInnerTexts()).map((s) => s.trim());
    // a real right-click scrolls the row into view first, and a scroll closes the menu: send the event itself
    const rightClickRow = async (name) => {
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(300);
      await p.evaluate((n) => {
        const tr = [...document.querySelectorAll("#emplist-body tr")].find((r) => r.textContent.includes(n));
        const r = tr.getBoundingClientRect();
        tr.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 10 }));
      }, name);
      await menu.waitFor();
    };
    const profileOpen = () => p.waitForSelector("#modal-profile:not(.hidden) .rp-group");
    // the fields as "label value" lines (Contract and Contact); who they are, their board and area are in the header
    const facts = () => p.locator("#profile-body .rp-dl > div").allInnerTexts().then((r) => r.map((x) => x.replace(/\s+/g, " ").trim()));
    const head = () => p.locator("#modal-profile .rp-head").innerText().then((x) => x.replace(/\s+/g, " ").trim());
    const openMore = () => p.click("#btn-profile-more");

    await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);

    await step("the Manpower List's menu: Profile, Move to board, Deactivate; nothing that belongs to the board", async () => {
      await toList();
      await rightClickRow("สมชาย ใจดี");
      assert.deepEqual(await menuLabels(), ["Profile", "Move to board", "Deactivate employee"]);
      await p.keyboard.press("Escape");
      await p.evaluate(() => { state.selectedEmps = new Set(["e1", "e2"]); renderEmployeeRows(); });
      await rightClickRow("Person B");
      assert.deepEqual(await menuLabels(), ["Move to board", "Deactivate 2 employees"], "a bulk selection: the same, without Edit or Profile");
      await p.keyboard.press("Escape");
      await p.evaluate(() => { clearSelection(); });
    });

    await step("a board's menu keeps its placement items; its first item is the Profile, not Edit employee", async () => {
      await p.evaluate((d) => { D().activeBoardId = "b1"; state.date = d; return refreshAndRender(); }, SRC);
      await p.locator('.emp-card[data-emp-id="e3"]').first().click({ button: "right" });
      const labels = await menuLabels();
      assert.equal(labels[0], "Profile");
      for (const l of ["Assign to mission", "Leave", "Return to Standby"]) assert.ok(labels.includes(l), l + " stays on the board: " + labels);
      assert.ok(!labels.includes("Edit employee"));
      await menu.locator(".ctx-item", { hasText: /^Profile/ }).click();
      await profileOpen();
      assert.equal(await p.locator("#profile-title").textContent(), "Person C");
      await p.evaluate(() => closeModal());
      await p.locator('.emp-card[data-emp-id="e3"]').first().dblclick();
      await profileOpen();
      assert.equal(await p.locator("#profile-title").textContent(), "Person C", "double-click on a card opens the Profile too");
      await p.evaluate(() => closeModal());
    });

    await step("double-click in the Manpower List opens the Profile: every detail, and Edit details", async () => {
      await toList();
      await p.locator("#emplist-body tr", { hasText: "สมชาย ใจดี" }).dblclick();
      await profileOpen();
      assert.equal(await p.locator("#profile-title").textContent(), "สมชาย ใจดี");
      const f = await facts();
      assert.deepEqual(f.slice(0, 2), ["Contract type Permanent", "Position —"]);
      for (const x of ["English name Somchai Jaidee", "Mobile number 081-234-5678", "On the board from —"]) assert.ok(f.includes(x), x + " in " + JSON.stringify(f));
      // who they are is the header: the status pill, TRIGO ID · English name, then the board and the service area
      assert.equal((await p.locator("#profile-status").innerText()).trim(), "Active");
      assert.match(await p.locator("#profile-sub").innerText(), /^T101\s+·\s+Somchai Jaidee/);
      assert.equal(await p.locator("#profile-sub .lt-bd").count(), 1, "the board tag");
      assert.equal(await p.locator("#profile-sub .lt-ar").count(), 1, "the service area");
      assert.equal(await p.locator("#btn-profile-edit").count(), 1);
      assert.equal(await p.locator("#profile-body #form-employee").count(), 0, "the form is not there until asked for");
    });

    await step("Edit details: the old Edit employee form, saved from the Profile, which then shows the new details", async () => {
      await p.click("#btn-profile-edit");
      assert.equal(await p.inputValue("#form-employee input[name=name]"), "สมชาย ใจดี");
      assert.equal(await p.inputValue("#form-employee input[name=nameEn]"), "Somchai Jaidee");
      assert.equal(await p.inputValue("#form-employee input[name=phone]"), "081-234-5678");
      assert.equal(await p.inputValue("#form-employee input[name=trigoId]"), "T101");
      assert.equal(await p.locator("#form-employee [name=position]").evaluate((s) => s.value), "");
      // the checks are the form's own: a taken TRIGO ID is refused and the form stays
      await p.fill("#form-employee input[name=trigoId]", "T102");
      db.t("employees").find((e) => e.id === "e2").trigo_id = "T102";
      await p.evaluate(() => cloud._loadEmployees().then(refreshAndRender));
      await p.click("#form-employee button[type=submit]");
      await p.waitForFunction(() => /T102 already belongs to Person B/.test(document.querySelector("#toast-stack").textContent));
      assert.equal(await p.locator("#modal-profile:not(.hidden) #form-employee").count(), 1, "still the form");
      // a redraw while the form is open (the figures finishing their load, a board change elsewhere) keeps what was typed;
      // the form replaces the whole body, so there is no period switch to press while editing
      await p.fill("#form-employee input[name=trigoId]", "T555");
      await p.fill("#form-employee input[name=phone]", "089-000-1111");
      assert.equal(await p.locator("#profile-body .ov-prof-bar").count(), 0, "the form is the whole body");
      await p.evaluate(() => renderProfile());
      assert.equal(await p.inputValue("#form-employee input[name=phone]"), "089-000-1111", "what was typed survives the redraw");
      await p.click('#form-employee .seg-pick button[data-v="oncall"]');
      await p.click("#form-employee .pk-btn[aria-label=Position]");
      await p.locator(".pk-pop .pk-opt", { hasText: "Senior Inspector" }).click();
      await p.click("#form-employee button[type=submit]");
      await p.waitForSelector("#form-employee", { state: "hidden" });
      const row = db.t("employees").find((e) => e.id === "e1");
      assert.deepEqual([row.trigo_id, row.phone, row.contract, row.position], ["T555", "089-000-1111", "oncall", "senior_inspector"]);
      const f = await facts();
      for (const x of ["Contract type On-call", "Position Senior Inspector", "Mobile number 089-000-1111"]) assert.ok(f.includes(x), x + " in " + JSON.stringify(f));
      assert.match(await head(), /T555/, "the new TRIGO ID is in the header");
      assert.equal(await p.locator("#modal-profile:not(.hidden)").count(), 1, "the Profile stays open");
    });

    await step("Cancel leaves the form without saving", async () => {
      await p.click("#btn-profile-edit");
      await p.fill("#form-employee input[name=phone]", "000");
      await p.click("#form-employee .emp-form-cancel");
      assert.equal(await p.locator("#modal-profile:not(.hidden)").count(), 1);
      assert.equal(await p.locator("#profile-body #form-employee").count(), 0);
      assert.equal(db.t("employees").find((e) => e.id === "e1").phone, "089-000-1111");
      await p.evaluate(() => closeModal());
    });

    await step("the header: the name, the status and at most two buttons and More; Edit turns the panel into the form with its footer pinned", async () => {
      await p.evaluate(() => openProfile("e1", "90"));
      await profileOpen();
      assert.deepEqual(await p.locator("#profile-acts > button").evaluateAll((b) => b.map((x) => x.id)), ["btn-profile-edit", "btn-profile-move", "btn-profile-more"], "Edit, Move to board, More");
      const w = await p.locator("#modal-profile").evaluate((m) => Math.round(m.getBoundingClientRect().width));
      assert.equal(w, 760, "the one panel width");
      await p.click("#btn-profile-edit");
      await p.waitForSelector("#modal-profile #form-employee");
      assert.equal(await p.locator("#modal-profile #profile-acts:not(.hidden)").count(), 0, "no action row in the form");
      assert.equal(await p.locator("#modal-profile").evaluate((m) => Math.round(m.getBoundingClientRect().width)), 760, "the form has the same width");
      assert.equal((await p.locator("#profile-status").innerText()).trim(), "Active", "the same header in the form");
      assert.equal(await p.locator("#form-employee .rp-foot #btn-emp-deactivate").count(), 1, "Deactivate… sits in the footer, on the left");
      // the footer stays in view with the fields scrolled to their end
      await p.locator("#form-employee .rp-fields").evaluate((el) => { el.scrollTop = el.scrollHeight; });
      const r = await p.evaluate(() => {
        const f = document.querySelector("#form-employee .rp-foot").getBoundingClientRect(), m = document.querySelector("#modal-profile").getBoundingClientRect();
        return { fBottom: Math.round(f.bottom), mBottom: Math.round(m.bottom), vh: innerHeight };
      });
      assert.ok(r.fBottom <= r.vh && r.fBottom >= r.mBottom - 2, "the footer is pinned at the panel's bottom " + JSON.stringify(r));
      // the labels: the required ones have the red star, the optional ones say so
      assert.equal(await p.locator("#form-employee label:has(input[name=name]) .req").count(), 1);
      assert.equal(await p.locator("#form-employee label:has(input[name=trigoId]) .opt").innerText(), "optional");
      assert.equal(await p.locator("#form-employee label:has(select[name=areaId]) .req").count(), 1);
      await p.click("#form-employee .emp-form-cancel");
      await profileOpen();
      assert.equal(await p.locator("#profile-acts:not(.hidden)").count(), 1, "Cancel returns to the read view of the same record");
      await p.evaluate(() => closeModal());
    });

    await step("the alert box: only when the person has an alert, with its one fix, which opens the form on that field", async () => {
      // Person B works every day, has a TRIGO ID and an area: no alert, so no box and no Flags line
      await p.evaluate(() => openProfile("e2", "90"));
      await profileOpen();
      assert.equal(await p.locator("#profile-body .rp-alert").count(), 0);
      assert.equal(await p.locator(".ov-prof-flags").count(), 0);
      await p.evaluate(() => closeModal());
      // Person A took six leave days: leave above 20% of the working days is an alert, which has no fix to press
      await p.evaluate(() => openProfile("e1", "90"));
      await p.waitForSelector("#modal-profile:not(.hidden) .rp-alert");
      assert.match(await p.locator("#profile-body .rp-alert").innerText(), /Leave \d+%/);
      assert.equal(await p.locator("#profile-body .rp-alert .rp-al-fix").count(), 0);
      await p.evaluate(() => closeModal());
      // no TRIGO ID: the alert, and its fix opens the form with that field focused
      db.t("employees").find((e) => e.id === "e3").trigo_id = null;
      await p.evaluate(() => cloud._loadEmployees().then(refreshAndRender));
      await p.evaluate(() => openProfile("e3", "90"));
      await p.waitForSelector("#modal-profile:not(.hidden) .rp-alert");
      assert.match(await p.locator("#profile-body .rp-alert").innerText(), /No TRIGO ID/);
      assert.equal(await p.locator("#profile-body .rp-alert .lt-al").count() >= 1, true);
      assert.equal(await p.locator("#profile-body .rp-alert .rp-al-fix").evaluate((b) => b.className.includes("lt-act")), true, "the fix is a text button");
      await p.click("#profile-body .rp-alert .rp-al-fix");
      await p.waitForSelector("#modal-profile #form-employee");
      await p.waitForFunction(() => document.activeElement && document.activeElement.name === "trigoId");
      await p.evaluate(() => closeModal());
      db.t("employees").find((e) => e.id === "e3").trigo_id = "T103";
      await p.evaluate(() => cloud._loadEmployees().then(refreshAndRender));
    });

    await step("More opens under its button and Escape closes only the menu; Move to board lists the other boards and moves the person", async () => {
      await toList();
      await p.evaluate(() => openProfile("e9", "90"));
      await profileOpen();
      await openMore();
      assert.equal(await p.locator("#profile-acts .rp-more").count(), 1);
      await p.keyboard.press("Escape");
      assert.equal(await p.locator("#profile-acts .rp-more").count(), 0, "Escape closed the menu");
      assert.equal(await p.locator("#modal-profile:not(.hidden)").count(), 1, "and left the panel open");
      const from = db.t("employees").find((e) => e.id === "e9").board_id;
      await p.click("#btn-profile-move");
      const boards = (await p.locator("#profile-acts .rp-more .rp-more-item").allInnerTexts()).map((t) => t.trim());
      assert.equal(boards.length >= 1 && !boards.includes(await p.evaluate((id) => D().boards.find((b) => b.id === D().employees.find((e) => e.id === id).boardId).name, "e9")), true, "the other boards only: " + boards.join(", "));
      await p.locator("#profile-acts .rp-more .rp-more-item").first().click();
      // today's board is read-only: the same "edit anyway?" the board's own menu asks first
      if (await p.locator("#modal-confirm:not(.hidden)").waitFor({ timeout: 1500 }).then(() => true, () => false)) await p.click("#btn-confirm-yes");
      await p.waitForFunction((b) => D().employees.find((e) => e.id === "e9").boardId !== b, from);
      assert.notEqual(db.t("employees").find((e) => e.id === "e9").board_id, from, "moved for good");
      await p.evaluate(() => closeModal());
    });

    await step("the Manpower List's + Add buttons open the Profile on that field", async () => {
      await toList();
      await p.locator("#emplist-body tr", { hasText: "Person C" }).locator(".el-fix[data-fix=phone]").click();
      await p.waitForSelector("#modal-profile:not(.hidden) #form-employee");
      await p.waitForFunction(() => document.activeElement && document.activeElement.name === "phone");
      assert.equal(await p.locator("#profile-title").textContent(), "Person C");
      await p.evaluate(() => closeModal());
    });

    await step("Leave record: stretches, dates, days, by type; the same count as the Leave tile", async () => {
      await p.evaluate(() => openProfile("e1", "90"));
      await p.waitForSelector("#modal-profile:not(.hidden) .ov-prof-leave .ov-prof-leave-table");
      const rows = (await p.locator(".ov-prof-leave-table tbody tr").allInnerTexts()).map((r) => r.replace(/\s+/g, " ").trim());
      const day = (iso) => p.evaluate((i) => `${fmtDow(i)} ${fmtDate(i)}`, iso);
      assert.equal(rows.length, 4);
      assert.equal(rows[0], `Exchange Working Day worked back, not leave ${await day(wd[7])} 1`, "newest first, listed but marked as not leave");
      assert.equal(rows[1], `Business Leave ${await day(wd[6])} 1`);
      assert.equal(rows[2], `Sick Leave ${await day(wd[4])} – ${await day(wd[5])} 2`, "Friday and the Monday after: one stretch across the weekend");
      assert.equal(rows[3], `Annual Leave ${await day(wd[0])} – ${await day(wd[2])} 3`);
      const sum = (await p.locator(".ov-prof-lv-sum").innerText()).replace(/\s+/g, " ");
      assert.equal(sum, "6 leave days", "the exchange day is not leave");
      const chips = (await p.locator(".ov-prof-lv").allInnerTexts()).map((r) => r.replace(/\s+/g, " ").trim());
      assert.deepEqual(chips, ["Annual Leave 3", "Sick Leave 2", "Business Leave 1", "Exchange Working Day 1"]);
      const tile = await p.locator(".ov-prof-tiles .ov-htile", { hasText: "Leave" }).first().locator(".ov-htile-value").textContent();
      assert.equal(tile, "6", "the Leave tile counts the same days");
      // a person with none
      await p.evaluate(() => openProfile("e2", "90"));
      await p.waitForSelector("#modal-profile:not(.hidden) .ov-prof-leave");
      await p.waitForFunction(() => document.querySelector(".ov-prof-leave .ov-muted:not(.ov-eng-foot-h .ov-muted)"));
      assert.equal((await p.locator(".ov-prof-leave > p").innerText()).trim(), "No leave in this period.");
      await p.evaluate(() => closeModal());
    });

    await step("Leave record: a long record shows ten stretches, and Show all lists them all", async () => {
      // twelve one-day stretches on every third weekday (so no two run together), all inside the 90 days
      const weekdays = [];
      for (let d = h.addDays(today, -85); weekdays.length < 40; d = h.addDays(d, 1)) if (!h.isWeekend(d)) weekdays.push(d);
      const days = weekdays.filter((_, i) => i % 3 === 0).slice(0, 12);
      db.seed("missions", days.map((d) => ({ id: "p" + d, board_id: "b1", plan_date: d, number: "9" + d.slice(-2), host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" })));
      db.seed("assignments", days.map((d) => ({ employee_id: "e4", plan_date: d, mission_id: null, zone: "unpaid" })));
      await p.evaluate(() => openProfile("e4", "90"));
      await p.waitForSelector("#modal-profile:not(.hidden) .ov-prof-leave-table");
      assert.equal(await p.locator(".ov-prof-leave-table tbody tr").count(), 10);
      assert.equal((await p.locator(".ov-prof-lv-sum").innerText()).replace(/\s+/g, " "), "12 leave days");
      await p.locator(".ov-prof-leave .ov-wl-more").click();
      assert.equal(await p.locator(".ov-prof-leave-table tbody tr").count(), 12);
      await p.locator(".ov-prof-leave .ov-wl-more").click();
      assert.equal(await p.locator(".ov-prof-leave-table tbody tr").count(), 10, "Show fewer");
      await p.evaluate(() => closeModal());
    });

    await step("Notes: add one, then delete it (the Profile comes back after the confirm)", async () => {
      await p.evaluate(() => openProfile("e1", "90"));
      await p.waitForSelector("#modal-profile:not(.hidden) .ov-prof-note-form");
      assert.equal(await p.locator(".ov-prof-note").count(), 1);
      await p.fill(".ov-prof-note-form textarea", "Needs a safety refresher");
      await p.click(".ov-prof-note-form button[type=submit]");
      await p.waitForFunction(() => document.querySelectorAll(".ov-prof-note").length === 2);
      assert.equal(db.t("employee_notes").filter((n) => n.employee_id === "e1").length, 2);
      assert.equal(await p.inputValue(".ov-prof-note-form textarea"), "", "the box is empty again");
      await p.locator(".ov-prof-note", { hasText: "Needs a safety refresher" }).locator(".note-delete").click();
      await p.click("#btn-confirm-no");
      assert.equal(await p.locator("#modal-profile:not(.hidden)").count(), 1, "No returns to the Profile");
      await p.locator(".ov-prof-note", { hasText: "Needs a safety refresher" }).locator(".note-delete").click();
      await p.click("#btn-confirm-yes");
      await p.waitForSelector("#modal-profile:not(.hidden) .ov-prof-note-form");
      await p.waitForFunction(() => document.querySelectorAll(".ov-prof-note").length === 1);
      assert.equal(db.t("employee_notes").filter((n) => n.employee_id === "e1").length, 1);
      await p.evaluate(() => closeModal());
    });

    await step("Deactivate and Reactivate from the Profile", async () => {
      await p.evaluate(() => openProfile("e3", "90"));
      await p.waitForSelector("#modal-profile:not(.hidden) #btn-profile-more");
      assert.equal(await p.locator("#modal-profile #btn-profile-active").count(), 0, "Deactivate is behind More, not a header button");
      await openMore();
      assert.equal((await p.locator("#btn-profile-active").innerText()).trim(), "Deactivate…");
      await p.click("#btn-profile-active");
      await p.waitForSelector("#modal-deactivate:not(.hidden)");
      await p.click("#btn-deactivate-no");
      assert.equal(await p.locator("#modal-profile:not(.hidden)").count(), 1, "Cancel returns to the Profile");
      assert.notEqual(db.t("employees").find((e) => e.id === "e3").active, false);
      await openMore();
      await p.click("#btn-profile-active");
      await p.waitForSelector("#modal-deactivate:not(.hidden)");
      await p.click("#btn-deactivate-yes");
      await p.waitForFunction(() => /Inactive/.test(document.querySelector("#profile-status").textContent));
      assert.equal(db.t("employees").find((e) => e.id === "e3").active, false);
      assert.equal(await p.locator("#profile-body .rp-alert").count(), 0, "someone off the roster has no alert");
      await openMore();
      assert.equal((await p.locator("#btn-profile-active").innerText()).trim(), "Activate");
      await p.click("#btn-profile-active");
      await p.waitForFunction(() => /Active/.test(document.querySelector("#profile-status").textContent) && !/Inactive/.test(document.querySelector("#profile-status").textContent));
      assert.equal(db.t("employees").find((e) => e.id === "e3").active, true);
      await p.evaluate(() => closeModal());
    });

    await step("a viewer sees every detail and the leave record, and no way to change them", async () => {
      const v = await env.openAs(db, h.USERS.v);
      await v.page.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      await v.page.evaluate(() => openEmployeeModal("e1"));
      await v.page.waitForSelector("#modal-profile:not(.hidden) .ov-prof-leave");
      assert.equal(await v.page.locator("#btn-profile-edit, #btn-profile-move, #btn-profile-more, #btn-profile-active, .ov-prof-note-form, #form-employee").count(), 0);
      assert.equal(await v.page.locator("#profile-acts:not(.hidden)").count(), 0, "no action row at all for a viewer");
      assert.equal(await v.page.locator("#profile-body .rp-dl > div").count() >= 6, true);
      assert.deepEqual(v.errors, []);
    });

    await step("new employee: still a small form of its own", async () => {
      await p.evaluate(() => openEmployeeModal(null));
      await p.waitForSelector("#modal-employee:not(.hidden) #form-employee");
      assert.equal(await p.locator("#modal-employee #employee-tabs").count(), 0, "no tabs: nothing to look at yet");
      await p.fill("#form-employee input[name=name]", "สมหญิง ทดสอบ");
      await p.click("#form-employee button[type=submit]");
      await p.waitForSelector("#modal-employee", { state: "hidden" });
      assert.ok(db.t("employees").some((e) => e.name_th === "สมหญิง ทดสอบ"));
    });

    assert.deepEqual(a.errors, [], "no console errors");
    console.log("all employee profile checks passed");
  } finally {
    await env.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
