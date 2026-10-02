/* Acceptance run for the app version display and the "new version available"
   banner, driving the real app in Chromium against the shared fake backend.
     NODE_PATH=$(npm root -g) node tests/e2e/app-version.e2e.js
   The server's answer to the update check is faked per step with page.route;
   everything else (the footer, Settings, the banner, the reload) is the real app.
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const h = require("./harness");

const T = h.iso(new Date());
const SRC = h.isWeekend(T) ? h.prevWorking(T) : T;
const LOADED = /APP_VERSION\s*=\s*"([^"]+)"/.exec(fs.readFileSync(path.join(__dirname, "..", "..", "version.js"), "utf8"))[1];
const NEWER = "2099-01-01a";

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 5).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  try {
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    const a = await env.openAs(db, h.USERS.a);
    const p = a.page;
    await p.evaluate((d) => { state.date = d; return refreshAndRender(); }, SRC);

    // what the "server" says version.js is; the update check's ?cb= URL is the only one routed
    let served = { status: 200, body: 'window.APP_VERSION = "' + LOADED + '";' };
    let checks = 0;
    await p.route(/version\.js\?cb=/, (r) => { checks++; r.fulfill({ status: served.status, contentType: "text/javascript", body: served.body }); });
    const serve = (v) => { served = { status: 200, body: 'window.APP_VERSION = "' + v + '";' }; };
    const check = async () => { const n = checks; await p.evaluate(() => checkForUpdate()); assert.equal(checks, n + 1, "the check must hit the server"); };
    const bannerShown = () => p.locator("#update-banner").isVisible();

    await step("the version is loaded and every version slot shows it", async () => {
      assert.equal(await p.evaluate(() => window.APP_VERSION), LOADED);
      const texts = await p.evaluate(() => [...document.querySelectorAll("[data-app-version]")].map((e) => e.textContent));
      assert.ok(texts.length >= 3, "sign-in, Settings and footer slots, found " + texts.length);
      assert.ok(texts.every((t) => t === LOADED), JSON.stringify(texts));
    });

    await step("the footer and the Settings rail show it", async () => {
      await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      assert.match(await p.locator("#app-footer").innerText(), new RegExp("Version " + LOADED));
      await p.click("#btn-settings");
      await p.waitForSelector("#modal-settings:not(.hidden)");
      assert.equal(await p.locator("#settings-version").isVisible(), true);
      assert.match(await p.locator("#settings-version").innerText(), new RegExp("Version " + LOADED));
      await p.click("#modal-settings .modal-close");
      await p.evaluate(() => window.scrollTo(0, 0));
    });

    await step("no banner while the server still has the loaded version", async () => {
      await check();
      assert.equal(await bannerShown(), false);
    });

    await step("a different version on the server raises the banner, naming both", async () => {
      serve(NEWER);
      await check();
      assert.equal(await bannerShown(), true);
      const t = await p.locator("#update-banner-text").innerText();
      assert.ok(t.includes(NEWER) && t.includes(LOADED), t);
      await p.screenshot({ path: "/tmp/update-banner.png" });
    });

    await step("the banner stays on screen while the board scrolls", async () => {
      await p.evaluate(() => window.scrollTo(0, 400));
      const box = await p.locator("#update-banner").boundingBox();
      assert.ok(box && box.y >= 0 && box.y < 5, "banner top at " + (box && box.y));
      await p.evaluate(() => window.scrollTo(0, 0));
    });

    await step("dismissing hides it, and the same version does not bring it back", async () => {
      await p.click("#btn-update-dismiss");
      assert.equal(await bannerShown(), false);
      await check();
      assert.equal(await bannerShown(), false);
    });

    await step("a still newer release brings the banner back", async () => {
      serve("2099-01-01b");
      await check();
      assert.equal(await bannerShown(), true);
      assert.ok((await p.locator("#update-banner-text").innerText()).includes("2099-01-01b"));
    });

    await step("the banner clears itself if the server goes back to the loaded version", async () => {
      serve(LOADED);
      await check();
      assert.equal(await bannerShown(), false);
    });

    await step("an unreadable or failed answer says nothing", async () => {
      served = { status: 200, body: "<html>captive portal</html>" };
      await check();
      assert.equal(await bannerShown(), false);
      served = { status: 500, body: "boom" };
      await check();
      assert.equal(await bannerShown(), false);
    });

    await step("Refresh now reloads the page", async () => {
      serve("2099-02-02a");   // not one already dismissed above
      await check();
      assert.equal(await bannerShown(), true);
      await p.evaluate(() => { window.__beforeReload = true; });
      await Promise.all([p.waitForNavigation(), p.click("#btn-update-reload")]);
      await p.waitForSelector("#board-tabs .board-tab", { timeout: 15000 });
      assert.equal(await p.evaluate(() => window.__beforeReload === undefined), true, "page must have reloaded");
    });

    assert.deepEqual(a.errors, [], "no console errors: " + a.errors.join(" | "));
    console.log("all checks passed");
  } finally {
    await env.close();
  }
})().catch(() => { process.exitCode = 1; });
