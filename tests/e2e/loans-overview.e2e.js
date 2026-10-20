/* Acceptance run for loans (employee_loans) outside the board itself: the
   Overview (By board headcount notes, borrowed idle names, Loans today and its
   permission), the phone summary, the Org Chart, the Manpower List (On loan
   chip, Excel rows, 30D utilization on the borrowing board's calendar),
   deleting a board people are on loan to, hold notices' Open day, a loan into
   forecast days, and a loan counted on a board whose day is confirmed while
   the lender's is still a forecast. Real app in Chromium against the shared
   fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/loans-overview.e2e.js
   Seed: harness.seedBase (Board One: A–H, Board Two: I, J) plus an empty
   Board Three, and Person C lent to Board Two on the day on screen (their
   place on 102 cleared, as lending does). Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
const D1 = h.nextWorking(SRC);

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
    db.seed("boards", [{ id: "b3", name: "Board Three", weekend_days: [0, 6] }]);
    const asg = db.t("assignments");
    asg.splice(asg.findIndex((x) => x.employee_id === "e3"), 1);
    db.seed("employee_loans", [{ id: "loan-c", employee_id: "e3", to_board_id: "b2", start_date: SRC, end_date: SRC, note: "Audit", created_by: "eng.a@example.com" }]);

    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    const open = (board, d) => p.evaluate(([b, d]) => { D().activeBoardId = b; state.date = d; state.unlockedDates.add(d); return refreshAndRender(); }, [board, d]);
    const openView = (id, d) => p.evaluate(([id, d]) => { D().activeBoardId = ({ OVERVIEW_ID, ORGCHART_ID, EMPLIST_ID })[id]; state.date = d; return refreshAndRender(); }, [id, d]);
    const boardRow = (name) => p.locator(".ov-boards-table tbody tr", { has: p.locator(".ov-table-label", { hasText: new RegExp("^" + name) }) });

    await step("Overview By board: Headcount says who is borrowed and who is lent out", async () => {
      await openView("OVERVIEW_ID", SRC);
      await p.locator(".ov-boards-table").waitFor();
      const cells = async (name) => (await boardRow(name).locator("td").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
      assert.equal((await cells("Board One"))[3], "7 1 lent out");
      assert.equal((await cells("Board Two"))[3], "3 incl. 1 borrowed");
      assert.equal((await cells("Board Three"))[3], "0");
      assert.equal((await cells("All boards"))[3], "10 1 on loan");
      const cards = await p.locator(".ov-bcard-loan").allInnerTexts();
      assert.deepEqual(cards, ["1 lent out", "incl. 1 borrowed", "1 on loan"]);
    });

    await step("idle names: someone borrowed and idle carries the loan pill", async () => {
      const chip = p.locator(".ov-attn-group", { hasText: "Board Two" }).locator(".ov-mini", { hasText: "Person C" });
      assert.equal(await chip.evaluate((el) => el.classList.contains("borrowed")), true);
      assert.equal(await chip.locator(".ov-loan-pill").innerText(), "↔ Board One");
      assert.match(await chip.getAttribute("title"), /On loan from Board One/);
      const own = p.locator(".ov-attn-group", { hasText: "Board Two" }).locator(".ov-mini", { hasText: "Person I" });
      assert.equal(await own.locator(".ov-loan-pill").count(), 0);
    });

    await step("Loans today: who, from where to where, until when, and what they do there", async () => {
      const rows = p.locator(".ov-loans-table tbody tr");
      assert.equal(await rows.count(), 1);
      const t = (await rows.first().innerText()).replace(/\s+/g, " ");
      assert.match(t, /Person C Permanent Board One → Board Two today only/);
      assert.match(t, /Audit/);
      assert.match(t, /idle$/);
      // placed on a mission there, the row says which
      db.seed("missions", [{ id: "s201", board_id: "b2", plan_date: SRC, number: "201", host: "Host Alpha", customer: "Cust Alpha", shift: "night", engineer_id: "eng-1" }]);
      db.seed("assignments", [{ employee_id: "e3", plan_date: SRC, mission_id: "s201", zone: null }]);
      await p.evaluate(async (d) => { await cloud.ensurePlanLoaded("b2", d, { force: true }); render(); }, SRC);
      assert.match((await rows.first().innerText()).replace(/\s+/g, " "), /on mission 201, night$/);
      await rows.first().click();
      await p.waitForFunction(() => D().activeBoardId === "b2");
    });

    await step("Loans today follows By board until it has its own permission row, and can be switched off", async () => {
      assert.ok(PERM_KEYS_OK(await p.evaluate(() => PERM_AREAS.flatMap((g) => g.items.map((i) => i.key)))));
      await openView("OVERVIEW_ID", SRC);
      assert.equal(await p.evaluate(() => D().perms.engineer["ov.loans"]), undefined, "the harness seeds no ov.loans row");
      assert.equal(await p.locator(".ov-loans-table").count(), 1);
      await p.evaluate(() => { D().perms.engineer["ov.loans"] = "none"; render(); });
      assert.equal(await p.locator(".ov-loans-table").count(), 0);
      await p.evaluate(() => { delete D().perms.engineer["ov.loans"]; render(); });
    });

    await step("phone summary: Total says it too", async () => {
      await open("b2", SRC);
      assert.equal(await p.locator("#m-details .md-loan").innerText(), "incl. 1 borrowed");
      await open("b1", SRC);
      assert.equal(await p.locator("#m-details .md-loan").innerText(), "1 lent out");
    });

    await step("Org Chart: borrowed people carry their board, lent-out people are named but not counted", async () => {
      await openView("ORGCHART_ID", SRC);
      const r = await p.evaluate(() => {
        const t = buildOrgTree();
        const flat = (n) => [n, ...n.children.flatMap(flat)];
        const b1 = t.children.find((b) => b.name === "Board One"), b2 = t.children.find((b) => b.name === "Board Two");
        const lent = b1.children.find((n) => n.lentOut);
        const inB2 = flat(b2).find((n) => n.type === "employee" && n.name === "Person C");
        return {
          lentNames: lent.children.map((n) => [n.name, n.status, n.loan]), lentCount: orgCountText(lent),
          b1Crew: orgCrewCount(b1), b2Loan: inB2 && inB2.loan,
          own: flat(b2).filter((n) => n.type === "employee" && n.name !== "Person C").map((n) => n.loan),
          // the export follows what is open on screen: open everything first
          pptx: (org.collapsed.clear(), orgPptxBoards()).flatMap(flat).filter((n) => n.loan).map((n) => n.loan).sort(),
          statuses: org.filterOpts.statuses.map((s) => s.name),
        };
      });
      assert.deepEqual(r.lentNames, [["Person C", "lent", "→ Board Two"]]);
      assert.equal(r.lentCount, "1 lent out");
      assert.equal(r.b1Crew, 7, "Board One's crew leaves the lent-out person out");
      assert.equal(r.b2Loan, "↔ Board One");
      assert.deepEqual(r.own, ["", ""]);
      assert.deepEqual(r.pptx, ["→ Board Two", "↔ Board One"]);
      assert.ok(r.statuses.includes("Lent out (1)"), r.statuses.join(" | "));
    });

    await step("Manpower List: an On loan chip narrows the list, and the Excel rows carry the loan", async () => {
      await openView("EMPLIST_ID", SRC);
      const chip = p.locator("#board-status .status-chip", { hasText: "on loan" });
      assert.match((await chip.innerText()).replace(/\s+/g, " "), /^1 on loan$/);
      await chip.click();
      await p.waitForFunction(() => document.querySelectorAll("#emplist-body tr[data-emp-id]").length === 1);
      assert.equal(await p.locator("#emplist-body tr[data-emp-id]").getAttribute("data-emp-id"), "e3");
      const row = await p.evaluate(() => emplistXlsxRows()[0]);
      assert.deepEqual([row.board, row.loanTo, row.loanFrom, row.loanUntil], ["Board One", "Board Two", SRC, SRC]);
      await p.locator("#board-status .status-chip", { hasText: "on loan" }).click();
      await p.waitForFunction(() => document.querySelectorAll("#emplist-body tr[data-emp-id]").length === 10);
      const others = await p.evaluate(() => emplistXlsxRows().filter((r) => r.loanTo).length);
      assert.equal(others, 1);
    });

    await step("Deleting a board: refused while someone is on loan to it, past loans named in the confirm", async () => {
      const msg = async (loans) => {
        await p.evaluate((ls) => { window.__keep = D().loans; D().loans = ls; confirmDeleteBoard(D().boards.find((b) => b.id === "b3")); }, loans);
        const out = [await p.locator("#confirm-title").innerText(), await p.locator("#confirm-message").innerText()];
        await p.evaluate(() => closeModal());
        await p.evaluate(() => { D().loans = window.__keep; });
        return out;
      };
      const loan = (start, end) => ({ id: "x", employeeId: "e6", toBoardId: "b3", startDate: start, endDate: end, note: "" });
      const [t1, m1] = await msg([loan(SRC, D1)]);
      assert.equal(t1, "Cannot delete");
      assert.match(m1, /1 person is on loan to Board Three now or later\. End that loan first/);
      const past = h.addDays(T, -10);
      const [t2, m2] = await msg([loan(past, past)]);
      assert.equal(t2, "Delete Board Three?");
      assert.match(m2, /Its 1 past loan goes with it, so History counts those days on the lenders' own boards\./);
      const [, m3] = await msg([]);
      assert.doesNotMatch(m3, /past loan/);
      assert.ok(db.t("boards").some((b) => b.id === "b3"), "nothing deleted");
    });

    await step("a hold notice's Open day goes to the board they worked on that day", async () => {
      const r = await p.evaluate(([s, d1]) => [eventBoardId({ employeeId: "e3", date: s }), eventBoardId({ employeeId: "e3", date: d1 })], [SRC, D1]);
      assert.deepEqual(r, ["b2", "b1"]);
    });

    await step("a loan into forecast days: marked on its own board's forecast, and the Lend dialog says so", async () => {
      const FD = await p.evaluate(() => addDays(horizonEndFor("b1"), 1));
      const FDw = h.isWeekend(FD) ? h.nextWorking(FD) : FD;
      await p.evaluate(([s, fd]) => cloud.setLoan(["e6"], "b2", s, fd, ""), [SRC, FDw]);
      await open("b1", FDw);
      assert.equal(await p.evaluate(() => isForecastView()), true);
      const card = p.locator('.emp-card[data-emp-id="e6"]').first();
      await card.waitFor();
      assert.equal(await card.evaluate((el) => el.classList.contains("lent-fc")), true);
      assert.equal(await card.locator(".emp-loan").innerText(), "→ Board Two");
      assert.match(await card.getAttribute("title"), /A forecast leaves loans out/);
      // Board Two's forecast doesn't take them (the database only takes a forecast place on their own board)
      await open("b2", FDw);
      assert.equal(await p.locator('.emp-card[data-emp-id="e6"]').count(), 0);
      // and on a confirmed day they are lent out as usual
      await open("b1", SRC);
      await p.locator('#lent-body .emp-card[data-emp-id="e6"]').waitFor();
      await p.evaluate(() => openLendModal(["e7"]));
      await p.locator("#modal-lend").waitFor({ state: "visible" });
      await p.fill("#lend-until", FDw);
      await p.waitForFunction(() => /are still a forecast/.test(document.querySelector("#lend-notes").innerText));
      assert.match(await p.locator("#lend-notes").innerText(), /Board Two's days after .* are still a forecast, which leaves loans out/);
      await p.fill("#lend-until", SRC);
      await p.waitForFunction(() => !/are still a forecast/.test(document.querySelector("#lend-notes").innerText));
      await p.keyboard.press("Escape");
      // the forecast merge names who it leaves out
      const note = await p.evaluate((d) => {
        const list = forecastLentAway("b1", d, { missions: [{ members: ["e6", "e1"] }], zones: { annual: ["e5"] } });
        const el = document.createElement("p");
        setLentAwayNote(el, list, d);
        return [list.map((e) => e.id), el.textContent];
      }, SRC);
      assert.deepEqual(note[0], ["e6"]);
      assert.equal(note[1], "Lent to another board on this day, so their places in the forecast are left out: Person F → Board Two.");
    });

    await step("a board whose day is confirmed counts a loan even while the lender's day is still a forecast", async () => {
      const r = await p.evaluate((d1) => {
        const orig = window.isForecastDateFor;
        // the lender (Board One) works another week, so its day is a forecast while Board Two's is confirmed
        window.isForecastDateFor = (b, d) => (b === "b1" ? d >= d1 : false);
        try {
          const e6 = D().employees.find((e) => e.id === "e6");
          state.date = d1;
          return [worksOn(e6, "b2", d1), worksOn(e6, "b1", d1), boardEmployees("b2").some((e) => e.id === "e6"), planBoardOf(e6, d1)];
        } finally { window.isForecastDateFor = orig; }
      }, D1);
      assert.deepEqual(r, [true, true, true, "b1"]);
    });

    await step("in Thai, the new Overview text leaves no English behind", async () => {
      await openView("OVERVIEW_ID", SRC);
      await p.evaluate(() => I18N.setLang("th"));
      await p.waitForTimeout(200);
      const shown = await p.evaluate(() => [...document.querySelectorAll(".ov-loans-table, .ov-boards-table, .ov-board-cards")]
        .map((el) => el.innerText).join("\n") + "\n" + [...document.querySelectorAll("#overview-panel .ov-section-sub")].map((el) => el.innerText).join("\n"));
      const english = shown.replace(/Board (One|Two|Three)|Person [A-J]|Audit/g, "").match(/[A-Za-z]{2,}/g) || [];
      assert.deepEqual(english, [], shown);
      // the Lend dialog's forecast note, the merge note and the Manpower chip
      await open("b1", SRC);
      const FD = await p.evaluate(() => addDays(horizonEndFor("b2"), 3));
      await p.evaluate(() => openLendModal(["e7"]));
      await p.fill("#lend-until", FD);
      await p.waitForTimeout(200);
      const more = [await p.locator("#lend-notes").innerText()];
      await p.keyboard.press("Escape");
      more.push(await p.evaluate((d) => {
        const el = document.querySelector("#merge-loans");
        setLentAwayNote(el, [D().employees.find((e) => e.id === "e6")], d);
        return new Promise((r) => setTimeout(() => r(el.textContent), 100));
      }, SRC));
      await openView("EMPLIST_ID", SRC);
      more.push(await p.locator("#board-status").innerText());
      assert.match(more[0], /ยังเป็นฟอร์แคสต์/, "the forecast note is there, in Thai");
      assert.match(more[1], /ให้ยืมไปบอร์ดอื่นในวันนี้/);
      assert.match(more[2], /ถูกให้ยืม/);
      const left = more.join("\n").replace(/Board (One|Two|Three)|Person [A-J]|TRIGO|ID/g, "").match(/[A-Za-z]{2,}/g) || [];
      assert.deepEqual(left, [], more.join("\n"));
      await p.evaluate(() => I18N.setLang("en"));
    });

    await step("Manpower 30D utilization: a day worked on a borrowing board that works Saturdays counts", async () => {
      // the latest Saturday in the 30-day window
      let sat = T;
      while (new Date(sat + "T00:00:00").getDay() !== 6) sat = h.addDays(sat, -1);
      const dbU = new h.FakeDb();
      h.seedBase(dbU, { src: SRC });
      dbU.t("boards").find((b) => b.id === "b2").weekend_days = [0];
      dbU.seed("missions", [{ id: "sat1", board_id: "b2", plan_date: sat, number: "301", host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" }]);
      dbU.seed("assignments", [{ employee_id: "e3", plan_date: sat, mission_id: "sat1", zone: null }]);
      dbU.seed("employee_loans", [{ id: "loan-sat", employee_id: "e3", to_board_id: "b2", start_date: sat, end_date: sat, note: null, created_by: "eng.a@example.com" }]);
      const u = await env.openAs(dbU, h.USERS.a);
      await u.page.evaluate(() => { D().activeBoardId = EMPLIST_ID; return refreshAndRender(); });
      await u.page.waitForFunction(() => state.emplist.util && state.emplist.util.e3 != null);
      const got = await u.page.evaluate(() => state.emplist.util.e3);
      let weekdays = 0;
      for (let d = h.addDays(T, -29); d <= T; d = h.addDays(d, 1)) if (!h.isWeekend(d)) weekdays++;
      // worked: 102 on SRC and 301 on that Saturday, out of the weekdays plus that Saturday
      assert.equal(got, Math.round((2 / (weekdays + 1)) * 100));
      assert.deepEqual(u.errors, []);
      await u.close();
    });

    await step("no page errors", async () => {
      assert.deepEqual(a.errors, []);
    });
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
  }
  process.exit(failed ? 1 : 0);
})();

function PERM_KEYS_OK(keys) { return keys.includes("ov.loans") && keys.indexOf("ov.loans") === keys.indexOf("ov.byBoard") + 1; }
