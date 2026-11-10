/* Acceptance run for the three list tables (Manpower, Host, Missions) after design/handover-list-tabs.md, Batch B:
     - two lines per row, every row the same height, one column order (checkbox, identity, status over alert,
       board and area, then the tab's own columns, then ⋯), and none of the tables scrolls sideways at 1366 px;
     - every header sorts, and so does every optional column Columns can add;
     - Columns on all three tabs: optional columns are off until chosen, a default column can be hidden except the
       identity and the status, and the choice survives a reload;
     - a click on a row opens its record; the Status switches are gone (Deactivate / Archive are in ⋯ and the bulk bar);
     - the new chips: "high leave" on Manpower and "at risk" on Host, each counting and filtering;
     - a viewer sees no checkboxes, no "+ Add" and a ⋯ with read actions only;
     - on a phone (390 px) the tables are still cards with the same fields and nothing scrolls sideways.
   It runs the app on its own sample data (/?demo), as demo-mode.e2e.js does.
     NODE_PATH=$(npm root -g) node tests/e2e/list-tables.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json" };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(ROOT, url === "/" ? "index.html" : url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 6).join("\n   ")); throw e; }
}

const TABS = {
  emplist: { id: "EMPLIST_ID", table: "#emplist-table", body: "#emplist-body", render: "renderEmployeeRows" },
  hostlist: { id: "HOSTLIST_ID", table: "#hostlist-table", body: "#hostlist-body", render: "renderHostRows" },
  missions: { id: "MISSIONS_ID", table: "#missions-table", body: "#missions-body", render: "renderMissionList" },
};

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const open = async (query, viewport = { width: 1366, height: 900 }) => {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.goto(base + query);
    await page.waitForFunction(() => typeof state !== "undefined" && typeof D === "function" && D() && D().employees && D().employees.length, null, { timeout: 20000 });
    return { ctx, page, errors };
  };
  const go = async (p, tab) => {
    await p.evaluate((id) => { D().activeBoardId = eval(id); return refreshAndRender(); }, TABS[tab].id);
    await p.waitForSelector(`${TABS[tab].body} tr`);
    await p.waitForTimeout(500);
  };
  const heads = (p, tab) => p.locator(`${TABS[tab].table} thead th`).evaluateAll((ths) => ths.filter((t) => t.offsetParent !== null).map((t) => t.textContent.replace(/\s+/g, " ").trim()));
  let failed = false;
  try {
    const a = await open("?demo");
    const p = a.page;

    await step("the three tables: one column order, two lines per row, every row the same height, no sideways scroll at 1366 px", async () => {
      const want = {
        emplist: ["", "Person", "Status", "Board and area", "Contract", "Mobile", "30D utilization", "Worked · Leave", ""],
        hostlist: ["", "Host", "Status", "Board and area", "People who know the site", "Last worked", "Note", ""],
        missions: ["", "Mission", "Status", "Board and area", "Host and responsible", "Shift", "On the board", "Crew 11 Nov", "Note", ""],
      };
      for (const tab of Object.keys(TABS)) {
        await go(p, tab);
        const h = await heads(p, tab);
        // the crew header carries the day on screen
        assert.deepEqual(h.map((x) => x.replace(/ \d+ \w{3}$/, "")), want[tab].map((x) => x.replace(/ \d+ \w{3}$/, "")), `${tab} columns: ${h.join(" | ")}`);
        const m = await p.evaluate(({ table }) => {
          const t = document.querySelector(table), w = t.parentElement;
          const rows = [...t.querySelectorAll("tbody tr")].map((r) => Math.round(r.getBoundingClientRect().height));
          return { heights: [...new Set(rows)], n: rows.length, scroll: w.scrollWidth > w.clientWidth || w.classList.contains("tw-scroll"), page: document.documentElement.scrollWidth - innerWidth };
        }, TABS[tab]);
        assert.ok(m.n > 3, `${tab}: rows`);
        assert.equal(m.heights.length, 1, `${tab}: every row is one height (${m.heights.join(", ")} px)`);
        assert.equal(m.scroll, false, `${tab}: no sideways scroll at 1366 px`);
        assert.equal(m.page, 0, `${tab}: the page does not scroll sideways`);
        // identity, status, board and area are two-line cells; the status pill is on line 1
        const first = p.locator(`${TABS[tab].body} tr`).first();
        assert.ok(await first.locator("td .lt-c .lt-l1").count() >= 3, `${tab}: two-line cells`);
        assert.equal(await first.locator("td[data-col=status] .lt-l1 .lt-st").count(), 1, `${tab}: one status pill, on line 1`);
        assert.equal(await first.locator("td[data-col=boardarea] .lt-l1 .lt-bd").count(), 1, `${tab}: the board tag, on line 1`);
        assert.equal(await first.locator("td[data-col=actions]").count(), 1, `${tab}: a last column for ⋯`);
      }
    });

    await step("Manpower: no Status switch; the alert is under the pill; Deactivate and Activate are in the ⋯ menu", async () => {
      await go(p, "emplist");
      assert.equal(await p.locator("#emplist-body .toggle, #emplist-body .el-status input").count(), 0, "no switch in the table");
      // someone without a TRIGO ID and a service area, active: an amber alert on line 2 of the Status cell
      await p.evaluate(() => { const e = D().employees.find((x) => x.active !== false); e.trigoId = ""; e.areaId = null; window.__e = e.id; return refreshAndRender(); });
      const tr = p.locator("#emplist-body tr").filter({ has: p.locator(".lt-name") }).first();
      const row = p.locator(`#emplist-body tr[data-emp-id="${await p.evaluate(() => window.__e)}"]`);
      const al = row.locator("td.el-status .lt-l2 .lt-al");
      assert.equal(await al.count(), 1);
      assert.match(await al.innerText(), /No (TRIGO ID|service area)/);
      assert.match(await row.locator("td.el-status .lt-l2 .lt-more").innerText(), /^\+1$/, "the worst alert and a +1");
      assert.equal(await row.locator("td.el-status .lt-l2 button").count(), 0, "the alert is not a button");
      // ⋯: Profile, Lend / Move, Deactivate
      await row.locator(".lt-dots").click();
      const items = (await p.locator("#context-menu .ctx-item").allInnerTexts()).map((t) => t.trim());
      assert.ok(items.includes("Profile") && items.some((t) => /^(Lend to board|Move to board)/.test(t)) && items.includes("Deactivate employee"), items.join(" | "));
      await p.locator("#context-menu .ctx-item", { hasText: "Deactivate employee" }).click();
      await p.waitForSelector("#modal-deactivate:not(.hidden)");
      await p.locator("#btn-deactivate-yes").click();
      await p.waitForFunction((id) => D().employees.find((x) => x.id === id).active === false, await p.evaluate(() => window.__e));
      assert.match(await row.locator("td.el-status .lt-st").innerText(), /Inactive/);
      await row.locator(".lt-dots").click();
      assert.equal(await p.locator("#context-menu .ctx-item", { hasText: "Activate employee" }).count(), 1, "an inactive person has Activate");
      await p.locator("#context-menu .ctx-item", { hasText: "Activate employee" }).click();
      await p.waitForFunction((id) => D().employees.find((x) => x.id === id).active !== false, await p.evaluate(() => window.__e));
      void tr;
    });

    await step("Manpower: the \"high leave\" chip counts the people above 20% and filters to them; the alert reads Leave NN%", async () => {
      await go(p, "emplist");
      assert.equal(await p.locator("#board-status .status-chip", { hasText: "high leave" }).count(), 0, "none above 20% in the sample");
      await p.evaluate(() => {
        const ids = D().employees.filter((x) => x.active !== false).slice(0, 2).map((x) => x.id);
        state.emplist.wl = state.emplist.wl || {};
        state.emplist.wl[ids[0]] = { worked: 10, leave: 7, working: 20, share: 35 };
        state.emplist.wl[ids[1]] = { worked: 12, leave: 5, working: 20, share: 25 };
        window.__lv = ids;
        renderEmployeeRows(); renderStats();
      });
      const chip = p.locator("#board-status .status-chip", { hasText: "high leave" });
      assert.equal((await chip.locator("b").innerText()).trim(), "2");
      const [red, amber] = await p.evaluate(() => window.__lv);
      assert.match(await p.locator(`#emplist-body tr[data-emp-id="${red}"] td.el-status .lt-al`).first().innerText(), /Leave 35%/);
      assert.equal(await p.locator(`#emplist-body tr[data-emp-id="${red}"] td.el-status .lt-al-bad`).count(), 1, "red above 30%");
      assert.equal(await p.locator(`#emplist-body tr[data-emp-id="${amber}"] td.el-status .lt-al-warn`).count() >= 1, true, "amber from 20%");
      await chip.click();
      assert.equal(await p.locator("#emplist-body tr").count(), 2, "the chip filters to those two");
      await p.locator("#board-status .status-chip", { hasText: "high leave" }).click();
      assert.ok(await p.locator("#emplist-body tr").count() > 2, "and again shows everyone");
    });

    await step("Host: Active / Archived pill with the alert under it; \"at risk\" chip counts and filters; no switch", async () => {
      await go(p, "hostlist");
      assert.equal(await p.locator("#hostlist-body .toggle, #hostlist-body .hl-edit").count(), 0, "no switch and no pencil");
      const risk = await p.locator("#hostlist-body tr td.el-status .lt-al-bad, #hostlist-body tr td.hl-status .lt-al-bad").count();
      assert.ok(risk >= 1, "a red alert on a host that is at risk");
      assert.match(await p.locator("#hostlist-body td.hl-status .lt-al-bad").first().innerText(), /^\d+ experienced$/);
      assert.ok(await p.locator("#hostlist-body td.hl-status .lt-al-warn", { hasText: "No location" }).count() >= 1, "an amber No location");
      const chip = p.locator("#board-status .status-chip", { hasText: "at risk" });
      assert.equal(Number((await chip.locator("b").innerText()).trim()), risk, "the chip counts them");
      await chip.click();
      assert.equal(await p.locator("#hostlist-body tr").count(), risk, "and filters to them");
      await p.locator("#board-status .status-chip", { hasText: "at risk" }).click();
      assert.ok(await p.locator("#hostlist-body tr").count() > risk);
      // the numbers equal the Skills matrix's
      const same = await p.evaluate(() => hostMatrixRows().filter((m) => m.x.atRisk).length);
      assert.equal(same, risk, "the same hosts the Skills matrix calls at risk");
    });

    await step("a click on a row opens its record: the profile, the host form, the mission panel", async () => {
      await go(p, "emplist");
      await p.locator("#emplist-body tr").nth(2).locator("td.el-name").click();
      await p.waitForSelector("#modal-profile:not(.hidden) .ov-prof-details");
      await p.evaluate(() => closeModal());
      await go(p, "hostlist");
      await p.locator("#hostlist-body tr").nth(1).locator("td.hl-name").click();
      await p.waitForSelector("#modal-host:not(.hidden)");
      await p.evaluate(() => closeModal());
      await go(p, "missions");
      await p.locator("#missions-body tr").nth(1).locator("td.ml-first").click();
      await p.waitForSelector("#mission-detail:not(.hidden)");
      await p.evaluate(() => closeModal());
      // a link, a button or a checkbox in the row does not open it
      await go(p, "missions");
      await p.locator("#missions-body tr").nth(1).locator("td.el-check input").check();
      assert.equal(await p.locator("#modal-mission:not(.hidden)").count(), 0, "ticking a row opens nothing");
      await p.locator("#missions-body tr").nth(1).locator("td.el-check input").uncheck();
    });

    await step("Host: the bulk bar archives and reactivates the ticked hosts; the ⋯ menu has Edit, Open map, Archive", async () => {
      await go(p, "hostlist");
      const names = await p.locator("#hostlist-body tr").evaluateAll((trs) => trs.slice(0, 2).map((t) => t.dataset.host));
      for (const n of names) await p.locator(`#hostlist-body tr[data-host="${n}"] .el-check input`).check();
      assert.equal(await p.locator("#hostlist-bulkbar").isVisible(), true);
      assert.match(await p.locator("#hostlist-bulk-count").innerText(), /2 selected/);
      await p.click("#hostlist-bulk-archive");
      await p.waitForFunction((ns) => ns.every((n) => allHostRows().find((r) => r.name === n).archived), names);
      for (const n of names) assert.match(await p.locator(`#hostlist-body tr[data-host="${n}"] td.hl-status .lt-st`).innerText(), /Archived/);
      assert.equal(await p.locator("#hostlist-bulkbar").isVisible(), false, "the selection is cleared");
      await p.locator(`#hostlist-body tr[data-host="${names[0]}"] .lt-dots`).click();
      const items = (await p.locator("#context-menu .ctx-item").allInnerTexts()).map((t) => t.trim());
      assert.ok(items.includes("Edit") && items.includes("Make active") && items.includes("Open map"), items.join(" | "));
      await p.locator("#context-menu .ctx-item", { hasText: "Make active" }).click();
      await p.waitForFunction((n) => !allHostRows().find((r) => r.name === n).archived, names[0]);
      await p.locator(`#hostlist-body tr[data-host="${names[1]}"] .el-check input`).check();
      await p.click("#hostlist-bulk-activate");
      await p.waitForFunction((n) => !allHostRows().find((r) => r.name === n).archived, names[1]);
    });

    await step("Missions: the bulk bar closes the ticked missions on one last working day; a row's own Close… still works", async () => {
      await go(p, "missions");
      const nums = await p.locator("#missions-body tr .ml-num").evaluateAll((els) => els.slice(2, 4).map((e) => e.textContent));
      for (const n of nums) await p.locator("#missions-body tr", { has: p.locator(`.ml-num:text-is("${n}")`) }).locator(".el-check input").check();
      assert.equal(await p.locator("#missions-bulkbar").isVisible(), true);
      await p.click("#missions-bulk-close");
      await p.waitForSelector("#modal-close-mission:not(.hidden)");
      assert.match(await p.locator("#close-mission-title").innerText(), /Close 2 missions/);
      await p.click("#form-close-mission button[type=submit]");
      await p.waitForFunction((ns) => ns.every((n) => D().register.find((r) => r.number === n).status === "closed"), nums);
      assert.equal(await p.locator("#missions-bulkbar").isVisible(), false);
    });

    await step("every header sorts, and so does every optional column; Columns adds and hides them, and keeps the choice", async () => {
      for (const tab of Object.keys(TABS)) {
        await go(p, tab);
        const cfg = TABS[tab];
        // all optional columns on, so every one has a header to click
        await p.evaluate(([t, fn]) => { for (const c of LIST_COLS[t].cols) if (c.opt && (!c.wl || emplistShowsWl())) state.listCols[t][c.k] = true; return eval(fn)(); }, [tab, cfg.render]);
        const sorts = await p.locator(`${cfg.table} thead th[data-sort]`).evaluateAll((ths) => ths.filter((t) => t.offsetParent !== null).map((t) => t.dataset.sort));
        assert.ok(sorts.length >= 8, `${tab}: sortable headers ${sorts.join(", ")}`);
        for (const key of new Set(sorts)) {
          const th = p.locator(`${cfg.table} thead th[data-sort="${key}"]:visible`).first();
          await th.click();
          await p.waitForTimeout(60);
          const th2 = p.locator(`${cfg.table} thead th[data-sort="${key}"]:visible`).first();
          assert.ok(await th2.evaluate((el) => /sorted/.test(el.className)), `${tab}: ${key} is the sorted column`);
          await th2.click();   // and the other way round
        }
        // Columns: the optional ones are in the list, the identity and the status are not
        await p.evaluate(() => { for (const t of Object.keys(state.listCols)) state.listCols[t] = {}; });
        await p.evaluate((fn) => eval(fn)(), cfg.render);
        await p.evaluate(() => closeTopbarMenus());
        await p.click(`#btn-${tab}-cols`);
        await p.waitForSelector(`#${tab}-cols-pop:not(.hidden)`);
        const keys = await p.locator(`#${tab}-cols-pop input[data-col]`).evaluateAll((els) => els.map((e) => e.dataset.col));
        const fixed = { emplist: ["person", "status"], hostlist: ["host", "status"], missions: ["mission", "status"] }[tab];
        for (const k of fixed) assert.ok(!keys.includes(k), `${tab}: ${k} cannot be hidden`);
        const optKey = await p.evaluate((t) => LIST_COLS[t].cols.find((c) => c.opt && !c.wl).k, tab);
        const defKey = await p.evaluate((t) => LIST_COLS[t].cols.find((c) => !c.fixed && !c.opt && c.k !== "check").k, tab);
        assert.equal(await p.locator(`${cfg.table} thead th[data-col="${optKey}"]`).isVisible(), false, `${tab}: ${optKey} is off by default`);
        await p.locator(`#${tab}-cols-pop input[data-col="${optKey}"]`).check();
        await p.locator(`#${tab}-cols-pop input[data-col="${defKey}"]`).uncheck();
        assert.equal(await p.locator(`${cfg.table} thead th[data-col="${optKey}"]`).isVisible(), true);
        assert.equal(await p.locator(`${cfg.table} thead th[data-col="${defKey}"]`).isVisible(), false);
        // a reload reads the choice back from the device
        await p.evaluate(() => { state.listCols = { emplist: {}, hostlist: {}, missions: {} }; loadListColumns(); });
        await p.evaluate((fn) => eval(fn)(), cfg.render);
        assert.equal(await p.locator(`${cfg.table} thead th[data-col="${optKey}"]`).isVisible(), true, `${tab}: the choice survives a reload`);
        assert.equal(await p.locator(`${cfg.table} thead th[data-col="${defKey}"]`).isVisible(), false);
        await p.evaluate(() => closeTopbarMenus());
        await p.click(`#btn-${tab}-cols`);
        await p.locator(`#${tab}-cols-pop [data-cols-reset]`).click();
        assert.equal(await p.locator(`${cfg.table} thead th[data-col="${optKey}"]`).isVisible(), false, `${tab}: Reset columns`);
        await p.evaluate(() => closeTopbarMenus());
      }
    });

    await step("no page errors on the way", async () => { assert.deepEqual(a.errors, []); });
    await a.ctx.close();

    await step("a viewer: no checkboxes, no \"+ Add\", and a ⋯ with read actions only", async () => {
      const v = await open("?demo&role=viewer");
      const vp = v.page;
      for (const tab of Object.keys(TABS)) {
        await go(vp, tab);
        assert.equal(await vp.locator(`${TABS[tab].body} .el-check input`).count(), 0, `${tab}: no row checkboxes`);
        assert.equal(await vp.locator(`${TABS[tab].table} thead .el-check input`).isVisible(), false, `${tab}: no select-all`);
        assert.equal(await vp.locator(`${TABS[tab].body} .lt-add`).count(), 0, `${tab}: no + Add`);
      }
      await go(vp, "emplist");
      await vp.locator("#emplist-body tr").first().locator(".lt-dots").click();
      const items = (await vp.locator("#context-menu .ctx-item").allInnerTexts()).map((t) => t.trim());
      assert.deepEqual(items, ["Profile"], "Manpower: the viewer's ⋯ is the Profile");
      await vp.keyboard.press("Escape");
      await vp.evaluate(() => hideContextMenu());
      await go(vp, "hostlist");
      const withMenu = vp.locator("#hostlist-body tr .lt-dots");
      if (await withMenu.count()) {
        await withMenu.first().click();
        const hi = (await vp.locator("#context-menu .ctx-item").allInnerTexts()).map((t) => t.trim());
        assert.deepEqual(hi, ["Open map"], "Host: Open map only");
      }
      assert.equal(await vp.locator("#hostlist-body tr").evaluateAll((trs) => trs.filter((t) => !t.querySelector(".lt-dots")).length) >= 1, true, "a host with no map link has no ⋯ at all");
      assert.deepEqual(v.errors, []);
      await v.ctx.close();
    });

    await step("phone, 390 px: the tables are cards with the same fields, the new chips, and nothing scrolls sideways", async () => {
      const m = await open("?demo", { width: 390, height: 844 });
      const mp = m.page;
      for (const tab of Object.keys(TABS)) {
        await mp.evaluate((id) => { D().activeBoardId = eval(id); return refreshAndRender(); }, TABS[tab].id);
        await mp.waitForSelector(`${TABS[tab].body} tr`);
        await mp.waitForTimeout(400);
        assert.equal(await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `${tab}: no sideways scroll`);
        // a card: every field once, labelled; a second line that repeats a field of its own is not drawn
        const card = mp.locator(`${TABS[tab].body} tr`).first();
        if (await card.locator(".m-fold").count()) await card.locator(".m-fold").click();   // the rarer fields are folded behind "More details", as before
        const labels = await card.locator("td[data-label]").evaluateAll((tds) => tds.filter((t) => t.offsetParent !== null).map((t) => t.dataset.label));
        const need = {
          emplist: ["Name", "Status", "Current board", "Contract type", "Mobile number", "Service area"],
          hostlist: ["Host name", "Status", "Location", "Service area", "Note"],
          missions: ["Status", "Board", "Host", "Shift", "Customer", "Trigo responsible", "Time", "Start date", "Last on board", "Crew", "Avg crew / week"],
        }[tab];
        for (const l of need) assert.ok(labels.includes(l), `${tab} card: ${l} in ${labels.join(", ")}`);
        assert.equal(await card.locator(".lt-l2:not(.lt-keep)").evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length), 0, `${tab} card: no repeated second lines`);
        assert.ok(await card.locator(".lt-st").first().isVisible(), `${tab} card: the status pill`);
      }
      assert.deepEqual(m.errors, []);
      await m.ctx.close();
    });
  } catch (e) { failed = true; }
  await browser.close();
  server.close();
  if (failed) process.exit(1);
  console.log("all list-tables checks passed");
})();
