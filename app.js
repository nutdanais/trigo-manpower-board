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
const HISTORY_MEASURES = [
  { key: "deployed",       label: "Deployed (total)",     color: "var(--chart-assigned)", value: (r) => r.assigned },
  { key: "deployedPerm",   label: "Deployed — permanent", color: "var(--chart-cat-7)",    value: (r) => r.assigned - r.oncallAssigned },
  { key: "deployedOncall", label: "Deployed — on-call",   color: "var(--chart-oncall)",   value: (r) => r.oncallAssigned },
  { key: "oncallFree",     label: "On-call free",         color: "var(--chart-cat-3)",    value: (r) => trendMetricValue("oncallFree", r) },
  { key: "idle",           label: "Idle staff",           color: "var(--chart-standby)",  value: (r) => trendMetricValue("idle", r) },
  { key: "missions",       label: "Missions staffed",     color: "var(--chart-cat-5)",    value: (r) => r.staffedMissions },
];
/* The two deployment splits start hidden: they add up to "Deployed (total)",
   so showing all six by default draws the same people twice and makes the
   chart look busier than the data is. */
const HISTORY_DEFAULT_HIDDEN = ["deployedPerm", "deployedOncall"];
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
  settingsTab: "engineers",   // Settings modal: which sub-menu is showing. applySettingsTab falls
                              // back to the first pane this role may open (My account, at worst)
  employeeTab: "edit",        // Employee modal: "edit" or "hosts" (Host Record) — reset on every open
  cardNames: cardNamesSaved(),   // names on the board's employee cards: "th" | "en" | "both"
  emplist: {                  // Manpower List tab: search/filter/sort, independent of any board or date
    search: "",
    filters: { contract: [], position: [], service: [], areaId: [], boardId: [], status: [] },
    sortKey: "name",
    sortDir: 1,
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
    oncallQueueOpen: false,   // Action queue: the on-call-free list is collapsed by default (calm, not urgent)

    /* History + Engineer workload: one date range, one fetch, two charts.
       Deliberately NOT sharing state.overview.util above — Trend is 7/14/30
       days and History can be a whole year, and one shared cache would drag
       a year of rows in every time somebody clicked "7d". */
    historyPreset: "thisMonth",   // thisMonth | lastMonth | last30 | last90 | ytd | custom
    historyFrom: null,            // resolved by resolveHistoryRange() on first render
    historyTo: null,
    historyBoardId: "",           // "" = all boards summed; otherwise one board id
    historyHidden: new Set(HISTORY_DEFAULT_HIDDEN),   // measure keys toggled off via the History legend
    engMetric: "missions",        // "missions" | "crew" — Engineer workload chart
    engHidden: new Set(),         // engineer ids toggled off via that chart's legend
    historyShowUtil: false,       // false = the 6 deployment measures; true = a single Utilization % line
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
    { key: "ov.status",      label: "Status bar" },
    { key: "ov.kpi",         label: "KPI strip" },
    { key: "ov.actionQueue", label: "Action queue" },
    { key: "ov.byBoard",     label: "By board" },
    { key: "ov.history",     label: "History + Engineer workload" },
    { key: "ov.byEngineer",  label: "By engineer" },
    { key: "ov.dayNight",    label: "Day / night split" },
    { key: "ov.hostRisk",    label: "Host coverage risk" },
    { key: "ov.byArea",      label: "By service area" },
    { key: "ov.leave",       label: "Leave today" },
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
   / working days available to them (their board's working days in the window,
   minus their own leave). So leave doesn't punish the figure, and someone whose
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
  // working days per board across the window, computed once rather than per employee
  const workingByBoard = {};
  for (const b of D().boards) {
    let n = 0;
    for (let d = fromDate; d <= toDate; d = addDays(d, 1)) if (!isNonWorkingDate(d, b.id)) n++;
    workingByBoard[b.id] = n;
  }
  const out = {};
  for (const e of D().employees) {
    const r = raw[e.id];
    const working = workingByBoard[e.boardId] || 0;
    // only leave that lands on a working day shrinks the denominator
    let leaveOnWorkdays = 0;
    if (r) for (const d of r.leaveDates) if (!isNonWorkingDate(d, e.boardId)) leaveOnWorkdays++;
    const denom = working - leaveOnWorkdays;
    let worked = 0;
    if (r) for (const d of r.workedDates) if (!isNonWorkingDate(d, e.boardId)) worked++;
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
  const result = hosts.length ? await cloud.getHostCoverageForHosts(hosts) : {};
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
  // the cards only exist on a board (not Overview, Org Chart, lists or Capacity)
  $("#card-names").classList.toggle("hidden", !board);
  // Carry over / Reset Board on a confirmed day; "Start from confirmed" on an
  // empty forecast day (and nothing once a forecast exists — that is somebody's
  // work, not something to replace wholesale)
  const planEmpty = board && planIsEmpty(getPlan());
  $("#btn-reset-board").classList.toggle("hidden", fc ? !(planEdit && planEmpty) : !boardEdit);
  $("#btn-forecast-copy").classList.toggle("hidden", !(fc && planEdit && !planEmpty));
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
  const lock = board ? lockInfo(D().activeBoardId, state.date) : null;
  $("#readonly-badge").classList.toggle("hidden", !board || !isReadOnly());
  setIconLabel($("#readonly-badge"), "lock", lock ? `Locked by ${lock.lockedBy}` : "Read-only (past date)");
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
  filters: { boards: new Set(), engineers: new Set(), areas: new Set() },  // keys the user hid
  filterOpts: { boards: [], engineers: [], areas: [] },   // what's available to filter this render
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
  return {
    boards,
    engineers: [...engMap].map(([key, name]) => ({ key, name })),
    areas: [...areaMap].map(([key, name]) => ({ key, name })),
  };
}
/* Drop the boards / engineers / service areas the user has hidden. Mutates the
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
    b.children = b.children.filter(n => n.type !== "engineer" || n.children.length);
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
  const n = getPlan().missions.filter(m => m.hidden).length;
  setIconLabel(btn, "eye-off", n ? `Hide/Unhide (${n})` : "Hide/Unhide");
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
  // visual break: the three above are app-wide views; the rest are per-board.
  // Only worth drawing when there is something on both sides of it.
  if (D().boards.length && can("board") && el.children.length) {
    const sep = document.createElement("div");
    sep.className = "board-tab-sep";
    el.appendChild(sep);
  }
  for (const b of (can("board") ? D().boards : [])) {
    const t = document.createElement("div");
    // tab-board marks the per-board tabs specifically: the phone layout hides
    // these and shows #board-select instead, but keeps Overview / Manpower List
    t.className = "board-tab tab-board" + (b.id === D().activeBoardId ? " active" : "");
    t.textContent = b.name;
    t.title = can("settings", "edit") ? "Click to switch. Double-click to rename." : "Click to switch.";
    t.onclick = () => { clearSelection(); D().activeBoardId = b.id; refreshAndRender(); };
    t.ondblclick = () => {
      if (!can("settings", "edit")) return;
      const name = prompt("Rename board:", b.name);
      if (name && name.trim()) safely(async () => { await cloud.renameBoard(b.id, name.trim()); render(); });
    };
    el.appendChild(t);
  }
  el.scrollLeft = keepScroll;
  const act = el.querySelector(".board-tab.active");
  if (act && act.offsetParent) {
    const a = act.getBoundingClientRect(), e = el.getBoundingClientRect();
    if (a.left < e.left) el.scrollLeft += a.left - e.left - 8;
    else if (a.right > e.right) el.scrollLeft += a.right - e.right + 8;
  }
  renderBoardSelect();
}

/* Phone stand-in for the per-board tabs (CSS decides which of the two is
   visible; both are always populated, so a rotate or a resize needs no
   re-render). "+ New board…" rides along as the last option, which is what
   lets the "+ Board" button be hidden on a phone. */
const NEW_BOARD_OPT = "__new_board__";

function renderBoardSelect() {
  const sel = $("#board-select");
  const onBoard = !isNonBoardView();
  sel.innerHTML = "";
  // Overview / Manpower List / Host List are not boards, so no option matches then — a
  // <select> with no match silently displays its first option, which would read
  // as "you are on this board" while looking at something else. A disabled
  // placeholder is what it shows instead.
  if (!onBoard) {
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "Board…";
    ph.disabled = true;
    sel.appendChild(ph);
  }
  for (const b of (can("board") ? D().boards : [])) {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = b.name;
    sel.appendChild(o);
  }
  if (can("settings", "edit")) {
    const add = document.createElement("option");
    add.value = NEW_BOARD_OPT;
    add.textContent = "+ New board…";
    sel.appendChild(add);
  }
  sel.value = onBoard ? D().activeBoardId : "";
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
  try { const v = localStorage.getItem("manpower.cardNames"); return v === "en" || v === "both" ? v : "th"; } catch (e) { return "th"; }
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
    const body = $(`[data-drop="zone:${z}"]`);
    body.innerHTML = "";
    const emps = plan.zones[z]
      .map(empId => D().employees.find(e => e.id === empId))
      .filter(e => e && e.boardId === D().activeBoardId && onRoster(e));
    for (const emp of sortEmployeesDisplay(emps)) body.appendChild(empCard(emp));
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
  renderFloatPool();
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
    const memberEmps = m.members
      .map(empId => D().employees.find(e => e.id === empId))
      .filter(e => e && e.boardId === D().activeBoardId && onRoster(e));
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

function renderStats() {
  const bar = $("#stats-bar");
  const areaBar = $("#area-bar");
  bar.innerHTML = "";
  areaBar.innerHTML = "";
  if (isOverview()) {
    bar.appendChild(statChip("All employees", D().employees.filter(onRoster).length));
    for (const b of D().boards) bar.appendChild(statChip(b.name, rosterEmployees(b.id).length));
    return;
  }
  if (isOrgChart()) {
    let missions = 0, crew = 0; const engs = new Set();
    for (const b of D().boards) {
      const plan = (D().plans[b.id] || {})[state.date];
      if (!plan) continue;
      for (const m of plan.missions) {
        if (m.hidden) continue;
        missions++;
        if (m.engineerId) engs.add(m.engineerId);
        crew += m.members.length;
      }
    }
    bar.appendChild(statChip("Boards", D().boards.length));
    bar.appendChild(statChip("Engineers", engs.size));
    bar.appendChild(statChip("Missions", missions));
    bar.appendChild(statChip("Crew deployed", crew));
    return;
  }
  if (isEmployeeList()) {
    const permN = D().employees.filter(e => e.contract === "permanent").length;
    bar.appendChild(statChip("Total employees", D().employees.length));
    bar.appendChild(statChip("Permanent", permN));
    bar.appendChild(statChip("On-call", D().employees.length - permN));
    // per-service-area counts, same idea as a board's #area-bar — its own chip
    // group right after the ones above, still inside the shared #toolbar row
    const emplistAreaBar = $("#emplist-area-bar");
    emplistAreaBar.innerHTML = "";
    for (const a of D().areas) {
      const n = D().employees.filter(e => e.areaId === a.id).length;
      if (n) emplistAreaBar.appendChild(statChip(a.name, n));
    }
    return;
  }
  if (isCapacity()) {
    const boardId = capBoardId();
    if (!boardId) return;
    const m = capacityModel(boardId);
    if (m.roster) bar.appendChild(statChip("Roster", `${m.roster.perm + m.roster.oncall} (${m.roster.perm} P · ${m.roster.oncall} OC)`));
    bar.appendChild(statChip("Short days", m.short, null, m.short ? "stat-chip-bad" : ""));
    if (m.worst && m.worst.gap < 0) bar.appendChild(statChip("Biggest gap", `${fmtGap(m.worst.gap)} · ${shortDM(m.worst.date)}`, null, "stat-chip-bad"));
    if (m.peak && m.peak.demand) bar.appendChild(statChip("Peak demand", `${m.peak.demand} · ${shortDM(m.peak.date)}`));
    return;
  }
  if (isHostList()) {
    // the directory is still in flight on the very first paint of this tab —
    // the chips then describe the host records alone and correct themselves on
    // the redraw that follows the fetch
    const rows = allHostRows();
    const withLoc = rows.filter(r => r.location || r.mapUrl).length;
    const staffed = rows.filter(r => r.inspectors.length).length;
    bar.appendChild(statChip("Hosts", rows.length));
    bar.appendChild(statChip("With location", withLoc));
    bar.appendChild(statChip("No location", rows.length - withLoc));
    bar.appendChild(statChip("Ever staffed", staffed));
    return;
  }
  const s = boardStats(D().activeBoardId);
  const chips = [
    ["Total", s.total], ["Assigned", s.assigned], ["Leave", s.leave],
    ["Standby", s.standby],
  ];
  if (s.isHoliday) chips.push(["Holiday", s.onHoliday]);
  chips.push(["On-call free", s.oncallAvailable]);
  for (const [label, n] of chips) bar.appendChild(statChip(label, n));
  bar.appendChild(statChip("Day", s.dayMissions));
  bar.appendChild(statChip("Night", s.nightMissions, null, "stat-chip-night"));
  // per-service-area counts, right after the chips above in the same row
  for (const a of D().areas) {
    const n = boardEmployees(D().activeBoardId).filter(e => e.areaId === a.id && hasJoined(e)).length;
    if (n) areaBar.appendChild(statChip(a.name, n));
  }
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
  const w = Math.max(520, Math.round(wrap.clientWidth) || 720);
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

/* Comparison table with an inline bar in every numeric cell — the Overview's
   answer to "this has to stay readable at 6+ boards". A per-board line of text
   ("Non-Rayong 103 · Rayong 2") stops working past two or three; rows grow
   forever. It also doubles as the table view the colour palette owes us: every
   value is printed as a number, so nothing is encoded by colour alone.

   `rows`: [{ key, label, color, sub, onClick, isTotal, values: {colKey: number} }]
     `isTotal: true` marks the all-boards summary row: it prints numbers only
     (no bars) and is excluded from the per-column max, since a total is always
     the largest value and would otherwise squash every real row's bar.
   `cols`: [{ key, label, meter, plain, warn }] —
     `meter: true`  scales the bar 0–100 (a ratio against a fixed limit, e.g.
                    utilization %) and appends "%";
     `plain: true`  prints the number with no bar. For an exception COUNT, a
                    bar scaled to the column max is actively misleading — one
                    board with 1 unstaffed mission would draw a full-width bar
                    just for being the worst of a tiny set;
     `warn: true`   tints a non-zero value with the warning status colour (and
                    keeps the number, so it is never colour-alone).
   Otherwise the bar is scaled against the largest value in that column. */
function ovCompareTable({ rows, cols }) {
  const wrap = document.createElement("div");
  wrap.className = "ov-table-wrap";
  const table = document.createElement("table");
  table.className = "ov-table";
  const maxOf = {};
  const scaleRows = rows.filter(r => !r.isTotal);
  // a c.render column supplies its own cell (see below) and isn't a plain
  // number in r.values, so it has no column max to compute
  for (const c of cols) if (!c.render) maxOf[c.key] = Math.max(1, ...scaleRows.map(r => r.values[c.key] || 0));

  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  htr.appendChild(Object.assign(document.createElement("th"), { textContent: cols.nameLabel || "" }));
  for (const c of cols) {
    const th = document.createElement("th");
    th.className = "ov-table-numhead";
    // share a fixed 60% of the table between the numeric columns however many
    // there are, so the name column stays ~40% whether a table has two metric
    // columns or five — otherwise two columns get shoved to the far right.
    th.style.width = (60 / cols.length).toFixed(1) + "%";
    th.textContent = c.label;
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    if (r.isTotal) tr.className = "ov-table-totalrow";
    const nameTd = document.createElement("td");
    nameTd.className = "ov-table-name";
    // the dot+label live in an inner flex box rather than making the <td>
    // itself display:flex — a flex td drops out of table-cell layout and its
    // row border no longer lines up with the numeric cells' borders
    const nameInner = document.createElement("div");
    nameInner.className = "ov-table-nameinner";
    if (!r.isTotal) {          // the summary row is every board at once — no single colour identifies it
      const dot = document.createElement("span");
      dot.className = "ov-table-dot";
      dot.style.background = r.color;
      nameInner.appendChild(dot);
    }
    const nameText = document.createElement("span");
    nameText.className = "ov-table-label";
    nameText.textContent = r.label;   // board/engineer names are user data — textContent, never innerHTML
    if (r.sub) {
      const sub = document.createElement("small");
      sub.textContent = r.sub;
      nameText.appendChild(sub);
    }
    nameInner.appendChild(nameText);
    nameTd.appendChild(nameInner);
    if (r.onClick) {
      nameTd.classList.add("clickable");
      nameTd.title = `Open ${r.label}`;
      nameTd.onclick = r.onClick;
    }
    tr.appendChild(nameTd);

    for (const c of cols) {
      const td = document.createElement("td");
      td.className = "ov-table-num";
      if (c.render) {
        td.appendChild(c.render(r));
        tr.appendChild(td);
        continue;
      }
      const v = r.values[c.key] || 0;
      const cell = document.createElement("div");
      const noBar = c.plain || r.isTotal;
      cell.className = "ov-cell" + (noBar ? " plain" : "");
      if (!noBar) {
        const pct = c.meter ? Math.max(0, Math.min(100, v)) : (v / maxOf[c.key]) * 100;
        const track = document.createElement("div");
        track.className = "ov-cell-bar" + (c.meter ? " meter" : "");
        const fill = document.createElement("i");
        fill.style.width = pct.toFixed(1) + "%";
        // one colour per row entity, never per rank — filtering or re-sorting
        // must never repaint a row (see the dataviz "colour follows the entity" rule)
        fill.style.background = r.color;
        track.appendChild(fill);
        cell.appendChild(track);
      }
      const num = document.createElement("span");
      num.className = "ov-cell-val" + (c.warn && v > 0 ? " warn" : "");
      num.textContent = c.meter ? v + "%" : String(v);
      cell.appendChild(num);
      td.appendChild(cell);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/* "By board" table's Contract mix column: a permanent/on-call stacked bar plus
   the exact count and share on each side. The total row prints the same text
   with no bar — a bar for "every board combined" would just be full-width by
   definition, same reasoning as ovCompareTable's own noBar-for-isTotal rule. */
function contractMixCell(perm, oncall, isTotal) {
  const total = perm + oncall;
  const pctPerm = total ? Math.round((perm / total) * 100) : 0;
  const pctOncall = total ? 100 - pctPerm : 0;
  const wrap = document.createElement("div");
  wrap.className = "ov-cell" + (isTotal ? " plain" : "");
  if (!isTotal) {
    const bar = document.createElement("div");
    bar.className = "ov-mix-bar";
    bar.innerHTML = Charts.stackedBarH({
      segments: [
        { label: "Permanent", value: perm, color: "var(--chart-permanent)" },
        { label: "On-call", value: oncall, color: "var(--chart-oncall)" },
      ],
      height: 12,
    });
    wrap.appendChild(bar);
  }
  const label = document.createElement("span");
  label.className = "ov-cell-val ov-mix-label" + (isTotal ? "" : "");
  label.textContent = `${perm} (${pctPerm}%) / ${oncall} (${pctOncall}%)`;
  wrap.appendChild(label);
  return wrap;
}

/* "By service area"'s pattern, generalised for a table column: bar length ~
   total value, comparable across rows via a shared `scaleMax` (same
   convention ovCompareTable's own plain numeric columns use — the column's
   own max, computed by the caller since a custom `render` column bypasses
   ovCompareTable's built-in maxOf pass). Segments split permanent/on-call;
   the printed number is the plain TOTAL only — the per-type count and share
   live in the bar's hover tooltip (Charts.stackedBarH already wires
   data-tip-* into the shared #chart-tip panel), not as always-on text, so a
   dense table doesn't repeat the same split as text in every row. */
function splitCell(perm, oncall, scaleMax, isTotal, decimals) {
  const total = perm + oncall;
  const wrap = document.createElement("div");
  wrap.className = "ov-cell" + (isTotal ? " plain" : "");
  if (!isTotal) {
    const bar = document.createElement("div");
    bar.className = "ov-cell-bar";
    bar.innerHTML = Charts.stackedBarH({
      segments: [
        { label: "Permanent", value: perm, color: "var(--chart-permanent)" },
        { label: "On-call", value: oncall, color: "var(--chart-oncall)" },
      ],
      scaleMax, height: 8,
    });
    wrap.appendChild(bar);
  }
  const val = document.createElement("span");
  val.className = "ov-cell-val";
  val.textContent = decimals ? total.toFixed(decimals) : String(Math.round(total));
  wrap.appendChild(val);
  return wrap;
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
  const k = Math.min(7, Math.floor(vals.length / 2));
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  return { delta: Math.round(avg(vals.slice(-k)) - avg(vals.slice(-2 * k, -k))), k };
}


/* "" = every board summed. A board id that no longer exists (deleted in
   another tab mid-session) falls back to all boards rather than an empty
   chart. */
function historyBoardsInScope(boards) {
  const pick = state.overview.historyBoardId;
  if (!pick) return boards;
  const one = boards.filter(b => b.id === pick);
  return one.length ? one : boards;
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

  const sel = document.createElement("select");
  sel.className = "ov-history-board";
  sel.setAttribute("aria-label", "History board scope");
  const all = document.createElement("option");
  all.value = ""; all.textContent = "All boards";
  sel.appendChild(all);
  for (const b of D().boards) {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.name;      // board names are user data — textContent, never innerHTML
    sel.appendChild(opt);
  }
  sel.value = ov.historyBoardId;
  // no cache reset: ensureHistoryLoaded always fetches every board for the
  // range, so narrowing the scope is a redraw, not a round trip
  sel.onchange = () => { ov.historyBoardId = sel.value; render(); };
  wrap.appendChild(sel);

  // Utilization is a % (0-100), not a headcount — it can't share an axis with
  // the other six measures without either one becoming unreadable, so it's a
  // MODE switch rather than a seventh toggleable legend entry: on, the chart
  // is one Utilization line; off, it's back to the deployment measures.
  const utilBtn = document.createElement("button");
  utilBtn.type = "button";
  utilBtn.className = "btn btn-small ov-history-util-toggle" + (ov.historyShowUtil ? " active" : "");
  utilBtn.textContent = "% Utilization";
  utilBtn.title = ov.historyShowUtil ? "Back to deployment measures" : "Show utilization instead of headcounts";
  utilBtn.onclick = () => { ov.historyShowUtil = !ov.historyShowUtil; render(); };
  wrap.appendChild(utilBtn);
  return wrap;
}

/* Caption naming the window actually plotted, shared by both sections. */
function historyRangeCaption(dates) {
  const ov = state.overview;
  const span = `${fmtDate(ov.historyFrom)} → ${fmtDate(ov.historyTo)}`;
  const scope = ov.historyBoardId
    ? (D().boards.find(b => b.id === ov.historyBoardId) || {}).name || "one board"
    : "all boards";
  return `${span} · ${dates.length} working day${dates.length === 1 ? "" : "s"} · ${scope}`;
}

/* ---------- History chart (measures + colours: HISTORY_MEASURES, top of file) ---------- */
function historySection(dates, recs, pendingCharts) {
  const ov = state.overview;
  const sec = document.createElement("section");
  sec.className = "ov-section";
  const head = document.createElement("div");
  head.className = "ov-trend-head";
  const introText = ov.historyShowUtil
    ? `Daily utilization over a chosen range. ${escapeHtml(historyRangeCaption(dates))}. Weekends and holidays are left off the axis and out of the average.`
    : `Daily deployment over a chosen range. ${escapeHtml(historyRangeCaption(dates))}. Weekends and holidays are left off the axis and out of the averages.`;
  head.innerHTML = `<div class="ov-trend-intro"><h3>History</h3><p class="ov-section-sub">${introText}</p></div>`;
  head.appendChild(historyControls());
  sec.appendChild(head);

  const wrap = document.createElement("div");
  wrap.className = "ov-trend-chart";
  sec.appendChild(wrap);

  if (!dates.length) {
    wrap.innerHTML = `<p class="import-note">No working days in this range — every date was a weekend or a holiday.</p>`;
    return sec;
  }

  if (ov.historyShowUtil) {
    // Single fixed line, not a legend-toggleable measure — utilizationPct's
    // own free-on-call exclusion already lives inside trendMetricValue, so
    // this is the exact same number the KPI tile and By-board table show for
    // any date in range, just plotted across the whole window.
    const values = recs.map(r => (r ? trendMetricValue("util", r) : null));
    const mean = historyMean(values);
    pendingCharts.push(() => fillLineChart(wrap, {
      series: [{ key: "util", label: "Utilization", color: "var(--chart-assigned)", visible: true,
                 points: values.map(y => ({ y, suffix: "%" })) }],
      xLabels: dates.map(shortDateLabel), yMax: 100, height: 240,
      refLines: mean != null ? [{ y: mean, color: "var(--chart-assigned)", label: "avg" }] : [],
      emptyLabel: "No data in this range",
    }));
    const utilAvgs = document.createElement("div");
    utilAvgs.className = "ov-history-avgs";
    utilAvgs.appendChild(Object.assign(document.createElement("span"),
      { className: "ov-history-avgs-label", textContent: "Daily average" }));
    utilAvgs.appendChild(statChip("Utilization", mean == null ? "—" : mean + "%", "var(--chart-assigned)"));
    sec.appendChild(utilAvgs);
    return sec;
  }

  const visibleMeasures = HISTORY_MEASURES.filter(m => !ov.historyHidden.has(m.key));
  const valuesOf = (m) => recs.map(r => (r ? m.value(r) : null));
  const series = HISTORY_MEASURES.map(m => ({
    key: m.key, label: m.label, color: m.color,
    visible: !ov.historyHidden.has(m.key),
    points: valuesOf(m).map(y => ({ y })),
  }));
  const yMax = Charts.niceMax(series.filter(s => s.visible).flatMap(s => s.points.map(p => p.y)));
  // A dashed mean rule only when ONE measure is on screen: with four lines up,
  // four dashed rules is another four lines to read. The chips below carry
  // every visible measure's average either way.
  const refLines = visibleMeasures.length === 1
    ? [{ y: historyMean(valuesOf(visibleMeasures[0])), color: visibleMeasures[0].color, label: "avg" }]
    : [];
  pendingCharts.push(() => fillLineChart(wrap, {
    series, xLabels: dates.map(shortDateLabel), yMax, height: 240, refLines,
    emptyLabel: "No measures selected — click a legend entry to show one",
  }));

  sec.appendChild(Charts.legendEl(
    HISTORY_MEASURES.map(m => ({ key: m.key, label: m.label, color: m.color, muted: ov.historyHidden.has(m.key) })),
    (key) => {
      ov.historyHidden.has(key) ? ov.historyHidden.delete(key) : ov.historyHidden.add(key);
      render();
    }
  ));

  const avgs = document.createElement("div");
  avgs.className = "ov-history-avgs";
  avgs.appendChild(Object.assign(document.createElement("span"),
    { className: "ov-history-avgs-label", textContent: "Daily average" }));
  for (const m of visibleMeasures) {
    const mean = historyMean(valuesOf(m));
    avgs.appendChild(statChip(m.label, mean == null ? "—" : mean, m.color));
  }
  if (visibleMeasures.length) sec.appendChild(avgs);
  return sec;
}

/* ---------- Engineer workload chart ----------
   Deliberately its OWN chart rather than more series on History above: the
   question is different (how load is spread BETWEEN people, not how the
   operation moved as a whole), and merging them would put six org measures
   and every engineer on one axis. It shares History's range control and
   History's single fetch, so the two still read as one block.
   This is also the only genuinely historical breakdown on the page: an
   engineer_id lives on the mission row for its own date, so these are the
   people who actually ran those jobs — unlike headcount, which
   getUtilizationRange can only reconstruct from today's board membership. */
const ENG_METRICS = { missions: "Missions", crew: "Crew deployed" };
function engineerHistorySection(dates, recs, pendingCharts) {
  const ov = state.overview;
  const sec = document.createElement("section");
  sec.className = "ov-section";
  const head = document.createElement("div");
  head.className = "ov-trend-head";
  head.innerHTML = `<div class="ov-trend-intro"><h3>Engineer workload</h3>` +
    `<p class="ov-section-sub">Same range as History above. A mission counts on the day it ran, ` +
    `for the engineer it was assigned to at the time.</p></div>`;
  const metricBtns = document.createElement("div");
  metricBtns.className = "ov-trend-btns";
  for (const key of Object.keys(ENG_METRICS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-small" + (ov.engMetric === key ? " active" : "");
    btn.textContent = ENG_METRICS[key];
    btn.onclick = () => { if (ov.engMetric === key) return; ov.engMetric = key; render(); };
    metricBtns.appendChild(btn);
  }
  head.appendChild(metricBtns);
  sec.appendChild(head);

  // every engineer gets a line, including a flat zero — "who was free all
  // month" is the other half of "who was loaded". The no-engineer entry
  // appears only if some staffed mission in the range genuinely had none.
  const entities = D().engineers.map(e => ({ id: e.id, label: e.name, color: e.color }));
  if (recs.some(r => r && r.byEngineer[""])) {
    entities.push({ id: "", label: "— no engineer set —", color: "var(--muted)" });
  }
  if (!entities.length) {
    sec.appendChild(Object.assign(document.createElement("p"),
      { className: "import-note", textContent: "No engineers defined yet — add them under Settings." }));
    return sec;
  }

  const wrap = document.createElement("div");
  wrap.className = "ov-trend-chart";
  sec.appendChild(wrap);
  if (!dates.length) {
    wrap.innerHTML = `<p class="import-note">No working days in this range — every date was a weekend or a holiday.</p>`;
    return sec;
  }

  // one pass: per-engineer daily series for the chart, and the totals the
  // summary table needs, rather than walking `recs` once per column
  const daily = {};      // engineer id -> number[] aligned to `dates`
  const totals = {};     // engineer id -> {missions, crew, permCrew, oncallCrew, activeDays, peak, peakDate}
  for (const ent of entities) {
    daily[ent.id] = [];
    totals[ent.id] = { missions: 0, crew: 0, permCrew: 0, oncallCrew: 0, activeDays: 0, peak: 0, peakDate: null };
  }
  dates.forEach((d, i) => {
    for (const ent of entities) {
      const rec = recs[i];
      const v = (rec && rec.byEngineer[ent.id]) || { missions: 0, crew: 0, permCrew: 0, oncallCrew: 0 };
      daily[ent.id].push(rec ? v[ov.engMetric] : null);
      const t = totals[ent.id];
      t.missions += v.missions;
      t.crew += v.crew;
      t.permCrew += v.permCrew || 0;
      t.oncallCrew += v.oncallCrew || 0;
      if (v.missions > 0) t.activeDays++;
      if (v.missions > t.peak) { t.peak = v.missions; t.peakDate = d; }
    }
  });

  const series = entities.map(ent => ({
    key: ent.id, label: ent.label, color: ent.color,
    visible: !ov.engHidden.has(ent.id),
    points: daily[ent.id].map(y => ({ y })),
  }));
  const yMax = Charts.niceMax(series.filter(s => s.visible).flatMap(s => s.points.map(p => p.y)));
  pendingCharts.push(() => fillLineChart(wrap, {
    series, xLabels: dates.map(shortDateLabel), yMax, height: 240,
    emptyLabel: "No engineers selected — click a legend entry to show one",
  }));
  sec.appendChild(Charts.legendEl(
    entities.map(ent => ({ key: ent.id, label: ent.label, color: ent.color, muted: ov.engHidden.has(ent.id) })),
    (key) => {
      ov.engHidden.has(key) ? ov.engHidden.delete(key) : ov.engHidden.add(key);
      render();
    }
  ));

  /* Summary table. Averages alone rank people; the other three columns say
     what the ranking is made of — crew/mission separates "many small jobs"
     from "a few big ones" (two engineers on the same mission count can be
     carrying very different loads), active days separates steady from
     spiky, and share is the load-balance read. */
  const n = dates.length;
  const grandMissions = Object.values(totals).reduce((a, t) => a + t.missions, 0);
  const round1 = (x) => Math.round(x * 10) / 10;
  const engRows = entities.map(ent => {
    const t = totals[ent.id];
    return {
      key: ent.id, label: ent.label, color: ent.color,
      sub: t.peakDate ? `peak ${t.peak} mission${t.peak === 1 ? "" : "s"} on ${shortDateLabel(t.peakDate)}` : "no missions in range",
      values: {
        avgMissions: round1(t.missions / n),
        avgCrew: round1(t.crew / n),
        avgPermCrew: round1(t.permCrew / n),
        avgOncallCrew: round1(t.oncallCrew / n),
        crewPer: t.missions ? round1(t.crew / t.missions) : 0,
        activeDays: t.activeDays,
        share: grandMissions ? Math.round((t.missions / grandMissions) * 100) : 0,
      },
      _sort: t.missions,
    };
  });
  // shared scale for the Avg crew/day bar — computed BEFORE the total row is
  // pushed below, same convention ovCompareTable's own numeric columns use
  // (a total's bar would be full-width by definition, so it's excluded)
  const avgCrewMax = Math.max(1, ...engRows.map(r => r.values.avgCrew));
  engRows.sort((a, b) => b._sort - a._sort || b.values.avgCrew - a.values.avgCrew || a.label.localeCompare(b.label));
  const grandCrew = Object.values(totals).reduce((a, t) => a + t.crew, 0);
  const grandPermCrew = Object.values(totals).reduce((a, t) => a + t.permCrew, 0);
  const grandOncallCrew = Object.values(totals).reduce((a, t) => a + t.oncallCrew, 0);
  engRows.push({
    key: "__total__", label: "All engineers", isTotal: true,
    sub: `${n} working day${n === 1 ? "" : "s"}`,
    values: {
      avgMissions: round1(grandMissions / n),
      avgCrew: round1(grandCrew / n),
      avgPermCrew: round1(grandPermCrew / n),
      avgOncallCrew: round1(grandOncallCrew / n),
      crewPer: grandMissions ? round1(grandCrew / grandMissions) : 0,
      activeDays: dates.filter((d, i) => recs[i] && recs[i].staffedMissions > 0).length,
      share: grandMissions ? 100 : 0,
    },
  });
  sec.appendChild(ovCompareTable({
    cols: Object.assign([
      { key: "avgMissions", label: "Avg missions/day" },
      // Permanent/on-call split, not a bare average: two engineers with the
      // same crew/day can be leaning on very different mixes of their own
      // people vs. surge on-call. Bar length ~ avg crew (comparable across
      // engineers, same convention "By service area" uses below); the count
      // and share per type live in the bar's hover tooltip rather than as
      // always-on text, so this stays a glanceable table, not a denser one.
      { key: "avgCrew", label: "Avg crew/day", render: (r) => splitCell(r.values.avgPermCrew, r.values.avgOncallCrew, avgCrewMax, r.isTotal, 1) },
      { key: "crewPer", label: "Crew / mission" },
      // a count, not a rate: a bar scaled to the column max would draw the
      // busiest engineer full-width whatever the real numbers were
      { key: "activeDays", label: "Active days", plain: true },
      { key: "share", label: "Share", meter: true },
    ], { nameLabel: "Engineer" }),
    rows: engRows,
  }));
  return sec;
}

function renderOverview() {
  const panel = $("#overview-panel");
  panel.innerHTML = "";
  const boards = D().boards;
  if (!boards.length) {
    panel.innerHTML = '<p class="import-note">Create a board (+ Board, top left) to see the Overview dashboard.</p>';
    return;
  }
  const stats = Object.fromEntries(boards.map(b => [b.id, boardStats(b.id)]));
  const boardColor = (i) => Charts.catColor(i);
  // charts that need their container's real width are drawn after the whole
  // panel is in the document (see fillLineChart)
  const pendingCharts = [];
  const makeMini = (emp, b) => {
    const area = D().areas.find(a => a.id === emp.areaId);
    const mini = document.createElement("span");
    // same identity rule as the board cards: white = permanent, grey dashed = on-call
    mini.className = "ov-mini" + (emp.contract === "oncall" ? " oncall" : "");
    mini.textContent = area ? `${emp.name} · ${area.name}` : emp.name;
    mini.title = `${emp.contract === "oncall" ? "On-call" : "Permanent"} • ${area ? area.name : "?"} — click to open ${b.name}`;
    mini.onclick = () => { D().activeBoardId = b.id; refreshAndRender(); };
    return mini;
  };

  // roster for the date on screen — boardStats() is already roster-filtered, so
  // these global totals have to use the same set or the KPI strip, the By board
  // table and every utilization denominator disagree by however many people are
  // currently deactivated. (Past dates keep everyone; see onRoster().)
  const rosterAll = D().employees.filter(onRoster);
  const totalEmp = rosterAll.length;
  const totalAssigned = boards.reduce((s, b) => s + stats[b.id].assigned, 0);
  const totalLeave = boards.reduce((s, b) => s + stats[b.id].leave, 0);
  const totalStandby = boards.reduce((s, b) => s + stats[b.id].standby, 0);
  const totalOnHoliday = boards.reduce((s, b) => s + stats[b.id].onHoliday, 0);
  const totalOncallFree = boards.reduce((s, b) => s + stats[b.id].oncallAvailable, 0);
  const totalMissions = boards.reduce((s, b) => s + stats[b.id].missions, 0);
  const totalPerm = rosterAll.filter(e => e.contract === "permanent").length;
  const totalOncall = totalEmp - totalPerm;
  const overallUtil = utilizationPct(totalAssigned, totalEmp, totalLeave, totalOnHoliday, totalOncallFree);
  const totalDayCrew = boards.reduce((s, b) => s + stats[b.id].dayMissions, 0);     // headcount, not mission count — see boardStats
  const totalNightCrew = boards.reduce((s, b) => s + stats[b.id].nightMissions, 0);

  // today's missions, read straight from the plan cache (no extra query) —
  // used by the KPI strip, the status bar's shift chips, Day/night split and
  // Host coverage risk below.
  const todaysMissions = boards.flatMap(b => peekPlan(b.id).missions.filter(m => !m.hidden));
  const todaysDayCount = todaysMissions.filter(m => m.shift !== "night").length;
  const todaysNightCount = todaysMissions.filter(m => m.shift === "night").length;
  const todaysHosts = [...new Set(todaysMissions.map(m => m.host))];
  const todaysEngineers = new Set(todaysMissions.filter(m => m.engineerId).map(m => m.engineerId));

  /* ---------- trend data for the KPI tile's sparkline ----------
     Ends on state.date, not real-world "today" — the KPI headline above it
     and every other number on this page (By board, Action queue, ...) are
     already state.date's numbers, so anchoring the sparkline to a DIFFERENT
     date (real today) would make it silently describe a different timeline
     the moment someone browsed to another day. One date for the whole page. */
  const util = state.overview.util || {};
  const toDate = state.date;
  const fromDate = addDays(toDate, -(state.overview.trendRange - 1));
  // A date nobody works — every board's weekend or a shared holiday — is left
  // OUT of the x-axis entirely, so the line runs straight from Friday to Monday
  // instead of leaving a weekly hole that carries no information. A date where
  // at least one board works stays on the axis: that board plots its point and
  // the boards that are off gap individually (their y is null below), which is
  // real information — one site working while another is closed.
  const xDates = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
    if (boards.every(b => isNonWorkingDate(d, b.id))) continue;
    xDates.push(d);
  }
  const noWorkingDays = !xDates.length;
  const utilSpark = xDates.map(d => aggregateMetricPoint("util", d, boards, util));
  const utilDelta = trendWindowDelta(utilSpark);

  /* ---------- 1. status bar: the verdict, before any number ----------
     Amber + "needs attention" only when someone is actually idle; otherwise a
     calm confirmation, same tone as the tick empty-state elsewhere on this page. */
  const statusBar = document.createElement("div");
  statusBar.className = "ov-status-bar";
  statusBar.style.borderLeftColor = totalStandby ? "var(--warn)" : "var(--ok-text)";
  const statusMain = document.createElement("div");
  statusMain.className = "ov-status-main";
  const statusHeading = document.createElement("div");
  statusHeading.className = "ov-status-heading";
  statusHeading.innerHTML = `<span class="ov-status-title">${totalStandby ? "Needs attention today" : "All permanent staff assigned"}</span>` +
    `<span class="ov-status-date">${fmtDow(state.date)} ${fmtDate(state.date)} · ${boards.length} board${boards.length === 1 ? "" : "s"}</span>`;
  statusMain.appendChild(statusHeading);
  const statusLine = document.createElement("div");
  statusLine.className = "ov-status-line";
  statusLine.innerHTML = totalStandby
    ? `<b>${totalStandby} permanent staff idle</b> · ${totalOncallFree} on-call available (normal)`
    : `${totalOncallFree} on-call available (normal)`;
  statusMain.appendChild(statusLine);
  statusBar.appendChild(statusMain);
  const statusShifts = document.createElement("div");
  statusShifts.className = "ov-status-shifts";
  statusShifts.appendChild(statChip("Day", todaysDayCount));
  statusShifts.appendChild(statChip("Night", todaysNightCount, null, "stat-chip-night"));
  statusBar.appendChild(statusShifts);
  if (can("ov.status")) panel.appendChild(statusBar);

  /* ---------- 2. KPI strip: four numbers, each with something to judge it
     against — a sparkline+delta, a segmented bar, or a plain breakdown line.
     A bare "89%" can't be read as good or bad; the 14 days behind it are
     already fetched for the Trend chart below, so spending a few of those
     pixels on a sparkline is free. ---------- */
  const kpiRow = document.createElement("div");
  kpiRow.className = "ov-kpi-row";

  // tile 1: overall utilization
  const utilTile = document.createElement("div");
  utilTile.className = "ov-kpi-tile";
  utilTile.innerHTML = `
    <div class="ov-kpi-head">
      <div><div class="ov-kpi-value">${overallUtil}%</div><div class="ov-kpi-label">Overall utilization</div></div>
    </div>
    <div class="ov-kpi-breakdown"></div>`;
  if (!noWorkingDays && utilSpark.some(v => v != null)) {
    utilTile.querySelector(".ov-kpi-head").appendChild(
      Object.assign(document.createElement("div"), { innerHTML: Charts.sparkline({ points: utilSpark }) }).firstChild);
  }
  const utilSubEl = utilTile.querySelector(".ov-kpi-breakdown");
  if (utilDelta) {
    const dir = utilDelta.delta > 0 ? "up" : utilDelta.delta < 0 ? "down" : "";
    const arrow = utilDelta.delta > 0 ? "▲" : utilDelta.delta < 0 ? "▼" : "▬";
    utilSubEl.innerHTML = `<b class="${dir}">${arrow} ${Math.abs(utilDelta.delta)} pt${Math.abs(utilDelta.delta) === 1 ? "" : "s"}</b> vs the previous ${utilDelta.k} days · ${state.overview.trendRange}-day trend`;
  } else {
    utilSubEl.textContent = "assigned ÷ (headcount − leave − holiday − free on-call)";
  }
  kpiRow.appendChild(utilTile);

  // tile 2: deployed on a mission — segmented by what's keeping the rest away
  const deployTile = document.createElement("div");
  deployTile.className = "ov-kpi-tile";
  const deploySegs = [
    { label: "Deployed", value: totalAssigned, color: "var(--chart-assigned)" },
    { label: "Leave", value: totalLeave, color: "var(--chart-leave)" },
    { label: "Idle", value: totalStandby, color: "var(--chart-standby)" },
  ];
  if (totalOnHoliday) deploySegs.push({ label: "Holiday", value: totalOnHoliday, color: "var(--chart-holiday)" });
  deploySegs.push({ label: "On-call free", value: totalOncallFree, color: "var(--muted)" });
  const deploySubParts = [`${totalAssigned} deployed`, `${totalLeave} leave`, `${totalStandby} idle`];
  if (totalOnHoliday) deploySubParts.push(`${totalOnHoliday} holiday`);
  deploySubParts.push(`${totalOncallFree} on-call free`);
  deployTile.innerHTML = `
    <div class="ov-kpi-value">${totalAssigned}<span class="ov-kpi-value-sub"> / ${totalEmp}</span></div>
    <div class="ov-kpi-label">Deployed on a mission</div>
    <div class="ov-kpi-mixbar"></div>
    <div class="ov-kpi-breakdown">${escapeHtml(deploySubParts.join(" · "))}</div>`;
  deployTile.querySelector(".ov-kpi-mixbar").innerHTML = Charts.stackedBarH({ segments: deploySegs, height: 8 });
  kpiRow.appendChild(deployTile);

  // tile 3: missions today — no unstaffed callout here (see Action queue note below)
  const missionsTile = document.createElement("div");
  missionsTile.className = "ov-kpi-tile";
  missionsTile.innerHTML = `
    <div class="ov-kpi-value">${totalMissions}</div>
    <div class="ov-kpi-label">Missions today</div>
    <div class="ov-kpi-breakdown">${todaysDayCount} day · ${todaysNightCount} night · ${todaysHosts.length} host${todaysHosts.length === 1 ? "" : "s"} · ${todaysEngineers.size} engineer${todaysEngineers.size === 1 ? "" : "s"}</div>`;
  kpiRow.appendChild(missionsTile);

  // tile 4: on-call available — "not free" (deployed or on leave) vs free
  const oncallNotFree = Math.max(0, totalOncall - totalOncallFree);
  const oncallTile = document.createElement("div");
  oncallTile.className = "ov-kpi-tile";
  oncallTile.innerHTML = `
    <div class="ov-kpi-value">${totalOncallFree}</div>
    <div class="ov-kpi-label">On-call available</div>
    <div class="ov-kpi-meter">
      <div class="ov-kpi-meter-track"></div>
      <span class="ov-kpi-meter-val">${oncallNotFree}/${totalOncall} not free</span>
    </div>
    <div class="ov-kpi-breakdown">Surge capacity — uncalled is normal, not idle</div>`;
  oncallTile.querySelector(".ov-kpi-meter-track").innerHTML = Charts.stackedBarH({
    segments: [
      { label: "Not free", value: oncallNotFree, color: "var(--chart-oncall)" },
      { label: "Free", value: totalOncallFree, color: "var(--muted)" },
    ], height: 8,
  });
  kpiRow.appendChild(oncallTile);
  if (can("ov.kpi")) panel.appendChild(kpiRow);

  /* ---------- 3. action queue: permanent staff with no mission today. On-call
     free is surge capacity working as intended, not an exception — it stays
     calm and collapsed rather than sharing top billing with the amber box.
     Missions with no crew are NOT listed here on purpose: for this team an
     unstaffed mission is normal, not something the dashboard should flag. ---------- */
  const actionSec = ovSection("Action queue", "Permanent staff with no mission today. Click any chip to jump to their board.");
  if (totalStandby) {
    const box = document.createElement("div");
    box.className = "ov-avail";
    const idleSub = boards.filter(b => stats[b.id].standby)
      .map(b => `${b.name} ${stats[b.id].standby}`).join(" · ");
    box.innerHTML = `
      <div class="ov-avail-head">
        <span class="ov-avail-title">${icon("alert")}${totalStandby} permanent staff not assigned yet</span>
        <span class="ov-avail-sub">${escapeHtml(idleSub)}</span>
      </div>
      <div class="ov-avail-cards"></div>`;
    const cardsBox = box.querySelector(".ov-avail-cards");
    const idleAll = boards.flatMap(b => stats[b.id].availableList.map(emp => ({ emp, board: b })))
      .sort((a, b) => a.emp.name.localeCompare(b.emp.name));
    for (const { emp, board } of idleAll) cardsBox.appendChild(makeMini(emp, board));
    actionSec.appendChild(box);
  } else {
    actionSec.appendChild(Object.assign(document.createElement("p"),
      { className: "ov-avail ov-avail-ok", textContent: "Everyone permanent is placed on every board." }));
  }
  const oncallAll = boards.flatMap(b => stats[b.id].oncallAvailableList.map(emp => ({ emp, board: b })))
    .sort((a, b) => a.emp.name.localeCompare(b.emp.name));
  if (oncallAll.length) {
    const calmBox = document.createElement("div");
    calmBox.className = "ov-avail ov-avail-calm";
    const open = state.overview.oncallQueueOpen;
    calmBox.innerHTML = `
      <div class="ov-avail-calm-row">
        <span class="ov-avail-calm-text">${oncallAll.length} on-call staff available and not called — surge capacity, no action needed</span>
        <button type="button" class="ov-avail-toggle">${open ? "Hide ▴" : "Show ▾"}</button>
      </div>
      <div class="ov-avail-cards${open ? "" : " hidden"}"></div>`;
    calmBox.querySelector(".ov-avail-toggle").onclick = () => {
      state.overview.oncallQueueOpen = !state.overview.oncallQueueOpen;
      render();
    };
    if (open) {
      const cardsBox = calmBox.querySelector(".ov-avail-cards");
      for (const { emp, board } of oncallAll) cardsBox.appendChild(makeMini(emp, board));
    }
    actionSec.appendChild(calmBox);
  }
  if (can("ov.actionQueue")) panel.appendChild(actionSec);

  /* ---------- 4. by board: the per-board comparison, as rows not a sentence.
     Contract mix folded in as one column (was a donut per board plus an
     all-boards donut — 7 shapes saying what one column can); Idle replaces
     Leave/On-call-free, since those two now live in the KPI strip's bar and
     "idle" is the one board-level number that can actually need attention. ---------- */
  const boardSec = ovSection("By board", `${fmtDow(state.date)} ${fmtDate(state.date)} — click a board name to open it. Utilized = assigned ÷ (headcount − leave − holiday − free on-call).`);
  const boardRows = boards.map((b, i) => {
    const s = stats[b.id];
    return {
      key: b.id, label: b.name, color: boardColor(i),
      sub: s.isHoliday ? "holiday" : null,
      onClick: () => { D().activeBoardId = b.id; refreshAndRender(); },
      mixPerm: s.permanent, mixOncall: s.oncall,
      values: {
        util: utilizationPct(s.assigned, s.total, s.leave, s.onHoliday, s.oncallAvailable),
        missions: s.missions, total: s.total, assigned: s.assigned, idle: s.standby,
      },
    };
  });
  boardRows.push({
    key: "__total__", label: "All boards", isTotal: true,
    sub: `${boards.length} board${boards.length === 1 ? "" : "s"}`,
    mixPerm: totalPerm, mixOncall: totalOncall,
    values: { util: overallUtil, missions: totalMissions, total: totalEmp, assigned: totalAssigned, idle: totalStandby },
  });
  boardSec.appendChild(ovCompareTable({
    cols: Object.assign(
      [
        { key: "util", label: "Utilized", meter: true },
        { key: "missions", label: "Missions" },
        { key: "total", label: "Headcount" },
        { key: "assigned", label: "Assigned" },
        { key: "idle", label: "Idle", plain: true, warn: true },
        { key: "mix", label: "Contract mix", render: (r) => contractMixCell(r.mixPerm, r.mixOncall, r.isTotal) },
      ],
      { nameLabel: "Board" }
    ),
    rows: boardRows,
  }));
  if (can("ov.byBoard")) panel.appendChild(boardSec);

  /* ---------- day/night split (built here, masonry-packed near the bottom
     of this function — see layoutOverviewMasonry) ---------- */
  const daynightSec = ovSection("Day / night split", "Crew and missions by shift — the last thing to check before the night crew goes out.");
  if (!totalMissions) {
    daynightSec.appendChild(Object.assign(document.createElement("p"), { className: "import-note", textContent: "No missions today." }));
  } else {
    const totalCrew = totalDayCrew + totalNightCrew || 1;
    daynightSec.innerHTML += `
      <div class="ov-daynight-tiles">
        <div class="ov-daynight-tile">
          <div class="ov-daynight-num"><span class="num">${totalDayCrew}</span><span class="ov-shift-chip day">DAY</span></div>
          <div class="ov-daynight-sub">${todaysDayCount} mission${todaysDayCount === 1 ? "" : "s"} · ${Math.round(totalDayCrew / totalCrew * 100)}% of crew</div>
        </div>
        <div class="ov-daynight-tile">
          <div class="ov-daynight-num"><span class="num">${totalNightCrew}</span><span class="ov-shift-chip night">NIGHT</span></div>
          <div class="ov-daynight-sub">${todaysNightCount} mission${todaysNightCount === 1 ? "" : "s"} · ${Math.round(totalNightCrew / totalCrew * 100)}% of crew</div>
        </div>
      </div>
      <div class="ov-daynight-rows"></div>
      <div class="ov-daynight-legend"></div>`;
    const rowsWrap = daynightSec.querySelector(".ov-daynight-rows");
    boards.forEach((b, i) => {
      const s = stats[b.id];
      const row = document.createElement("div");
      row.className = "ov-daynight-row";
      row.innerHTML = `
        <span class="ov-daynight-row-label"><span class="ov-table-dot" style="background:${boardColor(i)}"></span>${escapeHtml(b.name)}</span>
        <div class="ov-daynight-row-bar"></div>
        <span class="ov-daynight-row-total">${s.dayMissions} / ${s.nightMissions}</span>`;
      row.querySelector(".ov-daynight-row-bar").innerHTML = Charts.stackedBarH({
        segments: [
          { label: "Day crew", value: s.dayMissions, color: "var(--chart-assigned)" },
          { label: "Night crew", value: s.nightMissions, color: "var(--night)" },
        ], height: 18,
      });
      rowsWrap.appendChild(row);
    });
    daynightSec.querySelector(".ov-daynight-legend").appendChild(Charts.legendEl([
      { key: "day", label: `Day crew (${totalDayCrew})`, color: "var(--chart-assigned)" },
      { key: "night", label: `Night crew (${totalNightCrew})`, color: "var(--night)" },
    ]));
  }

  /* ---------- host coverage risk (built here, masonry-packed near the
     bottom of this function — see layoutOverviewMasonry) ----------
     Only hosts with exactly 1 or 2 people ever deployed there are shown —
     a host nobody has been to yet, or one with a healthy bench (3+), isn't
     a risk worth a row here. */
  const hostRiskSec = ovSection("Host coverage risk", "Hosts only one or two people have ever worked. If that person is on leave, nobody on the roster knows the site.");
  const riskyHosts = todaysHosts.length
    ? todaysHosts
        .map(host => ({ host, ...(state.overview.hostCoverage || {})[host] || { count: 0, names: [] } }))
        .filter(r => r.count >= 1 && r.count <= 2)
        .sort((a, b) => a.count - b.count || a.host.localeCompare(b.host))
    : [];
  if (!todaysHosts.length) {
    hostRiskSec.appendChild(Object.assign(document.createElement("p"), { className: "import-note", textContent: "No missions today." }));
  } else if (!riskyHosts.length) {
    hostRiskSec.appendChild(Object.assign(document.createElement("p"),
      { className: "ov-avail ov-avail-ok", textContent: "No thin coverage today — every host on today's missions has 3+ people who've worked it before, or no history yet to worry about." }));
  } else {
    // "people ever" is said once, in the header, instead of on all six rows
    const head = document.createElement("div");
    head.className = "ov-hostrisk-head";
    head.innerHTML = `<span></span><span>Host</span><span class="r">People</span><span class="r">Inspectors</span>`;
    hostRiskSec.appendChild(head);

    const rowsWrap = document.createElement("div");
    rowsWrap.className = "ov-hostrisk-rows";
    for (const r of riskyHosts) {
      const row = document.createElement("div");
      // Only a host with a SINGLE trained inspector is the emergency — that is
      // the one nobody can cover if they take leave. Two is thin, not urgent.
      row.className = "ov-hostrisk-row" + (r.count === 1 ? " risk" : "");
      const who = r.names.join(", ") + (r.count > r.names.length ? ` +${r.count - r.names.length}` : "");
      row.innerHTML = `
        <span class="ov-hostrisk-rail" aria-hidden="true"></span>
        <span class="ov-hostrisk-name">${escapeHtml(r.host)}</span>
        <span class="ov-hostrisk-count">${r.count}</span>
        <span class="ov-hostrisk-who">${escapeHtml(who)}</span>`;
      rowsWrap.appendChild(row);
    }
    hostRiskSec.appendChild(rowsWrap);
    hostRiskSec.appendChild(Object.assign(document.createElement("p"), {
      className: "ov-hostrisk-note",
      innerHTML: "Built from <b>deployment_history</b> — the same rows behind the Host Record tab, counted by host instead of by employee.",
    }));
  }
  // daynightSec and hostRiskSec are appended further down — see the bottom
  // of this function.

  /* ---------- 5. History + Engineer workload ----------
     Both read one fetch (state.overview.history) over one user-chosen range,
     computed here once and handed to both so the day records aren't summed
     twice. Wrapped in one .ov-history-group with no gap between them (see
     styles.css) so the two read as a single connected block — they already
     share this one range/board control, rendered once in History's header. */
  // Built only when it is going to be shown: refreshData skips the range fetch
  // for a role without ov.history, so state.overview.history would be stale or
  // empty here anyway.
  if (can("ov.history")) {
    resolveHistoryRange();   // idempotent; ensureHistoryLoaded skips it when there are no boards
    const histBoards = historyBoardsInScope(boards);
    const histDates = historyDates(histBoards);
    const histRecs = histDates.map(d => historyDayRec(d, histBoards, state.overview.history || {}));
    const historyGroup = document.createElement("div");
    historyGroup.className = "ov-history-group";
    historyGroup.appendChild(historySection(histDates, histRecs, pendingCharts));
    historyGroup.appendChild(engineerHistorySection(histDates, histRecs, pendingCharts));
    panel.appendChild(historyGroup);
  }

  /* ---------- 6. by engineer (first of six cards masonry-packed further
     down — see layoutOverviewMasonry) ----------
     By engineer: workload per responsible engineer, across all boards.
     Missions carry an engineerId, so this is the one view that answers "who is
     carrying how much today" — the board sections all slice by board instead.
     Crew counts only members who still belong to the board the mission is on,
     the same rule boardStats/renderMissions use, so a stale membership never
     inflates the number. */
  const engSec = ovSection("By engineer",
    `Missions each engineer is responsible for on ${fmtDow(state.date)} ${fmtDate(state.date)}, and how many people are deployed under them — across all boards`);
  const engLoad = new Map();   // engineerId (or "" = unassigned) -> {missions, crew, permCrew, oncallCrew, boards:Set}
  const bump = (id, crewEmps, boardName) => {
    const rec = engLoad.get(id) || { missions: 0, crew: 0, permCrew: 0, oncallCrew: 0, boards: new Set() };
    rec.missions += 1;
    rec.crew += crewEmps.length;
    for (const e of crewEmps) { if (e.contract === "oncall") rec.oncallCrew++; else rec.permCrew++; }
    rec.boards.add(boardName);
    engLoad.set(id, rec);
  };
  for (const b of boards) {
    const empById = new Map(boardEmployees(b.id).map(e => [e.id, e]));
    for (const m of peekPlan(b.id).missions) {
      if (m.hidden) continue;
      bump(m.engineerId || "", m.members.map(id => empById.get(id)).filter(Boolean), b.name);
    }
  }
  // every engineer gets a row (a zero tells you who is free today, which is the
  // other half of "who is loaded"); an "unassigned" row appears only if some
  // mission genuinely has no engineer on it.
  // naming every board stops fitting once an engineer covers 4+ of them —
  // past three, the count is the useful part
  const boardsSub = (set) => set.size > 3 ? `${set.size} boards` : [...set].join(" · ");
  const engRows = D().engineers.map(e => {
    const rec = engLoad.get(e.id) || { missions: 0, crew: 0, permCrew: 0, oncallCrew: 0, boards: new Set() };
    return {
      key: e.id, label: e.name, color: e.color,
      sub: rec.boards.size ? boardsSub(rec.boards) : "no missions today",
      values: { missions: rec.missions, crew: rec.crew, permCrew: rec.permCrew, oncallCrew: rec.oncallCrew },
    };
  });
  const noEng = engLoad.get("");
  if (noEng) {
    engRows.push({
      key: "__none__", label: "— no engineer set —", color: "var(--muted)",
      sub: boardsSub(noEng.boards),
      values: { missions: noEng.missions, crew: noEng.crew, permCrew: noEng.permCrew, oncallCrew: noEng.oncallCrew },
    });
  }
  // shared scale for the Crew deployed bar, computed before the total row
  // below joins the array — same convention as Engineer workload's avgCrewMax
  const crewMax = Math.max(1, ...engRows.map(r => r.values.crew));
  engRows.sort((a, b) => b.values.missions - a.values.missions || b.values.crew - a.values.crew
    || a.label.localeCompare(b.label));
  if (engRows.length) {
    // Summed from engLoad, not from the rows above — the rows include a zero
    // entry for every engineer, and (when present) the "no engineer set" row,
    // so summing them would be right only by luck. This counts each mission
    // once regardless of who it's attributed to.
    const engTotals = [...engLoad.values()].reduce(
      (acc, r) => ({ missions: acc.missions + r.missions, crew: acc.crew + r.crew,
                      permCrew: acc.permCrew + r.permCrew, oncallCrew: acc.oncallCrew + r.oncallCrew }),
      { missions: 0, crew: 0, permCrew: 0, oncallCrew: 0 });
    engRows.push({
      key: "__total__", label: "All engineers", isTotal: true,
      sub: `${boards.length} board${boards.length === 1 ? "" : "s"}`,
      values: engTotals,
    });
    engSec.appendChild(ovCompareTable({
      cols: Object.assign(
        [{ key: "missions", label: "Missions" },
         // Permanent/on-call split — same splitCell as Engineer workload's
         // Avg crew/day and "By service area" below: bar length ~ total crew,
         // segments split by contract, the count and share per type live in
         // the bar's hover tooltip rather than as always-on text.
         { key: "crew", label: "Crew deployed", render: (r) => splitCell(r.values.permCrew, r.values.oncallCrew, crewMax, r.isTotal, 0) }],
        { nameLabel: "Engineer" }
      ),
      rows: engRows,
    }));
  } else {
    engSec.appendChild(Object.assign(document.createElement("p"),
      { className: "import-note", textContent: "No engineers defined yet — add them under Settings." }));
  }

  /* ---------- by service area (masonry-packed, see above) ----------
     One row per area on a shared scale, split permanent / on-call: the bar's
     full length is the area's total headcount (so areas stay ranked by size and
     comparable to each other), the two segments are its contract mix, and the
     hover tooltip gives each segment's share of that area. Deliberately one
     chart rather than three separate total/permanent/on-call charts — three
     would cost three times the space and still make "how much of NPT is
     on-call?" a cross-chart comparison instead of a glance. Same two colours as
     the contract donuts beside it, so blue = permanent holds across the row. */
  const areaSec = ovSection("By service area", "Bar length is total headcount; segments split permanent / on-call");
  const areaData = D().areas.map(a => {
    const emps = rosterAll.filter(e => e.areaId === a.id);
    const perm = emps.filter(e => e.contract === "permanent").length;
    return { area: a, perm, oncall: emps.length - perm, total: emps.length };
  }).filter(r => r.total > 0).sort((a, b) => b.total - a.total);
  if (areaData.length) {
    const areaMax = Math.max(...areaData.map(r => r.total));
    const areaWrap = document.createElement("div");
    areaWrap.className = "ov-area-rows";
    // Same count/percent text as contractMixCell's "42 (68%) / 20 (32%)" pattern
    // (see below) — the bold total stays the headline figure, this is a second,
    // smaller line under it so each row's contract mix is a glance, not a hover.
    const pctSplit = (perm, total) => {
      const pctPerm = total ? Math.round((perm / total) * 100) : 0;
      return `${pctPerm}% / ${100 - pctPerm}%`;
    };
    for (const r of areaData) {
      const row = document.createElement("div");
      row.className = "ov-area-row";
      row.innerHTML = `<span class="ov-area-row-label" title="${escapeHtml(r.area.name)}"><span class="ov-area-dot" style="background:${escapeHtml(r.area.color)}"></span><span class="ov-area-row-name">${escapeHtml(r.area.name)}</span></span>
        <div class="ov-area-row-track"></div>
        <span class="ov-area-row-totalwrap"><span class="ov-area-row-total">${r.total}</span><span class="ov-area-row-pct">${pctSplit(r.perm, r.total)}</span></span>`;
      row.querySelector(".ov-area-row-track").innerHTML = Charts.stackedBarH({
        segments: [
          { label: "Permanent", value: r.perm, color: "var(--chart-permanent)" },
          { label: "On-call", value: r.oncall, color: "var(--chart-oncall)" },
        ],
        scaleMax: areaMax, height: 18,
      });
      areaWrap.appendChild(row);
    }
    const permTotal = areaData.reduce((n, r) => n + r.perm, 0);
    const oncallTotal = areaData.reduce((n, r) => n + r.oncall, 0);
    // Grand-total row: no bar (it would be full-width by definition, same
    // reasoning as the isTotal/noBar rows in ovCompareTable), just the two-line
    // total + split, set off by a top border.
    const totalRow = document.createElement("div");
    totalRow.className = "ov-area-row ov-area-row-grandtotal";
    totalRow.innerHTML = `<span class="ov-area-row-label"><span class="ov-area-row-name">All areas</span></span>
      <div></div>
      <span class="ov-area-row-totalwrap"><span class="ov-area-row-total">${permTotal + oncallTotal}</span><span class="ov-area-row-pct">${pctSplit(permTotal, permTotal + oncallTotal)}</span></span>`;
    areaWrap.appendChild(totalRow);
    areaSec.appendChild(areaWrap);
    areaSec.appendChild(Charts.legendEl([
      { key: "perm", label: `Permanent (${permTotal})`, color: "var(--chart-permanent)" },
      { key: "oncall", label: `On-call (${oncallTotal})`, color: "var(--chart-oncall)" },
    ]));
  } else {
    areaSec.appendChild(Object.assign(document.createElement("p"), { className: "import-note", textContent: "No employees have a service area set yet." }));
  }

  /* ---------- 8. leave today (masonry-packed, see above) ----------
     Broken down by board on a shared scale ---------- */
  const leaveSec = ovSection("Leave today", `${totalLeave} people on leave. Segments break each type down by board.`);
  const leaveRows = document.createElement("div");
  leaveRows.className = "ov-leave-rows";
  const leaveTotals = LEAVE_ZONES.map(z => boards.reduce((sum, b) => sum + stats[b.id].zones[z], 0));
  const leaveMax = Math.max(1, ...leaveTotals);
  LEAVE_ZONES.forEach((z, zi) => {
    const segs = boards.map((b, i) => ({ key: b.id, label: b.name, value: stats[b.id].zones[z], color: boardColor(i) }));
    const row = document.createElement("div");
    row.className = "ov-leave-row";
    row.innerHTML = `<span class="ov-leave-row-label">${ZONE_LABELS[z]}<small>${ZONE_LABELS_TH[z]}</small></span>
      <div class="ov-leave-row-track"></div><span class="ov-leave-row-total">${leaveTotals[zi]}</span>`;
    row.querySelector(".ov-leave-row-track").innerHTML = Charts.stackedBarH({ segments: segs, scaleMax: leaveMax, height: 18 });
    leaveRows.appendChild(row);
  });
  leaveSec.appendChild(leaveRows);
  if (boards.length > 1) leaveSec.appendChild(Charts.legendEl(boards.map((b, i) => ({ key: b.id, label: b.name, color: boardColor(i) }))));

  // These five cards are still meant to read as pairs — By engineer + By
  // service area, Host coverage risk + Day/night split, then Leave today —
  // but a FIXED 50/50 row forces each pair's row to
  // the height of its taller card, leaving the shorter card sitting in a
  // block of dead space before the next row can start (e.g. a short By
  // service area under a long By engineer). A 2-column masonry keeps the
  // same left-to-right reading order (so the first pair still lands side by
  // side exactly as before) but lets every card after that rise into
  // whichever column is currently shortest, closing that gap instead of
  // reserving it.
  const masonry = document.createElement("div");
  masonry.id = "overview-masonry";
  const masonryCards = [
    ["ov.byEngineer", engSec], ["ov.byArea", areaSec], ["ov.hostRisk", hostRiskSec],
    ["ov.dayNight", daynightSec], ["ov.leave", leaveSec],
  ].filter(([area]) => can(area)).map(([, sec]) => sec);
  for (const sec of masonryCards) masonry.appendChild(sec);
  if (masonryCards.length) panel.appendChild(masonry);
  // A role with every section switched off would otherwise get a blank tab with
  // no explanation.
  if (!panel.children.length) {
    panel.innerHTML = '<p class="import-note">Your role doesn\'t have access to any of the Overview sections. Ask an admin if you think that\'s wrong.</p>';
    return;
  }

  // every section is in the document now, so containers have a real width
  for (const fill of pendingCharts) fill();
  Charts.wireChartTooltips(panel);
  layoutOverviewMasonry();
}

/* JS masonry for Overview's five lower detail cards (see renderOverview
   above) — absolutely positions each into whichever column is currently
   shortest, so a short card doesn't leave a gap matching its taller
   row-mate. Same shortest-column algorithm as layoutMasonry() for the
   mission grid, just column-count-by-width instead of a fixed card width,
   and capped at 2 columns so the cards still read as side-by-side pairs on
   anything wide enough to show two. */
const OV_MASONRY_GAP = 18, OV_MASONRY_MIN_COL = 340, OV_MASONRY_MAX_COLS = 2;
function layoutOverviewMasonry() {
  const grid = $("#overview-masonry");
  if (!grid) return;
  const W = grid.clientWidth;
  if (!W) return;
  const cards = [...grid.children];
  const cols = Math.min(OV_MASONRY_MAX_COLS, Math.max(1, Math.floor((W + OV_MASONRY_GAP) / (OV_MASONRY_MIN_COL + OV_MASONRY_GAP))));
  const colW = cols === 1 ? W : Math.floor((W - OV_MASONRY_GAP * (cols - 1)) / cols);
  cards.forEach(c => {
    c.style.position = "absolute"; c.style.width = colW + "px";
    c.style.left = "0px"; c.style.top = "0px"; c.style.height = "auto";
  });
  if (!cards.length) { grid.style.height = "0px"; return; }
  void grid.offsetWidth;   // reflow so each card's natural height is final at colW
  const colH = new Array(cols).fill(0);
  cards.forEach((c, i) => {
    const j = i < cols ? i : colH.indexOf(Math.min(...colH));
    c.style.left = (j * (colW + OV_MASONRY_GAP)) + "px";
    c.style.top = colH[j] + "px";
    colH[j] += c.offsetHeight + OV_MASONRY_GAP;
  });
  grid.style.height = (Math.max(...colH) - OV_MASONRY_GAP) + "px";
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

/* build/refresh the multi-select filter dropdowns */
function renderFilterOptions() {
  for (const ms of $$("#filters .ms")) {
    const key = ms.dataset.filter;
    ms.querySelector(".ms-btn").textContent = msButtonLabel(key);
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
        ms.querySelector(".ms-btn").textContent = msButtonLabel(key);   // keep dropdown open
        renderMissions();
      };
      pop.appendChild(row);
    }
  }
  $("#sort-by").value = state.sort;
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
}

/* Manpower List name display: the Thai name (the app's default), the English name, or both.
   An empty English name falls back to the Thai one, so a row is never blank. */
const EMPLIST_NAME_VIEW_KEY = "manpower.emplistNameView";
function emplistNameViewSaved() {
  try { const v = localStorage.getItem(EMPLIST_NAME_VIEW_KEY); return v === "en" || v === "both" ? v : "th"; } catch (e) { return "th"; }
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
}

/* full (re)build on tab entry: filter dropdown options + search box + rows */
function renderEmployeeList() {
  $("#emplist-search").value = state.emplist.search;
  state.emplist.nameView = emplistNameViewSaved();
  $("#emplist-name-view").value = state.emplist.nameView;
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
function openModal(id) {
  $("#modal-backdrop").classList.remove("hidden");
  for (const m of $$(".modal")) m.classList.add("hidden");
  $(id).classList.remove("hidden");
}
let _confirmCancel = null;   // fired if a confirm is dismissed any way other than "Yes"

function closeModal() {
  $("#modal-backdrop").classList.add("hidden");
  for (const m of $$(".modal")) m.classList.add("hidden");
  if (_confirmCancel) { const c = _confirmCancel; _confirmCancel = null; c(); }
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

/* settings modal — My account / Engineer / Service Area / Board / Users / Roles */
/* Each button declares the permission area it needs (data-area in index.html).
   "account" is everybody's, so the modal always has at least one pane and the
   Settings button is never a dead end. */
function settingsTabAllowed(btn) {
  const area = btn.dataset.area;
  if (area === "account") return true;
  if (area === "users-edit") return can("users", "edit");
  return can(area, "edit") || (area === "users" && can("users"));
}

function applySettingsTab() {
  const buttons = $$("#settings-tabs .settings-tab");
  let firstAllowed = null;
  for (const btn of buttons) {
    const ok = settingsTabAllowed(btn);
    btn.classList.toggle("hidden", !ok);
    if (ok && !firstAllowed) firstAllowed = btn.dataset.tab;
  }
  // A role that has just lost a pane (or a Viewer opening Settings for the
  // first time) would otherwise land on a hidden one and see nothing.
  const current = buttons.find(b => b.dataset.tab === state.settingsTab);
  if (!current || !settingsTabAllowed(current)) state.settingsTab = firstAllowed;
  for (const btn of buttons) {
    btn.classList.toggle("active", btn.dataset.tab === state.settingsTab);
  }
  // The dividers between rail groups are .settings-group elements, so one goes
  // when everything under it does — otherwise a Viewer (My account only) would
  // be left looking at rules with nothing between them.
  for (const g of $$("#settings-tabs .settings-group")) {
    const anyVisible = buttons.some(b => b.dataset.group === g.dataset.group && !b.classList.contains("hidden"));
    g.classList.toggle("hidden", !anyVisible);
  }
  for (const pane of $$(".settings-pane")) {
    pane.classList.toggle("hidden", pane.dataset.pane !== state.settingsTab);
  }
  if (state.settingsTab === "account") renderAccountPane();
  if (state.settingsTab === "users") renderUsersPane();
  if (state.settingsTab === "roles") renderRolesMatrix();
}

/* ---------- Settings -> Engineer ---------- */
/* The pane is a view of the people who may run a mission, not a list of loose
   records: everyone with the Engineer role is here because of their role, a
   manager or admin appears once they have been added with "+ Add engineer",
   and an engineer record with no account behind it stays until somebody links
   it. Only the colour is edited here — the name and the phone number belong to
   the account, and each person keeps their own number in My account. */
const DEFAULT_ENGINEER_COLOR = "#9ca3af";

function engineerPaneRows() {
  const rows = [];
  for (const d of D().directory) {
    // by role, or because somebody added them
    if (d.roleKey !== "engineer" && !d.engineerId) continue;
    const rec = d.engineerId ? D().engineers.find(e => e.id === d.engineerId) : null;
    rows.push({
      kind: "account", profile: d, engineer: rec,
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

  for (const r of rows) {
    const rec = r.engineer;
    const row = document.createElement("tr");
    row.className = "st-row";

    const swatch = document.createElement("td");
    swatch.className = "st-swatch";
    // The swatch IS the control. A bare <input type="color"> is drawn by the
    // browser as a colour chip inside its OWN bordered box, using a fixed grey
    // that ignores the theme — a box, inside a box, inside a table cell. The
    // .sw-pick wrapper strips that chrome (see styles.css) and prints the hex
    // beside it, so the value is never carried by colour alone.
    const pick = document.createElement("label");
    pick.className = "sw-pick";
    const color = document.createElement("input");
    color.type = "color";
    color.value = r.color;
    color.title = "Mission card colour";
    color.setAttribute("aria-label", `Colour for ${r.name}`);
    const hex = document.createElement("b");
    hex.textContent = swHex(color.value);
    color.oninput = () => { hex.textContent = swHex(color.value); };
    color.onchange = () => safely(async () => {
      // an engineer listed by role alone has no record yet — picking a colour
      // is what creates it
      const id = rec ? rec.id : await cloud.ensureEngineerForProfile(r.profile.id);
      await cloud.saveEngineerField(id, "color", color.value);
      renderSettings(); render();
    });
    pick.appendChild(color);
    pick.appendChild(hex);
    swatch.appendChild(pick);

    const nameCell = document.createElement("td");
    if (r.kind === "record") {
      // no account behind it: the record's own name is still the only name
      // there is, so it stays editable until somebody links it
      const name = document.createElement("input");
      name.type = "text";
      name.value = r.name;
      name.placeholder = "Name";
      name.setAttribute("aria-label", "Engineer name");
      name.onchange = () => safely(async () => {
        await cloud.saveEngineerField(rec.id, "name", name.value.trim() || r.name);
        renderSettings(); render();
      });
      nameCell.appendChild(name);
    } else {
      nameCell.className = "st-name";
      nameCell.textContent = r.name;
      if (r.profile && r.profile.fullName) nameCell.title = r.profile.fullName;
    }

    const phoneCell = document.createElement("td");
    phoneCell.className = "st-phone";
    phoneCell.textContent = r.phone || "—";
    phoneCell.title = r.kind === "account"
      ? "Set by this person under Settings → My account."
      : "From the engineer record. Link it to an account and the number comes from there.";

    const acctCell = document.createElement("td");
    acctCell.className = "st-account";
    if (r.kind === "account") {
      acctCell.innerHTML = `<span class="role-pill role-${escapeHtml(r.profile.roleKey || "none")}">${escapeHtml(roleLabel(r.profile.roleKey))}</span>`;
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
        renderSettings(); render();
      });
      acctCell.appendChild(unlink);
    } else {
      const link = document.createElement("select");
      link.setAttribute("aria-label", `Account for ${r.name}`);
      link.innerHTML = `<option value="">— no account —</option>` +
        linkable.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.displayName || d.fullName || "?")}</option>`).join("");
      link.title = "Link this record to the person's account — their name and phone number then come from it.";
      link.onchange = () => safely(async () => {
        await cloud.saveEngineerField(rec.id, "profile_id", link.value || null);
        renderSettings(); render();
      });
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
          renderSettings(); render(); openModal("#modal-settings");
        }));
      actCell.appendChild(del);
    }

    row.append(swatch, nameCell, phoneCell, acctCell, actCell);
    engBox.appendChild(row);
  }
}

/* "+ Add engineer": for the manager or admin who runs missions themselves.
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

function renderSettings() {
  applySettingsTab();
  renderEngineerRows();
  const areaBox = $("#settings-areas");
  areaBox.innerHTML = "";
  for (const a of D().areas) {
    const row = document.createElement("tr");
    row.className = "st-row";
    row.innerHTML = `
      <td class="st-swatch"><label class="sw-pick"><input type="color" value="${a.color}" title="Area colour" aria-label="Area colour"><b>${swHex(a.color)}</b></label></td>
      <td><input type="text" value="${escapeHtml(a.name)}" placeholder="Area name" aria-label="Area name"></td>
      <td class="st-act"><button type="button" class="st-del" title="Delete ${escapeHtml(a.name)}" aria-label="Delete ${escapeHtml(a.name)}">${icon("close")}</button></td>`;
    const [color, name, del] = [...row.querySelectorAll("input, button")];
    color.oninput = () => { const b = color.parentElement.querySelector("b"); if (b) b.textContent = swHex(color.value); };
    color.onchange = () => safely(async () => { await cloud.saveAreaField(a.id, "color", color.value); render(); });
    name.onchange = () => safely(async () => { await cloud.saveAreaField(a.id, "name", name.value.trim() || a.name); render(); });
    del.onclick = () => {
      const used = D().employees.some(e => e.areaId === a.id);
      if (used) { showConfirm("Cannot delete", `${a.name} still has employees. Reassign them first.`, () => {}); return; }
      safely(async () => { await cloud.deleteArea(a.id); renderSettings(); render(); openModal("#modal-settings"); });
    };
    areaBox.appendChild(row);
  }

  // Weekly weekend days per board — set once at board creation and, until
  // now, never editable afterward. Checking/unchecking saves immediately
  // (same instant-save pattern as the engineer/area fields above), and
  // affects every date-based calculation for that board going forward:
  // the holiday toggle, the "Add Mission" weekend-import flow, the
  // date-picker's weekend highlighting, and the Overview trend charts.
  const boardsBox = $("#settings-boards");
  boardsBox.innerHTML = "";
  for (const b of D().boards) {
    const row = document.createElement("tr");
    row.className = "st-row";
    const nameCell = document.createElement("td");
    nameCell.className = "st-board";
    // Renaming shares the "Rename & delete boards" permission (Admin only by
    // default; a trigger enforces it). An empty or unchanged name is put back.
    let nameEl;
    if (can("boarddelete", "edit")) {
      nameEl = document.createElement("input");
      nameEl.type = "text";
      nameEl.className = "settings-board-name";
      nameEl.value = b.name;
      nameEl.placeholder = "Board name";
      nameEl.setAttribute("aria-label", "Board name");
      nameEl.onchange = () => {
        const name = nameEl.value.trim();
        if (!name || name === b.name) { nameEl.value = b.name; return; }
        if (D().boards.some(x => x.id !== b.id && x.name.toLowerCase() === name.toLowerCase())) {
          nameEl.value = b.name;
          showConfirm("Cannot rename", `There is already a board called ${name}.`, () => openModal("#modal-settings"), () => openModal("#modal-settings"));
          return;
        }
        safely(async () => { await cloud.renameBoard(b.id, name); renderSettings(); render(); });
      };
    } else {
      nameEl = document.createElement("div");
      nameEl.className = "settings-board-name";
      nameEl.textContent = b.name;
    }
    const daysCell = document.createElement("td");
    const picker = document.createElement("div");
    picker.className = "weekday-picker settings-board-days";
    for (let i = 0; i < DOW_LABELS.length; i++) {
      const lab = document.createElement("label");
      lab.className = "weekday-chip";
      lab.innerHTML = `<input type="checkbox" value="${i}" ${b.weekendDays.includes(i) ? "checked" : ""}> ${DOW_LABELS[i]}`;
      // The checkbox stays in the DOM for keyboard and screen readers; the cell
      // it sits in is what you actually see (see .weekday-picker in styles.css).
      // The .on class rather than :has(:checked) so the selected day still reads
      // correctly on the older browsers some of the factory PCs run.
      lab.classList.toggle("on", b.weekendDays.includes(i));
      lab.querySelector("input").onchange = (ev) => {
        lab.classList.toggle("on", ev.target.checked);
        const weekendDays = Array.from(picker.querySelectorAll("input:checked")).map(c => Number(c.value));
        safely(async () => {
          await cloud.saveBoardWeekendDays(b.id, weekendDays);
          renderSettings();
          render();
        });
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
    boardsBox.appendChild(row);
  }

  // the counts under each table — cheap orientation, and they make an empty
  // list say so rather than showing a bare frame
  const n = (one, many, count) => `${count} ${count === 1 ? one : many}`;
  $("#engineers-count").textContent = n("engineer", "engineers", engineerPaneRows().length);
  $("#areas-count").textContent = n("service area", "service areas", D().areas.length);
  $("#boards-count").textContent = n("board", "boards", D().boards.length);

  applySettingsTab();
}

/* Deleting a board cascades to its missions, plans, overrides and forecasts in
   the database — and to its employees, which is why a board that still has
   people on it is refused rather than confirmed: move them first. */
function confirmDeleteBoard(b) {
  const back = () => openModal("#modal-settings");
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
      renderSettings(); render(); openModal("#modal-settings");
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
  const boardName = isOrgChart() ? "Org_Chart" : (board ? board.name : "Overview");
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
  const boardName = isOrgChart() ? "Org_Chart" : (board ? board.name : "Overview");
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
function openHideMissionsModal() {
  if (isForecastView()) return;
  guardEdit(() => {
    const missions = [...getPlan().missions].sort((a, b) => a.number.localeCompare(b.number));
    const list = $("#hide-missions-list");
    list.innerHTML = "";
    if (!missions.length) {
      list.innerHTML = '<p class="import-note">No missions on this date yet.</p>';
    }
    for (const m of missions) {
      const eng = D().engineers.find(e => e.id === m.engineerId);
      const row = document.createElement("label");
      row.className = "import-row";
      row.innerHTML = `<input type="checkbox" value="${m.id}" ${m.hidden ? "checked" : ""}>
        <span class="import-info"><b>${escapeHtml(m.number)}</b> — ${escapeHtml(m.host)} → ${escapeHtml(m.customer)}
        <small>${m.shift === "night" ? "Night" : "Day"} ${m.startTime}-${m.endTime}${eng ? " • " + escapeHtml(eng.name) : ""} • ${m.members.length} assigned</small></span>`;
      list.appendChild(row);
    }
    openModal("#modal-hide-missions");
  });
}

function saveHideMissions() {
  const missions = getPlan().missions;
  const checked = new Set(Array.from($$("#hide-missions-list input[type=checkbox]:checked")).map(c => c.value));
  const toHide = missions.filter(m => checked.has(m.id) && !m.hidden).map(m => m.id);
  const toUnhide = missions.filter(m => !checked.has(m.id) && m.hidden).map(m => m.id);
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
function renderModePill() {
  const pill = $("#mode-pill");
  const show = !isNonBoardView() && !!D().activeBoardId && !!feat().forecast && can("board");
  if (!show) { pill.className = "mode-pill hidden"; return; }
  const fc = isForecastView();
  const end = horizonEndFor(D().activeBoardId);
  pill.className = "mode-pill " + (fc ? "mode-forecast" : "mode-confirmed");
  pill.textContent = fc ? "FORECAST" : "CONFIRMED";
  pill.title = (fc ? "Tentative plan — never exported, never in the Host Record. " : "The operational plan. ") +
    `Confirmed plans run up to ${fmtShort(end)} (the next working day); every later date opens as a forecast.`;
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
    row.className = "ctx-item";
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

/* the board switch, range and week copy in the toolbar row */
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
    const n = document.createElement("span");
    n.className = "cap-board-n";
    n.textContent = "· " + D().employees.filter(e => e.boardId === b.id && e.active !== false).length;
    btn.append(name, n);
    btn.onclick = () => { state.capacity.boardId = b.id; render(); };
    sw.appendChild(btn);
  }
  $("#cap-range").value = String(state.capacity.weeks);
  $("#btn-cap-copy-week").classList.toggle("hidden", !can("capacity", "edit"));
  $("#btn-cap-seed").classList.toggle("hidden", !can("capacity", "edit"));
  $("#btn-cap-reset").classList.toggle("hidden", !can("capacity", "edit"));
}

const CAP_CHART_H = 190, CAP_CHART_TOP = 30, CAP_COL_H = 232;
function renderCapacity() {
  const panel = $("#capacity-panel");
  // keep the cell being typed in across a redraw (a Realtime ping from another
  // planner must not throw away what this one is halfway through typing)
  const ae = document.activeElement;
  const keep = ae && ae.dataset && ae.dataset.capKey ? { key: ae.dataset.capKey, value: ae.value, dirty: ae.value !== ae.defaultValue } : null;
  const clipHadFocus = ae && ae.id === "cap-clip";
  const scrollWas = (panel.querySelector(".cap-scroll") || {}).scrollLeft || 0;
  panel.innerHTML = "";
  const boardId = capBoardId();
  if (!boardId) { panel.innerHTML = '<p class="import-note">No boards yet.</p>'; return; }
  const board = D().boards.find(b => b.id === boardId);
  const mayEdit = can("capacity", "edit");
  const m = capacityModel(boardId);
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
  h.textContent = `Demand against available people — ${board.name}`;
  top.appendChild(h);
  top.insertAdjacentHTML("beforeend",
    '<span class="cap-key"><i class="cap-key-avail"></i>Available</span>' +
    '<span class="cap-key"><i class="cap-key-dem"></i>Demand covered</span>' +
    '<span class="cap-key"><i class="cap-key-over"></i>Demand not covered</span>' +
    '<span class="cap-key"><i class="cap-key-fc"></i>Forecast day</span>');
  card.appendChild(top);

  const scroll = document.createElement("div");
  scroll.className = "cap-scroll";
  const grid = document.createElement("div");
  grid.className = "cap-grid2";
  grid.style.minWidth = `calc(var(--cap-left) + ${m.dates.length * 64}px)`;

  // ----- chart -----
  const maxVal = Math.max(5, ...m.days.map(x => Math.max(x.demand, x.a ? x.a.available : 0)));
  const scaleMax = Math.ceil(maxVal * 1.1 / 5) * 5;
  const px = (n) => Math.round(n / scaleMax * CAP_CHART_H);
  const ticks = [];
  for (let v = 0; v <= scaleMax; v += scaleMax > 30 ? 10 : 5) ticks.push(v);
  const base = CAP_COL_H - CAP_CHART_TOP - CAP_CHART_H;
  const chart = row("cap-chart");
  const axis = document.createElement("div");
  axis.className = "cap-left cap-axis";
  axis.style.height = CAP_COL_H + "px";
  for (const v of ticks) {
    const t = document.createElement("span");
    t.className = "cap-tick-label";
    t.style.bottom = (base + px(v) - 7) + "px";
    t.textContent = v;
    axis.appendChild(t);
  }
  chart.appendChild(axis);
  for (const x of m.days) {
    const c = dayCell(x, "cap-col");
    c.style.height = CAP_COL_H + "px";
    for (const v of ticks) {
      const l = document.createElement("i");
      l.className = "cap-tick" + (v === 0 ? " cap-tick0" : "");
      l.style.bottom = (base + px(v)) + "px";
      c.appendChild(l);
    }
    const av = x.a ? x.a.available : 0;
    const covered = Math.min(x.demand, av), over = Math.max(0, x.demand - av);
    const bar = (cls, bottom, height) => {
      if (height <= 0) return;
      const b = document.createElement("i");
      b.className = cls;
      b.style.bottom = bottom + "px";
      b.style.height = height + "px";
      c.appendChild(b);
    };
    bar("cap-bar-avail", base, px(av));
    bar("cap-bar-dem", base, px(covered));
    bar("cap-bar-over", base + px(covered), px(over));
    const lab = document.createElement("span");
    lab.className = "cap-bar-label" + (x.kind === "short" ? " short" : "");
    lab.style.bottom = (base + px(Math.max(av, x.demand)) + 5) + "px";
    lab.textContent = `${x.demand} / ${av}`;
    c.appendChild(lab);
    if (x.a) {
      c.title = `${fmtDow(x.date)} ${fmtDate(x.date)}${x.forecast ? " (forecast)" : ""}\n` +
        `Demand ${x.demand} · Available ${x.a.available} (${x.a.availPerm} permanent, ${x.a.availOncall} on-call)\n` +
        `${x.a.leavePerm + x.a.leaveOncall} on leave · ${x.a.named} already named on the board`;
    }
    chart.appendChild(c);
  }
  grid.appendChild(chart);

  // ----- day header -----
  const dh = row("cap-dayhead");
  dh.appendChild(head("Day"));
  for (const x of m.days) {
    const c = dayCell(x);
    c.innerHTML = `<span class="cap-dow">${fmtDow(x.date)}</span><span class="cap-dm${x.date === todayStr() ? " today" : ""}">${shortDateLabel(x.date)}</span>` +
      (x.forecast
        ? '<span class="cap-mode fc" title="Tentative: the board opens this day in forecast mode">FORECAST</span>'
        : '<span class="cap-mode cf" title="The confirmed board: the plan people are sent out on">CONFIRMED</span>');
    dh.appendChild(c);
  }
  grid.appendChild(dh);

  // ----- gap -----
  const gr = row("cap-gaprow");
  gr.appendChild(head("Gap", "available − demand"));
  for (const x of m.days) {
    const c = dayCell(x);
    if (x.gap != null) {
      const chip = document.createElement("span");
      chip.className = "cap-gapchip " + x.kind;
      chip.dataset.date = x.date;
      const word = x.kind === "short" ? `short by ${-x.gap}` : x.kind === "tight" ? (x.gap === 0 ? "exactly enough" : "1 spare") : `${x.gap} spare`;
      chip.setAttribute("aria-label", `${fmtDow(x.date)} ${shortDateLabel(x.date)}: ${word}`);
      chip.title = word;
      chip.textContent = `${x.kind === "short" ? "▼" : x.kind === "tight" ? "●" : "▲"} ${fmtGap(x.gap)}`;
      c.appendChild(chip);
    }
    gr.appendChild(c);
  }
  grid.appendChild(gr);

  // ----- named on board -----
  const nr = row("cap-namedrow");
  const namedHead = head("Named on board", "people already on a mission");
  namedHead.title = "How many of this board's people are already put on a mission that day — on the confirmed board up to the next working day, in the forecast after that.\n" +
    "Compare it with Demand: a lower number means the numbers are planned but not everyone has been named yet.";
  nr.appendChild(namedHead);
  for (const x of m.days) {
    const c = dayCell(x);
    c.textContent = x.a ? String(x.a.named) : "";
    nr.appendChild(c);
  }
  grid.appendChild(nr);

  // ----- demand by host -----
  const sh = row("cap-sechead");
  const shl = document.createElement("div");
  shl.className = "cap-left cap-sechead-title";
  shl.textContent = "Demand by host · shift";
  sh.appendChild(shl);
  for (const x of m.days) {
    const c = dayCell(x);
    c.textContent = shortDateLabel(x.date);
    sh.appendChild(c);
  }
  grid.appendChild(sh);

  const cellVal = new Map(m.demand.map(r => [capKey(r.board_id, r.plan_date, r.host, r.shift), r.headcount]));
  const rows = capacityRowsFor(boardId, m.demand);
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
    hl.appendChild(nm);
    hl.insertAdjacentHTML("beforeend", areaPillHtml(hostAreaOf(r.host), "cap-area"));
    const shp = document.createElement("span");
    shp.className = "cap-shift" + (r.shift === "night" ? " night" : "");
    shp.textContent = r.shift === "night" ? "NIGHT" : "DAY";
    hl.appendChild(shp);
    if (mayEdit) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "cap-row-del";
      del.textContent = "\u2715";
      del.title = "Remove this row";
      del.setAttribute("aria-label", `Remove the ${r.host} ${r.shift} row`);
      del.onclick = () => removeCapacityRow(boardId, r);
      hl.appendChild(del);
    }
    hr.appendChild(hl);
    for (const [ci, x] of m.days.entries()) {
      const d = x.date;
      const c = dayCell(x, "cap-cell");
      c.dataset.r = String(ri);
      c.dataset.c = String(ci);
      const key = capKey(boardId, d, r.host, r.shift);
      const v = cellVal.get(key);
      if (mayEdit) {
        const inp = document.createElement("input");
        inp.type = "number";
        inp.min = "0";
        inp.step = "1";
        inp.inputMode = "numeric";
        inp.dataset.capKey = key;
        inp.defaultValue = v == null ? "" : String(v);
        inp.value = inp.defaultValue;
        inp.setAttribute("aria-label", `${r.host} ${r.shift} ${fmtDow(d)} ${shortDateLabel(d)}`);
        inp.onchange = () => {
          const raw = inp.value.trim();
          if (raw !== "" && !(Number(raw) >= 0)) { inp.value = inp.defaultValue; return; }
          saveCapacityCells([{ boardId, date: d, host: r.host, shift: r.shift, headcount: raw === "" ? null : Number(raw) }]);
        };
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
  scroll.appendChild(grid);
  card.appendChild(scroll);

  const foot = document.createElement("div");
  foot.className = "cap-card-foot";
  if (mayEdit) foot.appendChild(capacityAddRowForm(boardId));
  const note = document.createElement("span");
  note.className = "cap-note";
  note.textContent = "Available uses the current roster, so future hires and leavers are not reflected. Leave and named people come from the confirmed board up to the next working day and from forecasts after it. " +
    (mayEdit ? "Right-click (or long-press) a cell to fill it to the end of the week. Drag across cells to select them, then Ctrl+C and Ctrl+V to copy them to other days (works with Excel too); Delete clears a selection. "
      : "Drag across cells and press Ctrl+C to copy them. ") + "Hover a bar for the details.";
  foot.appendChild(note);
  card.appendChild(foot);
  panel.appendChild(card);

  const dl = document.createElement("datalist");
  dl.id = "cap-host-list";
  for (const hh of D().hosts.filter(x => !x.archived).slice().sort((a, b) => a.name.localeCompare(b.name))) {
    const o = document.createElement("option");
    o.value = hh.name;
    const area = hh.areaId ? D().areas.find(a => a.id === hh.areaId) : null;
    o.textContent = [area ? area.name : "", hh.location].filter(Boolean).join(" · ");
    dl.appendChild(o);
  }
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
function capacityAddRowForm(boardId) {
  const form = document.createElement("form");
  form.className = "cap-add";
  form.id = "cap-add";
  const inp = document.createElement("input");
  inp.type = "text";
  inp.placeholder = "Host…";
  inp.setAttribute("list", "cap-host-list");
  inp.setAttribute("aria-label", "Host");
  const sh = document.createElement("select");
  sh.setAttribute("aria-label", "Shift");
  sh.innerHTML = '<option value="day">Day</option><option value="night">Night</option>';
  const btn = document.createElement("button");
  btn.type = "submit";
  btn.className = "btn btn-small";
  btn.textContent = "+ Add host row";
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
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = $("#btn-theme");
  if (btn) btn.innerHTML = icon(theme === "dark" ? "sun" : "moon");
}
function initTheme() {
  applyTheme(localStorage.getItem("mpm-theme") || "light");
}

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
  form.displayName.value = me.displayName || "";
  form.phone.value = me.phone || "";
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
  $("#form-account-name").onsubmit = (ev) => {
    ev.preventDefault();
    const form = ev.target;
    safely(async () => {
      // The full name is an admin's record of who somebody is (Settings →
      // Users), not something to edit here, so it goes back unchanged —
      // update_my_profile writes the whole row and would otherwise blank it.
      // A blank display name IS meaningful: the database fills it back in from
      // the email address, which is how somebody resets to the automatic one.
      await cloud.updateMyProfile((D().me || {}).fullName, form.displayName.value, form.phone.value);
      toast("Saved.", "info");
      renderAccountPane();
      renderSettings();
      render();
      if (D().users) renderUserRows();
    });
  };
  $("#form-account-password").onsubmit = (ev) => {
    ev.preventDefault();
    const form = ev.target;
    if (form.password.value !== form.confirm.value) { toast("The two passwords don't match.", "error"); return; }
    safely(async () => {
      await cloud.updatePassword(form.password.value);
      form.reset();
      toast("Password changed.", "info");
    });
  };
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
  $("#btn-add-user").classList.toggle("hidden", !mayEdit);

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
  openModal("#modal-settings");
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
   used to lock everyone out of this screen. */
function renderRolesMatrix() {
  const body = $("#roles-matrix-body");
  if (!body || !can("users", "edit")) return;
  const roles = D().roles;
  body.innerHTML = "";

  const head = document.createElement("tr");
  head.className = "rm-head";
  head.innerHTML = "<th>Area</th>" + roles.map(r =>
    `<th>${escapeHtml(r.label)}${r.protected ? '<br><small>always full access</small>' : ""}</th>`).join("");
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
        const cur = (D().perms[role.key] || {})[item.key] || "none";
        const sel = document.createElement("select");
        sel.className = "rm-level";
        // A section that nothing can "edit" only offers off/on — a third state
        // that means nothing would just be a way to get it wrong.
        // A one-off action (deleting a board) is simply allowed or not.
        const levels = item.allowOnly ? ["none", "edit"] : viewOnly ? ["none", "view"] : ["none", "view", "edit"];
        sel.innerHTML = levels.map(l =>
          `<option value="${l}">${l === "none" ? "—" : l === "view" ? "View" : item.allowOnly ? "Allowed" : "Edit"}</option>`).join("");
        sel.value = levels.includes(cur) ? cur : (item.allowOnly ? "none" : "view");
        sel.disabled = !!role.protected;
        if (role.protected) sel.title = "Admin always keeps full access.";
        sel.onchange = () => {
          const level = sel.value;
          safely(async () => {
            await cloud.setRolePermission(role.key, item.key, level);
            renderRolesMatrix();
            // the change may have been to our own role — redraw the whole app
            await refreshAndRender();
          });
        };
        td.appendChild(sel);
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
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
  $("#form-employee").onsubmit = saveEmployee;
  $("#form-employee-note").addEventListener("submit", saveEmployeeNote);
  $("#btn-delete-mission").onclick = deleteMission;
  $("#btn-hide-mission").onclick = hideMission;
  $("#btn-hide-missions").onclick = openHideMissionsModal;
  $("#btn-hide-missions-save").onclick = saveHideMissions;
  $("#btn-deactivate-employee").onclick = deactivateEmployee;

  $("#btn-settings").onclick = () => { renderSettings(); openModal("#modal-settings"); };
  for (const btn of $$("#settings-tabs .settings-tab")) {
    btn.onclick = () => { state.settingsTab = btn.dataset.tab; applySettingsTab(); };
  }
  for (const btn of $$("#employee-tabs .settings-tab")) {
    btn.onclick = () => { state.employeeTab = btn.dataset.tab; applyEmployeeTab(); };
  }
  wireUserManagement();
  $("#btn-add-engineer").onclick = openAddEngineerModal;
  $("#form-add-engineer").onsubmit = addEngineerFromModal;
  // back to Settings rather than closing everything: the pane it was opened
  // from is what the person was in the middle of
  $("#btn-add-engineer-cancel").onclick = reopenSettings;
  $("#btn-add-area").onclick = () => safely(async () => { await cloud.addArea(); renderSettings(); });

  initTheme();
  $("#btn-theme").onclick = () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem("mpm-theme", next);
    applyTheme(next);
  };

  $("#btn-add-board").onclick = openBoardModal;
  $("#board-select").onchange = (ev) => {
    const val = ev.target.value;
    if (val === NEW_BOARD_OPT) {
      renderBoardSelect();   // put the picker back on the current board first —
      openBoardModal();      // cancelling the modal must not leave "+ New board…" showing
      return;
    }
    clearSelection();
    D().activeBoardId = val;
    refreshAndRender();
  };
  $("#form-board").onsubmit = saveBoard;

  $("#btn-signout").onclick = () => safely(() => cloud.signOut());

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
  $("#btn-cap-reset").onclick = resetCapacityToZero;
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
    if (ev.key === "Escape") { hideContextMenu(); hideDatePicker(); closeFilterPops(); hideToolbarMore(); clearSelection(); closeModal(); }
    // Ctrl/Cmd+Z = undo last assignment change (ignore while typing in a field)
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !/^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) {
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
    // render() never touches the Settings modal, so an approval or a role change
    // arriving over Realtime would otherwise sit stale on an open Users pane.
    if (!$("#modal-settings").classList.contains("hidden")) applySettingsTab();
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

async function main() {
  showAppVersion();
  wireLogin();
  wireReset();
  let session = null;
  try { session = await cloud.getSession(); } catch (e) { console.error(e); }
  let hadSession = !!session;
  let recovering = isRecoveryLink();

  if (recovering) {
    showResetScreen(session);
  } else if (session) {
    await boot();
  } else {
    showLogin();
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
