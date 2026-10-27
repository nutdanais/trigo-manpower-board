/* Takes the user guide's screenshots from the real app.

   The app runs unmodified from this repo; only Supabase is swapped for the
   in-memory fake the e2e tests use (tests/fake/), filled with the invented data
   in ./seed.js. Each shot is taken in English and Thai, at desktop and/or phone
   size, and written to design/user-guide/img/<name>.<lang>.jpg.

     node design/user-guide/capture.js            all shots
     node design/user-guide/capture.js board mm   only the shots named

   Needs Playwright + Chromium (preinstalled in the dev container). Retake the
   shots after a visible change to the app, then republish the guide. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { FakeDb } = require("../../tests/fake/fake-db");
const S = require("./seed");

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(__dirname, "img");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json" };
const DESK = { viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split("?")[0]);
      if (url === "/config.js") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end('window.SUPABASE_CONFIG = { url: "http://fake", anonKey: "fake" };');
        return;
      }
      const file = path.join(ROOT, url === "/" ? "index.html" : url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

/* A fresh database and a fresh browser context per shot, so no shot depends on
   what an earlier one clicked. `user: null` opens the sign-in screen. */
async function open(env, { device, lang, user = S.ME, profilePatch, view, waitFor }) {
  const db = new FakeDb();
  S.seed(db);
  if (profilePatch) Object.assign(db.t("profiles").find((p) => p.id === user.id), profilePatch);
  const ctx = await env.browser.newContext({ ...(device === "phone" ? PHONE : DESK), locale: lang === "th" ? "th-TH" : "en-GB" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", (r) =>
    r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(ROOT, "tests", "fake", "fake-client.js"), "utf8") }));
  await page.exposeFunction("__fakeSupabaseExec", (q) => db.exec(q, user));
  await page.addInitScript(({ u, lang, view }) => {
    window.__fakeSession = u ? { user: { id: u.id, email: u.email }, access_token: "fake" } : null;
    try {
      localStorage.setItem("manpower.lang", lang);
      localStorage.setItem("mpm-last-view", JSON.stringify({ boardId: "b1", ...(view || {}) }));
    } catch (e) { /* ignore */ }
  }, { u: user, lang, view });
  db.subscribe((evt) => { page.evaluate((e) => window.__fakeSupabaseExec && window.__fakeSupabaseEmit && window.__fakeSupabaseEmit(e), evt).catch(() => {}); });
  await page.goto(env.base);
  await page.waitForSelector(waitFor || (user ? "#board-tabs .board-tab" : "#login-screen:not(.hidden)"), { state: waitFor ? "visible" : "attached", timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  return { page, ctx, db, errors };
}

async function shoot(page, name, lang, opts = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.${lang}.jpg`);
  await page.waitForTimeout(opts.settle || 400);
  if (opts.el) await page.locator(opts.el).first().screenshot({ path: file, type: "jpeg", quality: 82 });
  else await page.screenshot({ path: file, type: "jpeg", quality: 82, fullPage: !!opts.full, ...(opts.clip ? { clip: opts.clip } : {}) });
  return file;
}

const LANGS = ["en", "th"];
/* Take one shot in both languages: `run(page, lang)` sets the screen up and
   returns the options for shoot(). */
const both = (device, run, openOpts = {}) => async (env, name) => {
  for (const lang of LANGS) {
    const { page, ctx, errors } = await open(env, { device, lang, ...openOpts });
    const opts = (await run(page, lang)) || {};
    await shoot(page, name, lang, opts);
    if (errors.length) console.warn(`\n  ${name}.${lang}: page errors`, errors);
    await ctx.close();
  }
};
/* The sign-in screens: a new user sees them in English, so the Thai guide shows the same picture. */
const signin = (run, openOpts = {}) => async (env, name) => {
  const { page, ctx } = await open(env, { device: "desk", lang: "en", ...openOpts });
  const opts = (await run(page)) || {};
  const file = await shoot(page, name, "en", opts);
  fs.copyFileSync(file, path.join(OUT, `${name}.th.jpg`));
  await ctx.close();
};
/* A clip around a few elements, padded and kept inside the viewport */
async function around(page, sels, pad = 16) {
  const boxes = [];
  for (const s of sels) { const b = await page.locator(s).first().boundingBox(); if (b) boxes.push(b); }
  const vp = page.viewportSize();
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad), y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const r = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad), btm = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  return { clip: { x, y, width: r - x, height: btm - y } };
}
const card = (page, num) => page.locator("#missions-grid .mission-card", { hasText: new RegExp("^\\s*" + num) }).first();
const tab = (page, key) => page.click(`#board-tabs .tab-${key}`);
const settle = (page, ms = 900) => page.waitForTimeout(ms);
const bottomNav = (page, i) => page.locator("#bottom-nav .bn-item").nth(i).click();

const SHOTS = {
  signin: signin(async () => ({ el: "#login-screen .login-box" }), { user: null }),
  request: signin(async (p) => { await p.click("#btn-request-access"); return { el: "#login-screen .login-box" }; }, { user: null }),
  reset: signin(async (p) => {
    await p.waitForSelector("#reset-screen:not(.hidden)");
    return { el: "#reset-screen .login-box" };
  }, { profilePatch: { must_change_password: true }, waitFor: "#reset-screen:not(.hidden)" }),

  board: both("desk", async () => ({})),
  topbar: both("desk", async (p) => around(p, ["#btn-lock", "#btn-avatar", "#btn-date-next"], 8)),
  people: both("desk", async (p) => {
    const b = await p.locator("#float-pool").boundingBox();
    return { clip: { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 560) } };
  }),
  "mission-menu": both("desk", async (p) => {
    await card(p, "101").locator(".mission-header .m-line2").click({ button: "right" });
    await p.waitForSelector("#context-menu:not(.hidden)");
    return around(p, [`#missions-grid .mission-card >> nth=0`, "#context-menu"]);
  }),
  "new-mission": both("desk", async (p) => {
    await p.click("#btn-new-mission");
    await p.waitForSelector("#modal-mission:not(.hidden)");
    return { el: "#modal-mission" };
  }),
  "emp-menu": both("desk", async (p) => {
    await card(p, "101").locator(".emp-card").first().click({ button: "right" });
    await p.waitForSelector("#context-menu:not(.hidden)");
    return around(p, [`#missions-grid .mission-card >> nth=0`, "#context-menu"]);
  }),
  lend: both("desk", async (p, lang) => {
    await card(p, "101").locator(".emp-card").first().click({ button: "right" });
    await p.locator("#context-menu .ctx-item", { hasText: lang === "th" ? "ให้ยืมไปบอร์ดอื่น" : "Lend to board" }).click();
    await p.waitForSelector("#modal-lend:not(.hidden)");
    await p.locator("#modal-lend .mm-board").nth(0).click();
    return { el: "#modal-lend" };
  }),
  forecast: both("desk", async (p) => { await p.click("#btn-date-next"); await settle(p, 1200); return {}; }),
  overview: both("desk", async (p) => { await tab(p, "overview"); await settle(p, 1500); return {}; }),
  "overview-more": both("desk", async (p) => {
    await tab(p, "overview"); await settle(p, 1500);
    await p.mouse.wheel(0, 900); await settle(p, 800);
    return {};
  }),
  capacity: both("desk", async (p) => { await tab(p, "capacity"); await settle(p, 1500); return {}; }),
  orgchart: both("desk", async (p) => { await tab(p, "orgchart"); await settle(p, 1500); return {}; }),
  manpower: both("desk", async (p) => { await tab(p, "emplist"); await settle(p, 1200); return {}; }),
  host: both("desk", async (p) => { await tab(p, "hostlist"); await settle(p, 1200); return {}; }),
  export: both("desk", async (p) => { await p.click("#btn-export"); await settle(p, 800); return { el: ".modal:not(.hidden)" }; }),
  "account-menu": both("desk", async (p) => {
    await p.click("#btn-avatar"); await settle(p, 400);
    return around(p, ["#btn-avatar", "#user-menu"], 12);
  }),
  users: both("desk", async (p) => {
    await p.click("#btn-avatar"); await p.click("#btn-settings");
    await p.waitForSelector("#settings-view:not(.hidden)");
    await p.click("#settings-tabs [data-tab=users]"); await settle(p);
    return {};
  }),
  roles: both("desk", async (p) => {
    await p.click("#btn-avatar"); await p.click("#btn-settings");
    await p.waitForSelector("#settings-view:not(.hidden)");
    await p.click("#settings-tabs [data-tab=roles]"); await settle(p);
    return {};
  }),

  "phone-board": both("phone", async () => ({})),
  "phone-drawer": both("phone", async (p) => { await p.click("#fp-drawer-handle"); await settle(p, 700); return {}; }),
  "phone-more": both("phone", async (p) => { await p.click("#m-more"); await settle(p, 500); return {}; }),
  "phone-me": both("phone", async (p) => { await bottomNav(p, 4); await settle(p, 500); return {}; }),
  "phone-overview": both("phone", async (p) => { await bottomNav(p, 1); await settle(p, 1500); return {}; }),
  "phone-manpower": both("phone", async (p) => { await bottomNav(p, 2); await settle(p, 1200); return {}; }),

  // explore: dumps what the app put on screen, to find selectors
  async explore(env) {
    const { page, ctx, errors } = await open(env, { device: "desk", lang: "en" });
    console.log(await page.evaluate(() => ({
      tabs: [...document.querySelectorAll("#board-tabs > *")].map((e) => e.className + " | " + e.textContent.trim().slice(0, 30)),
      date: document.querySelector("#date-label, #btn-date, .date-btn") && (document.querySelector("#date-label, #btn-date, .date-btn").textContent),
      missions: document.querySelectorAll("#missions-grid .mission-card").length,
    })));
    await shoot(page, "explore", "en");
    console.log("errors", errors);
    await ctx.close();
  },
};

(async () => {
  const want = process.argv.slice(2);
  const server = await serve();
  const browser = await chromium.launch();
  const env = { browser, base: `http://127.0.0.1:${server.address().port}/` };
  try {
    for (const [name, run] of Object.entries(SHOTS)) {
      if (want.length ? !want.includes(name) : name === "explore") continue;
      process.stdout.write(name + " … ");
      await run(env, name);
      console.log("ok");
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });

module.exports = { open, shoot };
