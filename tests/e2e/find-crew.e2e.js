/* Acceptance run for crew by host history (design/host-crew-finder-proposal.html: H1, H2, A1 to A4):
     - Find crew on a mission sorts the available-people panel by days at its host, the days on each card;
     - Bring back the last crew and Suggest crew fill a mission from the people who are free, with Undo;
     - a crew that is all new to its host says so on the card;
     - moving someone from a mission to leave offers Find replacement;
     - the Host record lists the people with their days, last day and where they are on the day on screen,
       filters them, and assigns a free one on their board;
     - a viewer has none of the actions; Thai shows no new English; a phone fits.
   It runs the app on its own sample data (/?demo), as demo-mode.e2e.js does.
     NODE_PATH=$(npm root -g) node tests/e2e/find-crew.e2e.js
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
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 8).join("\n   ")); throw e; }
}

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

  const S = (p) => p.evaluate(() => {
    const plan = getPlan();
    return { date: state.date, board: D().activeBoardId, missions: plan.missions.filter((m) => !m.hidden).map((m) => ({ id: m.id, number: m.number, host: m.host, members: m.members.slice() })) };
  });
  const menuItems = (p) => p.locator("#context-menu .ctx-item").allInnerTexts();
  const clickMenu = (p, text) => p.locator("#context-menu .ctx-item", { hasText: text }).click();
  const settle = (p) => p.waitForTimeout(450);
  let failed = false;
  try {
    const a = await open("?demo");
    const p = a.page;
    await p.waitForFunction(() => Object.keys(crewState.days).length > 0, null, { timeout: 10000 });
    const start = await S(p);
    // a mission with at least two people on it, to empty and fill again
    const M = start.missions.find((m) => m.members.length >= 2);
    const mid = M.id;
    const card = () => p.locator(`.mission-card[data-mission-id="${mid}"]`);
    const members = () => p.evaluate((id) => getPlan().missions.find((m) => m.id === id).members.slice().sort(), mid);
    const empty = async () => { await p.evaluate((id) => assignEmployeesTo(getPlan().missions.find((m) => m.id === id).members.slice(), null), mid); await settle(p); };

    await step("Find crew on an empty mission: the people panel is in order of days at its host, with the days on each card; × puts it back", async () => {
      await empty();
      assert.deepEqual(await members(), []);
      assert.equal(await card().locator(".m-empty-find").count(), 1, "the empty card has Find crew");
      await card().locator(".m-empty-find").click();
      const items = (await menuItems(p)).map((t) => t.trim());
      for (const t of ["Sort people by days at this host", "Bring back the last crew…", "Suggest crew…"]) assert.ok(items.includes(t), `${t} in ${JSON.stringify(items)}`);
      await clickMenu(p, "Sort people by days at this host");
      await p.waitForSelector("#crew-lens:not(.hidden)");
      assert.equal((await p.locator("#crew-lens-host").innerText()).trim(), M.host);
      const pools = await p.evaluate((host) => ["standby", "oncall"].map((k) => [...document.querySelectorAll(`[data-pool="${k}"] .emp-card`)].map((c) => ({
        days: crewState.days[host][c.dataset.empId] || 0, badge: c.querySelector(".emp-hostdays").textContent }))), M.host);
      assert.ok(pools[0].length + pools[1].length >= 2, "there are people to sort");
      for (const pool of pools) {
        assert.deepEqual(pool.map((c) => c.days), pool.map((c) => c.days).slice().sort((x, y) => y - x), "most days first");
        for (const c of pool) assert.equal(c.badge, c.days ? `${c.days}d` : "new");
      }
      assert.ok(pools.flat().some((c) => c.days > 0), "the people just taken off know the host");
      // the same days as the Host tab's skills matrix
      await p.evaluate(() => ensureHostDirectoryLoaded());
      const same = await p.evaluate((host) => { const r = hostRowByName(host); return r.inspectors.every((i) => (crewState.days[host][i.id] || 0) === i.days); }, M.host);
      assert.ok(same, "the lens counts the days the Host tab counts");
      await p.locator("#crew-lens-off").click();
      assert.equal(await p.locator("#crew-lens:not(.hidden)").count(), 0);
      assert.equal(await p.locator(".emp-hostdays").count(), 0);
    });

    await step("Bring back the last crew: lists who was on it last time and adds the ones who are free", async () => {
      const last = await p.evaluate((id) => { const m = getPlan().missions.find((x) => x.id === id); return cloud.getMissionLastCrew(D().activeBoardId, cloud.numberChain(m.number), m.shift, state.date); }, mid);
      assert.ok(last && last.employeeIds.length, "the mission had a crew before");
      const free = await p.evaluate(() => unassignedEmployees().map((e) => e.id));
      const expect = last.employeeIds.filter((id) => free.includes(id)).sort();
      assert.ok(expect.length, "some of it is free");
      await card().locator(".m-empty-find").click();
      await clickMenu(p, "Bring back the last crew…");
      await p.waitForSelector("#modal-confirm:not(.hidden)");
      assert.match(await p.locator("#confirm-title").innerText(), new RegExp(`Bring back the last crew of ${M.number}\\?`));
      const msg = await p.locator("#confirm-message").innerText();
      assert.equal(msg.split("\n").filter((l) => /: /.test(l)).length, last.employeeIds.length, "one line per person: " + msg);
      assert.match(await p.locator("#btn-confirm-yes").innerText(), new RegExp(`Add ${expect.length === 1 ? "1 person" : expect.length + " people"}`));
      await p.locator("#btn-confirm-yes").click();
      await settle(p);
      assert.deepEqual(await members(), expect);
      // Undo takes them off again (one entry for the batch)
      await p.evaluate(() => undoLast());
      await settle(p);
      assert.deepEqual(await members(), []);
    });

    await step("Suggest crew: as many as the last crew, the people with the most days at the host first", async () => {
      const want = await p.evaluate(async (id) => {
        const m = getPlan().missions.find((x) => x.id === id);
        const last = await cloud.getMissionLastCrew(D().activeBoardId, cloud.numberChain(m.number), m.shift, state.date);
        await ensureCrewDays([m.host]);
        return crewCandidates(m).slice(0, last.employeeIds.length).map((c) => ({ id: c.e.id, days: c.days }));
      }, mid);
      assert.deepEqual(want.map((c) => c.days), want.map((c) => c.days).slice().sort((x, y) => y - x));
      await card().locator(".m-empty-find").click();
      await clickMenu(p, "Suggest crew…");
      await p.waitForSelector("#modal-confirm:not(.hidden)");
      assert.match(await p.locator("#confirm-title").innerText(), new RegExp(`Suggested crew for ${M.number}`));
      const lines = (await p.locator("#confirm-message").innerText()).split("\n").slice(1);
      assert.equal(lines.length, want.length);
      if (want[0].days > 1) assert.match(lines[0], new RegExp(`: ${want[0].days} days here`));
      await p.locator("#btn-confirm-yes").click();
      await settle(p);
      assert.deepEqual(await members(), want.map((c) => c.id).sort());
      // a mission that has its crew says so instead
      await p.evaluate((id) => suggestCrew(getPlan().missions.find((m) => m.id === id)), mid);
      await p.waitForFunction(() => [...document.querySelectorAll("#toast-stack .toast-msg")].some((t) => /as many as its last crew/.test(t.textContent)));
    });

    await step("a crew that is all new to the host says so on the card, until someone experienced joins it", async () => {
      assert.equal(await card().locator(".m-newcrew").count(), 0, "an experienced crew has no line");
      await empty();
      const pick = await p.evaluate((id) => {
        const m = getPlan().missions.find((x) => x.id === id), days = crewState.days[m.host], need = hostExperiencedDays();
        const free = unassignedEmployees();
        return { fresh: (free.find((e) => !(days[e.id] > 0)) || {}).id || null, exp: (free.find((e) => (days[e.id] || 0) >= need) || {}).id || null };
      }, mid);
      assert.ok(pick.fresh && pick.exp, "the board has someone new to the host and someone experienced, both free: " + JSON.stringify(pick));
      await p.evaluate(([e, id]) => assignEmployeesTo([e], { missionId: id }), [pick.fresh, mid]);
      await settle(p);
      assert.equal(await card().locator(".m-newcrew").count(), 1);
      assert.match(await card().locator(".m-newcrew").innerText(), /Crew new to this host/);
      // a click on it turns Find crew on for this host
      await card().locator(".m-newcrew").click();
      await p.waitForSelector("#crew-lens:not(.hidden)");
      await p.locator("#crew-lens-off").click();
      await p.evaluate(([e, id]) => assignEmployeesTo([e], { missionId: id }), [pick.exp, mid]);
      await settle(p);
      assert.equal(await card().locator(".m-newcrew").count(), 0);
      // not in an export
      assert.equal(await p.evaluate(() => { document.body.classList.add("exporting"); const n = [...document.querySelectorAll(".m-newcrew, .emp-hostdays")].filter((x) => getComputedStyle(x).display !== "none").length; document.body.classList.remove("exporting"); return n; }), 0);
    });

    await step("someone moved from a mission to leave: the toast offers Find replacement, which sorts the people by that host", async () => {
      const who = (await members())[0];
      await p.evaluate((e) => assignEmployeesTo([e], { zone: "annual" }), who);
      const toast = p.locator("#toast-stack .toast", { hasText: `left ${M.number} for Annual Leave` });
      await toast.waitFor();
      await toast.locator(".toast-action", { hasText: "Find replacement" }).click();
      await p.waitForSelector("#crew-lens:not(.hidden)");
      assert.equal((await p.locator("#crew-lens-host").innerText()).trim(), M.host);
      await p.locator("#crew-lens-off").click();
      // back to Standby from leave offers nothing
      await p.waitForFunction(() => !document.querySelector("#toast-stack .toast-action"));
      await p.evaluate((e) => assignEmployeesTo([e], null), who);
      await settle(p);
      assert.equal(await p.locator("#toast-stack .toast-action").count(), 0, JSON.stringify(await p.locator("#toast-stack .toast").allInnerTexts()));
    });

    await step("the mission's quick panel has Find crew too", async () => {
      await card().locator(".mission-header").click({ button: "right" });
      await clickMenu(p, "Find crew");
      const items = (await menuItems(p)).map((t) => t.trim());
      assert.ok(items.includes("Suggest crew…") && items.includes("Bring back the last crew…"), JSON.stringify(items));
      await p.keyboard.press("Escape");
      await p.evaluate(() => hideContextMenu());
    });

    await step("the Host record lists everyone who worked there with their days, last day and where they are that day; the chips filter", async () => {
      await p.evaluate((h) => openHostRecord(h), M.host);
      await p.waitForSelector("#hr-people .hr-p-row:not(.hr-p-head)");
      const rows = () => p.locator("#hr-people .hr-p-row:not(.hr-p-head)").evaluateAll((rs) => rs.map((r) => ({ id: r.dataset.emp, kind: r.dataset.kind, exp: r.classList.contains("is-exp"),
        days: Number(r.querySelector(".hr-p-days b").textContent), last: r.querySelector(".hr-p-last").textContent.trim(), st: r.querySelector(".hr-p-st").textContent.trim(), assign: r.querySelectorAll(".hr-assign").length })));
      const all = await rows();
      const truth = await p.evaluate((h) => { const r = hostRowByName(h); return r.inspectors.map((i) => ({ id: i.id, days: i.days, last: i.last ? fmtDate(i.last) : "—", kind: empDayStatus(D().employees.find((e) => e.id === i.id)).kind })); }, M.host);
      assert.deepEqual(all.map((r) => [r.id, r.days, r.last, r.kind]), truth.map((r) => [r.id, r.days, r.last, r.kind]));
      assert.ok(all.some((r) => r.kind === "busy" && /^On mission/.test(r.st)), "someone is on a mission");
      assert.ok(all.some((r) => r.kind === "free"), "someone is free");
      const date = await p.evaluate(() => fmtDayMon(state.date));
      assert.match(await p.locator(".hr-p-count").innerText(), new RegExp(`${all.length} people · ${all.filter((r) => r.kind === "free").length} free on ${date}`));
      await p.locator("[data-pf=free]").click();
      const free = await rows();
      assert.ok(free.length && free.every((r) => r.kind === "free"));
      assert.ok(free.every((r) => r.assign >= 1), "this host has a mission that day, so every free person can be assigned");
      await p.locator("[data-pf=exp]").click();
      assert.ok((await rows()).every((r) => r.exp));
      await p.locator("[data-pf=all]").click();
      assert.equal((await rows()).length, all.length);
      assert.ok(all.filter((r) => r.kind !== "free").every((r) => r.assign === 0), "only free people have Assign");
    });

    await step("Assign in the Host record puts a free person on the host's mission, on their board, with Undo", async () => {
      await p.locator("[data-pf=free]").click();
      const row = p.locator("#hr-people .hr-p-row:not(.hr-p-head)").first();
      const id = await row.getAttribute("data-emp");
      const btn = row.locator(".hr-assign").first();
      const target = await btn.getAttribute("data-mission");
      assert.match(await btn.innerText(), /^Assign to \S+/);
      await btn.click();
      await settle(p);
      assert.equal(await p.locator("#modal-host:not(.hidden)").count(), 0, "the record closed");
      const after = await p.evaluate(([e, m]) => ({ board: D().activeBoardId, on: getPlan().missions.find((x) => x.id === m).members.includes(e) }), [id, target]);
      assert.equal(after.board, start.board);
      assert.equal(after.on, true);
      await p.evaluate(() => undoLast());
      await settle(p);
      assert.equal(await p.evaluate(([e, m]) => getPlan().missions.find((x) => x.id === m).members.includes(e), [id, target]), false);
    });

    await step("from the Host tab, Assign goes to the person's board", async () => {
      await p.evaluate(() => { D().activeBoardId = HOSTLIST_ID; return refreshAndRender(); });
      await p.evaluate((h) => openHostRecord(h), M.host);
      await p.waitForSelector("#hr-people .hr-p-row:not(.hr-p-head)");
      await p.locator("[data-pf=free]").click();
      const btn = p.locator("#hr-people .hr-assign").first();
      const [id, board, target] = await btn.evaluate((b) => [b.dataset.emp, b.dataset.board, b.dataset.mission]);
      await btn.click();
      await settle(p);
      const after = await p.evaluate(([e, m]) => ({ board: D().activeBoardId, on: getPlan().missions.find((x) => x.id === m).members.includes(e) }), [id, target]);
      assert.deepEqual(after, { board, on: true });
      await p.evaluate(() => undoLast());
      await settle(p);
    });

    await step("the record reads every board's plan for the day: a host of a board that was never opened shows who is on a mission", async () => {
      const f = await open("?demo");
      const q = f.page;
      await q.evaluate(() => { D().activeBoardId = HOSTLIST_ID; return refreshAndRender(); });
      const other = await q.evaluate(() => D().boards.find((b) => !(D().plans[b.id] && D().plans[b.id][state.date])).id);
      const host = await q.evaluate((b) => allHostRows().find((r) => r.boards.length === 1 && r.boards[0].id === b && r.inspectors.length >= 3).name, other);
      await q.evaluate((h) => openHostRecord(h), host);
      await q.waitForSelector("#hr-people .hr-p-row:not(.hr-p-head)");
      const kinds = await q.locator("#hr-people .hr-p-row:not(.hr-p-head)").evaluateAll((rs) => rs.map((r) => r.dataset.kind));
      assert.ok(kinds.includes("busy"), `${host}: ${kinds.join(",")}`);
      assert.deepEqual(f.errors, []);
      await f.ctx.close();
    });

    await step("Thai: nothing new in English on the board's Find crew, its dialogs or the record's people", async () => {
      await empty();
      await p.evaluate(() => I18N.setLang("th"));
      await p.waitForTimeout(300);
      const before = await p.evaluate(() => I18N.missing());
      await card().locator(".m-empty-find").click();
      await p.waitForTimeout(200);
      await p.evaluate((id) => { hideContextMenu(); setCrewLens(getPlan().missions.find((m) => m.id === id)); }, mid);
      await p.waitForSelector("#crew-lens:not(.hidden)");
      await p.evaluate((id) => bringBackLastCrew(getPlan().missions.find((m) => m.id === id)), mid);
      await p.waitForSelector("#modal-confirm:not(.hidden)");
      await p.waitForTimeout(250);
      await p.locator("#btn-confirm-no").click();
      await p.evaluate((id) => suggestCrew(getPlan().missions.find((m) => m.id === id)), mid);
      await p.waitForSelector("#modal-confirm:not(.hidden)");
      await p.waitForTimeout(250);
      await p.locator("#btn-confirm-no").click();
      await p.evaluate((h) => openHostRecord(h), M.host);
      await p.waitForSelector("#hr-people .hr-p-row:not(.hr-p-head)");
      await p.waitForTimeout(300);
      const mine = (await p.evaluate(() => I18N.missing())).filter((m) => !before.includes(m));
      assert.deepEqual(mine, [], "untranslated: " + mine.join(" | "));
      await p.evaluate(() => { closeModal(); clearCrewLens(); I18N.setLang("en"); });
    });

    await step("no page errors", async () => { assert.deepEqual(a.errors, []); });
    await a.ctx.close();

    // ---- a viewer ----
    const v = await open("?demo&role=viewer");
    await step("a viewer has no Find crew and no Assign", async () => {
      const q = v.page;
      await q.waitForFunction(() => Object.keys(crewState.days).length > 0, null, { timeout: 10000 });
      assert.equal(await q.locator(".m-empty-find").count(), 0);
      await q.locator(".mission-card .mission-header").first().click({ button: "right" });
      assert.ok(!(await menuItems(q)).some((t) => /Find crew/.test(t)));
      await q.evaluate(() => hideContextMenu());
      const host = await q.evaluate(() => getPlan().missions.find((m) => !m.hidden).host);
      await q.evaluate((h) => openHostRecord(h), host);
      await q.waitForSelector("#hr-people .hr-p-row:not(.hr-p-head)");
      assert.equal(await q.locator("#hr-people .hr-assign").count(), 0);
      assert.deepEqual(v.errors, []);
    });
    await v.ctx.close();

    // ---- a phone ----
    const ph = await open("?demo", { width: 390, height: 800 });
    await step("phone (390 px): the record's people fit, and Find crew opens the people drawer", async () => {
      const q = ph.page;
      const host = await q.evaluate(() => getPlan().missions.find((m) => !m.hidden).host);
      await q.evaluate((h) => openHostRecord(h), host);
      await q.waitForSelector("#hr-people .hr-p-row:not(.hr-p-head)");
      const m = await q.evaluate(() => { const body = document.querySelector("#host-detail"); return { body: body.scrollWidth - body.clientWidth, doc: document.documentElement.scrollWidth - innerWidth }; });
      assert.ok(m.body <= 1 && m.doc <= 1, JSON.stringify(m));
      await q.evaluate(() => closeModal());
      await q.evaluate(() => setCrewLens(getPlan().missions.find((x) => !x.hidden)));
      await q.waitForSelector("#crew-lens:not(.hidden)");
      assert.equal(await q.evaluate(() => document.querySelector("#float-pool").classList.contains("fp-open")), true);
      assert.deepEqual(ph.errors, []);
    });
    await ph.ctx.close();
  } catch (e) {
    failed = true;
  } finally {
    await browser.close();
    server.close();
  }
  if (failed) process.exit(1);
  console.log("\nfind-crew: all checks passed");
})();
