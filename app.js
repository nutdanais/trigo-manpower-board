/* Manpower Management Board — UI + interaction layer.
   All data access goes through `cloud` (cloud.js), which talks to Supabase
   and keeps an in-memory cache (`cloud.data`) that this file reads synchronously. */

"use strict";

/* ---------- utilities ---------- */
const uid = () => Math.random().toString(36).slice(2, 10);
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
/* coarse pointer = touch device (phone/tablet). Drives the touch assignment flow:
   plain tap builds a multi-selection (no Ctrl key), and a floating action bar
   replaces right-click for bulk actions. */
const IS_TOUCH = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(d).padStart(2,"0")}-${months[m-1]}-${y}`;
}
function fmtDow(iso) {
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(iso + "T00:00:00").getDay()];
}
const THAI_DOW = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
const THAI_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
function fmtDateThai(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = THAI_DOW[new Date(iso + "T00:00:00").getDay()];
  return `${dow} ${String(d).padStart(2,"0")}-${THAI_MONTHS[m-1]}-${y + 543}`;
}
function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
/* Calendar-boundary helpers for the Overview History range presets. Built by
   string surgery on the ISO date rather than via Date arithmetic: an ISO date
   here is always a local wall-clock day (see addDays' "T00:00:00"), and
   month-end is the one case where going through Date and back is genuinely
   easier to get wrong than right. Day 0 of month m+1 IS the last day of m. */
function monthStart(iso) { return iso.slice(0, 7) + "-01"; }
function monthEnd(iso) {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(y, m, 0);   // day 0 of the NEXT month = last day of this one
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function yearStart(iso) { return iso.slice(0, 4) + "-01-01"; }
/* Bounded pass, not a rewrite of every innerHTML site in this file: applied
   where markup is built from a free-typed field (employee/area names,
   mission number/host/customer/PPE, phone). Most other innerHTML call sites
   interpolate static enum labels, or already use .textContent (see e.g.
   board/engineer names in the Overview charts) — this only touches the
   sites that were actually building HTML from user-entered text. */
/* ---------- icons ----------
   Controls used to be labelled with emoji. Emoji are multi-colour, render as a
   different drawing on every OS, sit off the text baseline, and — the reason
   that actually mattered — cannot take a colour, so a disabled or hovered
   button kept a full-strength glyph beside its greyed-out label. These are one
   stroke set from the sprite at the top of index.html, drawn in currentColor,
   so an icon dims with the control it belongs to.

   Returns MARKUP, so it may only be used where the surrounding string is
   already trusted HTML — never concatenated with user-entered text that has
   not been through escapeHtml(). iconEl() is the same thing as a node, for the
   code paths that build controls with createElement instead. */
/* The sprite in index.html stays the single source of truth, but an icon is
   INLINED from it rather than referenced with <use>. Two html2canvas
   limitations force this, both verified against the bundled build:

     - a <use> pointing at a <symbol> renders as nothing in the capture, so
       every icon on the board vanished from the exported JPG;
     - an <svg> (or <img>) that is a DIRECT FLEX ITEM is dropped as well, which
       is why wrapping matters at the two call sites on the board.

   Inlining costs a little markup and fixes the first. currentColor still
   resolves, so themes and disabled states are unaffected. */
const ICON_CACHE = new Map();
function iconMarkup(name) {
  if (ICON_CACHE.has(name)) return ICON_CACHE.get(name);
  const sym = document.getElementById("i-" + name);
  // an unknown name must not silently draw nothing — that is how the missing
  // moon went unnoticed the first time
  if (!sym) { console.warn("unknown icon", name); ICON_CACHE.set(name, ""); return ""; }
  const attrs = [...sym.attributes]
    .filter(a => a.name !== "id")
    .map(a => `${a.name}="${a.value}"`).join(" ");
  const out = { attrs, inner: sym.innerHTML };
  ICON_CACHE.set(name, out);
  return out;
}
function icon(name, cls) {
  const m = iconMarkup(name);
  if (!m) return "";
  return `<svg class="ic${cls ? " " + cls : ""}" aria-hidden="true" ${m.attrs}>${m.inner}</svg>`;
}
function iconEl(name, cls) {
  const span = document.createElement("span");
  span.innerHTML = icon(name, cls);
  return span.firstElementChild || document.createTextNode("");
}

/* A control whose label is rebuilt on every render: icon + text, with the text
   as a real text node so nothing user-entered is ever parsed as markup. */
function setIconLabel(el, name, text, labelClass) {
  el.textContent = "";
  el.appendChild(iconEl(name));
  const span = document.createElement("span");
  if (labelClass) span.className = labelClass;
  span.textContent = text;
  el.appendChild(span);
}

/* A colour value as the label shown beside its swatch: "#a8c855" -> "A8C855".
   Printed so a colour is never encoded by colour alone — the same rule the
   Overview tables follow. */
function swHex(v) {
  return String(v || "").replace(/^#/, "").toUpperCase();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
/* A translucent wash of a colour that came from DATA (an engineer's picked
   colour), for a surface that still has to carry readable text in both themes.
   Deliberately computed to a plain rgba() rather than written as color-mix():
   Chromium serializes a color-mix() result as color(srgb ...), which
   html2canvas cannot parse — that took out the JPG export once already.
   Returns the input untouched if it isn't a hex colour, so a bad value degrades
   to "no tint" rather than to no background at all. */
function tintOf(color, alpha) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return color;
  const hex = m[1].length === 3 ? m[1].split("").map(c => c + c).join("") : m[1];
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
/* Pick readable ink for a pill whose background IS a data colour (service
   areas): white on a dark pill, near-black on a light one.

   Base is perceived brightness (ITU-R BT.601 luma on raw sRGB), not WCAG
   relative luminance — WCAG's gamma-corrected formula weights green so
   heavily that a saturated pink/magenta scores as "light" and gets black
   text even though it reads as dark. But luma ALONE isn't a readability
   rule either: BT.601 weights red at only 0.299, so a mid-tone saturated
   red (#e05a5a → 130) lands just over the 128 cutoff and gets black ink,
   which looks wrong. Saturated colours read heavier than their luma says
   (Helmholtz–Kohlrausch), so subtract a chroma term before the test. The
   penalty is deliberately proportional to saturation and nothing else: a
   NEUTRAL mid-grey at the same luma genuinely does want black ink, and
   simply raising the flat threshold would have flipped it to white too.

   Plain integer arithmetic on purpose — these pills sit inside the export
   capture area and html2canvas cannot parse color-mix() or relative-colour
   syntax. Checked against every seeded area colour (schema.sql): LCB 151,
   AYT 152, NPT 150, Wellgrow 171, AMATA 188, BENZ 232 and the #9ca3af
   new-area default 157 all stay black; reds #e05a5a → 100 and #f87171 →
   126 go white. */
function inkOn(bg) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(bg).trim());
  if (!m) return "var(--card-ink)";
  const hex = m[1].length === 3 ? m[1].split("").map(c => c + c).join("") : m[1];
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const luma = (r * 299 + g * 587 + b * 114) / 1000;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max ? (max - min) / max : 0;          // HSV saturation, 0..1
  return (luma - sat * INK_CHROMA_PENALTY) > 128 ? "#1a1a1a" : "#ffffff";
}
/* How much a fully saturated colour is discounted before the 128 brightness
   test above. 50 is the value that puts a soft red (#f87171, luma 153) on
   white ink while leaving the lightest saturated pastel in use (Wellgrow
   #f5c26b, luma 199) comfortably on black. */
const INK_CHROMA_PENALTY = 50;
/* strip everything but digits/+ so the href itself is always a valid,
   injection-safe tel: URI regardless of how the number was typed in */
function telHref(phone) {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  return digits ? "tel:" + digits : "";
}
function telLink(phone, cls) {
  const href = telHref(phone);
  return href ? `<a class="tel-link${cls ? " " + cls : ""}" href="${href}" onclick="event.stopPropagation()">${escapeHtml(phone)}</a>` : (phone || "");
}
/* default landing = next working day: tomorrow, skipping weekends & holidays */
function defaultPlanningDate() {
  let d = addDays(todayStr(), 1);
  while (isNonWorkingDate(d)) d = addDays(d, 1);
  return d;
}

/* Remember the last BOARD the user was looking at (not the date) so reopening
   the app doesn't dump a multi-board planner back on board #1 every time.
   The date is deliberately NOT restored: the app always opens on the next
   working day. Restoring it meant a daily user who planned tomorrow today
   came back tomorrow and landed on that same date — by then <= today, so
   read-only (see isReadOnly) — and had to click forward every morning.
   Landing on a date is a pure read (cloud.ensurePlanLoaded), so the choice
   is purely about where it's most useful to start, not about data safety. */
const VIEW_KEY = "mpm-last-view";
function saveViewState() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ boardId: D().activeBoardId }));
  } catch { /* storage unavailable (private mode, quota) — just skip persisting */ }
}
/* Restore the saved board if it's still valid, then always land on the next
   working day. Order matters: activeBoardId is assigned FIRST because
   defaultPlanningDate() → isNonWorkingDate() defaults to the active board, and
   boards have their own weekendDays plus per-date holiday overrides — so the
   answer depends on which board we just restored. (On Overview / Manpower List
   there's no real board to read config from; boardWeekendDays() falls back to
   Sat/Sun, which is the sensible default for those non-board-scoped views.) */
function restoreViewState() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY));
    if (v && v.boardId && mayOpenView(v.boardId)) {
      D().activeBoardId = v.boardId;
    }
  } catch { /* no saved view, or it's corrupt — just keep the default board */ }
  // A role change can take away the tab we were last on (or the default board,
  // for a role with no board access at all) — land somewhere they can actually
  // open rather than on an empty screen.
  if (!mayOpenView(D().activeBoardId)) D().activeBoardId = firstAllowedView();
  state.date = defaultPlanningDate();
}

/* zone labels (keys come from ZONES in cloud.js) */
const ZONE_LABELS = {
  annual: "Annual Leave", sick: "Sick Leave", business: "Business Leave",
  unpaid: "Unpaid Leave", exchange: "Exchange Working Day",
};
const ZONE_LABELS_TH = {
  annual: "ลาพักร้อน", sick: "ลาป่วย", business: "ลากิจ",
  unpaid: "ลาไม่รับค่าจ้าง", exchange: "สลับวันหยุด",
};
const LEAVE_ZONES = ["annual", "sick", "business", "unpaid", "exchange"];

/* employee position — fixed list; short form is what shows on the card */
const POSITIONS = {
  inspector: { label: "Inspector", short: "Ins" },
  senior_inspector: { label: "Senior Inspector", short: "SI" },
  technician: { label: "Technician", short: "Tec" },
  team_leader: { label: "Team Leader", short: "TL" },
  assistant_site_engineer: { label: "Assistant Site Engineer", short: "AE" },
};
/* ---------- Overview History: the two range charts below Trend ----------
   Trend answers "how has ONE measure moved across the boards over the last
   few weeks". History answers the other half: "what did a whole month, or
   the year so far, look like" — so it flips the axes. One line per MEASURE
   over an arbitrary date range, with the board dimension moved into a
   <select>, because six measures on six boards is 36 lines and no chart.

   Colours are anchored to what they already mean elsewhere on this page
   rather than handed out by index: idle is the standby red the Action queue
   and KPI tile use, on-call deployment is the same orange as every contract
   split, deployed-total is the assigned blue. Only the two series with no
   prior meaning (permanent split, missions) take a categorical slot. */
/* Overview History: four measures, ONE charted at a time — each on its own
   axis, so Missions (~4) is never squashed flat under Idle (~28). */
const OV_HISTORY_MEASURES = [
  { key: "util",     label: "Utilization",    suffix: "%", value: (r) => trendMetricValue("util", r),
    help: "Assigned ÷ (Assigned + Standby), averaged over the working days. People on leave (exchange working day included), on a holiday or on-call and not called in are left out, so a day with no one on Standby reads 100%." },
  { key: "deployed", label: "Deployed / day", suffix: "",  value: (r) => r.assigned,
    help: "People on a mission each working day (permanent and on-call), averaged over the range." },
  { key: "idle",     label: "Idle / day",     suffix: "",  value: (r) => trendMetricValue("idle", r),
    help: "Permanent people on no mission and no leave each working day, the board's Standby, averaged over the range. It is the share Utilization misses. On-call people who were not called in are not idle." },
  { key: "missions", label: "Missions / day", suffix: "",  value: (r) => r.staffedMissions,
    help: "Missions with at least one person on them each working day, averaged over the range." },
];
const OV_IDLE_SHOWN = 6;   // idle names shown per board in the attention card before "+N more"
/* the utilization formula, said once behind an ⓘ (hover / focus) instead of
   printed under two sections */
const OV_UTIL_INFO = '<span class="ov-info chart-mark" tabindex="0" data-tip-value="Utilization" data-tip-label="Assigned ÷ (Assigned + Standby): how much of the people really available that day is deployed. People on leave (exchange working day included), on a holiday or on-call and not called in are left out, so 0 Standby reads 100%.">i</span>';
const HISTORY_SUM_KEYS = ["assigned", "headcount", "leave", "oncallAssigned", "oncallHeadcount", "oncallLeave", "staffedMissions"];
async function safely(fn) {
  try { await fn(); } catch (e) { toast("Something went wrong: " + (e.message || e), "error"); }
}

/* ---------- toasts ----------
   Replaces window.alert() everywhere: a blocking dialog stops the whole app
   (and on a factory-floor tablet, easily gets tapped through without being
   read). These stack bottom-left, auto-dismiss, and never block input. */
function toast(message, type = "info", opts = {}) {
  const stack = $("#toast-stack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = "toast toast-" + type;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  const msg = document.createElement("span");
  msg.className = "toast-msg";
  msg.textContent = message;
  el.appendChild(msg);
  // opts.action = { label, run }: one follow-up the toast offers, e.g. Undo
  if (opts.action) {
    const act = document.createElement("button");
    act.className = "toast-action";
    act.type = "button";
    act.textContent = opts.action.label;
    act.onclick = () => { remove(); opts.action.run(); };
    el.appendChild(act);
  }
  const close = document.createElement("button");
  close.className = "toast-close";
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";
  close.onclick = () => remove();
  el.appendChild(close);
  stack.appendChild(el);
  let timer = null;
  const remove = () => { clearTimeout(timer); el.classList.add("toast-out"); setTimeout(() => el.remove(), 180); };
  // errors stay up longer (and the user can still dismiss early) — a "your
  // name already exists" toast that vanishes before it's read helps no one
  const ms = opts.duration != null ? opts.duration : (type === "error" ? 7000 : 3500);
  if (ms > 0) timer = setTimeout(remove, ms);
  return remove;
}

/* ---------- save/sync status pill ----------
   Wraps every cloud.js write method so the topbar can show Saving… / Saved
   HH:MM / Save failed without cloud.js itself knowing about the UI. Reads
   (ensurePlanLoaded, the _load* calls, getUtilizationRange) are deliberately
   NOT wrapped — this pill answers "did my change stick?", not "is data
   loading?". */
function setSaveStatus(kind) {
  const el = $("#save-status");
  if (!el) return;
  el.classList.remove("hidden", "save-saving", "save-saved", "save-error");
  if (kind === "saving") {
    el.classList.add("save-saving");
    el.textContent = "Saving…";
  } else if (kind === "saved") {
    el.classList.add("save-saved");
    el.textContent = "Saved " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  } else if (kind === "error") {
    el.classList.add("save-error");
    setIconLabel(el, "alert", "Save failed");
  }
}
const CLOUD_WRITE_METHODS = [
  "applyCarry", "resetBoardFromLastWorkingDay", "setAssignment", "applyPlanDiff", "applyForecastMerge",
  "setCapacityCells", "deleteCapacityRow", "resetCapacityDemand", "saveForecastMission", "deleteForecastMission", "setForecastAssignment",
  "startForecastFromConfirmed", "addForecastMissionsFromConfirmed", "copyForecastToDates", "acknowledgeHoldEvents",
  "saveMission", "deleteMission", "importMissions", "setMissionsHidden", "setDayWorking",
  "lockDay", "unlockDay", "saveEmployee", "setEmployeesActive",
  "setEmployeesPosition", "setEmployeesContract", "setEmployeesArea", "moveEmployeeToBoard",
  "moveEmployeesToBoard", "createBoard", "renameBoard", "saveBoardWeekendDays",
  "saveEngineerField", "addEngineer", "deleteEngineer", "saveAreaField", "addArea", "deleteArea",
  "saveHost", "deleteHost", "mergeHost", "applyEmployeeImport", "applyHostImport",
  "addEmployeeNote", "deleteEmployeeNote",
];
function wireSaveStatus() {
  for (const name of CLOUD_WRITE_METHODS) {
    const orig = cloud[name];
    if (typeof orig !== "function") continue;
    cloud[name] = async function (...args) {
      setSaveStatus("saving");
      try {
        const result = await orig.apply(this, args);
        setSaveStatus("saved");
        return result;
      } catch (e) {
        setSaveStatus("error");
        throw e;
      }
    };
  }
}

/* ---------- app state ---------- */
const state = {
  // Provisional: at module-init cloud.data.boards/.overrides are still empty, so
  // this can't see weekend config or holidays yet. boot() re-derives it via
  // restoreViewState() once cloud.init() has loaded both — that's the real value.
  date: defaultPlanningDate(),   // land on the next working day's plan, not today
  myEmail: null,   // set once at boot from cloud.getSession() — who to NOT toast about
  filters: { engineer: [], host: [], customer: [], shift: [] },   // multi-select; [] = All
  sort: "number",                // default: sort by mission number on every board
  unlockedDates: new Set(),   // past/today dates the user confirmed they want to edit
  editingMissionId: null,
  editingEmployeeId: null,
  selectedEmps: new Set(),    // multi-select of employee ids (Ctrl-click); drag/click assigns the whole set
  empSearch: "",              // name filter for the floating available panel
  poolAreas: new Set(),       // service-area filter for the floating panel; empty = all
  undoStack: [],              // [{date, entries:[{empId, prior}]}] — inverse of recent assignment changes
  settingsOpen: false,        // the Settings page (#settings-view) is up over the app
  settingsTab: "account",     // which section is showing. applySettingsTab falls back to My account
                              // when this role may not open it
  settingsReturn: null,       // {scrollY} of the page underneath, put back on "Back to board"
  settingsStale: false,       // a live update arrived while a field had focus: redraw once it leaves
  settingsSave: { phase: "clean" },   // clean | dirty | saving | saved | error, per the open section
  settingsDraft: { account: {}, engineers: {}, areas: {}, boards: {}, roles: {} },   // staged edits, by section
  rolesColumn: null,          // Roles & permissions: the one role shown below 960px
  employeeTab: "edit",        // Employee modal: "edit" or "hosts" (Host Record) — reset on every open
  cardNames: cardNamesSaved(),   // names on the board's employee cards: "th" | "en" | "both"
  emplist: {                  // Manpower List tab: search/filter/sort, independent of any board or date
    search: "",
    filters: { contract: [], position: [], service: [], areaId: [], boardId: [], status: [] },
    sortKey: "name",
    sortDir: 1,
    issue: null,         // a status chip's narrowing: "trigo" | "area" | "en" (active people missing it), or null
    nameView: "th",      // which name the list shows: "th" | "en" | "both" (remembered per device)
    util: null,          // { [empId]: pct } once loaded; null = not fetched yet
    utilCacheKey: null,  // same "fetch only when the window actually moved" trick as overview
  },
  users: {                    // Settings > Users: search/filter/sort over the people list
    search: "",
    filters: { roleKey: [], status: [] },
    pendingOnly: false,       // "Review requests" — show only accounts waiting for approval
    sortKey: "email",
    sortDir: 1,
    editingId: null,          // profile id the User modal is editing
  },
  hostlist: {                 // Host List tab: search/filter/sort over the host directory
    search: "",
    filters: { areaId: [], boardId: [], empId: [], location: [], status: [] },
    dupOnly: false,      // "Review duplicates" — show only names that look like duplicates of each other
    sortKey: "name",
    sortDir: 1,
    dir: null,           // cloud.getHostDirectory() result; null = not fetched yet
    dirCacheKey: null,   // same "fetch once, reuse across redraws" trick as emplist below
    expanded: new Set(), // host names whose full inspector list is shown (the rest are capped)
    editingHost: null,   // host name the Host modal is editing; null = adding a new one
    returnToMission: false,   // Host modal was opened from the New Mission form — go back to it when done
  },
  overview: {                 // Overview tab: utilization trend chart controls + its cache
    trendRange: 14,           // 7 | 14 | 30 days, ending on state.date — same date as every
                               // other number on the Overview page (see the comment in renderOverview).
                               // No UI control any more (the Trend chart that exposed it was removed);
                               // it's now just the fixed window behind the KPI tile's sparkline.
    util: null,               // cloud.getUtilizationRange() result, keyed by utilCacheKey below
    utilCacheKey: null,
    hostCoverage: null,       // cloud.getHostCoverageForHosts() result, keyed by hostCoverageCacheKey below
    hostCoverageCacheKey: null,
    oncallQueueOpen: false,   // attention card: the on-call-free names are collapsed by default (calm, not urgent)
    idleOpen: new Set(),      // attention card: board ids whose idle list is expanded past OV_IDLE_SHOWN

    /* History + Engineer workload: one date range, one fetch, two charts.
       Deliberately NOT sharing state.overview.util above — Trend is 7/14/30
       days and History can be a whole year, and one shared cache would drag
       a year of rows in every time somebody clicked "7d". */
    historyPreset: "thisMonth",   // thisMonth | lastMonth | last30 | last90 | ytd | custom
    historyFrom: null,            // resolved by resolveHistoryRange() on first render
    historyTo: null,
    boardId: ovBoardSaved(),      // the board selector at the top: "" = all boards; otherwise one
                                  // board id. Scopes EVERY section, History included (ovScopeBoards)
    historyMeasure: "util",       // the History tile charted day by day (OV_HISTORY_MEASURES key)
    history: null,                // cloud.getUtilizationRange() over the History range
    historyCacheKey: null,
  },
  /* the board's two banners (see renderPlanBanners): what cloud.getPlanSignals
     and the forecast cache said about the board+date in `key` */
  signals: { key: null, stamp: null, stale: null, forecast: null, decisions: [] },
  dismissedStale: new Set(),   // "board|date|source edit time" the user dismissed this session
  diff: null,                  // the open Review changes session
  merge: null,                 // the open Review & merge (forecast) session: PlanDiff merge model + choices
  capacity: {                  // Capacity tab
    weeks: 2,                  // range: 1..8 weeks from today
    boardId: null,             // the one board the tab shows (see capBoardId)
    inputs: null,              // cloud.getCapacityInputs() for the range
    cacheKey: null,
    extraRows: {},             // { boardId: [{host, shift}] } rows added but with no number yet
    sel: null,                 // Excel-style selection { boardId, a: [row, col], f: [row, col] }
    phoneRow: null,            // phone layout: the host row shown ("host\u0001shift")
    phoneWeek: 0,              // phone layout: which week of the range
  },
};

const D = () => cloud.data;
const OVERVIEW_ID = "__overview__";
const ORGCHART_ID = "__orgchart__";
const EMPLIST_ID = "__emplist__";
const HOSTLIST_ID = "__hostlist__";
const CAPACITY_ID = "__capacity__";
const isOverview = () => D().activeBoardId === OVERVIEW_ID;
const isOrgChart = () => D().activeBoardId === ORGCHART_ID;
const isEmployeeList = () => D().activeBoardId === EMPLIST_ID;
const isHostList = () => D().activeBoardId === HOSTLIST_ID;
const isCapacity = () => D().activeBoardId === CAPACITY_ID;
/* which forward-planning tables this database has (see cloud._loadFeatures) —
   each part of the feature stays hidden until its migration has been run */
const feat = () => D().features || {};

/* ---------- permissions ----------
   The JS twin of public.can() in the database (see
   migration-2026-09-04b-user-management.sql). Both read the same role x area
   matrix off the same ladder, so the UI and Postgres can never disagree about
   what a role means — the UI decides what to draw, RLS decides what a write is
   allowed to do, and neither is trusted to do the other's job.

   `me.legacy` is set by cloud._loadIdentity when the user-management migration
   has not been run yet: allow everything, which is exactly how the app behaved
   before roles existed. */
const LEVELS = { none: 0, view: 1, edit: 2 };
function can(area, need = "view") {
  const me = D().me;
  if (!me) return false;
  if (me.legacy) return true;
  if (me.status !== "active") return false;
  const row = D().perms[me.roleKey] || {};
  // The Org Chart tab is a read-only re-view of the same missions/assignments
  // the Overview reads, so until a project runs the orgchart migration it
  // simply follows whatever "overview" grants — an explicit orgchart row (once
  // seeded, or set in Settings) always wins. No write ever keys off "orgchart",
  // so this fallback is presentation only.
  let level = row[area];
  if (area === "orgchart" && level === undefined) level = row["overview"];
  return (LEVELS[level] || 0) >= (LEVELS[need] || 0);
}
/* The areas the permission matrix covers, in the order they are shown in
   Settings -> Roles & permissions. Labels are the ones already used on the tabs
   and on each Overview section's own heading, so the grid reads like the app. */
const PERM_AREAS = [
  { group: "Tabs & menus", items: [
    { key: "board",    label: "Board",          hint: "Missions, assignments, the day lock" },
    { key: "overview", label: "Overview tab",   hint: "The dashboard as a whole", viewOnly: true },
    { key: "orgchart", label: "Org Chart",      hint: "Board → engineer → service area → mission → crew", viewOnly: true },
    { key: "emplist",  label: "Manpower",       hint: "The employee roster" },
    { key: "hostlist", label: "Host",           hint: "Sites and their records" },
    { key: "capacity", label: "Capacity",       hint: "Headcount needed per host vs available, weeks ahead" },
    { key: "forecast", label: "Forecast",       hint: "Tentative plans after tomorrow, and holds on people" },
    { key: "settings", label: "Settings",       hint: "Engineers, service areas, board weekends" },
    { key: "boarddelete", label: "Rename & delete boards", hint: "Settings → Board: rename a board, or remove it and all its missions", allowOnly: true },
    { key: "users",    label: "Users & roles",  hint: "This screen, and who may sign in" },
  ]},
  { group: "Overview sections", viewOnly: true, items: [
    // the attention card keeps the two keys its halves had before they were
    // merged, so a role sees exactly what it could see then
    { key: "ov.status",      label: "Attention card: headline" },
    { key: "ov.actionQueue", label: "Attention card: idle names" },
    { key: "ov.kpi",         label: "KPI tiles" },
    { key: "ov.byBoard",     label: "By board" },
    { key: "ov.byEngineer",  label: "By engineer" },
    { key: "ov.byArea",      label: "By service area" },
    { key: "ov.dayNight",    label: "Shifts" },
    { key: "ov.hostRisk",    label: "Host coverage" },
    { key: "ov.history",     label: "History + Engineer workload" },
  ]},
];
/* The first tab this user is actually allowed to open — used when a saved view
   points somewhere they have since lost, and as the landing tab for a role that
   cannot see the board. */
function firstAllowedView() {
  if (can("board") && D().boards.length) return D().boards[0].id;
  if (can("overview")) return OVERVIEW_ID;
  if (can("orgchart")) return ORGCHART_ID;
  if (can("emplist")) return EMPLIST_ID;
  if (can("hostlist")) return HOSTLIST_ID;
  if (can("capacity") && feat().capacity) return CAPACITY_ID;
  return null;
}
/* True when the view is one this user may still open. */
function mayOpenView(id) {
  if (id === OVERVIEW_ID) return can("overview");
  if (id === ORGCHART_ID) return can("orgchart");
  if (id === EMPLIST_ID) return can("emplist");
  if (id === HOSTLIST_ID) return can("hostlist");
  if (id === CAPACITY_ID) return can("capacity") && !!feat().capacity;
  return can("board") && D().boards.some(b => b.id === id);
}
/* the three app-wide tabs: not a board, so nothing date- or plan-scoped applies */
const isNonBoardView = () => isOverview() || isOrgChart() || isEmployeeList() || isHostList() || isCapacity();

/* ---------- confirm horizon: confirmed vs forecast dates ----------
   A confirmed plan is made up to the next working day of each board (its own
   work week and holidays); every date after that is FORECAST. Past dates,
   today and any non-working days before the horizon stay confirmed exactly as
   before. Only applies once the forecast tables exist — before the migration
   every date is a confirmed date, as it always was. */
function horizonEndFor(boardId) {
  return Horizon.end(todayStr(), (d) => isNonWorkingDate(d, boardId), Horizon.N);
}
function isForecastDateFor(boardId, date) {
  return !!feat().forecast && date > horizonEndFor(boardId);
}
/* the board on screen is showing a forecast (not the confirmed plan) */
const isForecastView = () => !isNonBoardView() && !!D().activeBoardId && isForecastDateFor(D().activeBoardId, state.date);
const sameEmail = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
/* a forecast hold that belongs to another engineer. "migrated" marks a hold
   the data migration could not attribute to anyone — nobody to tell, so it is
   treated as unowned (the database skips the event for it too). */
const isOthersHold = (heldBy) => !!heldBy && heldBy.toLowerCase() !== "migrated" && !sameEmail(heldBy, state.myEmail);
const isPast = () => state.date < todayStr();
/* ---------- lock (finalized board, view-only for everyone) ---------- */
const lockInfo = (boardId, date) => D().locks.find(l => l.boardId === boardId && l.date === date) || null;
/* cloud.unlockDay() awaits a fresh reload of cloud.data.locks before returning,
   so lockInfo() already reflects "unlocked" the moment it resolves — no local
   override needed (and one would risk masking a later re-lock by someone else). */
const isLocked = (boardId, date) => !!lockInfo(boardId, date);
/* past AND today are read-only by default — today's plan is already being executed.
   A forecast date is never read-only: it is after tomorrow by definition, and
   locks belong to confirmed days (the Lock button is hidden there). */
const isReadOnly = () => !isForecastView() && (isLocked(D().activeBoardId, state.date) || (state.date <= todayStr() && !state.unlockedDates.has(state.date)));
const boardEmployees = (boardId) => D().employees.filter(e => e.boardId === boardId);
/* A deactivated employee (Status column in the Manpower List) is off the
   planning roster: they disappear from the pools, from mission/leave cards and
   from the counts built out of them — but only on today's and future boards.
   A past date is a record of what actually happened, so it keeps showing
   everyone who was really there; that's the whole reason deactivating is a
   flag rather than a delete. boardEmployees() above stays unfiltered on
   purpose — it's the raw lookup history rendering depends on. */
const showsDeactivated = () => state.date < todayStr();
/* Day-level join date: someone added to the app on the 1st doesn't exist on
   the board before that date, so a bulk add never inflates Standby/headcount for
   earlier days. Blank addedOn = predates the column = always counted. */
const hasJoined = (e) => !e.addedOn || e.addedOn <= state.date;
const onRoster = (e) => hasJoined(e) && (showsDeactivated() || e.active !== false);
const rosterEmployees = (boardId) => boardEmployees(boardId).filter(onRoster);

/* ---------- plan access (reads the cache cloud.js keeps warm) ---------- */
function emptyPlan() { return { missions: [], zones: emptyZones(), updatedAt: null }; }

/* On a forecast date the board on screen is the FORECAST plan, from its own
   cache — every board read below (cards, pools, stats, the context menu) then
   works on it unchanged. Nothing else ever reads the forecast cache: Overview,
   Org Chart, utilization and the export all go through the confirmed plans. */
function forecastPlanOf(boardId, date) {
  const plan = D().forecast[boardId] && D().forecast[boardId][date];
  return plan || { ...emptyPlan(), holds: {}, authors: [], isForecast: true };
}
function getPlan() {
  return peekPlan(D().activeBoardId);
}
function peekPlan(boardId) {
  if (boardId === D().activeBoardId && isForecastView()) return forecastPlanOf(boardId, state.date);
  return (D().plans[boardId] && D().plans[boardId][state.date]) || emptyPlan();
}

/* Refetches state.overview.util only when what it depends on actually changed
   (board list, chosen range, or a new day rolling by) — every other Overview
   redraw (a filter tick, a legend toggle, a realtime ping) reuses the cached
   result. boot()'s cloud.onChange handler resets utilCacheKey to null on any
   realtime data change, which is what forces a real refetch after an edit.

   utilFetchSeq guards against an out-of-order response: switching 7d → 14d →
   30d quickly fires three overlapping fetches, and network timing gives no
   guarantee the last one issued is the last one to resolve — a smaller,
   already-superseded range's response can land after a larger one's and
   silently overwrite it, showing data for a range other than the one
   currently selected. Each call stamps its own sequence number and only
   applies its result if nothing newer has started since. */
let utilFetchSeq = 0;
async function ensureUtilizationLoaded() {
  const boardIds = D().boards.map(b => b.id);
  if (!boardIds.length) { state.overview.util = {}; state.overview.utilCacheKey = "empty"; return; }
  const toDate = state.date;   // ends on the date Overview is showing — see state.overview.trendRange
  const fromDate = addDays(toDate, -(state.overview.trendRange - 1));
  const cacheKey = boardIds.slice().sort().join(",") + "|" + fromDate + ".." + toDate;
  if (state.overview.utilCacheKey === cacheKey) return;
  const seq = ++utilFetchSeq;
  const result = await cloud.getUtilizationRange(boardIds, fromDate, toDate);
  if (seq !== utilFetchSeq) return;   // a newer request has since superseded this one
  state.overview.util = result;
  state.overview.utilCacheKey = cacheKey;
}

/* ---------- Overview History: date range + its own fetch ---------- */
/* The presets, resolved against `anchor` (state.date — same date the rest of
   the Overview page describes, see the comment in renderOverview). Every
   preset is capped at today: a range whose second half hasn't happened yet
   would drag every average down with empty days. */
const HISTORY_PRESETS = [
  { key: "thisMonth", label: "This month", range: (a) => [monthStart(a), monthEnd(a)] },
  { key: "lastMonth", label: "Last month", range: (a) => { const p = addDays(monthStart(a), -1); return [monthStart(p), monthEnd(p)]; } },
  { key: "last30",    label: "Last 30d",   range: (a) => [addDays(a, -29), a] },
  { key: "last90",    label: "Last 90d",   range: (a) => [addDays(a, -89), a] },
  { key: "ytd",       label: "YTD",        range: (a) => [yearStart(a), a] },
];
/* Writes historyFrom/historyTo for the current preset. "custom" is left alone
   — its dates came from the two date inputs. Called at the top of every
   Overview refresh so a preset follows state.date as the user browses days. */
function resolveHistoryRange() {
  const ov = state.overview;
  const today = todayStr();
  /* Anchored at state.date like the rest of the page, but never past today:
     state.date is a PLANNING date and routinely sits in the future (that's
     what the Carry over button is for). Anchoring "This month" on a future
     day and then capping the end at today would collapse the range to a
     single day, so the anchor itself is capped instead — browsing forward
     leaves History showing the current month rather than an empty sliver. */
  const anchor = state.date > today ? today : state.date;
  if (ov.historyPreset !== "custom") {
    const preset = HISTORY_PRESETS.find(p => p.key === ov.historyPreset) || HISTORY_PRESETS[0];
    const [from, to] = preset.range(anchor);
    ov.historyFrom = from;
    ov.historyTo = to;
  }
  if (ov.historyTo > today) ov.historyTo = today;               // nothing to show past today
  if (ov.historyFrom > ov.historyTo) ov.historyFrom = ov.historyTo;
}

/* Same shape as ensureUtilizationLoaded above, including the out-of-order
   guard — clicking YTD → This month → Last 90d fires three overlapping
   fetches and the network gives no promise the last one issued lands last.
   Always fetches ALL boards: the History board <select> filters at render
   time, so switching boards costs a redraw, not a round trip. */
let historyFetchSeq = 0;
async function ensureHistoryLoaded() {
  const ov = state.overview;
  const boardIds = D().boards.map(b => b.id);
  if (!boardIds.length) { ov.history = {}; ov.historyCacheKey = "empty"; return; }
  resolveHistoryRange();
  const cacheKey = boardIds.slice().sort().join(",") + "|" + ov.historyFrom + ".." + ov.historyTo;
  if (ov.historyCacheKey === cacheKey) return;
  const seq = ++historyFetchSeq;
  const result = await cloud.getUtilizationRange(boardIds, ov.historyFrom, ov.historyTo);
  if (seq !== historyFetchSeq) return;   // a newer request has since superseded this one
  ov.history = result;
  ov.historyCacheKey = cacheKey;
}

/* Manpower List's 30D column. Per employee: days actually deployed on a mission
   / working days available to them (their board's working days in the window
   from the day they were added to the app, minus their own leave). So leave doesn't punish the figure, and someone whose
   board was shut all month reads "—" rather than a misleading 0%.
   Note this is deliberately NOT the board-level rule, where free on-call is
   dropped from the denominator: at board level "we didn't need to call anyone"
   is the system working, but for one on-call individual, days-not-worked is
   exactly the number you're looking for. An on-call person reading low here is
   information, not a bug. */
const EMPLIST_UTIL_DAYS = 30;
let emplistUtilFetchSeq = 0;   // guards against an out-of-order response — see utilFetchSeq above
async function ensureEmplistUtilLoaded() {
  const toDate = todayStr();
  const fromDate = addDays(toDate, -(EMPLIST_UTIL_DAYS - 1));
  const cacheKey = fromDate + ".." + toDate + "|" + D().employees.length;
  if (state.emplist.utilCacheKey === cacheKey) return;
  const seq = ++emplistUtilFetchSeq;
  const raw = await cloud.getEmployeeUtilization(fromDate, toDate);
  if (seq !== emplistUtilFetchSeq) return;   // a newer request has since superseded this one
  // working days per board, counted from each day of the window to its end —
  // someone added to the app part-way through the window is only measured from
  // the day they were added (employees.added_on); the days before they existed
  // here must not read as days they could have worked
  const workingFrom = {};
  for (const b of D().boards) {
    const byDay = {};
    let n = 0;
    for (let d = toDate; d >= fromDate; d = addDays(d, -1)) { if (!isNonWorkingDate(d, b.id)) n++; byDay[d] = n; }
    workingFrom[b.id] = byDay;
  }
  const out = {};
  for (const e of D().employees) {
    const r = raw[e.id];
    const start = e.addedOn && e.addedOn > fromDate ? e.addedOn : fromDate;
    const working = start > toDate ? 0 : ((workingFrom[e.boardId] || {})[start] || 0);
    // only leave that lands on a working day shrinks the denominator
    let leaveOnWorkdays = 0;
    if (r) for (const d of r.leaveDates) if (d >= start && !isNonWorkingDate(d, e.boardId)) leaveOnWorkdays++;
    const denom = working - leaveOnWorkdays;
    let worked = 0;
    if (r) for (const d of r.workedDates) if (d >= start && !isNonWorkingDate(d, e.boardId)) worked++;
    out[e.id] = denom > 0 ? Math.round((worked / denom) * 100) : null;
  }
  state.emplist.util = out;
  state.emplist.utilCacheKey = cacheKey;
}

/* Host List's one fetch: the whole host directory (who worked where, on which
   boards, how many days). Cached across redraws exactly like the Manpower
   List's 30D column, so typing in the search box, ticking a filter or clicking
   a column header costs a redraw, not a round trip. boot()'s cloud.onChange
   handler clears dirCacheKey on any realtime data change, which is what forces
   a real refetch after somebody edits a mission or an assignment. The employee
   roster is part of the key because the directory resolves employee ids
   through it (see getHostDirectory). */
let hostDirFetchSeq = 0;   // guards against an out-of-order response — see utilFetchSeq above
async function ensureHostDirectoryLoaded() {
  const cacheKey = D().employees.length + "|" + D().boards.length + "|" + D().hosts.length;
  if (state.hostlist.dirCacheKey === cacheKey && state.hostlist.dir) return;
  const seq = ++hostDirFetchSeq;
  const result = await cloud.getHostDirectory();
  if (seq !== hostDirFetchSeq) return;   // a newer request has since superseded this one
  state.hostlist.dir = result;
  state.hostlist.dirCacheKey = cacheKey;
}

/* Overview's "Host coverage risk" module: for every host with a mission on
   the date on screen, how many distinct employees have ever been deployed
   there (across all history, not just this window). Refetches only when the
   set of today's hosts actually changes — a filter tick or legend toggle
   reuses the cached result, same trick as ensureUtilizationLoaded. Requires
   plans to already be loaded (peekPlan reads the cache, doesn't fetch). */
let hostCoverageFetchSeq = 0;   // guards against an out-of-order response — see utilFetchSeq above
async function ensureHostCoverageLoaded() {
  const hosts = [...new Set(D().boards.flatMap(b =>
    peekPlan(b.id).missions.filter(m => !m.hidden).map(m => m.host)))];
  const cacheKey = state.date + "|" + hosts.slice().sort().join(",");
  if (state.overview.hostCoverageCacheKey === cacheKey) return;
  const seq = ++hostCoverageFetchSeq;
  // only deployments up to the date on screen: a past day's risk list must not
  // change because someone added later has since worked one of its hosts
  const result = hosts.length ? await cloud.getHostCoverageForHosts(hosts, state.date) : {};
  if (seq !== hostCoverageFetchSeq) return;   // a newer request has since superseded this one
  state.overview.hostCoverage = result;
  state.overview.hostCoverageCacheKey = cacheKey;
}

/* warm the cache for whatever is currently in view, then redraw. Loading is
   always a pure read — no view, refresh, Realtime ping, tab refocus, or login
   ever seeds a plan. A future day stays empty until a user explicitly carries
   the last working day into it (the Carry over / Reset Board button). */
async function refreshData() {
  if (isOverview()) {
    await Promise.all(D().boards.map(b => cloud.ensurePlanLoaded(b.id, state.date)));
    // A section the role cannot see is not fetched either — hiding History from
    // an Engineer should not still cost them the range query on every redraw.
    await Promise.all([
      ensureUtilizationLoaded(),
      can("ov.hostRisk") ? ensureHostCoverageLoaded() : Promise.resolve(),
      can("ov.history") ? ensureHistoryLoaded() : Promise.resolve(),
    ]);
  } else if (isOrgChart()) {
    // the org chart is today's snapshot across every board, same read the
    // Overview does — warm each board's plan for the shown date, then draw
    await Promise.all(D().boards.map(b => cloud.ensurePlanLoaded(b.id, state.date)));
  } else if (isEmployeeList()) {
    // employee master data is already warm in the cache; the 30D column is the
    // one thing here that needs a fetch, and it's cached across redraws so
    // typing in the search box doesn't re-query
    await ensureEmplistUtilLoaded();
  } else if (isHostList()) {
    // one bulk read of the host directory; host master records (location / map
    // link) are already warm in the cache alongside boards and employees
    await ensureHostDirectoryLoaded();
  } else if (isCapacity()) {
    await ensureCapacityLoaded();
  } else if (D().activeBoardId) {
    const boardId = D().activeBoardId, date = state.date;
    if (isForecastView()) {
      await cloud.ensureForecastLoaded(boardId, date);
    } else {
      await cloud.ensurePlanLoaded(boardId, date);
      await refreshPlanSignals(boardId, date);
    }
  }
}

/* What the confirmed board's banners need: the day's stamp, whether it has
   gone stale against the day it was carried from, and the forecast for it (if
   anyone made one). The staleness check is skipped outright where the brief
   says no banner belongs: past days, locked days and non-working days. */
async function refreshPlanSignals(boardId, date) {
  const f = feat();
  if (!f.stamps && !f.forecast) { state.signals = { key: null, stamp: null, stale: null, forecast: null, decisions: [] }; return; }
  const notPast = date >= todayStr();
  const checkStale = f.stamps && notPast && !isLocked(boardId, date) && !isNonWorkingDate(date, boardId);
  const [sig, forecast] = await Promise.all([
    cloud.getPlanSignals(boardId, date, { stale: checkStale }),
    f.forecast && notPast ? cloud.ensureForecastLoaded(boardId, date) : Promise.resolve(null),
  ]);
  // D2: what was decided when this day's forecast was merged
  const decisions = f.mergeLog && sig.stamp && sig.stamp.forecast_merged_at ? await cloud.loadMergeDecisions(boardId, date) : [];
  state.signals = { key: boardId + "|" + date, stamp: sig.stamp, stale: sig.stale, forecast, decisions };
}
async function refreshAndRender() {
  await refreshData();
  render();
  settingsLiveRefresh();   // an open Settings page redraws around its drafts
}

/* ---------- read-only guard ---------- */
/* Shared by guardEdit and the Lock button itself: prompt naming who locked the
   board, then unlock it (for everyone, not just this session) and continue. */
function confirmUnlock(boardId, date, then) {
  const lock = lockInfo(boardId, date);
  if (!lock) { then(); return; }
  const when = lock.lockedAt ? new Date(lock.lockedAt).toLocaleString() : "";
  showConfirm(
    "Unlock board?",
    `${fmtDow(date)} ${fmtDate(date)} was locked by ${lock.lockedBy}${when ? " on " + when : ""}. ` +
      `Unlock it for editing? This unlocks it for everyone, not just you.`,
    () => safely(async () => {
      await cloud.unlockDay(boardId, date);
      render();
      then();
    })
  );
}
function guardEdit(action) {
  // Permission comes first, before the read-only / lock prompts: a Viewer must
  // not even be offered "edit a past date anyway?", because the write behind it
  // would be refused by RLS. Every board mutation passes through here, so this
  // one check is what makes the board genuinely read-only for them.
  if (isForecastView()) {
    // a forecast has its own permission and is never locked or read-only
    if (!can("forecast", "edit")) { toast("Your role can view forecasts but not change them.", "info"); return; }
    action();
    return;
  }
  if (!can("board", "edit")) {
    toast("Your role can view this board but not change it.", "info");
    return;
  }
  if (!isReadOnly()) { action(); return; }
  const boardId = D().activeBoardId;
  if (lockInfo(boardId, state.date)) { confirmUnlock(boardId, state.date, action); return; }
  const today = state.date === todayStr();
  showConfirm(
    today ? "Edit today's board?" : "Edit a past date?",
    today
      ? `Today's plan (${fmtDate(state.date)}) is already being executed and is read-only. Do you want to edit it anyway?`
      : `${fmtDate(state.date)} is in the past and read-only. Do you want to edit its saved plan?`,
    () => { state.unlockedDates.add(state.date); render(); action(); }
  );
}

/* ---------- lock button (finalize a day's plan; view-only for everyone) ---------- */
function toggleLockBoard() {
  const boardId = D().activeBoardId;
  if (lockInfo(boardId, state.date)) {
    confirmUnlock(boardId, state.date, () => {});
  } else {
    safely(async () => { await cloud.lockDay(boardId, state.date); render(); });
  }
}

/* ---------- rendering ---------- */
function render() {
  saveViewState();
  hideContextMenu();
  renderTabs();
  renderDateButton();
  renderLockButton();
  const ov = isOverview();
  const org = isOrgChart();
  const eml = isEmployeeList();
  const hl = isHostList();
  const cap = isCapacity();
  const board = !ov && !org && !eml && !hl && !cap;   // an actual board is on screen
  // a board beyond the confirm horizon shows its FORECAST, with its own permission
  const fc = board && isForecastView();
  // Everything below asks "may this role edit here?" as well as "is this view on
  // screen?". The board's own mutations are stopped at guardEdit() rather than
  // here — hiding a button is a courtesy, guardEdit is the rule.
  const boardEdit = board && can("board", "edit");
  const planEdit = board && (fc ? can("forecast", "edit") : can("board", "edit"));
  document.body.classList.toggle("forecast-mode", fc);
  $("#status-zones").classList.toggle("hidden", !board);
  $("#leave-tabs").classList.toggle("hidden", !board);
  $("#missions-grid").classList.toggle("hidden", !board);
  $("#overview-panel").classList.toggle("hidden", !ov);
  $("#orgchart-panel").classList.toggle("hidden", !org);
  $("#emplist-panel").classList.toggle("hidden", !eml);
  $("#hostlist-panel").classList.toggle("hidden", !hl);
  $("#capacity-panel").classList.toggle("hidden", !cap);
  $("#btn-new-mission").classList.toggle("hidden", !planEdit);
  // a forecast has no hidden missions; it is built from "Start from confirmed",
  // "Add Mission" (only the missions an engineer picks) or by hand
  $("#btn-hide-missions").classList.toggle("hidden", !boardEdit || fc);
  $("#btn-new-employee").classList.toggle("hidden", ov || org || hl || cap || !can("emplist", "edit"));
  // a view has ONE filled action: on a board that is New Mission, so New Employee
  // steps back to an outline; on Manpower it is the only create button, so it stays solid
  $("#btn-new-employee").classList.toggle("btn-primary", eml);
  $("#btn-new-employee").classList.toggle("btn-outline-primary", !eml);
  // "Add Mission": on a holiday/weekend (import mission definitions), and on
  // every forecast day (pick missions from the latest confirmed day)
  $("#btn-import-mission").classList.toggle("hidden", fc ? !planEdit : (!boardEdit || !isNonWorkingDate(state.date)));
  $("#btn-import-mission").title = fc
    ? "Pick missions from the latest confirmed day to add to this forecast"
    : "Copy missions from the latest weekday onto this holiday";
  // Holiday toggle: ON = this date is non-working. Any editable future date
  // (weekday or weekend); hidden on read-only past/today and on the app-wide tabs.
  const showHoliday = boardEdit && !isReadOnly();
  $("#holiday-toggle").classList.toggle("hidden", !showHoliday);
  if (showHoliday) $("#holiday-check").checked = isNonWorkingDate(state.date);
  $("#filters").classList.toggle("hidden", !board);
  $("#emplist-area-bar").classList.toggle("hidden", !eml);
  // Manpower's and Host's search/filters group — each is a display:contents
  // wrapper (styles.css), so one class toggle here shows or hides that tab's
  // whole cluster within row 1.
  $("#emplist-toolbar").classList.toggle("hidden", !eml);
  $("#hostlist-toolbar").classList.toggle("hidden", !hl);
  $("#capacity-toolbar").classList.toggle("hidden", !cap);
  if (cap) renderCapacityToolbar();
  // Row 2: Manpower and Host each get their count + Bulk edit; every tab
  // shares the one Export button at the right edge (below). These live
  // directly in #toolbar-row2, not inside a shared wrapper, so each has its
  // own toggle.
  $("#emplist-count").classList.toggle("hidden", !eml);
  $("#btn-emplist-bulk").classList.toggle("hidden", !eml || !can("emplist", "edit"));
  $("#hostlist-count").classList.toggle("hidden", !hl);
  $("#btn-hostlist-bulk").classList.toggle("hidden", !hl || !can("hostlist", "edit"));
  // The two lists and the board bar carry their own create buttons; RLS would
  // refuse the write anyway, so hiding them is about not offering a dead end.
  $("#btn-add-board").classList.toggle("hidden", !can("settings", "edit"));
  $("#btn-add-host").classList.toggle("hidden", !hl || !can("hostlist", "edit"));
  // One Export button on every tab (the file type is picked in its dialog).
  // A forecast is never exported: the JPG and the PDF are what goes to LINE,
  // and a tentative plan must not reach it (exportBoard refuses as well).
  // Export is a read: a Viewer may take the board away with them.
  $("#btn-export").classList.toggle("hidden", fc);
  // the phone's "More" dropdown only holds other tabs' controls — on Overview it
  // would open empty, and so would it on Capacity (whose own ⋯ holds its actions)
  $("#btn-toolbar-more").classList.toggle("hidden", ov || isCapacity());
  // the cards only exist on a board (not Overview, Org Chart, lists or Capacity)
  $("#card-names").classList.toggle("hidden", !board);
  // Carry over / Reset Board on a confirmed day; "Start from confirmed" on an
  // empty forecast day (and nothing once a forecast exists — that is somebody's
  // work, not something to replace wholesale)
  const planEmpty = board && planIsEmpty(getPlan());
  $("#btn-reset-board").classList.toggle("hidden", fc ? !(planEdit && planEmpty) : !boardEdit);
  $("#btn-forecast-copy").classList.toggle("hidden", !(fc && planEdit && !planEmpty));
  $("#ov-board-dd").classList.toggle("hidden", !ov || D().boards.length < 2);
  document.body.classList.toggle("ov-view", ov);
  placeBoardRow1Tools(board);
  renderStats();
  // floating available panel: only on an actual board (hidden on the app-wide tabs)
  $("#float-pool").classList.toggle("hidden", !board);
  document.body.classList.toggle("board-view", board);
  $("#btn-undo").classList.toggle("hidden", !planEdit);
  renderModePill();
  renderHoldAlerts();
  if (ov) {
    renderOverview();
  } else if (org) {
    renderOrgChart();
  } else if (eml) {
    renderEmployeeList();
  } else if (hl) {
    renderHostList();
  } else if (cap) {
    renderCapacity();
  } else {
    renderZones();
    renderMissions();
    renderFilterOptions();
    updateHideMissionsButton();
    updateResetButton();
  }
  renderBoardEmptyState();
  renderPlanBanners();
  // read-only / locked is part of the date pill beside the date picker now (renderModePill)
  $("#readonly-badge").classList.add("hidden");
  renderModePill();
  updateSelectionUI();
  updateUndoButton();
  applySearchHighlight();
}

/* ======================================================================
   Org Chart tab — today's operational structure as a collapsible tree.

   Board → Engineer → Service area → Mission → Employee, plus a per-board
   "Standby / Leave" pool for anyone not on a mission. Two views over the
   same tree: a dense Outline (default) and a pan/zoom Org chart. It is a
   pure read of the same plans the Overview loads (refreshData warms every
   board's plan for state.date first), so nothing here mutates anything.
   ====================================================================== */
const org = {
  view: "outline",          // "outline" | "chart"
  collapsed: new Set(),     // node _id -> children hidden
  seeded: false,            // first paint collapses missions + pools
  pz: { scale: 1, tx: 24, ty: 24, fitted: false },   // org-chart canvas transform
  // keys the user hid. statuses: "standby" or a leave zone key — who in each
  // board's Standby / Leave pool is left out of the chart
  filters: { boards: new Set(), engineers: new Set(), areas: new Set(), statuses: new Set() },
  filterOpts: { boards: [], engineers: [], areas: [], statuses: [] },   // what's available to filter this render
  tree: null,               // the filtered tree currently on screen (both views read it)
  closer: null,             // document click handler that closes open filter pops
};
const ORG_LEVELS = {
  board:    ["board"],
  engineer: ["engineer", "bucket"],
  area:     ["area", "bucket"],
  mission:  ["mission", "bucket"],
  all:      [],
};

/* Build the tree from live data for the shown date. Node ids are structural
   paths so a collapsed/expanded state survives a rebuild (realtime, date
   change) as long as the shape is the same. */
function buildOrgTree() {
  const engById = new Map(D().engineers.map(e => [e.id, e]));
  const areaById = new Map(D().areas.map(a => [a.id, a]));
  const empById = new Map(D().employees.map(e => [e.id, e]));
  const hostByName = new Map(D().hosts.map(h => [h.name.trim().toLowerCase(), h]));
  const date = state.date;

  const empNode = (parentId, e, status) => {
    const area = e.areaId ? areaById.get(e.areaId) : null;
    return {
      type: "employee", _id: parentId + "/emp:" + e.id, name: e.name,
      position: POSITIONS[e.position] ? POSITIONS[e.position].label : "",
      contract: e.contract, areaName: area ? area.name : "", areaColor: area ? area.color : "#c3ccd6",
      phone: e.phone || "", status: status || "", children: [],
    };
  };

  const root = { type: "root", _id: "root", name: "TRIGO Manpower", children: [] };
  for (const b of D().boards) {
    const plan = (D().plans[b.id] || {})[date] || { missions: [], zones: {} };
    const boardId = "b:" + b.id;
    const boardNode = { type: "board", _id: boardId, name: b.name, color: "var(--primary)", children: [] };
    const missions = plan.missions.filter(m => !m.hidden);

    const engMap = new Map();
    const engNodeFor = (engineerId) => {
      const key = engineerId || "__none__";
      if (engMap.has(key)) return engMap.get(key);
      const eng = engById.get(engineerId);
      const node = {
        type: "engineer", _id: boardId + "/e:" + key,
        name: eng ? eng.name : "Unassigned engineer", sub: eng ? (eng.phone || "") : "",
        color: eng ? eng.color : "#c3ccd6", _areas: new Map(), children: [],
      };
      engMap.set(key, node); boardNode.children.push(node);
      return node;
    };
    const areaNodeFor = (engNode, areaId) => {
      const key = areaId || "__none__";
      if (engNode._areas.has(key)) return engNode._areas.get(key);
      const area = areaById.get(areaId);
      const node = {
        type: "area", _id: engNode._id + "/a:" + key,
        name: area ? area.name : "No service area", color: area ? area.color : "#c3ccd6", children: [],
      };
      engNode._areas.set(key, node); engNode.children.push(node);
      return node;
    };

    for (const m of missions) {
      const host = hostByName.get((m.host || "").trim().toLowerCase());
      const areaId = host ? host.areaId : null;
      const en = engNodeFor(m.engineerId);
      const an = areaNodeFor(en, areaId);
      const mNode = {
        type: "mission", _id: an._id + "/m:" + m.id, name: m.number, sub: m.host || "",
        shift: m.shift, color: an.color, children: [],
      };
      const crew = m.members.map(id => empById.get(id)).filter(Boolean)
        .sort((a, c) => (a.contract === "oncall") - (c.contract === "oncall") || a.name.localeCompare(c.name));
      for (const e of crew) mNode.children.push(empNode(mNode._id, e));
      an.children.push(mNode);
    }

    // Standby / Leave pool: everyone on this board's roster who is not on a
    // mission today — standby (unassigned) plus each leave zone, labelled.
    const placed = new Set();
    missions.forEach(m => m.members.forEach(id => placed.add(id)));
    Object.values(plan.zones || {}).forEach(arr => (arr || []).forEach(id => placed.add(id)));
    const bucketId = boardId + "/bucket";
    const bucket = { type: "bucket", _id: bucketId, name: "Standby / Leave", sub: "not on a mission today", color: "#c3ccd6", children: [] };
    for (const e of boardEmployees(b.id).filter(onRoster)) {
      if (!placed.has(e.id)) bucket.children.push(empNode(bucketId, e, "standby"));
    }
    for (const z of ZONES) {
      for (const id of (plan.zones && plan.zones[z]) || []) {
        const e = empById.get(id);
        if (e && e.boardId === b.id) bucket.children.push(empNode(bucketId, e, z));
      }
    }
    if (bucket.children.length) boardNode.children.push(bucket);
    root.children.push(boardNode);
  }
  return root;
}

const orgCrewCount = (n) => n.type === "employee" ? 1 : n.children.reduce((s, c) => s + orgCrewCount(c), 0);
const orgMissionCount = (n) => n.type === "mission" ? 1 : n.children.reduce((s, c) => s + orgMissionCount(c), 0);
const orgCountType = (n, t) => (n.type === t ? 1 : 0) + n.children.reduce((s, c) => s + orgCountType(c, t), 0);
function orgDistinctAreas(n) { const s = new Set(); (function w(x) { if (x.type === "area") s.add(x._id.split("/a:")[1]); x.children.forEach(w); })(n); return s.size; }
/* Engineers repeat across boards (one node per board they run a mission on), so
   count DISTINCT people for the root's roll-up, not engineer nodes. */
function orgDistinctEngineers(n) { const s = new Set(); (function w(x) { if (x.type === "engineer") s.add(x._id.split("/e:")[1]); x.children.forEach(w); })(n); return s.size; }
const orgIsLeaf = (n) => !n.children.length;
const orgLevelLabel = (t) => ({ board: "Board", engineer: "Engineer", area: "Service area", mission: "Mission", employee: "Crew", bucket: "Pool" }[t] || "");

/* Each node counts its descendant levels in hierarchy order —
   board → engineer → service area → mission → crew — so a node lists only
   the tiers that sit below it, left to right. */
function orgCountText(n) {
  const crew = orgCrewCount(n);
  if (n.type === "root") return `${orgCountType(n, "board")} boards · ${orgDistinctEngineers(n)} engineers · ${orgDistinctAreas(n)} areas · ${orgMissionCount(n)} missions · ${crew} crew`;
  if (n.type === "board") return `${orgCountType(n, "engineer")} eng · ${orgDistinctAreas(n)} areas · ${orgMissionCount(n)} miss · ${crew} crew`;
  if (n.type === "engineer") return `${orgCountType(n, "area")} areas · ${orgMissionCount(n)} miss · ${crew} crew`;
  if (n.type === "area") return `${orgMissionCount(n)} miss · ${crew} crew`;
  return `${crew} crew`;
}
function orgInitials(s) { return String(s).replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "•"; }
const ZONE_STATUS = { annual: "Annual leave", sick: "Sick leave", business: "Business leave", unpaid: "Unpaid leave", exchange: "Exchange day" };

function orgEmpChips(n) {
  const contract = n.contract === "permanent"
    ? '<span class="oc-chip oc-perm">Permanent</span>'
    : '<span class="oc-chip oc-oncall">On-call</span>';
  const pos = n.position ? `<span class="oc-chip oc-pos">${escapeHtml(n.position)}</span>` : "";
  const area = n.areaName
    ? `<span class="oc-chip oc-area"><span class="oc-sw" style="background:${n.areaColor}"></span>${escapeHtml(n.areaName)}</span>` : "";
  let st = "";
  if (n.status && n.status !== "standby") st = `<span class="oc-chip oc-leave">${escapeHtml(ZONE_STATUS[n.status] || n.status)}</span>`;
  else if (n.status === "standby") st = '<span class="oc-chip oc-standby">Standby</span>';
  return pos + contract + area + st;
}

/* Which board / engineer / service area appear in this snapshot — the lists
   the filter dropdowns offer (built from the unfiltered tree, keyed the same
   way orgPrune reads them). */
function orgFilterOptions(fullTree) {
  const boards = [], engMap = new Map(), areaMap = new Map();
  for (const b of fullTree.children) {
    boards.push({ key: b._id.slice(2), name: b.name });
    for (const e of b.children) {
      if (e.type !== "engineer") continue;
      const ek = e._id.split("/e:")[1];
      if (!engMap.has(ek)) engMap.set(ek, e.name);
      for (const a of e.children) {
        if (a.type !== "area") continue;
        const ak = a._id.split("/a:")[1];
        if (!areaMap.has(ak)) areaMap.set(ak, a.name);
      }
    }
  }
  // Standby and every leave type are always offered, with today's headcount,
  // so a choice made on one day still reads the same on a day with none of them
  const statusCount = new Map();
  for (const b of fullTree.children) for (const n of b.children) {
    if (n.type === "bucket") for (const e of n.children) statusCount.set(e.status, (statusCount.get(e.status) || 0) + 1);
  }
  const statuses = ["standby", ...LEAVE_ZONES].map(key => ({
    key, name: `${key === "standby" ? "Standby" : ZONE_LABELS[key]} (${statusCount.get(key) || 0})`,
  }));
  return {
    boards,
    engineers: [...engMap].map(([key, name]) => ({ key, name })),
    areas: [...areaMap].map(([key, name]) => ({ key, name })),
    statuses,
  };
}
/* Drop the boards / engineers / service areas / standby-leave statuses the user has hidden. Mutates the
   passed tree; counts recompute from what's left, so the visible tallies match
   the visible tree. Engineers emptied by an area filter are dropped too. */
function orgPrune(tree, f) {
  tree.children = tree.children.filter(b => !f.boards.has(b._id.slice(2)));
  for (const b of tree.children) {
    b.children = b.children.filter(n => n.type !== "engineer" || !f.engineers.has(n._id.split("/e:")[1]));
    for (const e of b.children) {
      if (e.type !== "engineer") continue;
      e.children = e.children.filter(a => !(a.type === "area" && f.areas.has(a._id.split("/a:")[1])));
    }
    // the Standby / Leave pool keeps only the statuses still ticked, and goes
    // when nobody is left in it
    for (const n of b.children) {
      if (n.type === "bucket") n.children = n.children.filter(e => !f.statuses.has(e.status));
    }
    b.children = b.children.filter(n => (n.type !== "engineer" && n.type !== "bucket") || n.children.length);
  }
}
function orgFilterDropdown(dim, label, items) {
  const hidden = org.filters[dim];
  const rows = items.map(it =>
    `<label><input type="checkbox" value="${escapeHtml(it.key)}" ${hidden.has(it.key) ? "" : "checked"}>${escapeHtml(it.name)}</label>`
  ).join("");
  return `<div class="oc-ms" data-dim="${dim}">
      <button type="button" class="btn oc-ms-btn">${label}: <b class="oc-ms-state"></b></button>
      <div class="oc-ms-pop hidden">
        <div class="oc-ms-actions"><button type="button" data-all>All</button><button type="button" data-none>None</button></div>
        ${rows || '<div class="oc-hint" style="padding:6px">none today</div>'}
      </div>
    </div>`;
}
function orgFilterState(dim) {
  const total = org.filterOpts[dim].length;
  const hidden = org.filterOpts[dim].filter(it => org.filters[dim].has(it.key)).length;
  return { total, hidden, visible: total - hidden };
}
function orgUpdateFilterLabels(panel) {
  panel.querySelectorAll(".oc-ms").forEach(ms => {
    const dim = ms.dataset.dim;
    const s = orgFilterState(dim);
    ms.querySelector(".oc-ms-state").textContent = s.hidden ? `${s.visible}/${s.total}` : "All";
    ms.querySelector(".oc-ms-btn").classList.toggle("filtered", s.hidden > 0);
  });
}

function renderOrgChart() {
  const panel = $("#orgchart-panel");
  const full = buildOrgTree();
  if (!org.seeded) {
    (function w(n) { if (n.type === "mission" || n.type === "bucket") org.collapsed.add(n._id); n.children.forEach(w); })(full);
    org.seeded = true;
  }
  org.filterOpts = orgFilterOptions(full);
  // forget filter selections whose board/engineer/area is gone from this snapshot
  for (const dim of ["boards", "engineers", "areas"]) {
    const live = new Set(org.filterOpts[dim].map(it => it.key));
    for (const k of [...org.filters[dim]]) if (!live.has(k)) org.filters[dim].delete(k);
  }
  orgPrune(full, org.filters);
  org.tree = full;

  const levelOpts = [["board", "Board"], ["engineer", "Engineer"], ["area", "Service area"], ["mission", "Mission"], ["all", "Everything"]]
    .map(([v, l]) => `<option value="${v}"${v === "mission" ? " selected" : ""}>${l}</option>`).join("");

  panel.innerHTML =
    `<div class="oc-wrap">
      <div class="oc-toolbar">
        <div class="oc-views">
          <button type="button" class="btn oc-view-btn" data-v="outline">${icon("list")}<span>Outline</span></button>
          <button type="button" class="btn oc-view-btn" data-v="chart">${icon("orgchart")}<span>Org chart</span></button>
        </div>
        <div class="oc-spacer"></div>
        <span class="oc-flabel">Filter</span>
        <div class="oc-filters">
          ${orgFilterDropdown("boards", "Board", org.filterOpts.boards)}
          ${orgFilterDropdown("engineers", "Engineer", org.filterOpts.engineers)}
          ${orgFilterDropdown("areas", "Service area", org.filterOpts.areas)}
          ${orgFilterDropdown("statuses", "Standby / Leave", org.filterOpts.statuses)}
        </div>
        <label class="oc-levelctl">Show to
          <select id="oc-level" class="oc-select">${levelOpts}</select>
        </label>
      </div>
      <div class="oc-legend">
        <span class="oc-k"><span class="oc-sw" style="background:var(--chart-permanent)"></span>Permanent</span>
        <span class="oc-k"><span class="oc-sw" style="background:var(--chart-oncall)"></span>On-call</span>
        <span class="oc-k"><span class="oc-sw oc-round" style="background:var(--brand-green)"></span>Engineer</span>
        <span class="oc-k oc-hint">Crew shows position · contract · service area · phone</span>
      </div>
      <div class="oc-view oc-outline" id="oc-outline"></div>
      <div class="oc-view oc-chart" id="oc-chart">
        <div class="oc-panbar">
          <button type="button" class="btn btn-small" id="oc-zout" title="Zoom out">${icon("minus")}</button>
          <span class="oc-zlabel" id="oc-zlabel">100%</span>
          <button type="button" class="btn btn-small" id="oc-zin" title="Zoom in">${icon("plus")}</button>
          <button type="button" class="btn btn-small" id="oc-zfit" title="Fit to screen">Fit</button>
          <button type="button" class="btn btn-small" id="oc-zreset" title="Reset to 100%">${icon("reset")}</button>
        </div>
        <div class="oc-panhint">Drag to pan · scroll to zoom</div>
        <div class="oc-viewport" id="oc-vp"><div class="oc-canvas" id="oc-canvas"><div class="oc-tree" id="oc-tree"></div></div></div>
      </div>
    </div>`;

  // view toggle
  const setView = (v) => {
    org.view = v;
    panel.querySelectorAll(".oc-view-btn").forEach(b => b.classList.toggle("btn-primary", b.dataset.v === v));
    $("#oc-outline").classList.toggle("hidden", v !== "outline");
    $("#oc-chart").classList.toggle("hidden", v !== "chart");
    if (v === "chart") { orgApplyPz(); if (!org.pz.fitted) { org.pz.fitted = true; requestAnimationFrame(orgFitPz); } }
  };
  panel.querySelectorAll(".oc-view-btn").forEach(b => b.onclick = () => setView(b.dataset.v));

  // level control
  const lvlSel = $("#oc-level");
  lvlSel.onchange = () => {
    org.collapsed.clear();
    const types = ORG_LEVELS[lvlSel.value] || [];
    (function w(n) { if (types.includes(n.type)) org.collapsed.add(n._id); n.children.forEach(w); })(org.tree);
    orgRerender();
  };

  // filters — each dropdown toggles its pop, its checkboxes hide/show a dimension
  panel.querySelectorAll(".oc-ms").forEach(ms => {
    const dim = ms.dataset.dim;
    const btn = ms.querySelector(".oc-ms-btn");
    const pop = ms.querySelector(".oc-ms-pop");
    btn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = pop.classList.contains("hidden");
      panel.querySelectorAll(".oc-ms-pop").forEach(p => p.classList.add("hidden"));
      pop.classList.toggle("hidden", !willOpen);
    };
    pop.onclick = (e) => e.stopPropagation();
    pop.querySelectorAll("input[type=checkbox]").forEach(cb => {
      cb.onchange = () => { cb.checked ? org.filters[dim].delete(cb.value) : org.filters[dim].add(cb.value); orgApplyFilters(); };
    });
    const all = pop.querySelector("[data-all]"), none = pop.querySelector("[data-none]");
    if (all) all.onclick = () => { org.filters[dim].clear(); pop.querySelectorAll("input").forEach(c => c.checked = true); orgApplyFilters(); };
    if (none) none.onclick = () => { org.filterOpts[dim].forEach(it => org.filters[dim].add(it.key)); pop.querySelectorAll("input").forEach(c => c.checked = false); orgApplyFilters(); };
  });
  // one document handler closes any open pop on an outside click
  if (org.closer) document.removeEventListener("click", org.closer);
  org.closer = (e) => { if (!e.target.closest(".oc-ms")) panel.querySelectorAll(".oc-ms-pop").forEach(p => p.classList.add("hidden")); };
  document.addEventListener("click", org.closer);

  orgUpdateFilterLabels(panel);
  orgRenderOutline();
  orgRenderChart();
  orgWirePan();
  setView(org.view);
}

/* re-prune from live data and redraw both views in place, keeping the filter
   pops open so several boxes can be ticked in a row */
function orgApplyFilters() {
  const t = buildOrgTree();
  orgPrune(t, org.filters);
  org.tree = t;
  orgUpdateFilterLabels($("#orgchart-panel"));
  orgRerender();
}
/* redraw both views after a collapse/expand or filter change, keeping pan + view */
function orgRerender() {
  orgRenderOutline();
  orgRenderChart();
  orgWirePan();
  $("#oc-outline").classList.toggle("hidden", org.view !== "outline");
  $("#oc-chart").classList.toggle("hidden", org.view !== "chart");
  if (org.view === "chart") orgApplyPz();
}
function orgToggle(id) {
  org.collapsed.has(id) ? org.collapsed.delete(id) : org.collapsed.add(id);
  const sel = $("#oc-level"); if (sel) sel.selectedIndex = -1;   // manual edit clears the "show to" choice
  orgRerender();
}

/* ---- Outline view ---- */
function orgRenderOutline() {
  const root = $("#oc-outline"); if (!root || !org.tree) return;
  root.innerHTML = "";
  root.appendChild(orgOutlineNode(org.tree));
}
function orgOutlineNode(n) {
  const box = document.createElement("div");
  box.className = "oc-ol-item" + (org.collapsed.has(n._id) ? " r-off" : "");
  const row = document.createElement("div");
  row.className = "oc-ol-row l-" + n.type;
  const caret = orgIsLeaf(n) ? '<span class="oc-caret leaf"></span>'
    : `<span class="oc-caret">${icon("chevron-right")}</span>`;
  let tagEl;
  if (n.type === "employee") tagEl = `<span class="oc-tag" style="--oc-c:${n.areaColor}">${orgInitials(n.name)}</span>`;
  else if (n.type === "board" || n.type === "engineer") tagEl = `<span class="oc-tag" style="--oc-c:${n.color}">${orgInitials(n.name)}</span>`;
  else if (n.type === "area") tagEl = `<span class="oc-tag" style="--oc-c:${n.color}">${escapeHtml(n.name).slice(0, 3)}</span>`;
  else if (n.type === "mission") tagEl = `<span class="oc-tag" style="--oc-c:${n.color}">M</span>`;
  else tagEl = `<span class="oc-tag" style="--oc-c:#c3ccd6">◑</span>`;
  const sub = n.sub ? `<span class="oc-sub">${escapeHtml(n.sub)}</span>` : "";
  let right;
  if (n.type === "employee") right = `<span class="oc-meta">${orgEmpChips(n)}<span class="oc-phone">${escapeHtml(n.phone)}</span></span>`;
  else {
    const shift = n.type === "mission" ? `<span class="oc-chip oc-${n.shift}">${n.shift === "night" ? "Night" : "Day"}</span>` : "";
    right = `<span class="oc-meta">${shift}<span class="oc-cnt">${orgCountText(n)}</span></span>`;
  }
  row.innerHTML = `${caret}${tagEl}<span class="oc-nm">${escapeHtml(n.name)}${sub}</span><span class="oc-grow"></span>${right}`;
  box.appendChild(row);
  if (!orgIsLeaf(n)) {
    // The caret sits inside the row; stop its click bubbling to the row handler
    // below, or the two would fire back-to-back and cancel each other out.
    row.querySelector(".oc-caret").onclick = (e) => { e.stopPropagation(); orgToggle(n._id); };
    row.style.cursor = "pointer";
    row.onclick = (e) => { if (!e.target.closest("a")) orgToggle(n._id); };
    const kids = document.createElement("div");
    kids.className = "oc-ol-kids";
    n.children.forEach(c => kids.appendChild(orgOutlineNode(c)));
    box.appendChild(kids);
  }
  return box;
}

/* ---- Org chart view (top-down boxes) ---- */
function orgRenderChart() {
  const root = $("#oc-tree"); if (!root || !org.tree) return;
  root.innerHTML = "";
  const ul = document.createElement("ul");
  const li = document.createElement("li");
  li.className = "oc-root";
  orgChartBuild(org.tree, li);
  ul.appendChild(li);
  root.appendChild(ul);
}
function orgChartBuild(n, li) {
  if (org.collapsed.has(n._id)) li.classList.add("kids-off");
  const bw = document.createElement("div");
  bw.className = "oc-box-wrap";
  bw.appendChild(orgChartBox(n));
  li.appendChild(bw);
  if (!orgIsLeaf(n)) {
    const ul = document.createElement("ul");
    n.children.forEach(c => { const cli = document.createElement("li"); orgChartBuild(c, cli); ul.appendChild(cli); });
    li.appendChild(ul);
  }
}
function orgChartBox(n) {
  const el = document.createElement("div");
  el.className = "oc-box is-" + n.type;
  el.style.setProperty("--oc-c", n.color || n.areaColor || "var(--primary)");
  let head = "";
  if (n.type === "board" || n.type === "engineer") head = `<span class="oc-tag" style="--oc-c:${n.color}">${orgInitials(n.name)}</span>`;
  else if (n.type === "area") head = `<span class="oc-tag" style="--oc-c:${n.color}">${escapeHtml(n.name).slice(0, 3)}</span>`;
  else if (n.type === "employee") head = `<span class="oc-tag" style="--oc-c:${n.areaColor}">${orgInitials(n.name)}</span>`;
  let meta;
  if (n.type === "employee") {
    meta = `<div class="oc-meta">${orgEmpChips(n)}</div><div class="oc-meta oc-phone">${escapeHtml(n.phone)}</div>`;
  } else {
    const shift = n.type === "mission" ? `<span class="oc-chip oc-${n.shift}">${n.shift === "night" ? "Night" : "Day"}</span>` : "";
    meta = `<div class="oc-meta">${shift}<span class="oc-cnt">${orgCountText(n)}</span></div>`;
  }
  const sub = n.sub ? `<span class="oc-sub">${escapeHtml(n.sub)}</span>` : "";
  const btn = orgIsLeaf(n) ? "" : `<button type="button" class="oc-tog" title="Collapse / expand">${org.collapsed.has(n._id) ? "+" : "–"}</button>`;
  el.innerHTML = `${head}<div class="oc-body"><span class="oc-lvl">${orgLevelLabel(n.type)}</span>` +
    `<div class="oc-ttl">${escapeHtml(n.name)} ${sub}</div>${meta}</div>${btn}`;
  const t = el.querySelector(".oc-tog");
  if (t) t.onclick = (e) => { e.stopPropagation(); orgToggle(n._id); };
  return el;
}

/* ---- pan / zoom for the org-chart canvas ---- */
function orgApplyPz() {
  const c = $("#oc-canvas"); if (!c) return;
  c.style.transform = `translate(${org.pz.tx}px,${org.pz.ty}px) scale(${org.pz.scale})`;
  const l = $("#oc-zlabel"); if (l) l.textContent = Math.round(org.pz.scale * 100) + "%";
}
function orgZoomAt(cx, cy, factor) {
  const ns = Math.min(2, Math.max(0.3, org.pz.scale * factor)), k = ns / org.pz.scale;
  org.pz.tx = cx - (cx - org.pz.tx) * k; org.pz.ty = cy - (cy - org.pz.ty) * k; org.pz.scale = ns; orgApplyPz();
}
function orgFitPz() {
  const vp = $("#oc-vp"), c = $("#oc-canvas"); if (!vp || !c) return;
  const cw = c.scrollWidth, ch = c.scrollHeight, vw = vp.clientWidth, vh = vp.clientHeight;
  if (!cw || !ch) return;
  const s = Math.min(2, Math.max(0.3, Math.min(vw / cw, vh / ch)));
  org.pz.scale = s; org.pz.tx = Math.max(12, (vw - cw * s) / 2); org.pz.ty = 12; orgApplyPz();
}
function orgWirePan() {
  const vp = $("#oc-vp"); if (!vp) return;
  $("#oc-zin").onclick = () => orgZoomAt(vp.clientWidth / 2, vp.clientHeight / 2, 1.2);
  $("#oc-zout").onclick = () => orgZoomAt(vp.clientWidth / 2, vp.clientHeight / 2, 1 / 1.2);
  $("#oc-zfit").onclick = orgFitPz;
  $("#oc-zreset").onclick = () => { org.pz.scale = 1; org.pz.tx = 24; org.pz.ty = 24; orgApplyPz(); };
  vp.onwheel = (e) => { e.preventDefault(); const r = vp.getBoundingClientRect(); orgZoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.1 : 1 / 1.1); };
  let drag = null;
  vp.onpointerdown = (e) => {
    if (e.target.closest(".oc-tog")) return;
    drag = { x: e.clientX, y: e.clientY, tx: org.pz.tx, ty: org.pz.ty };
    vp.classList.add("grabbing"); vp.setPointerCapture(e.pointerId);
  };
  vp.onpointermove = (e) => { if (!drag) return; org.pz.tx = drag.tx + (e.clientX - drag.x); org.pz.ty = drag.ty + (e.clientY - drag.y); orgApplyPz(); };
  const end = () => { drag = null; vp.classList.remove("grabbing"); };
  vp.onpointerup = end; vp.onpointercancel = end;
}

/* label the Hide/Unhide toolbar button with how many missions are currently
   hidden on this board+date, so it's obvious at a glance whether anything is
   tucked away */
function updateHideMissionsButton() {
  const btn = $("#btn-hide-missions");
  if (!btn) return;
  const missions = getPlan().missions;
  const n = missions.filter(m => m.hidden).length;
  // "Hidden 7" is a filter in effect (tinted, like an active filter); with nothing
  // hidden it is just the way in to the dialog
  setIconLabel(btn, "eye-off", n ? `Hidden ${n}` : "Hide/Unhide");
  btn.classList.toggle("is-on", n > 0);
  // amber count of missions with no crew: the ones the dialog suggests hiding
  const empty = missions.filter(missionHasNoCrew).length;
  if (empty) {
    const badge = document.createElement("span");
    badge.className = "hide-empty-badge";
    badge.textContent = empty;
    btn.appendChild(badge);
    const sr = document.createElement("span");
    sr.className = "sr-only";
    sr.textContent = ` ${empty === 1 ? "mission" : "missions"} with no crew`;
    btn.appendChild(sr);
  }
  btn.title = empty
    ? `${empty} ${empty === 1 ? "mission has" : "missions have"} no crew. Choose which missions are hidden from this board`
    : "Choose which missions are hidden from this board";
}

/* A plan is "empty" when it has no missions and nobody in any leave zone —
   nothing has been built for this day yet. Standby doesn't count (it's computed
   from unassigned staff, not stored), so an empty plan really means untouched. */
function planIsEmpty(plan) {
  if (plan.missions.length) return false;
  return ZONES.every(z => !plan.zones[z].length);
}

/* The toolbar button doubles as "Carry over" on an untouched day (bring the last
   working day's plan in — nothing to lose) and "Reset Board" once the day has
   content (a destructive replace, confirmed first). Same action either way. */
function updateResetButton() {
  const btn = $("#btn-reset-board");
  if (!btn) return;
  const empty = planIsEmpty(getPlan());
  if (isForecastView()) {
    setIconLabel(btn, "reset", "Start from confirmed");
    btn.title = "Start this day's forecast from a copy of the latest confirmed working day";
    return;
  }
  setIconLabel(btn, "reset", empty ? "Carry over" : "Reset Board");
  btn.title = empty
    ? "Bring in a copy of the last working day's plan (missions + crew)"
    : "Replace this day's plan with a fresh copy of the last working day";
}

/* Nothing is carried into a future day automatically anymore, so an untouched
   working day would otherwise just look blank. Show a prompt that invites the
   planner to carry the last working day's plan in (or start adding missions).
   Hidden on the Overview / Manpower List, on read-only days, and on
   holidays/weekends (which are meant to be empty and use "Add Mission" instead). */
function renderBoardEmptyState() {
  const box = $("#board-empty");
  if (!box) return;
  const show = !isNonBoardView() && !isReadOnly()
    && !isNonWorkingDate(state.date) && planIsEmpty(getPlan());
  box.classList.toggle("hidden", !show);
  box.innerHTML = "";
  if (!show) return;
  const fc = isForecastView();
  const msg = document.createElement("div");
  msg.className = "empty-title";
  msg.innerHTML = fc
    ? `No forecast yet for <b>${fmtDow(state.date)} ${fmtDate(state.date)}</b>.`
    : `This board is empty for <b>${fmtDow(state.date)} ${fmtDate(state.date)}</b>.`;
  const sub = document.createElement("div");
  sub.className = "empty-sub";
  sub.textContent = fc
    ? "Start from a copy of the latest confirmed working day, pick only the missions you will work on, or create missions yourself. A forecast is tentative: it never reaches the confirmed board, the export or the Host Record until someone merges it."
    : "Carry over the last working day's missions and crew to start from there, or just add missions manually.";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-carry";
  setIconLabel(btn, "reset", fc ? "Start from confirmed (all missions)" : "Carry over last working day's plan");
  btn.onclick = () => guardEdit(() => resetBoard());
  if (fc && !can("forecast", "edit")) btn.classList.add("hidden");
  box.appendChild(msg);
  box.appendChild(sub);
  box.appendChild(btn);
  if (fc && can("forecast", "edit")) {
    // or only the missions this engineer will work on
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "btn btn-carry-alt";
    setIconLabel(pick, "plus", "Add Mission…");
    pick.title = "Pick only the missions you will work on from the latest confirmed day";
    pick.onclick = () => openImportModal();
    box.appendChild(pick);
  }
}

function renderTabs() {
  const el = $("#board-tabs");
  // On a phone the strip scrolls sideways; rebuilding it would snap it back to
  // the start, so remember where it was and make sure the active tab is in view.
  const keepScroll = el.scrollLeft;
  el.innerHTML = "";
  if (can("overview")) {
  const ov = document.createElement("div");
  ov.className = "board-tab tab-overview" + (isOverview() ? " active" : "");
  setIconLabel(ov, "chart", "Overview");
  ov.onclick = () => { clearSelection(); D().activeBoardId = OVERVIEW_ID; refreshAndRender(); };
  el.appendChild(ov);
  }
  // Board: an ordinary module tab. It opens the board last shown (the toolbar's
  // board picker then switches between boards, like Overview's).
  if (can("board") && D().boards.length) {
  const bt = document.createElement("div");
  bt.className = "board-tab tab-boardmod" + (!isNonBoardView() ? " active" : "");
  setIconLabel(bt, "appmark", "Board");   // the app mark (favicon's four squares), outlined
  bt.onclick = () => {
    if (!isNonBoardView()) return;
    clearSelection();
    let last = null;
    try { last = localStorage.getItem("manpower.lastBoard"); } catch (e) { /* not remembered */ }
    D().activeBoardId = (D().boards.find(b => b.id === last) || D().boards[0]).id;
    refreshAndRender();
  };
  el.prepend(bt);
  }
  if (can("orgchart")) {
  const oc = document.createElement("div");
  oc.className = "board-tab tab-orgchart" + (isOrgChart() ? " active" : "");
  setIconLabel(oc, "orgchart", "Org Chart");
  oc.onclick = () => { clearSelection(); D().activeBoardId = ORGCHART_ID; refreshAndRender(); };
  el.appendChild(oc);
  }
  if (can("emplist")) {
  const eml = document.createElement("div");
  eml.className = "board-tab tab-emplist" + (isEmployeeList() ? " active" : "");
  eml.innerHTML = icon("users") + 'Manpower';
  eml.onclick = () => { clearSelection(); D().activeBoardId = EMPLIST_ID; refreshAndRender(); };
  el.appendChild(eml);
  }
  if (can("hostlist")) {
  const hl = document.createElement("div");
  hl.className = "board-tab tab-hostlist" + (isHostList() ? " active" : "");
  hl.innerHTML = icon("site") + 'Host';
  hl.onclick = () => { clearSelection(); D().activeBoardId = HOSTLIST_ID; refreshAndRender(); };
  el.appendChild(hl);
  }
  if (can("capacity") && feat().capacity) {
  const cp = document.createElement("div");
  cp.className = "board-tab tab-capacity" + (isCapacity() ? " active" : "");
  cp.innerHTML = icon("list") + 'Capacity';
  cp.onclick = () => {
    clearSelection();
    // open on the board the user was just looking at
    if (D().boards.some(b => b.id === D().activeBoardId)) state.capacity.boardId = D().activeBoardId;
    D().activeBoardId = CAPACITY_ID;
    refreshAndRender();
  };
  el.appendChild(cp);
  }
  // The boards themselves are listed in the toolbar's board picker (#board-menu-list),
  // so a new board never widens the strip above.
  const list = $("#board-menu-list");
  list.innerHTML = "";
  for (const b of (can("board") ? D().boards : [])) {
    const t = document.createElement("div");
    // tab-board marks the per-board tabs specifically: the phone layout hides
    // these and shows #board-select instead, but keeps Overview / Manpower List
    t.className = "board-tab tab-board tb-item" + (b.id === D().activeBoardId ? " active" : "");
    t.setAttribute("role", "menuitem");
    // name + headcount, the same rows as Overview's board menu (no colour key here)
    t.appendChild(Object.assign(document.createElement("span"), { className: "ovb-name", textContent: b.name }));
    t.appendChild(Object.assign(document.createElement("span"), { className: "ovb-count", textContent: String(rosterEmployees(b.id).length) }));
    t.title = can("settings", "edit") ? "Click to switch. Double-click to rename." : "Click to switch.";
    t.onclick = () => { closeTopbarMenus(); clearSelection(); D().activeBoardId = b.id; refreshAndRender(); };
    t.ondblclick = () => {
      if (!can("settings", "edit")) return;
      const name = prompt("Rename board:", b.name);
      if (name && name.trim()) safely(async () => { await cloud.renameBoard(b.id, name.trim()); render(); });
    };
    list.appendChild(t);
  }
  el.scrollLeft = keepScroll;
  const act = el.querySelector(".board-tab.active");
  if (act && act.offsetParent) {
    const a = act.getBoundingClientRect(), e = el.getBoundingClientRect();
    if (a.left < e.left) el.scrollLeft += a.left - e.left - 8;
    else if (a.right > e.right) el.scrollLeft += a.right - e.right + 8;
  }
  renderBoardPill();
  renderUserMenu();
}

/* The pill that stands for the per-board tabs: shows the board on screen, or just
   "Boards" while an app-wide view (Overview, Manpower, Host…) is showing. Hidden for
   a role that cannot see boards at all. */
function renderBoardPill() {
  // the toolbar's board picker: shown on the Board tab only, like Overview's
  const wrap = $("#board-dd");
  const boards = can("board") ? D().boards : [];
  const onBoard = !isNonBoardView();
  const cur = boards.find(b => b.id === D().activeBoardId);
  wrap.classList.toggle("hidden", !onBoard || !cur);
  if (!cur) return;
  try { localStorage.setItem("manpower.lastBoard", cur.id); } catch (e) { /* remembering is a courtesy */ }
  $("#board-dd-label").textContent = cur.name;   // textContent: board names are user data
  $("#board-dd-count").textContent = rosterEmployees(cur.id).length;
}

/* Initials + role in the account menu (Sign out lives there). */
function renderUserMenu() {
  const me = D().me || {};
  const name = me.displayName || me.fullName || me.email || "";
  const parts = String(me.displayName || me.fullName || me.email || "?").replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
  const initials = ((parts[0] || "?")[0] + (parts.length > 1 ? parts[1][0] : "")).toUpperCase();
  $("#avatar-initials").textContent = initials;
  $("#user-menu-name").textContent = name;
  $("#user-menu-role").textContent = me.legacy ? (me.email || "") : [roleLabel(me.roleKey), me.email].filter(Boolean).join(" · ");
}

/* The two menus in the banner (boards, account): one open at a time, closed by a
   click anywhere else, Esc, or choosing something. */
const TOPBAR_MENUS = [["#btn-board-dd", "#board-menu"], ["#btn-avatar", "#user-menu"], ["#btn-filter-pop", "#filter-pop"], ["#btn-emplist-filter-pop", "#emplist-filter-pop"], ["#btn-ov-board", "#ov-board-menu"]];
function closeTopbarMenus() {
  for (const [btn, pop] of TOPBAR_MENUS) {
    $(pop).classList.add("hidden");
    $(btn).setAttribute("aria-expanded", "false");
  }
}
function wireTopbarMenus() {
  for (const [btn, pop] of TOPBAR_MENUS) {
    $(btn).addEventListener("click", (ev) => {
      ev.stopPropagation();
      const open = $(pop).classList.contains("hidden");
      closeTopbarMenus();
      $(pop).classList.toggle("hidden", !open);
      $(btn).setAttribute("aria-expanded", String(open));
    });
  }
  document.addEventListener("click", (ev) => { if (!ev.target.closest(".tb-dd")) closeTopbarMenus(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeTopbarMenus(); });
  $("#board-menu").addEventListener("click", (ev) => { if (ev.target.closest("#btn-add-board")) closeTopbarMenus(); });
  $("#user-menu").addEventListener("click", closeTopbarMenus);
  // the people panel starts under the banner, wherever the banner ends
  const head = $("#sticky-header");
  const setBar = () => document.documentElement.style.setProperty("--bar-h", head.offsetHeight + "px");
  setBar();
  if (window.ResizeObserver) new ResizeObserver(setBar).observe(head);
  // On a board the people panel starts under toolbar row 1 (the buttons run the full
  // width), and once that row has scrolled away it stops at the banner instead.
  const row1 = $("#toolbar-row1");
  let fpRaf = 0;
  const setFpTop = () => {
    fpRaf = 0;
    const top = Math.max(head.offsetHeight, Math.round(row1.getBoundingClientRect().bottom));
    document.documentElement.style.setProperty("--fp-top", top + "px");
  };
  const queueFpTop = () => { if (!fpRaf) fpRaf = requestAnimationFrame(setFpTop); };
  window.addEventListener("scroll", queueFpTop, { passive: true });
  window.addEventListener("resize", queueFpTop);
  if (window.ResizeObserver) new ResizeObserver(queueFpTop).observe(row1);
  setFpTop();
}

/* Built from spans rather than one string so the phone header can drop the
   parts it can't afford (see .btn-date .d-ico / .d-yr in styles.css). Once the
   two arrows and the four icon buttons share this one row, a full
   "Tue 25-Aug-2026" with its icon no longer fits — and a date cut off by an ellipsis is
   worse than one deliberately shortened to "Tue 25-Aug". The title keeps the
   full date on every screen size, and the picker itself always shows the year. */
function renderDateButton() {
  const dow = fmtDow(state.date);
  const full = fmtDate(state.date);
  const [d, mon, yr] = full.split("-");
  const btn = $("#btn-date");
  btn.innerHTML = `<span class="d-ico">${icon("calendar")}</span><span class="d-txt">${dow} ${d}-${mon}<span class="d-yr">-${yr}</span></span>`;
  btn.title = `${dow} ${full} — click to pick a date`;
}

/* lock button: only on an actual board (hidden on the app-wide tabs) */
function renderLockButton() {
  const btn = $("#btn-lock");
  // A Viewer still needs to SEE that a day is locked — that is why the plan on
  // screen cannot be edited — so the button is hidden only when there is no
  // board on screen, and disabled rather than removed when they may not toggle it.
  // no lock on a forecast: locking finalises a confirmed day
  const hide = isNonBoardView() || isForecastView();
  btn.classList.toggle("hidden", hide);
  if (hide) return;
  const mayLock = can("board", "edit");
  btn.disabled = !mayLock;
  btn.classList.toggle("btn-inert", !mayLock);
  const lock = lockInfo(D().activeBoardId, state.date);
  btn.classList.toggle("locked", !!lock);
  if (lock) {
    const when = lock.lockedAt ? new Date(lock.lockedAt).toLocaleString() : "";
    setIconLabel(btn, "lock", "Locked", "btn-label");
    btn.title = `Locked by ${lock.lockedBy}${when ? " on " + when : ""}` +
      (mayLock ? " — click to unlock for everyone" : "");
  } else {
    setIconLabel(btn, "unlock", "Lock", "btn-label");
    btn.title = mayLock ? "Lock this board so it's view-only for everyone" : "This board's plan is unlocked";
  }
}

/* display order for any list of employee cards: permanent before on-call, then by name */
function sortEmployeesDisplay(emps) {
  return [...emps].sort((a, b) =>
    (a.contract === "oncall") - (b.contract === "oncall") || a.name.localeCompare(b.name));
}

/* "สมชาย ใจดี" → ["สมชาย", "ใจดี"]; everything after the first space is the surname */
function splitFullName(name) {
  const s = String(name || "").trim().replace(/\s+/g, " ");
  const i = s.indexOf(" ");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

/* Which name the board's employee cards show: the Thai name (the app's default), the English name
   (the Thai one where there is none) or both, the English on a third small line. Remembered per device. */
function cardNamesSaved() {   // also called while `state` is built, so the key is spelled out here
  try { const v = localStorage.getItem("manpower.cardNames"); return v === "en" ? v : "th"; } catch (e) { return "th"; }
}

function empCard(emp) {
  const area = D().areas.find(a => a.id === emp.areaId);
  const pos = emp.position ? POSITIONS[emp.position] : null;
  const card = document.createElement("div");
  // contract type is the card's identity now (white = permanent, grey dashed = on-call);
  // service area is carried by the area code text, not colour
  card.className = "emp-card" + (emp.contract === "oncall" ? " oncall" : "")
    + (state.selectedEmps.has(emp.id) ? " selected" : "");
  // Not draggable on touch: Android Chrome starts a native drag from a long
  // press on a draggable element, which is the same gesture that now opens the
  // context menu — the two would race for it. Nothing is lost, because HTML5
  // drag never worked on touch anyway (iOS doesn't fire it at all); placing a
  // card by finger goes through tap-to-select then tap-a-mission, as before.
  card.draggable = !IS_TOUCH;
  card.dataset.empId = emp.id;
  // Full name split for the card: first name on its own bold line (with the
  // TRIGO ID, always shown, in that line's corner), surname on a quieter line under it. One
  // role slot: OC for on-call (who have no position), the position otherwise.
  const view = state.cardNames;
  const [firstName, surname] = splitFullName(view === "en" ? (emp.nameEn || emp.name) : emp.name);
  const alsoEn = view === "both" && emp.nameEn && emp.nameEn !== emp.name ? emp.nameEn : "";
  const role = emp.contract === "oncall" ? `<span class="emp-oc">OC</span>`
    : pos ? `<span class="emp-pos">${pos.short}</span>` : "";
  card.innerHTML =
    `<span class="emp-row1">` +
      `<span class="emp-name">${escapeHtml(firstName)}</span>` +
      (emp.trigoId ? `<span class="emp-tid">${escapeHtml(emp.trigoId)}</span>` : "") +
    `</span>` +
    // the space keeps the card's text "first surname" (search, copy, screen
    // readers); a flex container drops it from the layout
    (surname ? ` <span class="emp-surname">${escapeHtml(surname)}</span>` : "") +
    (alsoEn ? ` <span class="emp-name-en">${escapeHtml(alsoEn)}</span>` : "") +
    `<span class="emp-meta">` +
      role +
      (area ? `<span class="emp-area" style="background:${escapeHtml(area.color)};color:${inkOn(area.color)}">${escapeHtml(area.name)}</span>` : "") +
    `</span>`;
  card.title = `${emp.name}${emp.nameEn && emp.nameEn !== emp.name ? " / " + emp.nameEn : ""}${emp.trigoId ? " (" + emp.trigoId + ")" : ""} • ${emp.contract === "oncall" ? "On-call" : "Permanent"}${pos ? " • " + pos.label : ""} • ${area ? area.name : "?"}\nClick to select · Ctrl-click to add · drag or click a mission to assign · double-click to edit`;

  card.addEventListener("click", (ev) => {
    // don't treat the tail end of a drag as a click
    if (ev.detail === 0) return;
    // touch has no Ctrl key, so a plain tap toggles (builds a multi-selection);
    // on desktop a plain click still replaces, Ctrl/Cmd-click adds
    if (ev.ctrlKey || ev.metaKey || IS_TOUCH) toggleSelect(emp.id);
    else selectOnly(emp.id);
  });
  card.addEventListener("dragstart", (ev) => {
    if (isReadOnly()) { ev.preventDefault(); guardEdit(() => {}); return; }
    // dragging an unselected card acts on just that card; a selected one drags the whole selection
    if (!state.selectedEmps.has(emp.id)) selectOnly(emp.id);
    const ids = [...state.selectedEmps];
    ev.dataTransfer.setData("text/plain", JSON.stringify(ids));
    ev.dataTransfer.effectAllowed = "move";
    for (const c of $$(".emp-card.selected")) c.classList.add("dragging");
  });
  card.addEventListener("dragend", () => { for (const c of $$(".emp-card.dragging")) c.classList.remove("dragging"); });
  card.addEventListener("dblclick", () => guardEdit(() => openEmployeeModal(emp.id)));
  card.addEventListener("contextmenu", (ev) => { ev.preventDefault(); openEmpMenu(emp, ev.clientX, ev.clientY); });
  attachLongPress(card, (x, y) => openEmpMenu(emp, x, y));
  return card;
}

/* ---------- multi-selection ---------- */
function updateSelectionUI() {
  const n = state.selectedEmps.size;
  document.body.classList.toggle("has-selection", n > 0);
  const label = n === 1 ? "1 selected" : `${n} selected`;
  const bar = $("#selection-bar");
  if (bar) {
    bar.classList.toggle("hidden", n === 0);
    $("#selection-count").textContent = label;
  }
  // floating touch action bar (CSS only shows it on touch devices)
  const tbar = $("#touch-actions");
  if (tbar) {
    tbar.classList.toggle("on", n > 0);
    const tc = $("#touch-actions-count");
    if (tc) tc.textContent = label;
  }
}
function markSelectedCards() {
  for (const c of $$(".emp-card")) c.classList.toggle("selected", state.selectedEmps.has(c.dataset.empId));
  // keep the Manpower List table's checkboxes/rows in sync too, in case selection
  // changed from a card context menu while the list happens to be showing
  for (const tr of $$("#emplist-body tr")) {
    const on = state.selectedEmps.has(tr.dataset.empId);
    tr.classList.toggle("selected", on);
    const box = tr.querySelector(".el-check input");
    if (box) box.checked = on;
  }
  if ($("#emplist-select-all")) updateEmplistBulkBar();
  updateSelectionUI();
}
function toggleSelect(id) {
  state.selectedEmps.has(id) ? state.selectedEmps.delete(id) : state.selectedEmps.add(id);
  markSelectedCards();
}
function selectOnly(id) {
  state.selectedEmps = new Set([id]);
  markSelectedCards();
}
function clearSelection() {
  if (!state.selectedEmps.size) return;
  state.selectedEmps = new Set();
  markSelectedCards();
}

function closeFilterPops() {
  for (const p of $$("#filters .ms-pop, #emplist-filters .ms-pop, #hostlist-filters .ms-pop, #users-filters .ms-pop")) p.classList.add("hidden");
}

/* phone-only toolbar overflow (see #toolbar-more in styles.css) — a no-op
   above ~640px, where the panel is just an ordinary part of the toolbar row */
function hideToolbarMore() {
  const panel = $("#toolbar-more");
  if (!panel || !panel.classList.contains("open")) return;
  panel.classList.remove("open");
  $("#btn-toolbar-more").setAttribute("aria-expanded", "false");
}

/* ---------- context menu ---------- */
function hideContextMenu() { $("#context-menu").classList.add("hidden"); }

/* Right-click (mouse) and long-press (finger) open the same menu on the same
   terms: pressing an unselected card acts on that card alone, pressing one
   that's part of a selection acts on the whole selection. */
function openEmpMenu(emp, x, y) {
  if (!state.selectedEmps.has(emp.id)) selectOnly(emp.id);
  showContextMenu(emp, x, y);
}

/* ---------- long-press = right-click (touch) ----------
   A phone has no right mouse button, so everything behind the context menu
   (edit, move to board, assign, leave, deactivate) used to be reachable only
   by selecting a card and going through the floating "Actions" bar. Holding a
   card now opens the same menu at the finger.

   Cancelled by any finger drift past LONG_PRESS_SLOP so a press that turns
   into a scroll stays a scroll, and by a second finger (pinch-zoom). */
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;

/* The browser still synthesizes a click when the finger comes up after a long
   press. Left alone it would land on whatever is now under that point — the
   card (toggling it out of the selection) or, worse, the menu item that just
   opened under the finger. This swallows exactly that one click; it is cleared
   by the next touchstart, so a real tap on a menu item is never eaten. */
let swallowNextClick = false;

function attachLongPress(el, open) {
  // Coarse pointers only, which is the same test that decides whether the card
  // stays draggable (see empCard) — so a device gets exactly one of the two
  // gestures on a held card, never both racing for it.
  if (!IS_TOUCH) return;
  let timer = null, sx = 0, sy = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener("touchstart", (ev) => {
    cancel();
    if (ev.touches.length !== 1) return;
    sx = ev.touches[0].clientX;
    sy = ev.touches[0].clientY;
    timer = setTimeout(() => {
      timer = null;
      swallowNextClick = true;
      // a short buzz is the only feedback that the hold "took" — the menu
      // itself opens under the finger, where it can't be seen yet
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
      open(sx, sy);
    }, LONG_PRESS_MS);
  }, { passive: true });
  el.addEventListener("touchmove", (ev) => {
    const t = ev.touches[0];
    if (!t) return;
    if (Math.abs(t.clientX - sx) > LONG_PRESS_SLOP || Math.abs(t.clientY - sy) > LONG_PRESS_SLOP) cancel();
  }, { passive: true });
  el.addEventListener("touchend", cancel);
  el.addEventListener("touchcancel", cancel);
}

/* Two-layer menu. The long lists (missions, boards, leave types) live one
   level down instead of all being inlined: a board with a dozen missions used
   to push this past the height of the screen, which is what the scroll cap
   was papering over. Drill-down rather than hover-out flyouts — no second
   layer to position (so nothing can open off-screen), and it works the same
   under a finger as under a mouse. `ctxMenu` holds what the open menu is
   acting on so a submenu can re-render without recomputing the selection. */
let ctxMenu = null;   // { emp, ids, many, x, y }

function showContextMenu(emp, x, y) {
  // acts on the whole selection when >1 is selected, else just this employee
  const ids = state.selectedEmps.size > 1 && state.selectedEmps.has(emp.id) ? [...state.selectedEmps] : [emp.id];
  ctxMenu = { emp, ids, many: ids.length > 1, x, y };
  renderCtxMenu("root");
}

/* Keep the menu anchored where the click happened, but never let it hang off
   an edge. The lower clamp matters now that a submenu can be a different
   height than the level above it — and the max(8, …) stops a menu taller than
   the viewport from being pushed to a negative top, which put its first items
   out of reach entirely. */
function positionContextMenu() {
  const menu = $("#context-menu");
  const { x, y } = ctxMenu;
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + "px";
}

function renderCtxMenu(view) {
  const menu = $("#context-menu");
  const { emp, ids, many } = ctxMenu;
  menu.innerHTML = "";

  const addTitle = (text) => { const h = document.createElement("div"); h.className = "ctx-title"; h.textContent = text; menu.appendChild(h); };
  // a leaf action: run it and close
  const addItem = (label, fn, cls, ico) => {
    const it = document.createElement("div");
    it.className = "ctx-item" + (cls ? " " + cls : "");
    if (ico) setIconLabel(it, ico, label); else it.textContent = label;
    it.onclick = () => { hideContextMenu(); fn(); };
    menu.appendChild(it);
  };
  // Drills one level down instead of closing. stopPropagation is load-bearing:
  // renderCtxMenu replaces innerHTML, so by the time this click reaches the
  // document handler its own target is detached and closest("#context-menu")
  // no longer matches — the menu would be treated as an outside click and hide
  // itself the instant you opened a submenu.
  const addSub = (label, target, ico) => {
    const it = document.createElement("div");
    it.className = "ctx-item ctx-sub";
    if (ico) setIconLabel(it, ico, label); else it.textContent = label;
    it.onclick = (ev) => { ev.stopPropagation(); renderCtxMenu(target); };
    menu.appendChild(it);
  };
  const addBack = (text) => {
    const it = document.createElement("div");
    it.className = "ctx-item ctx-back";
    it.textContent = text;
    it.onclick = (ev) => { ev.stopPropagation(); renderCtxMenu("root"); };
    menu.appendChild(it);
  };
  const addSep = () => { const s = document.createElement("div"); s.className = "ctx-sep"; menu.appendChild(s); };

  // peekPlan(menuBoardId) (not getPlan(), which reads state.date under
  // D().activeBoardId) — this menu also opens from the Manpower List, where
  // activeBoardId is "__emplist__", not the employee's real board. A
  // mixed-board bulk selection has no single mission list to offer, so the
  // placement actions are hidden then; "Move to board" still covers it.
  const menuBoardId = emp.boardId;
  const sameBoard = ids.every(id => {
    const e = D().employees.find(x => x.id === id);
    return e && e.boardId === menuBoardId;
  });
  // Placing someone needs the plan they would land in. On a forecast date that
  // is the forecast — which only the board itself has loaded — so from the
  // Manpower List the placement items are left out there rather than
  // writing a confirmed assignment onto a forecast date.
  const placeable = sameBoard && !(isNonBoardView() && isForecastDateFor(menuBoardId, state.date));
  const plan = placeable ? peekPlan(menuBoardId) : null;
  const current = placeable && !many ? currentAssignmentOfIn(plan, emp.id) : null;
  // already-there targets are dropped: assigning someone to where they already
  // are is a no-op assignEmployeesTo would skip anyway
  const missions = placeable ? plan.missions.filter(m => !m.hidden && !(current && current.missionId === m.id)) : [];
  const leaveZones = placeable ? LEAVE_ZONES.filter(z => !(current && current.zone === z)) : [];
  const targetBoards = many ? D().boards : D().boards.filter(b => b.id !== emp.boardId);
  const who = many ? `${ids.length} employees` : emp.name;

  if (view === "boards") {
    addBack("‹ Move to board");
    for (const b of targetBoards) {
      addItem(b.name, () => guardEdit(() => safely(async () => {
        await cloud.moveEmployeesToBoard(ids, b.id, state.date);
        clearSelection();
        await refreshAndRender();
      })));
    }
  } else if (view === "missions") {
    addBack("‹ Assign to mission");
    for (const m of missions) {
      addItem(m.number, () => guardEdit(() => assignEmployeesTo(ids, { missionId: m.id })));
    }
  } else if (view === "leave") {
    addBack("‹ Leave");
    for (const z of leaveZones) {
      addItem(ZONE_LABELS[z], () => guardEdit(() => assignEmployeesTo(ids, { zone: z })));
    }
  } else {
    addTitle(many ? `${ids.length} employees selected` : emp.name);
    if (!many) addItem("Edit employee", () => guardEdit(() => openEmployeeModal(emp.id)), null, "edit");
    if (targetBoards.length) addSub("Move to board", "boards", "arrow-right");
    if (missions.length) addSub("⊕ Assign to mission", "missions");
    if (leaveZones.length) addSub("Leave", "leave", "leave");
    if (placeable && (many || current)) {
      addItem(many ? "↩ Return to standby / pool" : `↩ Return to ${emp.contract === "oncall" ? "Available On-call" : "Standby"}`,
        () => guardEdit(() => assignEmployeesTo(ids, null)));
    }
    addSep();
    addItem(many ? `Deactivate ${ids.length} employees` : "Deactivate employee", () => {
      showConfirm("Deactivate employee" + (many ? "s" : "") + "?",
        `Deactivate ${who}? Hidden from today's and future boards; past dates keep them. Turn back on from the Status column in the Manpower List.`,
        () => safely(async () => { await cloud.setEmployeesActive(ids, false); clearSelection(); await refreshAndRender(); }));
    }, "ctx-danger");
  }

  menu.classList.remove("hidden");
  menu.scrollTop = 0;   // a submenu opened after scrolling the level above starts at its own top
  positionContextMenu();
}

function renderZones() {
  const plan = getPlan();
  for (const z of ZONES) {
    const body = $(`#status-zones [data-drop="zone:${z}"]`);
    body.innerHTML = "";
    const emps = plan.zones[z]
      .map(empId => D().employees.find(e => e.id === empId))
      .filter(e => e && e.boardId === D().activeBoardId && onRoster(e));
    for (const emp of sortEmployeesDisplay(emps)) body.appendChild(empCard(emp));
    // headcount in the label, like a mission card's — it also goes out in the JPG export
    body.closest(".zone").querySelector(".zone-count").textContent = emps.length;
    // an empty leave zone collapses to a thin one-line drop target instead of
    // a fixed-height card — most days only 1-2 of the 5 types are ever used,
    // so the other 3-4 were costing ~175px of screen space for nothing.
    // The element and its data-drop target don't change, so drag/drop keeps
    // working exactly as before; only the CSS presentation shrinks.
    const zoneEl = body.closest(".zone");
    const isEmpty = emps.length === 0;
    zoneEl.classList.toggle("zone-empty", isEmpty);
    if (isEmpty) {
      const hint = document.createElement("span");
      hint.className = "zone-empty-hint";
      hint.textContent = "Drag here";
      body.appendChild(hint);
    }
  }
  renderLeaveTabs();
  renderFloatPool();
}

/* ---------- Leave tabs ----------
   The leave band shows one type at a time; the tab strip carries every count. It opens
   on the busiest type for the board and day on screen and stays where the user puts it
   (a click, a drop on a tab, or hovering a tab mid-drag). The tabs are drop targets
   themselves (class dropzone, data-drop="zone:…"), so bindDropzones handles them. */
function setLeaveTab(z) {
  state.leaveTab = z;
  for (const zone of $$("#status-zones .zone-leave")) zone.classList.toggle("lz-on", zone.dataset.zone === z);
  for (const t of $$("#leave-tabs .lv-tab")) {
    const on = t.dataset.lv === z;
    t.classList.toggle("on", on);
    t.setAttribute("aria-selected", String(on));
  }
}
function renderLeaveTabs() {
  const counts = {};
  for (const t of $$("#leave-tabs .lv-tab")) {
    const body = $(`#status-zones [data-drop="zone:${t.dataset.lv}"]`);
    const n = body ? body.querySelectorAll(".emp-card").length : 0;
    counts[t.dataset.lv] = n;
    t.querySelector("b").textContent = n;
    t.classList.toggle("has", n > 0);
  }
  const key = D().activeBoardId + "|" + state.date;
  if (state.leaveTabKey !== key || !state.leaveTab) {
    state.leaveTabKey = key;
    state.leaveTab = null;
    let best = "annual";
    for (const z of Object.keys(counts)) if (counts[z] > counts[best]) best = z;
    state.leaveTab = best;
  }
  setLeaveTab(state.leaveTab);
}
function wireLeaveTabs() {
  const strip = $("#leave-tabs");
  let hoverTimer = null;
  const stop = () => { clearTimeout(hoverTimer); hoverTimer = null; };
  strip.addEventListener("click", (ev) => { const t = ev.target.closest(".lv-tab"); if (t) setLeaveTab(t.dataset.lv); });
  // dragging a person over a tab opens it after a beat, so they can be dropped into the lane itself
  strip.addEventListener("dragover", (ev) => {
    const t = ev.target.closest(".lv-tab");
    if (!t || t.classList.contains("on") || hoverTimer) return;
    hoverTimer = setTimeout(() => { hoverTimer = null; setLeaveTab(t.dataset.lv); }, 450);
  });
  strip.addEventListener("dragleave", stop);
  strip.addEventListener("drop", (ev) => { stop(); const t = ev.target.closest(".lv-tab"); if (t) setLeaveTab(t.dataset.lv); });
}

/* which employees on the active board are unassigned right now (Map for reuse) */
function unassignedEmployees() {
  const plan = getPlan();
  const placed = new Set();
  for (const m of plan.missions) for (const e of m.members) placed.add(e);
  for (const z of ZONES) for (const e of plan.zones[z]) placed.add(e);
  return rosterEmployees(D().activeBoardId).filter(e => !placed.has(e.id));
}

/* service-area filter chips in the floating panel (empty selection = show all) */
function renderAreaFilter() {
  const box = $("#area-filter");
  if (!box) return;
  box.innerHTML = "";
  // only offer areas that actually have unassigned people on this board
  const counts = new Map();
  for (const e of unassignedEmployees()) counts.set(e.areaId, (counts.get(e.areaId) || 0) + 1);
  for (const a of D().areas) {
    if (!counts.has(a.id)) continue;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "fp-area-chip" + (state.poolAreas.has(a.id) ? " on" : "");
    chip.innerHTML = `<span class="dot" style="background:${a.color}"></span>${escapeHtml(a.name)}<b>${counts.get(a.id)}</b>`;
    chip.onclick = () => {
      state.poolAreas.has(a.id) ? state.poolAreas.delete(a.id) : state.poolAreas.add(a.id);
      renderFloatPool();
    };
    box.appendChild(chip);
  }
  if (state.poolAreas.size) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "fp-area-chip fp-area-clear";
    clear.textContent = "Clear areas";
    clear.onclick = () => { state.poolAreas = new Set(); renderFloatPool(); };
    box.appendChild(clear);
  }
}

/* the floating right panel: unassigned employees split by contract type,
   filtered by name search and service area */
function renderFloatPool() {
  const standbyBody = $(`[data-pool="standby"]`);
  const oncallBody = $(`[data-pool="oncall"]`);
  if (!standbyBody || !oncallBody) return;
  renderAreaFilter();
  standbyBody.innerHTML = "";
  oncallBody.innerHTML = "";
  const q = state.empSearch.trim().toLowerCase();
  const filtered = state.poolAreas.size > 0 || q.length > 0;
  // on a holiday, unassigned permanent employees are off, not on standby —
  // relabel the pool so the board doesn't read as a staffing gap
  const holiday = isNonWorkingDate(state.date);
  $("#standby-label").textContent = holiday ? "Holiday" : "Standby";
  $("#standby-sub").textContent = holiday ? "permanent, on holiday" : "permanent, unassigned";
  let standbyN = 0, oncallN = 0;
  for (const emp of sortEmployeesDisplay(unassignedEmployees())) {
    const isOncall = emp.contract === "oncall";
    if (isOncall) oncallN++; else standbyN++;                       // counts always reflect the true total
    if (q && !emp.name.toLowerCase().includes(q)) continue;
    if (state.poolAreas.size && !state.poolAreas.has(emp.areaId)) continue;
    (isOncall ? oncallBody : standbyBody).appendChild(empCard(emp));
  }
  $("#standby-count").textContent = standbyN;
  $("#oncall-count").textContent = oncallN;
  if (!standbyBody.children.length) standbyBody.innerHTML = `<span class="fp-empty">${filtered ? "No match" : (holiday ? "No one on holiday" : "Everyone permanent is assigned")}</span>`;
  if (!oncallBody.children.length) oncallBody.innerHTML = `<span class="fp-empty">${filtered ? "No match" : "No on-call free"}</span>`;
  markSelectedCards();
  // Both pools genuinely empty (not just filtered down by search/area) — the
  // panel is reserving 264px to say "nobody's here" twice. Collapse it to a
  // thin rail; it still expands on hover/drag (see the .fp-collapsed CSS and
  // the dragenter/dragleave wiring in wireApp) so it's never actually gone as
  // a drop target, just out of the way when there's nothing in it.
  const bothEmpty = standbyN === 0 && oncallN === 0;
  $("#float-pool").classList.toggle("fp-collapsed", bothEmpty);
  document.body.classList.toggle("fp-collapsed", bothEmpty);
}

/* The floating panel above only ever searches the two UNASSIGNED pools, so
   typing the name of someone already on a mission or a leave zone used to
   just show "No match" on both — even though they were on screen the whole
   time. This instead flashes/scrolls to their card wherever it actually is
   (mission grid or leave zones), and says so. */
let lastSearchMatchId = null;   // first assigned match found — re-scroll only when this changes

function applySearchHighlight() {
  const note = $("#emp-search-note");
  if (!note) return;   // not on a board view right now (Overview / Manpower List)
  const q = state.empSearch.trim().toLowerCase();
  const cards = $$("#missions-grid .emp-card, #status-zones .emp-card");
  if (!q) {
    for (const c of cards) c.classList.remove("search-hit");
    note.classList.add("hidden");
    lastSearchMatchId = null;
    return;
  }
  let firstMatch = null, n = 0;
  for (const card of cards) {
    const emp = D().employees.find(e => e.id === card.dataset.empId);
    const hit = !!emp && emp.name.toLowerCase().includes(q);
    card.classList.toggle("search-hit", hit);
    if (hit) { n++; if (!firstMatch) firstMatch = card; }
  }
  if (!n) {
    note.classList.add("hidden");
    lastSearchMatchId = null;
    return;
  }
  note.textContent = `${n} already assigned — flashing on the board ↴`;
  note.classList.remove("hidden");
  note.onclick = () => firstMatch.scrollIntoView({ block: "center", behavior: "smooth" });
  const firstId = firstMatch.dataset.empId;
  if (firstId !== lastSearchMatchId) {
    firstMatch.scrollIntoView({ block: "center", behavior: "smooth" });
    lastSearchMatchId = firstId;
  }
}

function missionMatchesFilters(m) {
  const f = state.filters;
  if (f.engineer.length && !f.engineer.includes(m.engineerId)) return false;
  if (f.host.length && !f.host.includes(m.host)) return false;
  if (f.customer.length && !f.customer.includes(m.customer)) return false;
  if (f.shift.length && !f.shift.includes(m.shift)) return false;
  return true;
}

/* sort order for missions on the board */
function missionSortValue(m) {
  switch (state.sort) {
    case "number": return m.number;
    case "engineer": { const e = D().engineers.find(x => x.id === m.engineerId); return e ? e.name : "~"; }
    case "host": return m.host;
    case "customer": return m.customer;
    case "shift": return (m.shift === "night" ? "2" : "1") + m.startTime;
    default: return null;
  }
}

/* how much of the engineer's colour washes behind the mission header. Low
   enough that theme-coloured text stays legible on top of any engineer colour,
   high enough that the header still reads as that engineer's block. */
const MISSION_TINT = 0.15;

function renderMissions() {
  const plan = getPlan();
  const grid = $("#missions-grid");
  grid.innerHTML = "";
  let missions = plan.missions.filter(m => !m.hidden);
  const fcView = isForecastView();
  const cardHide = !fcView && can("board", "edit") && !isReadOnly();
  if (state.sort) {
    missions.sort((a, b) =>
      missionSortValue(a).localeCompare(missionSortValue(b)) || a.number.localeCompare(b.number));
  }
  // matching missions float to the top; non-matching (dimmed) sink below
  missions = [...missions.filter(missionMatchesFilters), ...missions.filter(m => !missionMatchesFilters(m))];
  for (const m of missions) {
    const eng = D().engineers.find(e => e.id === m.engineerId);
    const engColor = eng ? eng.color : "#ccc";
    const card = document.createElement("div");
    card.className = "mission-card" + (m.shift === "night" ? " night" : "") +
      (missionMatchesFilters(m) ? "" : " dimmed");
    // The engineer's colour is what lets you pick one engineer's missions out of
    // a full board at a glance — but as a solid header fill it was the loudest
    // thing on screen AND forced the header text to be pinned dark in both
    // themes (it sat on an arbitrary data colour). Full strength on the card's
    // top edge, a 15% wash behind the header: the edge and the tinted header
    // sit against each other, so the two together still read as one colour
    // block from across the room, and the header text can follow the theme
    // like every other label again.
    card.style.borderTopColor = engColor;
    card.dataset.missionId = m.id;   // the "mission with no crew" status chip scrolls to it
    const memberEmps = missionCrew(m);
    const header = document.createElement("div");
    header.className = "mission-header";
    header.style.background = tintOf(engColor, MISSION_TINT);
    header.title = "Click to edit mission";
    // the host's service area (from its Host List record) rides with the shift
    // chip: the two together answer "when and where" without reading the
    // address, and a host with no area set simply shows no pill
    const hostArea = hostAreaOf(m.host);
    const hostRec = hostRecordOf(m.host);
    /* Where the job is, answered by the host name itself: it becomes the map
       link, with a pin after it. It was only ever in the Host List tab — a
       planner's screen — so the one question the crew reading a shared board
       actually has ("where do I go?") was the one thing the board did not
       answer. See hostNameHtml. */
    const hostHtml = hostNameHtml(m.host, hostRec);
    /* The PPE line carries the host's own note first, then this mission's PPE
       — one line for "everything the crew has to know before they go", rather
       than a site note that only lives in the Host List where nobody reading
       the board would see it. Either part alone still renders the line; with
       neither, there's no line, exactly as before. */
    const hostNote = (hostRec || {}).note || "";
    const ppeParts = [];
    if (hostNote) ppeParts.push(`<span class="m-ppe-host" title="From this host's record in the Host list">${escapeHtml(hostNote)}</span>`);
    if (m.ppe) ppeParts.push(escapeHtml(m.ppe));
    const ppeLine = ppeParts.length
      ? `<div class="m-ppe"><b>PPE</b> ${ppeParts.join(" + ")}</div>` : "";
    header.innerHTML = `
      <div class="m-line1">
        <span class="m-number">${escapeHtml(m.number)}</span>
        <span class="m-sep">|</span>
        ${hostHtml}
        <span class="m-pills">
          ${areaPillHtml(hostArea, "m-area")}
          <span class="m-shift${m.shift === "night" ? " night" : ""}">${m.shift === "night" ? `<span class="m-shift-ico">${icon("moon")}</span>NIGHT` : "DAY"}</span>
        </span>
      </div>
      <div class="m-line2">
        <span class="m-cust">${escapeHtml(m.customer)}</span>
        <span class="m-sep">|</span>
        <span>${m.startTime}-${m.endTime}</span>
        <span class="m-sep">|</span>
        <span class="m-eng">${eng ? escapeHtml(eng.name) : "?"}</span>
        ${eng && eng.phone ? telLink(eng.phone) : ""}
        <span class="m-count">${memberEmps.length}</span>
      </div>
      ${ppeLine}`;
    header.onclick = () => guardEdit(() => openMissionModal(m.id));
    if (fcView) {
      // D3: people taken out of this mission by another engineer, until acknowledged
      const lost = D().holdEvents.filter(e => e.fromMissionId === m.id);
      if (lost.length) header.appendChild(holdBadge(lost));
    }
    const body = document.createElement("div");
    body.className = "mission-body dropzone";
    body.dataset.drop = "mission:" + m.id;
    const empRow = document.createElement("div");
    empRow.className = "mission-emps";
    for (const emp of sortEmployeesDisplay(memberEmps)) empRow.appendChild(empCard(emp));
    body.appendChild(empRow);
    // No crew: say so where the people would be, and offer to take the mission
    // off the board. Only for someone who could hide it right now (no prompt),
    // and never in an export (body.exporting hides it).
    if (!memberEmps.length && cardHide) {
      const empty = document.createElement("div");
      empty.className = "m-empty";
      empty.innerHTML = `<span class="m-empty-hint"><b>No crew yet</b> · drag people here</span>`;
      const hideBtn = document.createElement("button");
      hideBtn.type = "button";
      hideBtn.className = "m-empty-hide";
      hideBtn.title = "Take this mission off the board without deleting it";
      hideBtn.setAttribute("aria-label", `Hide mission ${m.number} (no crew)`);
      hideBtn.innerHTML = `${icon("eye-off")}<span>Hide</span>`;
      // stop here: the body is a drop zone whose click assigns a selection
      hideBtn.onclick = (ev) => { ev.stopPropagation(); hideMissionFromCard(m); };
      empty.appendChild(hideBtn);
      body.appendChild(empty);
    }
    if (m.remark) {
      const remark = document.createElement("div");
      remark.className = "m-remark";
      remark.textContent = "*" + m.remark;
      body.appendChild(remark);
    }
    card.appendChild(header);
    card.appendChild(body);
    grid.appendChild(card);
  }
  bindDropzones();
  layoutMasonry();   // masonry-position the cards (on screen; re-run at export width during export)
}

/* stats for one board on the current date (reads cache only, never fetches) */
function boardStats(boardId) {
  // rosterEmployees, not boardEmployees: `ids` below gates which assignments
  // get counted, so this one swap keeps the headcount AND the assigned/leave
  // tallies consistent with what the board actually renders
  const emps = rosterEmployees(boardId);
  const ids = new Set(emps.map(e => e.id));
  const plan = peekPlan(boardId);
  // hidden missions are already emptied of members when hidden (their people
  // return to Standby), but filter here too so a hidden row never counts even
  // if data drifts out of sync with that rule
  const visibleMissions = plan.missions.filter(m => !m.hidden);
  const placed = new Set();
  for (const m of visibleMissions) for (const e of m.members) if (ids.has(e)) placed.add(e);
  const assigned = placed.size;
  const zoneCount = (z) => plan.zones[z].filter(e => ids.has(e)).length;
  for (const z of ZONES) for (const e of plan.zones[z]) if (ids.has(e)) placed.add(e);
  const zones = Object.fromEntries(ZONES.map(z => [z, zoneCount(z)]));
  const leave = LEAVE_ZONES.reduce((sum, z) => sum + zones[z], 0);
  // Standby is computed, not stored: any permanent employee not on a mission
  // or a leave type. On-call employees in the same spot are just "available" —
  // deliberately tracked separately since that's normal, not worth flagging.
  const unassigned = emps.filter(e => !placed.has(e.id));
  const permanentUnassigned = unassigned.filter(e => e.contract === "permanent");
  const oncallAvailableList = unassigned.filter(e => e.contract === "oncall");
  // On a holiday/weekend, an unassigned permanent employee isn't a staffing
  // gap — it's their day off. Bucket them separately so Standby (and anything
  // built from it) never flags a holiday as "needs attention".
  const isHoliday = isNonWorkingDate(state.date, boardId);
  const standbyList = isHoliday ? [] : permanentUnassigned;
  const onHolidayList = isHoliday ? permanentUnassigned : [];
  return {
    total: emps.length, assigned, leave, zones,
    isHoliday,
    standby: standbyList.length,
    availableList: standbyList,
    onHoliday: onHolidayList.length,
    onHolidayList,
    oncallAvailable: oncallAvailableList.length,
    oncallAvailableList,
    available: unassigned.length,
    missions: visibleMissions.length,
    // missions on this board+date with nobody from this board on them — the
    // mirror image of "standby": a job with no crew rather than a person with
    // no job. Actionable in its own right, so Overview surfaces it per board.
    unstaffed: visibleMissions.filter(m => !m.members.some(e => ids.has(e))).length,
    // headcount of people working each shift, not mission-slot count — consistent
    // with every other chip in the stats row (Assigned/Leave/Standby are all headcounts)
    dayMissions: visibleMissions.filter(m => m.shift !== "night")
      .reduce((sum, m) => sum + m.members.filter(e => ids.has(e)).length, 0),
    nightMissions: visibleMissions.filter(m => m.shift === "night")
      .reduce((sum, m) => sum + m.members.filter(e => ids.has(e)).length, 0),
    permanent: emps.filter(e => e.contract === "permanent").length,
    oncall: emps.filter(e => e.contract === "oncall").length,
  };
}

function statChip(label, n, color, extraClass) {
  const c = document.createElement("span");
  c.className = "stat-chip" + (extraClass ? " " + extraClass : "");
  c.innerHTML = (color ? `<span class="dot" style="background:${color}"></span>` : "") + `${label}: <b>${n}</b>`;
  return c;
}

/* A status chip (layout A, row 2): grey = for information, amber = check it,
   red = fix it. With onClick it is a button that narrows the page to what it counts. */
function statusChip(tone, n, label, onClick, title = "") {
  const c = document.createElement(onClick ? "button" : "span");
  if (onClick) { c.type = "button"; c.onclick = onClick; }
  c.className = "status-chip" + (tone ? " sc-" + tone : "") + (onClick ? "" : " sc-static");
  if (title) c.title = title;
  c.innerHTML = (n == null ? "" : `<b>${n}</b> `) + escapeHtml(label);
  return c;
}
function statusGroup(bar, chips) {
  // every tab's chips sit in the same place as the board's: #board-status, before the count
  const g = $("#board-status");
  g.innerHTML = "";
  const list = chips.filter(Boolean);
  for (const c of list) g.appendChild(c);
  g.classList.toggle("hidden", !list.length);
}
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

function renderStats() {
  const bar = $("#stats-bar");
  const areaBar = $("#area-bar");
  bar.innerHTML = "";
  bar.classList.remove("stats-tiles");
  $("#board-status").classList.add("hidden");   // the board path below fills and shows it
  areaBar.innerHTML = "";
  // Overview: the day across every board — same rule as the board tiles
  if (isOverview()) {
    let assigned = 0, total = 0, leave = 0, hol = 0, free = 0, standby = 0, unstaffed = 0, standbyBoards = 0;
    for (const b of ovScopeBoards()) {   // the boards the toolbar's dropdown picked
      let st; try { st = boardStats(b.id); } catch (e) { continue; }
      assigned += st.assigned; total += st.total; leave += st.leave; hol += st.onHoliday; free += st.oncallAvailable;
      standby += st.standby; unstaffed += st.unstaffed; if (st.standby) standbyBoards++;
    }
    if (ovScopeBoards().length > 1) bar.appendChild(statChip("Boards", ovScopeBoards().length));
    bar.appendChild(statChip("Utilization", utilizationPct2(assigned, standby) + "%"));
    bar.appendChild(statChip("Assigned", assigned));
    bar.appendChild(statChip("Standby", standby));
    statusGroup(bar, [
      standbyBoards ? statusChip("red", null, plural(standbyBoards, "board", "boards") + " with Standby", null, "Boards with permanent people on no mission and no leave") : null,
      unstaffed ? statusChip("amber", null, plural(unstaffed, "mission", "missions") + " with no crew") : null,
    ]);
    return;
  }
  if (isOrgChart()) {
    let missions = 0, crew = 0, emptyMissions = 0; const engs = new Set();
    for (const b of D().boards) {
      const plan = (D().plans[b.id] || {})[state.date];
      if (!plan) continue;
      for (const m of plan.missions) {
        if (m.hidden) continue;
        missions++;
        if (m.engineerId) engs.add(m.engineerId);
        crew += m.members.length;
        if (!m.members.length) emptyMissions++;
      }
    }
    bar.appendChild(statChip("Boards", D().boards.length));
    bar.appendChild(statChip("Engineers", engs.size));
    bar.appendChild(statChip("Missions", missions));
    bar.appendChild(statChip("Crew deployed", crew));
    statusGroup(bar, [emptyMissions ? statusChip("amber", null, plural(emptyMissions, "mission", "missions") + " with no crew") : null]);
    return;
  }
  if (isEmployeeList()) {
    // the board's stats design: a Total lead, tiles that split it, a proportion bar,
    // and a "By area" line of area-coloured chips that also adds up to Total
    const emps = D().employees;
    const permN = emps.filter(e => e.contract === "permanent").length;
    const inactiveN = emps.filter(e => e.active === false).length;
    const tileHtml = (label, n, kind, title = "") =>
      `<div class="stat-tile st-${kind}${n === 0 ? " st-zero" : ""}" data-stat="${label}"${title ? ` title="${title}"` : ""}><div class="st-main"><span class="st-l">${label}</span><b>${n}</b></div></div>`;
    bar.classList.add("stats-tiles");
    bar.innerHTML = `<div class="stat-lead" data-stat="Total"><span class="st-l">Total</span><b>${emps.length}</b></div>` +
      tileHtml("Permanent", permN, "perm") + tileHtml("On-call", emps.length - permN, "oncall") +
      tileHtml("Inactive", inactiveN, "inactive", "Counted in Total; not on any board today") +
      `<div class="st-split" aria-hidden="true">${[["perm", permN], ["oncall", emps.length - permN]].filter(([, n]) => n > 0)
        .map(([k, n]) => `<i class="st-${k}" style="flex:${n}"></i>`).join("")}</div>`;
    const emplistAreaBar = $("#emplist-area-bar");
    const known = new Set(D().areas.map(a => a.id));
    const chip = (name, n, color) => `<span class="area-chip" data-area="${escapeHtml(name)}"><i class="ac-dot" style="background:${/^#[0-9a-f]{3,8}$/i.test(color || "") ? color : "var(--muted)"}"></i>${escapeHtml(name)} <b>${n}</b></span>`;
    let html = "";
    for (const a of D().areas) { const n = emps.filter(e => e.areaId === a.id).length; if (n) html += chip(a.name, n, a.color); }
    const noArea = emps.filter(e => !known.has(e.areaId)).length;
    if (noArea) html += chip("No area", noArea, "");
    emplistAreaBar.innerHTML = html ? `<span class="ar-cap">By area</span>${html}` : "";
    const knownAreas = new Set(D().areas.map(a => a.id));
    const act = D().employees.filter(e => e.active !== false);
    const issueChip = (key, tone, n, label) => n ? statusChip(tone, n, label, () => {
      state.emplist.issue = state.emplist.issue === key ? null : key;
      renderEmployeeRows(); renderStats();
    }, state.emplist.issue === key ? "Click again to show everyone" : "Show only these people") : null;
    statusGroup(bar, [
      issueChip("trigo", "amber", act.filter(e => !e.trigoId).length, "missing TRIGO ID"),
      issueChip("area", "amber", act.filter(e => !knownAreas.has(e.areaId)).length, "no service area"),
      issueChip("en", "", act.filter(e => !(e.nameEn || "").trim()).length, "no English name"),
    ]);
    for (const c of $$("#board-status .status-chip")) c.classList.toggle("sc-on", c.title.startsWith("Click again"));
    return;
  }
  if (isCapacity()) {
    const boardId = capBoardId();
    if (!boardId) return;
    renderCapacitySummary(bar, capacityModel(boardId));
    return;
  }
  if (isHostList()) {
    // the directory is still in flight on the very first paint of this tab —
    // the chips then describe the host records alone and correct themselves on
    // the redraw that follows the fetch
    const rows = allHostRows();
    const withLoc = rows.filter(r => r.location || r.mapUrl).length;
    const staffed = rows.filter(r => r.inspectors.length).length;
    // the board's stats design: a Total lead, tiles that split it, a proportion bar,
    // and a "By area" line of area-coloured chips that adds up to Total
    const archived = rows.filter(r => r.archived).length;
    const hTile = (label, n, kind, title = "") =>
      `<div class="stat-tile st-${kind}${n === 0 ? " st-zero" : ""}" data-stat="${label}"${title ? ` title="${title}"` : ""}><div class="st-main"><span class="st-l">${label}</span><b>${n}</b></div></div>`;
    bar.classList.add("stats-tiles");
    bar.innerHTML = `<div class="stat-lead" data-stat="Total"><span class="st-l">Total</span><b>${rows.length}</b></div>` +
      hTile("With location", withLoc, "perm") + hTile("No location", rows.length - withLoc, "noloc") +
      hTile("Ever staffed", staffed, "oncall", "Hosts at least one person has ever been deployed to") +
      hTile("Archived", archived, "inactive", "Counted in Total; kept for history") +
      `<div class="st-split" aria-hidden="true">${[["perm", withLoc], ["noloc", rows.length - withLoc]].filter(([, n]) => n > 0)
        .map(([k, n]) => `<i class="st-${k}" style="flex:${n}"></i>`).join("")}</div>`;
    const hostAreaBar = $("#area-bar");
    const areaChip = (name, n, color) => `<span class="area-chip" data-area="${escapeHtml(name)}"><i class="ac-dot" style="background:${/^#[0-9a-f]{3,8}$/i.test(color || "") ? color : "var(--muted)"}"></i>${escapeHtml(name)} <b>${n}</b></span>`;
    let areaHtml = "";
    for (const a of D().areas) { const n = rows.filter(r => r.area && r.area.id === a.id).length; if (n) areaHtml += areaChip(a.name, n, a.color); }
    const noArea = rows.filter(r => !r.area).length;
    if (noArea) areaHtml += areaChip("No area", noArea, "");
    hostAreaBar.innerHTML = areaHtml ? `<span class="ar-cap">By area</span>${areaHtml}` : "";
    const noLoc = rows.filter(r => !r.archived && !(r.location || r.mapUrl)).length;
    const on = state.hostlist.filters.location.length === 1 && state.hostlist.filters.location[0] === "missing";
    statusGroup(bar, [noLoc ? statusChip("amber", noLoc, "without a location", () => {
      state.hostlist.filters.location = on ? [] : ["missing"];
      renderHostlistFilterOptions(); renderHostRows(); renderStats();
    }, on ? "Click again to show every host" : "Show only active hosts with no location or Maps link") : null]);
    if (on) $("#board-status .status-chip").classList.add("sc-on");
    return;
  }
  const s = boardStats(D().activeBoardId);
  // Tiles, not chips: the status counts split the whole board (Assigned + Leave +
  // Standby [+ Holiday] + On-call free = Total) and Day + Night split Assigned, so
  // they read as one structure instead of a flat run of 14 numbers. Standby is the
  // count a planner acts on: it is flagged (colour + icon) only when it is not 0.
  const lead = `<div class="stat-lead" data-stat="Total"><span class="st-l">Total</span><b>${s.total}</b></div>`;
  const tile = (label, n, kind, extra = "", alert = false, title = "") =>
    `<div class="stat-tile st-${kind}${n === 0 && !alert ? " st-zero" : ""}${alert ? " st-alert" : ""}" data-stat="${label}"${title ? ` title="${title}"` : ""}>` +
    `<div class="st-main"><span class="st-l">${label}</span><b>${n}</b></div>${extra}</div>`;
  const shift = `<div class="st-shift"><span data-stat="Day">${icon("sun")}<b>${s.dayMissions}</b> Day</span>` +
    `<span data-stat="Night">${icon("moon")}<b>${s.nightMissions}</b> Night</span></div>`;
  // Utilization = Assigned ÷ (Assigned + Standby): people on leave (exchange
  // working day included), on a holiday or on-call and not called in are left out,
  // so the missing share is exactly Standby and 0 Standby reads 100%.
  const util = utilizationPct2(s.assigned, s.standby);
  const utilLine = `<span class="st-pct" data-stat="Utilized" title="Assigned ÷ (Assigned + Standby). People on leave, on a holiday or on-call and not called in are left out.">${util}% utilized</span>`;
  // Status chips: what needs a look, beside the numbers. Standby has no chip — its tile already flags it.
  const plan = peekPlan(D().activeBoardId);
  const hiddenN = plan.missions.filter(m => m.hidden).length;
  const statusChips =
    (s.unstaffed ? `<button type="button" class="status-chip sc-amber" data-status="unstaffed" title="Show the first mission with nobody on it"><b>${s.unstaffed}</b> ${s.unstaffed === 1 ? "mission" : "missions"} with no crew</button>` : "") +
    (hiddenN ? `<button type="button" class="status-chip" data-status="hidden" title="Open Hide/Unhide"><b>${hiddenN}</b> ${hiddenN === 1 ? "mission" : "missions"} hidden</button>` : "");
  bar.classList.add("stats-tiles");
  bar.innerHTML = lead +
    tile("Assigned", s.assigned, "asg", shift).replace(/<b>(\d+)<\/b><\/div>/, (m0, n) => `<span class="st-num"><b>${n}</b>${utilLine}</span></div>`) +
    tile("Leave", s.leave, "leave") +
    tile("Standby", s.standby, "standby", s.standby > 0 ? `<span class="st-ico">${icon("alert")}</span>` : "", s.standby > 0,
      "Permanent staff on no mission and no leave") +
    (s.isHoliday ? tile("Holiday", s.onHoliday, "hol") : "") +
    tile("On-call free", s.oncallAvailable, "free") +
    // how the day splits, in the tile colours: a quick read of the proportions, never the only carrier of a number
    `<div class="st-split" aria-hidden="true">${[["asg", s.assigned], ["leave", s.leave], ["standby", s.standby], ["hol", s.isHoliday ? s.onHoliday : 0], ["free", s.oncallAvailable]]
      .filter(([, n]) => n > 0).map(([k, n]) => `<i class="st-${k}" style="flex:${n}"></i>`).join("")}</div>`;
  const statusBox = $("#board-status");
  statusBox.innerHTML = statusChips;
  statusBox.classList.toggle("hidden", !statusChips);
  const firstEmpty = statusBox.querySelector('[data-status="unstaffed"]');
  if (firstEmpty) firstEmpty.onclick = () => {
    const m = plan.missions.find(x => !x.hidden && !x.members.length);
    const card = m && document.querySelector(`.mission-card[data-mission-id="${CSS.escape(String(m.id))}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.remove("flash-outline"); void card.offsetWidth; card.classList.add("flash-outline");
  };
  const hiddenBtn = statusBox.querySelector('[data-status="hidden"]');
  if (hiddenBtn) hiddenBtn.onclick = () => $("#btn-hide-missions").click();
  // Service area is a different cut of the SAME people as Total (the board's roster),
  // so the chips must add up to it: anyone without a known area is counted as
  // "No area" instead of silently dropping out of the sum.
  const roster = rosterEmployees(D().activeBoardId);
  const known = new Set(D().areas.map(a => a.id));
  const areaChip = (name, n, color) => `<span class="area-chip" data-area="${escapeHtml(name)}"><i class="ac-dot" style="background:${/^#[0-9a-f]{3,8}$/i.test(color || "") ? color : "var(--muted)"}"></i>${escapeHtml(name)} <b>${n}</b></span>`;
  let areaHtml = "";
  for (const a of D().areas) {
    const n = roster.filter(e => e.areaId === a.id).length;
    if (n) areaHtml += areaChip(a.name, n, a.color);
  }
  const noArea = roster.filter(e => !known.has(e.areaId)).length;
  if (noArea) areaHtml += areaChip("No area", noArea, "");
  areaBar.innerHTML = areaHtml ? `<span class="ar-cap">By area</span>${areaHtml}` : "";
}

/* ---------- overview tab ---------- */
function shortDateLabel(iso) { return iso.slice(8, 10) + "/" + iso.slice(5, 7); }

/* assigned ÷ (headcount − leave − onHoliday − free on-call) — "how much of the
   people actually available today is deployed". onHoliday and oncallFree default
   to 0 for callers that don't track them separately. Spelled out in the UI (not
   just this comment) since it's not guessable from the number alone. */
/* Free on-call staff are NOT a utilization gap. On-call is surge capacity: not
   calling someone in is the system working as intended, not idle headcount. So
   they come out of the denominator entirely — a day where every permanent
   employee is deployed reads 100%, however many on-call people went uncalled.
   (They're still counted the moment they ARE deployed: an on-call person on a
   mission is in `assigned` and, being neither free nor on leave, stays in the
   denominator.) "On-call free" keeps its own chip in the stats bar and its own
   column in Overview's By board table — the number isn't hidden, it just
   doesn't drag utilization down. */
/* The same utilization to two decimals, for the board's own stats: assigned ÷
   (assigned + standby), which is the denominator above once leave, holiday and
   free on-call are taken out. Trailing zeros dropped: 97.85, 98.5, 100. */
function utilizationPct2(assigned, standby) {
  const denom = assigned + standby;
  return denom > 0 ? Math.round(assigned / denom * 10000) / 100 : 0;
}
function utilizationPct(assigned, headcount, leave, onHoliday = 0, oncallFree = 0) {
  const denom = headcount - leave - onHoliday - oncallFree;
  return denom > 0 ? Math.round((assigned / denom) * 100) : 0;
}

/* A line chart's SVG keeps its viewBox aspect ratio, so drawing it at a fixed
   640×220 and letting CSS stretch it to 100% just letterboxes it — on a wide
   card the plot ends up using well under half the row, which is exactly where
   6 boards' worth of lines need the space. Measure the (already laid-out)
   container and draw at that width instead. Callers queue these until the whole
   panel is in the document, since an unattached element measures 0. */
function fillLineChart(wrap, opts) {
  // a floor, not a fixed size: on a phone the chart draws at the phone's width
  // rather than at 520 and being shrunk to unreadable text
  const w = Math.max(300, Math.round(wrap.clientWidth) || 720);
  wrap.innerHTML = Charts.lineChart({ ...opts, width: w });
}

function ovSection(title, subtitle) {
  const sec = document.createElement("section");
  sec.className = "ov-section";
  const h = document.createElement("h3");
  h.textContent = title;
  sec.appendChild(h);
  if (subtitle) {
    const sub = document.createElement("p");
    sub.className = "ov-section-sub";
    sub.textContent = subtitle;
    sec.appendChild(sub);
  }
  return sec;
}

/* A plain heading between Overview's groups of cards ("In detail", "Over
   time"): tells the reader the time frame changes, without another box. */
function ovGroupHead(title, subtitle) {
  const head = document.createElement("div");
  head.className = "ov-group-head";
  head.appendChild(Object.assign(document.createElement("h2"), { textContent: title }));
  if (subtitle) head.appendChild(Object.assign(document.createElement("span"), { className: "ov-group-sub", textContent: subtitle }));
  return head;
}

/* ---------- Overview trend metrics: shared by the KPI sparkline and the
   merged Trend chart, both reading the same cloud.getUtilizationRange() cache
   (state.overview.util) so adding "Idle staff" as a third line costs nothing
   the app doesn't already fetch. All three read the exact same per-day record
   {assigned, headcount, leave, oncallAssigned, oncallHeadcount, oncallLeave}. ---------- */
function trendMetricValue(metric, rec) {
  if (metric === "oncallFree") return Math.max(0, rec.oncallHeadcount - rec.oncallAssigned - rec.oncallLeave);
  if (metric === "idle") {
    // permanent unassigned ≈ permanent headcount − permanent assigned − permanent
    // leave. An approximation for past dates only in that it doesn't split out
    // holidays (getUtilizationRange doesn't track them per-day); today's own
    // figure — the KPI tile and status bar — comes from boardStats() instead,
    // which does.
    const permHeadcount = rec.headcount - rec.oncallHeadcount;
    const permAssigned = rec.assigned - rec.oncallAssigned;
    const permLeave = rec.leave - rec.oncallLeave;
    return Math.max(0, permHeadcount - permAssigned - permLeave);
  }
  const oncallFree = Math.max(0, rec.oncallHeadcount - rec.oncallAssigned - rec.oncallLeave);
  return utilizationPct(rec.assigned, rec.headcount, rec.leave, 0, oncallFree);
}
/* the all-boards aggregate, for the KPI tile's sparkline — sums every board's
   raw numerator/denominator for the day before computing the metric, rather
   than averaging each board's own percentage (which would let a tiny board
   swing the total as much as a big one). */
function aggregateMetricPoint(metric, d, boards, util) {
  const sum = { assigned: 0, headcount: 0, leave: 0, oncallAssigned: 0, oncallHeadcount: 0, oncallLeave: 0 };
  let any = false;
  for (const b of boards) {
    if (isNonWorkingDate(d, b.id)) continue;
    const rec = util[b.id] && util[b.id][d];
    if (!rec) continue;
    any = true;
    for (const k in sum) sum[k] += rec[k];
  }
  return any ? trendMetricValue(metric, sum) : null;
}
/* KPI delta: average of the most recent window vs. the window before it
   (capped at a week each way, so a 30-day range doesn't wash a real recent
   swing out into a 15-day average). Returns null when there's too little
   data to say anything — no delta shown beats a misleading one — otherwise
   {delta, k} where k is the window size actually used, for the caption. */
function trendWindowDelta(series) {
  const vals = series.filter((v) => v != null);
  if (vals.length < 4) return null;
  const k = Math.min(5, Math.floor(vals.length / 2));
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  return { delta: Math.round(avg(vals.slice(-k)) - avg(vals.slice(-2 * k, -k))), k };
}


/* ---------- Overview board scope (the selector at the top of the tab) ----------
   "" = every board summed. A board id that no longer exists (deleted in
   another tab mid-session, or remembered from an older session) falls back
   to all boards rather than an empty dashboard. Remembered per device. */
function ovBoardSaved() {   // also called while `state` is built, so the key is spelled out here
  try { return localStorage.getItem("manpower.ovBoard") || ""; } catch (e) { return ""; }
}
function setOvBoard(id) {
  state.overview.boardId = id;
  try { localStorage.setItem("manpower.ovBoard", id); } catch (e) { /* storage unavailable — just don't remember it */ }
  render();
}
function ovScopeBoards() {
  const boards = D().boards;
  const pick = state.overview.boardId;
  if (!pick) return boards;
  const one = boards.filter(b => b.id === pick);
  return one.length ? one : boards;
}
const ovScopeName = (boards) => boards.length === 1 && D().boards.length > 1 ? boards[0].name : "all boards";

/* The toolbar's board dropdown on Overview: "All boards" and each board, with its
   roster count for the date on screen. It lives in toolbar row 1, which stays in
   view while the dashboard scrolls, so the board being shown is always visible. */
function fillOvBoardSelect(scope) {
  // the same button + menu as the banner's Boards picker and the Filters popover
  const current = scope.length === 1 && D().boards.length > 1 ? scope[0].id : "";
  const btn = $("#btn-ov-board"), menu = $("#ov-board-menu");
  const all = D().employees.filter(onRoster).length;
  const pickedBoard = D().boards.find(b => b.id === current);
  const label = btn.querySelector(".ovb-label");
  label.textContent = pickedBoard ? pickedBoard.name : "All boards";   // textContent: board names are user data
  btn.querySelector(".ovb-count").textContent = pickedBoard ? rosterEmployees(pickedBoard.id).length : all;
  btn.querySelector(".ovb-dot").style.background = pickedBoard ? Charts.catColor(D().boards.indexOf(pickedBoard)) : "transparent";
  menu.innerHTML = "";
  const item = (id, name, count, color) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tb-item" + (id === current ? " is-current" : "");
    b.setAttribute("aria-current", id === current ? "true" : "false");
    const dot = b.appendChild(Object.assign(document.createElement("span"), { className: "ovb-dot" }));
    dot.style.background = color || "transparent";
    b.appendChild(Object.assign(document.createElement("span"), { className: "ovb-name", textContent: name }));
    b.appendChild(Object.assign(document.createElement("span"), { className: "ovb-count", textContent: String(count) }));
    b.onclick = () => { closeTopbarMenus(); if (id !== current) setOvBoard(id); };
    menu.appendChild(b);
  };
  item("", "All boards", all);
  D().boards.forEach((b, i) => item(b.id, b.name, rosterEmployees(b.id).length, Charts.catColor(i)));
}
/* Same x-axis rule as Trend (see renderOverview): a date nobody in scope
   works carries no information, so it's dropped from the axis entirely
   rather than plotted as a zero that would drag every average down. */
function historyDates(boards) {
  const ov = state.overview;
  const out = [];
  if (!ov.historyFrom || !ov.historyTo) return out;
  for (let d = ov.historyFrom; d <= ov.historyTo; d = addDays(d, 1)) {
    if (boards.every(b => isNonWorkingDate(d, b.id))) continue;
    out.push(d);
  }
  return out;
}
/* One day's record for the boards in scope, summed the way
   aggregateMetricPoint does it — raw numerators and denominators added
   BEFORE any metric is computed, so a small board can't swing a percentage
   as hard as a large one. Boards that are off that date drop out (they have
   no headcount to contribute to a day they aren't working). */
function historyDayRec(d, boards, hist) {
  const sum = { staffedMissions: 0, byEngineer: {} };
  for (const k of HISTORY_SUM_KEYS) sum[k] = 0;
  let any = false;
  for (const b of boards) {
    if (isNonWorkingDate(d, b.id)) continue;
    const rec = hist[b.id] && hist[b.id][d];
    if (!rec) continue;
    any = true;
    for (const k of HISTORY_SUM_KEYS) sum[k] += rec[k] || 0;
    for (const engId in (rec.byEngineer || {})) {
      const src = rec.byEngineer[engId];
      const acc = sum.byEngineer[engId] ||
        (sum.byEngineer[engId] = { missions: 0, crew: 0, permCrew: 0, oncallCrew: 0 });
      acc.missions += src.missions;
      acc.crew += src.crew;
      acc.permCrew += src.permCrew || 0;
      acc.oncallCrew += src.oncallCrew || 0;
    }
  }
  return any ? sum : null;
}
/* Averages are over PLOTTED days only — the non-working days already left off
   the axis are left out of the denominator too, otherwise a month with eight
   weekend days reads ~25% quieter than it was. One decimal: these are counts
   of people, and "12" would hide the difference between 11.6 and 12.4. */
function historyMean(values) {
  const v = values.filter(x => x != null);
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
}

/* The range control shared by BOTH new sections — presets, two native date
   inputs, and the board scope. Rendered once, in the History header; the
   Engineer workload section below reads the same state.
   A native <input type="date"> rather than a range mode bolted onto the
   board's own date popover (toggleDatePicker): that popover exists to pick a
   PLANNING day and highlights weekends and holiday overrides to do it, none
   of which means anything for an analysis window. */
function historyControls() {
  const ov = state.overview;
  const wrap = document.createElement("div");
  wrap.className = "ov-history-controls";

  const presets = document.createElement("div");
  presets.className = "ov-trend-btns";
  for (const p of HISTORY_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-small" + (ov.historyPreset === p.key ? " active" : "");
    btn.textContent = p.label;
    btn.onclick = () => {
      if (ov.historyPreset === p.key) return;
      ov.historyPreset = p.key;
      ov.historyCacheKey = null;
      refreshAndRender();
    };
    presets.appendChild(btn);
  }
  wrap.appendChild(presets);

  const dates = document.createElement("div");
  dates.className = "ov-history-dates";
  const mkDate = (which, value) => {
    const input = document.createElement("input");
    input.type = "date";
    input.className = "ov-history-date";
    input.value = value || "";
    input.max = todayStr();          // there is no history after today
    input.setAttribute("aria-label", which === "from" ? "History range start" : "History range end");
    input.onchange = () => {
      if (!input.value) { input.value = value || ""; return; }
      // editing either end is what "custom" means — the preset buttons all
      // deselect, and resolveHistoryRange() stops overwriting these two
      ov.historyPreset = "custom";
      if (which === "from") ov.historyFrom = input.value; else ov.historyTo = input.value;
      if (ov.historyFrom > ov.historyTo) {
        // dragging one end past the other collapses the range to a single
        // day rather than fetching an empty one
        if (which === "from") ov.historyTo = ov.historyFrom; else ov.historyFrom = ov.historyTo;
      }
      ov.historyCacheKey = null;
      refreshAndRender();
    };
    return input;
  };
  dates.appendChild(mkDate("from", ov.historyFrom));
  dates.appendChild(Object.assign(document.createElement("span"), { className: "ov-history-dash", textContent: "→" }));
  dates.appendChild(mkDate("to", ov.historyTo));
  wrap.appendChild(dates);

  // No board <select> here any more: the board selector at the top of the tab
  // scopes History too, so the page can't show one board above and another
  // here. ensureHistoryLoaded still fetches every board for the range, so
  // switching boards up there is a redraw, not a round trip.

  return wrap;
}

/* Caption naming the window actually plotted, shared by both sections. */
function historyRangeCaption(dates) {
  const ov = state.overview;
  const span = `${fmtDate(ov.historyFrom)} → ${fmtDate(ov.historyTo)}`;
  return `${span} · ${dates.length} working day${dates.length === 1 ? "" : "s"} · ${ovScopeName(ovScopeBoards())}`;
}

/* ---------- History: four average tiles, one measure charted at a time ----------
   One measure per chart, on its own axis: six lines on one scale squashed
   Missions (~4) flat under Idle (~28). The tiles answer most visits on their
   own; picking one draws that measure day by day with its average as a rule. */
function historySection(dates, recs, pendingCharts) {
  const ov = state.overview;
  const sec = ovSection("History", null);
  sec.querySelector("h3").insertAdjacentHTML("afterend",
    `<p class="ov-section-sub">Daily averages over the range. Pick a tile to see that measure day by day. Weekends and holidays are left out.</p>`);
  sec.appendChild(historyControls());
  if (!dates.length) {
    sec.appendChild(Object.assign(document.createElement("p"), { className: "import-note", textContent: "No working days in this range — every date was a weekend or a holiday." }));
    return sec;
  }
  const lastIdx = recs.map((r, i) => (r ? i : -1)).filter(i => i >= 0).pop();
  const latestWord = ov.historyTo === todayStr() ? "today" : `on ${fmtDate(dates[dates.length - 1])}`;
  const tiles = document.createElement("div");
  tiles.className = "ov-htiles";
  tiles.setAttribute("role", "group");
  tiles.setAttribute("aria-label", "History measure");
  for (const m of OV_HISTORY_MEASURES) {
    const values = recs.map(r => (r ? m.value(r) : null));
    const mean = historyMean(values);
    const latest = lastIdx != null ? values[lastIdx] : null;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ov-htile";
    btn.setAttribute("aria-pressed", String(ov.historyMeasure === m.key));
    btn.innerHTML = `<span class="ov-htile-label">${m.label}</span>
      <span class="ov-htile-value">${mean == null ? "—" : mean + m.suffix}<small> avg</small></span>
      <span class="ov-htile-sub">${latest == null ? "no data" : `${latestWord} ${latest}${m.suffix}`}</span>`;
    btn.title = m.help;
    btn.onclick = () => { if (ov.historyMeasure !== m.key) { ov.historyMeasure = m.key; render(); } };
    tiles.appendChild(btn);
  }
  sec.appendChild(tiles);
  // what the tile being charted means, in plain words, right under the tiles
  const picked = OV_HISTORY_MEASURES.find(x => x.key === ov.historyMeasure) || OV_HISTORY_MEASURES[0];
  sec.appendChild(Object.assign(document.createElement("p"), { className: "ov-htile-help", textContent: `${picked.label}: ${picked.help}` }));

  const m = OV_HISTORY_MEASURES.find(x => x.key === ov.historyMeasure) || OV_HISTORY_MEASURES[0];
  const values = recs.map(r => (r ? m.value(r) : null));
  const mean = historyMean(values);
  const box = document.createElement("div");
  box.className = "ov-hchart";
  box.innerHTML = `<div class="ov-hchart-head"><b>${m.label}, day by day</b></div>`;
  const wrap = document.createElement("div");
  wrap.className = "ov-trend-chart";
  box.appendChild(wrap);
  sec.appendChild(box);
  pendingCharts.push(() => fillLineChart(wrap, {
    series: [{ key: m.key, label: m.label, color: "var(--chart-assigned)", visible: true, points: values.map(y => ({ y, suffix: m.suffix })) }],
    xLabels: dates.map(shortDateLabel), yMax: Charts.niceMax(values.filter(v => v != null)), height: 220,
    refLines: mean != null ? [{ y: mean, color: "var(--muted)", label: "avg" }] : [],
    emptyLabel: "No data in this range",
  }));
  return sec;
}

/* A small crew-per-day trend for one engineer row: area + line + today's dot,
   on a scale shared by every row, with a hover/focus target per day (the
   tooltip says that day's missions and crew split). */
function ovTrendSvg(values, tips, yMax, width = 120, height = 28) {
  const pad = 4, n = values.length;
  const x = (i) => pad + (n <= 1 ? 0 : (i * (width - 2 * pad)) / (n - 1));
  const y = (v) => pad + (height - 2 * pad) * (1 - v / (yMax || 1));
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  let out = `<line x1="${pad}" x2="${width - pad}" y1="${height - pad}" y2="${height - pad}" class="chart-grid"/>`;
  if (n > 1) out += `<path d="${d} L${x(n - 1).toFixed(1)} ${height - pad} L${x(0).toFixed(1)} ${height - pad} Z" fill="var(--chart-assigned)" opacity=".13"/>`
    + `<path d="${d}" fill="none" stroke="var(--chart-assigned)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" class="chart-line"/>`;
  if (n) out += `<circle cx="${x(n - 1).toFixed(1)}" cy="${y(values[n - 1]).toFixed(1)}" r="3" fill="var(--chart-assigned)" stroke="var(--panel)" stroke-width="1.5"/>`;
  const step = n > 1 ? (width - 2 * pad) / (n - 1) : width;
  values.forEach((v, i) => {
    out += `<rect class="chart-mark" x="${(x(i) - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${height}" fill="transparent"
      data-tip-value="${escapeHtml(tips[i].value)}" data-tip-label="${escapeHtml(tips[i].label)}"><title>${escapeHtml(tips[i].label)}: ${escapeHtml(tips[i].value)}</title></rect>`;
  });
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="crew per day">${out}</svg>`;
}

/* Shares that always add up to 100 (largest remainder) — plain rounding gave
   88% + 13% on a two-engineer board. */
function shares100(raw) {
  const total = raw.reduce((a, b) => a + b, 0);
  if (!total) return raw.map(() => 0);
  const exact = raw.map(v => (v / total) * 100), out = exact.map(Math.floor);
  exact.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0])
    .slice(0, 100 - out.reduce((a, b) => a + b, 0)).forEach(([, i]) => out[i]++);
  return out;
}

/* ---------- Engineer workload: ranked bars + trend, missions and crew together ----------
   One row per engineer over the History range, busiest first: missions per
   day, crew per day split permanent / on-call (the team mix a manager asks
   about), crew per mission, a crew trend, active days and share of missions.
   engineer_id lives on the mission row for its own date, so these are the
   people who actually ran those jobs — and byEngineer already carries the
   permanent / on-call split, so nothing extra is fetched. */
function engineerHistorySection(dates, recs) {
  const sec = ovSection("Engineer workload", "Missions each engineer ran and the people they had out, per working day, busiest first. Same range and board as History.");
  const n = dates.length;
  const engById = new Map(D().engineers.map(e => [e.id, e]));
  const ids = new Set();
  for (const r of recs) if (r) for (const id in r.byEngineer) if (r.byEngineer[id].missions) ids.add(id);
  if (!n || !ids.size) {
    sec.appendChild(Object.assign(document.createElement("p"), { className: "import-note", textContent: "No missions in this range." }));
    return sec;
  }
  const tot = (a) => a.reduce((s, v) => s + v, 0);
  const rows = [...ids].map(id => {
    const e = engById.get(id);
    const day = (k) => recs.map(r => (r && r.byEngineer[id] ? r.byEngineer[id][k] || 0 : 0));
    const m = day("missions"), c = day("crew"), p = day("permCrew"), o = day("oncallCrew");
    return {
      id, name: e ? e.name : (id ? "Removed engineer" : "— no engineer set —"), color: e ? e.color : "var(--muted)",
      m, c, p, o, totM: tot(m), totC: tot(c),
      avgM: tot(m) / n, avgC: tot(c) / n, avgP: tot(p) / n, avgO: tot(o) / n,
      active: m.filter(v => v > 0).length,
    };
  }).sort((a, b) => b.avgM - a.avgM || b.avgC - a.avgC || a.name.localeCompare(b.name));
  const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
  const maxM = Math.max(0.1, ...rows.map(r => r.avgM)), maxC = Math.max(0.1, ...rows.map(r => r.avgC));
  const share = shares100(rows.map(r => r.totM));
  const yMax = Math.max(1, ...rows.flatMap(r => r.c));
  const bar = (frac) => `style="width:max(4px, calc(var(--ov-rkmax) * ${frac.toFixed(3)}))"`;
  const T = rows.reduce((a, r) => ({ m: a.m + r.avgM, c: a.c + r.avgC, p: a.p + r.avgP, o: a.o + r.avgO, tm: a.tm + r.totM, tc: a.tc + r.totC }),
    { m: 0, c: 0, p: 0, o: 0, tm: 0, tc: 0 });
  const wrap = document.createElement("div");
  wrap.className = "ov-table-wrap";
  wrap.innerHTML = `<table class="ov-table ov-rank"><thead><tr>
      <th>Engineer</th><th>Missions / day</th><th>Crew / day</th><th class="r ov-wide">Crew per mission</th>
      <th class="ov-wide">Trend · crew per day</th><th class="r ov-wide">Active days</th><th class="r ov-wide">Share of missions</th></tr></thead><tbody>`
    + rows.map((r, i) => `<tr>
      <td><span class="ov-table-nameinner"><span class="ov-table-dot" style="background:${escapeHtml(r.color)}"></span><span class="ov-table-label">${escapeHtml(r.name)}</span></span></td>
      <td><span class="ov-rk-bar"><span ${bar(r.avgM / maxM)}>${Charts.stackedBarH({ segments: [{ label: `${r.name}: missions per day`, value: +r1(r.avgM), color: "var(--muted)" }], height: 10 })}</span><b>${r1(r.avgM)}</b></span>
        <span class="ov-rk-sub">${r.totM} mission${r.totM === 1 ? "" : "s"} in the range</span></td>
      <td><span class="ov-rk-bar"><span ${bar(r.avgC / maxC)}>${Charts.stackedBarH({ segments: [
          { label: `${r.name}: permanent crew per day`, value: +r1(r.avgP), color: "var(--chart-permanent)" },
          { label: `${r.name}: on-call crew per day`, value: +r1(r.avgO), color: "var(--chart-oncall)" }], height: 10 })}</span><b>${r1(r.avgC)}</b></span>
        <span class="ov-rk-sub">${r1(r.avgP)} permanent · ${r1(r.avgO)} on-call</span></td>
      <td class="r ov-wide">${r.totM ? r1(r.totC / r.totM) : "—"}</td>
      <td class="ov-wide">${ovTrendSvg(r.c, dates.map((d, k) => ({
          value: `${r.m[k]} mission${r.m[k] === 1 ? "" : "s"} · ${r.c[k]} crew`,
          label: `${r.name} · ${fmtDate(d)} — ${r.p[k]} permanent · ${r.o[k]} on-call`,
        })), yMax)}</td>
      <td class="r ov-wide">${r.active} <span class="ov-muted">of ${n}</span></td>
      <td class="r ov-wide">${share[i]}%</td></tr>`).join("")
    + `<tr class="ov-table-totalrow"><td><span class="ov-table-label">All engineers</span></td><td><b>${r1(T.m)}</b></td>
      <td><b>${r1(T.c)}</b> <span class="ov-muted">· ${r1(T.p)} permanent · ${r1(T.o)} on-call</span></td>
      <td class="r ov-wide"><b>${T.tm ? r1(T.tc / T.tm) : "—"}</b></td><td class="ov-wide"></td><td class="ov-wide"></td><td class="r ov-wide"><b>100%</b></td></tr>`
    + `</tbody></table>`;
  sec.appendChild(wrap);
  sec.appendChild(ovLegend([
    { label: "Missions", color: "var(--muted)" },
    { label: "Permanent crew", color: "var(--chart-permanent)" },
    { label: "On-call crew", color: "var(--chart-oncall)" },
  ]));
  return sec;
}

/* A plain, non-interactive legend: a swatch and a label (optionally a count). */
function ovLegend(items) {
  const el = document.createElement("div");
  el.className = "ov-legend";
  el.innerHTML = items.map(it => `<span><i style="background:${escapeHtml(it.color)}"></i>${
    it.count == null ? escapeHtml(it.label) : it.countFirst ? `<b>${it.count}</b> ${escapeHtml(it.label)}` : `${escapeHtml(it.label)} <b>${it.count}</b>`}</span>`).join("");
  return el;
}

function renderOverview() {
  const panel = $("#overview-panel");
  panel.innerHTML = "";
  const allBoards = D().boards;
  if (!allBoards.length) {
    panel.innerHTML = '<p class="import-note">Create a board (+ Board, top left) to see the Overview dashboard.</p>';
    return;
  }
  // The board selector at the top scopes the WHOLE page: every section below
  // reads `boards`, never D().boards, so picking one board can't leave a
  // stray all-boards number somewhere further down.
  const boards = ovScopeBoards();
  const scoped = boards.length !== allBoards.length;
  const scopeName = ovScopeName(boards);
  const dayLabel = `${fmtDow(state.date)} ${fmtDate(state.date)}`;
  const stats = Object.fromEntries(boards.map(b => [b.id, boardStats(b.id)]));
  // a board keeps its colour whichever board is picked (index in the full list)
  const boardColor = (b) => Charts.catColor(allBoards.indexOf(b));
  const sum = (k) => boards.reduce((s, b) => s + stats[b.id][k], 0);
  const pendingCharts = [];
  const openBoard = (boardId) => { D().activeBoardId = boardId; refreshAndRender(); };
  const multiArea = D().areas.length > 1;
  const areaById = new Map(D().areas.map(a => [a.id, a]));
  // a name chip: same identity rule as the board cards (white = permanent,
  // grey dashed = on-call); the service area rides along only when there is
  // more than one area to tell apart
  const nameChip = (emp, b) => {
    const area = areaById.get(emp.areaId);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "ov-mini" + (emp.contract === "oncall" ? " oncall" : "");
    chip.textContent = emp.name;
    if (multiArea && area) chip.appendChild(Object.assign(document.createElement("small"), { textContent: area.name }));
    chip.title = `${emp.contract === "oncall" ? "On-call" : "Permanent"}${area ? " · " + area.name : ""} — click to open ${b.name}`;
    chip.onclick = () => openBoard(b.id);
    return chip;
  };

  // roster for the date on screen — boardStats() is already roster-filtered, so
  // these totals have to use the same set or the KPI strip, the By board table
  // and every utilization denominator disagree by however many people are
  // currently deactivated. (Past dates keep everyone; see onRoster().)
  const rosterAll = scoped ? boards.flatMap(b => rosterEmployees(b.id)) : D().employees.filter(onRoster);
  const totalEmp = rosterAll.length;
  const totalAssigned = sum("assigned"), totalLeave = sum("leave"), totalStandby = sum("standby");
  const totalOnHoliday = sum("onHoliday"), totalOncallFree = sum("oncallAvailable"), totalMissions = sum("missions");
  const totalPerm = rosterAll.filter(e => e.contract === "permanent").length;
  const totalOncall = totalEmp - totalPerm;
  const overallUtil = utilizationPct(totalAssigned, totalEmp, totalLeave, totalOnHoliday, totalOncallFree);
  const totalDayCrew = sum("dayMissions"), totalNightCrew = sum("nightMissions");   // headcount, not mission count — see boardStats

  // today's missions, read straight from the plan cache (no extra query)
  const missionsOf = (b) => peekPlan(b.id).missions.filter(m => !m.hidden);
  const todaysMissions = boards.flatMap(missionsOf);
  const todaysDayCount = todaysMissions.filter(m => m.shift !== "night").length;
  const todaysNightCount = todaysMissions.length - todaysDayCount;
  const todaysHosts = [...new Set(todaysMissions.map(m => m.host))];
  const todaysEngineers = new Set(todaysMissions.filter(m => m.engineerId).map(m => m.engineerId));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /* ---------- KPI sparkline data ----------
     Ends on state.date, not real-world "today" — every other number on this
     page is state.date's, so the sparkline must describe the same timeline. A
     date nobody in scope works is left off the axis entirely. */
  const util = state.overview.util || {};
  const toDate = state.date;
  const fromDate = addDays(toDate, -(state.overview.trendRange - 1));
  const xDates = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
    if (boards.every(b => isNonWorkingDate(d, b.id))) continue;
    xDates.push(d);
  }
  const utilSpark = xDates.map(d => aggregateMetricPoint("util", d, boards, util));
  const utilDelta = trendWindowDelta(utilSpark);

  /* ---------- 2. attention card: the verdict, the day's shifts, and who is idle ----------
     Was two boxes (status bar + Action queue) both saying "20 idle". The
     headline is "Status bar" in the role matrix, the name lists "Action
     queue", so a role keeps exactly what it could see before. */
  const showHead = can("ov.status"), showNames = can("ov.actionQueue");
  if (showHead || showNames) {
    const attn = document.createElement("section");
    attn.className = "ov-attn" + (totalStandby ? "" : " ok");
    const shiftsHtml = `<span class="ov-attn-shift"><b>Day:</b> ${plural(todaysDayCount, "mission", "missions")} · <b>${totalDayCrew}</b> crew</span>`
      + `<span class="ov-attn-shift"><b>Night:</b> ${plural(todaysNightCount, "mission", "missions")} · <b>${totalNightCrew}</b> crew</span>`;
    const title = !totalStandby ? "All permanent staff are on a mission"
      : totalStandby === 1 ? "1 permanent staff member has no mission" : `${totalStandby} permanent staff have no mission`;
    attn.innerHTML = `<div class="ov-attn-top">
        <div class="ov-attn-main"><div class="ov-attn-title">${totalStandby ? icon("alert") : ""}<span>${title}</span></div>
          <div class="ov-attn-sub">${dayLabel} · ${escapeHtml(scoped ? scopeName : plural(boards.length, "board", "boards"))}${totalStandby && showNames ? " · click a name to open that person's board" : ""}</div></div>
        <div class="ov-attn-shifts">${shiftsHtml}</div></div>`;
    if (showNames && totalStandby) {
      const groups = document.createElement("div");
      groups.className = "ov-attn-groups";
      for (const b of boards) {
        const list = stats[b.id].availableList.slice().sort((x, y) => x.name.localeCompare(y.name));
        if (!list.length) continue;
        const open = state.overview.idleOpen.has(b.id);
        const g = document.createElement("div");
        g.className = "ov-attn-group";
        g.innerHTML = `<h4><span class="ov-table-dot" style="background:${boardColor(b)}"></span><span></span><span class="ov-tag warn">${list.length} idle</span></h4><div class="ov-chips"></div>`;
        g.querySelector("h4 span:nth-child(2)").textContent = b.name;
        const chips = g.querySelector(".ov-chips");
        for (const emp of (open ? list : list.slice(0, OV_IDLE_SHOWN))) chips.appendChild(nameChip(emp, b));
        if (list.length > OV_IDLE_SHOWN) {
          const more = document.createElement("button");
          more.type = "button";
          more.className = "ov-linkbtn";
          more.setAttribute("aria-expanded", String(open));
          more.textContent = open ? "Show fewer" : `+${list.length - OV_IDLE_SHOWN} more`;
          more.onclick = () => { open ? state.overview.idleOpen.delete(b.id) : state.overview.idleOpen.add(b.id); render(); };
          chips.appendChild(more);
        }
        groups.appendChild(g);
      }
      attn.appendChild(groups);
    }
    if (showNames && totalOncallFree) {
      const open = state.overview.oncallQueueOpen;
      const calm = document.createElement("div");
      calm.className = "ov-attn-calm";
      calm.innerHTML = `<span>${plural(totalOncallFree, "on-call person is", "on-call staff are")} free. That is surge capacity, so no action is needed.</span><button type="button" class="ov-linkbtn" aria-expanded="${open}">${open ? "Hide names" : "Show names"}</button>`;
      calm.querySelector("button").onclick = () => { state.overview.oncallQueueOpen = !open; render(); };
      attn.appendChild(calm);
      if (open) {
        const chips = document.createElement("div");
        chips.className = "ov-chips";
        for (const b of boards) for (const emp of stats[b.id].oncallAvailableList.slice().sort((x, y) => x.name.localeCompare(y.name))) chips.appendChild(nameChip(emp, b));
        attn.appendChild(chips);
      }
    }
    panel.appendChild(attn);
  }

  /* ---------- 3. KPI tiles: each number says its unit and what to judge it by ---------- */
  if (can("ov.kpi")) {
    const kpiRow = document.createElement("div");
    kpiRow.className = "ov-kpi-row";
    const utilTile = document.createElement("div");
    utilTile.className = "ov-kpi-tile";
    utilTile.innerHTML = `<div class="ov-kpi-head"><div><div class="ov-kpi-value">${overallUtil}%</div>
        <div class="ov-kpi-label">Utilization ${OV_UTIL_INFO}</div></div></div><div class="ov-kpi-breakdown"></div>`;
    if (utilSpark.some(v => v != null)) {
      utilTile.querySelector(".ov-kpi-head").appendChild(
        Object.assign(document.createElement("div"), { innerHTML: Charts.sparkline({ points: utilSpark, color: "var(--chart-assigned)" }) }).firstChild);
    }
    const utilSub = utilTile.querySelector(".ov-kpi-breakdown");
    if (utilDelta) {
      const dir = utilDelta.delta > 0 ? "up" : utilDelta.delta < 0 ? "down" : "";
      const arrow = utilDelta.delta > 0 ? "▲" : utilDelta.delta < 0 ? "▼" : "▬";
      utilSub.innerHTML = `<b class="${dir}">${arrow} ${Math.abs(utilDelta.delta)} pt${Math.abs(utilDelta.delta) === 1 ? "" : "s"}</b>: average of the last ${utilDelta.k} working days vs the ${utilDelta.k} before`;
    } else {
      utilSub.textContent = "Not enough working days yet to show a trend";
    }
    kpiRow.appendChild(utilTile);

    const deploySegs = [
      { label: "on a mission", value: totalAssigned, color: "var(--chart-assigned)" },
      { label: "on leave", value: totalLeave, color: "var(--chart-leave)" },
      { label: "idle", value: totalStandby, color: "var(--chart-standby)" },
    ];
    if (totalOnHoliday) deploySegs.push({ label: "day off (holiday)", value: totalOnHoliday, color: "var(--chart-holiday)" });
    deploySegs.push({ label: "on-call free", value: totalOncallFree, color: "var(--muted)" });
    const deployTile = document.createElement("div");
    deployTile.className = "ov-kpi-tile";
    deployTile.innerHTML = `<div class="ov-kpi-value">${totalAssigned}<span class="ov-kpi-value-sub"> / ${totalEmp}</span></div>
      <div class="ov-kpi-label">Deployed on a mission</div><div class="ov-kpi-mixbar"></div>`;
    deployTile.querySelector(".ov-kpi-mixbar").innerHTML = Charts.stackedBarH({ segments: deploySegs, height: 8 });
    deployTile.appendChild(ovLegend(deploySegs.map(s => ({ label: s.label, color: s.color, count: s.value, countFirst: true }))));
    kpiRow.appendChild(deployTile);

    const missionsTile = document.createElement("div");
    missionsTile.className = "ov-kpi-tile";
    missionsTile.innerHTML = `<div class="ov-kpi-value">${totalMissions}</div><div class="ov-kpi-label">Missions</div>
      <div class="ov-kpi-breakdown">${todaysDayCount} day · ${todaysNightCount} night<br>on ${plural(todaysHosts.length, "host", "hosts")}, run by ${plural(todaysEngineers.size, "engineer", "engineers")}</div>`;
    kpiRow.appendChild(missionsTile);

    const oncallTile = document.createElement("div");
    oncallTile.className = "ov-kpi-tile";
    oncallTile.innerHTML = `<div class="ov-kpi-value">${totalOncallFree}<span class="ov-kpi-value-sub"> of ${totalOncall}</span></div>
      <div class="ov-kpi-label">On-call free</div>
      <div class="ov-kpi-breakdown">${Math.max(0, totalOncall - totalOncallFree)} called in or on leave. Free on-call staff are left out of utilization.</div>`;
    kpiRow.appendChild(oncallTile);
    panel.appendChild(kpiRow);
  }

  /* ---------- 4. by board: exact values, one bar (Utilized) ----------
     Row click scopes this page to the board; the arrow opens the board itself.
     On a phone the same rows render as cards (styles.css swaps them). */
  if (can("ov.byBoard")) {
    const sec = ovSection("By board", `${dayLabel}. ${boards.length > 1 ? "Click a row to show only that board here; the" : "The"} arrow opens the board itself.`);
    sec.querySelector("h3").insertAdjacentHTML("beforeend", " " + OV_UTIL_INFO);
    const rows = boards.map(b => {
      const s = stats[b.id];
      return { b, name: b.name, color: boardColor(b), holiday: s.isHoliday, util: utilizationPct(s.assigned, s.total, s.leave, s.onHoliday, s.oncallAvailable),
        missions: s.missions, total: s.total, assigned: s.assigned, leave: s.leave, idle: s.standby, free: s.oncallAvailable, perm: s.permanent, oncall: s.oncall };
    });
    if (rows.length > 1) rows.push({ b: null, name: "All boards", util: overallUtil, missions: totalMissions, total: totalEmp, assigned: totalAssigned,
      leave: totalLeave, idle: totalStandby, free: totalOncallFree, perm: totalPerm, oncall: totalOncall });
    const mix = (r) => {
      const pp = r.total ? Math.round((r.perm / r.total) * 100) : 0;
      return `<span class="chart-mark ov-mix" tabindex="0" data-tip-value="${r.perm} permanent · ${r.oncall} on-call" data-tip-label="${pp}% / ${100 - pp}%">${r.perm} / ${r.oncall}</span>`;
    };
    const idleCell = (r) => (r.idle ? `<span class="ov-tag warn">${r.idle}</span>` : "0");
    const tbl = document.createElement("div");
    tbl.className = "ov-table-wrap ov-boards-table";
    tbl.innerHTML = `<table class="ov-table"><thead><tr><th>Board</th><th class="r">Utilized</th><th class="r">Missions</th><th class="r">Headcount</th>
        <th class="r">Deployed</th><th class="r">Leave</th><th class="r">Idle</th><th class="r">On-call free</th><th class="r">Permanent / on-call</th><th></th></tr></thead><tbody>`
      + rows.map((r, i) => `<tr class="${r.b ? "ov-row-click" : "ov-table-totalrow"}" ${r.b ? `data-i="${i}" tabindex="0"` : ""}>
        <td><span class="ov-table-nameinner">${r.b ? `<span class="ov-table-dot" style="background:${r.color}"></span>` : ""}<span class="ov-table-label">${escapeHtml(r.name)}${r.holiday ? "<small>holiday</small>" : r.b ? "" : `<small>${plural(boards.length, "board", "boards")}</small>`}</span></span></td>
        <td class="r"><span class="ov-util">${r.b ? `<span class="ov-util-track"><i style="width:${Math.min(100, r.util)}%"></i></span>` : ""}<b>${r.util}%</b></span></td>
        <td class="r">${r.missions}</td><td class="r">${r.total}</td><td class="r">${r.assigned}</td><td class="r">${r.leave}</td>
        <td class="r">${idleCell(r)}</td><td class="r">${r.free}</td><td class="r">${mix(r)}</td>
        <td class="r">${r.b ? `<button type="button" class="ov-linkbtn ov-open" data-open="${i}" title="Open ${escapeHtml(r.name)}" aria-label="Open ${escapeHtml(r.name)}">→</button>` : ""}</td></tr>`).join("")
      + `</tbody></table>`;
    tbl.querySelectorAll("tr[data-i]").forEach(tr => {
      const r = rows[+tr.dataset.i];
      tr.onclick = (ev) => { if (ev.target.closest(".ov-open")) return; if (boards.length > 1) setOvBoard(r.b.id); };
      tr.onkeydown = (ev) => { if (ev.key === "Enter" && boards.length > 1) setOvBoard(r.b.id); };
    });
    tbl.querySelectorAll("[data-open]").forEach(btn => { btn.onclick = () => openBoard(rows[+btn.dataset.open].b.id); });
    sec.appendChild(tbl);
    const cards = document.createElement("div");
    cards.className = "ov-board-cards";
    cards.innerHTML = rows.map(r => `<div class="ov-bcard"><span class="ov-table-nameinner">${r.b ? `<span class="ov-table-dot" style="background:${r.color}"></span>` : ""}<span class="ov-table-label">${escapeHtml(r.name)}</span></span>
      <span class="ov-bcard-util"><b>${r.util}%</b> utilized</span>
      <div class="ov-bcard-kv"><div><b>${r.missions}</b><span>missions</span></div><div><b>${r.assigned}<small> / ${r.total}</small></b><span>deployed</span></div><div><b class="${r.idle ? "warn" : ""}">${r.idle}</b><span>idle</span></div>
      <div><b>${r.leave}</b><span>leave</span></div><div><b>${r.free}</b><span>on-call free</span></div><div><b>${r.perm} / ${r.oncall}</b><span>perm / on-call</span></div></div></div>`).join("");
    sec.appendChild(cards);
    panel.appendChild(sec);
  }

  /* ---------- 5. by engineer: today's missions and crew per responsible engineer ----------
     Crew counts only members on the roster of the mission's board for this
     date — the same rule boardStats uses, so a stale membership or someone
     added to the app after this date never inflates the number. */
  const engSec = ovSection("By engineer", `Who is running ${dayLabel}'s missions, and how many people they have out — ${scoped ? "on " + scopeName : "across all boards"}. Click a row to open the board filtered to that engineer.`);
  {
    const load = new Map();   // engineerId ("" = none set) -> {day, night, perm, oncall, boards:Map(id->name)}
    for (const b of boards) {
      const empById = new Map(rosterEmployees(b.id).map(e => [e.id, e]));
      for (const m of missionsOf(b)) {
        const id = m.engineerId || "";
        const rec = load.get(id) || { day: 0, night: 0, perm: 0, oncall: 0, boards: new Map() };
        rec[m.shift === "night" ? "night" : "day"]++;
        for (const emp of m.members.map(x => empById.get(x)).filter(Boolean)) rec[emp.contract === "oncall" ? "oncall" : "perm"]++;
        rec.boards.set(b.id, b.name);
        load.set(id, rec);
      }
    }
    const engById = new Map(D().engineers.map(e => [e.id, e]));
    const rows = [...load.entries()].map(([id, r]) => ({ id, r, e: engById.get(id), crew: r.perm + r.oncall, missions: r.day + r.night }))
      .sort((a, b) => b.missions - a.missions || b.crew - a.crew || (a.e ? a.e.name : "").localeCompare(b.e ? b.e.name : ""));
    if (!rows.length) {
      engSec.appendChild(Object.assign(document.createElement("p"), { className: "import-note", textContent: "No missions today." }));
    } else {
      const crewMax = Math.max(1, ...rows.map(x => x.crew));
      const wrap = document.createElement("div");
      wrap.className = "ov-table-wrap";
      wrap.innerHTML = `<table class="ov-table"><thead><tr><th>Engineer</th><th class="r">Missions</th><th class="r">Crew</th></tr></thead><tbody>`
        + rows.map((x, i) => `<tr class="${x.e ? "ov-row-click" : ""}" data-i="${i}" ${x.e ? 'tabindex="0"' : ""}>
          <td><span class="ov-table-nameinner"><span class="ov-table-dot" style="background:${escapeHtml(x.e ? x.e.color : "var(--muted)")}"></span>
            <span class="ov-table-label">${escapeHtml(x.e ? x.e.name : (x.id ? "Removed engineer" : "— no engineer set —"))}<small>${escapeHtml([...x.r.boards.values()].join(" · "))}</small></span></span></td>
          <td class="r"><b>${x.missions}</b> ${x.r.day ? `<span class="ov-shift-tag day">D ${x.r.day}</span>` : ""}${x.r.night ? `<span class="ov-shift-tag night">N ${x.r.night}</span>` : ""}</td>
          <td class="r"><span class="ov-crewcell"><span class="ov-crewbar" style="width:${Math.max(12, (x.crew / crewMax) * 100)}px">${Charts.stackedBarH({ segments: [
              { label: "permanent", value: x.r.perm, color: "var(--chart-permanent)" }, { label: "on-call", value: x.r.oncall, color: "var(--chart-oncall)" }], height: 8 })}</span><b>${x.crew}</b></span>
            <span class="ov-rk-sub">${x.r.perm} permanent${x.r.oncall ? ` · ${x.r.oncall} on-call` : ""}</span></td></tr>`).join("")
        + `<tr class="ov-table-totalrow"><td><span class="ov-table-label">All engineers</span></td><td class="r"><b>${totalMissions}</b></td><td class="r"><b>${rows.reduce((s, x) => s + x.crew, 0)}</b></td></tr></tbody></table>`;
      // open the first in-scope board this engineer has a mission on, with the
      // board's Engineer filter set to them
      wrap.querySelectorAll("tr.ov-row-click").forEach(tr => {
        const x = rows[+tr.dataset.i];
        const go = () => { state.filters.engineer = [x.id]; openBoard([...x.r.boards.keys()][0]); };
        tr.onclick = go;
        tr.onkeydown = (ev) => { if (ev.key === "Enter") go(); };
      });
      engSec.appendChild(wrap);
    }
    const free = D().engineers.filter(e => !load.has(e.id));
    if (free.length) {
      const line = document.createElement("div");
      line.className = "ov-eng-free";
      line.innerHTML = `<span class="ov-tag mute">Free today${scoped ? " on " + escapeHtml(scopeName) : ""}</span> `
        + free.map(e => `<span class="ov-table-nameinner"><span class="ov-table-dot" style="background:${escapeHtml(e.color)}"></span>${escapeHtml(e.name)}</span>`).join(", ");
      engSec.appendChild(line);
    }
  }

  /* ---------- 6. by service area: headcount per area by contract type ---------- */
  const areaSec = ovSection("By service area", "Headcount per area by contract type. Bar length is the area's headcount; biggest area first.");
  {
    const rows = D().areas.map(a => {
      const emps = rosterAll.filter(e => e.areaId === a.id);
      const perm = emps.filter(e => e.contract === "permanent").length;
      return { name: a.name, color: a.color, perm, oncall: emps.length - perm, total: emps.length };
    });
    const noArea = rosterAll.filter(e => !areaById.has(e.areaId));
    if (noArea.length) {
      const perm = noArea.filter(e => e.contract === "permanent").length;
      rows.push({ name: "No area set", color: "var(--border)", perm, oncall: noArea.length - perm, total: noArea.length });
    }
    const shown = rows.filter(r => r.total).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    if (!shown.length) {
      areaSec.appendChild(Object.assign(document.createElement("p"), { className: "import-note", textContent: "Nobody on the roster for this date." }));
    } else {
      const max = Math.max(...shown.map(r => r.total));
      const P = shown.reduce((s, r) => s + r.perm, 0), O = shown.reduce((s, r) => s + r.oncall, 0);
      const pct = (v) => Math.round((v / (P + O)) * 100);
      const list = document.createElement("div");
      list.className = "ov-area-rows";
      list.innerHTML = shown.map(r => `<div class="ov-area-row"><span class="ov-area-row-label" title="${escapeHtml(r.name)}"><span class="ov-area-dot" style="background:${escapeHtml(r.color)}"></span><span class="ov-area-row-name">${escapeHtml(r.name)}</span></span>
          <div>${Charts.stackedBarH({ segments: [{ label: `${r.name}: permanent`, value: r.perm, color: "var(--chart-permanent)" }, { label: `${r.name}: on-call`, value: r.oncall, color: "var(--chart-oncall)" }], scaleMax: max, height: 16 })}</div>
          <span class="ov-area-row-totalwrap"><span class="ov-area-row-total">${r.total}</span><span class="ov-area-row-pct">${r.perm} P · ${r.oncall} OC</span></span></div>`).join("")
        + `<div class="ov-area-row ov-area-row-grandtotal"><span class="ov-area-row-label"><span class="ov-area-row-name">All areas</span></span>
          <span class="ov-muted">${P} permanent (${pct(P)}%) · ${O} on-call (${pct(O)}%)</span><span class="ov-area-row-totalwrap"><span class="ov-area-row-total">${P + O}</span></span></div>`;
      areaSec.appendChild(list);
      areaSec.appendChild(ovLegend([{ label: "Permanent", color: "var(--chart-permanent)", count: P }, { label: "On-call", color: "var(--chart-oncall)", count: O }]));
    }
  }

  /* ---------- 7. shifts: crew first, missions second, one unit everywhere ---------- */
  const shiftSec = ovSection("Shifts", "People on missions by shift. Crew is the headline, missions the detail.");
  if (!totalMissions) {
    shiftSec.appendChild(Object.assign(document.createElement("p"), { className: "import-note", textContent: "No missions today." }));
  } else {
    const crewAll = totalDayCrew + totalNightCrew || 1;
    shiftSec.insertAdjacentHTML("beforeend", `<div class="ov-daynight-tiles">
      <div class="ov-daynight-tile"><div class="ov-daynight-num"><span class="num">${totalDayCrew}</span><span class="ov-muted">crew</span><span class="ov-shift-chip day">DAY</span></div>
        <div class="ov-daynight-sub">on ${plural(todaysDayCount, "mission", "missions")} · ${Math.round((totalDayCrew / crewAll) * 100)}% of today's crew</div></div>
      <div class="ov-daynight-tile"><div class="ov-daynight-num"><span class="num">${totalNightCrew}</span><span class="ov-muted">crew</span><span class="ov-shift-chip night">NIGHT</span></div>
        <div class="ov-daynight-sub">on ${plural(todaysNightCount, "mission", "missions")} · ${Math.round((totalNightCrew / crewAll) * 100)}% of today's crew</div></div></div>`);
    if (boards.length > 1) {
      const max = Math.max(1, ...boards.map(b => stats[b.id].dayMissions + stats[b.id].nightMissions));
      const rowsWrap = document.createElement("div");
      rowsWrap.className = "ov-daynight-rows";
      for (const b of boards) {
        const s = stats[b.id];
        const row = document.createElement("div");
        row.className = "ov-daynight-row";
        row.innerHTML = `<span class="ov-daynight-row-label"><span class="ov-table-dot" style="background:${boardColor(b)}"></span><span></span></span>
          <div>${Charts.stackedBarH({ segments: [{ label: `${b.name}: day crew`, value: s.dayMissions, color: "var(--chart-assigned)" }, { label: `${b.name}: night crew`, value: s.nightMissions, color: "var(--night)" }], scaleMax: max, height: 14 })}</div>
          <span class="ov-daynight-row-total">Day ${s.dayMissions} · Night ${s.nightMissions} crew</span>`;
        row.querySelector(".ov-daynight-row-label span:last-child").textContent = b.name;
        rowsWrap.appendChild(row);
      }
      shiftSec.appendChild(rowsWrap);
    }
  }

  /* ---------- 8. host coverage: thin hosts, and where their people are today ----------
     A host only one or two people have ever worked (deployment_history, up to
     the date on screen) is only at risk when those people are away — so each
     one is listed with where they are today, read from every board's plan. */
  const hostSec = ovSection("Host coverage", "Today's hosts that only one or two people have ever worked, and where those people are today.");
  {
    const cov = state.overview.hostCoverage || {};
    const empById = new Map(D().employees.map(e => [e.id, e]));
    const where = new Map();   // employee id -> {away, text}
    for (const b of allBoards) {
      const plan = peekPlan(b.id);
      for (const m of plan.missions) if (!m.hidden) for (const id of m.members) where.set(id, { away: false, text: `on mission ${m.number}${m.shift === "night" ? " tonight" : ""}` });
      for (const z of ZONES) for (const id of (plan.zones && plan.zones[z]) || []) where.set(id, { away: true, text: `${(ZONE_LABELS[z] || z).toLowerCase()} today` });
    }
    const statusOf = (id) => {
      if (where.has(id)) return where.get(id);
      const e = empById.get(id);
      if (!e || !onRoster(e)) return { away: true, text: "no longer active" };
      if (isNonWorkingDate(state.date, e.boardId)) return { away: false, text: "day off" };
      return { away: false, text: e.contract === "oncall" ? "on-call, free today" : "free today" };
    };
    const thin = todaysHosts.map(h => ({ host: h, ...(cov[h] || { count: 0, ids: [] }) }))
      .filter(r => r.count >= 1 && r.count <= 2)
      .map(r => ({ ...r, people: (r.ids || []).map(id => ({ id, name: (empById.get(id) || {}).name || "Unknown", ...statusOf(id) })) }))
      .map(r => ({ ...r, away: r.people.filter(p => p.away).length }))
      .sort((a, b) => b.away - a.away || a.count - b.count || a.host.localeCompare(b.host));
    const covered = todaysHosts.map(h => ({ host: h, count: (cov[h] || {}).count || 0 })).filter(r => r.count >= 3).sort((a, b) => a.host.localeCompare(b.host));
    if (!todaysHosts.length) {
      hostSec.appendChild(Object.assign(document.createElement("p"), { className: "import-note", textContent: "No missions today." }));
    }
    for (const r of thin) {
      const el = document.createElement("div");
      el.className = "ov-host" + (r.away ? " risk" : "");
      const avail = r.people.filter(p => !p.away).map(p => p.name);
      const note = r.away
        ? (avail.length ? `If ${avail.join(" and ")} ${avail.length === 1 ? "is" : "are"} off, nobody else on the roster knows this site.` : "Nobody who knows this site is available today.")
        : `Only ${r.count === 1 ? "one person has" : `${r.count} people have`} ever worked this host.`;
      el.innerHTML = `<div class="ov-host-head"><span class="ov-host-name"></span><span class="ov-tag ${r.away ? "bad" : "warn"}">${r.away ? `${r.away} of ${r.count} away today` : "thin"}</span></div>
        <div class="ov-chips">${r.people.map(p => `<span class="ov-person"><span class="ov-table-dot" style="background:${p.away ? "var(--chart-leave)" : "var(--chart-assigned)"}"></span>${escapeHtml(p.name)} <small>${escapeHtml(p.text)}</small></span>`).join("")}</div>
        <p class="ov-host-note">${escapeHtml(note)}</p>`;
      el.querySelector(".ov-host-name").textContent = r.host;
      hostSec.appendChild(el);
    }
    if (todaysHosts.length) {
      const ok = document.createElement("p");
      ok.className = "ov-avail ov-avail-ok";
      ok.textContent = !thin.length
        ? "No thin coverage today — every host on today's missions has 3+ people who've worked it before, or no history yet to worry about."
        : covered.length
          ? (covered.length <= 4
            ? `${covered.map(c => `${c.host} (${c.count} people)`).join(", ").replace(/, ([^,]*)$/, " and $1")} ${covered.length === 1 ? "is" : "are"} well covered.`
            : `The other ${covered.length} hosts have 3+ people who've worked them.`)
          : "";
      if (ok.textContent) hostSec.appendChild(ok);
    }
  }

  // "In detail" — two fixed pairs, in this order: By engineer | By service
  // area, then Shifts | Host coverage (a plain 2-column grid, one column on a
  // narrow screen)
  const detail = [["ov.byEngineer", engSec], ["ov.byArea", areaSec], ["ov.dayNight", shiftSec], ["ov.hostRisk", hostSec]]
    .filter(([area]) => can(area)).map(([, sec]) => sec);
  if (detail.length) {
    panel.appendChild(ovGroupHead("In detail", `${dayLabel} · ${scopeName}`));
    const grid = document.createElement("div");
    grid.className = "ov-detail-grid";
    for (const sec of detail) grid.appendChild(sec);
    panel.appendChild(grid);
  }

  /* ---------- Over time: History + Engineer workload ----------
     Both read one fetch (state.overview.history) over one user-chosen range.
     Built only when shown: refreshData skips the range fetch for a role
     without ov.history. */
  if (can("ov.history")) {
    resolveHistoryRange();   // idempotent; ensureHistoryLoaded skips it when there are no boards
    const histDates = historyDates(boards);
    const histRecs = histDates.map(d => historyDayRec(d, boards, state.overview.history || {}));
    panel.appendChild(ovGroupHead("Over time", `${historyRangeCaption(histDates)}`));
    panel.appendChild(historySection(histDates, histRecs, pendingCharts));
    panel.appendChild(engineerHistorySection(histDates, histRecs));
  }

  // A role with every section switched off would otherwise get a blank tab with
  // no explanation.
  if (!panel.children.length) {
    panel.innerHTML = '<p class="import-note">Your role doesn\'t have access to any of the Overview sections. Ask an admin if you think that\'s wrong.</p>';
    return;
  }
  // Board selector first, above the attention card. Added last so the
  // empty-page check above still sees only real sections; pointless with a
  // single board, where "All boards" and that board are the same thing.
  if (allBoards.length > 1) fillOvBoardSelect(boards);

  // every section is in the document now, so containers have a real width
  for (const fill of pendingCharts) fill();
  Charts.wireChartTooltips(panel);
}

const FILTER_LABELS = { engineer: "Engineer", host: "Host", customer: "Customer", shift: "Shift" };

function filterOptions(key) {
  const plan = getPlan();
  if (key === "engineer") return D().engineers.map(e => ({ value: e.id, label: e.name }));
  if (key === "shift") return [{ value: "day", label: "Day" }, { value: "night", label: "Night" }];
  const vals = [...new Set(plan.missions.filter(m => !m.hidden).map(m => m[key]))].sort();
  return vals.map(v => ({ value: v, label: v }));
}

function msButtonLabel(key) {
  const sel = state.filters[key];
  return `${FILTER_LABELS[key]}: ${sel.length ? sel.length + " selected" : "All"}`;
}
/* same text as msButtonLabel (textContent is unchanged), with the value in its own
   span so "All" can go quiet and a real selection can take the active tint */
function setMsLabel(btn, key) {
  const sel = state.filters[key];
  btn.innerHTML = sel.length
    ? `${FILTER_LABELS[key]}: <span class="ms-val">${sel.length}<span class="ms-all"> selected</span></span>`
    : `${FILTER_LABELS[key]}<span class="ms-val ms-all">: All</span>`;
  btn.classList.toggle("ms-active", sel.length > 0);
}

/* build/refresh the multi-select filter dropdowns */
function renderFilterOptions() {
  for (const ms of $$("#filters .ms")) {
    const key = ms.dataset.filter;
    setMsLabel(ms.querySelector(".ms-btn"), key);
    const pop = ms.querySelector(".ms-pop");
    pop.innerHTML = "";
    const opts = filterOptions(key);

    const clear = document.createElement("div");
    clear.className = "ms-clear";
    clear.textContent = "Clear";
    clear.onclick = () => {
      state.filters[key] = [];
      renderFilterOptions();
      renderMissions();
    };
    pop.appendChild(clear);

    for (const o of opts) {
      const row = document.createElement("label");
      row.className = "ms-opt";
      const checked = state.filters[key].includes(o.value) ? "checked" : "";
      row.innerHTML = `<input type="checkbox" value="${o.value}" ${checked}><span>${o.label}</span>`;
      row.querySelector("input").onchange = (e) => {
        const set = new Set(state.filters[key]);
        e.target.checked ? set.add(o.value) : set.delete(o.value);
        state.filters[key] = [...set];
        setMsLabel(ms.querySelector(".ms-btn"), key);   // keep dropdown open
        updateFilterBadge();
        renderMissions();
      };
      pop.appendChild(row);
    }
  }
  $("#sort-by").value = state.sort;
  updateFilterBadge();
}

/* how many of the four filters are on, shown on the "Filter & sort" button */
function updateFilterBadge() {
  const n = Object.values(state.filters).reduce((a, v) => a + (v && v.length ? 1 : 0), 0);
  const b = $("#filter-count");
  b.textContent = n;
  b.classList.toggle("hidden", !n);
  $("#btn-filter-pop").classList.toggle("ms-active", n > 0);
}

/* ---------- Manpower List tab (all employees, every board, no date scope) ---------- */
const EMPLIST_FILTER_LABELS = { contract: "Contract", position: "Position", service: "Years of service", areaId: "Service area", boardId: "Board", status: "Status" };

/* Years-of-service filter: whole completed years from the start date to today */
const SERVICE_BUCKETS = [
  { value: "lt1", label: "Under 1 year", test: y => y !== null && y < 1 },
  { value: "1to2", label: "1 to under 2 years", test: y => y >= 1 && y < 2 },
  { value: "2to3", label: "2 to under 3 years", test: y => y >= 2 && y < 3 },
  { value: "3plus", label: "3 years or more", test: y => y >= 3 },
  { value: "__none__", label: "— no start date —", test: y => y === null },
];
function serviceBucketOf(e) {
  const p = ManpowerXlsx.serviceParts(e.startDate, todayStr());
  const y = p ? p.years : null;
  return SERVICE_BUCKETS.find(b => b.test(y)).value;
}

function emplistFilterOptions(key) {
  if (key === "contract") return [{ value: "permanent", label: "Permanent" }, { value: "oncall", label: "On-call" }];
  if (key === "position") {
    return [...Object.keys(POSITIONS).map(k => ({ value: k, label: POSITIONS[k].label })), { value: "__none__", label: "— none —" }];
  }
  if (key === "service") return SERVICE_BUCKETS.map(b => ({ value: b.value, label: b.label }));
  if (key === "areaId") return D().areas.map(a => ({ value: a.id, label: a.name }));
  if (key === "boardId") return D().boards.map(b => ({ value: b.id, label: b.name }));
  if (key === "status") return [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }];
  return [];
}
function emplistMsLabel(key) {
  const sel = state.emplist.filters[key];
  return `${EMPLIST_FILTER_LABELS[key]}: ${sel.length ? sel.length + " selected" : "All"}`;
}

/* rebuilds the filter dropdown contents/options — call on tab entry or after data changes,
   not on every checkbox click (that would close the popup mid-interaction) */
function renderEmplistFilterOptions() {
  for (const ms of $$("#emplist-filters .ms")) {
    const key = ms.dataset.filter;
    ms.querySelector(".ms-btn").textContent = emplistMsLabel(key);
    const pop = ms.querySelector(".ms-pop");
    pop.innerHTML = "";
    const clear = document.createElement("div");
    clear.className = "ms-clear";
    clear.textContent = "Clear";
    clear.onclick = () => { state.emplist.filters[key] = []; renderEmplistFilterOptions(); renderEmployeeRows(); };
    pop.appendChild(clear);
    for (const o of emplistFilterOptions(key)) {
      const row = document.createElement("label");
      row.className = "ms-opt";
      const checked = state.emplist.filters[key].includes(o.value) ? "checked" : "";
      row.innerHTML = `<input type="checkbox" value="${o.value}" ${checked}><span>${o.label}</span>`;
      row.querySelector("input").onchange = (e) => {
        const set = new Set(state.emplist.filters[key]);
        e.target.checked ? set.add(o.value) : set.delete(o.value);
        state.emplist.filters[key] = [...set];
        ms.querySelector(".ms-btn").textContent = emplistMsLabel(key);   // keep dropdown open
        renderEmployeeRows();
      };
      pop.appendChild(row);
    }
  }
  // the bulk-edit dropdowns list the same live areas/boards, so keep them in sync too
  $("#emplist-bulk-area").innerHTML = `<option value="">Set service area…</option>` +
    D().areas.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  $("#emplist-bulk-board").innerHTML = `<option value="">Move to board…</option>` +
    D().boards.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
  // how many of the six filters are on, shown on the "Filters" button
  const on = Object.values(state.emplist.filters).filter(v => v && v.length).length;
  $("#emplist-filter-count").textContent = on;
  $("#emplist-filter-count").classList.toggle("hidden", !on);
  $("#btn-emplist-filter-pop").classList.toggle("ms-active", on > 0);
}

/* Manpower List name display: the Thai name (the app's default), the English name, or both.
   An empty English name falls back to the Thai one, so a row is never blank. */
const EMPLIST_NAME_VIEW_KEY = "manpower.emplistNameView";
function emplistNameViewSaved() {
  try { const v = localStorage.getItem(EMPLIST_NAME_VIEW_KEY); return v === "en" ? v : "th"; } catch (e) { return "th"; }
}
function emplistShownName(e) { return state.emplist.nameView === "en" ? (e.nameEn || e.name) : e.name; }
function emplistNameHtml(e) {
  const v = state.emplist.nameView;
  if (v === "both" && e.nameEn && e.nameEn !== e.name) {
    return `${escapeHtml(e.name)}<small class="el-name-en">${escapeHtml(e.nameEn)}</small>`;
  }
  return escapeHtml(emplistShownName(e));
}

function emplistFilteredSorted() {
  const f = state.emplist.filters;
  const q = state.emplist.search.trim().toLowerCase();
  const emps = D().employees.filter(e => {
    if (f.contract.length && !f.contract.includes(e.contract)) return false;
    if (f.position.length && !f.position.includes(e.position || "__none__")) return false;
    if (f.service.length && !f.service.includes(serviceBucketOf(e))) return false;
    if (f.areaId.length && !f.areaId.includes(e.areaId)) return false;
    if (f.boardId.length && !f.boardId.includes(e.boardId)) return false;
    if (f.status.length && !f.status.includes(e.active === false ? "inactive" : "active")) return false;
    const issue = state.emplist.issue;   // a status chip narrowing the list to active people missing one thing
    if (issue && (e.active === false || (issue === "trigo" ? e.trigoId : issue === "en" ? (e.nameEn || "").trim() : D().areas.some(a => a.id === e.areaId)))) return false;
    if (q && !e.name.toLowerCase().includes(q) && !(e.nameEn || "").toLowerCase().includes(q) && !(e.phone || "").toLowerCase().includes(q) && !(e.trigoId || "").toLowerCase().includes(q)) return false;
    return true;
  });
  const { sortKey, sortDir } = state.emplist;
  const sortVal = (e) => {
    switch (sortKey) {
      case "contract": return e.contract === "oncall" ? "On-call" : "Permanent";
      case "position": return e.position ? POSITIONS[e.position].label : "";
      case "phone": return e.phone || "";
      case "trigoId": return e.trigoId ? "T" + e.trigoId.slice(1).padStart(6, "0") : "";   // T9 sorts before T10; people with none sort first
      case "startDate": return e.startDate || "";   // ISO text sorts in date order; people with none sort first
      case "areaId": return D().areas.find(a => a.id === e.areaId)?.name || "";
      case "boardId": return D().boards.find(b => b.id === e.boardId)?.name || "";
      case "active": return e.active === false ? "Inactive" : "Active";
      default: return emplistShownName(e);
    }
  };
  // utilization is the one numeric column — "100" vs "9" sorts wrong as text.
  // Unknown/no-working-days sorts to the bottom either way rather than as 0%,
  // which would read as "never deployed" and isn't the same claim.
  // ascending = shortest service first (latest start date); people with no start date stay at the bottom either way
  if (sortKey === "service") {
    emps.sort((a, b) => {
      const x = a.startDate || "", y = b.startDate || "";
      if (!x || !y) return ((x ? 0 : 1) - (y ? 0 : 1)) || a.name.localeCompare(b.name);
      return -x.localeCompare(y) * sortDir || a.name.localeCompare(b.name);
    });
    return emps;
  }
  if (sortKey === "util") {
    const u = (e) => {
      const v = state.emplist.util ? state.emplist.util[e.id] : undefined;
      return (v === undefined || v === null) ? -1 : v;
    };
    emps.sort((a, b) => (u(a) - u(b)) * sortDir || a.name.localeCompare(b.name));
    return emps;
  }
  emps.sort((a, b) => sortVal(a).localeCompare(sortVal(b)) * sortDir || a.name.localeCompare(b.name));
  return emps;
}

/* 30D utilization cell: a meter, not a bar chart — it's one ratio against a
   fixed 0–100 limit, so the track carries the scale and the number is always
   printed beside it (never encoded by width alone). `undefined` = still
   loading, `null` = no working days in the window to divide by. */
function utilCell(pct) {
  if (pct === undefined) return `<span class="el-util-empty">…</span>`;
  if (pct === null) return `<span class="el-util-empty" title="No working days for this board in the last 30 days">—</span>`;
  return `<span class="el-util-meter"><span class="el-util-fill" style="width:${Math.min(100, pct)}%"></span></span>`
    + `<b class="el-util-val">${pct}%</b>`;
}

/* The Manpower List as an Excel file: the rows the table is showing right now
   (same search, filters and sort as the table), English or Thai. The sheet itself
   is built by xlsx-export.js; ExcelJS is fetched on first use, like the board export. */
function emplistXlsxRows() {
  return emplistFilteredSorted().map(e => {
    const area = D().areas.find(a => a.id === e.areaId);
    const board = D().boards.find(b => b.id === e.boardId);
    const pos = e.position ? POSITIONS[e.position] : null;
    return {
      name: e.name, nameEn: e.nameEn || "", trigoId: e.trigoId || "", contract: e.contract === "oncall" ? "On-call" : "Permanent", position: pos ? pos.label : "",
      phone: e.phone || "", startDate: e.startDate || "", area: area ? area.name : "", board: board ? board.name : "",
      util: state.emplist.util ? state.emplist.util[e.id] : undefined, active: e.active !== false,
    };
  });
}
function openEmplistXlsxModal() {
  const n = emplistFilteredSorted().length;
  if (!n) { toast("No employees match the current filters, so there is nothing to export.", "info"); return; }
  $("#emplist-xlsx-summary").textContent = `${n} ${n === 1 ? "employee" : "employees"} — the rows the table is showing now (search and filters apply).`;
  setXlsxLangRadios("emplist-xlsx-lang", xlsxSavedLang());
  renderExportTypes($("#emplist-export-type"), "manpower", ["xlsx"]);
  openModal("#modal-emplist-xlsx");
}
async function exportEmplistXlsx() {
  const btn = $("#btn-emplist-xlsx-go");
  btn.disabled = true;
  btn.textContent = "Exporting…";
  try {
    const lang = takeXlsxLang("emplist-xlsx-lang");
    const rows = emplistXlsxRows();   // read again: the list may have changed while the dialog was open
    const ExcelJS = await loadExcelJS();
    const { workbook } = await ManpowerXlsx.buildListWorkbook(ExcelJS, { rows, lang, today: todayStr() });
    const buf = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const name = `manpower_list_${todayStr()}${lang === "th" ? "_TH" : ""}.xlsx`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    closeModal();
    toast(`Exported ${rows.length} ${rows.length === 1 ? "employee" : "employees"} to ${name}.`, "info");
  } catch (e) {
    toast("Excel export failed: " + (e.message || e), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Export";
  }
}

/* ---------- Bulk edit by file (Manpower List and Host List) ----------
   Download a template of the current rows, change many of them in a
   spreadsheet, upload it back. The file is read and PLANNED here (bulk-edit.js
   matches every row to a record, checks every cell, and works out the
   from -> to diff); nothing is written until the person has read the preview
   and pressed Apply. cloud.applyEmployeeImport / applyHostImport do the writing. */
const bulk = { kind: null, table: null, plan: null, fileName: "", result: null };
const bulkIsEmp = () => bulk.kind === "employees";

function bulkHostRows() {
  return allHostRows().map(r => ({
    name: r.name, location: r.location, mapUrl: r.mapUrl, note: r.note,
    areaId: r.area ? r.area.id : "", archived: r.archived, hasRecord: r.hasRecord,
  }));
}
const bulkCtx = (kind, rows) => kind === "employees"
  ? { employees: rows, areas: D().areas, boards: D().boards, positions: POSITIONS }
  : { hosts: rows, areas: D().areas, similarKey: hostDupKey };
/* the rows a template/backup holds: the list as it is shown (template) or everything (backup) */
function bulkTemplateRows(kind, all) {
  if (kind === "employees") return all ? [...D().employees].sort((a, b) => a.name.localeCompare(b.name)) : emplistFilteredSorted();
  const hostsAll = bulkHostRows();
  if (all) return hostsAll;
  const shown = new Set(hostlistFilteredSorted().map(r => r.name));
  return hostsAll.filter(h => shown.has(h.name));
}
function bulkSaveBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function bulkWriteFile(kind, all, name) {
  const ctx = bulkCtx(kind, bulkTemplateRows(kind, all));
  const ExcelJS = await loadExcelJS();
  const wb = await BulkEdit.buildTemplateWorkbook(ExcelJS, kind, ctx);
  const buf = await wb.xlsx.writeBuffer();
  bulkSaveBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name + ".xlsx");
}

function openBulkModal(kind) {
  const area = kind === "employees" ? "emplist" : "hostlist";
  if (!can(area, "edit")) { toast("Your role can view this list but not change it.", "info"); return; }
  Object.assign(bulk, { kind, table: null, plan: null, fileName: "", result: null });
  const emp = kind === "employees";
  $("#bulk-title").textContent = emp ? "Bulk edit employees" : "Bulk edit hosts";
  $("#bulk-intro").textContent = emp
    ? "Change many employees at once in a spreadsheet. Download the template (it holds everyone's current details), edit it, save it and upload it back. Rename people, change contract, position, phone, dates, service area, board or status, or add new people on the empty rows."
    : "Change many hosts at once in a spreadsheet: Location, Google Maps link, Service area, Note and Status. Download the template, edit it and upload it back. A host's name is its key — renaming or merging hosts is still done from the Host List.";
  const n = bulkTemplateRows(kind, false).length;
  $("#bulk-dl-note").textContent = `${n} ${emp ? (n === 1 ? "employee" : "employees") : (n === 1 ? "host" : "hosts")} — the rows the list is showing now. Clear the search and filters first to include everyone. The Excel file has dropdowns, real dates and keeps Thai text intact.`;
  $("#bulk-file").value = "";
  $("#bulk-preview").classList.add("hidden");
  $("#bulk-preview").innerHTML = "";
  $("#btn-bulk-apply").disabled = true;
  $("#btn-bulk-apply").textContent = "Apply changes";
  $("#bulk-backup-row").classList.remove("hidden");
  openModal("#modal-bulk");
}

async function bulkDownload() {
  const emp = bulkIsEmp();
  await bulkWriteFile(bulk.kind, false, `${emp ? "manpower_edit" : "host_edit"}_${todayStr()}`);
  toast("Template downloaded. Edit it, save it, then upload it in step 2.", "info");
}

/* a file -> rows of cells: the edited Excel template, read with ExcelJS. Only .xlsx is
   accepted (a CSV would lose leading zeros, dates and Thai text on its way through Excel). */
async function bulkReadFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls")) throw new Error("Old .xls files are not supported — open it in Excel and Save As .xlsx.");
  if (!name.endsWith(".xlsx")) throw new Error("Upload the edited Excel file (.xlsx). CSV files are not accepted.");
  if (file.size > 5 * 1024 * 1024) throw new Error("That file is larger than 5 MB.");
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  return BulkEdit.rowsFromWorkbook(wb, bulk.kind);
}
function bulkMakePlan() {
  return bulkIsEmp()
    ? BulkEdit.planEmployees(bulk.table, bulkCtx("employees", D().employees))
    : BulkEdit.planHosts(bulk.table, bulkCtx("hosts", bulkHostRows()));
}
/* what a plan would write, as text — to notice that the data moved under an open dialog */
const bulkSig = (plan) => JSON.stringify(plan.rows.map(r => [r.rowNumber, r.kind, r.patch, r.create]));

async function onBulkFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  try {
    const rows2d = await bulkReadFile(file);
    bulk.table = BulkEdit.readTable(rows2d, bulkIsEmp() ? BulkEdit.EMP_COLUMNS : BulkEdit.HOST_COLUMNS);
    bulk.plan = bulkMakePlan();
    bulk.fileName = file.name;
    bulk.result = null;
    renderBulkPreview();
  } catch (e) {
    bulk.table = bulk.plan = null;
    $("#bulk-preview").classList.add("hidden");
    $("#btn-bulk-apply").disabled = true;
    toast("Could not read that file: " + (e.message || e), "error");
  }
}

const bulkNone = (v) => (v === "" || v == null ? "<i>(empty)</i>" : escapeHtml(v));
function bulkCreateSummary(r) {
  const c = r.create;
  if (bulkIsEmp()) {
    const board = D().boards.find(b => b.id === c.boardId), area = D().areas.find(a => a.id === c.areaId);
    return [c.contract === "oncall" ? "On-call" : "Permanent", board ? board.name : "", area ? area.name : "", c.position && POSITIONS[c.position] ? POSITIONS[c.position].label : "", c.active === false ? "Inactive" : ""].filter(Boolean).join(" · ");
  }
  return [c.location, c.mapUrl, c.note].filter(Boolean).join(" · ");
}
function bulkApplyCount() {
  const n = bulk.plan ? bulk.plan.counts : null;
  if (!n) return 0;
  const box = $("#bulk-create");
  return n.update + (box && box.checked ? n.create : 0);
}
function bulkRefreshApplyButton() {
  const n = bulkApplyCount();
  const btn = $("#btn-bulk-apply");
  btn.disabled = n === 0 || !!bulk.result;
  btn.textContent = n ? `Apply ${n} ${n === 1 ? "change" : "changes"}` : "Apply changes";
}
function renderBulkPreview() {
  const el = $("#bulk-preview");
  el.classList.remove("hidden");
  const plan = bulk.plan, n = plan.counts, emp = bulkIsEmp();
  const noun = emp ? ["person", "people"] : ["host", "hosts"];
  if (plan.fatal.length) {
    el.innerHTML = `<div class="bulk-fatal"><b>This file can't be used.</b><ul>${plan.fatal.map(f => `<li>${escapeHtml(f)}</li>`).join("")}</ul></div>`;
    bulkRefreshApplyButton();
    return;
  }
  const chip = (label, v, color) => `<span class="stat-chip"><span class="dot" style="background:${color}"></span>${label}: <b>${v}</b></span>`;
  let html = `<div class="bulk-chips">${chip("To update", n.update, "var(--chart-assigned)")}${chip(emp ? "New people" : "New hosts", n.create, "var(--ok-text)")}${chip("Unchanged", n.same, "#c3ccd6")}${chip("Problems", n.error, "var(--warn)")}</div>`;
  const extra = [];
  if (emp && n.moves) extra.push(`${n.moves} ${n.moves === 1 ? "person changes" : "people change"} board — their assignment on ${escapeHtml(fmtDate(state.date))} is cleared`);
  if (emp && (n.noTrigoId || n.shortName)) {
    // the clean-up worklist: after this upload, who in the file still lacks a TRIGO ID or a full name
    const bits = [];
    if (n.noTrigoId) bits.push(`${n.noTrigoId} still ${n.noTrigoId === 1 ? "has" : "have"} no TRIGO ID`);
    if (n.shortName) bits.push(`${n.shortName} ${n.shortName === 1 ? "name is" : "names are"} not a full name yet`);
    extra.push(bits.join(" · "));
  }
  if (emp && n.deactivate) extra.push(`${n.deactivate} will be set Inactive`);
  if (emp && n.reactivate) extra.push(`${n.reactivate} will be set Active again`);
  if (n.clears) extra.push(`${n.clears} filled-in ${n.clears === 1 ? "value is" : "values are"} being cleared`);
  if (plan.ignored.length) extra.push(`Ignored columns: ${plan.ignored.map(escapeHtml).join(", ")}`);
  extra.push(`${n.total} data ${n.total === 1 ? "row" : "rows"} read from ${escapeHtml(bulk.fileName)}. People missing from the file are left alone.`);
  html += `<div class="bulk-extra">${extra.join(" · ")}</div>`;

  const bad = plan.rows.filter(r => r.kind === "error");
  if (bad.length) {
    html += `<div class="bulk-problems"><b>${bad.length} ${bad.length === 1 ? "row has a problem and is" : "rows have problems and are"} skipped.</b> Fix them in the file and upload again — only what still differs will change.<ul>` +
      bad.slice(0, 50).map(r => `<li>Row ${r.rowNumber}${r.name ? " · " + escapeHtml(r.name) : ""}: ${r.errors.map(escapeHtml).join("; ")}</li>`).join("") +
      (bad.length > 50 ? `<li>…and ${bad.length - 50} more</li>` : "") + "</ul></div>";
  }
  if (n.create) {
    html += `<label class="bulk-create"><input type="checkbox" id="bulk-create"> Also add ${n.create} new ${n.create === 1 ? noun[0] : noun[1]}` +
      (emp ? " (rows with a name that isn't on the list yet — if one is a misspelt existing name, fix it in the file instead)" : " (names not in the Host List yet — a renamed host would show up here, so check for typos)") + "</label>";
  }
  const shown = plan.rows.filter(r => r.kind === "update" || r.kind === "create");
  if (shown.length) {
    html += `<table class="bulk-table"><thead><tr><th>Row</th><th>${emp ? "Employee" : "Host"}</th><th>What changes</th></tr></thead><tbody>` +
      shown.slice(0, 200).map(r => {
        const what = r.kind === "create"
          ? `<span class="bulk-new">NEW</span>${escapeHtml(bulkCreateSummary(r))}`
          : r.changes.map(c => `<span class="bulk-chg">${escapeHtml(c.label)}: <span class="bulk-from">${bulkNone(c.from)}</span> → <b>${bulkNone(c.to)}</b></span>`).join("");
        const warn = r.warnings.map(w => `<span class="bulk-warn">⚠ ${escapeHtml(w)}</span>`).join("");
        return `<tr data-kind="${r.kind}"><td class="bulk-row">${r.rowNumber}</td><td>${escapeHtml(r.name)}</td><td>${what}${warn}</td></tr>`;
      }).join("") + `</tbody></table>` +
      (shown.length > 200 ? `<p class="import-note">…and ${shown.length - 200} more rows (all of them are applied).</p>` : "");
  } else if (!n.error) {
    html += `<p class="import-note">Nothing to change — the file matches what the app already has.</p>`;
  }
  el.innerHTML = html;
  const box = $("#bulk-create");
  if (box) box.onchange = bulkRefreshApplyButton;
  bulkRefreshApplyButton();
}

async function applyBulk() {
  const kind = bulk.kind, area = kind === "employees" ? "emplist" : "hostlist";
  if (!bulk.plan || !can(area, "edit")) return;
  const btn = $("#btn-bulk-apply");
  btn.disabled = true;
  try {
    // somebody else may have edited the list while this dialog was open: plan again
    // against the data as it is now, and make the person look again if it differs
    const fresh = bulkMakePlan();
    if (bulkSig(fresh) !== bulkSig(bulk.plan)) {
      const wasChecked = !!($("#bulk-create") && $("#bulk-create").checked);
      bulk.plan = fresh;
      renderBulkPreview();
      const box = $("#bulk-create");
      if (box) { box.checked = wasChecked; bulkRefreshApplyButton(); }
      toast("The list changed while this window was open. Review the updated changes, then apply again.", "warn");
      return;
    }
    const createNew = !!($("#bulk-create") && $("#bulk-create").checked);
    btn.textContent = "Applying…";
    if ($("#bulk-backup").checked) {
      const t = new Date();
      const stamp = todayStr() + "_" + String(t.getHours()).padStart(2, "0") + String(t.getMinutes()).padStart(2, "0");
      await bulkWriteFile(kind, true, `${kind === "employees" ? "manpower" : "host"}_backup_before_import_${stamp}`);
    }
    const res = kind === "employees"
      ? await cloud.applyEmployeeImport(bulk.plan, { moveDate: state.date, createNew })
      : await cloud.applyHostImport(bulk.plan, { createNew });
    bulk.result = res;
    await refreshAndRender();
    const done = `Updated ${res.updated}${res.created ? `, added ${res.created}` : ""}.`;
    if (res.failed.length) {
      $("#bulk-preview").innerHTML = `<div class="bulk-problems"><b>${done} ${res.failed.length} could not be saved:</b><ul>` +
        res.failed.slice(0, 50).map(f => `<li>Row ${f.rowNumber} · ${escapeHtml(f.name)}: ${escapeHtml(f.message)}</li>`).join("") +
        `</ul>Upload the same file again to retry just those — everything already saved will show as unchanged.</div>`;
      toast(`${done} ${res.failed.length} failed — see the list.`, "warn");
      btn.textContent = "Done";
    } else {
      closeModal();
      toast(done, "info");
    }
  } finally {
    if (!bulk.result) bulkRefreshApplyButton();
  }
}

function updateEmplistBulkBar() {
  const bar = $("#emplist-bulkbar");
  if (!bar) return;
  const n = state.selectedEmps.size;
  // every action on this bar is a write, so it has nothing to offer a role that
  // can only read the roster
  bar.classList.toggle("hidden", n === 0 || !can("emplist", "edit"));
  $("#emplist-bulk-count").textContent = n === 1 ? "1 selected" : `${n} selected`;
}

/* redraws just the table body + counts + bulk bar — cheap enough to call on every
   search keystroke, filter tick, sort click, or checkbox toggle */
function renderEmployeeRows() {
  const emps = emplistFilteredSorted();
  const body = $("#emplist-body");
  body.innerHTML = "";
  for (const e of emps) {
    const area = D().areas.find(a => a.id === e.areaId);
    const board = D().boards.find(b => b.id === e.boardId);
    const pos = e.position ? POSITIONS[e.position] : null;
    const isActive = e.active !== false;   // undefined (pre-migration) counts as active
    const util = state.emplist.util ? state.emplist.util[e.id] : undefined;
    const tr = document.createElement("tr");
    tr.dataset.empId = e.id;
    if (state.selectedEmps.has(e.id)) tr.classList.add("selected");
    // data-label feeds the phone breakpoint's ::before (styles.css) — below
    // 640px each <tr> becomes a card and each <td> grows its column header as
    // an inline label, so the same markup works as a table on desktop and a
    // card list on phone with no separate render path
    tr.innerHTML = `
      <td class="el-check"><input type="checkbox" ${state.selectedEmps.has(e.id) ? "checked" : ""}></td>
      <td data-label="Name" class="el-name">${emplistNameHtml(e)}</td>
      <td data-label="TRIGO ID" class="el-tid">${e.trigoId ? escapeHtml(e.trigoId) : "—"}</td>
      <td data-label="Contract type">${e.contract === "oncall" ? "On-call" : "Permanent"}</td>
      <td data-label="Position">${pos ? pos.label : "—"}</td>
      <td data-label="Mobile number">${e.phone ? telLink(e.phone) : "—"}</td>
      <td data-label="Start date">${e.startDate ? fmtDate(e.startDate) : "—"}</td>
      <td data-label="Years of service">${e.startDate ? escapeHtml(ManpowerXlsx.serviceLength(e.startDate, todayStr())) || "—" : "—"}</td>
      <td data-label="Service area">${area ? `<span class="area-pill" style="background:${escapeHtml(area.color)};color:${inkOn(area.color)}">${escapeHtml(area.name)}</span>` : "—"}</td>
      <td data-label="Current board">${board ? escapeHtml(board.name) : "—"}</td>
      <td data-label="30D utilization" class="el-util">${utilCell(util)}</td>
      <td data-label="Status" class="el-status">
        <label class="toggle toggle-active">
          <input type="checkbox" ${isActive ? "checked" : ""} ${can("emplist", "edit") ? "" : "disabled"}>
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
          <span class="toggle-text">${isActive ? "Active" : "Inactive"}</span>
        </label>
      </td>`;
    tr.classList.toggle("row-inactive", !isActive);
    // No confirm: unlike the menu's Deactivate this is one click to undo. No guardEdit
    // either — the roster is employee master data, not the day's plan (the
    // existing bulk actions in this table take the same line).
    tr.querySelector(".el-status input").onchange = (ev) => {
      const on = ev.target.checked;
      safely(async () => {
        await cloud.setEmployeesActive([e.id], on);
        await refreshAndRender();
        toast(on
          ? `${e.name} is active again — back on today's and future boards.`
          : `${e.name} deactivated — hidden from today's and future boards. Past dates keep them.`, "info");
      });
    };
    tr.querySelector(".el-check input").onchange = (ev) => {
      ev.target.checked ? state.selectedEmps.add(e.id) : state.selectedEmps.delete(e.id);
      tr.classList.toggle("selected", ev.target.checked);
      updateEmplistBulkBar();
      $("#emplist-select-all").checked = emps.length > 0 && emps.every(x => state.selectedEmps.has(x.id));
    };
    tr.addEventListener("dblclick", () => guardEdit(() => openEmployeeModal(e.id)));
    tr.addEventListener("contextmenu", (ev) => { ev.preventDefault(); openEmpMenu(e, ev.clientX, ev.clientY); });
    attachLongPress(tr, (x, y) => openEmpMenu(e, x, y));
    body.appendChild(tr);
  }
  // surface the inactive tally — otherwise deactivated people are invisible in
  // a long list and there's no hint the Status column has anything to find
  const inactiveN = emps.filter(e => e.active === false).length;
  $("#emplist-count").textContent = `${emps.length} of ${D().employees.length}`
    + (inactiveN ? ` · ${inactiveN} inactive` : "");
  $("#emplist-select-all").checked = emps.length > 0 && emps.every(e => state.selectedEmps.has(e.id));
  updateEmplistBulkBar();
  for (const th of $$("#emplist-table th[data-sort]")) {
    th.classList.toggle("sorted-asc", th.dataset.sort === state.emplist.sortKey && state.emplist.sortDir === 1);
    th.classList.toggle("sorted-desc", th.dataset.sort === state.emplist.sortKey && state.emplist.sortDir === -1);
  }
  quietTable("#emplist-table");
}

/* The Manpower and Host tables read quietly: a column in which every row is empty (or "—")
   is left out, and a lone "—" is drawn blank, so what is on screen is only what carries
   information. Each table's service-area pill also hands its colour to CSS as --ac, which
   draws it as a small colour key beside plain text. Re-run after every row render; the
   header cells are static, so their marks are reset first. */
/* empty for this purpose: nothing but the hover-only "add note" invitation or an "none" marker */
function quietCellEmpty(td) {
  let t = td.textContent.replace("\u2014", "");
  for (const x of td.querySelectorAll(".hl-add-note, .hl-empty")) t = t.replace(x.textContent, "");
  return t.trim() === "";
}
function quietTable(sel) {
  const table = $(sel);
  const ths = [...table.querySelectorAll("thead th")];
  const rows = [...table.querySelectorAll("tbody tr")].filter(r => r.children.length === ths.length);
  ths.forEach(th => th.classList.remove("col-off"));
  for (const r of rows) {
    for (const td of r.children) {
      td.classList.remove("col-off");
      td.classList.toggle("q-dash", !td.children.length && td.textContent.trim() === "\u2014");   // drawn blank, still there for tools and tests
    }
    for (const pill of r.querySelectorAll(".area-pill")) pill.style.setProperty("--ac", pill.style.backgroundColor || "#999");
  }
  if (!rows.length) return;
  ths.forEach((th, i) => {
    if (th.classList.contains("el-check")) return;
    if (!rows.every(r => quietCellEmpty(r.children[i]))) return;
    th.classList.add("col-off");
    for (const r of rows) r.children[i].classList.add("col-off");
  });
}

/* full (re)build on tab entry: filter dropdown options + search box + rows */
function renderEmployeeList() {
  $("#emplist-search").value = state.emplist.search;
  state.emplist.nameView = emplistNameViewSaved();
  $("#emplist-name-view").value = state.emplist.nameView;
  syncSegmented();
  renderEmplistFilterOptions();
  renderEmployeeRows();
}

/* ---------- Host List tab (every host, every board, no date scope) ----------
   The Manpower List's counterpart for sites instead of people. A "host" has
   never been a record in this app — it's free text on a mission — so a row
   here is assembled rather than read: mission rows say which boards a host
   appears on, deployment_history says who has worked there and for how many
   days (see cloud.getHostDirectory), and the `hosts` table adds the one thing
   only a person can supply, its location. That ordering matters: a host with
   no location record still gets a row, because the board already knows the
   name. */
const HOSTLIST_FILTER_LABELS = { areaId: "Service area", boardId: "Board", empId: "Inspector", location: "Location", status: "Status" };
/* how many inspector chips a row shows before collapsing behind "+N more" —
   enough to answer "who knows this site" without one busy host stretching the
   table to a screen per row */
const HOSTLIST_INSPECTOR_CAP = 8;
/* which one-time database update a host field needs, for the message shown
   when a save had to drop it (see cloud.saveHost's `skipped`) */
const HOST_COLUMN_MIGRATIONS = {
  area_id: "its service area needs a one-time database update (migration-2026-09-03-host-service-area.sql)",
  archived: "archiving needs a one-time database update (migration-2026-09-04-host-archive.sql)",
};

/* The host master records double as the app's list of hosts: the New Mission
   form only accepts a host that has one (see missionHostMatch), and a mission
   card reads its host's service area through here. Matched case-insensitively
   on a trimmed name — "fortune" and "Fortune " are the same site to a person
   typing in a hurry, and the record's own spelling is the canonical one. */
function hostRecordOf(name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return null;
  return D().hosts.find(h => h.name.trim().toLowerCase() === key) || null;
}
function hostAreaOf(name) {
  const rec = hostRecordOf(name);
  return rec && rec.areaId ? D().areas.find(a => a.id === rec.areaId) || null : null;
}
/* the area pill markup shared by the Host List column and the mission card —
   same shape and ink rule as the pill on every employee card */
function areaPillHtml(area, cls) {
  if (!area) return "";
  return `<span class="${cls}" style="background:${escapeHtml(area.color)};color:${inkOn(area.color)}">`
    + `${escapeHtml(area.name)}</span>`;
}

/* Only ever build an href from a link we've confirmed is http(s): the field is
   free text, and `javascript:` in an href is a script that runs on click. */
function safeHttpUrl(u) {
  const s = String(u || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

/* Where a host's map link comes from, in preference order:
   1. the map_url a planner pasted into the Host record — always wins, because
      somebody chose that exact pin;
   2. failing that, a Maps SEARCH built from the host's written address. Without
      this, only hosts whose record has a pasted URL would be reachable, and the
      Host List is mostly addresses — the tap-to-navigate the board is being
      redesigned around would simply not appear for most sites.
   A host with neither is not a link, and gets no pin: a pin that opens nothing
   is worse than no pin at all. */
function hostMapHref(rec) {
  if (!rec) return "";
  const pasted = safeHttpUrl(rec.mapUrl);
  if (pasted) return pasted;
  const addr = String(rec.location || "").trim();
  return addr
    ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(addr)
    : "";
}

/* The host name on a mission card, as the map link itself — name followed by a
   pin, the two together one tap target. The address used to sit on its own line
   below; folding it into the name costs a line of card height on every mission,
   which is what decides how much of a board fits in one exported page.

   Four details that are not free choices:
   - the pin renders ONLY when there is a link behind it (see hostMapHref), so
     it always means "this opens a map".
   - escapeHtml on the href, not just the text. safeHttpUrl only vouches for the
     scheme, and the rest of that field is free text a planner typed — a bare
     quote in it would otherwise close the attribute.
   - stopPropagation, exactly as telLink does: this sits inside .mission-header,
     whose click handler opens the edit modal. Without it, tapping the host name
     on a phone opens the mission editor instead of the map.
   - a real <a>, not a click handler. It has to survive being printed: Chrome
     writes <a href> out as a PDF link annotation, so the host name stays
     tappable inside the file that gets posted to the LINE group. That is the
     whole point of the PDF path (printBoard) — an image can never carry a link.

   The name is kept in its own span so .m-host-name kicks in and a long host
   ellipsises there, leaving the pin (flex:none) visible rather than being the
   first thing clipped off the end. */
function hostNameHtml(name, rec) {
  const href = hostMapHref(rec);
  if (!href) return `<span class="m-host">${escapeHtml(name)}</span>`;
  return `<a class="m-host m-host-link" href="${escapeHtml(href)}"`
    + ` target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()"`
    + ` title="Open ${escapeHtml(name)} in Google Maps">`
    + `<span class="m-host-name">${escapeHtml(name)}</span>`
    + `<span class="m-host-pin">${icon("pin")}</span></a>`;
}

/* One row per host, merging the fetched directory with the host master records
   (which carry the location) — either source alone is enough to list a host. */
function allHostRows() {
  const dir = state.hostlist.dir || {};
  const recByName = new Map(D().hosts.map(h => [h.name, h]));
  const empName = new Map(D().employees.map(e => [e.id, e.name]));
  const boardName = new Map(D().boards.map(b => [b.id, b.name]));
  const names = new Set([...Object.keys(dir), ...recByName.keys()]);
  const rows = [];
  for (const name of names) {
    const d = dir[name] || { boards: {}, employees: {}, missionCount: 0, firstDate: null, lastDate: null };
    const rec = recByName.get(name) || null;
    const area = rec && rec.areaId ? D().areas.find(a => a.id === rec.areaId) || null : null;
    // most days first: "who knows this site best" is the question the column answers
    const inspectors = Object.entries(d.employees)
      .map(([id, days]) => ({ id, name: empName.get(id) || "", days }))
      .filter(i => i.name)
      .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
    // a board deleted since the mission was planned can't be named — skip it
    // rather than render a blank pill
    const boards = Object.entries(d.boards)
      .map(([id, missions]) => ({ id, name: boardName.get(id) || "", missions }))
      .filter(b => b.name)
      .sort((a, b) => b.missions - a.missions || a.name.localeCompare(b.name));
    rows.push({
      name,
      location: rec ? rec.location : "",
      mapUrl: rec ? rec.mapUrl : "",
      note: rec ? rec.note : "",
      area,
      archived: !!(rec && rec.archived),
      hasRecord: !!rec,
      inspectors,
      boards,
      missionCount: d.missionCount,
      deployedDays: inspectors.reduce((n, i) => n + i.days, 0),
      firstDate: d.firstDate,
      lastDate: d.lastDate,
    });
  }
  return rows;
}

/* ---------- duplicate detection ----------
   Two names are "the same host, typed twice" in two ways, and the finder only
   claims the ones it can claim safely:

   1. They normalise to the same string — case, spaces and punctuation removed.
      "FORTUNE", "Fortune " and "Fortune-Co" vs "Fortune Co". No judgement call
      here, these are always the same site.
   2. They are one edit apart — an inserted, dropped, swapped or mistyped
      character ("Frotune" / "Fortune"). This one CAN be wrong, which is why
      any pair whose digits differ is excluded: "Plant 1" and "Plant 2" are one
      edit apart and are emphatically not duplicates. Short names are skipped
      for the same reason — at four characters an edit is more likely to be a
      different site than a typo.

   The result is a suggestion the planner reviews and merges by hand, never an
   automatic merge. */
const hostDupKey = (name) => String(name || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const hostDigits = (name) => (String(name || "").match(/\d/g) || []).join("");
const DUP_FUZZY_MIN_LEN = 5;

/* One edit apart: a substitution, an inserted or dropped character, OR two
   adjacent characters swapped. The swap is the case that matters most — the
   commonest typo of all is "Frotune" for "Fortune", and plain edit distance
   scores that 2, which is exactly how it slipped past the first version of
   this finder. */
function oneEditApart(a, b) {
  if (a === b) return false;
  const d = a.length - b.length;
  if (d > 1 || d < -1) return false;
  if (d === 0) {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    if (a.slice(i + 1) === b.slice(i + 1)) return true;                     // substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);   // swap
  }
  const [long, short] = d === 1 ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && long[i] === short[i]) i++;
  return long.slice(i + 1) === short.slice(i);                              // insert / delete
}

/* Groups of host names that look like each other, returned with a name→group
   index so a row can ask "am I in a group, and which one" in constant time.

   Built as clusters over the NORMALISED names, not over the rows: normalising
   ("FORTUNE", "Fortune ", "Fortune-Co") already collapses the certain cases,
   and the fuzzy pass then links whole clusters rather than individual rows —
   otherwise a typo can never be matched against a name that already has an
   exact duplicate of its own, which is precisely the messy case this exists
   for. Cached against the list of names, because the pairwise pass runs on
   every redraw, including every search keystroke. */
let _dupCache = { key: null, value: null };
function hostDuplicateGroups(rows) {
  const cacheKey = rows.map(r => r.name).join(" ");
  if (_dupCache.key === cacheKey) return _dupCache.value;

  const byNorm = new Map();
  for (const r of rows) {
    const k = hostDupKey(r.name);
    if (!k) continue;
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(r);
  }
  const keys = [...byNorm.keys()];
  // union-find over the normalised keys: a chain of near-misses ends up as one
  // group rather than three overlapping pairs
  const parent = keys.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].length < DUP_FUZZY_MIN_LEN) continue;
    for (let j = i + 1; j < keys.length; j++) {
      if (keys[j].length < DUP_FUZZY_MIN_LEN) continue;
      // "Plant 1" and "Plant 2" are one edit apart and are not duplicates —
      // a differing number is a different site, every time
      if (hostDigits(keys[i]) !== hostDigits(keys[j])) continue;
      if (oneEditApart(keys[i], keys[j])) union(i, j);
    }
  }
  const clusters = new Map();
  keys.forEach((k, i) => {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(...byNorm.get(k));
  });
  const groups = [...clusters.values()].filter(members => members.length > 1);
  const byName = new Map();
  groups.forEach((members, gi) => { for (const m of members) byName.set(m.name, gi); });

  const value = { groups, byName };
  _dupCache = { key: cacheKey, value };
  return value;
}

function hostlistFilterOptions(key) {
  if (key === "areaId") {
    return [...D().areas.map(a => ({ value: a.id, label: a.name })), { value: "__none__", label: "— none —" }];
  }
  if (key === "boardId") return D().boards.map(b => ({ value: b.id, label: b.name }));
  if (key === "location") {
    return [{ value: "has", label: "Has location" }, { value: "missing", label: "No location yet" }];
  }
  if (key === "status") {
    return [{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }];
  }
  if (key === "empId") {
    // only people who actually have a deployment somewhere — a filter listing
    // the whole roster would mostly be entries that match nothing
    const dir = state.hostlist.dir;
    const seen = new Set();
    if (dir) for (const rec of Object.values(dir)) for (const id of Object.keys(rec.employees)) seen.add(id);
    return D().employees
      .filter(e => (dir ? seen.has(e.id) : true))
      .map(e => ({ value: e.id, label: e.name }));
  }
  return [];
}
function hostlistMsLabel(key) {
  const sel = state.hostlist.filters[key];
  return `${HOSTLIST_FILTER_LABELS[key]}: ${sel.length ? sel.length + " selected" : "All"}`;
}

/* same contract as renderEmplistFilterOptions: rebuild on tab entry / data
   change, never on a checkbox tick (that would close the popup mid-use) */
function renderHostlistFilterOptions() {
  for (const ms of $$("#hostlist-filters .ms")) {
    const key = ms.dataset.filter;
    ms.querySelector(".ms-btn").textContent = hostlistMsLabel(key);
    const pop = ms.querySelector(".ms-pop");
    pop.innerHTML = "";
    const clear = document.createElement("div");
    clear.className = "ms-clear";
    clear.textContent = "Clear";
    clear.onclick = () => { state.hostlist.filters[key] = []; renderHostlistFilterOptions(); renderHostRows(); };
    pop.appendChild(clear);
    for (const o of hostlistFilterOptions(key)) {
      const row = document.createElement("label");
      row.className = "ms-opt";
      const checked = state.hostlist.filters[key].includes(o.value) ? "checked" : "";
      row.innerHTML = `<input type="checkbox" value="${escapeHtml(o.value)}" ${checked}><span>${escapeHtml(o.label)}</span>`;
      row.querySelector("input").onchange = (e) => {
        const set = new Set(state.hostlist.filters[key]);
        e.target.checked ? set.add(o.value) : set.delete(o.value);
        state.hostlist.filters[key] = [...set];
        ms.querySelector(".ms-btn").textContent = hostlistMsLabel(key);   // keep dropdown open
        renderHostRows();
      };
      pop.appendChild(row);
    }
  }
}

function hostlistFilteredSorted() {
  const f = state.hostlist.filters;
  const q = state.hostlist.search.trim().toLowerCase();
  // duplicates are found across the WHOLE list, then used as a filter — a
  // group whose other half is filtered out by a search or a board tick isn't
  // a pair you could act on
  const dups = hostDuplicateGroups(allHostRows());
  const rows = allHostRows().filter(r => {
    if (state.hostlist.dupOnly && !dups.byName.has(r.name)) return false;
    if (f.areaId.length && !f.areaId.includes(r.area ? r.area.id : "__none__")) return false;
    if (f.boardId.length && !r.boards.some(b => f.boardId.includes(b.id))) return false;
    if (f.empId.length && !r.inspectors.some(i => f.empId.includes(i.id))) return false;
    if (f.location.length && !f.location.includes((r.location || r.mapUrl) ? "has" : "missing")) return false;
    if (f.status.length && !f.status.includes(r.archived ? "archived" : "active")) return false;
    if (q) {
      // search covers everything the row shows, so typing an inspector's name
      // answers "where has this person been" from the host side too
      const hay = [r.name, r.location, r.note, r.area ? r.area.name : "",
        ...r.inspectors.map(i => i.name), ...r.boards.map(b => b.name)].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  // In duplicate-review mode the sort that matters is "keep each pair
  // together, busiest member first" — you merge into the row with the history,
  // and comparing two candidates means seeing them on adjacent lines.
  if (state.hostlist.dupOnly) {
    rows.sort((a, b) =>
      (dups.byName.get(a.name) - dups.byName.get(b.name))
      || (b.missionCount + b.deployedDays) - (a.missionCount + a.deployedDays)
      || a.name.localeCompare(b.name));
    return rows;
  }
  const { sortKey, sortDir } = state.hostlist;
  // the two list columns sort by how many entries they hold (the useful
  // question: best-known site, most-shared host), not alphabetically
  if (sortKey === "inspectors" || sortKey === "boards") {
    const n = (r) => (sortKey === "inspectors" ? r.inspectors.length : r.boards.length);
    rows.sort((a, b) => (n(a) - n(b)) * sortDir || a.name.localeCompare(b.name));
    return rows;
  }
  // hosts with no location / no area sort together at one end rather than scattered
  const val = (r) => {
    if (sortKey === "location") return r.location || safeHttpUrl(r.mapUrl) || "";
    if (sortKey === "area") return r.area ? r.area.name : "";
    if (sortKey === "note") return r.note || "";
    if (sortKey === "status") return r.archived ? "Archived" : "Active";
    return r.name;
  };
  rows.sort((a, b) => val(a).localeCompare(val(b)) * sortDir || a.name.localeCompare(b.name));
  return rows;
}

function hostLocationCell(r) {
  const href = safeHttpUrl(r.mapUrl);
  const text = r.location || (href ? "Open in Google Maps" : "");
  if (!text) return `<button type="button" class="hl-add-loc">+ Add location</button>`;
  return href
    ? `<a class="hl-map" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"
         title="Open in Google Maps" onclick="event.stopPropagation()">${icon("pin")}${escapeHtml(text)}</a>`
    : `<span class="hl-loc">${escapeHtml(text)}</span>`;
}

/* The note gets its own column rather than riding under the location: it is
   its own fact about the site (and the one that reaches the board, at the
   front of every mission card's PPE line), so it sorts, reads and gets filled
   in on its own terms — including for a host that has no location yet. */
function hostNoteCell(r) {
  if (!r.note) return `<button type="button" class="hl-add-loc hl-add-note">+ Add note</button>`;
  return `<span class="hl-note">${escapeHtml(r.note)}</span>`;
}

function hostInspectorCell(r) {
  if (!state.hostlist.dir) return `<span class="hl-empty">…</span>`;
  if (!r.inspectors.length) return `<span class="hl-empty">No one deployed yet</span>`;
  const expanded = state.hostlist.expanded.has(r.name);
  const shown = expanded ? r.inspectors : r.inspectors.slice(0, HOSTLIST_INSPECTOR_CAP);
  const chips = shown.map(i =>
    `<span class="hl-insp" title="${escapeHtml(i.name)} — ${i.days} day${i.days === 1 ? "" : "s"} at ${escapeHtml(r.name)}">`
    + `${escapeHtml(i.name)}<b>${i.days}d</b></span>`).join("");
  const rest = r.inspectors.length - shown.length;
  const more = rest > 0
    ? `<button type="button" class="hl-more">+${rest} more</button>`
    : (expanded && r.inspectors.length > HOSTLIST_INSPECTOR_CAP ? `<button type="button" class="hl-more">Show less</button>` : "");
  return `<span class="hl-chips">`
    + `<span class="hl-count" title="${r.inspectors.length} inspector${r.inspectors.length === 1 ? "" : "s"} ever deployed here">`
    + `${r.inspectors.length}</span>${chips}${more}</span>`;
}

function hostBoardCell(r) {
  if (!state.hostlist.dir) return `<span class="hl-empty">…</span>`;
  if (!r.boards.length) return `<span class="hl-empty">Not on a board yet</span>`;
  return `<span class="hl-chips">` + r.boards.map(b =>
    `<span class="hl-board" title="${escapeHtml(b.name)} — ${b.missions} mission${b.missions === 1 ? "" : "s"} for this host">`
    + `${escapeHtml(b.name)}</span>`).join("") + `</span>`;
}

/* redraws just the table body + count — cheap enough for every keystroke,
   filter tick, sort click or "+N more" toggle */
function renderHostRows() {
  const rows = hostlistFilteredSorted();
  const all = allHostRows();
  const dups = hostDuplicateGroups(all);
  const body = $("#hostlist-body");
  body.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.dataset.host = r.name;
    if (r.archived) tr.classList.add("row-archived");
    // data-label feeds the phone breakpoint's ::before, same responsive-table
    // pattern the Manpower List uses (see renderEmployeeRows)
    tr.innerHTML = `
      <td data-label="Host name" class="hl-name">
        <span class="hl-host">${escapeHtml(r.name)}</span>
        ${r.archived ? `<span class="hl-tag hl-tag-arch" title="Archived — kept with its history, but not offered when creating a mission">archived</span>` : ""}
        ${dups.byName.has(r.name) ? `<span class="hl-tag hl-tag-dup" title="Another host has a very similar name — open this row to merge them">similar</span>` : ""}
        <button type="button" class="hl-edit" title="Edit name, location, area, note — or merge this host into another">${icon("edit")}</button>
      </td>
      <td data-label="Location" class="hl-loc-cell">${hostLocationCell(r)}</td>
      <td data-label="Service area" class="hl-area-cell">${r.area
        ? areaPillHtml(r.area, "area-pill")
        : `<button type="button" class="hl-add-loc hl-add-area">+ Set area</button>`}</td>
      <td data-label="Note" class="hl-note-cell">${hostNoteCell(r)}</td>
      <td data-label="Inspectors deployed" class="hl-insp-cell">${hostInspectorCell(r)}</td>
      <td data-label="Appear on board" class="hl-board-cell">${hostBoardCell(r)}</td>
      <td data-label="Status" class="hl-status">
        <label class="toggle toggle-active">
          <input type="checkbox" ${r.archived ? "" : "checked"} ${can("hostlist", "edit") ? "" : "disabled"}>
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
          <span class="toggle-text">${r.archived ? "Archived" : "Active"}</span>
        </label>
      </td>`;
    const lastLine = r.lastDate ? ` · last seen ${fmtDate(r.lastDate)}` : "";
    tr.querySelector(".hl-host").title =
      `${r.name} — ${r.missionCount} mission${r.missionCount === 1 ? "" : "s"}, `
      + `${r.deployedDays} deployment day${r.deployedDays === 1 ? "" : "s"}${lastLine}`;
    tr.querySelector(".hl-edit").onclick = () => openHostModal(r.name);
    // both "+ Add location" and "+ Set area" open the same record, which is the
    // one place all of a host's details are edited
    for (const add of tr.querySelectorAll(".hl-add-loc")) add.onclick = () => openHostModal(r.name);
    const more = tr.querySelector(".hl-more");
    if (more) more.onclick = () => {
      state.hostlist.expanded.has(r.name)
        ? state.hostlist.expanded.delete(r.name)
        : state.hostlist.expanded.add(r.name);
      renderHostRows();
    };
    /* Same one-click, no-confirm treatment as the Manpower List's Status
       column: archiving is reversible from the same switch, and a host record
       is master data rather than a day's plan, so no guardEdit either. The
       rest of the record is passed back through because saveHost upserts the
       whole row — sending only `archived` would blank the location. */
    tr.querySelector(".hl-status input").onchange = (ev) => {
      const active = ev.target.checked;
      safely(async () => {
        const res = await cloud.saveHost({
          name: r.name, location: r.location, mapUrl: r.mapUrl,
          areaId: r.area ? r.area.id : "", archived: !active, note: r.note,
        });
        await refreshAndRender();
        if (res && res.skipped && res.skipped.includes("archived")) {
          toast(`Archiving needs a one-time database update (migration-2026-09-04-host-archive.sql) before it can be used.`, "warn");
          return;
        }
        toast(active
          ? `${r.name} is active again — offered when creating a mission.`
          : `${r.name} archived — kept here with its history, but no longer offered on new missions.`, "info");
      });
    };
    tr.addEventListener("dblclick", () => openHostModal(r.name));
    body.appendChild(tr);
  }
  const noLoc = rows.filter(r => !r.location && !r.mapUrl).length;
  const archived = rows.filter(r => r.archived).length;
  $("#hostlist-count").textContent = `${rows.length} of ${all.length}`
    + (noLoc ? ` · ${noLoc} without a location` : "")
    + (archived ? ` · ${archived} archived` : "");
  // the duplicate banner counts across the whole list, not the filtered view —
  // it's what tells you there is cleaning up to do in the first place
  const banner = $("#hostlist-dupbar");
  const n = dups.groups.length;
  banner.classList.toggle("hidden", !n && !state.hostlist.dupOnly);
  if (n || state.hostlist.dupOnly) {
    const names = dups.groups.reduce((sum, g) => sum + g.length, 0);
    $("#hostlist-dup-text").textContent = !n
      ? "No look-alike names left."
      : n === 1
        ? `${names} host names look like the same site — merge them into the real one so their missions and inspector day counts join up.`
        : `${names} host names fall into ${n} look-alike groups — merge each group into its real host so their missions and inspector day counts join up.`;
    const btn = $("#btn-hostlist-dups");
    btn.textContent = state.hostlist.dupOnly ? "Show all hosts" : "Review duplicates";
    btn.classList.toggle("hidden", !n && !state.hostlist.dupOnly);
  }
  for (const th of $$("#hostlist-table th[data-sort]")) {
    th.classList.toggle("sorted-asc", th.dataset.sort === state.hostlist.sortKey && state.hostlist.sortDir === 1);
    th.classList.toggle("sorted-desc", th.dataset.sort === state.hostlist.sortKey && state.hostlist.sortDir === -1);
  }
  quietTable("#hostlist-table");
}

/* full (re)build on tab entry: filter dropdown options + search box + rows */
function renderHostList() {
  $("#hostlist-search").value = state.hostlist.search;
  renderHostlistFilterOptions();
  renderHostRows();
}

/* One Excel sheet, same rows and columns the table is showing right now.
   (There is no CSV any more: Excel keeps Thai text, links and dates intact.) */
async function downloadTableXlsx(sheetName, fileName, columns, rows, totalText) {
  const ExcelJS = await loadExcelJS();
  const { workbook } = await ManpowerXlsx.buildTableWorkbook(ExcelJS, { sheetName, columns, rows, totalText });
  const buf = await workbook.xlsx.writeBuffer();
  bulkSaveBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName);
}
/* Host List: Excel only, but through the same Export button and dialog as every tab */
function openHostlistExportModal() {
  const n = hostlistFilteredSorted().length;
  if (!n) { toast("No hosts match the current filters, so there is nothing to export.", "info"); return; }
  $("#hostlist-export-summary").textContent = `${n} ${n === 1 ? "host" : "hosts"} — the rows the table is showing now (search and filters apply).`;
  renderExportTypes($("#hostlist-export-type"), "hostlist", ["xlsx"]);
  openModal("#modal-hostlist-export");
}
async function exportHostlistXlsx() {
  const rows = hostlistFilteredSorted();   // same rows the table is showing right now
  if (!rows.length) { toast("No hosts match the current filters, so there is nothing to export.", "info"); return; }
  // "seen" covers both sources the dates come from — a mission planned for the
  // host and a deployment recorded against it
  const columns = [
    { label: "Host name", width: 32 }, { label: "Status", width: 11 }, { label: "Location", width: 34 },
    { label: "Google Maps link", width: 40 }, { label: "Service area", width: 16 }, { label: "Note", width: 34 },
    { label: "Inspectors", width: 44 }, { label: "Inspector count", width: 12, center: true },
    { label: "Deployment days", width: 12, center: true }, { label: "Appear on board", width: 22 },
    { label: "Missions", width: 10, center: true }, { label: "First seen", width: 12, center: true }, { label: "Last seen", width: 12, center: true },
  ];
  const out = rows.map(r => [
    r.name, r.archived ? "Archived" : "Active", r.location, r.mapUrl, r.area ? r.area.name : "", r.note,
    r.inspectors.map(i => `${i.name} (${i.days}d)`).join("; "),
    r.inspectors.length, r.deployedDays,
    r.boards.map(b => b.name).join("; "),
    r.missionCount, r.firstDate || "", r.lastDate || "",
  ]);
  await downloadTableXlsx("Host List", `host_list_${todayStr()}.xlsx`, columns, out, "TOTAL HOSTS: " + rows.length);
  toast(`Exported ${rows.length} ${rows.length === 1 ? "host" : "hosts"}.`, "info");
}

/* Host modal — the location/map-link record for one host. The name is editable
   like everything else here, but it is not an ordinary field: it is the key
   tying this record to the mission and deployment rows carrying the same text,
   so changing it goes through cloud.renameHost, which rewrites those rows too.
   That is why saveHostForm always confirms a rename before it runs. */
/* `name` names an existing host. opts.prefillName
   seeds a NEW host's name — that's the New Mission hand-off, where the planner
   has already typed a host that isn't in the list yet; opts.returnToMission
   sends them back to the mission form afterwards with the host filled in. */
function openHostModal(name, opts = {}) {
  if (!can("hostlist", "edit")) { toast("Your role can view the host list but not change it.", "info"); return; }
  const rec = name ? D().hosts.find(h => h.name === name) : null;
  state.hostlist.editingHost = name || null;
  state.hostlist.returnToMission = !!opts.returnToMission;
  const form = $("#form-host");
  form.reset();
  $("#host-modal-title").textContent = name ? `Host — ${name}` : "New Host";
  form.name.value = name || opts.prefillName || "";
  $("#host-name-note").classList.toggle("hidden", !name);
  form.location.value = rec ? rec.location : "";
  form.mapUrl.value = rec ? rec.mapUrl : "";
  form.note.value = rec ? rec.note : "";
  form.areaId.innerHTML = `<option value="">— none —</option>`
    + D().areas.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  form.areaId.value = rec ? (rec.areaId || "") : "";
  form.archived.checked = !!(rec && rec.archived);
  $("#btn-delete-host").classList.toggle("hidden", !rec);
  renderHostMergeSection(name);
  // Cancel out of the hand-off and the half-finished mission is still waiting —
  // its form keeps its values, nothing has reset it
  $("#modal-host [data-close]").onclick = () => {
    const back = state.hostlist.returnToMission;
    state.hostlist.returnToMission = false;
    closeModal();
    if (back) openModal("#modal-mission");
  };
  openModal("#modal-host");
}

/* The merge half of the Host modal: fold this host into another one. Only
   offered for a host that exists on the board — there is nothing to move out
   of a host being created — and the picker is ordered so a look-alike name
   comes first, since a merge almost always follows the duplicate finder. */
function renderHostMergeSection(name) {
  const box = $("#host-merge");
  box.classList.toggle("hidden", !name);
  if (!name) return;
  const rows = allHostRows();
  const me = rows.find(r => r.name === name);
  const dups = hostDuplicateGroups(rows);
  const myGroup = dups.byName.get(name);
  const others = rows
    .filter(r => r.name !== name)
    .sort((a, b) => {
      // look-alikes first, then the hosts with the most history behind them
      const na = dups.byName.get(a.name) === myGroup && myGroup !== undefined ? 0 : 1;
      const nb = dups.byName.get(b.name) === myGroup && myGroup !== undefined ? 0 : 1;
      return na - nb
        || (b.missionCount + b.deployedDays) - (a.missionCount + a.deployedDays)
        || a.name.localeCompare(b.name);
    });
  const sel = $("#host-merge-target");
  sel.innerHTML = `<option value="">Choose the host to keep…</option>`
    + others.map(r => {
      const bits = [r.area ? r.area.name : "", `${r.missionCount} mission${r.missionCount === 1 ? "" : "s"}`,
        `${r.inspectors.length} inspector${r.inspectors.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
      const flag = dups.byName.get(r.name) === myGroup && myGroup !== undefined ? "★ " : "";
      return `<option value="${escapeHtml(r.name)}">${flag}${escapeHtml(r.name)} — ${escapeHtml(bits)}</option>`;
    }).join("");
  sel.value = "";
  const moving = me
    ? `${me.missionCount} mission${me.missionCount === 1 ? "" : "s"} and ${me.deployedDays} deployment day${me.deployedDays === 1 ? "" : "s"}`
    : "its missions and deployment history";
  $("#host-merge-note").textContent =
    `${moving} move to the host you pick, and "${name}" disappears from this list — including from past mission cards, which will show the kept name. Use this for a duplicate or a misspelling, not for a site you simply stopped serving (archive that instead).`;
}

function mergeHostFromModal() {
  const from = state.hostlist.editingHost;
  const to = $("#host-merge-target").value;
  if (!from) return;
  if (!to) { toast("Pick the host to merge into first.", "warn"); return; }
  const me = allHostRows().find(r => r.name === from);
  const impact = me
    ? `${me.missionCount} mission${me.missionCount === 1 ? "" : "s"} and ${me.deployedDays} deployment day${me.deployedDays === 1 ? "" : "s"} move across`
    : "its missions and deployment history move across";
  showConfirm("Merge hosts?",
    `Merge "${from}" into "${to}"? ${impact}, and "${from}" is removed from the Host list — past mission cards for it will read "${to}". Anything only "${from}" knows (location, map link, service area, note) is carried over if "${to}" doesn't have it. This can't be undone automatically.`,
    () => safely(async () => {
      await cloud.mergeHost(from, to);
      closeModal();
      state.hostlist.dirCacheKey = null;   // the directory itself changed, not just a record
      state.hostlist.expanded.delete(from);
      await refreshAndRender();
      toast(`Merged ${from} into ${to}.`, "info");
    }),
    () => openModal("#modal-host"));   // "Cancel" → back to the host they were editing
}

function saveHostForm(ev) {
  ev.preventDefault();
  const form = $("#form-host");
  const name = form.name.value.trim();
  if (!name) { toast("A host needs a name.", "error"); return; }
  let location = form.location.value.trim();
  let mapUrl = form.mapUrl.value.trim();
  // Pasting the Maps link straight into Location is what people actually do —
  // file it as the link rather than storing a URL where an address goes.
  if (!mapUrl && /^https?:\/\//i.test(location)) { mapUrl = location; location = ""; }
  if (mapUrl && !safeHttpUrl(mapUrl)) {
    toast("The Google Maps link must start with http:// or https://", "error");
    return;
  }
  const note = form.note.value.trim();
  const areaId = form.areaId.value;
  const archived = form.archived.checked;
  const from = state.hostlist.editingHost;
  if (!from && hostRecordOf(name)) {
    toast(`${name} is already in the host list — edit that row instead.`, "error");
    return;
  }
  const vals = { name, location, mapUrl, areaId, archived, note };
  if (!from || name === from) { runHostSave(vals, null); return; }

  /* A rename from here on. Two things it is deliberately NOT allowed to be:

     Silent — it rewrites this host's name on every mission and deployment row
     it has ever appeared on, which changes what past mission cards say. That
     is the right behaviour (the history belongs to the host, not to the
     spelling) but it is far too wide to happen without being spelled out.

     A merge — landing on a name that already exists would join two histories
     for good. That has its own tool in this same modal, its own confirmation,
     and its own rules about whose location and note survive; arriving there by
     mistyping a rename would be the worst possible way to trigger it. So it is
     refused and pointed at Merge rather than guessed at. */
  const rows = allHostRows();
  if (rows.some(r => r.name === name)) {
    toast(`"${name}" is already a host — use "Merge into another host" below to combine them.`, "error");
    return;
  }
  const me = rows.find(r => r.name === from);
  const impact = me
    ? `Its ${me.missionCount} mission${me.missionCount === 1 ? "" : "s"} and ${me.deployedDays} deployment day${me.deployedDays === 1 ? "" : "s"} are`
    : "Its missions and deployment history are";
  showConfirm("Rename this host?",
    `Rename "${from}" to "${name}"? ${impact} rewritten to the new name, so this host keeps its whole history instead of starting fresh — but past mission cards for it will read "${name}" too. Nothing else about the host changes.`,
    () => runHostSave(vals, from),
    () => openModal("#modal-host"));   // "Cancel" → back to the form, edits intact
}

/* The save itself, once any rename has been confirmed. `from` is the old name
   when this is a rename, null otherwise.

   Order matters: the rename has to land BEFORE saveHost. saveHost upserts on
   the name, so saving first and renaming after would write a second record
   under the new name and leave the original sitting under the old one. */
function runHostSave(vals, from) {
  const { name } = vals;
  const renamed = !!from;
  const back = state.hostlist.returnToMission;
  state.hostlist.returnToMission = false;
  safely(async () => {
    if (renamed) {
      await cloud.renameHost(from, name);
      // the directory itself changed, not just one record — same bookkeeping
      // the merge path does, since both rewrite mission rows
      state.hostlist.dirCacheKey = null;
      if (state.hostlist.expanded.delete(from)) state.hostlist.expanded.add(name);
      state.hostlist.editingHost = name;
    }
    const res = await cloud.saveHost(vals);
    closeModal();
    await refreshAndRender();
    if (back) {
      // straight back to the mission the planner was in the middle of writing,
      // with the host they just created now filled in and recognised
      const mf = $("#form-mission");
      mf.host.value = name;
      updateMissionHostNote();
      openModal("#modal-mission");
    }
    // the host itself saved; a field it couldn't store means this database
    // hasn't run that field's migration yet (see cloud.saveHost)
    const skipped = (res && res.skipped) || [];
    if (skipped.length) {
      const what = skipped.map(c => HOST_COLUMN_MIGRATIONS[c] || c).join(" and ");
      toast(`Saved ${name}, but ${what} — the rest of the record was saved.`, "warn");
    } else {
      toast(renamed ? `Renamed ${from} to ${name}.` : `Saved ${name}.`, "info");
    }
  });
}

/* "Clear record" drops the location / area / link only. The host itself lives
   on its mission and deployment rows as plain text, so it keeps its place in
   this list — it just goes back to having no details. The one real
   consequence is the New Mission form, which offers the hosts that HAVE a
   record: clearing one takes it out of that list until it's added again, so
   the confirmation says so. */
function deleteHostRecord() {
  const name = state.hostlist.editingHost;
  const rec = name ? D().hosts.find(h => h.name === name) : null;
  if (!rec) return;
  showConfirm("Clear host record?",
    `Remove the saved location, map link and service area for ${name}? ${name} stays in the Host List with its missions and inspector history, but it will no longer be offered when creating a mission until you add it again.`,
    () => safely(async () => {
      await cloud.deleteHost(rec.id);
      closeModal();
      await refreshAndRender();
    }));
}

/* where is this employee assigned right now on the current plan?
   returns the payload shape setAssignment expects: {missionId} | {zone} | null */
function currentAssignmentOfIn(plan, empId) {
  for (const m of plan.missions) if (m.members.includes(empId)) return { missionId: m.id };
  for (const z of ZONES) if (plan.zones[z].includes(empId)) return { zone: z };
  return null;
}
function currentAssignmentOf(empId) {
  return currentAssignmentOfIn(getPlan(), empId);
}
function samePayload(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.missionId === b.missionId && a.zone === b.zone;
}
function dropTargetToPayload(target) {
  if (target.startsWith("mission:")) return { missionId: target.slice(8) };
  if (target.startsWith("zone:")) return { zone: target.slice(5) };
  return null; // "pool" => unassigned
}

/* assign a set of employees to one target, recording an undo entry for the batch */
function assignEmployeesTo(empIds, payload) {
  const forecast = isForecastView();
  const entries = [];
  for (const id of empIds) {
    const prior = currentAssignmentOf(id);
    if (samePayload(prior, payload)) continue;   // no-op, skip
    entries.push({ empId: id, prior });
  }
  if (!entries.length) { clearSelection(); return; }
  const run = () => safely(async () => {
    for (const e of entries) {
      if (forecast) await cloud.setForecastAssignment(e.empId, state.date, payload);
      else await cloud.setAssignment(e.empId, state.date, payload);
    }
    state.undoStack.push({ date: state.date, forecast, entries });
    if (state.undoStack.length > 25) state.undoStack.shift();
    clearSelection();
    await refreshAndRender();
    updateUndoButton();
  });
  if (!forecast) { run(); return; }
  /* D3: taking someone out of ANOTHER engineer's forecast is allowed, but not
     silently — say whose hold it is first; the database records the loss and
     flags their mission until they acknowledge it. */
  const plan = getPlan();
  const taken = entries.filter(e => e.prior && isOthersHold(plan.holds && plan.holds[e.empId]));
  if (!taken.length) { run(); return; }
  const lines = taken.map(e => {
    const emp = D().employees.find(x => x.id === e.empId);
    const where = e.prior.missionId
      ? "mission " + ((plan.missions.find(m => m.id === e.prior.missionId) || {}).number || "?")
      : ZONE_LABELS[e.prior.zone] || e.prior.zone;
    return `${emp ? emp.name : "?"} — held by ${plan.holds[e.empId]} in ${where}`;
  });
  showConfirm(taken.length === 1 ? "Take a held person?" : `Take ${taken.length} held people?`,
    `${lines.join("\n")}\n\nMove ${taken.length === 1 ? "them" : "them all"} anyway? The engineer who placed ${taken.length === 1 ? "them" : "each one"} will see a red flag on their mission until they acknowledge it.`,
    run);
}

function undoLast() {
  const action = state.undoStack.pop();
  updateUndoButton();
  if (!action) return;
  state.date = action.date;   // jump back to the affected date so the change is visible
  safely(async () => {
    for (const e of action.entries) {
      if (action.forecast) await cloud.setForecastAssignment(e.empId, action.date, e.prior);
      else await cloud.setAssignment(e.empId, action.date, e.prior);
    }
    await refreshAndRender();
  });
}
function updateUndoButton() {
  const btn = $("#btn-undo");
  if (btn) btn.disabled = state.undoStack.length === 0;
}

/* ---------- drag & drop + click-to-assign ---------- */
function bindDropzones() {
  for (const zone of $$(".dropzone")) {
    if (zone.dataset.bound) continue;
    zone.dataset.bound = "1";
    zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", (ev) => {
      ev.preventDefault();
      zone.classList.remove("drag-over");
      let ids;
      try { ids = JSON.parse(ev.dataTransfer.getData("text/plain")); }
      catch (e) { ids = [ev.dataTransfer.getData("text/plain")]; }
      if (!Array.isArray(ids)) ids = [ids];
      ids = ids.filter(Boolean);
      if (!ids.length) return;
      guardEdit(() => assignEmployeesTo(ids, dropTargetToPayload(zone.dataset.drop)));
    });
    // click-to-assign: with a selection active, clicking empty space in a drop
    // target assigns the selection there (dragging is the alternative, not required)
    zone.addEventListener("click", (ev) => {
      if (!state.selectedEmps.size) return;
      if (ev.target.closest(".emp-card")) return;   // clicking a card selects it, doesn't assign
      guardEdit(() => assignEmployeesTo([...state.selectedEmps], dropTargetToPayload(zone.dataset.drop)));
    });
  }
}

/* ---------- modals ---------- */
let _modalReturnFocus = null;   // where focus goes back to when a dialog over Settings closes
function openModal(id) {
  const backdrop = $("#modal-backdrop");
  // Settings is a page, so the dialogs it opens (review, password, add…) are the
  // only modal-over-content case that needs a focus story: name the dialog,
  // move focus in, keep Tab inside, and hand focus back on close.
  if (state.settingsOpen && backdrop.classList.contains("hidden")) _modalReturnFocus = document.activeElement;
  backdrop.classList.remove("hidden");
  for (const m of $$(".modal")) m.classList.add("hidden");
  $(id).classList.remove("hidden");
  syncSegmented($(id));
  if (state.settingsOpen) focusModal($(id));
}

/* ---------- segmented controls ----------
   A <select data-seg> (Shift, Contract type) is drawn as a row of buttons. The select
   stays the source of truth, so the form code reads and writes it exactly as before and
   the buttons just follow it; it is hidden from sight and from assistive technology. */
function syncSegmented(root = document) {
  for (const sel of root.querySelectorAll("select[data-seg]")) {
    if (!sel._seg) continue;
    for (const btn of sel._seg.children) btn.setAttribute("aria-pressed", String(btn.dataset.v === sel.value));
  }
}
function initSegmented() {
  for (const sel of $$("select[data-seg]")) {
    if (sel._seg) continue;
    const row = document.createElement("div");
    row.className = "seg-pick";
    row.setAttribute("role", "group");
    const lab = sel.closest("label");
    row.setAttribute("aria-label", ((lab && lab.childNodes[0] && lab.childNodes[0].textContent) || sel.name || "").trim());
    for (const o of sel.options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.v = o.value;
      btn.textContent = o.textContent;
      btn.onclick = (ev) => {
        ev.preventDefault();
        sel.value = o.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        syncSegmented(sel.closest(".modal") || document);
      };
      row.appendChild(btn);
    }
    sel.classList.add("seg-source");
    sel.tabIndex = -1;
    sel.setAttribute("aria-hidden", "true");
    sel.after(row);
    sel._seg = row;
    if (sel.form) sel.form.addEventListener("reset", () => setTimeout(() => syncSegmented(sel.form), 0));
  }
}
let _confirmCancel = null;   // fired if a confirm is dismissed any way other than "Yes"

function closeModal() {
  const backdrop = $("#modal-backdrop");
  backdrop.classList.add("hidden");
  for (const m of $$(".modal")) m.classList.add("hidden");
  // a password typed into the Change password dialog does not outlive it
  const pw = $("#form-account-password");
  if (pw) pw.reset();
  if (_confirmCancel) { const c = _confirmCancel; _confirmCancel = null; c(); }
  if (_modalReturnFocus && backdrop.classList.contains("hidden")) {
    const back = _modalReturnFocus;
    _modalReturnFocus = null;
    if (back.isConnected && typeof back.focus === "function") back.focus({ preventScroll: true });
  }
}

function modalFocusables(m) {
  return Array.from(m.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter(el => !el.disabled && el.type !== "hidden" && el.getClientRects().length > 0);
}
function focusModal(m) {
  m.setAttribute("role", "dialog");
  m.setAttribute("aria-modal", "true");
  if (!m.getAttribute("aria-labelledby")) {
    const h = m.querySelector("h3 [id]") || m.querySelector("h3");
    if (h) { if (!h.id) h.id = m.id + "-title"; m.setAttribute("aria-labelledby", h.id); }
  }
  const all = modalFocusables(m);
  const first = all.find(el => !el.classList.contains("modal-close")) || all[0];
  if (first) first.focus({ preventScroll: true });
  else { m.tabIndex = -1; m.focus({ preventScroll: true }); }
}
/* keep Tab / Shift+Tab inside the open dialog */
function trapModalTab(ev) {
  const m = $$(".modal").find(x => !x.classList.contains("hidden"));
  if (!m) return;
  const all = modalFocusables(m);
  if (!all.length) { ev.preventDefault(); return; }
  const firstEl = all[0], lastEl = all[all.length - 1];
  const inside = m.contains(document.activeElement);
  if (ev.shiftKey && (!inside || document.activeElement === firstEl)) { ev.preventDefault(); lastEl.focus(); }
  else if (!ev.shiftKey && (!inside || document.activeElement === lastEl)) { ev.preventDefault(); firstEl.focus(); }
}

function showConfirm(title, message, onYes, onCancel, yesLabel) {
  $("#confirm-title").textContent = title;
  $("#confirm-message").textContent = message;
  $("#btn-confirm-yes").textContent = yesLabel || "Yes";
  _confirmCancel = onCancel || null;
  openModal("#modal-confirm");
  $("#btn-confirm-yes").onclick = () => { _confirmCancel = null; closeModal(); onYes(); };
  $("#btn-confirm-no").onclick = closeModal;
}

/* mission modal */
/* The Host box is a search over the Host List: a <datalist> so the browser's
   own type-ahead does the filtering (it works on a phone keyboard too, which a
   hand-rolled popover inside a scrolling modal does not), each entry labelled
   with its service area. Typing is still free — the check happens on save (see
   saveMission), so an unknown host becomes an offer to create it rather than a
   field that fights you while you type. */
function renderMissionHostOptions() {
  const list = $("#host-options");
  list.innerHTML = D().hosts
    // an archived host is a site the team no longer serves — it keeps its
    // history and its row in the Host List, it just isn't suggested here.
    // hostRecordOf() still matches it, so editing an old mission that names
    // one saves without being asked to re-create the host.
    .filter(h => !h.archived)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(h => {
      const area = h.areaId ? D().areas.find(a => a.id === h.areaId) : null;
      const detail = [area ? area.name : "", h.location].filter(Boolean).join(" · ");
      return `<option value="${escapeHtml(h.name)}">${escapeHtml(detail)}</option>`;
    }).join("");
}
/* live feedback under the Host box: known host (with its area), or a heads-up
   that saving will offer to create it */
function updateMissionHostNote() {
  const note = $("#mission-host-note");
  const typed = $("#form-mission").host.value.trim();
  if (!typed) { note.classList.add("hidden"); return; }
  note.classList.remove("hidden");
  const rec = hostRecordOf(typed);
  if (rec) {
    const area = rec.areaId ? D().areas.find(a => a.id === rec.areaId) : null;
    note.className = "import-note host-note-ok";
    setIconLabel(note, "check", `${rec.name}${area ? " — " + area.name : " — no service area set yet"}`
      + (rec.archived ? " · archived host" : ""));
  } else {
    note.className = "import-note host-note-new";
    setIconLabel(note, "alert", `"${typed}" is not in the Host list yet — saving will offer to create it.`);
  }
}

/* ---------- the Engineer box on a mission ---------- */
/* Who a mission may name. Everyone from Engineer upwards, by the display name
   on their account (cloud.data.directory) — plus any engineer record with no
   account behind it, so a board built before accounts existed keeps working and
   an old mission can still be opened and saved.

   `label` is what the datalist matches on, so it has to be unique: two people
   who both come out "Somchai.S" are told apart by their full name, and an
   unlikely third by a number. */
function engineerCandidates() {
  const out = [];
  for (const d of D().directory) {
    out.push({
      name: d.displayName || d.fullName || "?",
      label: d.displayName || d.fullName || "?",
      detail: [d.fullName, roleLabel(d.roleKey)].filter(Boolean).join(" · "),
      full: d.fullName || "",
      profileId: d.id, engineerId: d.engineerId, roleKey: d.roleKey,
    });
  }
  const throughAccount = new Set(D().directory.map(d => d.engineerId).filter(Boolean));
  for (const e of D().engineers) {
    if (throughAccount.has(e.id)) continue;
    out.push({
      name: e.name, label: e.name,
      detail: e.profileId ? "" : "no account yet",
      full: "", profileId: e.profileId || null, engineerId: e.id, roleKey: null,
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  const clashes = new Map();
  for (const c of out) clashes.set(c.label.toLowerCase(), (clashes.get(c.label.toLowerCase()) || 0) + 1);
  const used = new Map();
  for (const c of out) {
    let label = c.label;
    if (clashes.get(label.toLowerCase()) > 1 && c.full && c.full.toLowerCase() !== label.toLowerCase()) {
      label = `${label} (${c.full})`;
    }
    const seen = (used.get(label.toLowerCase()) || 0) + 1;
    used.set(label.toLowerCase(), seen);
    c.label = seen === 1 ? label : `${label} (${seen})`;
  }
  return out;
}

/* Typed text -> one candidate. The label is the canonical answer; a plain name
   is accepted too when only one person answers to it, so somebody who types
   "Somchai.P" and never opens the suggestion list still gets the right person. */
function missionEngineerMatch(typed) {
  const key = String(typed || "").trim().toLowerCase();
  if (!key) return null;
  const list = engineerCandidates();
  const exact = list.find(c => c.label.toLowerCase() === key);
  if (exact) return exact;
  const byName = list.filter(c => c.name.toLowerCase() === key);
  return byName.length === 1 ? byName[0] : null;
}

function engineerLabelFor(engineerId) {
  const c = engineerCandidates().find(x => x.engineerId === engineerId);
  return c ? c.label : "";
}

function renderMissionEngineerOptions() {
  $("#engineer-options").innerHTML = engineerCandidates()
    .map(c => `<option value="${escapeHtml(c.label)}">${escapeHtml(c.detail)}</option>`).join("");
}

/* Live feedback under the Engineer box, in the same three states the Host box
   uses: recognised, recognised-but-not-on-the-board-yet, and unknown. */
function updateMissionEngineerNote() {
  const note = $("#mission-engineer-note");
  const typed = $("#form-mission").engineer.value.trim();
  if (!typed) { note.classList.add("hidden"); return; }
  note.classList.remove("hidden");
  const match = missionEngineerMatch(typed);
  if (!match) {
    note.className = "import-note host-note-new";
    setIconLabel(note, "alert", `"${typed}" isn't on the engineer list — pick a name from the suggestions.`);
    return;
  }
  note.className = "import-note host-note-ok";
  setIconLabel(note, "check", `${match.name}`
    + (match.detail ? ` — ${match.detail}` : "")
    + (match.engineerId ? "" : " · first mission for them — they'll get a colour of their own"));
}

function openMissionModal(missionId) {
  state.editingMissionId = missionId || null;
  const form = $("#form-mission");
  form.reset();
  renderMissionHostOptions();
  renderMissionEngineerOptions();
  $("#mission-modal-title").textContent = missionId ? "Edit Mission" : "New Mission";
  $("#btn-delete-mission").classList.toggle("hidden", !missionId);
  $("#btn-hide-mission").classList.toggle("hidden", !missionId || isForecastView());
  $("#mission-modal-title").textContent = (missionId ? "Edit" : "New") + (isForecastView() ? " Forecast Mission" : " Mission");
  if (missionId) {
    const m = getPlan().missions.find(x => x.id === missionId);
    form.number.value = m.number;
    form.host.value = m.host;
    form.customer.value = m.customer;
    form.ppe.value = m.ppe || "";
    form.shift.value = m.shift;
    form.startTime.value = m.startTime;
    form.endTime.value = m.endTime;
    form.engineer.value = engineerLabelFor(m.engineerId);
    form.remark.value = m.remark || "";
  }
  updateMissionHostNote();
  updateMissionEngineerNote();
  openModal("#modal-mission");
}

function saveMission(ev) {
  ev.preventDefault();
  const form = $("#form-mission");
  const vals = {
    number: form.number.value.trim(),
    host: form.host.value.trim(),
    customer: form.customer.value.trim(),
    ppe: form.ppe.value.trim(),
    remark: form.remark.value.trim(),
    shift: form.shift.value,
    startTime: form.startTime.value || "08:00",
    endTime: form.endTime.value || "17:00",
  };
  /* The host has to be one from the Host List. That list is what carries a
     host's location and service area, and a mission naming a host that isn't
     on it would show neither — so instead of quietly accepting a new spelling
     (which is how "Fortune", "fortune " and "Frotune" become three sites), an
     unknown host becomes an offer to create it, and the mission is saved after
     that. A known host is normalised to the record's own spelling. */
  const hostRec = hostRecordOf(vals.host);
  if (!hostRec) {
    showConfirm("Create this host first?",
      `"${vals.host}" is not in the Host list yet. A mission's host has to come from that list — it's what carries the site's location and service area. Create it now and come back to this mission?`,
      () => openHostModal(null, { prefillName: vals.host, returnToMission: true }),
      () => openModal("#modal-mission"));   // "Cancel" → back to the form, still filled in
    return;
  }
  vals.host = hostRec.name;
  /* The engineer has to be somebody the board knows — an account from Engineer
     upwards, or one of the engineer records that predate accounts. Resolved to
     an engineers row below, because that is what a mission stores and what the
     card colour, the filters and the Overview all read. */
  const eng = missionEngineerMatch(form.engineer.value);
  if (!eng) {
    toast(`"${form.engineer.value.trim()}" isn't on the engineer list. Pick a name from the suggestions — everyone from Engineer upwards is there.`, "warn");
    return;
  }
  // instant client-side check (same number + shift, excluding the mission being edited);
  // scans hidden missions too — the DB unique constraint covers them regardless —
  // this just avoids a round trip and points at the hidden one if that's the clash
  const dup = getPlan().missions.find(m =>
    m.number.trim().toLowerCase() === vals.number.toLowerCase() &&
    m.shift === vals.shift && m.id !== state.editingMissionId);
  if (dup) {
    const shiftLabel = vals.shift === "night" ? "Night" : "Day";
    toast(dup.hidden
      ? `A hidden mission "${vals.number}" already exists on the ${shiftLabel} shift for this date. Use "Hide/Unhide" to unhide and reuse it, or pick a different shift.`
      : `A mission "${vals.number}" already exists on the ${shiftLabel} shift for this date. Use a different shift, or edit the existing mission instead.`, "warn");
    return;
  }
  safely(async () => {
    // the first time somebody is picked they have no engineer record yet, so
    // one is made here — that is where their mission colour lives
    vals.engineerId = eng.engineerId || await cloud.ensureEngineerForProfile(eng.profileId);
    if (isForecastView()) await cloud.saveForecastMission(D().activeBoardId, state.date, state.editingMissionId, vals);
    else await cloud.saveMission(D().activeBoardId, state.date, state.editingMissionId, vals);
    closeModal();
    await refreshAndRender();
  });
}

function deleteMission() {
  const m = getPlan().missions.find(x => x.id === state.editingMissionId);
  const forecast = isForecastView();
  const plan = getPlan();
  // someone else's holds go with the mission — say so rather than let it happen quietly
  const othersHolds = forecast ? m.members.filter(id => isOthersHold(plan.holds && plan.holds[id])).length : 0;
  showConfirm(forecast ? "Delete forecast mission?" : "Delete mission?",
    `Delete ${m.number}? Its employees return to the Available pool.` +
      (othersHolds ? ` ${othersHolds} of them ${othersHolds === 1 ? "is" : "are"} held by another engineer.` : ""), () => {
    safely(async () => {
      if (forecast) await cloud.deleteForecastMission(state.editingMissionId);
      else await cloud.deleteMission(state.editingMissionId);
      await refreshAndRender();
    });
  });
}

/* Hide takes a mission off the board without deleting its record — its number,
   host, engineer etc. all survive so it can be brought back with "Hide/Unhide".
   Carries forward day to day like any other mission field (cloud._copyPlanForward
   copies the hidden flag), so a dormant mission stays off every future board
   until someone explicitly unhides it. */
function hideMission() {
  const m = getPlan().missions.find(x => x.id === state.editingMissionId);
  const doHide = () => safely(async () => {
    await cloud.setMissionsHidden([state.editingMissionId], true);
    closeModal();
    await refreshAndRender();
  });
  if (m.members.length) {
    showConfirm("Hide mission?",
      `Hide ${m.number}? Its ${m.members.length} assigned employee${m.members.length === 1 ? "" : "s"} return to Standby. The mission itself is kept — unhide it any time from "Hide/Unhide".`,
      doHide);
  } else {
    doHide();
  }
}

/* employee modal */
function openEmployeeModal(empId) {
  if (!can("emplist", "edit")) { toast("Your role can view the roster but not change it.", "info"); return; }
  state.editingEmployeeId = empId || null;
  const form = $("#form-employee");
  form.reset();
  $("#employee-modal-title").textContent = empId ? "Edit Employee" : "New Employee";
  $("#btn-deactivate-employee").classList.toggle("hidden", !empId);
  form.areaId.innerHTML = D().areas.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  form.boardId.innerHTML = D().boards.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
  if (empId) {
    const e = D().employees.find(x => x.id === empId);
    form.name.value = e.name;
    form.nameEn.value = e.nameEn || "";
    form.contract.value = e.contract;
    form.position.value = e.position || "";
    form.phone.value = e.phone || "";
    form.trigoId.value = e.trigoId || "";
    form.startDate.value = e.startDate || "";
    form.addedOn.value = e.addedOn || "";
    form.areaId.value = e.areaId;
    form.boardId.value = e.boardId;
  } else if (!isNonBoardView()) {
    form.boardId.value = D().activeBoardId;
  }
  // Host Record opens first for an existing employee — it's the more common
  // reason to double-click a card (checking where someone's worked before),
  // Edit Employee is one tab away. It only makes sense once the employee has
  // been saved (and thus could actually have an assignment history) though,
  // so a brand-new employee skips straight to the edit form with no tab strip.
  state.employeeTab = empId ? "hosts" : "edit";
  $("#employee-tabs").classList.toggle("hidden", !empId);
  applyEmployeeTab();
  if (empId) { loadEmployeeHostRecord(empId); loadEmployeeNotes(empId); }
  openModal("#modal-employee");
}

function saveEmployee(ev) {
  ev.preventDefault();
  const form = $("#form-employee");
  const vals = { name: form.name.value.trim(), nameEn: form.nameEn.value.trim(), trigoId: form.trigoId.value.trim(), contract: form.contract.value, position: form.position.value, phone: form.phone.value.trim(), startDate: form.startDate.value, addedOn: form.addedOn.value, areaId: form.areaId.value, boardId: form.boardId.value };
  // instant client-side checks (the same rules cloud.saveEmployee enforces, which is the real
  // guard): the name is the FULL name only, the TRIGO ID is T + digits and unique, and two people
  // may share a name only when both have a TRIGO ID. A short name saved earlier can be left as it is.
  const editing = state.editingEmployeeId ? D().employees.find(x => x.id === state.editingEmployeeId) : null;
  const tid = EmployeeId.normalizeTrigoId(vals.trigoId);
  if (tid === null) { toast("The TRIGO ID must be the letter T and digits, like T329.", "warn"); return; }
  if (!editing || editing.name.trim() !== vals.name) {
    const why = EmployeeId.checkFullName(vals.name);
    if (why) { toast(why, "warn"); return; }
  }
  if (EmployeeId.nameClash(D().employees, vals.name, tid, state.editingEmployeeId)) {
    toast(`An employee named "${vals.name}" already exists. Give each of them their TRIGO ID to tell them apart.`, "warn");
    return;
  }
  const idOwner = EmployeeId.idClash(D().employees, tid, state.editingEmployeeId);
  if (idOwner) { toast(`The TRIGO ID ${tid} already belongs to ${idOwner.name}.`, "warn"); return; }
  const doSave = () => safely(async () => {
    if (state.editingEmployeeId) {
      const emp = D().employees.find(x => x.id === state.editingEmployeeId);
      if (emp.boardId !== vals.boardId) await cloud.moveEmployeeToBoard(emp.id, vals.boardId, state.date);
      await cloud.saveEmployee(state.editingEmployeeId, vals);
    } else {
      await cloud.saveEmployee(null, vals);
    }
    closeModal();
    await refreshAndRender();
  });
  // A name typed into the wrong field: no Thai letters in the Thai name, or Thai letters in the English
  // name. A warning, not a block (a Thai name may be spelled in English for now), and on an edit only
  // for a field that was changed, so a person whose Thai column still holds the English copy from the
  // migration is not nagged every time their phone number is edited.
  const hasThai = (t) => /[\u0E00-\u0E7F]/.test(t);
  const mixUps = [];
  if (vals.name && !hasThai(vals.name) && (!editing || editing.name !== vals.name)) {
    mixUps.push(`The Thai name "${vals.name}" has no Thai letters. It is the name the app shows by default.`);
  }
  if (vals.nameEn && hasThai(vals.nameEn) && (!editing || (editing.nameEn || "") !== vals.nameEn)) {
    mixUps.push(`The English name "${vals.nameEn}" has Thai letters. It is the name an English Excel export uses.`);
  }
  if (mixUps.length) {
    // Cancel goes back to the form with everything still typed in
    showConfirm("Check the names", mixUps.join("\n\n") + "\n\nSave anyway?", doSave, () => openModal("#modal-employee"), "Save anyway");
    return;
  }
  doSave();
}

function deactivateEmployee() {
  const e = D().employees.find(x => x.id === state.editingEmployeeId);
  showConfirm("Deactivate employee?",
    `Deactivate ${e.name}? Hidden from today's and future boards; past dates keep them. Turn back on from the Status column in the Manpower List.`, () => {
    safely(async () => {
      await cloud.setEmployeesActive([state.editingEmployeeId], false);
      closeModal();
      await refreshAndRender();
    });
  });
}

/* employee modal — Edit Employee / Host Record sub-menu tabs (same pattern as
   applySettingsTab, scoped to #modal-employee so the two tab strips don't
   toggle each other's panes) */
function applyEmployeeTab() {
  for (const btn of $$("#employee-tabs .settings-tab")) {
    btn.classList.toggle("active", btn.dataset.tab === state.employeeTab);
  }
  for (const pane of $$("#modal-employee .settings-pane")) {
    pane.classList.toggle("hidden", pane.dataset.pane !== state.employeeTab);
  }
}

/* Host Record tab: every host this employee has ever been deployed to, most
   recent first. `getEmployeeHostHistory` reads deployment_history, which is
   keyed one row per (employee, plan_date) — upserted, never duplicated, so
   each row IS one distinct day worked, not one mission. Grouping those rows
   by host and counting them therefore gives days at that host directly (same
   figure the Host List's own inspector chips show, just from the other
   side) — a host visited on ten different days is one line reading "10
   days", not ten lines. Loaded on modal open (not on first tab click) so
   switching tabs feels instant; the query is a single indexed read
   (deployment_history.employee_id) so this is cheap even for someone with a
   long history. */
async function loadEmployeeHostRecord(empId) {
  const box = $("#employee-hosts-list");
  box.innerHTML = '<p class="import-note">Loading…</p>';
  let rows;
  try {
    rows = await cloud.getEmployeeHostHistory(empId);
  } catch (e) {
    box.innerHTML = `<p class="import-note">Could not load host record: ${e.message || e}</p>`;
    return;
  }
  // bail if the modal moved on to a different employee (or closed) while this was in flight
  if (state.editingEmployeeId !== empId) return;
  if (!rows.length) {
    box.innerHTML = '<p class="import-note">No host history yet.</p>';
    return;
  }
  const byHost = new Map();   // host name -> { days, lastDate, lastNumber, lastCustomer }
  for (const r of rows) {
    const rec = byHost.get(r.host) || { days: 0, lastDate: r.date, lastNumber: r.number, lastCustomer: r.customer };
    rec.days++;
    byHost.set(r.host, rec);
  }
  // rows arrive most-recent-first, so the first row seen per host is already its most recent
  const hosts = [...byHost.entries()].sort((a, b) => b[1].lastDate.localeCompare(a[1].lastDate));
  box.innerHTML = `<div class="host-list">${hosts.map(([host, rec]) => `
    <div class="host-row">
      <div class="host-name">${escapeHtml(host)}</div>
      <div class="host-meta">${rec.days} day${rec.days === 1 ? "" : "s"} · last ${fmtDate(rec.lastDate)}
        (${escapeHtml(rec.lastNumber)}${rec.lastCustomer ? " — " + escapeHtml(rec.lastCustomer) : ""})</div>
    </div>`).join("")}</div>`;
}

/* Note tab: free-text remarks left about this employee (not tied to any date
   or assignment), most recent first. Same load-on-modal-open pattern as
   loadEmployeeHostRecord, backed by its own employee_notes table so a note
   survives independently of the roster edit form. */
async function loadEmployeeNotes(empId) {
  const box = $("#employee-notes-list");
  box.innerHTML = '<p class="import-note">Loading…</p>';
  let rows;
  try {
    rows = await cloud.getEmployeeNotes(empId);
  } catch (e) {
    box.innerHTML = `<p class="import-note">Could not load notes: ${e.message || e}</p>`;
    return;
  }
  // bail if the modal moved on to a different employee (or closed) while this was in flight
  if (state.editingEmployeeId !== empId) return;
  if (!rows.length) {
    box.innerHTML = '<p class="import-note">No notes yet.</p>';
    return;
  }
  box.innerHTML = `<div class="note-list">${rows.map((r) => `
    <div class="note-row" data-id="${escapeHtml(r.id)}">
      <div class="note-text">${escapeHtml(r.note)}</div>
      <div class="note-meta">${escapeHtml(r.createdBy || "unknown")} · ${new Date(r.createdAt).toLocaleString()}
        <button type="button" class="note-delete">Delete</button></div>
    </div>`).join("")}</div>`;
  for (const btn of box.querySelectorAll(".note-delete")) {
    btn.onclick = () => {
      const id = btn.closest(".note-row").dataset.id;
      showConfirm("Delete note?", "Remove this note? This can't be undone.", () => safely(async () => {
        await cloud.deleteEmployeeNote(id);
        await loadEmployeeNotes(empId);
      }));
    };
  }
}

function saveEmployeeNote(ev) {
  ev.preventDefault();
  const form = ev.target;
  const note = form.note.value.trim();
  if (!note) return;
  const empId = state.editingEmployeeId;
  safely(async () => {
    await cloud.addEmployeeNote(empId, note);
    form.reset();
    await loadEmployeeNotes(empId);
  });
}

/* ---------- Settings: a full page below the top bar ----------
   Settings used to be a dialog. It is a page now (#settings-view): a grouped
   rail on the left (a section picker on a phone), a fixed heading, ONE scroll
   region and an action bar. It sits on top of the app rather than replacing a
   view, so opening it changes nothing — the tab, board and date underneath are
   exactly as they were, and "Back to board" is only this page hiding again.

   Editing is by DRAFT. A field you touch is staged in state.settingsDraft and
   written only by Save changes; Discard puts the saved values back. The
   renderers read their field values through sdVal(), so a live update from
   another user redraws the page around what you are typing instead of over it.
   Each entry keeps a base() — a function that reads the saved value NOW — so a
   draft that ends up equal to what is saved (or whose target was deleted
   elsewhere) drops out by itself (sdPrune). Roles & permissions is staged the
   same way but goes through a before/after review before anything is written.

   The existing cloud calls are per-field, not one transaction, so a save is a
   sequence: whatever succeeds is cleared from the draft, whatever fails is
   kept and named, and the page never claims a rollback it cannot do. */
const SETTINGS_SECTIONS = {
  account:   { label: "My account",          group: "Personal",       hint: "Your profile and sign-in details." },
  engineers: { label: "Engineers",           group: "Board setup",    hint: "Who can run a mission, and the colour of their mission cards." },
  areas:     { label: "Service areas",       group: "Board setup",    hint: "Labels used across people, missions and hosts." },
  boards:    { label: "Boards",              group: "Board setup",    hint: "Board names and non-working days." },
  users:     { label: "Users",               group: "Administration", hint: "Accounts, access requests and status." },
  roles:     { label: "Roles & permissions", group: "Administration", hint: "Review what each role can see and change." },
};
const SETTINGS_GROUPS = { account: "Personal", board: "Board setup", admin: "Administration" };
const SETTINGS_TAB_KEY = "mpm-settings-section";

/* Each button declares the permission area it needs (data-area in index.html).
   "account" is everybody's, so the page always has at least one section and the
   Settings button is never a dead end. */
function settingsTabAllowed(btn) {
  const area = btn.dataset.area;
  if (area === "account") return true;
  if (area === "users-edit") return can("users", "edit");
  return can(area, "edit") || (area === "users" && can("users"));
}

function settingsEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* ----- drafts ----- */
function sdMap(section) { return state.settingsDraft[section] || (state.settingsDraft[section] = {}); }
function sdCount(section) { return Object.keys(sdMap(section || state.settingsTab)).length; }
function sdDirty(section) { return sdCount(section) > 0; }
function anySettingsDirty() { return Object.keys(state.settingsDraft).some(sdDirty); }
/* the value a field should show: what the user has typed, else what is saved */
function sdVal(section, key, saved) {
  const e = sdMap(section)[key];
  return e ? e.after : saved;
}
/* Stage `after` for a field. `base` reads the saved value right now; staging
   the saved value again is how a field is put back, and unstages it. */
function sdSet(section, key, after, label, base, meta) {
  const d = sdMap(section);
  if (settingsEq(base(), after)) delete d[key];
  else {
    const prev = d[key];
    // `before` is the value the user saw when they started editing this field —
    // the review compares it with what is saved by the time they confirm
    d[key] = Object.assign({ after, label, base, before: prev ? prev.before : base() }, meta || {});
  }
  if (state.settingsSave.phase !== "saving") state.settingsSave = { phase: "clean" };
  renderSettingsFooter();
}
function sdDiscard(section) { state.settingsDraft[section] = {}; }
function sdPrune() {
  for (const section of Object.keys(state.settingsDraft)) {
    const d = state.settingsDraft[section];
    for (const k of Object.keys(d)) {
      let cur;
      try { cur = d[k].base(); } catch (e) { cur = undefined; }
      if (cur === undefined || settingsEq(cur, d[k].after)) delete d[k];
    }
  }
}
/* a row whose fields carry a pending edit gets an accent, so it is visible
   which lines of a long list are unsaved */
function sdRowDirty(section, rowKey) {
  return Object.keys(sdMap(section)).some(k => k.split("|")[1] === rowKey);
}
function sdMarkRow(row, section, rowKey) {
  row.classList.toggle("st-dirty", sdRowDirty(section, rowKey));
}

/* ----- footer: the action bar ----- */
function settingsIdleText() {
  const tab = state.settingsTab;
  if (tab === "roles") return "Permission changes apply only after you review them.";
  if (tab === "users") {
    return can("users", "edit")
      ? "Account changes are saved from each person's own dialog."
      : "View only — you can see accounts but not change them.";
  }
  return "Changes apply when you save.";
}

function renderSettingsFooter() {
  if (!state.settingsOpen) return;
  const tab = state.settingsTab;
  const sv = state.settingsSave;
  const n = sdCount(tab);
  const dirty = n > 0;
  const status = $("#sv-status");
  const save = $("#btn-sv-save");
  const discard = $("#btn-sv-discard");
  let text, cls = "";
  if (sv.phase === "saving") { text = "Saving…"; cls = "saving"; }
  else if (sv.phase === "error") { text = sv.message; cls = "error"; }
  else if (dirty) {
    text = tab === "roles"
      ? `● ${n} permission ${n === 1 ? "change" : "changes"} ready to review`
      : `● Unsaved changes (${n})`;
    cls = "dirty";
  }
  else if (sv.phase === "saved") { text = "✓ " + sv.message; cls = "saved"; }
  else text = settingsIdleText();
  status.textContent = text;
  status.className = cls;
  const saving = sv.phase === "saving";
  save.classList.toggle("hidden", !dirty);
  discard.classList.toggle("hidden", !dirty);
  save.disabled = saving;
  discard.disabled = saving;
  save.textContent = tab === "roles" ? "Review changes" : sv.phase === "error" ? "Retry" : "Save changes";
}

function renderSettingsHead() {
  const tab = state.settingsTab;
  const meta = SETTINGS_SECTIONS[tab];
  $("#sv-crumb").textContent = meta.group;
  $("#sv-title").textContent = meta.label;
  $("#sv-hint").textContent = meta.hint;
  $("#btn-add-engineer").classList.toggle("hidden", !(tab === "engineers" && can("settings", "edit")));
  $("#btn-add-area").classList.toggle("hidden", !(tab === "areas" && can("settings", "edit")));
  $("#btn-add-board-settings").classList.toggle("hidden", !(tab === "boards" && can("settings", "edit")));
  $("#btn-add-user").classList.toggle("hidden", !(tab === "users" && can("users", "edit")));
}

function applySettingsTab() {
  const buttons = $$("#settings-tabs .settings-tab");
  const allowed = [];
  for (const btn of buttons) {
    const ok = settingsTabAllowed(btn);
    btn.classList.toggle("hidden", !ok);
    if (ok) allowed.push(btn.dataset.tab);
  }
  // Access can change under an open page (an admin edits the role, or a
  // Realtime update arrives). Whatever is no longer permitted loses its draft —
  // no write for it can go out — and the page falls back to My account.
  const lost = Object.keys(state.settingsDraft).filter(s => !allowed.includes(s) && sdDirty(s));
  for (const s of Object.keys(state.settingsDraft)) if (!allowed.includes(s)) sdDiscard(s);
  if (!allowed.includes(state.settingsTab)) state.settingsTab = "account";
  if (lost.length) {
    state.settingsSave = { phase: "clean" };
    toast(`Your access to ${SETTINGS_SECTIONS[lost[0]].label} changed, so the unsaved changes there were dropped.`, "warn");
  }
  for (const btn of buttons) {
    const on = btn.dataset.tab === state.settingsTab;
    btn.classList.toggle("active", on);
    if (on) btn.setAttribute("aria-current", "page"); else btn.removeAttribute("aria-current");
  }
  // The dividers between rail groups are .settings-group elements, so one goes
  // when everything under it does — otherwise a Viewer (My account only) would
  // be left looking at a heading with nothing under it.
  for (const g of $$("#settings-tabs .settings-group")) {
    const anyVisible = buttons.some(b => b.dataset.group === g.dataset.group && !b.classList.contains("hidden"));
    g.classList.toggle("hidden", !anyVisible);
  }
  for (const pane of $$("#settings-view .settings-pane")) {
    pane.classList.toggle("hidden", pane.dataset.pane !== state.settingsTab);
  }
  // the phone's stand-in for the rail
  const sel = $("#sv-select");
  let html = "", group = null;
  for (const btn of buttons) {
    if (btn.classList.contains("hidden")) continue;
    if (btn.dataset.group !== group) {
      if (group !== null) html += "</optgroup>";
      group = btn.dataset.group;
      html += `<optgroup label="${escapeHtml(SETTINGS_GROUPS[group] || group)}">`;
    }
    html += `<option value="${escapeHtml(btn.dataset.tab)}">${escapeHtml(SETTINGS_SECTIONS[btn.dataset.tab].label)}</option>`;
  }
  sel.innerHTML = html + (group !== null ? "</optgroup>" : "");
  sel.value = state.settingsTab;

  renderSettingsHead();
  if (state.settingsTab === "account") renderAccountPane();
  if (state.settingsTab === "users") renderUsersPane();
  if (state.settingsTab === "roles") renderRolesMatrix();
  renderSettingsFooter();
}

/* Everything on the page, drawn from the data plus the drafts. */
function renderSettings() {
  if (!state.settingsOpen) return;
  state.settingsStale = false;
  applySettingsTab();
  renderEngineerRows();
  renderAreaRows();
  renderBoardRows();
  // the counts under each table — cheap orientation, and they make an empty
  // list say so rather than showing a bare frame
  const n = (one, many, count) => `${count} ${count === 1 ? one : many}`;
  $("#engineers-count").textContent = n("engineer", "engineers", engineerPaneRows().length);
  $("#areas-count").textContent = n("service area", "service areas", D().areas.length);
  $("#boards-count").textContent = n("board", "boards", D().boards.length);
}

/* After a data refresh (Realtime, a role change, coming back to the tab). The
   page is redrawn from the new data around the drafts — but not while a control
   in it has focus: swapping the DOM under a caret or an open colour picker is
   how a half-typed name gets lost. That redraw waits for focus to leave. */
function settingsLiveRefresh() {
  if (!state.settingsOpen) return;
  sdPrune();
  const ae = document.activeElement;
  if (ae && $("#sv-scroll").contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) {
    state.settingsStale = true;
    renderSettingsFooter();
    return;
  }
  renderSettings();
}

/* ----- opening, leaving, section changes ----- */
function openSettingsView(tab) {
  if (state.settingsOpen) { if (tab) goSettingsTab(tab); return; }
  closeModal();
  hideContextMenu();
  hideDatePicker();
  closeFilterPops();
  hideToolbarMore();
  state.settingsReturn = { scrollY: window.scrollY };
  state.settingsOpen = true;
  state.settingsSave = { phase: "clean" };
  let remembered = null;
  try { remembered = localStorage.getItem(SETTINGS_TAB_KEY); } catch (e) { /* private mode */ }
  state.settingsTab = tab || (SETTINGS_SECTIONS[remembered] ? remembered : "account");
  document.body.classList.add("settings-open");
  $("#settings-view").classList.remove("hidden");
  renderSettings();
  window.scrollTo(0, 0);
  $("#sv-scroll").scrollTop = 0;
  $("#sv-title").focus({ preventScroll: true });
}

/* Back to the board. The page only hid it, so the view, board and date are
   still what they were; the board is redrawn because it was display:none (and
   so unmeasured) while Settings was up, and the scroll position comes back. */
function closeSettingsView() {
  if (!state.settingsOpen) return;
  settingsGuard(() => {
    state.settingsOpen = false;
    for (const s of Object.keys(state.settingsDraft)) sdDiscard(s);
    state.settingsSave = { phase: "clean" };
    state.settingsStale = false;
    closeModal();
    document.body.classList.remove("settings-open");
    $("#settings-view").classList.add("hidden");
    render();
    const y = state.settingsReturn ? state.settingsReturn.scrollY : 0;
    requestAnimationFrame(() => window.scrollTo(0, y));
    $("#btn-settings").focus({ preventScroll: true });
  });
}

function goSettingsTab(tab, onCancel) {
  if (tab === state.settingsTab) return;
  settingsGuard(() => {
    state.settingsTab = tab;
    state.settingsSave = { phase: "clean" };
    try { localStorage.setItem(SETTINGS_TAB_KEY, tab); } catch (e) { /* private mode */ }
    renderSettings();
    $("#sv-scroll").scrollTop = 0;
    $("#sv-title").focus({ preventScroll: true });
  }, onCancel);
}

/* Leaving with edits pending — another section, the board, signing out — asks
   first: keep editing, throw them away, or save and carry on. For permissions
   "save" is the review step, never a silent write. */
function settingsGuard(proceed, onCancel) {
  if (!state.settingsOpen || !sdDirty()) { proceed(); return; }
  const roles = state.settingsTab === "roles";
  const label = SETTINGS_SECTIONS[state.settingsTab].label;
  $("#unsaved-text").textContent = roles
    ? `You have staged permission changes in ${label}. They only take effect after you review and apply them.`
    : `You have unsaved changes in ${label}.`;
  $("#btn-unsaved-save").textContent = roles ? "Review changes" : "Save & continue";
  $("#btn-unsaved-keep").onclick = () => { _confirmCancel = null; closeModal(); if (onCancel) onCancel(); };
  $("#btn-unsaved-discard").onclick = () => {
    _confirmCancel = null;
    closeModal();
    sdDiscard(state.settingsTab);
    state.settingsSave = { phase: "clean" };
    renderSettings();
    proceed();
  };
  $("#btn-unsaved-save").onclick = () => { _confirmCancel = null; closeModal(); saveSettingsSection(proceed); };
  openModal("#modal-unsaved");
  // Esc or a click on the backdrop closes the dialog without choosing: that is
  // "keep editing", and the section picker must snap back to where it was
  _confirmCancel = onCancel || null;
}

function discardSettingsDraft() {
  if (state.settingsSave.phase === "saving") return;
  sdDiscard(state.settingsTab);
  state.settingsSave = { phase: "clean" };
  renderSettings();
  toast("Changes discarded.", "info");
}

/* ----- saving ----- */
/* Turn the draft into writes. Validation happens first and stops everything: a
   bad name should not leave half the page saved. */
function settingsSaveOps(section) {
  const d = sdMap(section);
  const ops = [], errors = [];

  if (section === "account") {
    const me = D().me || {};
    ops.push({
      keys: Object.keys(d), label: "Profile",
      // The full name is an admin's record of who somebody is (Users), not
      // something to edit here, so it goes back unchanged — update_my_profile
      // writes the whole row and would otherwise blank it. A blank display name
      // IS meaningful: the database fills it back in from the email address.
      run: () => cloud.updateMyProfile(me.fullName,
        "displayName" in d ? d.displayName.after : (me.displayName || ""),
        "phone" in d ? d.phone.after : (me.phone || "")),
    });
  }

  if (section === "engineers") {
    const rowKeys = [...new Set(Object.keys(d).map(k => k.split("|")[1]))];
    for (const rowKey of rowKeys) {
      const row = engineerPaneRows().find(r => r.key === rowKey);
      if (!row) continue;
      const who = row.name;
      const resolveId = async () => row.engineer ? row.engineer.id : cloud.ensureEngineerForProfile(row.profile.id);
      if (d["name|" + rowKey]) {
        const name = d["name|" + rowKey].after.trim();
        if (!name) errors.push(`The name of an engineer record can't be empty (${who}).`);
        else ops.push({ keys: ["name|" + rowKey], label: `${who}: name`, run: async () => cloud.saveEngineerField(await resolveId(), "name", name) });
      }
      if (d["link|" + rowKey]) {
        const link = d["link|" + rowKey].after || null;
        ops.push({ keys: ["link|" + rowKey], label: `${who}: account`, run: async () => cloud.saveEngineerField(await resolveId(), "profile_id", link) });
      }
      if (d["color|" + rowKey]) {
        const color = d["color|" + rowKey].after;
        // an engineer listed by role alone has no record yet — picking a colour
        // is what creates it
        ops.push({ keys: ["color|" + rowKey], label: `${who}: colour`, run: async () => cloud.saveEngineerField(await resolveId(), "color", color) });
      }
    }
  }

  if (section === "areas") {
    const effective = (a) => String(sdVal("areas", "name|" + a.id, a.name)).trim().toLowerCase();
    for (const a of D().areas) {
      if (d["name|" + a.id]) {
        const name = d["name|" + a.id].after.trim();
        if (!name) errors.push(`A service area needs a name (${a.name}).`);
        else if (D().areas.some(x => x.id !== a.id && effective(x) === name.toLowerCase())) errors.push(`There is already a service area called ${name}.`);
        else ops.push({ keys: ["name|" + a.id], label: `${a.name}: name`, run: () => cloud.saveAreaField(a.id, "name", name) });
      }
      if (d["color|" + a.id]) {
        const color = d["color|" + a.id].after;
        ops.push({ keys: ["color|" + a.id], label: `${a.name}: colour`, run: () => cloud.saveAreaField(a.id, "color", color) });
      }
    }
  }

  if (section === "boards") {
    const effective = (b) => String(sdVal("boards", "name|" + b.id, b.name)).trim().toLowerCase();
    for (const b of D().boards) {
      if (d["name|" + b.id]) {
        const name = d["name|" + b.id].after.trim();
        if (!can("boarddelete", "edit")) errors.push("Your role may not rename boards.");
        else if (!name) errors.push(`A board needs a name (${b.name}).`);
        else if (D().boards.some(x => x.id !== b.id && effective(x) === name.toLowerCase())) errors.push(`There is already a board called ${name}.`);
        else ops.push({ keys: ["name|" + b.id], label: `${b.name}: name`, run: () => cloud.renameBoard(b.id, name) });
      }
      if (d["weekend|" + b.id]) {
        const days = d["weekend|" + b.id].after.slice();
        ops.push({ keys: ["weekend|" + b.id], label: `${b.name}: non-working days`, run: () => cloud.saveBoardWeekendDays(b.id, days) });
      }
    }
  }
  return { ops, errors };
}

/* Run the section's writes one after another. What succeeds leaves the draft;
   what fails stays in it, named, so Retry sends only that. `then` (a guarded
   navigation waiting on this save) runs only if nothing failed. */
async function saveSettingsSection(then) {
  const section = state.settingsTab;
  if (state.settingsSave.phase === "saving" || !sdDirty(section)) return;
  if (section === "roles") { openPermReview(then); return; }

  const { ops, errors } = settingsSaveOps(section);
  if (errors.length) {
    state.settingsSave = { phase: "error", message: errors.join(" ") };
    renderSettingsFooter();
    return;
  }
  state.settingsSave = { phase: "saving" };
  renderSettingsFooter();
  const failed = [];
  let done = 0;
  for (const op of ops) {
    try {
      await op.run();
      for (const k of op.keys) delete sdMap(section)[k];
      done++;
    } catch (e) {
      failed.push({ label: op.label, message: (e && e.message) || String(e) });
    }
  }
  settingsSaveOutcome(section, ops.length, done, failed, then);
}

function settingsSaveOutcome(section, total, done, failed, then) {
  if (failed.length) {
    state.settingsSave = {
      phase: "error",
      message: (done ? `${done} of ${total} changes saved. ` : "Nothing was saved. ") +
        `Could not save ${failed.map(f => f.label).join("; ")} — ${failed[0].message}. ` +
        `Your edits are kept; use Retry. Saved changes are not rolled back.`,
    };
    toast("Some changes could not be saved.", "error");
  } else {
    state.settingsSave = { phase: "saved", message: "All changes saved." };
    toast("Saved.", "info");
  }
  renderSettings();
  if (!failed.length && then) then();
}

/* ----- Roles & permissions: review, then apply ----- */
function openPermReview(then) {
  const entries = Object.entries(sdMap("roles"));
  if (!entries.length) return;
  const label = { none: "—", view: "View", edit: "Edit" };
  const lv = (e, v) => (e.allowOnly && v === "edit") ? "Allowed" : label[v] || v;
  const body = $("#perm-review-body");
  body.innerHTML = "";
  let stale = 0;
  for (const [, e] of entries) {
    let cur;
    try { cur = e.base(); } catch (x) { cur = e.before; }
    const changedUnderneath = cur !== e.before;
    if (changedUnderneath) stale++;
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${escapeHtml(e.roleLabel)}</td>` +
      `<td>${escapeHtml(e.areaLabel)}</td>` +
      `<td>${escapeHtml(lv(e, cur))}${changedUnderneath ? ` <span class="rm-stale">(was ${escapeHtml(lv(e, e.before))} when you started)</span>` : ""}</td>` +
      `<td><b>${escapeHtml(lv(e, e.after))}</b></td>`;
    body.appendChild(tr);
  }
  const roles = [...new Set(entries.map(([, e]) => e.roleLabel))];
  $("#perm-review-intro").textContent =
    `${entries.length} ${entries.length === 1 ? "change" : "changes"} to ${roles.join(", ")}. ` +
    `They apply to everyone with ${roles.length === 1 ? "that role" : "those roles"} straight away, including anyone with the app open now.`;
  const warn = $("#perm-review-warn");
  warn.classList.toggle("hidden", !stale);
  warn.textContent = stale
    ? `${stale === 1 ? "One value was" : stale + " values were"} changed by someone else while you were editing. "Before" shows what is saved now; applying replaces it.`
    : "";
  $("#btn-perm-cancel").onclick = () => { closeModal(); };
  $("#btn-perm-apply").onclick = () => applyPermChanges(then);
  openModal("#modal-perm-review");
}

async function applyPermChanges(then) {
  if (state.settingsSave.phase === "saving") return;
  const entries = Object.entries(sdMap("roles"));
  closeModal();
  state.settingsSave = { phase: "saving" };
  renderSettingsFooter();
  const failed = [];
  let done = 0;
  for (const [key, e] of entries) {
    try {
      await cloud.setRolePermission(e.roleKey, e.areaKey, e.after);
      delete sdMap("roles")[key];
      done++;
    } catch (x) {
      failed.push({ label: `${e.roleLabel}: ${e.areaLabel}`, message: (x && x.message) || String(x) });
    }
  }
  // the change may have been to our own role — re-read access and redraw the
  // whole app (this also redraws Settings around whatever is left in the draft)
  try { await refreshAndRender(); } catch (x) { /* the outcome below still stands */ }
  settingsSaveOutcome("roles", entries.length, done, failed, then);
}

/* ---------- Settings -> Engineers ---------- */
/* The pane is a view of the people who may run a mission, not a list of loose
   records: everyone with the Engineer role is here because of their role, a
   manager or admin appears once they have been added with "Add engineer", and
   an engineer record with no account behind it stays until somebody links it.
   The colour is edited here for everyone; the name is edited only on a record
   with no account — otherwise name and phone belong to the account, and each
   person keeps their own number in My account. */
const DEFAULT_ENGINEER_COLOR = "#9ca3af";

function engineerPaneRows() {
  const rows = [];
  for (const d of D().directory) {
    // by role, or because somebody added them
    if (d.roleKey !== "engineer" && !d.engineerId) continue;
    const rec = d.engineerId ? D().engineers.find(e => e.id === d.engineerId) : null;
    rows.push({
      kind: "account", profile: d, engineer: rec,
      key: rec ? "e:" + rec.id : "p:" + d.id,
      name: d.displayName || d.fullName || "?", phone: d.phone || "",
      color: rec ? rec.color : DEFAULT_ENGINEER_COLOR,
    });
  }
  const throughAccount = new Set(D().directory.map(d => d.engineerId).filter(Boolean));
  for (const e of D().engineers) {
    if (throughAccount.has(e.id)) continue;
    rows.push({
      // "stranded": the account it points at is no longer an active engineer
      // (demoted, or disabled), so the person is not in the directory to show
      kind: e.profileId ? "stranded" : "record",
      key: "e:" + e.id,
      profile: null, engineer: e, name: e.name, phone: e.phone || "", color: e.color,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function renderEngineerRows() {
  const engBox = $("#settings-engineers");
  engBox.innerHTML = "";
  const rows = engineerPaneRows();
  if (!rows.length) {
    engBox.innerHTML = `<tr><td colspan="5" class="import-note">Nobody has the Engineer role yet. Give somebody that role under <b>Users</b>, or add a manager or admin here.</td></tr>`;
    return;
  }
  // accounts that could be linked to a record that has none: everyone in the
  // directory who isn't already an engineer in their own right
  const linkable = D().directory.filter(d => !d.engineerId);
  const baseOf = (key, prop) => () => { const r = engineerPaneRows().find(x => x.key === key); return r ? r[prop] : undefined; };

  for (const r of rows) {
    const rec = r.engineer;
    const row = document.createElement("tr");
    row.className = "st-row";

    const swatch = document.createElement("td");
    swatch.className = "st-swatch";
    swatch.dataset.label = "Colour";
    // The swatch IS the control. A bare <input type="color"> is drawn by the
    // browser as a colour chip inside its OWN bordered box, using a fixed grey
    // that ignores the theme — a box, inside a box, inside a table cell. The
    // .sw-pick wrapper strips that chrome (see styles.css) and prints the hex
    // beside it, so the value is never carried by colour alone.
    const pick = document.createElement("label");
    pick.className = "sw-pick";
    const color = document.createElement("input");
    color.type = "color";
    color.value = sdVal("engineers", "color|" + r.key, r.color);
    color.title = "Mission card colour";
    color.setAttribute("aria-label", `Colour for ${r.name}`);
    const hex = document.createElement("b");
    hex.textContent = swHex(color.value);
    color.oninput = () => {
      hex.textContent = swHex(color.value);
      sdSet("engineers", "color|" + r.key, color.value, `${r.name} colour`, baseOf(r.key, "color"));
      sdMarkRow(row, "engineers", r.key);
    };
    pick.appendChild(color);
    pick.appendChild(hex);
    swatch.appendChild(pick);

    const nameCell = document.createElement("td");
    nameCell.className = "st-primary";
    nameCell.dataset.label = "Name";
    if (r.kind === "record") {
      // no account behind it: the record's own name is still the only name
      // there is, so it stays editable until somebody links it
      const name = document.createElement("input");
      name.type = "text";
      name.value = sdVal("engineers", "name|" + r.key, r.name);
      name.placeholder = "Name";
      name.maxLength = 80;
      name.setAttribute("aria-label", "Engineer name");
      name.oninput = () => {
        sdSet("engineers", "name|" + r.key, name.value, `${r.name} name`, baseOf(r.key, "name"));
        sdMarkRow(row, "engineers", r.key);
      };
      nameCell.appendChild(name);
    } else {
      nameCell.classList.add("st-name");
      nameCell.textContent = r.name;
      if (r.profile && r.profile.fullName) nameCell.title = r.profile.fullName;
    }

    const phoneCell = document.createElement("td");
    phoneCell.className = "st-phone";
    phoneCell.dataset.label = "Phone";
    phoneCell.textContent = r.phone || "—";
    phoneCell.title = r.kind === "account"
      ? "Set by this person under Settings → My account."
      : "From the engineer record. Link it to an account and the number comes from there.";

    const acctCell = document.createElement("td");
    acctCell.className = "st-account";
    acctCell.dataset.label = "Account";
    if (r.kind === "account") {
      acctCell.innerHTML = `<span class="role-pill role-${escapeHtml(r.profile.roleKey || "none")}">${escapeHtml(roleLabel(r.profile.roleKey))}</span>`;
      // two kinds of mission owner, kept apart in words as well as by whether
      // they can be removed: on the list because of their role, or added by hand
      const via = document.createElement("span");
      via.className = "st-hint";
      via.textContent = r.profile.roleKey === "engineer" ? " from role" : " added manually";
      acctCell.appendChild(via);
      if (!rec) {
        const hint = document.createElement("span");
        hint.className = "st-hint";
        hint.textContent = " no colour yet";
        acctCell.appendChild(hint);
      }
    } else if (r.kind === "stranded") {
      // the account behind this record is not an active engineer any more —
      // demoted, or disabled. Unlinking is the way back to an ordinary record
      // that can be renamed and pointed at somebody else.
      acctCell.innerHTML = `<span class="st-hint">account is no longer an engineer</span> `;
      const unlink = document.createElement("button");
      unlink.type = "button";
      unlink.className = "btn btn-small";
      unlink.textContent = "Unlink";
      unlink.title = "Keep the engineer record and its colour, but stop reading the name and phone from that account.";
      unlink.onclick = () => safely(async () => {
        await cloud.saveEngineerField(rec.id, "profile_id", null);
        renderSettings();
      });
      acctCell.appendChild(unlink);
    } else {
      const link = document.createElement("select");
      link.setAttribute("aria-label", `Account for ${r.name}`);
      link.innerHTML = `<option value="">— no account —</option>` +
        linkable.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.displayName || d.fullName || "?")}</option>`).join("");
      link.value = sdVal("engineers", "link|" + r.key, "");
      link.title = "Link this record to the person's account — their name and phone number then come from it.";
      link.onchange = () => {
        sdSet("engineers", "link|" + r.key, link.value, `${r.name} account`, () => {
          const x = engineerPaneRows().find(q => q.key === r.key);
          return x === undefined ? undefined : "";
        });
        sdMarkRow(row, "engineers", r.key);
      };
      acctCell.appendChild(link);
    }

    const actCell = document.createElement("td");
    actCell.className = "st-act";
    // An Engineer-by-role is on this list because of their role: taking them
    // off it is a role change under Users, not a delete here. Everything else
    // — an added manager or admin, an unlinked record — can go.
    const removable = r.kind !== "account" || (rec && r.profile.roleKey !== "engineer");
    if (removable) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "st-del";
      del.title = `Remove ${r.name}`;
      del.setAttribute("aria-label", `Remove ${r.name}`);
      del.innerHTML = icon("close");
      del.onclick = () => showConfirm("Remove this engineer?",
        `${r.name} will no longer be offered on a mission, and their colour is forgotten. ` +
        `Missions that already name them keep their record of who ran them, but lose the engineer on the card.`,
        () => safely(async () => {
          await cloud.deleteEngineer(rec.id);
          for (const k of Object.keys(sdMap("engineers"))) if (k.split("|")[1] === r.key) delete sdMap("engineers")[k];
          renderSettings();
        }));
      actCell.appendChild(del);
    }

    row.append(swatch, nameCell, phoneCell, acctCell, actCell);
    sdMarkRow(row, "engineers", r.key);
    engBox.appendChild(row);
  }
}

/* "Add engineer": for the manager or admin who runs missions themselves.
   Everyone with the Engineer role is on the list already, so the picker only
   offers accounts that are not there yet. */
function openAddEngineerModal() {
  const form = $("#form-add-engineer");
  const note = $("#add-engineer-note");
  const free = D().directory.filter(d => !d.engineerId && d.roleKey !== "engineer");
  form.profileId.innerHTML = free
    .map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.displayName || d.fullName || "?")} — ${escapeHtml(roleLabel(d.roleKey))}</option>`)
    .join("");
  const none = !free.length;
  form.profileId.disabled = none;
  $("#form-add-engineer button[type=submit]").disabled = none;
  note.textContent = none
    ? (D().directory.length
        ? "Everyone who can be added is already on the list. Anyone else needs an account with the Engineer role or above first, under Users."
        : "Adding engineers by account needs the one-time database update (migration-2026-09-06-display-names.sql).")
    : "They get a colour of their own and can be picked in the Engineer box on a mission. Their name and phone number come from their account.";
  openModal("#modal-add-engineer");
}

function addEngineerFromModal(ev) {
  ev.preventDefault();
  const profileId = ev.target.profileId.value;
  if (!profileId) return;
  safely(async () => {
    await cloud.addEngineer(profileId);
    reopenSettings();
    render();
  });
}

/* ---------- Settings -> Service areas ---------- */
function renderAreaRows() {
  const areaBox = $("#settings-areas");
  areaBox.innerHTML = "";
  if (!D().areas.length) {
    areaBox.innerHTML = `<tr><td colspan="3" class="import-note">No service areas yet. Use <b>Add area</b> to create the first one.</td></tr>`;
    return;
  }
  const baseOf = (id, prop) => () => { const a = D().areas.find(x => x.id === id); return a ? a[prop] : undefined; };
  for (const a of D().areas) {
    const row = document.createElement("tr");
    row.className = "st-row";
    row.innerHTML = `
      <td class="st-swatch" data-label="Colour"><label class="sw-pick"><input type="color" title="Area colour" aria-label="Colour for ${escapeHtml(a.name)}"><b></b></label></td>
      <td class="st-primary" data-label="Name"><input type="text" maxlength="60" placeholder="Area name" aria-label="Area name"></td>
      <td class="st-act"><button type="button" class="st-del" title="Delete ${escapeHtml(a.name)}" aria-label="Delete ${escapeHtml(a.name)}">${icon("close")}</button></td>`;
    const color = row.querySelector('input[type="color"]');
    const hex = row.querySelector("b");
    const name = row.querySelector('input[type="text"]');
    const del = row.querySelector(".st-del");
    color.value = sdVal("areas", "color|" + a.id, a.color);
    hex.textContent = swHex(color.value);
    name.value = sdVal("areas", "name|" + a.id, a.name);
    color.oninput = () => {
      hex.textContent = swHex(color.value);
      sdSet("areas", "color|" + a.id, color.value, `${a.name} colour`, baseOf(a.id, "color"));
      sdMarkRow(row, "areas", a.id);
    };
    name.oninput = () => {
      sdSet("areas", "name|" + a.id, name.value, `${a.name} name`, baseOf(a.id, "name"));
      sdMarkRow(row, "areas", a.id);
    };
    del.onclick = () => {
      const people = D().employees.filter(e => e.areaId === a.id).length;
      if (people) {
        showConfirm("Cannot delete", `${a.name} still has ${people} employee${people === 1 ? "" : "s"}. Reassign them first.`, () => {});
        return;
      }
      const hosts = (D().hosts || []).filter(h => h.areaId === a.id).length;
      showConfirm(`Delete ${a.name}?`,
        `This removes the service area.` + (hosts ? ` ${hosts} host${hosts === 1 ? "" : "s"} using it will have no area set.` : "") +
        ` It has no employees, so nobody loses their area. This cannot be undone.`,
        () => safely(async () => {
          await cloud.deleteArea(a.id);
          for (const k of Object.keys(sdMap("areas"))) if (k.split("|")[1] === a.id) delete sdMap("areas")[k];
          renderSettings();
        }));
    };
    sdMarkRow(row, "areas", a.id);
    areaBox.appendChild(row);
  }
}

function openAddAreaModal() {
  const form = $("#form-add-area");
  form.reset();
  form.areaColor.value = "#9ca3af";
  form.areaColor.parentElement.querySelector("b").textContent = swHex(form.areaColor.value);
  $("#add-area-error").classList.add("hidden");
  openModal("#modal-add-area");
  form.areaName.focus();
}

function addAreaFromModal(ev) {
  ev.preventDefault();
  const form = ev.target;
  const name = form.areaName.value.trim();
  const err = $("#add-area-error");
  const problem = !name ? "Give the area a name."
    : D().areas.some(a => a.name.trim().toLowerCase() === name.toLowerCase()) ? `There is already a service area called ${name}.`
    : "";
  err.textContent = problem;
  err.classList.toggle("hidden", !problem);
  if (problem) { form.areaName.focus(); return; }
  safely(async () => {
    await cloud.addArea(name, form.areaColor.value);
    closeModal();
    renderSettings();
    toast(`${name} added.`, "info");
  });
}

/* ---------- Settings -> Boards ---------- */
/* Weekly weekend days per board — set once at board creation and editable here
   afterwards. A board's name and ticked days are staged like every other field
   and saved together; the days drive the holiday toggle, the "Add Mission"
   weekend import, the date-picker's weekend highlighting and the Overview trend
   charts for that board. */
function renderBoardRows() {
  const boardsBox = $("#settings-boards");
  boardsBox.innerHTML = "";
  const boardOf = (id) => D().boards.find(x => x.id === id);
  for (const b of D().boards) {
    const row = document.createElement("tr");
    row.className = "st-row";
    const nameCell = document.createElement("td");
    nameCell.className = "st-board st-primary";
    nameCell.dataset.label = "Board";
    // Renaming shares the "Rename & delete boards" permission (Admin only by
    // default; a trigger enforces it). A blank or duplicate name is refused when
    // you save, and says so, rather than being put back silently.
    let nameEl;
    if (can("boarddelete", "edit")) {
      nameEl = document.createElement("input");
      nameEl.type = "text";
      nameEl.className = "settings-board-name";
      nameEl.value = sdVal("boards", "name|" + b.id, b.name);
      nameEl.placeholder = "Board name";
      nameEl.maxLength = 60;
      nameEl.setAttribute("aria-label", "Board name");
      nameEl.oninput = () => {
        sdSet("boards", "name|" + b.id, nameEl.value, `${b.name} name`, () => { const x = boardOf(b.id); return x ? x.name : undefined; });
        sdMarkRow(row, "boards", b.id);
      };
    } else {
      nameEl = document.createElement("div");
      nameEl.className = "settings-board-name";
      nameEl.textContent = b.name;
    }
    const daysCell = document.createElement("td");
    daysCell.className = "st-days";
    daysCell.dataset.label = "Non-working days";
    const picker = document.createElement("div");
    picker.className = "weekday-picker settings-board-days";
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", `Non-working days for ${b.name}`);
    const shown = sdVal("boards", "weekend|" + b.id, b.weekendDays.slice().sort((x, y) => x - y));
    for (let i = 0; i < DOW_LABELS.length; i++) {
      const lab = document.createElement("label");
      lab.className = "weekday-chip";
      lab.innerHTML = `<input type="checkbox" value="${i}" ${shown.includes(i) ? "checked" : ""}> ${DOW_LABELS[i]}`;
      // The checkbox stays in the DOM for keyboard and screen readers; the cell
      // it sits in is what you actually see (see .weekday-picker in styles.css).
      // The .on class rather than :has(:checked) so the selected day still reads
      // correctly on the older browsers some of the factory PCs run.
      lab.classList.toggle("on", shown.includes(i));
      lab.querySelector("input").onchange = (ev) => {
        lab.classList.toggle("on", ev.target.checked);
        const days = Array.from(picker.querySelectorAll("input:checked")).map(c => Number(c.value)).sort((x, y) => x - y);
        sdSet("boards", "weekend|" + b.id, days, `${b.name} non-working days`,
          () => { const x = boardOf(b.id); return x ? x.weekendDays.slice().sort((p, q) => p - q) : undefined; });
        sdMarkRow(row, "boards", b.id);
      };
      picker.appendChild(lab);
    }
    nameCell.appendChild(nameEl);
    daysCell.appendChild(picker);
    row.appendChild(nameCell);
    row.appendChild(daysCell);
    // Delete is its own permission (Roles & permissions → "Rename & delete boards",
    // Admin only by default) because it takes every mission on the board with it.
    const actCell = document.createElement("td");
    actCell.className = "st-act";
    if (can("boarddelete", "edit")) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "st-del";
      del.title = `Delete ${b.name}`;
      del.setAttribute("aria-label", `Delete ${b.name}`);
      del.innerHTML = icon("close");
      del.onclick = () => confirmDeleteBoard(b);
      actCell.appendChild(del);
    }
    row.appendChild(actCell);
    sdMarkRow(row, "boards", b.id);
    boardsBox.appendChild(row);
  }
}

/* Deleting a board cascades to its missions, plans, overrides and forecasts in
   the database — and to its employees, which is why a board that still has
   people on it is refused rather than confirmed: move them first. */
function confirmDeleteBoard(b) {
  const back = () => {};
  if (D().boards.length <= 1) {
    showConfirm("Cannot delete", `${b.name} is the only board. Create another board before deleting this one.`, back, back);
    return;
  }
  const people = D().employees.filter(e => e.boardId === b.id).length;
  if (people) {
    showConfirm("Cannot delete",
      `${b.name} still has ${people} employee${people === 1 ? "" : "s"}. Move them to another board first.`, back, back);
    return;
  }
  showConfirm(`Delete ${b.name}?`,
    `This permanently deletes the board ${b.name} with all of its missions, plans, holidays and forecasts. ` +
    `This cannot be undone.`,
    () => safely(async () => {
      await cloud.deleteBoard(b.id);
      if (D().activeBoardId === b.id) D().activeBoardId = firstAllowedView();
      for (const k of Object.keys(sdMap("boards"))) if (k.split("|")[1] === b.id) delete sdMap("boards")[k];
      renderSettings();
    }),
    back);
}

/* ---------- export to JPG ---------- */
/* The available pools live in the floating panel, which sits outside the capture
   area — so for the export we rebuild them as ordinary rails inside it. Built
   from data (not cloned from the panel) so an active search/area filter or a
   live selection never leaks into the exported image. */
function buildExportPools() {
  const sec = document.createElement("section");
  sec.id = "export-pools";
  const unassigned = unassignedEmployees();
  const groups = [
    { key: "standby", cls: "zone-pool", label: "Standby", sub: "permanent, unassigned", list: sortEmployeesDisplay(unassigned.filter(e => e.contract !== "oncall")) },
    { key: "oncall", cls: "zone-oncall-pool", label: "Available On-call", sub: "not flagged", list: sortEmployeesDisplay(unassigned.filter(e => e.contract === "oncall")) },
  ];
  // same rule as the leave zones (hideEmptyLeaveZonesForExport): an empty pool
  // ("Standby (0) — None") is padding, not information — skip it entirely
  // rather than printing a row that says nothing
  for (const g of groups.filter(g => g.list.length)) {
    const zone = document.createElement("div");
    zone.className = "zone " + g.cls;
    const lab = document.createElement("div");
    lab.className = "zone-label";
    lab.innerHTML = `${g.label} (${g.list.length})<br><small>${g.sub}</small>`;
    const body = document.createElement("div");
    body.className = "zone-body";
    for (const emp of g.list) {
      const c = empCard(emp);
      c.classList.remove("selected");   // never show selection state in an export
      c.draggable = false;
      body.appendChild(c);
    }
    zone.appendChild(lab);
    zone.appendChild(body);
    sec.appendChild(zone);
  }
  return sec;
}

/* Masonry layout for the mission grid — used BOTH on screen and in the export.
   Each card keeps its own natural height and is dropped into whichever column is
   currently shortest (the first row fills left-to-right in number order), so the
   cards below rise into the gaps instead of every card in a row stretching to
   the tallest — the CSS-grid behaviour we're replacing. Recomputes from the
   grid's live width, so it adapts to window resizing and to the wider export
   capture alike. Cards that are display:none (e.g. empty missions hidden for the
   export) are skipped. Safe/no-op when the grid is hidden or empty. */
/* The column floor is not a taste value — it is the width at which three
   employee cards still fit side by side in a mission body, which is what keeps
   a crew from rendering taller than it needs to (and the exported JPG from
   growing in height). Derive it, don't guess it:

     card width W
     − 1px left border − 1px right border                 → W −  2
     − 8px body padding, both sides                        → W − 18
     must hold 3 × 116px .emp-card + two 6px flex gaps = 360
     → W ≥ 378

   390 leaves a 12px cushion. If .emp-card's width goes above 120px this
   silently drops back to two per row — the failure is quiet, so re-derive
   this sum rather than eyeballing the board. */
const MASONRY_GAP = 12, MASONRY_MIN_CARD = 390;
/* A shared board must not depend on whose desk it was exported from. On screen
   the column count is derived from the available width, so a 1920px monitor was
   producing a 4-column JPG and a 1600px one a 3-column JPG of the same day —
   the same plan arriving in the LINE group in two different shapes. The export
   pins both numbers instead: EXPORT_WIDTH is forced onto #board-capture (see
   body.exporting in styles.css) AND handed to html2canvas, so the geometry
   layoutMasonry computes and the geometry html2canvas renders cannot drift
   apart, and EXPORT_COLS overrides the derived column count. The print path
   fixes the same 3 columns its own way — see @media print. */
const EXPORT_WIDTH = 1600, EXPORT_COLS = 3;
/* forceCols pins the column count instead of deriving it from the width — the
   export passes EXPORT_COLS so every JPG of a given day comes out the same
   shape whatever monitor made it. On screen it is always omitted. */
function layoutMasonry(forceCols) {
  const grid = $("#missions-grid");
  if (!grid || grid.classList.contains("hidden")) return;
  const W = grid.clientWidth;
  if (!W) return;
  const cards = [...grid.children].filter(
    c => c.classList && c.classList.contains("mission-card") && c.style.display !== "none");
  const cols = forceCols || Math.max(1, Math.floor((W + MASONRY_GAP) / (MASONRY_MIN_CARD + MASONRY_GAP)));
  const colW = Math.floor((W - MASONRY_GAP * (cols - 1)) / cols);
  cards.forEach(c => {
    c.style.position = "absolute"; c.style.width = colW + "px";
    c.style.left = "0px"; c.style.top = "0px"; c.style.height = "auto";
  });
  if (!cards.length) { grid.style.height = "0px"; return; }
  void grid.offsetWidth;   // reflow so each card's natural height is final at colW
  const colH = new Array(cols).fill(0);
  cards.forEach((c, i) => {
    // first row fills left-to-right in order; after that each card drops into the
    // shortest column, so it rises into whatever gap the row above left behind
    const j = i < cols ? i : colH.indexOf(Math.min(...colH));
    c.style.left = (j * (colW + MASONRY_GAP)) + "px";
    c.style.top = colH[j] + "px";
    // getBoundingClientRect(), not offsetHeight: offsetHeight is ROUNDED to a
    // whole pixel, and summing ~9 rounded card heights down a column drifts
    // several px below the real bottom. The grid then declares itself shorter
    // than its own absolutely-positioned children reach — invisible on screen,
    // but in print that overflow does not fit the page the height was measured
    // for, and Chrome moves the whole unbreakable grid onto a second sheet.
    colH[j] += c.getBoundingClientRect().height + MASONRY_GAP;
  });
  // ceil so the declared height can never land under the true content bottom
  grid.style.height = Math.ceil(Math.max(...colH) - MASONRY_GAP) + "px";
}

/* For the export only, hide any mission that has no crew on it, so an empty
   mission box doesn't pad the JPG. Returns a closure that unhides them again.
   (layoutMasonry skips display:none cards, so hidden missions leave no gap.) */
function hideEmptyMissionsForExport() {
  const hidden = [];
  for (const card of $$("#missions-grid > .mission-card")) {
    if (card.querySelectorAll(".mission-emps .emp-card").length === 0) {
      card.style.display = "none";
      hidden.push(card);
    }
  }
  return () => { for (const c of hidden) c.style.display = ""; };
}

/* For the export only, hide any leave-type zone that has nobody in it (e.g. no
   Sick Leave today) so the image isn't padded with empty boxes. If every leave
   zone is empty, hide the whole strip. Returns a function that unhides them
   again so the live board still shows all zones as drop targets. */
function hideEmptyLeaveZonesForExport() {
  const hidden = [];
  for (const box of $$("#status-zones .zone-leave")) {
    const body = box.querySelector(".zone-body");
    if (!body || body.querySelectorAll(".emp-card").length === 0) {
      box.style.display = "none";
      hidden.push(box);
    }
  }
  const strip = $("#status-zones");
  const stripHidden = hidden.length === $$("#status-zones .zone-leave").length;
  if (stripHidden) strip.style.display = "none";
  return () => {
    for (const box of hidden) box.style.display = "";
    if (stripHidden) strip.style.display = "";
  };
}

async function exportBoard() {
  // the JPG goes to LINE: a forecast (or the capacity grid) never does
  if (isForecastView() || isCapacity()) { toast("Forecasts are tentative and are never exported.", "info"); return; }
  const btn = $("#btn-export");
  btn.disabled = true;
  btn.textContent = "Exporting…";
  const board = D().boards.find(b => b.id === D().activeBoardId);
  // the Overview names the board its selector is on, so a one-board export
  // can't be mistaken for the all-boards picture
  const ovScope = isOverview() ? ovScopeBoards() : [];
  const boardName = isOrgChart() ? "Org_Chart" : board ? board.name
    : ovScope.length === 1 && D().boards.length > 1 ? `${ovScope[0].name} Overview` : "Overview";
  $("#capture-title").textContent = isOrgChart() ? "Organisation Chart" : boardName + " Manpower Board";
  $("#capture-date").innerHTML = `${fmtDow(state.date)} ${fmtDate(state.date)}<small>${fmtDateThai(state.date)}</small>`;
  $("#capture-header").classList.remove("hidden");
  document.body.classList.add("exporting");
  // The org chart lives in a fixed-height, clipped pan/zoom viewport; the class
  // below expands it to its natural size and neutralises the pan transform so
  // the whole tree is captured, not just what's on screen.
  if (isOrgChart()) document.body.classList.add("org-capturing");
  // The exported JPG is a shared artifact (printed, posted, sent to a customer) —
  // it must not depend on the viewer's own dark-mode preference. Force light for
  // the capture, since --bg/--panel/--emp-card etc. all redefine under
  // [data-theme="dark"].
  const wasDark = document.documentElement.getAttribute("data-theme") === "dark";
  if (wasDark) document.documentElement.removeAttribute("data-theme");
  // temporarily fold the available pools into the captured board — but not on a
  // holiday, where only the employees actually assigned to work should show up
  // (standby/available on-call are meaningless when nobody is expected in)
  let pools = null;
  if (!isOverview() && !isOrgChart() && !isNonWorkingDate(state.date)) {
    const built = buildExportPools();
    if (built.children.length) {   // both pools empty (fully staffed) — nothing to show
      pools = built;
      $("#status-zones").insertAdjacentElement("afterend", pools);
    }
  }
  let restoreEmptyMissions = null;
  let restoreLeaveZones = null;
  try {
    await document.fonts.ready;   // avoid capturing the fallback font mid-swap
    // On a real board only (the Overview / Org Chart captures have no mission grid):
    // drop the empty missions and empty leave zones, then re-pack the masonry at the
    // wider export width so the JPG is as tight as possible.
    if (!isOverview() && !isOrgChart()) {
      restoreEmptyMissions = hideEmptyMissionsForExport();
      restoreLeaveZones = hideEmptyLeaveZonesForExport();
      layoutMasonry(EXPORT_COLS);
    }
    const el = $("#board-capture");
    // Deliberately a constant, not max(scrollWidth, 1600): body.exporting has
    // already forced #board-capture to exactly EXPORT_WIDTH, so measuring the
    // real document here would hand html2canvas a different width than the one
    // the cards were just laid out at. See EXPORT_WIDTH. The org chart is the
    // exception — its tree can be wider than a board, and org-capturing lets
    // #board-capture size to that content, so measure it and capture at least
    // that wide (still capped by the maxDim scale guard below).
    const windowWidth = isOrgChart() ? Math.max(EXPORT_WIDTH, el.scrollWidth) : EXPORT_WIDTH;
    // Many mobile GPUs (Android especially) silently return a blank/black canvas
    // once its pixel dimensions pass roughly 4096px on a side or ~16.7M px total,
    // instead of erroring — that's the "export sometimes comes out all black" bug.
    // Render once at scale 1 to measure the real size, then pick the largest scale
    // (up to 3x) that stays safely under that limit.
    const probe = await html2canvas(el, { scale: 1, backgroundColor: "#ffffff", windowWidth });
    const maxDim = 4000;
    const scale = Math.max(1, Math.min(3, maxDim / probe.width, maxDim / probe.height));
    const canvas = scale === 1 ? probe : await html2canvas(el, { scale, backgroundColor: "#ffffff", windowWidth });
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/jpeg", 0.92);
    a.download = `${boardName.replace(/\s+/g, "_")}_${state.date}.jpg`;
    a.click();
  } finally {
    if (restoreEmptyMissions) restoreEmptyMissions();   // unhide the empty missions again
    if (restoreLeaveZones) restoreLeaveZones();          // unhide the empty leave zones again
    if (pools) pools.remove();
    $("#capture-header").classList.add("hidden");
    document.body.classList.remove("exporting", "org-capturing");
    if (wasDark) document.documentElement.setAttribute("data-theme", "dark");
    btn.disabled = false;
    setIconLabel(btn, "download", "Export");
    if (!isOverview() && !isOrgChart()) layoutMasonry();   // re-pack at the normal on-screen width
  }
}

/* ---------- Excel export ----------
   The board's day as rows in a spreadsheet, one per person on a mission, for
   planners who want to sort, filter or hand it to someone who lives in Excel.
   The sheet itself (TRIGO banner, table, totals) is built by xlsx-export.js;
   this side only gathers the people and asks which columns / sheets to include.
   Sheet 1 is the mission grid (one row per person on a mission, like the JPG).
   People with no mission go on their own sheets, one per reason: all the leave
   types plus Exchange Working Day, permanent Standby, and Available On-call.
   ExcelJS is ~1 MB and almost nobody opens this dialog, so it is fetched on the
   first export, not at page load. */
const XLSX_PREF_KEY = "manpower.xlsxColumns";
const XLSX_LANG_KEY = "manpower.xlsxLang";   // "en" | "th" — the file language, shared by both Excel exports
const XLSX_SHEETS_OFF_KEY = "manpower.xlsxSheetsOff";   // sheets the user switched off; default is all on
const XLSX_SHEET_LABELS = { leave: "Leave & Exchange Working Day", standby: "Standby (permanent, unassigned)", oncall: "Available On-call (unassigned)" };
let xlsxLibPromise = null;

/* JSZip (~100 KB) adds the native chart to the Capacity workbook (ExcelJS
   cannot write charts); like ExcelJS it is fetched on first use only. */
let jszipLibPromise = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipLibPromise) {
    jszipLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/jszip.min.js";
      s.onload = () => resolve(window.JSZip);
      s.onerror = () => { jszipLibPromise = null; reject(new Error("Could not load the Excel chart library. Check the connection and try again.")); };
      document.head.appendChild(s);
    });
  }
  return jszipLibPromise;
}
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!xlsxLibPromise) {
    xlsxLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/exceljs.min.js";
      s.onload = () => resolve(window.ExcelJS);
      s.onerror = () => { xlsxLibPromise = null; reject(new Error("Could not load the Excel library. Check the connection and try again.")); };
      document.head.appendChild(s);
    });
  }
  return xlsxLibPromise;
}

/* remembered per device; anything unreadable or stale falls back to every column */
function xlsxSavedColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem(XLSX_PREF_KEY));
    const keys = ManpowerXlsx.normalizeColumns(saved).map(c => c.key);
    if (Array.isArray(saved) && keys.length) return keys;
  } catch (e) { /* private mode / bad JSON */ }
  return ManpowerXlsx.ALL_KEYS;
}

/* File language for the Excel exports. English unless Thai was picked before. */
function xlsxSavedLang() {
  try { return localStorage.getItem(XLSX_LANG_KEY) === "th" ? "th" : "en"; } catch (e) { return "en"; }
}
function setXlsxLangRadios(name, lang) {
  for (const r of $$(`input[name="${name}"]`)) r.checked = r.value === lang;
}
/* reads the picked language back and remembers it */
function takeXlsxLang(name) {
  const picked = $(`input[name="${name}"]:checked`);
  const lang = picked && picked.value === "th" ? "th" : "en";
  try { localStorage.setItem(XLSX_LANG_KEY, lang); } catch (e) { /* remembering is a courtesy */ }
  return lang;
}

/* one row per person on a mission, missions in the order the board shows them,
   people permanent-first then by name (same as the cards) */
function xlsxRows() {
  const boardId = D().activeBoardId;
  const missions = getPlan().missions.filter(m => !m.hidden);
  if (state.sort) {
    missions.sort((a, b) =>
      missionSortValue(a).localeCompare(missionSortValue(b)) || a.number.localeCompare(b.number));
  }
  const rows = [];
  for (const m of missions) {
    const eng = D().engineers.find(e => e.id === m.engineerId);
    // same line the mission card shows: the host's own note first, then this mission's PPE
    const ppe = [(hostRecordOf(m.host) || {}).note, m.ppe].filter(Boolean).join(" + ");
    const emps = m.members
      .map(id => D().employees.find(e => e.id === id))
      .filter(e => e && e.boardId === boardId && onRoster(e));
    for (const e of sortEmployeesDisplay(emps)) {
      const area = D().areas.find(a => a.id === e.areaId);
      const pos = e.position ? POSITIONS[e.position] : null;
      rows.push({
        empId: e.id, name: e.name, nameEn: e.nameEn || "", trigoId: e.trigoId || "", contract: e.contract === "oncall" ? "On-call" : "Permanent",
        position: pos ? pos.label : "", phone: e.phone || "", startDate: e.startDate || "", area: area ? area.name : "", mission: m.number, host: m.host,
        customer: m.customer, ppe, shift: m.shift === "night" ? "Night" : "Day", start: m.startTime, end: m.endTime,
        engineer: eng ? eng.name : "", remark: m.remark || "",
      });
    }
  }
  return rows;
}

/* People with no mission, split by reason. Same roster rules as the mission
   members. Standby and Available On-call are skipped on a non-working day, as
   the JPG does: nobody is expected in, so "unassigned" means nothing there. */
function xlsxGroups() {
  const boardId = D().activeBoardId;
  const plan = getPlan();
  const person = (e, extra) => {
    const area = D().areas.find(a => a.id === e.areaId);
    const pos = e.position ? POSITIONS[e.position] : null;
    return Object.assign({
      empId: e.id, name: e.name, nameEn: e.nameEn || "", trigoId: e.trigoId || "", contract: e.contract === "oncall" ? "On-call" : "Permanent",
      position: pos ? pos.label : "", area: area ? area.name : "", phone: e.phone || "", startDate: e.startDate || "",
    }, extra);
  };
  const leave = [];
  for (const z of LEAVE_ZONES) {
    const emps = (plan.zones[z] || [])
      .map(id => D().employees.find(e => e.id === id))
      .filter(e => e && e.boardId === boardId && onRoster(e));
    for (const e of sortEmployeesDisplay(emps)) {
      leave.push(person(e, { leaveKey: z, leaveEn: ZONE_LABELS[z], leaveTh: ZONE_LABELS_TH[z] }));
    }
  }
  const off = isNonWorkingDate(state.date);
  const free = off ? [] : sortEmployeesDisplay(unassignedEmployees());
  return {
    leave,
    standby: free.filter(e => e.contract !== "oncall").map(e => person(e)),
    oncall: free.filter(e => e.contract === "oncall").map(e => person(e)),
  };
}
function xlsxSheetsOff() {
  try { const v = JSON.parse(localStorage.getItem(XLSX_SHEETS_OFF_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) { /* private mode / bad JSON */ }
  return new Set();
}

function updateXlsxCount() {
  const boxes = $$("#xlsx-cols input[type=checkbox]");
  const n = boxes.filter(b => b.checked).length;
  $("#xlsx-count").textContent = `${n} of ${boxes.length} columns`;
  // only Excel needs columns (and somebody on the board)
  const xlsx = pickedExportType($("#board-export-type")) === "xlsx";
  $("#btn-xlsx-go").disabled = xlsx && (n === 0 || xlsxEmpty);
}
function setXlsxTicks(on) {
  for (const b of $$("#xlsx-cols input[type=checkbox]")) b.checked = on;
  updateXlsxCount();
}

/* Layout A (computer widths): row 1 ends with the tab's tools and Export at the
   right edge. On a board that is Names → Undo → Reset → Export; on the lists,
   Bulk edit → Export. Phones (where row 1 folds into the More dropdown) keep
   them in #toolbar-right. */
const ROW1_TOOLS_MQ = window.matchMedia("(min-width: 641px)");
function placeBoardRow1Tools(board) {
  const end = $("#row1-end"), right = $("#toolbar-right");
  const names = $("#card-names"), seg = names._seg, exp = $("#btn-export");
  const bulk = [$("#btn-emplist-bulk"), $("#btn-hostlist-bulk")];
  const wide = ROW1_TOOLS_MQ.matches;
  // layout A: row 1 ends with the tab's tools and Export, on every tab
  if (board && wide) {
    if (names.parentNode !== end) { end.prepend(names); if (seg) names.after(seg); }
  } else if (names.parentNode !== right) {
    right.insertBefore(names, $("#readonly-badge"));
    if (seg) names.after(seg);
  }
  const home = wide ? end : right;
  for (const b of bulk) if (b.parentNode !== home) home.append(b);
  if (home.lastElementChild !== exp) home.append(exp);
  // Overview and Org Chart have no row-1 controls but Export: one row, numbers left, Export right
  document.body.classList.toggle("toolbar-one-row", wide && (isOverview() || isOrgChart()));
}
ROW1_TOOLS_MQ.addEventListener("change", () => { placeBoardRow1Tools(document.body.classList.contains("board-view")); });

/* ---------- the one Export button ----------
   Every tab has the same Export button at the right edge of the toolbar. It
   opens that tab's export dialog, which starts with the file type: JPG, PDF
   and/or Excel, whichever the tab offers. The last type picked is remembered
   per tab on this device. */
const EXPORT_TYPES = { jpg: "JPG image", pdf: "PDF", xlsx: "Excel" };
const EXPORT_TYPE_KEY = "manpower.exportType.";   // + tab
function exportTypeSaved(tab, types) {
  try { const t = localStorage.getItem(EXPORT_TYPE_KEY + tab); if (types.includes(t)) return t; } catch (e) { /* remembering is a courtesy */ }
  return types[0];
}
/* the File type radios at the top of an export dialog */
function renderExportTypes(el, tab, types, onChange) {
  const selected = exportTypeSaved(tab, types);
  el.innerHTML = "<b>File type</b>" + types.map(t =>
    `<label><input type="radio" name="${tab}-export-type" value="${t}"${t === selected ? " checked" : ""}> ${EXPORT_TYPES[t]}</label>`).join("");
  for (const r of el.querySelectorAll("input")) {
    r.onchange = () => {
      try { localStorage.setItem(EXPORT_TYPE_KEY + tab, r.value); } catch (e) { /* remembering is a courtesy */ }
      if (onChange) onChange(r.value);
    };
  }
}
function pickedExportType(el) {
  const r = el.querySelector("input:checked");
  return r ? r.value : null;
}
function openExportModal() {
  if (isEmployeeList()) return openEmplistXlsxModal();
  if (isHostList()) return openHostlistExportModal();
  if (isCapacity()) return openCapExportModal();
  return openBoardExportModal();
}

/* Board, Overview and Org Chart: JPG or PDF of what is on screen, and on a
   board also Excel (the columns and extra sheets below the file type). */
let xlsxSummaryText = "";   // what the summary line says while Excel is picked
let xlsxEmpty = false;      // nobody on the board: Excel has nothing to write
function openBoardExportModal() {
  if (isForecastView()) { toast("Forecasts are tentative and are never exported.", "info"); return; }
  const board = isOverview() || isOrgChart() ? null : D().boards.find(b => b.id === D().activeBoardId);
  $("#board-export-title").textContent = "Export — " + (isOrgChart() ? "Org Chart" : board ? board.name : "Overview");
  const types = board ? ["jpg", "pdf", "xlsx"] : ["jpg", "pdf"];
  if (board) prepareXlsxPart(board);
  renderExportTypes($("#board-export-type"), board ? "board" : isOrgChart() ? "orgchart" : "overview", types, updateBoardExportModal);
  updateBoardExportModal();
  openModal("#modal-xlsx");
}
function updateBoardExportModal() {
  const type = pickedExportType($("#board-export-type")) || "jpg";
  const xlsx = type === "xlsx";
  $("#xlsx-part").classList.toggle("hidden", !xlsx);
  $("#board-export-hint").classList.toggle("hidden", xlsx);
  const what = `${isOrgChart() ? "Org Chart" : isOverview() ? "Overview" : (D().boards.find(b => b.id === D().activeBoardId) || {}).name} · ${fmtDow(state.date)} ${fmtDate(state.date)}.`;
  $("#xlsx-summary").textContent = xlsx ? xlsxSummaryText : what;
  $("#board-export-hint").textContent = type === "pdf"
    ? "Opens the print dialog — choose Save as PDF. Sharp at any zoom, and the host and phone links stay tappable. Send it as a file."
    : "Saves a high-resolution image. Use it where only an image will do; send it as a file, not a photo, so it stays sharp.";
  updateXlsxCount();
}
/* the Excel half of the dialog: summary, extra sheets and column ticks */
function prepareXlsxPart(board) {
  const rows = xlsxRows();
  const groups = xlsxGroups();
  const extra = ManpowerXlsx.GROUP_KEYS.filter(g => groups[g].length);
  xlsxEmpty = !rows.length && !extra.length;
  const sum = ManpowerXlsx.summarize(rows);
  const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  xlsxSummaryText = xlsxEmpty
    ? "Nobody is on this board for this date, so there is nothing to put in an Excel file."
    : `${board.name} · ${fmtDow(state.date)} ${fmtDate(state.date)} · ${pl(sum.total, "employee", "employees")} on ${pl(sum.missions, "mission", "missions")}. Tick the columns to include.`;
  // the extra sheets: only reasons somebody is actually in today, each with its head-count
  const off = xlsxSheetsOff();
  $("#xlsx-sheets-wrap").classList.toggle("hidden", !extra.length);
  $("#xlsx-sheets").innerHTML = extra.map(g => {
    const n = new Set(groups[g].map(r => r.empId)).size;
    return `<label class="import-row"><input type="checkbox" value="${g}"${off.has(g) ? "" : " checked"}><span class="import-info">${XLSX_SHEET_LABELS[g]} <small>${pl(n, "person", "people")}</small></span></label>`;
  }).join("");
  const saved = new Set(xlsxSavedColumns());
  $("#xlsx-cols").innerHTML = ManpowerXlsx.COLUMNS.map(c =>
    `<label class="import-row"><input type="checkbox" value="${c.key}"${saved.has(c.key) ? " checked" : ""}><span class="import-info">${c.label}</span></label>`).join("");
  for (const b of $$("#xlsx-cols input")) b.onchange = updateXlsxCount;
  setXlsxLangRadios("xlsx-lang", xlsxSavedLang());
}
function runBoardExport() {
  const type = pickedExportType($("#board-export-type")) || "jpg";
  if (type === "xlsx") return exportXlsx();
  closeModal();
  if (type === "pdf") printBoard(); else exportBoard();
}

async function exportXlsx() {
  const keys = $$("#xlsx-cols input[type=checkbox]:checked").map(b => b.value);
  if (!keys.length) return;
  const btn = $("#btn-xlsx-go");
  btn.disabled = true;
  btn.textContent = "Exporting…";
  try {
    // sheets offered in the dialog and ticked; the unticked ones are what gets remembered
    const offered = $$("#xlsx-sheets input[type=checkbox]");
    const picked = new Set(offered.filter(b => b.checked).map(b => b.value));
    try {
      localStorage.setItem(XLSX_PREF_KEY, JSON.stringify(keys));
      localStorage.setItem(XLSX_SHEETS_OFF_KEY, JSON.stringify(offered.filter(b => !b.checked).map(b => b.value)));
    } catch (e) { /* remembering is a courtesy */ }
    // read again: the board may have moved while the dialog was open
    const rows = xlsxRows();
    const all = xlsxGroups();
    const groups = {};
    for (const g of ManpowerXlsx.GROUP_KEYS) groups[g] = picked.has(g) ? all[g] : [];
    const board = D().boards.find(b => b.id === D().activeBoardId);
    const boardName = board ? board.name : "Board";
    const lang = takeXlsxLang("xlsx-lang");
    const [ExcelJS, logo] = await Promise.all([
      loadExcelJS(),
      fetch("logo-on-navy.png").then(r => r.ok ? r.arrayBuffer() : null).catch(() => null),   // no logo = wordmark text instead
    ]);
    const { workbook, summary } = await ManpowerXlsx.buildWorkbook(ExcelJS, {
      boardName, dateEn: `${fmtDow(state.date)} ${fmtDate(state.date)}`, dateTh: fmtDateThai(state.date), today: todayStr(), lang,
      columns: keys, rows, groups, logo,
    });
    const buf = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const name = `${boardName.replace(/\s+/g, "_")}_${state.date}${lang === "th" ? "_TH" : ""}.xlsx`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    closeModal();
    const sheets = ManpowerXlsx.GROUP_KEYS.filter(g => summary.groups[g]).map(g => ManpowerXlsx.GROUPS[g].sheetName);
    toast(`Exported ${summary.total} ${summary.total === 1 ? "employee" : "employees"} to ${name}`
      + (sheets.length ? `, plus ${sheets.join(", ")}.` : "."), "info");
  } catch (e) {
    toast("Excel export failed: " + (e.message || e), "error");
  } finally {
    btn.textContent = "Export";
    updateXlsxCount();
  }
}

/* ---------- print / PDF ----------

   The JPG export above exists for the places that only take an image. This is
   the same board as a VECTOR page, and it is the answer to the two things a
   JPG in a chat group cannot do:

   - It does not go blurry. A messenger re-encodes and downsizes an image on
     send, so board text arrives at a fraction of the pixels it left with. A PDF
     is sent as a file, and its text is drawn from outlines at whatever zoom the
     reader picks — pinching in stays sharp all the way down.
   - It keeps its links. The host name (hostNameHtml) and the engineer's
     phone (telLink) are real <a> elements, and Chrome writes them into the PDF
     as link annotations, so they are still tappable in the file itself.

   The DOM prep deliberately makes the same calls exportBoard makes — capture
   header on, empty missions and empty leave zones dropped, the two unassigned
   pools folded in, light theme forced — so the printed page and the exported
   image are one artifact in two formats, and a change to what belongs on a
   shared board only has to be made once (below, and in exportBoard).

   It hangs off beforeprint/afterprint rather than off the button alone so that
   Ctrl+P produces the same page as clicking PDF — a print stylesheet that only
   works via one button is a trap for whoever hits the keyboard shortcut. */

let printRestore = null;   // set while the DOM is in its printable state

function prepareForPrint() {
  if (printRestore) return;   // beforeprint can fire more than once per dialog
  // the Capacity export's PDF: print its sheet, nothing else (see runCapExport)
  if (capPrintJob) {
    const job = capPrintJob;
    const prevTitle = document.title;
    document.title = job.title;
    const r = job.sheet.getBoundingClientRect();
    setPrintPageSize({ width: r.width, height: Math.max(r.height, job.sheet.scrollHeight) });
    document.body.classList.add("printing-cap");
    printRestore = () => {
      capPrintJob = null;
      job.sheet.remove();
      document.title = prevTitle;
      document.body.classList.remove("printing-cap");
      clearPrintPageSize();
    };
    return;
  }
  // Ctrl+P reaches here without the (hidden) PDF button: a forecast or the
  // capacity grid prints a one-line notice instead of the tentative plan
  if (isForecastView() || isCapacity()) {
    document.body.classList.add("print-blocked");
    printRestore = () => document.body.classList.remove("print-blocked");
    return;
  }
  const board = D().boards.find(b => b.id === D().activeBoardId);
  // the Overview names the board its selector is on, so a one-board export
  // can't be mistaken for the all-boards picture
  const ovScope = isOverview() ? ovScopeBoards() : [];
  const boardName = isOrgChart() ? "Org_Chart" : board ? board.name
    : ovScope.length === 1 && D().boards.length > 1 ? `${ovScope[0].name} Overview` : "Overview";
  $("#capture-title").textContent = isOrgChart() ? "Organisation Chart" : boardName + " Manpower Board";
  $("#capture-date").innerHTML = `${fmtDow(state.date)} ${fmtDate(state.date)}<small>${fmtDateThai(state.date)}</small>`;
  $("#capture-header").classList.remove("hidden");
  // Save-as-PDF names the file after document.title, so without this every
  // print lands as "Manpower Management Board.pdf" whichever board and day it
  // is. Same shape as the JPG's name (see exportBoard). Restored in
  // printRestore below, so a cancelled dialog cannot leave the tab renamed.
  const prevTitle = document.title;
  document.title = `${boardName.replace(/\s+/g, "_")}_${state.date}`;
  // `exporting` carries the export-only layout (pinned capture width, no board
  // prompt); `printing` is this path's own hook. `org-capturing` expands the
  // org chart's clipped pan viewport so the whole tree is measured and printed.
  document.body.classList.add("exporting", "printing");
  if (isOrgChart()) document.body.classList.add("org-capturing");
  // Same reasoning as the export: a shared artifact must not carry the viewer's
  // own dark-mode preference — and a dark board wastes a cartridge besides.
  const wasDark = document.documentElement.getAttribute("data-theme") === "dark";
  if (wasDark) document.documentElement.removeAttribute("data-theme");

  let pools = null;
  if (!isOverview() && !isOrgChart() && !isNonWorkingDate(state.date)) {
    const built = buildExportPools();
    if (built.children.length) {
      pools = built;
      $("#status-zones").insertAdjacentElement("afterend", pools);
    }
  }
  let restoreEmptyMissions = null;
  let restoreLeaveZones = null;
  if (!isOverview() && !isOrgChart()) {
    restoreEmptyMissions = hideEmptyMissionsForExport();
    restoreLeaveZones = hideEmptyLeaveZonesForExport();
    // The masonry lays out at exactly the width body.exporting has just pinned
    // #board-capture to, which is the same width setPrintPageSize then makes the
    // page — so these absolute positions are already right on paper and nothing
    // has to be re-flowed. (This is why the print CSS no longer rebuilds the
    // grid: it only had to when the paper width was unknowable.)
    layoutMasonry(EXPORT_COLS);
  }
  // Measured last, after every other decision above has changed the height.
  // scrollHeight as well as the rect: the rect is the border box, while
  // scrollHeight also covers anything a descendant overflows by, which is
  // exactly what pushed the grid onto a second page.
  const cap = $("#board-capture");
  const capRect = cap.getBoundingClientRect();
  setPrintPageSize({ width: capRect.width, height: Math.max(capRect.height, cap.scrollHeight) });

  printRestore = () => {
    if (restoreEmptyMissions) restoreEmptyMissions();
    if (restoreLeaveZones) restoreLeaveZones();
    if (pools) pools.remove();
    $("#capture-header").classList.add("hidden");
    document.title = prevTitle;
    document.body.classList.remove("exporting", "printing", "org-capturing");
    if (wasDark) document.documentElement.setAttribute("data-theme", "dark");
    clearPrintPageSize();
    if (!isOverview() && !isOrgChart()) layoutMasonry();
  };
}

/* One page, exactly the size of the board — the whole point of the PDF.

   Paginating a board is destructive in a way paginating prose is not: a page
   break falls between two mission cards that belong to the same day, and the
   masonry has to be given up for a rigid grid because nothing can know how much
   height is left on the current sheet. Sizing the PAGE to the CONTENT instead
   removes the question. There is one page, so there are no breaks; the width is
   one we chose rather than one the paper imposed, so the masonry's own geometry
   is correct; and since a PDF's text is vector, a page far larger than any real
   sheet costs nothing — the reader zooms into it exactly as they would zoom into
   a photo of the board, only without it turning to mush.

   Injected as a <style> rather than written into styles.css because the height
   is only known at print time, and appended to <head> after the stylesheet so it
   wins the cascade. Chrome applies style changes made during beforeprint to the
   print that follows, which is what makes this work at all.

   mm rather than px: both are valid <length> in @page, but print plumbing is
   built around physical units, and mm is what a print dialog can show back to a
   person. A 4000px-tall board becomes a ~1058mm page — nothing a printer would
   accept as a sheet, and irrelevant, since this is read on a phone. Printing it
   to real A4 still works: the driver scales it to fit one sheet.

   There is a ceiling, far above anything this app will meet: a PDF page maxes
   out at 200in (5080mm) a side. A 200-mission board measures ~111in, so the
   limit is roughly 360 missions on a single day — hence no guard here. */
/* Two real exports (2026-09-07 and 2026-09-08) still split onto a second page
   after the masonry rounding fix below, each by almost exactly the same ~8px
   — 7.8px and 8.6px, on two boards whose measured heights differed from each
   other by over 100px. A drift that stays constant while the content that
   would accumulate it changes size is not the masonry sum; that was verified
   independently by replaying this exact function over a 24-card masonry grid
   built from real styles.css, which produced one page with room to spare. It
   points at the browser's own print rasteriser rounding CSS px to device px
   at print time — a step this code cannot observe or correct at the source,
   since it happens after this measurement and outside the DOM entirely.
   PRINT_SAFETY_PX buys back that margin. A PDF page is vector and is never
   actually printed to a physical sheet (see the file-level comment below), so
   a few extra millimetres of white space at the bottom costs nothing — it is
   cheaper than being wrong again the next time this ~8px shows up. */
const PRINT_SAFETY_PX = 24;
function setPrintPageSize(rect) {
  // Rounded UP to the next 0.1mm, never to nearest: @page is the hard edge, so
  // a size that rounds DOWN is a page fractionally shorter than its content and
  // the overflow starts a second sheet. Costs at most 0.1mm of white margin.
  const mm = (px) => (Math.ceil(px / 96 * 25.4 * 10) / 10).toFixed(1);
  let el = document.getElementById("print-page-size");
  if (!el) {
    el = document.createElement("style");
    el.id = "print-page-size";
    document.head.appendChild(el);
  }
  el.textContent = `@page { size: ${mm(Math.ceil(rect.width))}mm ${mm(Math.ceil(rect.height) + PRINT_SAFETY_PX)}mm; margin: 0; }`;
}

function clearPrintPageSize() {
  const el = document.getElementById("print-page-size");
  if (el) el.remove();
}

function restoreAfterPrint() {
  if (!printRestore) return;
  const done = printRestore;
  printRestore = null;   // cleared first, so a throw below can't wedge the board
  try {
    done();
  } catch (err) {
    // Clearing printRestore is not enough on its own: if the closure throws
    // part-way, whatever it had not undone yet stays applied — and the board
    // is left in its export layout with a stale @page, so the NEXT print
    // measures an already-exporting DOM and spills onto a second sheet. These
    // are the two that must come off no matter what.
    console.error("print restore failed", err);
    document.body.classList.remove("exporting", "printing", "org-capturing", "printing-cap");
    clearPrintPageSize();
  }
}

function printBoard() {
  // beforeprint does the work; this is only the trigger, so that the button and
  // the keyboard shortcut go down exactly the same path.
  window.print();
}

/* ---------- custom date picker (weekend columns highlighted) ---------- */
let dpMonth = null; // "YYYY-MM" currently displayed

function toggleDatePicker() {
  const pop = $("#datepicker-pop");
  if (!pop.classList.contains("hidden")) { pop.classList.add("hidden"); return; }
  dpMonth = state.date.slice(0, 7);
  renderDatePicker();
  pop.classList.remove("hidden");
  positionDatePicker();
  window.addEventListener("resize", positionDatePicker);
  window.addEventListener("orientationchange", positionDatePicker);
}
function hideDatePicker() {
  $("#datepicker-pop").classList.add("hidden");
  window.removeEventListener("resize", positionDatePicker);
  window.removeEventListener("orientationchange", positionDatePicker);
}

// Keeps the popup fully inside the viewport regardless of screen size/orientation
// or where the date button happens to sit (its position isn't fixed — the header
// can wrap on narrow screens), so no day column ever renders off-screen.
function positionDatePicker() {
  const pop = $("#datepicker-pop");
  if (pop.classList.contains("hidden")) return;
  const margin = 8;
  const r = $("#btn-date").getBoundingClientRect();

  const maxRight = Math.max(margin, window.innerWidth - pop.offsetWidth - margin);
  const right = Math.min(maxRight, Math.max(margin, window.innerWidth - r.right));
  pop.style.right = right + "px";

  const fitsBelow = r.bottom + 6 + pop.offsetHeight <= window.innerHeight - margin;
  const top = fitsBelow
    ? r.bottom + 6
    : Math.max(margin, r.top - 6 - pop.offsetHeight);
  pop.style.top = Math.min(top, window.innerHeight - pop.offsetHeight - margin) + "px";
}

function renderDatePicker() {
  const pop = $("#datepicker-pop");
  const [y, m] = dpMonth.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const startDow = first.getDay(); // Sunday-first grid (0 = Sunday)
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthName = first.toLocaleString("en-GB", { month: "long", year: "numeric" });

  const weekendCfg = D().boards.find(b => b.id === D().activeBoardId)?.weekendDays || [0, 6];
  let html = `<div class="dp-head">
    <button class="dp-nav" data-nav="-1">‹</button><span>${monthName}</span><button class="dp-nav" data-nav="1">›</button>
  </div><div class="dp-grid">`;
  ["Su","Mo","Tu","We","Th","Fr","Sa"].forEach((d, i) => {
    html += `<div class="dp-dow${weekendCfg.includes(i) ? " dp-weekend" : ""}">${d}</div>`;
  });
  for (let i = 0; i < startDow; i++) html += `<div class="dp-day dp-empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const cls = ["dp-day"];
    // amber = a special overridden day; red = the board's normal weekend
    if (hasOverride(iso)) cls.push("dp-override");
    else if (isWeekendDate(iso)) cls.push("dp-weekend");
    if (iso === todayStr()) cls.push("dp-today");
    if (iso === state.date) cls.push("dp-selected");
    const title = hasOverride(iso) ? (isNonWorkingDate(iso) ? ' title="Holiday"' : ' title="Working day"') : "";
    html += `<div class="${cls.join(" ")}"${title} data-date="${iso}">${d}</div>`;
  }
  html += `</div>`;
  pop.innerHTML = html;

  for (const b of pop.querySelectorAll(".dp-nav")) {
    b.onclick = (ev) => {
      ev.stopPropagation();
      let ny = y, nm = m + Number(b.dataset.nav);
      if (nm < 1) { nm = 12; ny--; }
      if (nm > 12) { nm = 1; ny++; }
      dpMonth = `${ny}-${String(nm).padStart(2, "0")}`;
      renderDatePicker();
      positionDatePicker();
    };
  }
  for (const cell of pop.querySelectorAll(".dp-day[data-date]")) {
    cell.onclick = () => { clearSelection(); state.date = cell.dataset.date; hideDatePicker(); refreshAndRender(); };
  }
}

/* ---------- weekend "Add Mission" (import from latest weekday) ---------- */
let importCandidates = [];
let importMode = "holiday";      // "holiday" | "forecast" — which list #modal-import is showing
let importForecastSrc = null;    // forecast mode: the confirmed day the list came from

function openImportModal() {
  if (isForecastView()) { openForecastAddModal(); return; }
  guardEdit(async () => {
    importMode = "holiday";
    $("#import-crew").classList.add("hidden");
    $("#import-list").innerHTML = '<p class="import-note">Loading…</p>';
    $("#import-source-note").textContent = "";
    openModal("#modal-import");
    try {
      const boardId = D().activeBoardId;
      const srcDate = await cloud.findLatestWeekdayMissionDate(boardId, state.date);
      if (!srcDate) {
        importCandidates = [];
        $("#import-list").innerHTML = '<p class="import-note">No missions found on recent weekdays to copy from.</p>';
        return;
      }
      importCandidates = (await cloud.getMissionsForDate(boardId, srcDate)).filter(m => !m.hidden);
      if (!importCandidates.length) {
        $("#import-list").innerHTML = '<p class="import-note">Every mission from that date is hidden. Unhide from "Hide/Unhide" first if you want to bring one forward.</p>';
        return;
      }
      $("#import-source-note").textContent =
        `Missions from ${fmtDow(srcDate)} ${fmtDate(srcDate)} — tick the ones that also run on ${fmtDow(state.date)} ${fmtDate(state.date)}:`;
      const list = $("#import-list");
      list.innerHTML = "";
      for (const m of importCandidates) {
        const eng = D().engineers.find(e => e.id === m.engineerId);
        const row = document.createElement("label");
        row.className = "import-row";
        row.innerHTML = `<input type="checkbox" value="${m.id}">
          <span class="import-info"><b>${escapeHtml(m.number)}</b> — ${escapeHtml(m.host)} → ${escapeHtml(m.customer)}
          <small>${m.shift === "night" ? "Night" : "Day"} ${m.startTime}-${m.endTime}${eng ? " • " + escapeHtml(eng.name) : ""}</small></span>`;
        list.appendChild(row);
      }
    } catch (e) {
      $("#import-list").innerHTML = `<p class="import-note">Could not load missions: ${e.message || e}</p>`;
    }
  });
}

/* Forecast "Add Mission": the same picker, listing the latest confirmed day's
   missions so an engineer adds only the ones they will work on (optionally
   with their crew) instead of the whole board. Missions this forecast
   already has (same number + shift) are shown but can't be ticked. */
function openForecastAddModal() {
  guardEdit(async () => {
    importMode = "forecast";
    importForecastSrc = null;
    const boardId = D().activeBoardId, date = state.date;
    $("#import-crew").classList.remove("hidden");
    $("#import-list").innerHTML = '<p class="import-note">Loading…</p>';
    $("#import-source-note").textContent = "";
    openModal("#modal-import");
    try {
      const src = await cloud.findLatestWeekdayMissionDate(boardId, date);
      if (!src) {
        $("#import-list").innerHTML = '<p class="import-note">There is no confirmed working day with missions to pick from yet. Use "New Mission" to create one.</p>';
        return;
      }
      const preview = await cloud.buildCarryPreview(boardId, src);
      const missions = preview.missions.filter(m => !m.hidden)
        .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }) || (a.shift === "night") - (b.shift === "night"));
      if (!missions.length) {
        $("#import-list").innerHTML = '<p class="import-note">Every mission on the latest confirmed day is hidden, so there is nothing to pick.</p>';
        return;
      }
      importForecastSrc = src;
      const have = new Set(getPlan().missions.map(m => m.number + "|" + m.shift));
      $("#import-source-note").textContent =
        `Missions on the confirmed board for ${fmtDow(src)} ${fmtDate(src)} — tick the ones you will work on for ${fmtDow(date)} ${fmtDate(date)}:`;
      const list = $("#import-list");
      list.innerHTML = "";
      for (const m of missions) {
        const key = m.number + "|" + m.shift;
        const present = have.has(key);
        const eng = D().engineers.find(e => e.id === m.engineerId);
        const n = m.members.length;
        const row = document.createElement("label");
        row.className = "import-row" + (present ? " is-present" : "");
        row.innerHTML = `<input type="checkbox" value="${escapeHtml(key)}"${present ? " disabled" : ""}>
          <span class="import-info"><b>${escapeHtml(m.number)}</b> — ${escapeHtml(m.host)} → ${escapeHtml(m.customer)}
          <small>${m.shift === "night" ? "Night" : "Day"} ${m.startTime}-${m.endTime}${eng ? " • " + escapeHtml(eng.name) : ""} • ${n} ${n === 1 ? "person" : "people"}${present ? " • already on this forecast" : ""}</small></span>`;
        list.appendChild(row);
      }
    } catch (e) {
      $("#import-list").innerHTML = `<p class="import-note">Could not load missions: ${escapeHtml(e.message || String(e))}</p>`;
    }
  });
}

function confirmForecastAdd(keys) {
  const withCrew = $("#import-with-crew").checked;
  const src = importForecastSrc;
  safely(async () => {
    const r = await cloud.addForecastMissionsFromConfirmed(D().activeBoardId, state.date, src, keys, { withCrew });
    closeModal();
    await refreshAndRender();
    const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const parts = [];
    if (r.added) parts.push(`Added ${pl(r.added, "mission", "missions")}` + (withCrew ? ` with ${pl(r.crewPlaced, "person", "people")}.` : " (no crew)."));
    if (r.crewKept) parts.push(`${pl(r.crewKept, "person was", "people were")} already placed elsewhere on this day and stayed there.`);
    if (r.skipped) parts.push(`${pl(r.skipped, "mission was", "missions were")} already on this forecast and left as they are.`);
    if (parts.length) toast(parts.join(" "), r.crewKept ? "warn" : "info");
  });
}

function confirmImport() {
  const ids = Array.from($$("#import-list input[type=checkbox]:checked")).map(c => c.value);
  if (importMode === "forecast") {
    if (!ids.length || !importForecastSrc || !isForecastView()) { closeModal(); return; }
    confirmForecastAdd(ids);
    return;
  }
  if (!ids.length) { closeModal(); return; }
  safely(async () => {
    const result = await cloud.importMissions(D().activeBoardId, state.date, ids);
    closeModal();
    // force-refresh this date's plan so the new missions appear
    if (D().plans[D().activeBoardId]) delete D().plans[D().activeBoardId][state.date];
    await refreshAndRender();
    if (result && result.skipped > 0) {
      toast(`${result.added} mission(s) added. ${result.skipped} already existed on this date/shift and were skipped.`, "info");
    }
  });
}

/* ---------- Hide/Unhide missions (declutter the board without deleting) ---------- */
/* The dialog keeps what has been ticked as `pending`: the ids whose hidden state
   Save will flip. A tick is "hidden after Save", exactly as before, so the rows
   can be re-drawn (search, filter, "Select all") without losing a tick. */
let hideUi = { pending: new Set(), q: "", f: "all" };
const HIDE_FILTERS = [["all", "All"], ["empty", "No crew"], ["hidden", "Hidden"], ["day", "Day"], ["night", "Night"]];

/* this board's people on a mission — what the card's headcount chip shows */
function missionCrew(m) {
  return m.members
    .map(empId => D().employees.find(e => e.id === empId))
    .filter(e => e && e.boardId === D().activeBoardId && onRoster(e));
}
/* on the board with nobody from this board on it: the missions worth hiding */
function missionHasNoCrew(m) { return !m.hidden && missionCrew(m).length === 0; }

function openHideMissionsModal() {
  if (isForecastView()) return;
  guardEdit(() => {
    hideUi = { pending: new Set(), q: "", f: "all" };
    $("#hide-missions-q").value = "";
    const board = D().boards.find(b => b.id === D().activeBoardId);
    $("#hide-missions-sub").textContent = `${board ? board.name + " · " : ""}${fmtDow(state.date)} ${fmtDate(state.date)}`;
    renderHideMissions();
    openModal("#modal-hide-missions");
    $("#hide-missions-list").scrollTop = 0;
  });
}

function hideStateTag(m, crew) {
  if (hideUi.pending.has(m.id)) {
    if (m.hidden) return '<span class="hm-tag will-unhide">Will unhide</span>';
    return `<span class="hm-tag will-hide">Will hide${crew ? ` · ${crew} → Standby` : ""}</span>`;
  }
  return m.hidden ? '<span class="hm-tag">Hidden</span>' : "";
}

function hideRowHtml(m, crew) {
  const eng = D().engineers.find(e => e.id === m.engineerId);
  const night = m.shift === "night";
  const willHide = m.hidden !== hideUi.pending.has(m.id);
  return `<label class="hm-row${hideUi.pending.has(m.id) ? " pend" : ""}${m.hidden ? " is-hidden" : ""}" data-id="${escapeHtml(m.id)}">
    <input type="checkbox" value="${escapeHtml(m.id)}" ${willHide ? "checked" : ""} aria-label="Hide ${escapeHtml(m.number)}">
    <span class="hm-mission">
      <span class="hm-no" title="${escapeHtml(m.number)}">${escapeHtml(m.number)}</span>
      <span class="hm-route" title="${escapeHtml(m.host)} → ${escapeHtml(m.customer)}">${escapeHtml(m.host)} ${icon("arrow-right")} ${escapeHtml(m.customer)}</span>
    </span>
    <span class="hm-when"><span class="hm-shift${night ? " night" : ""}">${night ? icon("moon") + "NIGHT" : "DAY"}</span>${escapeHtml(m.startTime)}-${escapeHtml(m.endTime)}</span>
    <span class="hm-eng">${eng ? `<i style="background:${escapeHtml(eng.color)}"></i>${escapeHtml(eng.name)}` : ""}</span>
    <span class="hm-crew${crew ? "" : " zero"}" title="${crew} assigned from this board">${icon("users")}${crew}</span>
    <span class="hm-state">${hideStateTag(m, crew)}</span>
  </label>`;
}

function renderHideMissions() {
  const list = $("#hide-missions-list");
  const missions = [...getPlan().missions].sort((a, b) => a.number.localeCompare(b.number));
  const crew = new Map(missions.map(m => [m.id, missionCrew(m).length]));
  const noCrew = (m) => !m.hidden && !crew.get(m.id);
  const counts = {
    all: missions.length,
    empty: missions.filter(noCrew).length,
    hidden: missions.filter(m => m.hidden).length,
    day: missions.filter(m => m.shift !== "night").length,
    night: missions.filter(m => m.shift === "night").length,
  };
  $("#hide-missions-filters").innerHTML = HIDE_FILTERS.map(([k, label]) =>
    `<button type="button" class="hm-filter${hideUi.f === k ? " on" : ""}${k === "empty" && counts.empty ? " warn" : ""}" data-f="${k}" aria-pressed="${hideUi.f === k}">${label} <span class="n">${counts[k]}</span></button>`).join("");

  const q = hideUi.q.trim().toLowerCase();
  const engName = (m) => (D().engineers.find(e => e.id === m.engineerId) || {}).name || "";
  const shown = missions.filter(m => {
    if (q && !`${m.number} ${m.host} ${m.customer} ${engName(m)}`.toLowerCase().includes(q)) return false;
    if (hideUi.f === "empty") return noCrew(m);
    if (hideUi.f === "hidden") return m.hidden;
    if (hideUi.f === "day") return m.shift !== "night";
    if (hideUi.f === "night") return m.shift === "night";
    return true;
  });
  // grouped by the SAVED state, so ticking a row tags it in place instead of moving it
  const groups = [
    { rows: shown.filter(noCrew), suggest: true, title: "Suggested · no crew",
      note: "Nobody from this board is on these missions on this date. Hide them to tidy the board; you can unhide them any time." },
    { rows: shown.filter(m => !m.hidden && crew.get(m.id)), title: "On the board",
      note: "Anyone on a mission you hide returns to Standby." },
    { rows: shown.filter(m => m.hidden), title: "Hidden",
      note: "Untick to put a mission back on the board. Its setup was kept." },
  ];
  const allEmpty = missions.filter(noCrew);
  const allPicked = allEmpty.length && allEmpty.every(m => hideUi.pending.has(m.id));
  let html = "";
  for (const g of groups) {
    if (!g.rows.length) continue;
    const act = g.suggest
      ? `<button type="button" class="btn btn-small hm-select" data-hm-act="${allPicked ? "clear-empty" : "select-empty"}">${allPicked ? "Clear selection" : `Select all ${allEmpty.length}`}</button>` : "";
    html += `<div class="hm-group${g.suggest ? " is-suggest" : ""}">
      <div class="hm-group-head">${g.suggest ? icon("alert") : ""}<span class="hm-group-title">${g.title} (${g.rows.length})<small>${g.note}</small></span>${act}</div>
      ${g.rows.map(m => hideRowHtml(m, crew.get(m.id))).join("")}</div>`;
  }
  if (!missions.length) html = '<p class="hm-empty">No missions on this date yet.</p>';
  else if (!html) html = `<p class="hm-empty">No missions match${q ? ` “${escapeHtml(hideUi.q.trim())}”` : " this filter"}.</p>`;
  const top = list.scrollTop;
  list.innerHTML = html;
  list.scrollTop = top;
  updateHideSummary();
}

/* what Save will do, in words, next to the Save button */
function updateHideSummary() {
  const changed = getPlan().missions.filter(m => hideUi.pending.has(m.id));
  const hide = changed.filter(m => !m.hidden), unhide = changed.filter(m => m.hidden);
  const people = hide.reduce((n, m) => n + m.members.length, 0);
  const el = $("#hide-missions-summary");
  $("#btn-hide-missions-save").disabled = !changed.length;
  if (!changed.length) { el.textContent = "No changes yet."; return; }
  const parts = [];
  if (hide.length) parts.push(`<b>Hide ${hide.length}</b>`);
  if (unhide.length) parts.push(`<b>Unhide ${unhide.length}</b>`);
  el.innerHTML = parts.join(" · ") + (people
    ? ` · <span class="hm-warn">${people} ${people === 1 ? "person returns" : "people return"} to Standby</span>`
    : " · nobody returns to Standby");
}

function bindHideMissionsModal() {
  $("#hide-missions-q").oninput = (e) => { hideUi.q = e.target.value; renderHideMissions(); };
  $("#hide-missions-filters").onclick = (e) => {
    const b = e.target.closest("[data-f]");
    if (!b) return;
    hideUi.f = b.dataset.f;
    renderHideMissions();
  };
  const list = $("#hide-missions-list");
  list.onchange = (e) => {
    const c = e.target;
    if (c.type !== "checkbox") return;
    const m = getPlan().missions.find(x => x.id === c.value);
    if (!m) return;
    if (c.checked !== m.hidden) hideUi.pending.add(m.id); else hideUi.pending.delete(m.id);
    // update the one row in place: keeps focus and scroll for keyboard users
    const row = c.closest(".hm-row");
    row.classList.toggle("pend", hideUi.pending.has(m.id));
    row.querySelector(".hm-state").innerHTML = hideStateTag(m, missionCrew(m).length);
    const sel = list.querySelector(".hm-select");
    const allEmpty = getPlan().missions.filter(missionHasNoCrew);
    if (sel) {
      const allPicked = allEmpty.every(x => hideUi.pending.has(x.id));
      sel.dataset.hmAct = allPicked ? "clear-empty" : "select-empty";
      sel.textContent = allPicked ? "Clear selection" : `Select all ${allEmpty.length}`;
    }
    updateHideSummary();
  };
  list.onclick = (e) => {
    const b = e.target.closest("[data-hm-act]");
    if (!b) return;
    const empties = getPlan().missions.filter(missionHasNoCrew);
    for (const m of empties) {
      if (b.dataset.hmAct === "select-empty") hideUi.pending.add(m.id); else hideUi.pending.delete(m.id);
    }
    renderHideMissions();
  };
}

/* the card's own Hide (missions with no crew): nobody returns to Standby, so it
   hides at once and the toast carries the Undo instead of a confirm */
function hideMissionFromCard(m) {
  guardEdit(() => safely(async () => {
    await cloud.setMissionsHidden([m.id], true);
    await refreshAndRender();
    toast(`${m.number} hidden. It is in Hide/Unhide if you need it back.`, "info", {
      duration: 6000,
      action: { label: "Undo", run: () => safely(async () => {
        await cloud.setMissionsHidden([m.id], false);
        await refreshAndRender();
      }) },
    });
  }));
}

function saveHideMissions() {
  const missions = getPlan().missions;
  const toHide = missions.filter(m => hideUi.pending.has(m.id) && !m.hidden).map(m => m.id);
  const toUnhide = missions.filter(m => hideUi.pending.has(m.id) && m.hidden).map(m => m.id);
  if (!toHide.length && !toUnhide.length) { closeModal(); return; }
  safely(async () => {
    if (toHide.length) await cloud.setMissionsHidden(toHide, true);
    if (toUnhide.length) await cloud.setMissionsHidden(toUnhide, false);
    closeModal();
    await refreshAndRender();
  });
}

/* ---------- reset board (re-clone the last working day's plan) ---------- */
function resetBoard() {
  if (isForecastView()) { startForecast(); return; }
  const board = D().boards.find(b => b.id === D().activeBoardId);
  const boardName = board ? board.name : "this board";
  const run = () => safely(async () => {
    const src = await cloud.resetBoardFromLastWorkingDay(D().activeBoardId, state.date);
    await refreshAndRender();
    if (!src) { toast("No previous working-day plan was found to copy from.", "warn"); return; }
    // a forecast made for this day earlier is offered straight away (6.1 Merge)
    if (unmergedForecast()) openPlanDiff("merge");
  });
  // On an untouched day there's nothing to overwrite, so carry over straight
  // away. Once the day has content, confirm first — this replaces it.
  if (planIsEmpty(getPlan())) { run(); return; }
  const stale = currentStale();
  showConfirm("Reset board?",
    `This will replace ${fmtDow(state.date)} ${fmtDate(state.date)} on ${boardName} with a fresh copy of the last working day's plan — its missions and employee assignments. Any changes already made to this day will be overwritten. Continue?` +
      (stale ? "\n\nTip: \"Review changes\" in the banner above updates only what changed, and keeps everything else on this day." : ""),
    run);
}

/* Forecast mode's "Start from confirmed" */
function startForecast() {
  guardEdit(() => safely(async () => {
    const src = await cloud.startForecastFromConfirmed(D().activeBoardId, state.date);
    await refreshAndRender();
    if (!src) toast("There is no confirmed working day to start from yet.", "warn");
    else toast(`Forecast started from ${fmtDow(src)} ${fmtDate(src)}. It is tentative until someone merges it into the confirmed plan.`, "info");
  }));
}

/* ======================================================================
   Forward planning — the confirmed/forecast mode pill, the two board
   banners (stale carry-over, unmerged forecast), the PlanDiff review panel,
   lost-hold flags, forecast copy/view, and the Capacity tab.
   ====================================================================== */

/* "Tue 22 Sep" — the short form the banners use */
function fmtShort(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${fmtDow(iso)} ${d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1]}`;
}
/* a timestamp as HH:MM, with the date in front when it isn't today */
function fmtStamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  return iso === todayStr() ? hm : `${fmtShort(iso)} ${hm}`;
}
/* who, as the board shows people who have no employee card: the local part of
   their address ("somchai.p") — the directory carries no emails by design */
function who(email) { return String(email || "someone").split("@")[0]; }
function empName(id) { const e = D().employees.find(x => x.id === id); return e ? e.name : "(unknown)"; }
function nextWorkingDates(boardId, after, n) {
  const out = [];
  let d = after;
  for (let i = 0; i < 120 && out.length < n; i++) {
    d = addDays(d, 1);
    if (!isNonWorkingDate(d, boardId)) out.push(d);
  }
  return out;
}

/* ---------- mode pill ---------- */
/* One pill beside the date picker says what the date on screen is:
   Confirmed, Confirmed · Read-only (today or a past date), Confirmed · Locked, or Forecast.
   Without forward planning there is no confirmed / forecast split, so the pill
   only appears for a read-only or locked day. */
function renderModePill() {
  const pill = $("#mode-pill");
  const onBoard = !isNonBoardView() && !!D().activeBoardId && can("board");
  if (!onBoard) { pill.className = "mode-pill hidden"; return; }
  const planning = !!feat().forecast;
  const fc = planning && isForecastView();
  const lock = lockInfo(D().activeBoardId, state.date);
  const ro = !fc && isReadOnly();
  if (!planning && !ro) { pill.className = "mode-pill hidden"; return; }
  const state2 = fc ? "forecast" : ro ? (lock ? "locked" : "readonly") : "confirmed";
  pill.className = "mode-pill mode-" + (fc ? "forecast" : "confirmed") + (ro ? " mode-ro" : "");
  pill.dataset.state = state2;
  const main = planning ? (fc ? "Forecast" : "Confirmed") : "";
  const extra = state2 === "locked" ? "Locked" : state2 === "readonly" ? "Read-only" : "";
  pill.innerHTML = (ro ? icon("lock") : "") + escapeHtml([main, extra].filter(Boolean).join(" · "));
  const end = planning ? horizonEndFor(D().activeBoardId) : null;
  pill.title = (fc ? "Tentative plan — never exported, never in the Host Record. " : planning ? "The operational plan. " : "") +
    (state2 === "locked" ? `Locked by ${lock.lockedBy}: view-only for everyone until someone unlocks it. ` : "") +
    (state2 === "readonly" ? "Today or a past date: view-only (editing asks first). " : "") +
    (planning ? `Confirmed plans run up to ${fmtShort(end)} (the next working day); every later date opens as a forecast.` : "");
}

/* ---------- lost holds (D3) ---------- */
function myLostHolds() {
  return (D().holdEvents || []).filter(e => sameEmail(e.fromHeldBy, state.myEmail));
}
function holdPlace(missionId, zone) {
  if (missionId) { const m = D().holdMissions[missionId]; return m ? `mission ${m.number}${m.shift === "night" ? " (night)" : ""}` : "a mission"; }
  if (zone) return ZONE_LABELS[zone] || zone;
  return "Standby";
}
/* "B moved Somchai from your mission 123 (Mon 5 Oct) to mission 456" */
function describeHold(e) {
  if (e.kind === "merge") return describeMergeAlert(e);
  const from = sameEmail(e.fromHeldBy, state.myEmail) ? "your " : `${who(e.fromHeldBy)}'s `;
  return `${who(e.takenBy)} moved ${empName(e.employeeId)} from ${from}${holdPlace(e.fromMissionId, e.fromZone)} (${fmtShort(e.date)}) to ${holdPlace(e.toMissionId, e.toZone)}`;
}
/* "B kept Somchai on 101 Day instead of your 205 Day (Mon 5 Oct)" */
function describeMergeAlert(e) {
  const whose = sameEmail(e.fromHeldBy, state.myEmail) ? "your" : `${who(e.fromHeldBy)}'s`;
  const d = e.detail || {};
  const when = ` (${fmtShort(e.date)})`;
  if (d.type === "field") return `${who(e.takenBy)} kept ${mergeFieldLabel(d.field).toLowerCase()} on ${d.mission_number} at ${d.carry_value || "(blank)"} instead of ${whose} ${d.forecast_value || "(blank)"}${when}`;
  if (d.type === "add") return `${who(e.takenBy)} did not add ${whose} new mission ${d.mission_number}${when}`;
  return `${who(e.takenBy)} kept ${empName(e.employeeId)} on ${d.carry_value || "the carry-over"} instead of ${whose} ${holdPlace(e.fromMissionId, e.fromZone)}${when}`;
}
function renderHoldAlerts() {
  const btn = $("#btn-hold-alerts");
  const mine = feat().forecast && can("forecast") ? myLostHolds() : [];
  btn.classList.toggle("hidden", !mine.length);
  if (!mine.length) return;
  const merged = mine.filter(e => e.kind === "merge").length, taken = mine.length - merged;
  setIconLabel(btn, "alert", !merged ? `${taken} hold${taken === 1 ? "" : "s"} taken from you`
    : !taken ? `${merged} not used at merge` : `${mine.length} forecast alerts`);
  btn.title = mine.map(describeHold).join("\n");
}
function holdBadge(events) {
  const b = document.createElement("button");
  b.type = "button";
  const mine = events.some(e => sameEmail(e.fromHeldBy, state.myEmail));
  b.className = "hold-badge" + (mine ? " mine" : "");
  const takers = [...new Set(events.map(e => who(e.takenBy)))];
  b.textContent = events.every(e => e.kind === "merge")
    ? `${events.length} not used at merge`
    : `${events.length} ${events.length === 1 ? "person" : "people"} taken by ${takers.join(", ")}`;
  b.title = events.map(describeHold).join("\n") + "\nClick for details and to acknowledge.";
  b.onclick = (ev) => { ev.stopPropagation(); openHoldEventsModal(events.map(e => e.id), "People taken from this mission"); };
  return b;
}
let holdModalIds = [];
/* a merge writes one alert row per unused part of a forecast; they arrive as
   separate Realtime events, so they are gathered into one toast per merge */
let mergeToastTimer = null, mergeToastIds = [];
function queueMergeToast(id) {
  mergeToastIds.push(id);
  clearTimeout(mergeToastTimer);
  mergeToastTimer = setTimeout(() => {
    const evs = (D().holdEvents || []).filter(e => mergeToastIds.includes(e.id));
    mergeToastIds = [];
    if (!evs.length) return;
    const e0 = evs[0];
    toast(evs.length === 1 ? describeHold(e0) + "."
      : `${who(e0.takenBy)} merged your forecast for ${fmtShort(e0.date)}: ${evs.length} parts of it were not used.`, "warn", { duration: 12000 });
  }, 700);
}
function openHoldEventsModal(ids, title) {
  holdModalIds = ids;
  holdPlanCache.clear();
  $("#holds-title").textContent = title;
  renderHoldEventsModal();
  openModal("#modal-holds");
}
function renderHoldEventsModal() {
  const list = $("#holds-list");
  list.innerHTML = "";
  const events = (D().holdEvents || []).filter(e => holdModalIds.includes(e.id));
  const mayAck = can("forecast", "edit");
  $("#btn-holds-ack-all").classList.toggle("hidden", !mayAck || events.length < 2);
  $("#modal-holds").classList.toggle("wide", events.some(e => e.kind === "merge"));
  const merges = events.filter(e => e.kind === "merge"), taken = events.filter(e => e.kind !== "merge");
  $("#holds-note").textContent = merges.length && !taken.length
    ? "Parts of a forecast that were not used when the day was confirmed: what was forecast, what is on the board now, and why. The flag stays until it is acknowledged."
    : merges.length
      ? "Forecasts not used when a day was confirmed, and people moved out of a forecast they were held in. Each flag stays until it is acknowledged."
      : "Someone moved these people out of a forecast they were held in. The flag stays on the mission until it is acknowledged.";
  if (!events.length) {
    list.innerHTML = '<p class="import-note">All acknowledged — nothing left here.</p>';
    return;
  }
  if (merges.length) list.appendChild(mergeAlertsEl(merges, mayAck));
  if (merges.length && taken.length) list.appendChild(mkEl("h4", "holds-subhead", "Taken by other engineers on the forecast"));
  for (const e of taken) {
    const row = document.createElement("div");
    row.className = "hold-row";
    const text = document.createElement("div");
    text.className = "hold-text";
    text.textContent = describeHold(e);
    const when = document.createElement("small");
    when.textContent = `Taken ${fmtStamp(e.takenAt)} · held by ${who(e.fromHeldBy)}`;
    text.appendChild(when);
    row.appendChild(text);
    const m = e.fromMissionId && D().holdMissions[e.fromMissionId];
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn btn-small";
    go.textContent = "Open day";
    go.onclick = () => {
      closeModal();
      clearSelection();
      if (m && m.boardId) D().activeBoardId = m.boardId;
      else { const emp = D().employees.find(x => x.id === e.employeeId); if (emp) D().activeBoardId = emp.boardId; }
      state.date = e.date;
      refreshAndRender();
    };
    row.appendChild(go);
    if (mayAck) {
      const ack = document.createElement("button");
      ack.type = "button";
      ack.className = "btn btn-small btn-primary";
      ack.textContent = "Acknowledge";
      ack.onclick = () => safely(async () => { await cloud.acknowledgeHoldEvents([e.id]); renderHoldEventsModal(); render(); });
      row.appendChild(ack);
    }
    list.appendChild(row);
  }
}

/* ---------- board banners ---------- */
function signalsForScreen() {
  return state.signals.key === D().activeBoardId + "|" + state.date ? state.signals : null;
}
/* the staleness warning for the day on screen, unless it was dismissed or
   the day has since become somewhere the banner doesn't belong */
function currentStale() {
  const sig = signalsForScreen();
  if (!sig || !sig.stale || isForecastView()) return null;
  const boardId = D().activeBoardId;
  if (state.date < todayStr() || isLocked(boardId, state.date) || isNonWorkingDate(state.date, boardId)) return null;
  const dk = `${boardId}|${state.date}|${sig.stale.sourceEditedAt || ""}|${sig.stale.newerDate || ""}`;
  return state.dismissedStale.has(dk) ? null : { ...sig.stale, dismissKey: dk };
}
function forecastCounts(plan) {
  const people = plan.missions.reduce((n, m) => n + m.members.length, 0) + ZONES.reduce((n, z) => n + plan.zones[z].length, 0);
  return { missions: plan.missions.length, people };
}
/* a forecast for the confirmed day on screen that nobody has merged yet */
function unmergedForecast() {
  const sig = signalsForScreen();
  if (!sig || !sig.forecast || isForecastView() || state.date < todayStr()) return null;
  if (planIsEmpty(sig.forecast)) return null;
  if (sig.stamp && sig.stamp.forecast_merged_at) return null;
  return sig.forecast;
}
function bannerEl(kind, parts) {
  const el = document.createElement("div");
  el.className = "plan-banner plan-banner-" + kind;
  el.setAttribute("role", "status");
  const ic = document.createElement("span");
  ic.className = "plan-banner-icon";
  ic.innerHTML = icon(kind === "forecast-info" ? "calendar" : "alert");
  el.appendChild(ic);
  const text = document.createElement("div");
  text.className = "plan-banner-text";
  for (const p of parts.text) {
    if (typeof p === "string") text.appendChild(document.createTextNode(p));
    else { const b = document.createElement("b"); b.textContent = p.b; text.appendChild(b); }
  }
  el.appendChild(text);
  const actions = document.createElement("div");
  actions.className = "plan-banner-actions";
  for (const a of parts.actions || []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-small" + (a.primary ? " btn-primary" : " btn-quiet");
    btn.textContent = a.label;
    btn.onclick = a.run;
    actions.appendChild(btn);
  }
  el.appendChild(actions);
  return el;
}
function renderPlanBanners() {
  const box = $("#plan-banners");
  box.innerHTML = "";
  if (isNonBoardView() || !D().activeBoardId) return;
  if (isForecastView()) {
    const plan = getPlan();
    const by = plan.authors && plan.authors.length ? ` Worked on by ${plan.authors.map(who).join(", ")}.` : "";
    box.appendChild(bannerEl("forecast-info", {
      text: [{ b: "Forecast" }, ` — a tentative plan for ${fmtShort(state.date)}. It stays out of the confirmed board, Overview, exports and the Host Record until it is merged, the day before.${by}`],
    }));
    return;
  }
  const mayEdit = can("board", "edit");
  const stale = currentStale();
  if (stale) {
    const text = [];
    if (stale.edited) {
      text.push("This plan was carried over from ", { b: fmtShort(stale.carriedFrom) }, ` at ${fmtStamp(stale.carriedAt)}. `,
        { b: fmtShort(stale.carriedFrom) }, ` has been edited since (last change ${fmtStamp(stale.sourceEditedAt)} by ${who(stale.sourceEditedBy)}).`);
    } else {
      text.push("This plan was carried over from ", { b: fmtShort(stale.carriedFrom) }, ` at ${fmtStamp(stale.carriedAt)}.`);
    }
    if (stale.newerDate) text.push(" A newer day (", { b: fmtShort(stale.newerDate) }, ") now exists before this date.");
    const actions = [];
    if (mayEdit) actions.push({ label: "Review changes", primary: true, run: () => openPlanDiff("resync") });
    actions.push({ label: "Dismiss", run: () => { state.dismissedStale.add(stale.dismissKey); renderPlanBanners(); } });
    box.appendChild(bannerEl("stale", { text, actions }));
  }
  const fplan = unmergedForecast();
  if (fplan) {
    const c = forecastCounts(fplan);
    const by = fplan.authors.length ? ` by ${fplan.authors.map(who).join(", ")}` : "";
    const actions = [{ label: "View", run: () => openForecastViewer() }];
    if (mayEdit) actions.unshift({ label: "Review & merge", primary: true, run: () => openPlanDiff("merge") });
    box.appendChild(bannerEl("forecast", {
      text: [{ b: "Forecast for this day" }, `${by}: ${c.missions} mission${c.missions === 1 ? "" : "s"}, ${c.people} ${c.people === 1 ? "person" : "people"}.`],
      actions,
    }));
  } else {
    const sig = signalsForScreen();
    const hasForecast = sig && sig.forecast && !planIsEmpty(sig.forecast);
    const decisions = (sig && sig.decisions) || [];
    if (sig && sig.stamp && sig.stamp.forecast_merged_at && (hasForecast || decisions.length)) {
      const text = [`Forecast merged by ${who(sig.stamp.forecast_merged_by)} ${fmtStamp(sig.stamp.forecast_merged_at)}.`];
      if (decisions.length) {
        const nu = new Map();
        for (const r of decisions.filter(decisionNotUsed)) nu.set(who(r.forecaster), (nu.get(who(r.forecaster)) || 0) + 1);
        text.push(` ${decisions.length} ${decisions.length === 1 ? "decision" : "decisions"}. `);
        if (nu.size) text.push({ b: [...nu].map(([w, n]) => `${n} of ${w}'s`).join(", ") + " not used." });
        else text.push("Everything forecast was used.");
      } else {
        text.push(" Kept read-only for reference.");
      }
      const actions = [];
      if (decisions.length) actions.push({ label: "Decisions", run: () => openMergeLog() });
      if (hasForecast) actions.push({ label: "View", run: () => openForecastViewer() });
      box.appendChild(bannerEl("merged", { text, actions }));
    }
  }
}

/* ---------- PlanDiff review panel ---------- */
function openPlanDiff(mode) {
  // a forecast merge has its own review: carry-over and forecast side by side
  if (mode === "merge") { openMergeReview(); return; }
  guardEdit(() => safely(async () => {
    const boardId = D().activeBoardId, date = state.date;
    let proposed, source = null;
    if (mode === "resync") {
      const st = currentStale() || (signalsForScreen() || {}).stale;
      if (!st) return;
      source = st.source;
      proposed = await cloud.buildCarryPreview(boardId, source);
    } else {
      proposed = await cloud.ensureForecastLoaded(boardId, date, { force: true });
    }
    const base = await cloud.ensurePlanLoaded(boardId, date, { force: true });
    const employeeIds = boardEmployees(boardId).filter(e => e.active !== false).map(e => e.id);
    state.diff = { mode, boardId, date, source, diff: PlanDiff.compute(base, proposed, { employeeIds }), applying: false };
    renderPlanDiff();
    openModal("#modal-plandiff");
  }));
}
function diffMissionLabel(key) {
  const d = state.diff.diff;
  const m = d.proposedByKey.get(key) || d.baseByKey.get(key);
  return m ? `${m.number}${m.shift === "night" ? " (night)" : ""}` : key;
}
function diffPlaceLabel(p) {
  if (p.kind === "mission") return "mission " + diffMissionLabel(p.key);
  if (p.kind === "zone") return ZONE_LABELS[p.zone] || p.zone;
  return "Standby";
}
function diffFieldValue(field, v) {
  if (field === "engineerId") { const e = D().engineers.find(x => x.id === v); return e ? e.name : (v ? "?" : "none"); }
  return v === "" || v == null ? "(blank)" : String(v);
}
function diffItemParts(it) {
  // [tag, text] — text only, never markup: names and fields are user-typed
  if (it.type === "add") {
    const m = it.mission;
    const eng = D().engineers.find(e => e.id === m.engineerId);
    let t = `Add mission ${m.number} · ${m.host} → ${m.customer} · ${m.shift === "night" ? "Night" : "Day"} ${m.startTime}–${m.endTime}${eng ? " · " + eng.name : ""}`;
    if (it.members.length) {
      t += ` — with ${it.members.length} ${it.members.length === 1 ? "person" : "people"}: ` +
        it.members.map(x => x.from.kind === "standby" ? empName(x.empId) : `${empName(x.empId)} (from ${diffPlaceLabel(x.from)})`).join(", ");
    }
    return ["New", t];
  }
  if (it.type === "update") {
    return ["Update", it.changes.map(c => `${c.label}: ${diffFieldValue(c.field, c.before)} → ${diffFieldValue(c.field, c.after)}`).join(" · ")];
  }
  if (it.type === "remove") {
    const n = it.mission.members.length;
    const src = state.diff.mode === "merge" ? "the forecast" : fmtShort(state.diff.source);
    return ["Remove?", `Remove mission ${it.mission.number} — it is not in ${src}${n ? `; its ${n} ${n === 1 ? "person returns" : "people return"} to Standby` : ""}`];
  }
  if (it.type === "leave") return ["Leave", `${ZONE_LABELS[it.to.zone]} for ${empName(it.empId)} (now ${diffPlaceLabel(it.from)})`];
  return ["Move", `Move ${empName(it.empId)}: ${diffPlaceLabel(it.from)} → ${diffPlaceLabel(it.to)}`];
}
function renderPlanDiff() {
  const sd = state.diff;
  if (!sd) return;
  const merge = sd.mode === "merge";
  $("#plandiff-title").textContent = merge
    ? `Review & merge forecast — ${fmtShort(sd.date)}`
    : `Review changes — ${fmtShort(sd.date)}`;
  $("#plandiff-sub").textContent = merge
    ? `Ticked lines are written into the confirmed plan for ${fmtShort(sd.date)} (people placed on missions also go into the Host Record). Unticked lines are left out. The forecast itself is kept, read-only.`
    : `Compared with a fresh carry-over from ${fmtShort(sd.source)}. Only the ticked lines are applied — nothing else on ${fmtShort(sd.date)} is touched.`;
  const body = $("#plandiff-body");
  body.innerHTML = "";
  const groups = PlanDiff.groups(sd.diff);
  $("#plandiff-tools").classList.toggle("hidden", !groups.length);
  if (!groups.length) {
    const p = document.createElement("p");
    p.className = "import-note";
    p.textContent = merge
      ? "No differences — the confirmed plan already matches the forecast."
      : `No differences — this day already matches ${fmtShort(sd.source)}.`;
    body.appendChild(p);
  }
  for (const g of groups) {
    const sec = document.createElement("section");
    sec.className = "pd-group";
    const h = document.createElement("div");
    h.className = "pd-group-head";
    if (g.kind === "mission") {
      const m = g.mission;
      const eng = D().engineers.find(e => e.id === m.engineerId);
      if (eng) h.style.borderLeftColor = eng.color;
      const num = document.createElement("b");
      num.textContent = m.number;
      h.appendChild(num);
      h.appendChild(document.createTextNode(` · ${m.host} → ${m.customer} · ${m.shift === "night" ? "Night" : "Day"}`));
    } else {
      h.textContent = g.kind === "leave" ? "Leave" : "Back to Standby";
    }
    sec.appendChild(h);
    for (const it of g.items) {
      const row = document.createElement("label");
      row.className = "pd-item pd-" + it.type;
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = it.ticked;
      box.onchange = () => { it.ticked = box.checked; updatePlanDiffCount(); };
      row.appendChild(box);
      const [tag, text] = diffItemParts(it);
      const t = document.createElement("span");
      t.className = "pd-tag";
      t.textContent = tag;
      row.appendChild(t);
      const s = document.createElement("span");
      s.className = "pd-text";
      s.textContent = text;
      row.appendChild(s);
      sec.appendChild(row);
    }
    body.appendChild(sec);
  }
  updatePlanDiffCount();
}
function updatePlanDiffCount() {
  const sd = state.diff;
  const n = sd.diff.items.filter(i => i.ticked).length;
  const btn = $("#btn-plandiff-apply");
  btn.textContent = n ? `Apply ${n} change${n === 1 ? "" : "s"}` : (sd.mode === "merge" ? "Mark forecast as merged" : "Mark as reviewed");
  btn.title = n ? "" : (sd.mode === "merge"
    ? "Changes nothing on the board; hides the forecast banner for everyone"
    : "Changes nothing on the board; hides this warning for everyone until the source day changes again");
  btn.disabled = sd.applying;
  $("#plandiff-count").textContent = `${n} of ${sd.diff.items.length} ticked`;
}
function setAllPlanDiff(on) {
  for (const it of state.diff.diff.items) it.ticked = on;
  renderPlanDiff();
}
function applyPlanDiffFromModal() {
  const sd = state.diff;
  if (!sd || sd.applying) return;
  sd.applying = true;
  updatePlanDiffCount();
  (async () => {
    try {
      const n = sd.diff.items.filter(i => i.ticked).length;
      const sum = await cloud.applyPlanDiff(sd.boardId, sd.date, sd.diff,
        sd.mode === "resync" ? { carriedFrom: sd.source } : { forecastMerge: true });
      state.diff = null;
      closeModal();
      const bits = [];
      if (sum.added) bits.push(`${sum.added} mission${sum.added === 1 ? "" : "s"} added`);
      if (sum.updated) bits.push(`${sum.updated} updated`);
      if (sum.placed) bits.push(`${sum.placed} ${sum.placed === 1 ? "person" : "people"} placed`);
      if (sum.removed) bits.push(`${sum.removed} removed`);
      toast(n ? `Applied ${n} change${n === 1 ? "" : "s"}: ${bits.join(", ")}.` : (sd.mode === "merge" ? "Forecast marked as merged." : "Marked as reviewed."), "info");
      await refreshAndRender();
    } catch (e) {
      sd.applying = false;
      updatePlanDiffCount();
      toast(e.message || String(e), "error");
    }
  })();
}

/* ======================================================================
   Review & merge (forecast): the carry-over and the forecast side by side,
   one row per mission, and a decision for every difference. The decisions
   live in PlanDiff's merge model (planning.js); this draws it and passes
   clicks to PlanDiff.decide. Nothing that collides is decided for the
   planner: Apply stays locked until every difference has a side.
   ====================================================================== */
const MERGE_REASONS = ["Customer changed the schedule", "Needed on this site", "Certification / skill", "Leave not approved"];
const MERGE_FC_COLORS = 4;   // --fc-1 .. --fc-4 in styles.css

function openMergeReview() {
  guardEdit(() => safely(async () => {
    const boardId = D().activeBoardId, date = state.date;
    const [forecast, base] = await Promise.all([
      cloud.ensureForecastLoaded(boardId, date, { force: true }),
      cloud.ensurePlanLoaded(boardId, date, { force: true }),
    ]);
    const employeeIds = boardEmployees(boardId).filter(e => e.active !== false).map(e => e.id);
    const sig = signalsForScreen();
    const model = PlanDiff.computeMerge(base, forecast, { employeeIds });
    const forecasters = [...new Set(model.items.map(i => i.forecaster).filter(Boolean).map(x => x.toLowerCase()))].sort();
    state.merge = {
      boardId, date, model, forecasters,
      carriedFrom: (sig && sig.stamp && sig.stamp.carried_from) || null,
      reasons: {}, filter: "all", step: "review", applying: false,
    };
    renderMerge();
    openModal("#modal-merge");
  }));
}

/* ---------- small shared pieces (also used by the forecast alerts) ---------- */
const initialsOf = (email) => who(email).split(/[._-]/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
function mergeFcColor(email) {
  const i = state.merge ? state.merge.forecasters.indexOf(String(email || "").toLowerCase()) : -1;
  return i < 0 ? "var(--muted)" : `var(--fc-${(i % MERGE_FC_COLORS) + 1})`;
}
function mergeFieldLabel(field) {
  if (field === "hidden") return "Visibility";
  const f = PlanDiff.MISSION_FIELDS.find(x => x.key === field);
  return f ? f.label : field;
}
function mergeMissionOf(key) {
  const m = state.merge.model;
  return m.proposedByKey.get(key) || m.baseByKey.get(key);
}
const shiftWord = (s) => (s === "night" ? "Night" : "Day");
function mergePlaceLabel(p) {
  if (p.kind === "mission") { const m = mergeMissionOf(p.key); return m ? `${m.number} ${shiftWord(m.shift)}` : p.key; }
  if (p.kind === "zone") return ZONE_LABELS[p.zone] || p.zone;
  return "Standby";
}
function mergePlaceLong(p) {
  if (p.kind !== "mission") return mergePlaceLabel(p);
  const m = mergeMissionOf(p.key);
  return m ? `${m.number} ${shiftWord(m.shift)} · ${m.host} → ${m.customer}` : p.key;
}
/* an employee as a small board card: name, position, OC — text only, never markup */
function miniEmp(empId, opts = {}) {
  const emp = D().employees.find(e => e.id === empId);
  const el = document.createElement(opts.button ? "button" : "span");
  if (opts.button) el.type = "button";
  el.className = "mini-emp" + (emp && emp.contract === "oncall" ? " oncall" : "") + (opts.cls ? " " + opts.cls : "");
  el.dataset.emp = empId;
  if (opts.dot) {
    const dot = document.createElement("i");
    dot.className = "mini-dot";
    dot.style.background = opts.dot;
    el.appendChild(dot);
  }
  const nm = document.createElement("span");
  nm.className = "mini-name";
  nm.textContent = emp ? emp.name : "(unknown)";
  el.appendChild(nm);
  const meta = document.createElement("span");
  meta.className = "mini-meta";
  const pos = emp && emp.position ? POSITIONS[emp.position] : null;
  if (pos) { const p = document.createElement("span"); p.className = "emp-pos"; p.textContent = pos.short; meta.appendChild(p); }
  if (emp && emp.contract === "oncall") { const o = document.createElement("span"); o.className = "emp-oc"; o.textContent = "OC"; meta.appendChild(o); }
  if (opts.note) { const n = document.createElement("span"); n.className = "mini-note"; n.textContent = opts.note; meta.appendChild(n); }
  el.appendChild(meta);
  if (opts.flag) { const f = document.createElement("span"); f.className = "mini-flag"; f.textContent = opts.flag; el.appendChild(f); }
  if (opts.title) el.title = opts.title;
  return el;
}
function mkEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ---------- the review ---------- */
function mergeRowKeys() {
  const m = state.merge.model;
  const keys = new Set(m.proposedByKey.keys());
  for (const [k, bm] of m.baseByKey) if (!bm.hidden || m.proposedByKey.has(k)) keys.add(k);
  return [...keys].sort((a, b) => {
    const ma = mergeMissionOf(a), mb = mergeMissionOf(b);
    return String(ma.number).localeCompare(String(mb.number), undefined, { numeric: true }) || String(ma.shift).localeCompare(String(mb.shift));
  });
}
/* the collision items a row's buttons (and the forecaster filter) act on */
function mergeRowItems(key) {
  const m = state.merge.model;
  return m.items.filter(it => it.type === "person"
    ? ((it.from.kind === "mission" && it.from.key === key) || (it.to.kind === "mission" && it.to.key === key))
    : it.key === key);
}
function mergeMatchesFilter(it) {
  const f = state.merge.filter;
  if (f === "all") return true;
  return f === "none" ? !it.forecaster : !!it.forecaster && it.forecaster.toLowerCase() === f;
}
/* bulk choices touch collisions only: a person coming off Standby and a new
   mission were never collisions, so "keep carry-over for all" doesn't undo them */
const mergeBulkable = (it) => !(it.type === "person" && it.free) && it.type !== "add";

function mergeChip(empId, side) {
  const sm = state.merge, m = sm.model;
  const it = m.byId.get("person:" + empId);
  const p = m.people.get(empId);
  const zoneNote = (pl) => (pl.kind === "zone" ? ZONE_LABELS[pl.zone] : null);
  if (!it) {
    // the same on both sides, or following its carry-over mission
    const gone = side === "carry" && p.from.kind === "mission" && PlanDiff.carryPlace(m, p.from).kind === "standby";
    return miniEmp(empId, {
      cls: gone ? "dropped" : "same", note: gone ? "→ Standby" : zoneNote(side === "carry" ? p.from : p.to),
      title: gone ? "Goes to Standby: this mission is being removed" : "The same on both sides",
    });
  }
  const d = PlanDiff.decisionOf(m, it.id);
  const locked = PlanDiff.mergeLocked(m, it);
  const here = side === "carry" ? PlanDiff.carryPlace(m, it.from) : it.to;
  const other = side === "carry" ? it.to : PlanDiff.carryPlace(m, it.from);
  const name = empName(empId);
  const chip = miniEmp(empId, {
    button: !locked && !sm.applying,
    cls: (!d ? "conf" : d === side ? "kept" : "dropped") + (locked ? " locked" : ""),
    dot: side === "forecast" && it.forecaster ? mergeFcColor(it.forecaster) : null,
    note: (side === "carry" ? "→ " : "← ") + mergePlaceLabel(other),
    title: locked ? `${name} stays on the carry-over: ${mergePlaceLabel(it.to)} is not being added`
      : side === "carry" ? `Keep ${name} on ${mergePlaceLabel(here)} (carry-over)`
      : `Use ${it.forecaster ? who(it.forecaster) + "'s" : "the"} forecast: ${name} on ${mergePlaceLabel(here)}`,
  });
  chip.setAttribute("aria-pressed", String(d === side));
  if (!locked) {
    chip.onclick = () => { if (PlanDiff.decide(m, it.id, side)) renderMerge(); };
    const pair = (on) => { for (const c of document.querySelectorAll(`#merge-body .mini-emp[data-emp="${CSS.escape(empId)}"]`)) c.classList.toggle("pair", on); };
    chip.addEventListener("mouseenter", () => pair(true));
    chip.addEventListener("mouseleave", () => pair(false));
    chip.addEventListener("focus", () => pair(true));
    chip.addEventListener("blur", () => pair(false));
  }
  return chip;
}
/* a two-way choice for one item: [carry-over text | forecast text] */
function mergeSeg(itemId, carryText, forecastText, label) {
  const m = state.merge.model;
  const d = PlanDiff.decisionOf(m, itemId);
  const seg = mkEl("div", "merge-seg" + (d ? "" : " undecided"));
  seg.setAttribute("role", "radiogroup");
  seg.setAttribute("aria-label", label);
  for (const [side, text, tip] of [["carry", carryText, "Carry-over"], ["forecast", forecastText, "Forecast"]]) {
    const b = mkEl("button", null, text);
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(d === side));
    b.title = tip;
    b.disabled = state.merge.applying;
    b.onclick = () => { if (PlanDiff.decide(m, itemId, side)) renderMerge(); };
    seg.appendChild(b);
  }
  return seg;
}
function mergeCell(side, chips, emptyText) {
  const cell = mkEl("div", "merge-cell" + (side === "forecast" ? " fc" : ""));
  cell.appendChild(mkEl("span", "merge-cell-label", side === "carry" ? "Carry-over" : "Forecast"));
  if (chips.length) for (const c of chips) cell.appendChild(c);
  else cell.appendChild(mkEl("span", "merge-empty", emptyText));
  return cell;
}
function mergeMissionRow(key) {
  const sm = state.merge, m = sm.model;
  const bm = m.baseByKey.get(key), fm = m.proposedByKey.get(key);
  const mis = fm || bm;
  const eng = D().engineers.find(e => e.id === mis.engineerId);
  const onBoard = PlanDiff.missionOnBoard(m, key);
  const people = [...m.people.entries()];
  const carryIds = people.filter(([, p]) => p.from.kind === "mission" && p.from.key === key).map(([id]) => id);
  const fcIds = people.filter(([, p]) => p.to.kind === "mission" && p.to.key === key).map(([id]) => id);
  const after = onBoard ? people.filter(([id]) => { const r = PlanDiff.resultPlace(m, id); return r.kind === "mission" && r.key === key; }).length : 0;
  const items = mergeRowItems(key);

  const row = mkEl("div", "merge-row" + (onBoard ? "" : " gone") + (items.some(mergeMatchesFilter) || sm.filter === "all" ? "" : " dim"));
  const info = mkEl("div", "merge-info");
  if (eng) info.style.borderLeftColor = eng.color;
  const head = mkEl("div", "merge-num");
  head.appendChild(mkEl("b", null, mis.number));
  head.appendChild(mkEl("span", "merge-shift" + (mis.shift === "night" ? " night" : ""), shiftWord(mis.shift).toUpperCase()));
  info.appendChild(head);
  info.appendChild(mkEl("div", "merge-host", `${mis.host} → ${mis.customer}`));
  for (const it of items.filter(i => i.type === "field")) {
    const f = mkEl("div", "merge-field");
    f.appendChild(mkEl("span", "merge-field-label", `${it.label}:`));
    const val = (v) => (it.field === "hidden" ? v : diffFieldValue(it.field, v));
    f.appendChild(mergeSeg(it.id, val(it.carry), val(it.forecast), `${it.label} on ${mis.number}`));
    info.appendChild(f);
  }
  const add = items.find(i => i.type === "add");
  if (add) {
    const f = mkEl("div", "merge-field");
    f.appendChild(mkEl("span", "merge-field-label", `New in ${add.forecaster ? who(add.forecaster) + "'s" : "the"} forecast:`));
    f.appendChild(mergeSeg(add.id, "Don't add", "Add", `Add mission ${mis.number}`));
    info.appendChild(f);
  }
  const rem = items.find(i => i.type === "remove");
  if (rem) {
    const f = mkEl("div", "merge-field");
    f.appendChild(mkEl("span", "merge-field-label", "Not in the forecast:"));
    f.appendChild(mergeSeg(rem.id, "Keep", "Remove", `Keep mission ${mis.number}`));
    info.appendChild(f);
  }
  info.appendChild(mkEl("div", "merge-after", onBoard ? `After merge: ${after} ${after === 1 ? "person" : "people"}` : (add ? "Not added" : "Removed")));
  const bulk = items.filter(i => i.type !== "add" && i.type !== "remove" && !(i.type === "person" && i.free) && !PlanDiff.mergeLocked(m, i));
  if (bulk.length && !sm.applying) {
    const acts = mkEl("div", "merge-row-acts");
    for (const [side, text] of [["carry", "Keep carry-over"], ["forecast", "Use forecast"]]) {
      const b = mkEl("button", "btn btn-small", text);
      b.type = "button";
      b.title = side === "carry" ? "Keep this mission as the carry-over has it: its crew and details" : "Make this mission match the forecast: its crew and details";
      b.onclick = () => { for (const it of bulk) PlanDiff.decide(m, it.id, side); renderMerge(); };
      acts.appendChild(b);
    }
    info.appendChild(acts);
  }
  row.appendChild(info);
  row.appendChild(mergeCell("carry", carryIds.map(id => mergeChip(id, "carry")), bm ? "Nobody" : "Not on the carry-over"));
  row.appendChild(mergeCell("forecast", fcIds.map(id => mergeChip(id, "forecast")), fm ? "Nobody" : "Not in the forecast"));
  return row;
}
/* Leave, and Standby for the people who move on or off it */
function mergeLaneRow(kind) {
  const sm = state.merge, m = sm.model;
  const people = [...m.people.entries()];
  const test = kind === "leave" ? (p) => p.kind === "zone" : (p) => p.kind === "standby";
  const moving = (id) => m.byId.has("person:" + id);
  const carryIds = people.filter(([id, p]) => test(p.from) && (kind === "leave" || moving(id))).map(([id]) => id);
  const fcIds = people.filter(([id, p]) => test(p.to) && (kind === "leave" || moving(id))).map(([id]) => id);
  if (!carryIds.length && !fcIds.length) return null;
  const items = [...carryIds, ...fcIds].map(id => m.byId.get("person:" + id)).filter(Boolean);
  const row = mkEl("div", "merge-row lane" + (items.some(mergeMatchesFilter) || sm.filter === "all" ? "" : " dim"));
  const info = mkEl("div", "merge-info");
  info.appendChild(mkEl("div", "merge-num", kind === "leave" ? "Leave" : "Standby"));
  info.appendChild(mkEl("div", "merge-host", kind === "leave" ? "Annual, sick, business…" : "Only the people who move on or off it"));
  row.appendChild(info);
  row.appendChild(mergeCell("carry", carryIds.map(id => mergeChip(id, "carry")), "Nobody"));
  row.appendChild(mergeCell("forecast", fcIds.map(id => mergeChip(id, "forecast")), "Nobody"));
  return row;
}
/* the forecasters a carry-over choice will alert: never the planner, never 'migrated' */
function mergeAlertItems() {
  const m = state.merge.model;
  return m.items.filter(it => it.forecaster && !sameEmail(it.forecaster, state.myEmail) && it.forecaster.toLowerCase() !== "migrated"
    && PlanDiff.decisionOf(m, it.id) === "carry" && !PlanDiff.mergeLocked(m, it));
}
function mergeItemText(it) {
  if (it.type === "person") return `${empName(it.empId)} kept on ${mergePlaceLabel(PlanDiff.carryPlace(state.merge.model, it.from))}`;
  const mis = mergeMissionOf(it.key);
  if (it.type === "field") return `${mis.number} ${it.label.toLowerCase()} kept at ${it.field === "hidden" ? it.carry : diffFieldValue(it.field, it.carry)}`;
  if (it.type === "add") return `${mis.number} ${shiftWord(mis.shift)} not added`;
  return `${mis.number} kept`;
}
function mergeReasonsEl() {
  const sm = state.merge;
  const list = mergeAlertItems();
  if (!list.length) return null;
  const box = mkEl("section", "merge-reasons");
  box.appendChild(mkEl("h4", null, "Reasons for the forecasters (optional)"));
  box.appendChild(mkEl("p", "import-note", "Each engineer below gets an alert that part of their forecast was not used. A reason is shown with it and kept in the merge log."));
  for (const it of list) {
    const row = mkEl("div", "merge-reason");
    const t = mkEl("div", "merge-reason-text");
    t.appendChild(mkEl("b", null, mergeItemText(it)));
    t.appendChild(mkEl("small", null, `instead of ${who(it.forecaster)}'s forecast`));
    row.appendChild(t);
    const right = mkEl("div", "merge-reason-input");
    const qs = mkEl("div", "merge-quick");
    for (const q of MERGE_REASONS) {
      const b = mkEl("button", "merge-qchip", q);
      b.type = "button";
      b.disabled = sm.applying;
      b.onclick = () => { sm.reasons[it.id] = q; const inp = row.querySelector("input"); if (inp) inp.value = q; };
      qs.appendChild(b);
    }
    right.appendChild(qs);
    const inp = document.createElement("input");
    inp.type = "text";
    inp.id = "merge-reason-" + it.id.replace(/[^a-z0-9]/gi, "-");
    inp.maxLength = 200;
    inp.placeholder = "Optional reason";
    inp.value = sm.reasons[it.id] || "";
    inp.disabled = sm.applying;
    inp.setAttribute("aria-label", `Reason: ${mergeItemText(it)}`);
    inp.oninput = () => { sm.reasons[it.id] = inp.value; };
    right.appendChild(inp);
    row.appendChild(right);
    box.appendChild(row);
  }
  return box;
}
function renderMergeTools() {
  const sm = state.merge;
  const box = $("#merge-tools");
  box.innerHTML = "";
  box.classList.toggle("hidden", sm.step !== "review" || !sm.model.items.length);
  if (sm.step !== "review") return;
  const legend = mkEl("div", "merge-legend");
  for (const [cls, text] of [["same", "Same on both sides"], ["conf", "Needs a decision"], ["kept", "Kept"], ["dropped", "Not used"]]) {
    const chip = mkEl("span", "mini-emp legend " + cls);
    chip.appendChild(mkEl("span", "mini-name", text));
    legend.appendChild(chip);
  }
  box.appendChild(legend);
  const bar = mkEl("div", "merge-filter");
  const counts = { all: 0, none: 0 };
  for (const it of sm.model.items) {
    if (!mergeBulkable(it)) continue;
    counts.all++;
    const k = it.forecaster ? it.forecaster.toLowerCase() : "none";
    counts[k] = (counts[k] || 0) + 1;
  }
  const chips = [["all", "All"], ...sm.forecasters.map(f => [f, who(f)]), ...(counts.none ? [["none", "No forecaster"]] : [])];
  for (const [k, text] of chips) {
    const b = mkEl("button", "merge-fchip");
    b.type = "button";
    b.setAttribute("aria-pressed", String(sm.filter === k));
    if (k !== "all" && k !== "none") { const d = mkEl("i", "mini-dot"); d.style.background = mergeFcColor(k); b.appendChild(d); }
    b.appendChild(document.createTextNode(`${text} · ${counts[k] || 0}`));
    b.onclick = () => { sm.filter = k; renderMerge(); };
    bar.appendChild(b);
  }
  const whose = sm.filter === "all" ? "" : sm.filter === "none" ? " (no forecaster)" : ` (${who(sm.filter)}'s)`;
  for (const [side, text] of [["carry", `Keep carry-over for all${whose}`], ["forecast", `Take forecast for all${whose}`]]) {
    const b = mkEl("button", "btn btn-small", text);
    b.type = "button";
    b.disabled = sm.applying;
    b.onclick = () => { for (const it of sm.model.items) if (mergeBulkable(it) && mergeMatchesFilter(it)) PlanDiff.decide(sm.model, it.id, side); renderMerge(); };
    bar.appendChild(b);
  }
  box.appendChild(bar);
}
function renderMerge() {
  const sm = state.merge;
  if (!sm) return;
  const m = sm.model;
  $("#merge-title").textContent = `Review & merge forecast — ${fmtShort(sm.date)}`;
  const src = sm.carriedFrom ? `carried over from ${fmtShort(sm.carriedFrom)}` : "the confirmed plan";
  $("#merge-sub").textContent = sm.step === "confirm"
    ? "Check what the merge will do, then confirm."
    : `Left: ${src}. Right: the forecast (dashed). Click a flagged person on the side you want to keep; hover to see where they are on the other side. Only the chosen side is written, and people placed on missions go into the Host Record.`;
  renderMergeTools();
  const body = $("#merge-body");
  body.innerHTML = "";
  if (sm.step === "confirm") body.appendChild(mergeConfirmEl());
  else if (!m.items.length) {
    body.appendChild(mkEl("p", "import-note", "No differences — the confirmed plan already matches the forecast."));
  } else {
    const grid = mkEl("div", "merge-grid");
    const head = mkEl("div", "merge-row merge-head");
    for (const t of ["Mission", "Carry-over (solid)", "Forecast (dashed)"]) head.appendChild(mkEl("div", null, t));
    grid.appendChild(head);
    for (const key of mergeRowKeys()) grid.appendChild(mergeMissionRow(key));
    for (const k of ["leave", "standby"]) { const r = mergeLaneRow(k); if (r) grid.appendChild(r); }
    body.appendChild(grid);
    const reasons = mergeReasonsEl();
    if (reasons) body.appendChild(reasons);
  }
  renderMergeFooter();
}
function renderMergeFooter() {
  const sm = state.merge, m = sm.model;
  const total = m.items.length, left = PlanDiff.pending(m).length, done = total - left;
  const prog = $("#merge-progress");
  prog.innerHTML = "";
  if (total) {
    prog.appendChild(mkEl("span", "merge-prog-text", sm.step === "confirm" ? "Every difference has a side" : `${done} of ${total} differences decided`));
    const bar = mkEl("span", "merge-prog-bar");
    const fill = mkEl("i");
    fill.style.width = `${Math.round((done / total) * 100)}%`;
    bar.appendChild(fill);
    prog.appendChild(bar);
  }
  const apply = $("#btn-merge-apply");
  $("#btn-merge-back").classList.toggle("hidden", sm.step !== "confirm");
  apply.disabled = sm.applying;
  // still clickable while anything is undecided: the click points at what is left
  apply.classList.toggle("merge-pending", left > 0);
  apply.textContent = sm.applying ? "Merging…"
    : !total ? "Mark forecast as merged"
    : sm.step === "confirm" ? "Confirm merge"
    : left ? `Apply (${left} left)` : "Review & apply";
  apply.title = !total ? "Changes nothing on the board; hides the forecast banner for everyone" : "";
}
function mergeConfirmEl() {
  const sm = state.merge, m = sm.model;
  const box = mkEl("div", "merge-confirm");
  const people = [...m.people.entries()];
  const lines = [];
  for (const key of mergeRowKeys()) {
    const before = m.baseByKey.has(key) ? people.filter(([, p]) => p.from.kind === "mission" && p.from.key === key).length : null;
    const on = PlanDiff.missionOnBoard(m, key);
    const after = on ? people.filter(([id]) => { const r = PlanDiff.resultPlace(m, id); return r.kind === "mission" && r.key === key; }).length : null;
    if (before === after) continue;
    const label = mergePlaceLabel({ kind: "mission", key });
    lines.push(before === null ? `${label}: new, ${after} ${after === 1 ? "person" : "people"}`
      : after === null ? `${label}: removed (${before} ${before === 1 ? "person goes" : "people go"} to Standby)`
      : `${label}: ${before} → ${after} people`);
  }
  const fields = m.items.filter(it => it.type === "field" && PlanDiff.decisionOf(m, it.id) === "forecast");
  for (const it of fields) lines.push(`${mergePlaceLabel({ kind: "mission", key: it.key })}: ${it.label} → ${it.field === "hidden" ? it.forecast : diffFieldValue(it.field, it.forecast)}`);
  box.appendChild(mkEl("h4", null, "On the confirmed board"));
  if (lines.length) { const ul = mkEl("ul"); for (const l of lines) ul.appendChild(mkEl("li", null, l)); box.appendChild(ul); }
  else box.appendChild(mkEl("p", "import-note", "No crew sizes change. Only the people and details you picked from the forecast are written."));
  const alerts = mergeAlertItems();
  const byWho = new Map();
  for (const it of alerts) byWho.set(it.forecaster.toLowerCase(), (byWho.get(it.forecaster.toLowerCase()) || 0) + 1);
  const call = mkEl("div", "merge-callout" + (alerts.length ? "" : " ok"));
  if (alerts.length && feat().mergeLog) {
    call.appendChild(mkEl("b", null, "Alerts that will be sent"));
    const ul = mkEl("ul");
    for (const [f, n] of byWho) ul.appendChild(mkEl("li", null, `${who(f)}: ${n} ${n === 1 ? "part" : "parts"} of their forecast not used`));
    call.appendChild(ul);
  } else if (alerts.length) {
    call.appendChild(mkEl("span", null, `${alerts.length} forecast ${alerts.length === 1 ? "placement is" : "placements are"} not used. This database can't send alerts yet (run migration-2026-09-29-forecast-merge-review.sql), so tell ${[...byWho.keys()].map(who).join(", ")} yourself.`));
  } else {
    call.appendChild(mkEl("span", null, "Everything forecast by other engineers is used. Nobody gets an alert."));
  }
  box.appendChild(call);
  if (feat().mergeLog) box.appendChild(mkEl("p", "import-note", "Every decision and reason is saved in the merge log, linked from the “Forecast merged” note on this day. The forecast itself is kept, read-only."));
  return box;
}
function onMergeApply() {
  const sm = state.merge;
  if (!sm || sm.applying) return;
  const left = PlanDiff.pending(sm.model);
  if (left.length) {
    const first = document.querySelector("#merge-body .mini-emp.conf, #merge-body .merge-seg.undecided");
    if (first) {
      first.scrollIntoView({ block: "center", behavior: "smooth" });
      first.classList.remove("merge-flash");
      void first.offsetWidth;
      first.classList.add("merge-flash");
    }
    toast(`${left.length} ${left.length === 1 ? "difference still needs" : "differences still need"} a side before the merge.`, "warn");
    return;
  }
  if (sm.step === "review" && sm.model.items.length) { sm.step = "confirm"; renderMerge(); return; }
  applyMerge();
}
function applyMerge() {
  const sm = state.merge;
  sm.applying = true;
  renderMergeFooter();
  (async () => {
    try {
      const rows = PlanDiff.decisionRows(sm.model, {
        place: mergePlaceLong,
        field: (f, v) => (f === "hidden" ? String(v) : diffFieldValue(f, v)),
      }, sm.reasons);
      const sum = await cloud.applyForecastMerge(sm.boardId, sm.date, sm.model, rows);
      state.merge = null;
      closeModal();
      const bits = [];
      if (sum.added) bits.push(`${sum.added} mission${sum.added === 1 ? "" : "s"} added`);
      if (sum.updated) bits.push(`${sum.updated} updated`);
      if (sum.placed) bits.push(`${sum.placed} ${sum.placed === 1 ? "person" : "people"} placed`);
      if (sum.removed) bits.push(`${sum.removed} removed`);
      if (sum.alerts) bits.push(`${sum.alerts} forecast alert${sum.alerts === 1 ? "" : "s"} sent`);
      toast(`Forecast merged${bits.length ? ": " + bits.join(", ") : ""}.`, "info");
      if (!sum.logged && feat().mergeLog) toast("The board was updated, but the decision log and the alerts could not be saved.", "warn", { duration: 12000 });
      await refreshAndRender();
    } catch (e) {
      sm.applying = false;
      renderMerge();
      toast(e.message || String(e), "error");
    }
  })();
}

/* ======================================================================
   Forecast alerts, merge kind (D1): what an engineer sees when the day
   they forecast was confirmed without some of it. Drawn from the alert rows
   plus the day's forecast and confirmed plan, so "your forecast" and "on
   the board" are both read live, not from what the alert remembered.
   ====================================================================== */
const holdPlanCache = new Map();   // "board|date" -> { forecast, plan } while the alerts are open
function holdPlans(boardId, date) {
  const k = boardId + "|" + date;
  const v = holdPlanCache.get(k);
  if (v && v !== "loading") return v;
  if (!v) {
    holdPlanCache.set(k, "loading");
    Promise.all([cloud.ensureForecastLoaded(boardId, date), cloud.ensurePlanLoaded(boardId, date)])
      .then(([forecast, plan]) => { holdPlanCache.set(k, { forecast, plan }); })
      .catch((e) => { console.warn("forecast alert plans not loaded:", e && e.message || e); holdPlanCache.set(k, { forecast: null, plan: null }); })
      .then(() => { if (!$("#modal-holds").classList.contains("hidden")) renderHoldEventsModal(); });
  }
  return null;
}
function planPlaceOf(plan, empId) {
  if (!plan) return null;
  for (const m of plan.missions || []) if (!m.hidden && (m.members || []).includes(empId)) return { kind: "mission", key: PlanDiff.missionKey(m), mission: m };
  for (const z of ZONES) if (((plan.zones || {})[z] || []).includes(empId)) return { kind: "zone", zone: z };
  return { kind: "standby" };
}
const samePlanPlace = (a, b) => !!a && !!b && a.kind === b.kind && (a.kind === "standby" || (a.kind === "mission" ? a.key === b.key : a.zone === b.zone));
function planPlaceText(p) {
  if (!p) return "…";
  if (p.kind === "mission") return `${p.mission.number} ${shiftWord(p.mission.shift)}`;
  if (p.kind === "zone") return ZONE_LABELS[p.zone] || p.zone;
  return "Standby";
}
function planPlaceSub(p) {
  if (!p) return "";
  if (p.kind === "mission") return `${p.mission.host} → ${p.mission.customer}`;
  return p.kind === "zone" ? "Leave" : "Not on a mission";
}
function eventBoardId(e) {
  if (e.detail && e.detail.board_id) return e.detail.board_id;
  const hm = e.fromMissionId && D().holdMissions[e.fromMissionId];
  if (hm) return hm.boardId;
  const emp = D().employees.find(x => x.id === e.employeeId);
  return emp ? emp.boardId : null;
}
function alertPill(kind, main, sub, color) {
  const p = mkEl("span", "alert-pill " + kind);
  if (color) p.style.borderTopColor = color;
  p.appendChild(mkEl("span", "alert-pill-k", kind === "plan" ? "Forecast" : "On the board"));
  p.appendChild(mkEl("b", null, main));
  if (sub) p.appendChild(mkEl("small", null, sub));
  return p;
}
function alertArrow() {
  const a = mkEl("span", "alert-arrow");
  a.setAttribute("aria-hidden", "true");
  a.innerHTML = icon("arrow-right");
  return a;
}
function mergeAlertsEl(events, mayAck) {
  const wrap = mkEl("div", "merge-alerts");
  // one block per forecast day (and whose forecast it was)
  const days = new Map();
  for (const e of events) {
    const k = [eventBoardId(e), e.date, (e.fromHeldBy || "").toLowerCase()].join("|");
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(e);
  }
  for (const [k, evs] of days) {
    const [boardId, date, holder] = k.split("|");
    const mine = sameEmail(holder, state.myEmail);
    const plans = boardId ? holdPlans(boardId, date) : { forecast: null, plan: null };
    const day = mkEl("section", "alert-day");
    const top = mkEl("div", "alert-top");
    const notice = mkEl("div", "alert-notice");
    const takers = [...new Set(evs.map(e => e.takenBy))];
    const av = mkEl("span", "alert-avatar", initialsOf(takers[0]));
    av.title = who(takers[0]);
    notice.appendChild(av);
    const nt = mkEl("div", "alert-notice-text");
    nt.appendChild(mkEl("b", null, `${takers.map(who).join(", ")} merged ${mine ? "your" : who(holder) + "'s"} forecast for ${fmtShort(date)}.`));
    nt.appendChild(mkEl("small", null, `${evs.length} ${evs.length === 1 ? "part was" : "parts were"} not used · ${fmtStamp(evs[0].takenAt)}`));
    notice.appendChild(nt);
    top.appendChild(notice);
    // scorecard: every person this engineer forecast that day, used or not
    const card = mkEl("div", "alert-score");
    if (plans && plans.forecast) {
      const heldHere = Object.entries(plans.forecast.holds || {}).filter(([, by]) => sameEmail(by, holder)).map(([id]) => id);
      const lost = new Set(heldHere.filter(id => !samePlanPlace(planPlaceOf(plans.forecast, id), planPlaceOf(plans.plan, id))));
      const hd = mkEl("div", "alert-score-head");
      hd.appendChild(mkEl("span", "alert-score-big", `${heldHere.length - lost.size}/${heldHere.length}`));
      hd.appendChild(mkEl("b", null, "people placed as planned"));
      card.appendChild(hd);
      const tiles = mkEl("div", "alert-score-tiles");
      for (const id of heldHere) tiles.appendChild(miniEmp(id, { cls: "small " + (lost.has(id) ? "lost" : "used"), flag: lost.has(id) ? "not used" : "✓" }));
      for (const e of evs.filter(x => x.detail && x.detail.type !== "person")) {
        const d = e.detail;
        tiles.appendChild(mkEl("span", "alert-score-pill", d.type === "add" ? `New ${d.mission_number}` : `${d.mission_number} ${mergeFieldLabel(d.field)}`));
      }
      card.appendChild(tiles);
    } else {
      card.appendChild(mkEl("span", "import-note", "Loading the forecast…"));
    }
    top.appendChild(card);
    day.appendChild(top);

    // one card per forecast mission (or Leave) that lost something
    const groups = new Map();
    for (const e of evs) {
      const g = e.fromMissionId || ("zone:" + (e.fromZone || "?"));
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(e);
    }
    for (const [g, list] of groups) day.appendChild(mergeAlertGroupEl(g, list, plans, mayAck));
    wrap.appendChild(day);
  }
  return wrap;
}
function mergeAlertGroupEl(g, list, plans, mayAck) {
  const isMission = !g.startsWith("zone:");
  const hm = isMission ? D().holdMissions[g] : null;
  const fMission = isMission && plans && plans.forecast ? plans.forecast.missions.find(m => m.id === g) : null;
  const mis = fMission || hm;
  const eng = mis && D().engineers.find(e => e.id === mis.engineerId);
  const card = mkEl("section", "alert-group");
  const head = mkEl("div", "alert-group-head");
  if (eng) head.style.borderTopColor = eng.color;
  if (mis) {
    head.appendChild(mkEl("b", "alert-group-num", mis.number));
    head.appendChild(mkEl("span", "merge-shift" + (mis.shift === "night" ? " night" : ""), shiftWord(mis.shift).toUpperCase()));
    head.appendChild(mkEl("span", "alert-group-host", `${mis.host} → ${mis.customer}`));
  } else {
    head.appendChild(mkEl("b", "alert-group-num", isMission ? "Mission" : "Leave"));
  }
  head.appendChild(mkEl("span", "alert-sp"));
  const open = list;
  if (mayAck && open.length > 1) {
    const b = mkEl("button", "hold-badge mine", `${open.length} not used · Acknowledge all`);
    b.type = "button";
    b.onclick = () => safely(async () => { await cloud.acknowledgeHoldEvents(open.map(e => e.id)); renderHoldEventsModal(); render(); });
    head.appendChild(b);
  } else {
    head.appendChild(mkEl("span", "hold-badge mine", `${open.length} not used`));
  }
  card.appendChild(head);

  // your forecast vs the board, for a mission that lost people
  const personish = list.some(e => !e.detail || e.detail.type === "person" || e.detail.type === "add");
  if (isMission && personish && plans && plans.forecast && fMission) {
    const planned = fMission.members || [];
    const bMission = (plans.plan.missions || []).find(m => !m.hidden && PlanDiff.missionKey(m) === PlanDiff.missionKey(fMission));
    const here = { kind: "mission", key: PlanDiff.missionKey(fMission) };
    const cmp = mkEl("div", "alert-compare");
    cmp.appendChild(mkEl("div", "alert-lane-label", `Forecast · ${planned.length}`));
    const lp = mkEl("div", "alert-lane plan");
    for (const id of planned) {
      const lost = !samePlanPlace(planPlaceOf(plans.plan, id), here);
      lp.appendChild(miniEmp(id, { cls: lost ? "lost" : "", flag: lost ? "not used" : null }));
    }
    if (!planned.length) lp.appendChild(mkEl("span", "merge-empty", "Nobody"));
    cmp.appendChild(lp);
    const onBoard = bMission ? (bMission.members || []) : [];
    cmp.appendChild(mkEl("div", "alert-lane-label", bMission ? `On the board · ${onBoard.length}` : "On the board"));
    const lb = mkEl("div", "alert-lane board");
    if (!bMission) { lb.appendChild(mkEl("span", "alert-stamp", "NOT ADDED")); lb.appendChild(mkEl("span", "merge-empty", "This mission is not on the confirmed board.")); }
    for (const id of onBoard) lb.appendChild(planned.includes(id) ? miniEmp(id) : miniEmp(id, { cls: "newc", flag: "not in forecast" }));
    if (bMission && !onBoard.length) lb.appendChild(mkEl("span", "merge-empty", "Nobody"));
    cmp.appendChild(lb);
    card.appendChild(cmp);
  }

  const color = eng ? eng.color : null;
  for (const e of list) {
    const d = e.detail || { type: "person" };
    const row = mkEl("div", "alert-change");
    const flow = mkEl("div", "alert-flow");
    if (d.type === "field") {
      row.appendChild(mkEl("span", "alert-field-chip", mergeFieldLabel(d.field)));
      flow.appendChild(alertPill("plan", d.forecast_value || "(blank)", null, color));
      flow.appendChild(alertArrow());
      flow.appendChild(alertPill("board", d.carry_value || "(blank)", null, color));
    } else if (d.type === "add") {
      row.appendChild(mkEl("span", "alert-field-chip", "Mission"));
      flow.appendChild(mkEl("span", null, "This new mission was not added. Its crew stayed where they were:"));
      for (const id of (fMission ? fMission.members : [])) {
        const at = plans && planPlaceOf(plans.plan, id);
        const it = mkEl("span", "alert-crew");
        it.appendChild(miniEmp(id));
        it.appendChild(mkEl("span", "mini-note", "→ " + planPlaceText(at)));
        flow.appendChild(it);
      }
    } else {
      row.appendChild(miniEmp(e.employeeId, { cls: "big" }));
      const fp = plans && plans.forecast ? planPlaceOf(plans.forecast, e.employeeId) : null;
      const bp = plans && plans.plan ? planPlaceOf(plans.plan, e.employeeId) : null;
      flow.appendChild(alertPill("plan", fp ? planPlaceText(fp) : holdPlace(e.fromMissionId, e.fromZone), fp ? planPlaceSub(fp) : "", color));
      flow.appendChild(alertArrow());
      const bm = bp && bp.kind === "mission" ? D().engineers.find(x => x.id === bp.mission.engineerId) : null;
      flow.appendChild(alertPill("board", bp ? planPlaceText(bp) : (d.carry_value || "…"), bp ? planPlaceSub(bp) : "", bm ? bm.color : null));
    }
    row.appendChild(flow);
    const acts = mkEl("div", "alert-acts");
    const go = mkEl("button", "btn btn-small", "Open day");
    go.type = "button";
    go.onclick = () => { closeModal(); clearSelection(); const b = eventBoardId(e); if (b) D().activeBoardId = b; state.date = e.date; refreshAndRender(); };
    acts.appendChild(go);
    if (mayAck) {
      const ack = mkEl("button", "btn btn-small btn-primary", "Acknowledge");
      ack.type = "button";
      ack.onclick = () => safely(async () => { await cloud.acknowledgeHoldEvents([e.id]); renderHoldEventsModal(); render(); });
      acts.appendChild(ack);
    }
    row.appendChild(acts);
    const bubble = mkEl("div", "alert-bubble");
    const bav = mkEl("span", "alert-avatar small", initialsOf(e.takenBy));
    bav.title = who(e.takenBy);
    bubble.appendChild(bav);
    bubble.appendChild(mkEl("span", "alert-quote" + (e.reason ? "" : " none"), e.reason ? `“${e.reason}”` : "No reason given"));
    row.appendChild(bubble);
    card.appendChild(row);
  }
  return card;
}

/* ======================================================================
   Merge decision log (D2): every decision behind a merged forecast.
   ====================================================================== */
function mergeDecisionItemText(r) {
  const mis = r.mission_number ? `${r.mission_number} ${shiftWord(r.mission_shift)}` : "";
  if (r.item_type === "person") return r.employee_id ? empName(r.employee_id) : "(removed employee)";
  if (r.item_type === "field") return `${mis} · ${mergeFieldLabel(r.field)}`;
  if (r.item_type === "add") return `${mis} · new mission`;
  return `${mis} · mission`;
}
const decisionNotUsed = (r) => r.choice === "carry" && !!r.forecaster && r.forecaster.toLowerCase() !== "migrated" && r.forecaster.toLowerCase() !== String(r.merged_by || "").toLowerCase();
function openMergeLog() {
  $("#merge-log-only").checked = false;
  renderMergeLog();
  openModal("#modal-merge-log");
}
function renderMergeLog() {
  const sig = signalsForScreen();
  const rows = (sig && sig.decisions) || [];
  $("#merge-log-title").textContent = `Merge decisions — ${fmtShort(state.date)}`;
  const only = $("#merge-log-only").checked;
  const body = $("#merge-log-body");
  body.innerHTML = "";
  const merges = new Map();
  for (const r of rows) { if (!merges.has(r.merge_id)) merges.set(r.merge_id, []); merges.get(r.merge_id).push(r); }
  const nu = rows.filter(decisionNotUsed).length;
  $("#merge-log-sub").textContent = rows.length
    ? `${rows.length} ${rows.length === 1 ? "decision" : "decisions"}; ${nu} ${nu === 1 ? "part" : "parts"} of the forecast not used. Highlighted rows alerted the engineer who forecast them.`
    : "No decisions were recorded for this merge.";
  for (const [, list] of merges) {
    const r0 = list[0];
    body.appendChild(mkEl("p", "merge-log-when", `Merged by ${who(r0.merged_by)} · ${fmtStamp(r0.merged_at)}`));
    const wrap = mkEl("div", "merge-log-wrap");
    const table = mkEl("table", "merge-log");
    const thead = mkEl("thead");
    const hr = mkEl("tr");
    for (const t of ["Item", "Carry-over", "Forecast", "Result", "Forecast by", "Reason"]) hr.appendChild(mkEl("th", null, t));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tb = mkEl("tbody");
    const order = { person: 0, field: 1, add: 2, remove: 3 };
    const sorted = [...list].sort((a, b) => (order[a.item_type] - order[b.item_type]) || mergeDecisionItemText(a).localeCompare(mergeDecisionItemText(b)));
    for (const r of sorted) {
      if (only && !decisionNotUsed(r)) continue;
      const tr = mkEl("tr", decisionNotUsed(r) ? "not-used" : "");
      tr.appendChild(mkEl("td", "merge-log-item", mergeDecisionItemText(r)));
      tr.appendChild(mkEl("td", null, r.carry_value || ""));
      tr.appendChild(mkEl("td", null, r.forecast_value || ""));
      const res = mkEl("td");
      res.appendChild(mkEl("span", "merge-res " + (r.choice === "forecast" ? "f" : "c"), r.choice === "forecast" ? "Forecast" : "Carry-over"));
      tr.appendChild(res);
      tr.appendChild(mkEl("td", null, r.forecaster ? who(r.forecaster) : "—"));
      tr.appendChild(mkEl("td", "merge-log-reason", r.reason || ""));
      tb.appendChild(tr);
    }
    if (!tb.children.length) { const tr = mkEl("tr"); const td = mkEl("td", "import-note", "Nothing for this filter."); td.colSpan = 6; tr.appendChild(td); tb.appendChild(tr); }
    table.appendChild(tb);
    wrap.appendChild(table);
    body.appendChild(wrap);
  }
}

/* ---------- forecast: copy to next days, read-only viewer ---------- */
function openForecastCopyModal() {
  guardEdit(() => {
    $("#forecast-copy-n").value = "5";
    updateForecastCopyPreview();
    openModal("#modal-forecast-copy");
  });
}
function forecastCopyTargets() {
  const n = Math.max(1, Math.min(10, parseInt($("#forecast-copy-n").value, 10) || 1));
  return nextWorkingDates(D().activeBoardId, state.date, n);
}
function updateForecastCopyPreview() {
  const dates = forecastCopyTargets();
  $("#forecast-copy-dates").textContent = `Copies ${fmtShort(state.date)}'s forecast onto: ${dates.map(fmtShort).join(", ")}. A day that already has a forecast is skipped, never overwritten.`;
}
function confirmForecastCopy() {
  const dates = forecastCopyTargets();
  safely(async () => {
    const res = await cloud.copyForecastToDates(D().activeBoardId, state.date, dates);
    closeModal();
    await refreshAndRender();
    toast(`Copied to ${res.copied.length} day${res.copied.length === 1 ? "" : "s"}` +
      (res.skipped.length ? `; skipped ${res.skipped.map(fmtShort).join(", ")} (already forecast)` : "") + ".", "info");
  });
}
function openForecastViewer() {
  const sig = signalsForScreen();
  const plan = sig && sig.forecast;
  if (!plan) return;
  $("#forecast-view-title").textContent = `Forecast for ${fmtShort(state.date)}`;
  const list = $("#forecast-view-list");
  list.innerHTML = "";
  const missions = [...plan.missions].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  for (const m of missions) {
    const row = document.createElement("div");
    row.className = "import-row";
    const info = document.createElement("span");
    info.className = "import-info";
    const b = document.createElement("b");
    b.textContent = m.number;
    info.appendChild(b);
    info.appendChild(document.createTextNode(` — ${m.host} → ${m.customer}`));
    const small = document.createElement("small");
    small.textContent = `${m.shift === "night" ? "Night" : "Day"} ${m.startTime}-${m.endTime} • ${m.members.length ? m.members.map(empName).join(", ") : "nobody yet"}`;
    info.appendChild(small);
    row.appendChild(info);
    list.appendChild(row);
  }
  for (const z of ZONES) {
    if (!plan.zones[z].length) continue;
    const p = document.createElement("p");
    p.className = "import-note";
    p.textContent = `${ZONE_LABELS[z]}: ${plan.zones[z].map(empName).join(", ")}`;
    list.appendChild(p);
  }
  if (!list.children.length) list.innerHTML = '<p class="import-note">This forecast is empty.</p>';
  openModal("#modal-forecast-view");
}

/* ---------- small generic menu (Capacity cells) on the shared #context-menu ---------- */
function showQuickMenu(x, y, items) {
  const menu = $("#context-menu");
  menu.innerHTML = "";
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "ctx-item" + (it.danger ? " ctx-danger" : "");
    row.setAttribute("role", "menuitem");
    row.textContent = it.label;
    row.onclick = () => { hideContextMenu(); it.run(); };
    menu.appendChild(row);
  }
  menu.classList.remove("hidden");
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + "px";
}

/* ---------- Capacity tab ---------- */
function capacityRange() {
  const from = todayStr();
  return { from, to: addDays(from, state.capacity.weeks * 7 - 1) };
}
async function ensureCapacityLoaded() {
  const { from, to } = capacityRange();
  const key = from + ".." + to + "|" + D().employees.length;
  const c = D().capacity;
  if (state.capacity.cacheKey === key && c && c.from === from && c.to === to && state.capacity.inputs) return;
  const [, inputs] = await Promise.all([
    cloud.loadCapacityDemand(from, to),
    cloud.getCapacityInputs(from, to),
  ]);
  state.capacity.inputs = inputs;
  state.capacity.cacheKey = key;
}
/* The board the Capacity tab is showing — one at a time. Falls back to the
   first board the user may see when nothing (or a deleted board) is chosen. */
function capBoardId() {
  const boards = D().boards;
  if (!boards.some(b => b.id === state.capacity.boardId)) state.capacity.boardId = boards.length ? boards[0].id : null;
  return state.capacity.boardId;
}
/* columns: that board's working days in the range; its weekends and holidays
   are simply left out */
function capacityDates(boardId) {
  const { from, to } = capacityRange();
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isNonWorkingDate(d, boardId)) out.push(d);
  return out;
}
const capKey = (boardId, date, host, shift) => [boardId, date, host, shift].join("\u0001");
function capacityRowsFor(boardId, demand) {
  const seen = new Map();
  for (const r of demand) if (r.board_id === boardId) seen.set(r.host + "\u0001" + r.shift, { host: r.host, shift: r.shift });
  for (const r of state.capacity.extraRows[boardId] || []) if (!seen.has(r.host + "\u0001" + r.shift)) seen.set(r.host + "\u0001" + r.shift, r);
  return [...seen.values()].sort((a, b) => a.host.localeCompare(b.host) || (a.shift === "night") - (b.shift === "night"));
}
function saveCapacityCells(cells) {
  safely(async () => { await cloud.setCapacityCells(cells); render(); });
}
/* Everything the chart, the gap chips and the stats row say about one board:
   per working day its demand, who is available (and why not), how many are
   already named on a mission, and the gap — plus the headline figures. */
function capacityModel(boardId) {
  const dates = capacityDates(boardId);
  const inputs = state.capacity.inputs;
  const demand = ((D().capacity && D().capacity.rows) || []).filter(r => r.board_id === boardId);
  const agg = inputs ? Capacity.aggregate({
    boards: [{ id: boardId }], employees: D().employees, dates, isForecast: isForecastDateFor,
    confirmed: inputs.confirmed, forecast: inputs.forecast,
  })[boardId] : {};
  const totals = Capacity.demandTotals(demand)[boardId] || {};
  const days = dates.map(d => {
    const a = agg[d] || null;
    const dem = totals[d] || 0;
    const gap = a ? a.available - dem : null;
    return { date: d, a, demand: dem, gap, kind: gap == null ? null : gap < 0 ? "short" : gap <= 1 ? "tight" : "ok", forecast: isForecastDateFor(boardId, d) };
  });
  const scored = days.filter(x => x.gap != null);
  const worst = scored.reduce((w, x) => (!w || x.gap < w.gap ? x : w), null);
  const peak = days.reduce((p, x) => (!p || x.demand > p.demand ? x : p), null);
  const first = days.find(x => x.a);
  return {
    dates, days, demand,
    short: scored.filter(x => x.gap < 0).length,
    worst, peak,
    roster: first ? { perm: first.a.headPerm, oncall: first.a.headOncall } : null,
  };
}
const fmtGap = (g) => (g > 0 ? "+" + g : g < 0 ? "−" + Math.abs(g) : "0");
const shortDM = (d) => `${fmtDow(d)} ${shortDateLabel(d)}`;

/* Gap chips: "short" for any shortfall, plus "crit" from CAP_CRIT people short —
   drawn solid, so a day 6 short stands out from a day 1 short. Arrow, sign and
   number carry the meaning too, never colour alone. */
const CAP_CRIT = 3;
const capGapWord = (g) => (g < 0 ? `short by ${-g}` : g === 0 ? "exactly enough" : g === 1 ? "1 spare" : `${g} spare`);
function capGapChip(x) {
  const chip = document.createElement("span");
  chip.className = "cap-gapchip " + x.kind + (x.gap <= -CAP_CRIT ? " crit" : "");
  chip.dataset.date = x.date;
  const word = capGapWord(x.gap);
  chip.setAttribute("aria-label", `${fmtDow(x.date)} ${shortDateLabel(x.date)}: ${word}`);
  chip.title = word;
  chip.textContent = `${x.kind === "short" ? "▼" : x.kind === "tight" ? "●" : "▲"} ${fmtGap(x.gap)}`;
  return chip;
}

/* Phone width gets its own layout (one host at a time, a stepper per day)
   instead of a 10-column grid; crossing the breakpoint redraws it. */
const capPhoneMQ = window.matchMedia ? window.matchMedia("(max-width: 640px)") : null;
const capIsPhone = () => !!(capPhoneMQ && capPhoneMQ.matches);
if (capPhoneMQ) {
  const redraw = () => { if (cloud.data && isCapacity()) render(); };
  if (capPhoneMQ.addEventListener) capPhoneMQ.addEventListener("change", redraw); else capPhoneMQ.addListener(redraw);
}

/* the board switch (each board with its count of short days), range and the
   actions in the toolbar row */
function renderCapacityToolbar() {
  const sw = $("#cap-board-switch");
  sw.innerHTML = "";
  const current = capBoardId();
  for (const b of D().boards) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cap-board-btn" + (b.id === current ? " on" : "");
    btn.setAttribute("aria-pressed", String(b.id === current));
    const name = document.createElement("span");
    name.textContent = b.name;
    btn.appendChild(name);
    const short = capacityModel(b.id).short;
    if (short) {
      const n = document.createElement("span");
      n.className = "cap-board-badge";
      n.textContent = String(short);
      btn.appendChild(n);
      btn.title = `${b.name}: ${short} short day${short === 1 ? "" : "s"} in the range`;
      btn.setAttribute("aria-label", btn.title);
    }
    btn.onclick = () => { state.capacity.boardId = b.id; render(); };
    sw.appendChild(btn);
  }
  $("#cap-range").value = String(state.capacity.weeks);
  const mayEdit = can("capacity", "edit");
  $("#btn-cap-copy-week").classList.toggle("hidden", !mayEdit);
  $("#btn-cap-seed").classList.toggle("hidden", !mayEdit);
  $("#btn-cap-more").classList.toggle("hidden", !mayEdit);
}
/* ⋯: Reset to 0 lives here, away from the everyday buttons. On a phone the two
   toolbar actions are hidden (they would wrap the row) and come in here too. */
function openCapacityMoreMenu(ev) {
  ev.stopPropagation();   // the document click handler would close the menu at once
  const r = ev.currentTarget.getBoundingClientRect();
  const items = [];
  if (capIsPhone()) {
    items.push({ label: "Start from confirmed plan", run: seedCapacityFromConfirmed });
    items.push({ label: "Copy this week → next week", run: copyCapacityWeek });
  }
  items.push({ label: "Reset this board to 0…", danger: true, run: resetCapacityToZero });
  showQuickMenu(r.left, r.bottom + 4, items);
}

/* the stats row on the Capacity tab: one summary line instead of four chips */
function renderCapacitySummary(bar, m) {
  const w = state.capacity.weeks;
  const span = `in the next ${w} week${w === 1 ? "" : "s"}`;
  const line = document.createElement("div");
  line.className = "cap-summary";
  // a space between the parts, so the line reads as words (not "dayin") when copied or read aloud
  const part = (html) => { if (line.childNodes.length) line.appendChild(document.createTextNode(" ")); const s = document.createElement("span"); s.innerHTML = html; line.appendChild(s); return s; };
  const scored = m.days.some(x => x.gap != null);
  if (scored) {
    const big = part(m.short ? `${m.short} short day${m.short === 1 ? "" : "s"}` : "No short days");
    big.className = "cap-sum-big " + (m.short ? "bad" : "ok");
    part(span);
    if (m.worst && m.worst.gap <= 1) {
      const w2 = part(`${m.worst.gap < 0 ? "Worst" : "Tightest"} <b>${escapeHtml(shortDM(m.worst.date))}</b> `);
      w2.appendChild(capGapChip(m.worst));
    }
  }
  if (m.peak && m.peak.demand) part(`Peak demand <b>${m.peak.demand}</b> on ${escapeHtml(shortDM(m.peak.date))}`);
  if (m.roster) {
    const r = part(`Roster <b>${m.roster.perm + m.roster.oncall}</b> · ${m.roster.perm} permanent, ${m.roster.oncall} on-call`);
    r.className = "cap-sum-mut";
  }
  bar.appendChild(line);
}

/* Click an Available number: why that day has the people it has. Replaces the
   old hover tooltip, so touch and keyboard users get it too. */
function capClosePop() {
  const pop = document.querySelector(".cap-pop");
  if (!pop) return null;
  const date = pop.dataset.date;
  pop.remove();
  return date;
}
function capShowDay(btn, x) {
  if (capClosePop() === x.date) return;
  const a = x.a;
  const pop = document.createElement("div");
  pop.className = "cap-pop";
  pop.dataset.date = x.date;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", `${fmtDow(x.date)} ${fmtDate(x.date)}: available people`);
  const ln = (label, val, cls) => `<div class="cap-pop-ln${cls ? " " + cls : ""}"><span>${label}</span><span>${val}</span></div>`;
  pop.innerHTML =
    `<div class="cap-pop-title">${escapeHtml(fmtDow(x.date) + " " + fmtDate(x.date))}<span class="cap-pop-mode">${x.forecast ? "Forecast" : "Confirmed"}</span></div>` +
    ln("Permanent", `${a.availPerm} <small>of ${a.headPerm}</small>`) +
    ln("On-call", `${a.availOncall} <small>of ${a.headOncall}</small>`) +
    (a.leavePerm + a.leaveOncall ? ln("On leave", `−${a.leavePerm + a.leaveOncall}`, "sub") : "") +
    ln("Available", a.available, "tot") +
    ln("Demand", x.demand) +
    `<div class="cap-pop-ln tot"><span>Gap</span><span class="cap-pop-gap"></span></div>` +
    `<p class="cap-pop-note">${a.named} already named on a mission${x.demand > a.named ? ` — ${x.demand - a.named} still to name` : ""}.</p>`;
  pop.querySelector(".cap-pop-gap").appendChild(capGapChip(x));
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - pw / 2, window.innerWidth - pw - 8));
  const top = r.bottom + 6 + ph > window.innerHeight - 8 ? Math.max(8, r.top - ph - 6) : r.bottom + 6;
  pop.style.left = left + "px";
  pop.style.top = top + "px";
}

const CAP_STRIP_H = 84;
function renderCapacity() {
  const panel = $("#capacity-panel");
  capClosePop();
  // keep the cell being typed in across a redraw (a Realtime ping from another
  // planner must not throw away what this one is halfway through typing)
  const ae = document.activeElement;
  const keep = ae && ae.dataset && ae.dataset.capKey ? { key: ae.dataset.capKey, value: ae.value, dirty: ae.value !== ae.defaultValue } : null;
  const keepStep = ae && ae.dataset && ae.dataset.capStep ? ae.dataset.capStep : null;
  const clipHadFocus = ae && ae.id === "cap-clip";
  const scrollWas = (panel.querySelector(".cap-scroll") || {}).scrollLeft || 0;
  panel.innerHTML = "";
  capGrid = null;
  const boardId = capBoardId();
  if (!boardId) { panel.innerHTML = '<p class="import-note">No boards yet.</p>'; return; }
  const board = D().boards.find(b => b.id === boardId);
  const mayEdit = can("capacity", "edit");
  const m = capacityModel(boardId);
  const rows = capacityRowsFor(boardId, m.demand);
  const cellVal = new Map(m.demand.map(r => [capKey(r.board_id, r.plan_date, r.host, r.shift), r.headcount]));

  const dl = document.createElement("datalist");
  dl.id = "cap-host-list";
  for (const hh of D().hosts.filter(x => !x.archived).slice().sort((a, b) => a.name.localeCompare(b.name))) {
    const o = document.createElement("option");
    o.value = hh.name;
    const area = hh.areaId ? D().areas.find(a => a.id === hh.areaId) : null;
    o.textContent = [area ? area.name : "", hh.location].filter(Boolean).join(" · ");
    dl.appendChild(o);
  }
  const note = document.createElement("p");
  note.className = "cap-note";
  note.textContent = "Available uses the current roster, so future hires and leavers are not reflected. Leave and named people come from the confirmed board up to the next working day and from forecasts after it.";

  if (capIsPhone()) {
    panel.appendChild(renderCapacityPhone(boardId, board, m, rows, cellVal, mayEdit));
    panel.appendChild(note);
    panel.appendChild(dl);
    const again = keep ? panel.querySelector(`input[data-cap-key="${CSS.escape(keep.key)}"]`)
      : keepStep ? panel.querySelector(`[data-cap-step="${CSS.escape(keepStep)}"]`) : null;
    if (again) {
      if (keep && keep.dirty) again.value = keep.value;
      again.focus({ preventScroll: true });
    }
    return;
  }

  const cols = `var(--cap-left) repeat(${m.dates.length}, minmax(64px, 1fr))`;
  const row = (cls) => { const r = document.createElement("div"); r.className = "cap-row " + (cls || ""); r.style.gridTemplateColumns = cols; return r; };
  const head = (text, sub) => {
    const c = document.createElement("div");
    c.className = "cap-left";
    const b = document.createElement("span");
    b.className = "cap-left-title";
    b.textContent = text;
    c.appendChild(b);
    if (sub) { const s = document.createElement("span"); s.className = "cap-left-sub"; s.textContent = sub; c.appendChild(s); }
    return c;
  };
  const dayCell = (x, extra) => {
    const c = document.createElement("div");
    c.className = "cap-day" + (x.forecast ? " cap-fc" : "") + (Capacity.weekStart(x.date) === x.date ? " cap-wk" : "") + (extra ? " " + extra : "");
    return c;
  };

  const card = document.createElement("section");
  card.className = "cap-card";
  card.setAttribute("aria-label", `Capacity for ${board.name}`);
  const top = document.createElement("div");
  top.className = "cap-card-head";
  const h = document.createElement("span");
  h.className = "cap-card-title";
  h.textContent = `${board.name} · demand against available people`;
  top.appendChild(h);
  if (mayEdit && !IS_TOUCH) {
    top.insertAdjacentHTML("beforeend", '<span class="cap-hint">Drag to select · <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>Ctrl</kbd>+<kbd>V</kbd> (works with Excel) · <kbd>Delete</kbd> clears · right-click a cell to fill its week</span>');
  }
  card.appendChild(top);

  const scroll = document.createElement("div");
  scroll.className = "cap-scroll";
  const grid = document.createElement("div");
  grid.className = "cap-grid2";
  grid.style.minWidth = `calc(var(--cap-left) + ${m.dates.length * 64}px)`;

  // ----- pinned: dates, the gap drawn to scale, and the three summary rows.
  // They stay on screen while the host rows below scroll, so every number
  // typed shows its effect on Demand and Gap without scrolling. -----
  const pinned = document.createElement("div");
  pinned.className = "cap-pinned";

  // one Confirmed | Forecast band instead of a chip on every day
  const band = row("cap-band");
  band.appendChild(head(""));
  for (let i = 0; i < m.days.length;) {
    let j = i;
    while (j < m.days.length && m.days[j].forecast === m.days[i].forecast) j++;
    const seg = document.createElement("div");
    seg.className = "cap-band-seg " + (m.days[i].forecast ? "fc" : "cf");
    seg.style.gridColumn = `span ${j - i}`;
    seg.textContent = m.days[i].forecast ? "FORECAST · tentative" : "CONFIRMED";
    seg.title = m.days[i].forecast ? "Tentative: the board opens these days in forecast mode" : "The confirmed board: the plan people are sent out on";
    band.appendChild(seg);
    i = j;
  }
  pinned.appendChild(band);

  const dh = row("cap-dayhead");
  dh.appendChild(head("Day"));
  for (const x of m.days) {
    const c = dayCell(x);
    c.dataset.mode = x.forecast ? "forecast" : "confirmed";
    c.innerHTML = `<span class="cap-dow">${fmtDow(x.date)}</span><span class="cap-dm${x.date === todayStr() ? " today" : ""}">${shortDateLabel(x.date)}</span>`;
    dh.appendChild(c);
  }
  pinned.appendChild(dh);

  // the gap around a zero line: short days hang below it, spare days stand above
  const scale = Math.max(4, ...m.days.filter(x => x.gap != null).map(x => Math.abs(x.gap)));
  const half = CAP_STRIP_H / 2 - 18;
  const strip = row("cap-strip");
  strip.setAttribute("aria-hidden", "true");   // the Gap chips below say the same in words
  strip.appendChild(head("Short / spare", "drawn to scale"));
  for (const x of m.days) {
    const c = dayCell(x, "cap-stripcell");
    c.style.height = CAP_STRIP_H + "px";
    c.insertAdjacentHTML("beforeend", '<i class="cap-zero"></i>');
    if (x.gap != null) {
      const len = Math.max(3, Math.round(Math.abs(x.gap) / scale * half));
      const bar = document.createElement("i");
      const lab = document.createElement("span");
      lab.className = "cap-gv " + x.kind;
      lab.textContent = fmtGap(x.gap);
      bar.style.height = len + "px";
      if (x.gap < 0) {
        bar.className = "cap-gb dn" + (x.gap <= -CAP_CRIT ? " crit" : "");
        lab.style.top = `calc(50% + ${len + 2}px)`;
      } else {
        bar.className = "cap-gb up " + x.kind;
        lab.style.bottom = `calc(50% + ${len + 2}px)`;
      }
      c.append(bar, lab);
    }
    strip.appendChild(c);
  }
  pinned.appendChild(strip);

  const dr = row("cap-demrow");
  dr.appendChild(head("Demand", "sum of the hosts below"));
  for (const x of m.days) {
    const c = dayCell(x);
    c.textContent = String(x.demand);
    dr.appendChild(c);
  }
  pinned.appendChild(dr);

  const ar = row("cap-availrow");
  ar.appendChild(head("Available", "roster − leave · click a number"));
  for (const x of m.days) {
    const c = dayCell(x);
    if (x.a) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cap-avail-btn";
      const off = x.a.leavePerm + x.a.leaveOncall;
      btn.innerHTML = `<b>${x.a.available}</b>${off ? `<small>−${off}</small>` : ""}`;
      btn.setAttribute("aria-label", `${fmtDow(x.date)} ${shortDateLabel(x.date)}: ${x.a.available} available${off ? `, ${off} on leave` : ""}. Show details`);
      btn.onclick = (ev) => { ev.stopPropagation(); capShowDay(btn, x); };
      c.appendChild(btn);
    }
    ar.appendChild(c);
  }
  pinned.appendChild(ar);

  const gr = row("cap-gaprow");
  gr.appendChild(head("Gap", "available − demand"));
  for (const x of m.days) {
    const c = dayCell(x);
    if (x.gap != null) c.appendChild(capGapChip(x));
    gr.appendChild(c);
  }
  pinned.appendChild(gr);
  grid.appendChild(pinned);

  // ----- demand by host -----
  const sh = row("cap-sechead");
  const shl = document.createElement("div");
  shl.className = "cap-left cap-sechead-title";
  shl.textContent = "Demand by host · shift";
  sh.appendChild(shl);
  const shr = document.createElement("div");
  shr.className = "cap-sechead-fill";
  shr.style.gridColumn = "2 / -1";
  sh.appendChild(shr);
  grid.appendChild(sh);

  if (!rows.length) {
    const er = row("cap-hostrow");
    const t = document.createElement("div");
    t.className = "cap-left cap-empty";
    t.textContent = mayEdit ? "No demand yet — add a host below." : "No demand entered.";
    er.appendChild(t);
    for (const x of m.days) er.appendChild(dayCell(x));
    grid.appendChild(er);
  }
  for (const [ri, r] of rows.entries()) {
    const hr = row("cap-hostrow");
    const hl = document.createElement("div");
    hl.className = "cap-left cap-hosthead";
    const nm = document.createElement("span");
    nm.className = "cap-hostname";
    nm.textContent = r.host;
    nm.title = r.host;
    hl.appendChild(nm);
    hl.insertAdjacentHTML("beforeend", areaPillHtml(hostAreaOf(r.host), "cap-area"));
    const shp = document.createElement("span");
    shp.className = "cap-shift" + (r.shift === "night" ? " night" : "");
    shp.textContent = r.shift === "night" ? "NIGHT" : "DAY";
    hl.appendChild(shp);
    if (mayEdit) hl.appendChild(capRowMenuButton(boardId, r));
    hr.appendChild(hl);
    for (const [ci, x] of m.days.entries()) {
      const d = x.date;
      const c = dayCell(x, "cap-cell");
      c.dataset.r = String(ri);
      c.dataset.c = String(ci);
      const key = capKey(boardId, d, r.host, r.shift);
      const v = cellVal.get(key);
      if (mayEdit) {
        const inp = capNumberInput(key, v, `${r.host} ${r.shift} ${fmtDow(d)} ${shortDateLabel(d)}`,
          (val) => saveCapacityCells([{ boardId, date: d, host: r.host, shift: r.shift, headcount: val }]));
        inp.onfocus = () => {
          // Tab / Enter moving through the cells moves the selection with them
          if (capDragging) return;
          state.capacity.sel = { boardId, a: [ri, ci], f: [ri, ci] };
          capApplySel();
        };
        inp.onkeydown = (ev) => {
          if (ev.key !== "Enter") return;
          ev.preventDefault();
          const next = c.nextElementSibling && c.nextElementSibling.querySelector("input");
          if (next) next.focus(); else inp.blur();
        };
        const menu = (mx, my) => showQuickMenu(mx, my, [
          ...capSelectionMenu(ri, ci),
          { label: "Fill right to end of week", run: () => {
            const val = inp.value.trim();
            if (val === "") { toast("Type a number in this cell first.", "info"); return; }
            const targets = Capacity.fillRightDates(d, m.dates, (t) => !isNonWorkingDate(t, boardId));
            if (!targets.length) { toast("Nothing to fill — this is the last working day of the week on the grid.", "info"); return; }
            saveCapacityCells([d, ...targets].map(t => ({ boardId, date: t, host: r.host, shift: r.shift, headcount: Number(val) })));
          } },
          { label: "Clear this cell", run: () => saveCapacityCells([{ boardId, date: d, host: r.host, shift: r.shift, headcount: null }]) },
        ]);
        c.addEventListener("contextmenu", (ev) => { ev.preventDefault(); menu(ev.clientX, ev.clientY); });
        attachLongPress(c, menu);
        c.appendChild(inp);
      } else {
        c.textContent = v == null ? "" : String(v);
      }
      hr.appendChild(c);
    }
    grid.appendChild(hr);
  }
  // a new host goes in as the last row of the grid, right under the others
  if (mayEdit) {
    const addr = row("cap-addrow");
    const al = document.createElement("div");
    al.className = "cap-left";
    al.appendChild(capacityAddRowForm(boardId));
    addr.appendChild(al);
    for (const x of m.days) addr.appendChild(dayCell(x));
    grid.appendChild(addr);
  }
  scroll.appendChild(grid);
  card.appendChild(scroll);

  const foot = document.createElement("div");
  foot.className = "cap-card-foot";
  foot.appendChild(note);
  card.appendChild(foot);
  panel.appendChild(card);
  panel.appendChild(dl);

  // selection, copy and paste (see "Capacity: Excel-style" below)
  capGrid = { boardId, rows, dates: m.dates, mayEdit, grid };
  grid.addEventListener("mousedown", capMouseDown);
  grid.addEventListener("mouseover", capMouseOver);
  const clip = document.createElement("textarea");
  clip.id = "cap-clip";
  clip.className = "cap-clip";
  clip.tabIndex = -1;
  clip.setAttribute("aria-label", "Selected cells");
  clip.addEventListener("keydown", capClipKey);
  panel.appendChild(clip);
  capApplySel();

  scroll.scrollLeft = scrollWas;
  if (keep) {
    const again = panel.querySelector(`input[data-cap-key="${CSS.escape(keep.key)}"]`);
    if (again) {
      if (keep.dirty) again.value = keep.value;
      again.focus();
    }
  } else if (clipHadFocus && capSelRect()) {
    capFocusClip();
  }
}
/* one demand number as a typed cell — the grid and the phone stepper share it */
function capNumberInput(key, v, label, save) {
  const inp = document.createElement("input");
  inp.type = "number";
  inp.min = "0";
  inp.step = "1";
  inp.inputMode = "numeric";
  inp.dataset.capKey = key;
  inp.defaultValue = v == null ? "" : String(v);
  inp.value = inp.defaultValue;
  inp.setAttribute("aria-label", label);
  inp.onchange = () => {
    const raw = inp.value.trim();
    if (raw !== "" && !(Number(raw) >= 0)) { inp.value = inp.defaultValue; return; }
    save(raw === "" ? null : Number(raw));
  };
  return inp;
}
/* ⋯ on a host row: the remove lives in a menu, not on an always-visible ✕
   right next to the host name */
function capRowMenuButton(boardId, r) {
  const shiftName = r.shift === "night" ? "night" : "day";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cap-row-menu";
  btn.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-more"></use></svg>';
  btn.title = "Row actions";
  btn.setAttribute("aria-label", `Row actions for ${r.host} ${shiftName}`);
  btn.setAttribute("aria-haspopup", "menu");
  btn.onclick = (ev) => {
    ev.stopPropagation();
    const b = btn.getBoundingClientRect();
    showQuickMenu(b.left, b.bottom + 4, [{ label: "Remove this row…", danger: true, run: () => removeCapacityRow(boardId, r) }]);
  };
  return btn;
}

/* Phone: one host at a time, one card per working day of one week, each with
   the board's gap for that day and a − / number / + stepper for this host. */
function renderCapacityPhone(boardId, board, m, rows, cellVal, mayEdit) {
  const card = document.createElement("section");
  card.className = "cap-card cap-phone";
  card.setAttribute("aria-label", `Capacity for ${board.name}`);
  const title = document.createElement("div");
  title.className = "cap-card-head";
  title.innerHTML = `<span class="cap-card-title">${escapeHtml(board.name)} · demand by host</span>`;
  card.appendChild(title);

  const rowKey = (r) => r.host + "\u0001" + r.shift;
  const shiftLabel = (r) => (r.shift === "night" ? "Night" : "Day");
  let ri = Math.max(0, rows.findIndex(r => rowKey(r) === state.capacity.phoneRow));
  const r = rows[ri] || null;
  if (r) state.capacity.phoneRow = rowKey(r);

  // weeks of the range; the one shown is remembered while the tab is open
  const weeks = [];
  for (const x of m.days) {
    const ws = Capacity.weekStart(x.date);
    if (!weeks.length || weeks[weeks.length - 1].ws !== ws) weeks.push({ ws, days: [] });
    weeks[weeks.length - 1].days.push(x);
  }
  const wi = Math.min(Math.max(0, state.capacity.phoneWeek || 0), Math.max(0, weeks.length - 1));
  state.capacity.phoneWeek = wi;

  const pager = (cls, prevLabel, nextLabel, text, canPrev, canNext, go) => {
    const bar = document.createElement("div");
    bar.className = "cap-ph-pager " + cls;
    const mk = (dir, label, ok) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn cap-ph-nav";
      b.textContent = dir < 0 ? "‹" : "›";
      b.setAttribute("aria-label", label);
      b.disabled = !ok;
      b.dataset.capStep = cls + dir;
      b.onclick = () => go(dir);
      return b;
    };
    bar.append(mk(-1, prevLabel, canPrev), text, mk(1, nextLabel, canNext));
    return bar;
  };

  if (r) {
    const pick = document.createElement("select");
    pick.className = "cap-ph-host";
    pick.setAttribute("aria-label", "Host");
    rows.forEach((x, k) => {
      const o = document.createElement("option");
      o.value = String(k);
      o.textContent = `${x.host} · ${shiftLabel(x)}`;
      pick.appendChild(o);
    });
    pick.value = String(ri);
    pick.onchange = () => { state.capacity.phoneRow = rowKey(rows[Number(pick.value)]); render(); };
    const goHost = (dir) => { state.capacity.phoneRow = rowKey(rows[(ri + dir + rows.length) % rows.length]); render(); };
    const hostBar = pager("cap-ph-hostbar", "Previous host", "Next host", pick, rows.length > 1, rows.length > 1, goHost);
    if (mayEdit) hostBar.appendChild(capRowMenuButton(boardId, r));
    card.appendChild(hostBar);
  }
  if (weeks.length) {
    const wk = weeks[wi];
    const lab = document.createElement("span");
    lab.className = "cap-ph-weeklabel";
    lab.innerHTML = `Week of <b>${shortDateLabel(wk.ws)}</b>${weeks.length > 1 ? ` <small>${wi + 1} of ${weeks.length}</small>` : ""}`;
    card.appendChild(pager("cap-ph-weekbar", "Previous week", "Next week", lab, wi > 0, wi < weeks.length - 1,
      (dir) => { state.capacity.phoneWeek = wi + dir; render(); }));
  }

  const list = document.createElement("div");
  list.className = "cap-ph-days";
  if (!r) {
    const e = document.createElement("p");
    e.className = "cap-empty";
    e.textContent = mayEdit ? "No demand yet — add a host below." : "No demand entered.";
    list.appendChild(e);
  }
  for (const x of (r && weeks.length ? weeks[wi].days : [])) {
    const d = x.date;
    const it = document.createElement("div");
    it.className = "cap-ph-day" + (x.forecast ? " cap-fc" : "");
    const when = document.createElement("div");
    when.className = "cap-ph-when";
    when.innerHTML = `<span class="cap-dow">${fmtDow(d)}${x.forecast ? " · forecast" : ""}</span><b class="cap-dm${d === todayStr() ? " today" : ""}">${shortDateLabel(d)}</b>` +
      (x.a ? `<small>Demand ${x.demand} · available ${x.a.available}</small>` : "");
    it.appendChild(when);
    const gapBox = document.createElement("div");
    if (x.gap != null) gapBox.appendChild(capGapChip(x));
    it.appendChild(gapBox);
    const key = capKey(boardId, d, r.host, r.shift);
    const v = cellVal.get(key);
    if (mayEdit) {
      const save = (val) => saveCapacityCells([{ boardId, date: d, host: r.host, shift: r.shift, headcount: val }]);
      const step = document.createElement("div");
      step.className = "cap-stepper";
      const btn = (dir) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = dir < 0 ? "−" : "+";
        b.dataset.capStep = key + "\u0001" + dir;
        b.setAttribute("aria-label", `${dir < 0 ? "One less" : "One more"} for ${r.host} on ${fmtDow(d)} ${shortDateLabel(d)}`);
        b.disabled = dir < 0 && !(v > 0);
        b.onclick = () => save(Math.max(0, (v || 0) + dir));
        return b;
      };
      const inp = capNumberInput(key, v, `${r.host} ${r.shift} ${fmtDow(d)} ${shortDateLabel(d)}`, save);
      step.append(btn(-1), inp, btn(1));
      it.appendChild(step);
    } else {
      const val = document.createElement("b");
      val.className = "cap-ph-val";
      val.textContent = v == null ? "–" : String(v);
      it.appendChild(val);
    }
    list.appendChild(it);
  }
  card.appendChild(list);

  if (rows.length > 1) {
    const next = document.createElement("button");
    next.type = "button";
    next.className = "btn btn-primary cap-ph-next";
    next.textContent = `Next host: ${rows[(ri + 1) % rows.length].host} ›`;
    next.dataset.capStep = "next-host";
    next.onclick = () => { state.capacity.phoneRow = rowKey(rows[(ri + 1) % rows.length]); render(); };
    card.appendChild(next);
  }
  if (mayEdit) {
    const add = document.createElement("div");
    add.className = "cap-ph-add";
    add.appendChild(capacityAddRowForm(boardId));
    card.appendChild(add);
  }
  return card;
}
function capacityAddRowForm(boardId) {
  const form = document.createElement("form");
  form.className = "cap-add";
  form.id = "cap-add";
  const inp = document.createElement("input");
  inp.type = "text";
  inp.placeholder = "+ Add host…";
  inp.setAttribute("list", "cap-host-list");
  inp.setAttribute("aria-label", "Host");
  const sh = document.createElement("select");
  sh.setAttribute("aria-label", "Shift");
  sh.innerHTML = '<option value="day">Day</option><option value="night">Night</option>';
  const btn = document.createElement("button");
  btn.type = "submit";
  btn.className = "btn btn-small";
  btn.textContent = "Add";
  form.append(inp, sh, btn);
  form.onsubmit = (ev) => {
    ev.preventDefault();
    const typed = inp.value.trim();
    if (!typed) return;
    // same rule as a mission's host: it has to be on the Host list, which is
    // what keeps "Fortune" and "fortune " from becoming two rows
    const rec = hostRecordOf(typed);
    if (!rec) { toast(`"${typed}" is not in the Host list. Pick a host from the suggestions, or add it in the Host tab first.`, "warn"); return; }
    const list = state.capacity.extraRows[boardId] || (state.capacity.extraRows[boardId] = []);
    if (!list.some(r => r.host === rec.name && r.shift === sh.value)) list.push({ host: rec.name, shift: sh.value });
    state.capacity.phoneRow = rec.name + "\u0001" + sh.value;   // the phone layout opens the row just added
    render();
  };
  return form;
}
/* "Start from confirmed plan": the latest confirmed day's deployment on this
   board — people per host x shift — becomes the starting demand on every
   working day in range. Only empty cells are filled, so an engineer then just
   corrects the hosts they look after and nobody's typed numbers are lost. */
function seedCapacityFromConfirmed() {
  if (!can("capacity", "edit")) return;
  const boardId = capBoardId();
  const board = D().boards.find(b => b.id === boardId);
  safely(async () => {
    const src = await cloud.findLatestWeekdayMissionDate(boardId, addDays(horizonEndFor(boardId), 1));
    if (!src) { toast(`${board.name} has no confirmed working day with missions to start from.`, "info"); return; }
    const plan = await cloud.ensurePlanLoaded(boardId, src);
    const active = new Set(D().employees.filter(e => e.boardId === boardId && e.active !== false).map(e => e.id));
    const seed = Capacity.seedFromPlan(plan, active);
    if (!seed.length) { toast(`Nobody is placed on a mission on ${board.name} on ${fmtShort(src)}, so there is nothing to start from.`, "info"); return; }
    const dates = capacityDates(boardId);
    // a 0 is "nothing planned" (that is what Reset leaves behind), so it counts as empty
    const have = new Set(((D().capacity && D().capacity.rows) || []).filter(r => r.board_id === boardId && r.headcount > 0)
      .map(r => r.plan_date + "\u0001" + r.host + "\u0001" + r.shift));
    const cells = Capacity.fillEmpty(seed, dates, (d, h, sh) => have.has(d + "\u0001" + h + "\u0001" + sh))
      .map(c => ({ boardId, ...c }));
    if (!cells.length) { toast("Every one of those cells already has a number above 0 — nothing was changed.", "info"); return; }
    const list = seed.slice(0, 6).map(x => `${x.host}${x.shift === "night" ? " (night)" : ""}: ${x.headcount}`).join(", ") +
      (seed.length > 6 ? `, and ${seed.length - 6} more` : "");
    showConfirm("Start from the confirmed plan?",
      `Use ${board.name}'s deployment on ${fmtShort(src)} as the starting demand: ${list}.\n\n` +
      `It goes into ${cells.length} empty cell${cells.length === 1 ? "" : "s"} across the next ${state.capacity.weeks} week${state.capacity.weeks === 1 ? "" : "s"}. Cells that already have a number above 0 are kept (a 0 counts as empty). Then adjust the hosts you look after.`,
      () => saveCapacityCells(cells));
  });
}
/* "Reset to 0": a clean sheet for the next planner. Every number the board on
   screen has from today on becomes 0 — in the weeks shown and beyond them, so
   nothing is left behind when the range is changed afterwards. The host rows
   stay (a zero is written, never a delete), and "Start from confirmed plan"
   treats a 0 as empty, so the flow can start over. Past days are history. */
function resetCapacityToZero() {
  if (!can("capacity", "edit")) return;
  const boardId = capBoardId();
  const board = D().boards.find(b => b.id === boardId);
  const demand = ((D().capacity && D().capacity.rows) || []).filter(r => r.board_id === boardId);
  const live = demand.filter(r => r.headcount > 0);
  if (!live.length) { toast(`${board.name} has no numbers in the weeks shown — it is already a clean sheet.`, "info"); return; }
  const last = live.reduce((l, r) => (!l || String(r.updated_at || "") > String(l.updated_at || "") ? r : l), null);
  const who = last && last.updated_by ? ` Last change: ${last.updated_by}${last.updated_at ? ", " + fmtShort(String(last.updated_at).slice(0, 10)) : ""}.` : "";
  const hosts = new Set(capacityRowsFor(boardId, demand).map(r => r.host + "\u0001" + r.shift)).size;
  showConfirm("Reset all numbers to 0?",
    `Every number on ${board.name} from today on is set to 0 — ${live.length} in the weeks shown, and any entered further ahead. All ${hosts} host row${hosts === 1 ? "" : "s"} stay. Past days are kept.${who}\n\n` +
    `This cannot be undone. Use Export first if anyone still needs this plan.`,
    () => safely(async () => { await cloud.resetCapacityDemand(boardId, todayStr()); render(); toast(`${board.name} reset to 0.`, "info"); }));
}
/* the board on screen only — "one board at a time" goes for the copy too */
function copyCapacityWeek() {
  const boardId = capBoardId();
  const board = D().boards.find(b => b.id === boardId);
  const { from } = capacityRange();
  const ws = Capacity.weekStart(from);
  const we = addDays(ws, 6);
  safely(async () => {
    const rows = (await cloud.getCapacityDemand(ws, we)).filter(r => r.board_id === boardId);
    const cells = rows
      .map(r => ({ boardId, date: addDays(r.plan_date, 7), host: r.host, shift: r.shift, headcount: r.headcount }))
      .filter(c => !isNonWorkingDate(c.date, boardId));
    if (!cells.length) { toast(`Nothing entered for ${board.name} in the week of ${fmtShort(ws)} yet.`, "info"); return; }
    showConfirm("Copy this week to next week?",
      `Copy ${cells.length} entr${cells.length === 1 ? "y" : "ies"} for ${board.name} from the week of ${fmtShort(ws)} to the week of ${fmtShort(addDays(ws, 7))}? The same host/shift cells next week are overwritten; everything else is left alone.`,
      () => saveCapacityCells(cells));
  });
}

/* ---------- Capacity export ----------
   The grid off the screen, for one board, several, or all of them: Excel (one
   sheet per board), a JPG, or a PDF (the print dialog, Save as PDF — one page,
   sized to the content, like the board's PDF). The same days the grid shows,
   plus whichever Host-list columns are ticked. Built by Capacity.exportBoard
   (planning.js) so all three formats say the same thing; the Excel side is
   ManpowerXlsx.buildCapacityWorkbook. It is a tentative plan, and says so. */
const CAP_EXPORT_KEY = "manpower.capExport";   // { extras } — the ticked host columns, remembered per device
const CAP_EXPORT_NOTE = "Tentative plan, not the confirmed board. Available uses the current roster, so future hires and leavers are not reflected. " +
  "Leave and named people come from the confirmed board up to the next working day and from forecasts after it.";
const CAP_EXPORT_HINTS = {
  xlsx: "A working Excel file, one sheet per board: type in the yellow cells (host demand, available people, spare rows for new hosts) and Demand, Gap, Total, the gap colours and the chart all recalculate.",
  jpg: "One image with the boards one under another. Send it as a file, not a photo, so it stays sharp.",
  pdf: "Opens the print dialog — choose Save as PDF. One page with the boards one under another; Google Maps links stay clickable.",
};
let capPrintJob = null;   // the sheet prepareForPrint should print instead of the notice
function capExportPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(CAP_EXPORT_KEY) || "{}");
    return { extras: Array.isArray(p.extras) ? p.extras : ["area"] };
  } catch (e) { return { extras: ["area"] }; }
}
function openCapExportModal() {
  if (!D().boards.length) { toast("No boards yet.", "info"); return; }
  const prefs = capExportPrefs();
  const current = capBoardId();
  const { from, to } = capacityRange();
  const w = state.capacity.weeks;
  $("#cap-export-summary").textContent = `${fmtShort(from)} – ${fmtShort(to)}: the next ${w} week${w === 1 ? "" : "s"}, the same days the grid shows (change Range to export more or fewer).`;
  $("#cap-export-boards").innerHTML = D().boards.map(b =>
    `<label class="import-row"><input type="checkbox" value="${escapeHtml(b.id)}"${b.id === current ? " checked" : ""}><span class="import-info">${escapeHtml(b.name)}</span></label>`).join("");
  $("#cap-export-extras").innerHTML = Capacity.EXPORT_HOST_COLUMNS.map(c =>
    `<label class="import-row"><input type="checkbox" value="${c.key}"${prefs.extras.includes(c.key) ? " checked" : ""}><span class="import-info">${c.label}</span></label>`).join("");
  renderExportTypes($("#cap-export-type"), "capacity", ["jpg", "pdf", "xlsx"], updateCapExportHint);
  updateCapExportHint();
  openModal("#modal-cap-export");
}
function updateCapExportHint() {
  const fmt = pickedExportType($("#cap-export-type")) || "xlsx";
  $("#cap-export-hint").textContent = CAP_EXPORT_HINTS[fmt] + " The file type and host columns are remembered on this device.";
}
function capExportPick(all) {
  const current = capBoardId();
  for (const b of $$("#cap-export-boards input")) b.checked = all || b.value === current;
}
/* one board's grid as export data (see Capacity.exportBoard) */
function capExportModel(boardId, extras) {
  const board = D().boards.find(b => b.id === boardId);
  const m = capacityModel(boardId);
  const cellVal = new Map(m.demand.map(r => [capKey(r.board_id, r.plan_date, r.host, r.shift), r.headcount]));
  return Capacity.exportBoard({
    name: board.name, days: m.days, rows: capacityRowsFor(boardId, m.demand), extras,
    value: (d, h, sh) => cellVal.get(capKey(boardId, d, h, sh)),
    hostInfo: (h) => {
      const rec = hostRecordOf(h);
      if (!rec) return null;
      const area = hostAreaOf(h);
      return { area: area ? area.name : "", location: rec.location, note: rec.note, mapUrl: safeHttpUrl(rec.mapUrl) };
    },
    dateLabel: (d) => `${fmtDow(d)} ${shortDateLabel(d)}`,
  });
}
/* the JPG / PDF page: a plain table per board on a white sheet */
function buildCapExportSheet(models, rangeText, generatedOn) {
  const esc = escapeHtml;
  let html = `<div class="ce-top"><span class="ce-brand">TRIGO · Capacity</span>` +
    `<span class="ce-sub">${esc(rangeText)} · exported ${esc(generatedOn)} · tentative plan</span></div>`;
  for (const b of models) {
    const fixed = 2 + b.extras.length;
    const fc = (i) => (b.dates[i].forecast ? " ce-fc" : "");
    html += `<section class="ce-board"><h2>${esc(b.name)}</h2><table><thead><tr>` +
      `<th class="ce-l" rowspan="2">Host</th>` + b.extras.map(c => `<th class="ce-l" rowspan="2">${esc(c.label)}</th>`).join("") +
      `<th rowspan="2">Shift</th>` +
      b.dates.map(d => `<th><span class="ce-dow">${fmtDow(d.date)}</span>${shortDateLabel(d.date)}</th>`).join("") +
      `</tr><tr class="ce-mode">` + b.dates.map(d => `<th class="${d.forecast ? "fc" : ""}">${d.forecast ? "FORECAST" : "CONFIRMED"}</th>`).join("") +
      `</tr></thead><tbody>`;
    const sum = (label, vals, kinds) => {
      html += `<tr class="ce-sum"><td class="ce-l" colspan="${fixed}">${label}</td>` + vals.map((v, i) => {
        const k = kinds && kinds[i] ? " ce-" + kinds[i] : "";
        return `<td class="${(fc(i) + k).trim()}">${v == null ? "" : kinds ? fmtGap(v) : v}</td>`;
      }).join("") + `</tr>`;
    };
    sum("Available people", b.summary.available);
    sum("Demand (all hosts)", b.summary.demand);
    sum("Gap (available − demand)", b.summary.gap, b.summary.kind);
    sum("Named on board", b.summary.named);
    html += `<tr class="ce-sec"><td colspan="${fixed + b.dates.length}">Demand by host · shift</td></tr>`;
    if (!b.rows.length) html += `<tr><td class="ce-l" colspan="${fixed + b.dates.length}">No demand entered.</td></tr>`;
    b.rows.forEach((r, k) => {
      html += `<tr class="${k % 2 ? "ce-alt" : ""}"><td class="ce-l ce-host">${esc(r.host)}</td>`;
      for (const c of b.extras) {
        const v = r.extra[c.key];
        if (c.key === "area") html += `<td class="ce-l">${v ? areaPillHtml(hostAreaOf(r.host), "ce-area") : ""}</td>`;
        else if (c.key === "mapUrl") html += `<td class="ce-l">${v ? `<a href="${esc(v)}">Google Maps</a>` : ""}</td>`;
        else html += `<td class="ce-l ce-wrap">${esc(v)}</td>`;
      }
      const night = r.shift === "night";
      html += `<td class="ce-shift${night ? " night" : ""}">${night ? "NIGHT" : "DAY"}</td>` +
        r.values.map((v, i) => `<td class="${fc(i).trim()}">${v == null ? "" : v}</td>`).join("") + `</tr>`;
    });
    html += `</tbody></table></section>`;
  }
  html += `<p class="ce-note">${esc(CAP_EXPORT_NOTE)}</p>`;
  const el = document.createElement("div");
  el.id = "cap-export-sheet";
  el.innerHTML = html;
  return el;
}
async function runCapExport() {
  const ids = $$("#cap-export-boards input:checked").map(b => b.value);
  if (!ids.length) { toast("Tick at least one board to export.", "warn"); return; }
  const extras = $$("#cap-export-extras input:checked").map(b => b.value);
  const fmt = pickedExportType($("#cap-export-type")) || "xlsx";
  try { localStorage.setItem(CAP_EXPORT_KEY, JSON.stringify({ extras })); } catch (e) { /* remembering is a courtesy */ }
  const btn = $("#btn-cap-export-go");
  btn.disabled = true;
  btn.textContent = "Exporting…";
  try {
    await ensureCapacityLoaded();
    const order = D().boards.map(b => b.id).filter(id => ids.includes(id));   // the toolbar's board order
    const models = order.map(id => capExportModel(id, extras));
    const { from, to } = capacityRange();
    const w = state.capacity.weeks;
    const rangeText = `${fmtShort(from)} – ${fmtShort(to)} (${w} week${w === 1 ? "" : "s"})`;
    const today = todayStr();
    const generatedOn = `${fmtDow(today)} ${fmtDate(today)}`;
    const who = models.length === 1 ? models[0].name : models.length === D().boards.length ? "All_boards" : `${models.length}_boards`;
    const fileBase = `Capacity_${who.replace(/[\s\\/:*?"<>|]+/g, "_")}_${from}`;
    if (fmt === "xlsx") {
      const [ExcelJS, JSZip] = await Promise.all([loadExcelJS(), loadJSZip()]);
      const { workbook, charts } = await ManpowerXlsx.buildCapacityWorkbook(ExcelJS, { boards: models, rangeText, generatedOn, note: CAP_EXPORT_NOTE });
      // a working file: formulas from ExcelJS, then the native chart on each sheet
      const buf = await ManpowerXlsx.addCapacityCharts(JSZip, await workbook.xlsx.writeBuffer(), charts);
      bulkSaveBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileBase + ".xlsx");
      closeModal();
      toast(`Exported ${models.length === 1 ? models[0].name : models.length + " boards"} to ${fileBase}.xlsx`, "info");
      return;
    }
    const sheet = buildCapExportSheet(models, rangeText, generatedOn);
    document.body.appendChild(sheet);
    if (fmt === "pdf") {
      closeModal();
      capPrintJob = { sheet, title: fileBase };
      window.print();   // prepareForPrint picks capPrintJob up; restoreAfterPrint removes the sheet
      return;
    }
    try {
      await document.fonts.ready;
      const windowWidth = Math.ceil(sheet.scrollWidth);
      const probe = await html2canvas(sheet, { scale: 1, backgroundColor: "#ffffff", windowWidth });
      // same blank-canvas guard as the board's JPG (see exportBoard)
      const scale = Math.max(1, Math.min(3, 4000 / probe.width, 4000 / probe.height));
      const canvas = scale === 1 ? probe : await html2canvas(sheet, { scale, backgroundColor: "#ffffff", windowWidth });
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/jpeg", 0.92);
      a.download = fileBase + ".jpg";
      a.click();
    } finally {
      sheet.remove();
    }
    closeModal();
  } catch (e) {
    toast("Export failed: " + (e.message || e), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Export";
  }
}

/* Remove a host x shift row: all of its numbers from today on (past days are
   history). A row that was only added, with no number yet, just goes. */
function removeCapacityRow(boardId, r) {
  if (!can("capacity", "edit")) return;
  const board = D().boards.find(b => b.id === boardId);
  const dropExtra = () => {
    const l = state.capacity.extraRows[boardId];
    if (l) state.capacity.extraRows[boardId] = l.filter(x => !(x.host === r.host && x.shift === r.shift));
    state.capacity.sel = null;
  };
  const n = ((D().capacity && D().capacity.rows) || [])
    .filter(x => x.board_id === boardId && x.host === r.host && x.shift === r.shift).length;
  if (!n) { dropExtra(); render(); return; }
  const shiftName = r.shift === "night" ? "night" : "day";
  showConfirm(`Remove ${r.host} (${shiftName} shift)?`,
    `This deletes ${r.host}'s ${shiftName}-shift demand on ${board.name} from today on: ${n} number${n === 1 ? "" : "s"} in the ${state.capacity.weeks} week${state.capacity.weeks === 1 ? "" : "s"} shown, and any entered further ahead. Past days are kept.`,
    () => {
      dropExtra();
      safely(async () => { await cloud.deleteCapacityRow(boardId, r.host, r.shift, todayStr()); render(); });
    });
}

/* ---------- Capacity: Excel-style select, copy, paste ----------
   Drag across number cells (or Shift+click) to select a block; Ctrl+C copies
   it as tab-separated text, the same format Excel uses, so a block can go to
   and from a spreadsheet too. Ctrl+V pastes with the block's top-left corner
   at the selected cell; a single copied number fills the whole selection.
   While a block is selected, focus sits on a hidden textarea (#cap-clip) so
   the browser's own copy/paste keys land somewhere this code hears them. */
let capGrid = null;          // what the last renderCapacity drew
let capDragging = false;
function capSelRect() {
  const s = state.capacity.sel;
  if (!s || !capGrid || s.boardId !== capGrid.boardId || !capGrid.rows.length || !capGrid.dates.length) return null;
  const cr = (n) => Math.min(Math.max(n, 0), capGrid.rows.length - 1);
  const cc = (n) => Math.min(Math.max(n, 0), capGrid.dates.length - 1);
  const [ar, ac] = [cr(s.a[0]), cc(s.a[1])], [fr, fc] = [cr(s.f[0]), cc(s.f[1])];
  return { r0: Math.min(ar, fr), r1: Math.max(ar, fr), c0: Math.min(ac, fc), c1: Math.max(ac, fc) };
}
const capRectSize = (r) => (r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1);
function capApplySel() {
  if (!capGrid) return;
  const r = capSelRect();
  for (const el of capGrid.grid.querySelectorAll(".cap-cell[data-r]")) {
    const i = Number(el.dataset.r), j = Number(el.dataset.c);
    const on = !!r && i >= r.r0 && i <= r.r1 && j >= r.c0 && j <= r.c1;
    el.classList.toggle("cap-sel", on);
    el.classList.toggle("cap-sel-t", on && i === r.r0);
    el.classList.toggle("cap-sel-b", on && i === r.r1);
    el.classList.toggle("cap-sel-l", on && j === r.c0);
    el.classList.toggle("cap-sel-r", on && j === r.c1);
  }
}
function capCellPos(target) {
  const el = target && target.closest ? target.closest(".cap-cell[data-r]") : null;
  if (!el || !capGrid || !capGrid.grid.contains(el)) return null;
  return [Number(el.dataset.r), Number(el.dataset.c)];
}
function capCellText(i, j) {
  const el = capGrid.grid.querySelector(`.cap-cell[data-r="${i}"][data-c="${j}"]`);
  if (!el) return "";
  const inp = el.querySelector("input");
  return (inp ? inp.value : el.textContent).trim();
}
function capSelTsv(r) {
  const lines = [];
  for (let i = r.r0; i <= r.r1; i++) {
    const vals = [];
    for (let j = r.c0; j <= r.c1; j++) vals.push(capCellText(i, j));
    lines.push(vals.join("\t"));
  }
  return lines.join("\n");
}
function capFocusClip() {
  const clip = document.getElementById("cap-clip");
  const r = capSelRect();
  if (!clip || !r) return;
  clip.value = capSelTsv(r);
  clip.focus({ preventScroll: true });
  clip.select();
}
function capMouseDown(ev) {
  if (ev.button !== 0) return;
  const pos = capCellPos(ev.target);
  if (!pos) return;
  const s = state.capacity.sel;
  if (ev.shiftKey && s && s.boardId === capGrid.boardId) {
    ev.preventDefault();
    s.f = pos;
    capApplySel();
    capFocusClip();
    return;
  }
  state.capacity.sel = { boardId: capGrid.boardId, a: pos, f: pos };
  capDragging = true;
  capApplySel();
}
function capMouseOver(ev) {
  if (!capDragging) return;
  if (!(ev.buttons & 1)) { capDragging = false; return; }
  const pos = capCellPos(ev.target);
  const s = state.capacity.sel;
  if (!pos || !s || (pos[0] === s.f[0] && pos[1] === s.f[1])) return;
  s.f = pos;
  capGrid.grid.classList.add("cap-dragging");
  // leaving the first cell: a number typed there is saved (its change event),
  // and the text the drag was selecting inside it is dropped
  const ae = document.activeElement;
  if (ae && ae.dataset && ae.dataset.capKey) ae.blur();
  const ws = window.getSelection && window.getSelection();
  if (ws) ws.removeAllRanges();
  capApplySel();
}
function capMouseUp() {
  if (!capDragging) return;
  capDragging = false;
  if (capGrid) capGrid.grid.classList.remove("cap-dragging");
  const r = capSelRect();
  if (!r) return;
  // one editable cell keeps the caret in its input; a block (or a read-only
  // cell) hands the keyboard to the hidden textarea
  const one = capRectSize(r) === 1 && capGrid.mayEdit;
  if (!one) capFocusClip();
}
function capClearSel() {
  if (!state.capacity.sel) return;
  state.capacity.sel = null;
  capApplySel();
}
function capClearSelectedCells() {
  const r = capSelRect();
  if (!r || !capGrid.mayEdit) return;
  // only the cells that hold a number: clearing an empty one is a no-op
  const cells = [];
  for (let i = r.r0; i <= r.r1; i++) {
    for (let j = r.c0; j <= r.c1; j++) {
      if (capCellText(i, j) === "") continue;
      const row = capGrid.rows[i];
      cells.push({ boardId: capGrid.boardId, date: capGrid.dates[j], host: row.host, shift: row.shift, headcount: null });
    }
  }
  if (!cells.length) return;
  saveCapacityCells(cells);
  toast(`Cleared ${cells.length} cell${cells.length === 1 ? "" : "s"}.`, "info");
}
function capClipKey(ev) {
  if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); capClearSelectedCells(); return; }
  if (ev.key === "Escape") { capClearSel(); ev.target.blur(); return; }
  // anything that would type into the hidden textarea is swallowed; the
  // copy / paste / select-all shortcuts still go through
  if (!(ev.ctrlKey || ev.metaKey) && ev.key.length === 1) ev.preventDefault();
}
/* extra right-click items when the cell is part of a block selection; a right
   click outside the selection selects that one cell instead (as Excel does) */
function capSelectionMenu(i, j) {
  const r = capSelRect();
  const inside = r && i >= r.r0 && i <= r.r1 && j >= r.c0 && j <= r.c1;
  if (!inside) {
    state.capacity.sel = { boardId: capGrid.boardId, a: [i, j], f: [i, j] };
    capApplySel();
    return [];
  }
  const n = capRectSize(r);
  if (n < 2) return [];
  return [{ label: `Clear ${n} selected cells`, run: capClearSelectedCells }];
}
/* is this copy / paste event aimed at the Capacity grid? */
function capClipboardTarget(ev) {
  if (!capGrid || !isCapacity()) return false;
  const t = ev.target;
  return !!(t && (t.id === "cap-clip" || (t.closest && t.closest(".cap-cell[data-r]") && capGrid.grid.contains(t))));
}
function capOnCopy(ev) {
  if (!capClipboardTarget(ev)) return;
  const r = capSelRect();
  if (!r) return;
  ev.preventDefault();
  ev.clipboardData.setData("text/plain", capSelTsv(r));
  const n = capRectSize(r);
  if (n > 1) toast(`Copied ${n} cells. Click the cell where they should start and press Ctrl+V.`, "info");
}
function capOnPaste(ev) {
  if (!capClipboardTarget(ev) || !capGrid.mayEdit) return;
  const r = capSelRect();
  if (!r) return;
  ev.preventDefault();
  const parsed = Capacity.parseClip(ev.clipboardData.getData("text/plain"));
  if (parsed.error != null) {
    const bad = parsed.error.length > 24 ? parsed.error.slice(0, 24) + "…" : parsed.error;
    toast(`Only whole numbers can be pasted here — "${bad}" is not one.`, "warn");
    return;
  }
  const plan = Capacity.pastePlan(parsed.rows, r, capGrid.rows.length, capGrid.dates.length);
  if (!plan.cells.length) return;
  const cells = plan.cells.map(x => ({
    boardId: capGrid.boardId, date: capGrid.dates[x.c], host: capGrid.rows[x.r].host, shift: capGrid.rows[x.r].shift, headcount: x.v,
  }));
  state.capacity.sel = { boardId: capGrid.boardId, a: [plan.r0, plan.c0], f: [plan.r1, plan.c1] };
  capApplySel();
  // the block now selected is what focus should sit on after the redraw
  if (capRectSize(capSelRect()) > 1) capFocusClip();
  else if (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.capKey) {
    const inp = document.activeElement;
    inp.value = inp.defaultValue = cells[0].headcount == null ? "" : String(cells[0].headcount);
  }
  saveCapacityCells(cells);
  if (plan.dropped) toast(`Pasted ${cells.length} cell${cells.length === 1 ? "" : "s"}. ${plan.dropped} did not fit — the block ran past the last row or day on the grid.`, "warn");
  else if (cells.length > 1) toast(`Pasted ${cells.length} cells.`, "info");
}

/* ---------- new board (with weekend-day config) ---------- */
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function openBoardModal() {
  const form = $("#form-board");
  form.reset();
  const box = $("#board-weekend-days");
  box.innerHTML = "";
  DOW_LABELS.forEach((label, i) => {
    const lab = document.createElement("label");
    const on = i === 0 || i === 6;
    lab.className = "weekday-chip" + (on ? " on" : "");
    lab.innerHTML = `<input type="checkbox" value="${i}" ${on ? "checked" : ""}> ${label}`;
    lab.querySelector("input").onchange = (ev) => lab.classList.toggle("on", ev.target.checked);
    box.appendChild(lab);
  });
  openModal("#modal-board");
}

function saveBoard(ev) {
  ev.preventDefault();
  const form = $("#form-board");
  const name = form.name.value.trim();
  if (!name) return;
  const weekendDays = Array.from($$("#board-weekend-days input:checked")).map(c => Number(c.value));
  safely(async () => {
    const id = await cloud.createBoard(name, weekendDays);
    D().activeBoardId = id;
    closeModal();
    await refreshAndRender();
  });
}

/* ---------- dark mode ---------- */
/* the <head> has a tiny inline script that already applies the saved theme
   before first paint (avoids a flash of the wrong theme); this just keeps
   the toggle button's icon in sync and handles the click. */
function applyTheme() {
  // Dark mode is gone: the app is light only. A theme saved by an older version is cleared.
  document.documentElement.removeAttribute("data-theme");
  try { localStorage.removeItem("mpm-theme"); } catch (e) { /* storage blocked: nothing to clear */ }
}
function initTheme() { applyTheme(); }

/* ================= Settings > My account / Users / Roles =================
   User management lives in the Settings modal rather than as a tab of its own:
   every role has something to do here (their own name and password), and only
   an admin has the rest. A tab that most people could not open would be a tab
   that mostly is not there. */

const USER_STATUS = {
  pending:  { label: "Pending",  hint: "Waiting for an admin to approve" },
  active:   { label: "Active",   hint: "Can sign in" },
  disabled: { label: "Disabled", hint: "Kept on record, cannot sign in" },
};
const roleLabel = (key) => {
  const r = D().roles.find(x => x.key === key);
  return r ? r.label : (key || "—");
};
/* A person cannot demote, disable or delete themselves, and the last active
   admin cannot be demoted, disabled or deleted by anyone. Both rules are
   enforced by triggers in the database as well — this is the courtesy half,
   so the button explains itself instead of failing on save. */
function userLockReason(u) {
  const me = D().me;
  if (me && u.id === me.id) return "You can't change your own role or status — ask another admin.";
  const activeAdmins = (D().users || []).filter(x => x.roleKey === "admin" && x.status === "active");
  if (u.roleKey === "admin" && u.status === "active" && activeAdmins.length <= 1) {
    return "This is the only active admin. Promote someone else first.";
  }
  return null;
}

/* ---------- My account ---------- */
function renderAccountPane() {
  const me = D().me;
  const box = $("#account-identity");
  if (!me) { box.textContent = ""; return; }
  const status = USER_STATUS[me.status];
  box.innerHTML =
    `<div class="account-email">${escapeHtml(me.email || "")}</div>` +
    (me.legacy
      ? `<p class="import-note">Roles aren't set up on this database yet — everyone has full access until <code>migration-2026-09-04b-user-management.sql</code> is run.</p>`
      : `<div class="account-meta">` +
          `<span class="role-pill role-${escapeHtml(me.roleKey || "none")}">${escapeHtml(roleLabel(me.roleKey))}</span>` +
          `<span class="status-pill status-${escapeHtml(me.status)}">${escapeHtml(status ? status.label : me.status)}</span>` +
        `</div>` +
        `<p class="import-note">Your role decides which tabs you see and what you can change. Only an admin can alter it.</p>`);
  const form = $("#form-account-name");
  // what the user has typed wins over what is saved, so a refresh from another
  // tab or device cannot overwrite a half-finished edit
  const shown = { displayName: sdVal("account", "displayName", me.displayName || ""), phone: sdVal("account", "phone", me.phone || "") };
  if (form.displayName.value !== shown.displayName) form.displayName.value = shown.displayName;
  if (form.phone.value !== shown.phone) form.phone.value = shown.phone;
  // what the box would fill in by itself if it were left empty
  form.displayName.placeholder = autoDisplayName(me.fullName, me.email) || "e.g. Somchai.P";
}

/* The same rule the database uses (derive_display_name), for the placeholder
   that shows what an empty box will be filled in with. The email address comes
   first — every TRIGO address is first name + "." + last name, which is the one
   spelling of a person that is always there — and the typed full name is the
   fallback for an address that isn't in that shape. It is a hint only: the
   database is what actually sets the value, so the two can never disagree
   about what is saved. */
function autoDisplayName(fullName, email) {
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const mail = String(email || "").split("@")[0].replace(/[._-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  // a single leading character is an initial, not a first name ("n.somchai@")
  if (mail.length > 1 && mail[0].length > 1) {
    return cap(mail[0]) + "." + mail[mail.length - 1].charAt(0).toUpperCase();
  }
  const name = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (name.length > 1) return name[0] + "." + name[name.length - 1].charAt(0).toUpperCase();
  if (name.length === 1) return name[0];
  return mail.length === 1 ? cap(mail[0]) : "";
}

function wireAccountPane() {
  const form = $("#form-account-name");
  // Profile fields are drafts: Save changes (the action bar) writes them. Enter
  // in a field is the same as that button.
  form.displayName.oninput = () => sdSet("account", "displayName", form.displayName.value, "Display name",
    () => (D().me || {}).displayName || "");
  form.phone.oninput = () => sdSet("account", "phone", form.phone.value, "Mobile number",
    () => (D().me || {}).phone || "");
  form.onsubmit = (ev) => { ev.preventDefault(); saveSettingsSection(); };

  // The password is its own form in its own dialog and never part of the
  // draft: nothing about it is staged, stored or kept once the dialog closes.
  $("#btn-change-password").onclick = openPasswordModal;
  $("#form-account-password").onsubmit = (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const err = $("#password-error");
    const problem = f.password.value.length < 8 ? "Use at least 8 characters."
      : f.password.value !== f.confirm.value ? "The two passwords don't match."
      : "";
    err.textContent = problem;
    err.classList.toggle("hidden", !problem);
    if (problem) { (f.password.value.length < 8 ? f.password : f.confirm).focus(); return; }
    safely(async () => {
      await cloud.updatePassword(f.password.value);
      closeModal();
      toast("Password changed.", "info");
    });
  };
}

function openPasswordModal() {
  const f = $("#form-account-password");
  f.reset();
  $("#password-error").classList.add("hidden");
  openModal("#modal-password");
  f.password.focus();
}

/* ---------- Users ---------- */
function usersFilteredSorted() {
  const st = state.users;
  const f = st.filters;
  const q = st.search.trim().toLowerCase();
  const rows = (D().users || []).filter(u => {
    if (st.pendingOnly && u.status !== "pending") return false;
    if (f.roleKey.length && !f.roleKey.includes(u.roleKey)) return false;
    if (f.status.length && !f.status.includes(u.status)) return false;
    if (!q) return true;
    return (u.email || "").toLowerCase().includes(q)
        || (u.fullName || "").toLowerCase().includes(q)
        || (u.displayName || "").toLowerCase().includes(q);
  });
  const val = (u) => ({
    name: (u.fullName || "").toLowerCase(),
    email: (u.email || "").toLowerCase(),
    role: roleLabel(u.roleKey).toLowerCase(),
    status: u.status,
    lastSeen: u.lastSeenAt || "",
    requested: u.requestedAt || "",
  })[st.sortKey];
  return rows.sort((a, b) => {
    const av = val(a), bv = val(b);
    if (av === bv) return (a.email || "").localeCompare(b.email || "");
    // blanks last whichever way the column is pointing — an empty "last seen"
    // is "never", not "earliest"
    if (av === "") return 1;
    if (bv === "") return -1;
    return (av < bv ? -1 : 1) * st.sortDir;
  });
}

function usersMsLabel(key) {
  const picked = state.users.filters[key];
  const noun = key === "roleKey" ? "Role" : "Status";
  if (!picked.length) return `${noun}: All`;
  if (picked.length === 1) return `${noun}: ${key === "roleKey" ? roleLabel(picked[0]) : (USER_STATUS[picked[0]] || {}).label || picked[0]}`;
  return `${noun}: ${picked.length}`;
}

function renderUsersFilterOptions() {
  for (const ms of $$("#users-filters .ms")) {
    const key = ms.dataset.filter;
    ms.querySelector(".ms-btn").textContent = usersMsLabel(key);
    const pop = ms.querySelector(".ms-pop");
    pop.innerHTML = "";
    const clear = document.createElement("div");
    clear.className = "ms-clear";
    clear.textContent = "Clear";
    clear.onclick = () => { state.users.filters[key] = []; renderUsersFilterOptions(); renderUserRows(); };
    pop.appendChild(clear);
    const opts = key === "roleKey"
      ? D().roles.map(r => ({ value: r.key, label: r.label }))
      : Object.keys(USER_STATUS).map(k => ({ value: k, label: USER_STATUS[k].label }));
    for (const o of opts) {
      const row = document.createElement("label");
      row.className = "ms-opt";
      const checked = state.users.filters[key].includes(o.value) ? "checked" : "";
      row.innerHTML = `<input type="checkbox" value="${escapeHtml(o.value)}" ${checked}><span>${escapeHtml(o.label)}</span>`;
      row.querySelector("input").onchange = (e) => {
        const set = new Set(state.users.filters[key]);
        e.target.checked ? set.add(o.value) : set.delete(o.value);
        state.users.filters[key] = [...set];
        ms.querySelector(".ms-btn").textContent = usersMsLabel(key);   // keep the dropdown open
        renderUserRows();
      };
      pop.appendChild(row);
    }
  }
}

/* Loads the people list on first entry to the pane, then redraws. Everything
   after that comes over Realtime (see cloud._subscribeRealtime). */
function renderUsersPane() {
  if (!can("users")) return;
  $("#users-search").value = state.users.search;
  if (D().users === null) {
    safely(async () => { await cloud.loadUsers(); renderUsersFilterOptions(); renderUserRows(); });
    return;
  }
  renderUsersFilterOptions();
  renderUserRows();
}

function renderUserRows() {
  const body = $("#users-body");
  if (!body) return;
  const rows = usersFilteredSorted();
  const all = D().users || [];
  const mayEdit = can("users", "edit");

  const pending = all.filter(u => u.status === "pending");
  const bar = $("#users-pending");
  bar.classList.toggle("hidden", !pending.length);
  if (pending.length) {
    $("#users-pending-text").textContent = pending.length === 1
      ? "1 person is waiting for access."
      : `${pending.length} people are waiting for access.`;
    $("#btn-users-pending").textContent = state.users.pendingOnly ? "Show everyone" : "Review requests";
  }

  $("#users-count").textContent = rows.length === all.length
    ? `${all.length} ${all.length === 1 ? "person" : "people"}`
    : `${rows.length} of ${all.length}`;

  for (const th of $$("#users-table th[data-sort]")) {
    th.classList.toggle("sorted", th.dataset.sort === state.users.sortKey);
    th.classList.toggle("desc", th.dataset.sort === state.users.sortKey && state.users.sortDir < 0);
  }

  body.innerHTML = "";
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="import-note">${all.length ? "No one matches those filters." : "No accounts yet."}</td></tr>`;
    return;
  }
  for (const u of rows) {
    const tr = document.createElement("tr");
    const st = USER_STATUS[u.status] || { label: u.status };
    const isMe = D().me && u.id === D().me.id;
    tr.className = "user-row status-" + u.status + (isMe ? " user-row-me" : "");
    tr.innerHTML = `
      <td data-label="Name">${escapeHtml(u.fullName || "—")}${isMe ? ' <span class="user-you">you</span>' : ""}${u.displayName ? `<span class="user-display-name" title="The short name the board shows">${escapeHtml(u.displayName)}</span>` : ""}</td>
      <td data-label="Email">${escapeHtml(u.email || "")}</td>
      <td data-label="Role"><span class="role-pill role-${escapeHtml(u.roleKey || "none")}">${escapeHtml(roleLabel(u.roleKey))}</span></td>
      <td data-label="Status"><span class="status-pill status-${escapeHtml(u.status)}" title="${escapeHtml(st.hint || "")}">${escapeHtml(st.label)}</span></td>
      <td data-label="Last seen">${u.lastSeenAt ? escapeHtml(fmtDate(u.lastSeenAt.slice(0, 10))) : "—"}</td>
      <td data-label="Requested">${u.requestedAt ? escapeHtml(fmtDate(u.requestedAt.slice(0, 10))) : "—"}</td>
      <td data-label="" class="user-actions"></td>`;
    const actions = tr.querySelector(".user-actions");
    if (mayEdit) {
      if (u.status === "pending") {
        // The two things an admin actually wants to do to a request, without
        // opening anything: approve at the default role, or turn it down.
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "btn btn-small btn-primary";
        ok.textContent = "Approve";
        ok.onclick = () => approveUser(u);
        actions.appendChild(ok);
        const no = document.createElement("button");
        no.type = "button";
        no.className = "btn btn-small";
        no.textContent = "Reject";
        no.onclick = () => rejectUser(u);
        actions.appendChild(no);
      }
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn btn-small";
      edit.innerHTML = icon("edit");
      edit.title = "Edit this person";
      edit.onclick = () => openUserModal(u.id);
      actions.appendChild(edit);
    }
    body.appendChild(tr);
  }
}

function approveUser(u) {
  const fallback = D().roles.some(r => r.key === "viewer") ? "viewer" : (D().roles[0] || {}).key;
  const roleKey = u.roleKey || fallback;
  safely(async () => {
    await cloud.saveUser(u.id, { status: "active", roleKey });
    renderUserRows();
    // Nothing is emailed — tell them yourself, with the password they chose
    // when they asked for access.
    toast(`${u.fullName || u.email} can now sign in as ${roleLabel(roleKey)}. Let them know.`, "info");
  });
}

function rejectUser(u) {
  showConfirm("Turn down this request?",
    `${u.fullName || u.email} will not be able to sign in. Their record is kept, so you can approve them later without them asking again.`,
    () => safely(async () => {
      await cloud.saveUser(u.id, { status: "disabled" });
      renderUserRows();
      toast("Request turned down.", "info");
    }));
}

function fillRoleSelect(sel, value) {
  sel.innerHTML = D().roles.map(r => `<option value="${escapeHtml(r.key)}">${escapeHtml(r.label)}</option>`).join("");
  if (value) sel.value = value;
}

/* The modal opens over the Settings modal — openModal hides every other .modal,
   so closing it comes back to Settings via reopenSettings() rather than
   stacking two dialogs. */
function openUserModal(id) {
  const u = (D().users || []).find(x => x.id === id);
  if (!u || !can("users", "edit")) return;
  state.users.editingId = id;
  const form = $("#form-user");
  $("#user-modal-title").textContent = u.fullName || u.email;
  $("#user-modal-email").textContent = u.email;
  form.fullName.value = u.fullName || "";
  form.displayName.value = u.displayName || "";
  form.displayName.placeholder = autoDisplayName(u.fullName, u.email) || "e.g. Somchai.P";
  fillRoleSelect(form.roleKey, u.roleKey || "viewer");
  form.status.value = u.status;
  const locked = userLockReason(u);
  form.roleKey.disabled = !!locked;
  form.status.disabled = !!locked;
  $("#btn-delete-user").classList.toggle("hidden", !!locked);
  // Not the same condition as `locked`: reissuing the only admin's password
  // locks nobody out, so that case is allowed. Your own is not — you change it
  // in My account, where you type it yourself rather than read it off a screen.
  const isMe = !!(D().me && u.id === D().me.id);
  $("#btn-reset-password").classList.toggle("hidden", isMe);
  // On your own row both are gone; without this the divider above them is left
  // ruling off nothing.
  $("#user-admin-actions").classList.toggle("hidden", isMe && !!locked);
  $("#user-modal-note").textContent = locked || "";
  $("#user-modal-note").classList.toggle("hidden", !locked);
  $("#user-role-hint").textContent = "What each role may do is on the Roles & permissions tab.";
  openModal("#modal-user");
}

function reopenSettings() {
  closeModal();
  renderSettings();
}

function saveUserModal(ev) {
  ev.preventDefault();
  const form = ev.target;
  const id = state.users.editingId;
  const before = (D().users || []).find(x => x.id === id);
  if (!before) return;
  const vals = { fullName: form.fullName.value, displayName: form.displayName.value };
  if (!form.roleKey.disabled) { vals.roleKey = form.roleKey.value; vals.status = form.status.value; }
  safely(async () => {
    await cloud.saveUser(id, vals);
    reopenSettings();
    renderUserRows();
    // A role change takes effect on their next load, but nothing tells them —
    // there is no email here — so say so while the admin is still looking.
    const rerolled = vals.roleKey && vals.roleKey !== before.roleKey;
    toast(rerolled
      ? `Saved. ${before.fullName || before.email} is now ${roleLabel(vals.roleKey)} — tell them, it changes what they can see.`
      : "Saved.", "info");
  });
}

function deleteUserFromModal() {
  const id = state.users.editingId;
  const u = (D().users || []).find(x => x.id === id);
  if (!u) return;
  showConfirm("Delete this account permanently?",
    `${u.fullName || u.email} will be removed from the sign-in system entirely and cannot be brought back. ` +
    `To take someone's access away while keeping their record — and the "locked by" and "updated by" history that names them — set their status to Disabled instead.`,
    () => safely(async () => {
      await cloud.deleteUser(id);
      reopenSettings();
      renderUserRows();
      toast("Account deleted.", "info");
    }));
}

function openAddUserModal() {
  if (!can("users", "edit")) return;
  const form = $("#form-add-user");
  form.reset();
  fillRoleSelect(form.roleKey, "viewer");
  openModal("#modal-add-user");
}

function addUser(ev) {
  ev.preventDefault();
  const form = ev.target;
  const email = form.email.value.trim().toLowerCase();
  safely(async () => {
    const res = await cloud.createUser(email, form.fullName.value, form.displayName.value, form.roleKey.value);
    renderUserRows();
    showTempPassword(email, res.password, "Account created.");
  });
}

function resetUserPassword() {
  const id = state.users.editingId;
  const u = (D().users || []).find(x => x.id === id);
  if (!u) return;
  showConfirm("Issue a new password?",
    `${u.fullName || u.email} will not be able to sign in with their current password once you do. ` +
    `You'll see the new one on the next screen — it is shown once, so pass it on before you close it. ` +
    `They'll be asked to choose their own the first time they use it.`,
    () => safely(async () => {
      const res = await cloud.setUserPassword(id);
      renderUserRows();
      // res.warning is set when the password changed but the "must choose their
      // own" flag did not — the password is still the thing to hand over, so
      // this shows rather than throws.
      showTempPassword(u.email, res.password, "New password issued.", res.warning);
    }));
}

/* The one moment this password is visible. It is generated in the Edge Function
   and never stored anywhere the app can read back, so if the admin closes this
   without passing it on, the only way forward is to issue another one. */
function showTempPassword(email, password, headline, warning) {
  $("#temp-password-title").textContent = headline;
  $("#temp-password-for").textContent = `For ${email}.`;
  $("#temp-password-value").textContent = password;
  // Only ever set on a partial success, and never by "+ Add user" — that one
  // rolls itself back rather than half-finishing. When it is set, the standing
  // promise below it ("they'll be asked to choose their own") is exactly what
  // failed, so that sentence goes with it.
  $("#temp-password-warn").textContent = warning || "";
  $("#temp-password-warn").classList.toggle("hidden", !warning);
  $("#temp-password-forced").classList.toggle("hidden", !!warning);
  const copy = $("#btn-copy-temp-password");
  copy.textContent = "Copy";
  copy.onclick = () => {
    navigator.clipboard.writeText(password)
      .then(() => { copy.textContent = "Copied"; })
      .catch(() => { copy.textContent = "Select it and copy"; });
  };
  openModal("#modal-temp-password");
}

async function exportUsersXlsx() {
  const rows = usersFilteredSorted();   // the same rows the table is showing right now
  if (!rows.length) { toast("No users match the current filters, so there is nothing to export.", "info"); return; }
  const columns = [
    { label: "Name", width: 28 }, { label: "Display name", width: 18 }, { label: "Email", width: 34 }, { label: "Role", width: 12 },
    { label: "Status", width: 12 }, { label: "Last seen", width: 22 }, { label: "Requested", width: 22 }, { label: "Approved", width: 22 }, { label: "Approved by", width: 28 },
  ];
  const out = rows.map(u => [
    u.fullName || "", u.displayName || "", u.email || "", roleLabel(u.roleKey),
    (USER_STATUS[u.status] || {}).label || u.status,
    u.lastSeenAt || "", u.requestedAt || "", u.approvedAt || "", u.approvedBy || "",
  ]);
  await downloadTableXlsx("Users", `users_${todayStr()}.xlsx`, columns, out, "TOTAL USERS: " + rows.length);
  toast(`Exported ${rows.length} ${rows.length === 1 ? "user" : "users"}.`, "info");
}

/* ---------- Roles & permissions ---------- */
/* The matrix, drawn as one table: rows are areas grouped into "Tabs & menus"
   and "Overview sections", columns are the roles. Admin's column is disabled
   here and guarded by a trigger in the database, so this screen can never be
   used to lock everyone out of this screen.

   Nothing is written on change. A change is staged (it is highlighted, and the
   action bar counts it) and Review changes opens a before/after list; Apply
   changes in that dialog is what writes. Under 960px one role is shown at a time
   (the picker above the table), because four columns do not fit a phone. */
function permShown(roleKey, item, viewOnly) {
  const cur = (D().perms[roleKey] || {})[item.key] || "none";
  const levels = item.allowOnly ? ["none", "edit"] : viewOnly ? ["none", "view"] : ["none", "view", "edit"];
  return levels.includes(cur) ? cur : (item.allowOnly ? "none" : "view");
}

function renderRolesMatrix() {
  const body = $("#roles-matrix-body");
  if (!body || !can("users", "edit")) return;
  const roles = D().roles;
  body.innerHTML = "";
  if (!roles.some(r => r.key === state.rolesColumn)) {
    state.rolesColumn = (roles.find(r => !r.protected) || roles[0] || {}).key || null;
  }

  const head = document.createElement("tr");
  head.className = "rm-head";
  head.innerHTML = "<th>Area</th>" + roles.map(r =>
    `<th data-role="${escapeHtml(r.key)}">${escapeHtml(r.label)}${r.protected ? '<br><small>always full access</small>' : ""}</th>`).join("");
  body.appendChild(head);

  for (const group of PERM_AREAS) {
    const gr = document.createElement("tr");
    gr.className = "rm-group";
    gr.innerHTML = `<td colspan="${roles.length + 1}">${escapeHtml(group.group)}</td>`;
    body.appendChild(gr);

    for (const item of group.items) {
      const viewOnly = group.viewOnly || item.viewOnly;
      const tr = document.createElement("tr");
      const hint = item.hint ? `<small>${escapeHtml(item.hint)}</small>` : "";
      tr.innerHTML = `<td class="rm-area">${escapeHtml(item.label)}${hint}</td>`;
      for (const role of roles) {
        const td = document.createElement("td");
        td.dataset.role = role.key;
        td.dataset.label = role.label;
        const key = role.key + "|" + item.key;
        const sel = document.createElement("select");
        sel.className = "rm-level";
        sel.setAttribute("aria-label", `${item.label} for ${role.label}`);
        // A section that nothing can "edit" only offers off/on — a third state
        // that means nothing would just be a way to get it wrong.
        // A one-off action (deleting a board) is simply allowed or not.
        const levels = item.allowOnly ? ["none", "edit"] : viewOnly ? ["none", "view"] : ["none", "view", "edit"];
        sel.innerHTML = levels.map(l =>
          `<option value="${l}">${l === "none" ? "—" : l === "view" ? "View" : item.allowOnly ? "Allowed" : "Edit"}</option>`).join("");
        const saved = permShown(role.key, item, viewOnly);
        sel.value = sdVal("roles", key, saved);
        sel.disabled = !!role.protected;
        if (role.protected) sel.title = "Admin always keeps full access.";
        td.classList.toggle("rm-changed", !!sdMap("roles")[key]);
        sel.onchange = () => {
          sdSet("roles", key, sel.value, `${role.label}: ${item.label}`, () => permShown(role.key, item, viewOnly),
            { roleKey: role.key, areaKey: item.key, roleLabel: role.label, areaLabel: item.label, allowOnly: !!item.allowOnly });
          td.classList.toggle("rm-changed", !!sdMap("roles")[key]);
        };
        td.appendChild(sel);
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }

  const pick = $("#rm-role-select");
  pick.innerHTML = roles.map(r => `<option value="${escapeHtml(r.key)}">${escapeHtml(r.label)}${r.protected ? " (always full access)" : ""}</option>`).join("");
  pick.value = state.rolesColumn || "";
  showRolesColumn();
}

/* the one-role-at-a-time view: CSS only shows the marked column below 960px */
function showRolesColumn() {
  for (const el of $$("#roles-matrix [data-role]")) {
    el.toggleAttribute("data-visible", el.dataset.role === state.rolesColumn);
  }
}

function wireUserManagement() {
  $("#users-search").addEventListener("input", (e) => { state.users.search = e.target.value; renderUserRows(); });
  $("#btn-users-pending").onclick = () => { state.users.pendingOnly = !state.users.pendingOnly; renderUserRows(); };
  $("#btn-users-xlsx").onclick = () => safely(exportUsersXlsx);
  $("#btn-add-user").onclick = openAddUserModal;
  $("#form-add-user").onsubmit = addUser;
  $("#form-user").onsubmit = saveUserModal;
  $("#btn-delete-user").onclick = deleteUserFromModal;
  $("#btn-reset-password").onclick = resetUserPassword;
  // Back to the Users list rather than the board: the admin has just changed
  // something there and the new row is what they want to see.
  $("#btn-temp-password-done").onclick = reopenSettings;
  for (const ms of $$("#users-filters .ms")) {
    ms.querySelector(".ms-btn").onclick = (ev) => {
      ev.stopPropagation();
      const pop = ms.querySelector(".ms-pop");
      const wasOpen = !pop.classList.contains("hidden");
      closeFilterPops();
      if (!wasOpen) pop.classList.remove("hidden");
    };
  }
  for (const th of $$("#users-table th[data-sort]")) {
    th.onclick = () => {
      const key = th.dataset.sort;
      if (state.users.sortKey === key) state.users.sortDir *= -1;
      else { state.users.sortKey = key; state.users.sortDir = 1; }
      renderUserRows();
    };
  }
  wireAccountPane();
}

/* ---------- login ---------- */
/* The sign-in box holds three forms in one card — sign in, request access, and
   the "you can't come in yet" message — because they are the same conversation
   and swapping them in place keeps the person on one screen instead of
   navigating them around. There is no forgot-password form: that needs email,
   which this deployment has none of, so an admin reissues the password from
   Settings → Users instead. */
const LOGIN_FORMS = ["#form-login", "#form-request", "#login-blocked"];

function showLogin(which = "#form-login") {
  $("#login-screen").classList.remove("hidden");
  $("#reset-screen").classList.add("hidden");
  $("#app-root").classList.add("hidden");
  for (const id of LOGIN_FORMS) $(id).classList.toggle("hidden", id !== which);
}

/* Shown when someone signs in successfully but their account isn't active.
   Without this they would land on a board with every table empty (RLS is doing
   its job) and no idea why. */
function showAccountBlocked(status) {
  const msg = status === "pending"
    ? "Your request is in. An admin still has to approve it. There's no email from this app, so tell them you've asked, then try signing in again."
    : status === "missing"
      ? "Your sign-in works, but there's no profile record for it yet. An admin needs to run the user-management migration, or add you from Settings → Users."
      : "Your access to this app has been switched off. Ask an admin if you think that's a mistake.";
  $("#login-blocked-text").textContent = msg;
  showLogin("#login-blocked");
}

/* A submit button that says what it is doing, and puts itself back afterwards. */
function withBusy(form, label, run) {
  const btn = form.querySelector("button[type=submit]");
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  return run().finally(() => { btn.disabled = false; btn.textContent = was; });
}
function loginMessage(sel, text, isError) {
  const box = $(sel);
  box.textContent = text;
  box.classList.toggle("hidden", !text);
}

function wireLogin() {
  $("#form-login").onsubmit = (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const errBox = $("#login-error");
    errBox.classList.add("hidden");
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Signing in…";
    cloud.signIn(form.email.value.trim(), form.password.value)
      .then(() => location.reload())
      .catch((e) => {
        errBox.textContent = e.message || "Sign-in failed.";
        errBox.classList.remove("hidden");
        btn.disabled = false;
        btn.textContent = "Sign in";
      });
  };

  $("#btn-request-access").onclick = () => showLogin("#form-request");
  for (const b of $$("[data-login-back]")) b.onclick = () => showLogin("#form-login");
  $("#btn-blocked-signout").onclick = () => cloud.signOut().then(() => location.reload());

  $("#form-request").onsubmit = (ev) => {
    ev.preventDefault();
    const form = ev.target;
    loginMessage("#request-error", "");
    loginMessage("#request-note", "");
    withBusy(form, "Sending…", () =>
      cloud.requestAccess(form.email.value, form.password.value, form.fullName.value)
        .then(() => {
          form.reset();
          loginMessage("#request-note",
            "Request sent. An admin has to approve it before you can sign in — this app sends no email, so tell them you've asked, then try signing in again.");
        })
        .catch((e) => {
          // The domain rule lives in a trigger on auth.users, and a trigger
          // exception comes back from the auth service as an opaque 500 — so
          // say the useful thing rather than passing that through.
          const raw = (e && e.message) || "";
          const domainish = /database error|unexpected_failure|limited to|500/i.test(raw);
          loginMessage("#request-error", domainish
            ? "That address can't be used. Access is limited to @trigo-group.com addresses."
            : raw || "Could not send the request.", true);
        }));
  };

}

/* ---------- setting a new password ---------- */
/* Two callers. boot() sends anyone here whose profile carries
   must_change_password — the session they just signed in with is the proof, and
   the flag is what they have to clear to get past it. The rarer caller is a
   recovery link triggered from the Supabase dashboard, where Supabase has
   already turned the link into a recovery session before this runs; there too
   the session IS the proof, so there is nothing to verify here either way. */
function showResetScreen(session, why) {
  $("#login-screen").classList.add("hidden");
  $("#app-root").classList.add("hidden");
  $("#reset-screen").classList.remove("hidden");
  const email = session && session.user && session.user.email;
  $("#reset-for").textContent = [why, email ? `For ${email}.` : ""].filter(Boolean).join(" ");
}

function wireReset() {
  $("#form-reset").onsubmit = (ev) => {
    ev.preventDefault();
    const form = ev.target;
    loginMessage("#reset-error", "");
    if (form.password.value !== form.confirm.value) {
      loginMessage("#reset-error", "The two passwords don't match.", true);
      return;
    }
    withBusy(form, "Saving…", () =>
      cloud.updatePassword(form.password.value)
        .then(() => {
          // straight into the app: the recovery session is a real session
          window.location.hash = "";
          location.reload();
        })
        .catch((e) => loginMessage("#reset-error", (e && e.message) || "Could not set the password.", true)));
  };
}

/* ---------- adjustable width of the floating employee panel ----------
   The panel's width is the --fp-w CSS variable (it also drives #app-root's right
   margin, so the board reflows around it). Wider panel = the flex-wrap cards in
   it fall into more columns. Persisted per browser. */
const FP_WIDTH_KEY = "mpm-pool-width";
const FP_MIN_W = 264;   // the original fixed width — never narrower than that
function fpMaxWidth() { return Math.max(FP_MIN_W, Math.min(760, Math.floor(window.innerWidth * 0.6))); }
function clampFpWidth(w) { return Math.max(FP_MIN_W, Math.min(fpMaxWidth(), Math.round(w))); }

function wireFloatPoolResize() {
  const handle = $("#fp-resizer");
  if (!handle) return;
  const root = document.documentElement;
  let width = FP_MIN_W;
  try {
    const saved = parseInt(localStorage.getItem(FP_WIDTH_KEY), 10);
    if (saved > 0) width = saved;
  } catch { /* storage unavailable — fall back to the default width */ }

  let raf = 0;
  const apply = (w, persist) => {
    width = clampFpWidth(w);
    root.style.setProperty("--fp-w", width + "px");
    handle.setAttribute("aria-valuenow", String(width));
    handle.setAttribute("aria-valuemin", String(FP_MIN_W));
    handle.setAttribute("aria-valuemax", String(fpMaxWidth()));
    // the board's width just changed, but window "resize" doesn't fire for that —
    // re-pack the mission masonry ourselves (at most once per frame)
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; layoutMasonry(); });   // no-ops off a board view
    if (persist) {
      try { localStorage.setItem(FP_WIDTH_KEY, String(width)); } catch { /* skip persisting */ }
    }
  };
  apply(width, false);

  handle.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    handle.setPointerCapture(ev.pointerId);
    document.body.classList.add("fp-resizing");
  });
  handle.addEventListener("pointermove", (ev) => {
    if (!handle.hasPointerCapture(ev.pointerId)) return;
    apply(window.innerWidth - ev.clientX, false);   // panel hugs the right edge
  });
  const end = (ev) => {
    if (!handle.hasPointerCapture(ev.pointerId)) return;
    handle.releasePointerCapture(ev.pointerId);
    document.body.classList.remove("fp-resizing");
    apply(width, true);
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("dblclick", () => apply(FP_MIN_W, true));
  handle.addEventListener("keydown", (ev) => {
    const step = ev.shiftKey ? 120 : 24;
    if (ev.key === "ArrowLeft") apply(width + step, true);          // handle moves left = panel grows
    else if (ev.key === "ArrowRight") apply(width - step, true);
    else if (ev.key === "Home") apply(FP_MIN_W, true);
    else if (ev.key === "End") apply(fpMaxWidth(), true);
    else return;
    ev.preventDefault();
  });
  // a smaller window may no longer have room for the saved width
  window.addEventListener("resize", () => { if (clampFpWidth(width) !== width) apply(width, false); });
}

/* ---------- wiring ---------- */
function wireApp() {
  wireFloatPoolResize();
  $("#btn-toolbar-more").onclick = (ev) => {
    ev.stopPropagation();   // don't let the outside-click handler close it immediately
    const panel = $("#toolbar-more");
    const open = panel.classList.toggle("open");
    $("#btn-toolbar-more").setAttribute("aria-expanded", String(open));
  };
  // Collapsed float pool (see renderFloatPool/.fp-collapsed): mouse hover expands
  // it via plain CSS, but native HTML5 drag doesn't reliably keep :hover active
  // in every browser, so a card dragged toward the empty pool needs this too.
  // dragenter/dragleave bubble from every child as the cursor crosses them, so
  // a depth counter (not a single boolean) is what keeps the panel open while
  // the drag is still somewhere inside it.
  let fpDragDepth = 0;
  const floatPool = $("#float-pool");
  floatPool.addEventListener("dragenter", () => {
    fpDragDepth++;
    floatPool.classList.add("fp-drag-hover");
  });
  floatPool.addEventListener("dragleave", () => {
    fpDragDepth = Math.max(0, fpDragDepth - 1);
    if (fpDragDepth === 0) floatPool.classList.remove("fp-drag-hover");
  });
  floatPool.addEventListener("drop", () => { fpDragDepth = 0; floatPool.classList.remove("fp-drag-hover"); });
  // a cancelled drag (Escape, dropped outside any dropzone) fires dragend with
  // no matching dragleave — reset here too or the panel could stay stuck open
  document.addEventListener("dragend", () => { fpDragDepth = 0; floatPool.classList.remove("fp-drag-hover"); });
  $("#btn-new-mission").onclick = () => guardEdit(() => openMissionModal(null));
  $("#btn-new-employee").onclick = () => guardEdit(() => openEmployeeModal(null));
  $("#form-mission").onsubmit = saveMission;
  initSegmented();
  $("#form-employee").onsubmit = saveEmployee;
  $("#form-employee-note").addEventListener("submit", saveEmployeeNote);
  $("#btn-delete-mission").onclick = deleteMission;
  $("#btn-hide-mission").onclick = hideMission;
  $("#btn-hide-missions").onclick = openHideMissionsModal;
  $("#btn-hide-missions-save").onclick = saveHideMissions;
  bindHideMissionsModal();
  $("#btn-deactivate-employee").onclick = deactivateEmployee;

  $("#btn-settings").onclick = () => openSettingsView();
  for (const btn of $$("#settings-tabs .settings-tab")) {
    btn.onclick = () => goSettingsTab(btn.dataset.tab);
  }
  // the phone's section picker snaps back if the unsaved-changes guard is declined
  $("#sv-select").onchange = (ev) => goSettingsTab(ev.target.value, () => { ev.target.value = state.settingsTab; });
  $("#btn-settings-back").onclick = closeSettingsView;
  $("#btn-settings-back-icon").onclick = closeSettingsView;
  $("#btn-sv-save").onclick = () => saveSettingsSection();
  $("#btn-sv-discard").onclick = discardSettingsDraft;
  $("#rm-role-select").onchange = (ev) => { state.rolesColumn = ev.target.value; showRolesColumn(); };
  // a live update that arrived while a field had focus is drawn once focus has
  // left (after a beat, so a click on a button in the page is not swallowed by
  // the page being redrawn between its press and its release)
  $("#sv-scroll").addEventListener("focusout", () => {
    if (!state.settingsStale) return;
    setTimeout(() => {
      const ae = document.activeElement;
      const typing = ae && $("#sv-scroll").contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName);
      if (state.settingsOpen && state.settingsStale && !typing) renderSettings();
    }, 300);
  });
  window.addEventListener("beforeunload", (ev) => {
    if (state.settingsOpen && anySettingsDirty()) { ev.preventDefault(); ev.returnValue = ""; }
  });
  for (const btn of $$("#employee-tabs .settings-tab")) {
    btn.onclick = () => { state.employeeTab = btn.dataset.tab; applyEmployeeTab(); };
  }
  wireUserManagement();
  $("#btn-add-engineer").onclick = openAddEngineerModal;
  $("#form-add-engineer").onsubmit = addEngineerFromModal;
  // back to Settings rather than closing everything: the pane it was opened
  // from is what the person was in the middle of
  $("#btn-add-engineer-cancel").onclick = reopenSettings;
  $("#btn-add-area").onclick = openAddAreaModal;
  $("#form-add-area").onsubmit = addAreaFromModal;
  $("#form-add-area").areaColor.oninput = (ev) => { ev.target.parentElement.querySelector("b").textContent = swHex(ev.target.value); };

  initTheme();

  $("#btn-add-board").onclick = openBoardModal;
  $("#btn-add-board-settings").onclick = openBoardModal;
  wireTopbarMenus();
  wireLeaveTabs();
  $("#form-board").onsubmit = saveBoard;
  $("#btn-signout").onclick = () => settingsGuard(() => safely(() => cloud.signOut()));

  // date picker (custom calendar with weekend highlight)
  $("#btn-date").onclick = (ev) => { ev.stopPropagation(); toggleDatePicker(); };
  // quick prev/next day — the most common navigation, one tap instead of the calendar
  $("#btn-date-prev").onclick = () => { clearSelection(); state.date = addDays(state.date, -1); refreshAndRender(); };
  $("#btn-date-next").onclick = () => { clearSelection(); state.date = addDays(state.date, 1); refreshAndRender(); };
  $("#btn-lock").onclick = toggleLockBoard;

  // weekend mission import
  $("#btn-import-mission").onclick = openImportModal;
  $("#btn-import-confirm").onclick = confirmImport;

  // holiday toggle: flipping it declares/clears a holiday for the current date
  $("#holiday-check").onchange = (ev) => {
    const wantNonWorking = ev.target.checked;   // checked = holiday
    const date = state.date;
    const boardId = D().activeBoardId;
    const boardName = D().boards.find(b => b.id === boardId)?.name || "this board";
    const revert = () => { ev.target.checked = !wantNonWorking; };
    if (wantNonWorking) {
      showConfirm("Mark as holiday?",
        `Mark ${fmtDow(date)} ${fmtDate(date)} as a holiday for ${boardName}? Any missions already planned that day on ${boardName} will be cleared, and the day will behave like a weekend (empty board, use "Add Mission" to pull missions in). Other boards are unaffected.`,
        () => safely(async () => { await cloud.setDayWorking(boardId, date, false); D().plans = {}; await refreshAndRender(); }),
        revert);
    } else {
      showConfirm("Make it a working day?",
        `Make ${fmtDow(date)} ${fmtDate(date)} a working day for ${boardName}? It will start by copying the latest working-day plan. Other boards are unaffected.`,
        () => safely(async () => { await cloud.setDayWorking(boardId, date, true); D().plans = {}; await refreshAndRender(); }),
        revert);
    }
  };

  // multi-select filter dropdowns: toggle open on button click
  for (const ms of $$("#filters .ms, #emplist-filters .ms, #hostlist-filters .ms")) {
    ms.querySelector(".ms-btn").onclick = (ev) => {
      ev.stopPropagation();
      const pop = ms.querySelector(".ms-pop");
      const wasOpen = !pop.classList.contains("hidden");
      closeFilterPops();
      if (!wasOpen) pop.classList.remove("hidden");
    };
  }
  $("#sort-by").onchange = (e) => { state.sort = e.target.value; render(); };

  $("#btn-export").onclick = openExportModal;
  $("#card-names").value = state.cardNames;
  initSegmented();   // draws the Thai | English toggles (the selects stay the source of truth)
  syncSegmented();
  $("#card-names").addEventListener("change", (e) => {
    state.cardNames = e.target.value;
    try { localStorage.setItem("manpower.cardNames", state.cardNames); } catch (err) { /* remembering is a courtesy */ }
    render();
  });
  $("#btn-xlsx-all").onclick = () => setXlsxTicks(true);
  $("#btn-xlsx-none").onclick = () => setXlsxTicks(false);
  $("#btn-xlsx-go").onclick = runBoardExport;
  // on the window, not the button: Ctrl+P has to get the same page as the click
  window.addEventListener("beforeprint", prepareForPrint);
  window.addEventListener("afterprint", restoreAfterPrint);
  $("#btn-reset-board").onclick = () => guardEdit(() => resetBoard());
  // ---------- forward planning ----------
  $("#btn-forecast-copy").onclick = openForecastCopyModal;
  $("#forecast-copy-n").addEventListener("input", updateForecastCopyPreview);
  $("#btn-forecast-copy-confirm").onclick = confirmForecastCopy;
  $("#btn-hold-alerts").onclick = () => openHoldEventsModal(myLostHolds().map(e => e.id), "Your forecast alerts");
  $("#btn-holds-ack-all").onclick = () => safely(async () => {
    await cloud.acknowledgeHoldEvents(holdModalIds.filter(id => D().holdEvents.some(e => e.id === id)));
    renderHoldEventsModal();
    render();
  });
  $("#btn-plandiff-all").onclick = () => setAllPlanDiff(true);
  $("#btn-plandiff-none").onclick = () => setAllPlanDiff(false);
  $("#btn-plandiff-apply").onclick = applyPlanDiffFromModal;
  $("#btn-merge-apply").onclick = onMergeApply;
  $("#btn-merge-back").onclick = () => { if (state.merge && !state.merge.applying) { state.merge.step = "review"; renderMerge(); } };
  $("#merge-log-only").onchange = renderMergeLog;
  $("#cap-range").onchange = (ev) => { state.capacity.weeks = Number(ev.target.value); state.capacity.cacheKey = null; refreshAndRender(); };
  $("#btn-cap-copy-week").onclick = copyCapacityWeek;
  $("#btn-cap-seed").onclick = seedCapacityFromConfirmed;
  $("#btn-cap-more").onclick = openCapacityMoreMenu;
  $("#btn-cap-export-go").onclick = runCapExport;
  $("#btn-cap-export-all").onclick = () => capExportPick(true);
  $("#btn-cap-export-this").onclick = () => capExportPick(false);

  // employee search (floating panel) — filter as you type, keep selection
  $("#emp-search").addEventListener("input", (e) => { state.empSearch = e.target.value; renderFloatPool(); applySearchHighlight(); });
  // undo + selection controls
  $("#btn-undo").onclick = undoLast;
  $("#btn-clear-selection").onclick = clearSelection;

  // touch action bar: mark the device so CSS can reveal touch-only affordances,
  // and route its buttons to the same selection/context-menu logic desktop uses
  document.body.classList.toggle("touch-mode", IS_TOUCH);
  // the default hint is written for a mouse (Ctrl-click, drag); on a phone say
  // what actually works there instead — long-press in particular is invisible
  // unless something names it
  if (IS_TOUCH) {
    const hint = $(".fp-hint");
    if (hint) hint.textContent = "Tap to select · tap again for more · tap a mission or leave area to place · long-press for actions";
  }
  $("#btn-touch-clear").onclick = clearSelection;
  $("#btn-touch-actions").onclick = (ev) => {
    ev.stopPropagation();
    const firstId = state.selectedEmps.values().next().value;
    const emp = D().employees.find(e => e.id === firstId);
    if (!emp) return;
    const r = ev.currentTarget.getBoundingClientRect();
    showContextMenu(emp, r.left, r.top);   // showContextMenu clamps into the viewport
  };

  // ---------- Manpower List tab ----------
  $("#btn-emplist-bulk").onclick = () => openBulkModal("employees");
  $("#btn-hostlist-bulk").onclick = () => openBulkModal("hosts");
  $("#btn-bulk-dl-xlsx").onclick = () => safely(bulkDownload);
  $("#bulk-file").onchange = (e) => safely(() => onBulkFile(e));
  $("#btn-bulk-apply").onclick = () => safely(applyBulk);
  $("#btn-emplist-xlsx-go").onclick = exportEmplistXlsx;
  $("#emplist-name-view").addEventListener("change", (e) => {
    state.emplist.nameView = e.target.value;
    try { localStorage.setItem(EMPLIST_NAME_VIEW_KEY, state.emplist.nameView); } catch (err) { /* remembering is a courtesy */ }
    renderEmployeeRows();
  });
  $("#emplist-search").addEventListener("input", (e) => { state.emplist.search = e.target.value; renderEmployeeRows(); });
  for (const th of $$("#emplist-table th[data-sort]")) {
    th.onclick = () => {
      const key = th.dataset.sort;
      if (state.emplist.sortKey === key) state.emplist.sortDir *= -1;
      else { state.emplist.sortKey = key; state.emplist.sortDir = 1; }
      renderEmployeeRows();
    };
  }
  $("#emplist-select-all").onchange = (ev) => {
    for (const tr of $$("#emplist-body tr")) {
      ev.target.checked ? state.selectedEmps.add(tr.dataset.empId) : state.selectedEmps.delete(tr.dataset.empId);
    }
    renderEmployeeRows();
  };
  $("#emplist-bulk-contract").onchange = (ev) => {
    const val = ev.target.value; ev.target.value = "";
    if (!val || !state.selectedEmps.size) return;
    safely(async () => { await cloud.setEmployeesContract([...state.selectedEmps], val); await refreshAndRender(); });
  };
  $("#emplist-bulk-position").onchange = (ev) => {
    const val = ev.target.value; ev.target.value = "";
    if (!val || !state.selectedEmps.size) return;
    safely(async () => { await cloud.setEmployeesPosition([...state.selectedEmps], val === "__none__" ? "" : val); await refreshAndRender(); });
  };
  $("#emplist-bulk-area").onchange = (ev) => {
    const val = ev.target.value; ev.target.value = "";
    if (!val || !state.selectedEmps.size) return;
    safely(async () => { await cloud.setEmployeesArea([...state.selectedEmps], val); await refreshAndRender(); });
  };
  $("#emplist-bulk-board").onchange = (ev) => {
    const val = ev.target.value; ev.target.value = "";
    if (!val || !state.selectedEmps.size) return;
    guardEdit(() => safely(async () => {
      await cloud.moveEmployeesToBoard([...state.selectedEmps], val, state.date);
      await refreshAndRender();
    }));
  };
  $("#emplist-bulk-deactivate").onclick = () => {
    const ids = [...state.selectedEmps];
    if (!ids.length) return;
    showConfirm("Deactivate employees?",
      `Deactivate ${ids.length} selected employee${ids.length === 1 ? "" : "s"}? Hidden from today's and future boards; past dates keep them. Turn back on from the Status column.`,
      () => safely(async () => { await cloud.setEmployeesActive(ids, false); state.selectedEmps = new Set(); await refreshAndRender(); }));
  };
  $("#emplist-bulk-clear").onclick = clearSelection;

  // ---------- Host List tab ----------
  $("#btn-hostlist-export-go").onclick = () => safely(async () => { await exportHostlistXlsx(); closeModal(); });
  $("#btn-add-host").onclick = () => openHostModal(null);
  $("#hostlist-search").addEventListener("input", (e) => { state.hostlist.search = e.target.value; renderHostRows(); });
  for (const th of $$("#hostlist-table th[data-sort]")) {
    th.onclick = () => {
      const key = th.dataset.sort;
      if (state.hostlist.sortKey === key) state.hostlist.sortDir *= -1;
      else { state.hostlist.sortKey = key; state.hostlist.sortDir = 1; }
      renderHostRows();
    };
  }
  $("#form-host").addEventListener("submit", saveHostForm);
  $("#btn-delete-host").onclick = deleteHostRecord;
  $("#btn-host-merge").onclick = mergeHostFromModal;
  $("#btn-hostlist-dups").onclick = () => {
    state.hostlist.dupOnly = !state.hostlist.dupOnly;
    renderHostRows();
  };
  // Host box on the mission form: say live whether what's typed is a host the
  // board knows ("change" as well as "input" — picking a datalist suggestion
  // with the mouse doesn't always fire input on every browser)
  for (const ev of ["input", "change"]) {
    $("#form-mission").host.addEventListener(ev, updateMissionHostNote);
    $("#form-mission").engineer.addEventListener(ev, updateMissionEngineerNote);
  }

  // Long-press bookkeeping (see attachLongPress). Capture phase on both: the
  // swallowed click must die before it reaches the card's own handler AND
  // before the outside-click handler right below closes the menu we just
  // opened. A fresh touchstart means the previous gesture's click has either
  // already been dealt with or is never coming, so the flag clears there.
  document.addEventListener("touchstart", () => { swallowNextClick = false; }, true);
  document.addEventListener("click", (ev) => {
    if (!swallowNextClick) return;
    swallowNextClick = false;
    ev.stopPropagation();
    ev.preventDefault();
  }, true);

  // dismiss context menu / date picker on any outside click or Escape
  document.addEventListener("click", (ev) => {
    // NOT unconditional: a click on the menu's own scrollbar targets
    // #context-menu itself, so hiding here killed the menu mid-drag. Items
    // close it themselves (addItem), submenu rows deliberately don't.
    if (!ev.target.closest("#context-menu")) hideContextMenu();
    if (!ev.target.closest("#datepicker-pop") && !ev.target.closest("#btn-date")) hideDatePicker();
    if (!ev.target.closest("#filters .ms") && !ev.target.closest("#emplist-filters .ms")
        && !ev.target.closest("#hostlist-filters .ms")) closeFilterPops();
    if (!ev.target.closest("#toolbar-more")) hideToolbarMore();
    if (!ev.target.closest(".cap-pop")) capClosePop();
  });
  // Capacity grid: drag-select ends anywhere on the page; a click outside the
  // grid drops the selection; copy / paste go through the grid's handlers
  document.addEventListener("mouseup", capMouseUp);
  document.addEventListener("mousedown", (ev) => {
    const t = ev.target;
    if (t && t.closest && (t.closest(".cap-cell[data-r]") || t.closest("#context-menu") || t.closest(".modal") || t.id === "cap-clip")) return;
    capClearSel();
  });
  document.addEventListener("copy", capOnCopy);
  document.addEventListener("paste", capOnPaste);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { hideContextMenu(); hideDatePicker(); closeFilterPops(); hideToolbarMore(); clearSelection(); closeModal(); capClosePop(); }
    if (ev.key === "Tab" && state.settingsOpen && !$("#modal-backdrop").classList.contains("hidden")) trapModalTab(ev);
    // Ctrl/Cmd+Z = undo last assignment change (ignore while typing in a field,
    // and while Settings covers the board — the board is not what you are looking at)
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !state.settingsOpen && !/^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) {
      ev.preventDefault();
      undoLast();
    }
  });
  // capture-phase so a scroll in any container closes the menu (it's anchored
  // to a fixed viewport position, so it would otherwise detach from its card) —
  // but scrolling INSIDE the menu is not "the page moved under it".
  window.addEventListener("scroll", (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest("#context-menu")) return;
    hideContextMenu();
    capClosePop();
  }, true);

  // The mission grid is a JS masonry (cards are absolutely positioned), so it
  // must re-pack when the viewport width changes the column count. Debounced so
  // a drag-resize doesn't thrash. render() already re-packs on every data change.
  let masonryRT;
  window.addEventListener("resize", () => {
    clearTimeout(masonryRT);
    masonryRT = setTimeout(() => {
      // Overview's line charts are drawn at their measured container width, so
      // they need a redraw on resize too — the board just re-packs its masonry.
      if (isOverview()) render(); else layoutMasonry();
    }, 120);
  });

  // Mobile browsers resume a backgrounded tab without reloading, and may have
  // missed Realtime events while suspended. On every return to the foreground,
  // drop the plan cache and re-read fresh so a re-opened board always reflects
  // the saved plan (and anyone else's changes made while it was closed).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && D().boards.length) {
      cloud._invalidatePlans();
      refreshAndRender();
    }
  });

  // close modals
  $("#modal-backdrop").addEventListener("click", (ev) => { if (ev.target.id === "modal-backdrop") closeModal(); });
  for (const b of $$("[data-close]")) b.onclick = closeModal;
}

/* ---------- app version & update check ----------
   window.APP_VERSION comes from version.js, loaded by index.html with the same
   ?v= as every other file, so it is the release THIS page was built from — what
   a bug report should quote. A tab can stay open for days on a factory PC, so
   while signed in we re-fetch version.js (bypassing every cache) and, when the
   server's version differs, offer a refresh. Never an automatic reload: the
   person may be midway through a form. "Differs" rather than "is newer", so a
   rollback also prompts a refresh. */
const APP_VERSION_LOADED = window.APP_VERSION || "";
const UPDATE_CHECK_EVERY_MS = 10 * 60 * 1000;
const UPDATE_CHECK_MIN_GAP_MS = 2 * 60 * 1000;   // coming back to the tab re-checks, but not on every flick
let updateCheckedAt = 0;
let updateOffered = null;                        // the server version the banner is offering
let updateDismissedFor = null;                   // the server version whose banner was closed

function showAppVersion() {
  for (const el of $$("[data-app-version]")) el.textContent = APP_VERSION_LOADED || "unknown";
}

function parseServerVersion(text) {
  const m = /APP_VERSION\s*=\s*"([^"]+)"/.exec(text || "");
  return m ? m[1] : null;
}

function showUpdateBanner(latest) {
  const banner = $("#update-banner");
  if (!banner) return;
  updateOffered = latest;
  if (!latest || latest === updateDismissedFor) { banner.classList.add("hidden"); return; }
  $("#update-banner-text").textContent =
    "A new version of the board is available (" + latest + "). You are on " + APP_VERSION_LOADED + ".";
  banner.classList.remove("hidden");
}

async function checkForUpdate() {
  if (!APP_VERSION_LOADED) return;   // version.js never loaded: nothing to compare with
  updateCheckedAt = Date.now();
  let latest = null;
  try {
    const res = await fetch("version.js?cb=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return;
    latest = parseServerVersion(await res.text());
  } catch (e) { return; }            // offline or blocked: try again next time
  // null = the reply wasn't a version.js (e.g. a captive-portal page): say nothing
  if (latest) showUpdateBanner(latest === APP_VERSION_LOADED ? null : latest);
}

function wireUpdateCheck() {
  $("#btn-update-reload").onclick = () => location.reload();
  $("#btn-update-dismiss").onclick = () => {
    updateDismissedFor = updateOffered;
    $("#update-banner").classList.add("hidden");
  };
  setInterval(checkForUpdate, UPDATE_CHECK_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - updateCheckedAt > UPDATE_CHECK_MIN_GAP_MS) checkForUpdate();
  });
}

async function boot() {
  $("#login-screen").classList.add("hidden");
  $("#app-root").classList.remove("hidden");
  wireSaveStatus();
  wireApp();
  wireUpdateCheck();
  let session = null;
  try { session = await cloud.getSession(); state.myEmail = session && session.user && session.user.email; } catch (e) { /* toast attribution just won't fire */ }
  await cloud.init(() => state.date);
  // Signed in, but not allowed in yet. RLS would hand them empty tables, so
  // stop here with an explanation instead of a board with nothing on it.
  const me = D().me;
  if (me && !me.legacy && me.status !== "active") {
    $("#app-root").classList.add("hidden");
    showAccountBlocked(me.status);
    return;
  }
  // Signing in with a password an admin issued and read out. Nobody gets past
  // this screen still using it — which is what stops a handed-over password
  // becoming a permanent shared one.
  if (me && me.mustChangePassword) {
    showResetScreen(session, "An admin set this password for you. Choose your own to carry on.");
    return;
  }
  cloud.touchLastSeen();   // best-effort; "last seen" in Settings → Users
  // A matrix can be edited down to a role with no tab at all. Rendering the
  // board view with no board would be a stack of empty furniture, so say what
  // has happened instead. (Admin can never reach this — its column is locked.)
  if (me && !me.legacy && !firstAllowedView()) {
    $("#app-root").classList.add("hidden");
    $("#login-blocked-text").textContent =
      "Your role doesn't have access to any part of the app yet. Ask an admin to give it something in Settings → Roles.";
    showLogin("#login-blocked");
    return;
  }
  // holidays are known now — restore the last board/date the user was on, falling
  // back to the next working day if there's nothing saved (or it's stale/invalid)
  restoreViewState();
  cloud.onChange((payload) => {
    state.overview.utilCacheKey = null;
    state.overview.historyCacheKey = null;
    // the Capacity grid's leave / named counts come from the same rows
    state.capacity.cacheKey = null;
    // D3: a live heads-up for the ONE person whose hold was just taken —
    // the red flag on their mission is what persists; this is the "now"
    if (payload && payload.holdEvent && sameEmail(payload.holdEvent.from_held_by, state.myEmail)) {
      if (payload.holdEvent.kind === "merge") queueMergeToast(payload.holdEvent.id);
      else {
        const e = D().holdEvents.find(x => x.id === payload.holdEvent.id);
        if (e) toast(describeHold(e) + ".", "warn", { duration: 12000 });
      }
    }
    if (!$("#modal-holds").classList.contains("hidden")) renderHoldEventsModal();
    // a mission or an assignment anywhere can change who has worked where —
    // refreshData only re-reads the directory when the Host List is on screen
    state.hostlist.dirCacheKey = null;
    // {boardId, planDate, updatedBy} from a missions/assignments write (see
    // cloud.js's _attributionFromPayload) — undefined for every other kind of
    // change, and for a write from before the updated-by migration was run.
    // Only toast when it's a change to the board+date on screen right now,
    // and it wasn't this browser's own write echoing back through Realtime.
    if (payload && payload.updatedBy && payload.updatedBy !== state.myEmail &&
        payload.boardId === D().activeBoardId && payload.planDate === state.date) {
      const board = D().boards.find(b => b.id === payload.boardId);
      toast(`${board ? board.name : "This board"} was just updated by ${payload.updatedBy}.`, "info");
    }
    // an approval or a role change arriving over Realtime reaches an open
    // Settings page through refreshAndRender (settingsLiveRefresh)
    refreshAndRender();
  });
  await refreshAndRender();
  // fonts can settle after the first paint and change card heights — re-pack once ready
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutMasonry);
}

/* A recovery link arrives as #access_token=...&type=recovery. Supabase's client
   consumes that hash and raises PASSWORD_RECOVERY, but the hash is readable
   before it does — and reading it first is what stops the app booting the board
   for a split second on the way to the reset form. */
function isRecoveryLink() {
  const h = window.location.hash || "";
  return /(^|[#&])type=recovery(&|$)/.test(h);
}

/* The loading screen (#splash, top of index.html) stays up until the app knows
   what to show: the sign-in box, the reset form, or a board that has finished
   its first load. It is removed after its fade, not just hidden, so nothing of
   it is left to catch a click or an export. */
function hideSplash() {
  const el = document.getElementById("splash");
  if (!el) return;
  el.classList.add("splash-out");
  setTimeout(() => el.remove(), 400);
}

async function main() {
  showAppVersion();
  wireLogin();
  wireReset();
  let session = null;
  try { session = await cloud.getSession(); } catch (e) { console.error(e); }
  let hadSession = !!session;
  let recovering = isRecoveryLink();

  try {
    if (recovering) {
      showResetScreen(session);
    } else if (session) {
      await boot();
    } else {
      showLogin();
    }
  } finally {
    hideSplash();   // also when boot() throws, so a failure shows its own state, not a splash forever
  }
  // onAuthStateChange always fires once on load (even with no session ever set) —
  // only reload on a genuine sign-out transition, not that initial null event.
  cloud.onAuthChange((s) => {
    if (s) {
      hadSession = true;
      // The recovery session can land after this handler is attached, when the
      // link's hash is parsed asynchronously.
      if (isRecoveryLink() && !recovering) { recovering = true; showResetScreen(s); }
      return;
    }
    if (hadSession) location.reload();
  });
}

main();
