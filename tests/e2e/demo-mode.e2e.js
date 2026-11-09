/* Acceptance run for the browser-only demo (/?demo): the real app against an
   in-memory sample database, with no config.js, no Supabase script and no
   internet at all. Checks that
     - a normal visit loads nothing of the demo (the gate is a no-op),
     - ?demo opens the board on the invented sample data and shows the DEMO strip,
     - a mission created through the UI is kept for the session and gone after a
       reload (every visitor's sandbox starts from the seed),
     - ?demo&role=viewer signs in with that role's permissions (no New Mission),
     - Settings → Users lists the sample accounts, and creating an account says
       it is switched off instead of failing,
     - Sign out starts the demo over, and
     - on a phone the strip is a small DEMO tag that opens on tap.
   It serves the repo itself (not harness.js, which puts the test backend in
   place of Supabase for every page) and blocks every request that is not local.
     NODE_PATH=$(npm root -g) node tests/e2e/demo-mode.e2e.js
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
      const file = path.join(ROOT, url === "/" ? "index.html" : url);   // config.js is deliberately not served
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 5).join("\n   ")); throw e; }
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const open = async (query, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, ...opts });
    const page = await ctx.newPage();
    const errors = [], remote = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { remote.push(r.request().url()); r.abort(); });
    await page.goto(base + query);
    return { ctx, page, errors, remote };
  };
  const board = (p) => p.waitForSelector("#board-tabs .board-tab", { state: "attached", timeout: 20000 });
  let failed = false;
  try {
    await step("a normal visit loads nothing of the demo", async () => {
      const { ctx, page } = await open("");
      await page.waitForTimeout(1200);
      assert.equal(await page.evaluate(() => !!window.__demo || !!window.FakeDb || !!document.getElementById("demo-strip")), false);
      await ctx.close();
    });

    await step("?demo opens the board on sample data, with no real backend", async () => {
      const { ctx, page, errors, remote } = await open("?demo");
      await board(page);
      await page.waitForTimeout(600);
      assert.equal(await page.locator("#demo-strip").count(), 1, "DEMO strip");
      assert.ok(await page.locator(".mission-card").count() >= 5, "seeded missions on the board");
      assert.ok(!remote.some((u) => /supabase\.co/.test(u)), "no request to supabase.co: " + remote.join(", "));
      assert.deepEqual(errors, [], "page errors");
      await ctx.close();
    });

    await step("a mission created in the UI stays for the session and is gone after a reload", async () => {
      const { ctx, page } = await open("?demo");
      await board(page);
      const count = () => page.evaluate(() => window.__demo.db.t("missions").length);
      const seeded = await count();
      await page.getByRole("button", { name: "New Mission" }).first().click();
      await page.locator("#modal-mission:not(.hidden)").waitFor();
      // a number in Etraq's form: the mission form checks it (mission-number.js)
      await page.fill("#form-mission [name=number]", `RYGTH.${String(new Date().getFullYear()).slice(2)}.0999`);
      await page.fill("#form-mission [name=host]", "Siam Auto Parts");
      await page.fill("#form-mission [name=customer]", "Training Customer");
      await page.fill("#form-mission [name=engineer]", "Somchai.P");
      await page.click("#form-mission button[type=submit]");   // the DEMO strip must not sit over Save
      await page.locator("#modal-mission.hidden").waitFor({ state: "attached" });
      await page.locator(".mission-card", { hasText: "Training Customer" }).first().waitFor();
      assert.equal(await count(), seeded + 1);
      await page.reload();
      await board(page);
      assert.equal(await count(), seeded, "back to the seed after a reload");
      await ctx.close();
    });

    await step("?demo&role=siteadmin: the Missions tab with a closed mission and a renumbered one", async () => {
      const { ctx, page } = await open("?demo&role=siteadmin");
      assert.equal(await page.evaluate(() => window.__demo.role), "siteadmin");
      await page.evaluate(() => { D().activeBoardId = MISSIONS_ID; return refreshAndRender(); });
      await page.locator("#missions-panel:not(.hidden)").waitFor();
      const yy = String(new Date().getFullYear()).slice(2), ly = String(new Date().getFullYear() - 1).slice(2);
      assert.match(await page.locator("#missions-body").innerText(), new RegExp(`AYTTH\\.${yy}\\.0302[\\s\\S]*was AYTTH\\.${ly}\\.0157`));
      await page.selectOption("#missions-status", "closed");
      assert.match(await page.locator("#missions-body").innerText(), /209[\s\S]*Closed/);
      assert.equal(await page.locator("#btn-new-mission").isVisible(), false, "the board is view-only for a Site Admin");
      await ctx.close();
    });

    await step("?demo&role=viewer signs in as a viewer: no New Mission", async () => {
      const { ctx, page } = await open("?demo&role=viewer");
      await board(page);
      await page.waitForTimeout(600);
      assert.equal(await page.evaluate(() => window.__demo.role), "viewer");
      assert.equal(await page.getByRole("button", { name: "New Mission" }).count(), 0);
      assert.equal(await page.locator("#demo-strip select").inputValue(), "viewer");
      await ctx.close();
    });

    await step("Settings → Users lists the sample accounts; creating one is politely switched off; Sign out starts over", async () => {
      const { ctx, page, errors } = await open("?demo");
      await board(page);
      await page.click("#btn-avatar");
      await page.click("#btn-settings");
      await page.waitForSelector("#settings-view:not(.hidden)");
      await page.getByText("Users", { exact: true }).first().click();
      await page.getByText("Arthit.C").first().waitFor();            // a pending request
      const msg = await page.evaluate(async () => {
        try { await cloud._invokeAdmin("create", { email: "x@example.com" }); return "no error"; } catch (e) { return e.message; }
      });
      assert.match(msg, /switched off in the demo/);
      await page.click("#btn-settings-back");
      await page.click("#btn-avatar");
      await Promise.all([page.waitForNavigation(), page.locator("#user-menu").getByText("Sign out").first().click()]);
      await board(page);
      assert.deepEqual(errors, [], "page errors");
      await ctx.close();
    });

    await step("on a phone the strip is a DEMO tag that opens on tap", async () => {
      const { ctx, page } = await open("?demo", { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
      await board(page);
      await page.waitForTimeout(600);
      assert.equal(await page.locator("#demo-strip select").isVisible(), false, "controls hidden until tapped");
      await page.locator("#demo-strip b").tap();
      assert.equal(await page.locator("#demo-strip select").isVisible(), true);
      await ctx.close();
    });

    console.log("ALL DEMO-MODE CHECKS PASSED");
  } catch (e) {
    failed = true;
  } finally {
    await browser.close();
    server.close();
  }
  if (failed) process.exit(1);
})();
