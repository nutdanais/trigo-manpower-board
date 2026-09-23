/* End-to-end harness: serves the real app from the repo, replaces supabase-js
   with tests/fake/fake-client.js, and backs every page with ONE shared FakeDb
   in this process — so two pages are two signed-in users on the same data, and
   a write by one reaches the other as a Realtime event.

   Needs Playwright + Chromium (preinstalled in the dev container; elsewhere
   `npm i -g playwright` and set NODE_PATH). Fixtures are fake names and
   example.com addresses only. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { FakeDb } = require("../fake/fake-db");

const ROOT = path.join(__dirname, "..", "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };

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

/* local-time ISO date, like the app's todayStr() */
function iso(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function addDays(s, n) { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); }
const isWeekend = (s) => [0, 6].includes(new Date(s + "T00:00:00").getDay());
function nextWorking(s) { let d = addDays(s, 1); while (isWeekend(d)) d = addDays(d, 1); return d; }
function prevWorking(s) { let d = addDays(s, -1); while (isWeekend(d)) d = addDays(d, -1); return d; }

const AREAS = ["board", "overview", "orgchart", "emplist", "hostlist", "settings", "users", "capacity", "forecast",
  "ov.status", "ov.kpi", "ov.actionQueue", "ov.byBoard", "ov.history", "ov.byEngineer", "ov.dayNight", "ov.hostRisk", "ov.byArea", "ov.leave"];
const USERS = {
  a: { id: "00000000-0000-0000-0000-00000000000a", email: "eng.a@example.com", role: "engineer" },
  b: { id: "00000000-0000-0000-0000-00000000000b", email: "eng.b@example.com", role: "engineer" },
  v: { id: "00000000-0000-0000-0000-00000000000c", email: "viewer.c@example.com", role: "viewer" },
};

/* Two boards, a small roster, and a confirmed plan on `src` for Board One. */
function seedBase(db, { src }) {
  db.seed("roles", [
    { key: "admin", label: "Admin", rank: 10, protected: true }, { key: "manager", label: "Manager", rank: 20, protected: false },
    { key: "engineer", label: "Engineer", rank: 30, protected: false }, { key: "viewer", label: "Viewer", rank: 40, protected: false },
  ]);
  const perms = [];
  for (const role of ["admin", "manager", "engineer", "viewer"]) {
    for (const area of AREAS) {
      let level = area.startsWith("ov.") || area === "overview" || area === "orgchart" ? "view" : (role === "viewer" ? "view" : "edit");
      if (area === "users") level = role === "admin" ? "edit" : "none";
      if (area === "settings" && role === "viewer") level = "none";
      perms.push({ role_key: role, area, level });
    }
  }
  db.seed("role_permissions", perms);
  db.seed("profiles", Object.values(USERS).map((u) => ({ id: u.id, email: u.email, full_name: u.email.split("@")[0], display_name: u.email.split("@")[0], role_key: u.role, status: "active" })));
  db.seed("service_areas", [{ id: "area-1", name: "AREA1", color: "#7fb8ec" }]);
  db.seed("engineers", [{ id: "eng-1", name: "Eng One", phone: "", color: "#a8d98a" }, { id: "eng-2", name: "Eng Two", phone: "", color: "#f6a06b" }]);
  db.seed("hosts", [{ name: "Host Alpha" }, { name: "Host Beta" }, { name: "Host Gamma" }].map((h) => ({ ...h, archived: false })));
  db.seed("boards", [{ id: "b1", name: "Board One", weekend_days: [0, 6] }, { id: "b2", name: "Board Two", weekend_days: [0, 6] }]);
  const emps = [];
  for (let i = 1; i <= 8; i++) emps.push({ id: "e" + i, name: `Person ${String.fromCharCode(64 + i)}`, contract: i >= 7 ? "oncall" : "permanent", area_id: "area-1", board_id: "b1" });
  for (let i = 9; i <= 10; i++) emps.push({ id: "e" + i, name: `Person ${String.fromCharCode(64 + i)}`, contract: "permanent", area_id: "area-1", board_id: "b2" });
  db.seed("employees", emps);
  db.seed("missions", [
    { id: "s101", board_id: "b1", plan_date: src, number: "101", host: "Host Alpha", customer: "Cust Alpha", shift: "day", engineer_id: "eng-1" },
    { id: "s102", board_id: "b1", plan_date: src, number: "102", host: "Host Beta", customer: "Cust Beta", shift: "day", engineer_id: "eng-2" },
    { id: "s103", board_id: "b1", plan_date: src, number: "103", host: "Host Gamma", customer: "Cust Alpha", shift: "night", engineer_id: "eng-1" },
  ]);
  db.seed("assignments", [
    { employee_id: "e1", plan_date: src, mission_id: "s101", zone: null },
    { employee_id: "e2", plan_date: src, mission_id: "s101", zone: null },
    { employee_id: "e3", plan_date: src, mission_id: "s102", zone: null },
    { employee_id: "e4", plan_date: src, mission_id: "s103", zone: null },
    { employee_id: "e5", plan_date: src, mission_id: null, zone: "annual" },
  ]);
}

async function launch() {
  const server = await serve();
  const browser = await chromium.launch();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const pages = [];

  /* one signed-in user = one browser context + page */
  async function openAs(db, user, opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", (r) =>
      r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(ROOT, "tests", "fake", "fake-client.js"), "utf8") }));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: "text/css", body: "" }));
    await page.exposeFunction("__fakeSupabaseExec", (q) => db.exec(q, user));
    await page.addInitScript((u) => {
      window.__fakeSession = { user: { id: u.id, email: u.email }, access_token: "fake" };
      try { localStorage.setItem("mpm-last-view", JSON.stringify({ boardId: "b1" })); } catch (e) { /* ignore */ }
    }, user);
    const unsub = db.subscribe((evt) => { page.evaluate((e) => window.__fakeSupabaseEmit && window.__fakeSupabaseEmit(e), evt).catch(() => {}); });
    await page.goto(base);
    await page.waitForSelector("#board-tabs .board-tab", { timeout: 15000 });
    const entry = { page, ctx, errors, close: async () => { unsub(); await ctx.close(); } };
    pages.push(entry);
    return entry;
  }

  async function close() {
    for (const p of pages) { try { await p.close(); } catch (e) { /* ignore */ } }
    await browser.close();
    server.close();
  }
  return { openAs, close, base };
}

module.exports = { launch, seedBase, FakeDb, USERS, iso, addDays, nextWorking, prevWorking, isWeekend };
