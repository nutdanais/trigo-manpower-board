/* Acceptance run for the Host record view (design/handover-list-tabs.md, Batch D):
     - a Host row, a host link on the Missions tab, a host link in the mission panel and ⋯ → Open all open the record,
       read first (no form), in the same panel as the Mission (same width and header layout);
     - the header: name, status pill, "Host" with its boards and service area, actions Edit, Open map and More;
     - the alert box: "No location" with "+ Add location" (opens the form on Location), "at risk" with "See who";
     - the key numbers, the people (all of them, most days first, the experienced outlined) and the missions at the
       host equal the Skills matrix row of the same host;
     - Edit, then Save or Cancel, comes back to the record; More has Archive / Make active, Merge and Clear record;
     - a viewer sees the record with no Edit and no More;
     - the experienced-days setting changes the record's Experienced number;
     - Thai shows no new English; on a phone (390 px) the record is full screen and nothing scrolls sideways.
   It runs the app on its own sample data (/?demo), as demo-mode.e2e.js does.
     NODE_PATH=$(npm root -g) node tests/e2e/host-record.e2e.js
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
  const goHosts = async (p) => {
    await p.evaluate(() => { D().activeBoardId = HOSTLIST_ID; return refreshAndRender(); });
    await p.waitForSelector("#hostlist-body tr");
    await p.waitForTimeout(400);
  };
  const waitRecord = async (p, name) => {
    await p.waitForSelector("#modal-host:not(.hidden) #host-detail:not(.hidden) .rp-group");
    if (name) assert.equal((await p.locator("#host-modal-title").innerText()).trim(), name);
  };
  /* the numbers the Skills matrix shows for one host, from the same code that draws it */
  const matrixRow = (p, name) => p.evaluate((n) => {
    const m = hostMatrixRows().find((x) => x.r.name === n);
    return { people: m.r.inspectors.length, exp: m.x.experienced.length, days: m.r.deployedDays, last: m.r.lastWorked ? fmtDate(m.r.lastWorked) : "—", atRisk: m.x.atRisk };
  }, name);
  let failed = false;
  try {
    const a = await open("?demo");
    const p = a.page;
    await goHosts(p);

    await step("a Host row opens the record, read first, with the Mission panel's width and header", async () => {
      await p.locator("#hostlist-body tr").first().locator("td.hl-name .hl-host").click();
      await waitRecord(p);
      assert.equal(await p.locator("#form-host:not(.hidden)").count(), 0, "no form yet");
      const name = (await p.locator("#host-modal-title").innerText()).trim();
      assert.match(await p.locator("#host-modal-status .lt-st").innerText(), /Active|Archived/);
      assert.match(await p.locator("#host-modal-sub").innerText(), /^Host/, "line 2 says it is a Host");
      assert.ok(await p.locator("#host-modal-sub .lt-bd").count() >= 1, "its board tag(s)");
      const hostW = (await p.locator("#modal-host").boundingBox()).width;
      // the same panel as the Mission: one width
      await p.evaluate(() => closeModal());
      const w = await p.evaluate(() => getComputedStyle(document.querySelector("#modal-mission")).width);
      assert.equal(`${hostW}px`.replace(/\.\d+/, ""), w.replace(/\.\d+/, ""), `Host ${hostW}px, Mission ${w}`);
      const acts = await p.locator("#host-modal-acts").count();
      assert.equal(acts, 1);
      assert.ok(name.length);
    });

    await step("the header actions are Edit, Open map and More: at most three", async () => {
      await p.locator('#hostlist-body tr[data-host="Siam Auto Parts"] td.hl-name .hl-host').click();
      await waitRecord(p, "Siam Auto Parts");
      const ids = await p.locator("#host-modal-acts > button").evaluateAll((bs) => bs.map((b) => b.id));
      assert.deepEqual(ids, ["btn-hr-edit", "btn-hr-map", "btn-hr-more"]);
      await p.locator("#btn-hr-more").click();
      const items = await p.locator("#host-modal-acts .rp-more-item").allInnerTexts();
      assert.deepEqual(items.map((t) => t.trim()), ["Archive", "Merge into another host…", "Clear record…"]);
      await p.keyboard.press("Escape");
      await p.evaluate(() => closeModal());
    });

    await step("the key numbers, the people and the missions equal the Skills matrix row of the same host", async () => {
      const names = await p.locator("#hostlist-body tr").evaluateAll((trs) => trs.map((t) => t.dataset.host));
      assert.ok(names.length >= 8);
      for (const n of names) {
        await p.evaluate((x) => openHostRecord(x), n);
        await waitRecord(p, n);
        await p.waitForSelector("#host-detail .hr-missions .ov-muted, #host-detail .hr-missions .hr-m-list", { timeout: 5000 }).catch(() => {});
        const mx = await matrixRow(p, n);
        const tiles = await p.locator("#host-detail .ov-htile").evaluateAll((ts) => ts.map((t) => ({ label: t.querySelector(".ov-htile-label").textContent.trim(), value: t.querySelector(".ov-htile-value").textContent.trim() })));
        assert.deepEqual(tiles.map((t) => t.label), ["Experienced", "People", "Days", "Last worked"], n);
        assert.equal(Number(tiles[0].value), mx.exp, `${n}: Experienced`);
        assert.equal(Number(tiles[1].value), mx.people, `${n}: People`);
        assert.equal(Number(tiles[2].value), mx.days, `${n}: Days`);
        assert.equal(tiles[3].value, mx.last, `${n}: Last worked`);
        // every person, all of them (no "+N more"), most days first
        const chips = await p.locator("#host-detail .rp-people .lt-pc").evaluateAll((cs) => cs.map((c) => ({ days: Number(c.querySelector("small").textContent.replace("d", "")), exp: c.classList.contains("lt-exp") })));
        assert.equal(chips.length, mx.people, `${n}: every person is listed`);
        assert.deepEqual(chips.map((c) => c.days), chips.map((c) => c.days).slice().sort((x, y) => y - x), `${n}: most days first`);
        assert.equal(chips.filter((c) => c.exp).length, mx.exp, `${n}: the experienced ones are outlined`);
        assert.equal(await p.locator("#host-detail .rp-people [data-more]").count(), 0, "no +N more");
        // an at-risk host shows the red alert with its fix
        assert.equal(await p.locator("#host-detail .rp-alert .lt-al-bad").count(), mx.atRisk && mx.people ? 1 : 0, `${n}: at-risk alert`);
        await p.evaluate(() => closeModal());
      }
    });

    await step("No location: the alert box offers + Add location, which opens the form on Location; Cancel and Save come back", async () => {
      await p.evaluate(() => openHostRecord("Hi-Tech Bearings"));
      await waitRecord(p, "Hi-Tech Bearings");
      assert.match(await p.locator("#host-detail .rp-alert .lt-al-warn").first().innerText(), /No location/);
      assert.equal(await p.locator("#btn-hr-map").count(), 0, "no map to open");
      await p.locator("#host-detail .rp-al-fix", { hasText: "+ Add location" }).click();
      await p.waitForSelector("#form-host:not(.hidden)");
      assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.name), "location", "the cursor is on Location");
      assert.equal((await p.locator("#host-modal-title").innerText()).trim(), "Hi-Tech Bearings", "same header in the form");
      assert.equal(await p.locator("#host-modal-acts:not(.hidden)").count(), 0, "no action row in the form");
      await p.locator("#btn-host-cancel").click();
      await waitRecord(p, "Hi-Tech Bearings");
      await p.locator("#btn-hr-edit").click();
      await p.fill('#form-host [name="location"]', "Bang Pakong, Chachoengsao");
      await p.locator('#form-host button[type="submit"]').click();
      await waitRecord(p, "Hi-Tech Bearings");
      assert.match(await p.locator("#host-detail .rp-dl").innerText(), /Bang Pakong, Chachoengsao/);
      assert.equal(await p.locator("#host-detail .rp-alert .lt-al-warn", { hasText: "No location" }).count(), 0, "the alert is gone once it has a location");
      assert.equal(await p.locator("#hostlist-body tr[data-host=\"Hi-Tech Bearings\"] .lt-al-warn").count(), 0);
      await p.evaluate(() => closeModal());
    });

    await step("the form's footer is pinned: Clear record on the left, Cancel and Save on the right, in view at any scroll", async () => {
      await p.evaluate(() => openHostRecord("Siam Auto Parts"));
      await waitRecord(p);
      await p.locator("#btn-hr-edit").click();
      await p.waitForSelector("#form-host:not(.hidden)");
      await p.locator("#form-host .rp-fields").evaluate((el) => { el.scrollTop = el.scrollHeight; });
      const box = await p.locator("#form-host .rp-foot").boundingBox();
      const panel = await p.locator("#modal-host").boundingBox();
      assert.ok(box.y + box.height <= panel.y + panel.height + 1 && box.y >= panel.y, "the footer is inside the panel's visible area");
      assert.match(await p.locator("#btn-delete-host").getAttribute("class"), /rp-danger/);
      assert.equal(await p.locator("#form-host .rp-foot .btn").allInnerTexts().then((t) => t.map((x) => x.trim())).then((t) => t.join(",")), "Cancel,Save");
      assert.ok(await p.locator('#form-host label:has-text("Host name") .req').count() === 1, "the required star");
      assert.ok(await p.locator('#form-host label:has-text("Location") .opt').count() === 1, "optional is said on optional fields");
      await p.locator("#btn-host-cancel").click();
      await waitRecord(p, "Siam Auto Parts");
      await p.evaluate(() => closeModal());
    });

    await step("More: Archive then Make active change the status pill in the record and the table", async () => {
      await p.evaluate(() => openHostRecord("Rojana Electronics"));
      await waitRecord(p);
      await p.locator("#btn-hr-more").click();
      await p.locator("#btn-hr-archive").click();
      await p.waitForFunction(() => /Archived/.test(document.querySelector("#host-modal-status").textContent));
      await p.locator("#btn-hr-more").click();
      assert.equal(await p.locator("#btn-hr-activate").count(), 1, "Make active is offered now");
      await p.locator("#btn-hr-activate").click();
      await p.waitForFunction(() => /Active/.test(document.querySelector("#host-modal-status").textContent));
      await p.evaluate(() => closeModal());
    });

    await step("More: Merge into another host… opens the form with the Merge section open; Cancel comes back", async () => {
      await p.evaluate(() => openHostRecord("Bowin Glass"));
      await waitRecord(p);
      await p.locator("#btn-hr-more").click();
      await p.locator("#btn-hr-merge").click();
      await p.waitForSelector("#form-host:not(.hidden)");
      assert.equal(await p.locator("#host-merge[open]").count(), 1);
      await p.locator("#btn-host-cancel").click();
      await waitRecord(p, "Bowin Glass");
    });

    await step("More: Clear record… asks first; Cancel leaves the record where it was", async () => {
      await p.locator("#btn-hr-more").click();
      await p.locator("#btn-hr-clear").click();
      await p.waitForSelector("#modal-confirm:not(.hidden)");
      await p.locator("#btn-confirm-no").click();
      await waitRecord(p, "Bowin Glass");
      await p.evaluate(() => closeModal());
    });

    await step("a ⋯ → Open and a double click open the record; + Add opens the form on its field", async () => {
      await p.locator('#hostlist-body tr[data-host="Siam Auto Parts"] .lt-dots').click();
      await p.locator("#context-menu .ctx-item", { hasText: /^Open$/ }).click();
      await waitRecord(p, "Siam Auto Parts");
      await p.evaluate(() => closeModal());
      await p.locator('#hostlist-body tr[data-host="Siam Auto Parts"] td.hl-name').dblclick();
      await waitRecord(p, "Siam Auto Parts");
      await p.evaluate(() => closeModal());
      await p.locator('#hostlist-body tr[data-host="Hi-Tech Bearings"] .lt-add[data-add="note"]').click({ force: true });
      await p.waitForSelector("#form-host:not(.hidden)");
      assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.name), "note");
      await p.locator("#btn-host-cancel").click();
      await waitRecord(p, "Hi-Tech Bearings");
      await p.evaluate(() => closeModal());
    });

    await step("the missions at this host: the open ones open the mission panel; Closed (N) expands", async () => {
      const host = await p.evaluate(() => { const r = (D().register || []).find((m) => m.status !== "closed" && m.host); return r ? r.host : null; });
      assert.ok(host, "the demo has an open mission with a host");
      await p.evaluate((h) => openHostRecord(h), host);
      await waitRecord(p, host);
      await p.waitForSelector("#host-detail .hr-missions .hr-mission");
      const n = await p.evaluate((h) => (D().register || []).filter((m) => m.host === h && m.status !== "closed").length, host);
      assert.equal(await p.locator("#host-detail .hr-missions .hr-m-list:not(.hidden) .hr-mission").count(), n, "one line per open mission");
      assert.ok(await p.locator("#host-detail .hr-mission .lt-st").count() >= 1, "each has its status pill");
      await p.locator("#host-detail .hr-mission").first().click();
      await p.waitForSelector("#mission-detail:not(.hidden)");
      await p.evaluate(() => closeModal());
    });

    await step("a host link on the Missions tab and in the mission panel opens the record, over the tab", async () => {
      await p.evaluate(() => { D().activeBoardId = MISSIONS_ID; return refreshAndRender(); });
      await p.waitForSelector("#missions-body tr .ml-host-link");
      const link = p.locator("#missions-body tr .ml-host-link").first();
      const host = (await link.innerText()).trim();
      await link.click();
      await waitRecord(p, host);
      assert.ok(await p.locator("#missions-table:visible").count() === 1, "the Missions tab is still behind it");
      await p.evaluate(() => closeModal());
      await p.locator("#missions-body tr").first().locator("td.ml-first").click();
      await p.waitForSelector("#mission-detail:not(.hidden) #btn-md-host");
      const h2 = (await p.locator("#btn-md-host").innerText()).trim();
      await p.locator("#btn-md-host").click();
      await waitRecord(p, h2);
      await p.evaluate(() => closeModal());
    });

    await step("the experienced-days setting changes the record's Experienced number", async () => {
      const before = await p.evaluate(async () => { await openHostRecord("Siam Auto Parts"); return null; });
      await waitRecord(p, "Siam Auto Parts");
      const at = async () => Number(await p.locator("#host-detail .ov-htile").first().locator(".ov-htile-value").innerText());
      const first = await at();
      const sub = (await p.locator("#host-detail .ov-htile").first().innerText());
      assert.match(sub, /5 days or more/);
      await p.evaluate(() => closeModal());
      await p.evaluate(() => { D().settings = { ...(D().settings || {}), hostExperiencedDays: 365 }; return openHostRecord("Siam Auto Parts"); });
      await waitRecord(p);
      const strict = await at();
      assert.ok(strict < first || first === 0, `with 365 days the count falls (${first} -> ${strict})`);
      assert.match(await p.locator("#host-detail .ov-htile").first().innerText(), /365 days or more/);
      await p.evaluate(() => { D().settings = { ...(D().settings || {}), hostExperiencedDays: 1 }; return renderHostRecord("Siam Auto Parts"); });
      assert.ok(await at() >= first, "with 1 day the count does not fall");
      await p.evaluate(() => closeModal());
      assert.equal(before, null);
    });

    await step("Thai: nothing new in English on the record", async () => {
      await p.evaluate(() => I18N.setLang("th"));
      await p.waitForTimeout(300);
      for (const n of ["Siam Auto Parts", "Hi-Tech Bearings"]) {
        await p.evaluate((x) => openHostRecord(x), n);
        await waitRecord(p, n);
        await p.locator("#btn-hr-more").click();
        await p.waitForTimeout(400);
      }
      const missing = await p.evaluate(() => I18N.missing());
      const mine = missing.filter((m) => /Host|Site|experienced|Experienced|worked here|Missions at this host|Note for the crew|Merge into another|Clear record|Add location|See who|ever worked|in all|days or more|Closed \(|Open this host/.test(m));
      assert.deepEqual(mine, [], "untranslated: " + mine.join(" | "));
      await p.evaluate(() => closeModal());
      await p.evaluate(() => I18N.setLang("en"));
    });

    await step("no page errors", async () => { assert.deepEqual(a.errors, []); });
    await a.ctx.close();

    // ---- a viewer ----
    const v = await open("?demo&role=viewer");
    await step("a viewer sees the record with no Edit and no More (Open map stays)", async () => {
      await goHosts(v.page);
      await v.page.locator("#hostlist-body tr").first().locator("td.hl-name .hl-host").click();
      await waitRecord(v.page);
      assert.equal(await v.page.locator("#btn-hr-edit, #btn-hr-more").count(), 0);
      assert.equal(await v.page.locator("#host-detail .rp-al-fix").evaluateAll((b) => b.filter((x) => /Add location/.test(x.textContent)).length), 0, "no + Add location");
      const ids = await v.page.locator("#host-modal-acts > button").evaluateAll((bs) => bs.map((b) => b.id));
      assert.ok(ids.every((i) => i === "btn-hr-map"), "only Open map: " + ids);
      await v.page.evaluate(() => closeModal());
      // the form cannot be forced open either
      await v.page.evaluate(() => openHostModal("Siam Auto Parts"));
      assert.equal(await v.page.locator("#modal-host:not(.hidden)").count(), 0);
      assert.deepEqual(v.errors, []);
    });
    await v.ctx.close();

    // ---- a phone ----
    const ph = await open("?demo", { width: 390, height: 800 });
    await step("phone (390 px): the record is full screen and nothing scrolls sideways", async () => {
      const q = ph.page;
      await goHosts(q);
      await q.evaluate(() => openHostRecord("Siam Auto Parts"));
      await waitRecord(q, "Siam Auto Parts");
      await q.waitForSelector("#host-detail .hr-missions .hr-mission");
      const m = await q.evaluate(() => {
        const el = document.querySelector("#modal-host"), body = document.querySelector("#host-detail");
        return { w: el.getBoundingClientRect().width, vw: innerWidth, bodyScroll: body.scrollWidth - body.clientWidth, doc: document.documentElement.scrollWidth - innerWidth };
      });
      assert.equal(Math.round(m.w), m.vw, "full screen");
      assert.ok(m.bodyScroll <= 1 && m.doc <= 1, JSON.stringify(m));
      await q.locator("#btn-hr-edit").click();
      await q.waitForSelector("#form-host:not(.hidden)");
      const foot = await q.locator("#form-host .rp-foot").boundingBox();
      assert.ok(foot.y + foot.height <= 800 + 1, "Save is pinned in view");
    });
    await ph.ctx.close();
  } catch (e) {
    failed = true;
  } finally {
    await browser.close();
    server.close();
  }
  if (failed) process.exit(1);
  console.log("\nhost-record: all checks passed");
})();
