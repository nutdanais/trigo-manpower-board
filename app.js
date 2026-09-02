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
   read-only 🔒 (see isReadOnly) — and had to click forward every morning.
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
    if (v && (v.boardId === OVERVIEW_ID || v.boardId === EMPLIST_ID || D().boards.some(b => b.id === v.boardId))) {
      D().activeBoardId = v.boardId;
    }
  } catch { /* no saved view, or it's corrupt — just keep the default board */ }
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
    el.textContent = "⚠ Save failed";
  }
}
const CLOUD_WRITE_METHODS = [
  "_copyPlanForward", "resetBoardFromLastWorkingDay", "setAssignment",
  "saveMission", "deleteMission", "importMissions", "setMissionsHidden", "setDayWorking",
  "lockDay", "unlockDay", "saveEmployee", "setEmployeesActive",
  "setEmployeesPosition", "setEmployeesContract", "setEmployeesArea", "moveEmployeeToBoard",
  "moveEmployeesToBoard", "createBoard", "renameBoard", "saveBoardWeekendDays",
  "saveEngineerField", "addEngineer", "deleteEngineer", "saveAreaField", "addArea", "deleteArea",
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
  settingsTab: "engineers",   // Settings modal: which sub-menu (Engineer / Service Area / Board) is showing
  employeeTab: "edit",        // Employee modal: "edit" or "hosts" (Host Record) — reset on every open
  emplist: {                  // Manpower List tab: search/filter/sort, independent of any board or date
    search: "",
    filters: { contract: [], position: [], areaId: [], boardId: [] },
    sortKey: "name",
    sortDir: 1,
    util: null,          // { [empId]: pct } once loaded; null = not fetched yet
    utilCacheKey: null,  // same "fetch only when the window actually moved" trick as overview
  },
  overview: {                 // Overview tab: utilization trend chart controls + its cache
    trendRange: 14,           // 7 | 14 | 30 days, ending on state.date — same date as every
                               // other number on the Overview page (see the comment in renderOverview)
    trendHidden: new Set(),   // board ids toggled off via the trend chart's legend
    trendMetric: "util",      // "util" | "oncallFree" | "idle" — which line the merged Trend chart plots
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
    history: null,                // cloud.getUtilizationRange() over the History range
    historyCacheKey: null,
  },
};

const D = () => cloud.data;
const OVERVIEW_ID = "__overview__";
const EMPLIST_ID = "__emplist__";
const isOverview = () => D().activeBoardId === OVERVIEW_ID;
const isEmployeeList = () => D().activeBoardId === EMPLIST_ID;
const isPast = () => state.date < todayStr();
/* ---------- lock (finalized board, view-only for everyone) ---------- */
const lockInfo = (boardId, date) => D().locks.find(l => l.boardId === boardId && l.date === date) || null;
/* cloud.unlockDay() awaits a fresh reload of cloud.data.locks before returning,
   so lockInfo() already reflects "unlocked" the moment it resolves — no local
   override needed (and one would risk masking a later re-lock by someone else). */
const isLocked = (boardId, date) => !!lockInfo(boardId, date);
/* past AND today are read-only by default — today's plan is already being executed */
const isReadOnly = () => isLocked(D().activeBoardId, state.date) || (state.date <= todayStr() && !state.unlockedDates.has(state.date));
const boardEmployees = (boardId) => D().employees.filter(e => e.boardId === boardId);
/* A deactivated employee (Status column in the Manpower List) is off the
   planning roster: they disappear from the pools, from mission/leave cards and
   from the counts built out of them — but only on today's and future boards.
   A past date is a record of what actually happened, so it keeps showing
   everyone who was really there; that's the whole reason deactivating is a
   flag rather than a delete. boardEmployees() above stays unfiltered on
   purpose — it's the raw lookup history rendering depends on. */
const showsDeactivated = () => state.date < todayStr();
const onRoster = (e) => showsDeactivated() || e.active !== false;
const rosterEmployees = (boardId) => boardEmployees(boardId).filter(onRoster);

/* ---------- plan access (reads the cache cloud.js keeps warm) ---------- */
function emptyPlan() { return { missions: [], zones: emptyZones(), updatedAt: null }; }

function getPlan() {
  const boardId = D().activeBoardId;
  return (D().plans[boardId] && D().plans[boardId][state.date]) || emptyPlan();
}
function peekPlan(boardId) {
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
    await Promise.all([ensureUtilizationLoaded(), ensureHostCoverageLoaded(), ensureHistoryLoaded()]);
  } else if (isEmployeeList()) {
    // employee master data is already warm in the cache; the 30D column is the
    // one thing here that needs a fetch, and it's cached across redraws so
    // typing in the search box doesn't re-query
    await ensureEmplistUtilLoaded();
  } else if (D().activeBoardId) {
    await cloud.ensurePlanLoaded(D().activeBoardId, state.date);
  }
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
  const eml = isEmployeeList();
  $("#status-zones").classList.toggle("hidden", ov || eml);
  $("#missions-grid").classList.toggle("hidden", ov || eml);
  $("#overview-panel").classList.toggle("hidden", !ov);
  $("#emplist-panel").classList.toggle("hidden", !eml);
  $("#btn-new-mission").classList.toggle("hidden", ov || eml);
  $("#btn-hide-missions").classList.toggle("hidden", ov || eml);
  $("#btn-new-employee").classList.toggle("hidden", ov);
  $("#btn-import-mission").classList.toggle("hidden", ov || eml || !isNonWorkingDate(state.date));
  // Holiday toggle: ON = this date is non-working. Any editable future date
  // (weekday or weekend); hidden on read-only past/today, overview and the employee list.
  const showHoliday = !ov && !eml && !isReadOnly();
  $("#holiday-toggle").classList.toggle("hidden", !showHoliday);
  if (showHoliday) $("#holiday-check").checked = isNonWorkingDate(state.date);
  $("#filters").classList.toggle("hidden", ov || eml);
  $("#emplist-area-bar").classList.toggle("hidden", !eml);
  $("#btn-export").classList.toggle("hidden", eml);
  $("#btn-reset-board").classList.toggle("hidden", ov || eml);
  renderStats();
  // floating available panel: only on an actual board (hidden in Overview / Manpower List)
  $("#float-pool").classList.toggle("hidden", ov || eml);
  document.body.classList.toggle("board-view", !ov && !eml);
  $("#btn-undo").classList.toggle("hidden", ov || eml);
  if (ov) {
    renderOverview();
  } else if (eml) {
    renderEmployeeList();
  } else {
    renderZones();
    renderMissions();
    renderFilterOptions();
    updateHideMissionsButton();
    updateResetButton();
  }
  renderBoardEmptyState();
  const lock = !ov && !eml ? lockInfo(D().activeBoardId, state.date) : null;
  $("#readonly-badge").classList.toggle("hidden", ov || eml || !isReadOnly());
  $("#readonly-badge").textContent = lock ? `🔒 Locked by ${lock.lockedBy}` : "🔒 Read-only (past date)";
  updateSelectionUI();
  updateUndoButton();
  applySearchHighlight();
}

/* label the Hide/Unhide toolbar button with how many missions are currently
   hidden on this board+date, so it's obvious at a glance whether anything is
   tucked away */
function updateHideMissionsButton() {
  const btn = $("#btn-hide-missions");
  if (!btn) return;
  const n = getPlan().missions.filter(m => m.hidden).length;
  btn.textContent = n ? `👁 Hide/Unhide (${n})` : "👁 Hide/Unhide";
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
  btn.textContent = empty ? "↺ Carry over" : "↺ Reset Board";
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
  const show = !isOverview() && !isEmployeeList() && !isReadOnly()
    && !isNonWorkingDate(state.date) && planIsEmpty(getPlan());
  box.classList.toggle("hidden", !show);
  box.innerHTML = "";
  if (!show) return;
  const msg = document.createElement("div");
  msg.className = "empty-title";
  msg.innerHTML = `This board is empty for <b>${fmtDow(state.date)} ${fmtDate(state.date)}</b>.`;
  const sub = document.createElement("div");
  sub.className = "empty-sub";
  sub.textContent = "Carry over the last working day's missions and crew to start from there, or just add missions manually.";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-carry";
  btn.textContent = "↺ Carry over last working day's plan";
  btn.onclick = () => guardEdit(() => resetBoard());
  box.appendChild(msg);
  box.appendChild(sub);
  box.appendChild(btn);
}

function renderTabs() {
  const el = $("#board-tabs");
  el.innerHTML = "";
  const ov = document.createElement("div");
  ov.className = "board-tab tab-overview" + (isOverview() ? " active" : "");
  ov.textContent = "📊 Overview";
  ov.onclick = () => { clearSelection(); D().activeBoardId = OVERVIEW_ID; refreshAndRender(); };
  el.appendChild(ov);
  const eml = document.createElement("div");
  eml.className = "board-tab tab-emplist" + (isEmployeeList() ? " active" : "");
  // "List" is in its own span so the phone bar can drop it (see .tab-trim in
  // styles.css) — "Manpower" alongside "Overview" and a board picker is
  // unambiguous, and the two words it saves are what let the bar hold one line
  eml.innerHTML = '🧑\u200d🤝\u200d🧑 Manpower<span class="tab-trim"> List</span>';
  eml.onclick = () => { clearSelection(); D().activeBoardId = EMPLIST_ID; refreshAndRender(); };
  el.appendChild(eml);
  // visual break: the two above are app-wide views; the rest are per-board
  if (D().boards.length) {
    const sep = document.createElement("div");
    sep.className = "board-tab-sep";
    el.appendChild(sep);
  }
  for (const b of D().boards) {
    const t = document.createElement("div");
    // tab-board marks the per-board tabs specifically: the phone layout hides
    // these and shows #board-select instead, but keeps Overview / Manpower List
    t.className = "board-tab tab-board" + (b.id === D().activeBoardId ? " active" : "");
    t.textContent = b.name;
    t.title = "Click to switch. Double-click to rename.";
    t.onclick = () => { clearSelection(); D().activeBoardId = b.id; refreshAndRender(); };
    t.ondblclick = () => {
      const name = prompt("Rename board:", b.name);
      if (name && name.trim()) safely(async () => { await cloud.renameBoard(b.id, name.trim()); render(); });
    };
    el.appendChild(t);
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
  const onBoard = !isOverview() && !isEmployeeList();
  sel.innerHTML = "";
  // Overview and Manpower List are not boards, so no option matches then — a
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
  for (const b of D().boards) {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = b.name;
    sel.appendChild(o);
  }
  const add = document.createElement("option");
  add.value = NEW_BOARD_OPT;
  add.textContent = "+ New board…";
  sel.appendChild(add);
  sel.value = onBoard ? D().activeBoardId : "";
}

/* Built from spans rather than one string so the phone header can drop the
   parts it can't afford (see .btn-date .d-ico / .d-yr in styles.css). Once the
   two arrows and the four icon buttons share this one row, a full
   "📅 Tue 25-Aug-2026" no longer fits — and a date cut off by an ellipsis is
   worse than one deliberately shortened to "Tue 25-Aug". The title keeps the
   full date on every screen size, and the picker itself always shows the year. */
function renderDateButton() {
  const dow = fmtDow(state.date);
  const full = fmtDate(state.date);
  const [d, mon, yr] = full.split("-");
  const btn = $("#btn-date");
  btn.innerHTML = `<span class="d-ico">📅</span> ${dow} ${d}-${mon}<span class="d-yr">-${yr}</span>`;
  btn.title = `${dow} ${full} — click to pick a date`;
}

/* lock button: only on an actual board (hidden on Overview / Manpower List) */
function renderLockButton() {
  const btn = $("#btn-lock");
  const hide = isOverview() || isEmployeeList();
  btn.classList.toggle("hidden", hide);
  if (hide) return;
  const lock = lockInfo(D().activeBoardId, state.date);
  btn.classList.toggle("locked", !!lock);
  if (lock) {
    const when = lock.lockedAt ? new Date(lock.lockedAt).toLocaleString() : "";
    btn.innerHTML = '🔒<span class="btn-label"> Locked</span>';
    btn.title = `Locked by ${lock.lockedBy}${when ? " on " + when : ""} — click to unlock for everyone`;
  } else {
    btn.innerHTML = '🔓<span class="btn-label"> Lock</span>';
    btn.title = "Lock this board so it's view-only for everyone";
  }
}

/* display order for any list of employee cards: permanent before on-call, then by name */
function sortEmployeesDisplay(emps) {
  return [...emps].sort((a, b) =>
    (a.contract === "oncall") - (b.contract === "oncall") || a.name.localeCompare(b.name));
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
  card.innerHTML =
    `<span class="emp-name">${escapeHtml(emp.name)}</span>` +
    `<span class="emp-meta">` +
      (pos ? `<span class="emp-pos">${pos.short}</span>` : "") +
      (emp.contract === "oncall" ? `<span class="emp-oc">OC</span>` : "") +
      (area ? `<span class="emp-area" style="background:${escapeHtml(area.color)};color:${inkOn(area.color)}">${escapeHtml(area.name)}</span>` : "") +
    `</span>`;
  card.title = `${emp.name} • ${emp.contract === "oncall" ? "On-call" : "Permanent"}${pos ? " • " + pos.label : ""} • ${area ? area.name : "?"}\nClick to select · Ctrl-click to add · drag or click a mission to assign · double-click to edit`;

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
  for (const p of $$("#filters .ms-pop, #emplist-filters .ms-pop")) p.classList.add("hidden");
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
  const addItem = (label, fn, cls) => {
    const it = document.createElement("div");
    it.className = "ctx-item" + (cls ? " " + cls : "");
    it.textContent = label;
    it.onclick = () => { hideContextMenu(); fn(); };
    menu.appendChild(it);
  };
  // Drills one level down instead of closing. stopPropagation is load-bearing:
  // renderCtxMenu replaces innerHTML, so by the time this click reaches the
  // document handler its own target is detached and closest("#context-menu")
  // no longer matches — the menu would be treated as an outside click and hide
  // itself the instant you opened a submenu.
  const addSub = (label, target) => {
    const it = document.createElement("div");
    it.className = "ctx-item ctx-sub";
    it.textContent = label;
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
  const plan = sameBoard ? peekPlan(menuBoardId) : null;
  const current = sameBoard && !many ? currentAssignmentOfIn(plan, emp.id) : null;
  // already-there targets are dropped: assigning someone to where they already
  // are is a no-op assignEmployeesTo would skip anyway
  const missions = sameBoard ? plan.missions.filter(m => !m.hidden && !(current && current.missionId === m.id)) : [];
  const leaveZones = sameBoard ? LEAVE_ZONES.filter(z => !(current && current.zone === z)) : [];
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
    if (!many) addItem("✏ Edit employee", () => guardEdit(() => openEmployeeModal(emp.id)));
    if (targetBoards.length) addSub("➜ Move to board", "boards");
    if (missions.length) addSub("⊕ Assign to mission", "missions");
    if (leaveZones.length) addSub("🌴 Leave", "leave");
    if (sameBoard && (many || current)) {
      addItem(many ? "↩ Return to standby / pool" : `↩ Return to ${emp.contract === "oncall" ? "Available On-call" : "Standby"}`,
        () => guardEdit(() => assignEmployeesTo(ids, null)));
    }
    addSep();
    addItem(many ? `🚫 Deactivate ${ids.length} employees` : "🚫 Deactivate employee", () => {
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
  $("#standby-label").textContent = holiday ? "🏖 Holiday" : "Standby";
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
    card.className = "mission-card" + (missionMatchesFilters(m) ? "" : " dimmed");
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
    header.innerHTML = `
      <div class="m-line1">
        <span class="m-number">${escapeHtml(m.number)}</span>
        <span class="m-sep">|</span>
        <span class="m-host">${escapeHtml(m.host)}</span>
        <span class="m-shift${m.shift === "night" ? " night" : ""}">${m.shift === "night" ? "NIGHT" : "DAY"}</span>
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
      ${m.ppe ? `<div class="m-ppe"><b>PPE</b> ${escapeHtml(m.ppe)}</div>` : ""}`;
    header.onclick = () => guardEdit(() => openMissionModal(m.id));
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
  if (isEmployeeList()) {
    const permN = D().employees.filter(e => e.contract === "permanent").length;
    bar.appendChild(statChip("Total employees", D().employees.length));
    bar.appendChild(statChip("Permanent", permN));
    bar.appendChild(statChip("On-call", D().employees.length - permN));
    // per-service-area counts, same idea as a board's #area-bar — shown on the
    // toolbar row (next to "+ New Employee") since Manpower List has no stats row of its own
    const emplistAreaBar = $("#emplist-area-bar");
    emplistAreaBar.innerHTML = "";
    for (const a of D().areas) {
      const n = D().employees.filter(e => e.areaId === a.id).length;
      if (n) emplistAreaBar.appendChild(statChip(a.name, n));
    }
    return;
  }
  const s = boardStats(D().activeBoardId);
  const chips = [
    ["Total", s.total], ["Assigned", s.assigned], ["Leave", s.leave],
    ["Standby", s.standby],
  ];
  if (s.isHoliday) chips.push(["🏖 Holiday", s.onHoliday]);
  chips.push(["On-call free", s.oncallAvailable]);
  for (const [label, n] of chips) bar.appendChild(statChip(label, n));
  bar.appendChild(statChip("☀️ Day", s.dayMissions));
  bar.appendChild(statChip("🌙 Night", s.nightMissions, null, "stat-chip-night"));
  // per-service-area counts sit on the right of the same row
  for (const a of D().areas) {
    const n = boardEmployees(D().activeBoardId).filter(e => e.areaId === a.id).length;
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
/* one board's line in the merged Trend chart */
function boardMetricPoint(metric, d, boardId, util) {
  if (isNonWorkingDate(d, boardId)) return null;
  const rec = util[boardId] && util[boardId][d];
  return rec ? trendMetricValue(metric, rec) : null;
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
      const acc = sum.byEngineer[engId] || (sum.byEngineer[engId] = { missions: 0, crew: 0 });
      acc.missions += src.missions;
      acc.crew += src.crew;
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
  head.innerHTML = `<div class="ov-trend-intro"><h3>History</h3>` +
    `<p class="ov-section-sub">Daily deployment over a chosen range. ${escapeHtml(historyRangeCaption(dates))}. ` +
    `Weekends and holidays are left off the axis and out of the averages.</p></div>`;
  head.appendChild(historyControls());
  sec.appendChild(head);

  const wrap = document.createElement("div");
  wrap.className = "ov-trend-chart";
  sec.appendChild(wrap);

  if (!dates.length) {
    wrap.innerHTML = `<p class="import-note">No working days in this range — every date was a weekend or a holiday.</p>`;
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
      { className: "import-note", textContent: "No engineers defined yet — add them under ⚙ Settings." }));
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
  const totals = {};     // engineer id -> {missions, crew, activeDays, peak, peakDate}
  for (const ent of entities) {
    daily[ent.id] = [];
    totals[ent.id] = { missions: 0, crew: 0, activeDays: 0, peak: 0, peakDate: null };
  }
  dates.forEach((d, i) => {
    for (const ent of entities) {
      const rec = recs[i];
      const v = (rec && rec.byEngineer[ent.id]) || { missions: 0, crew: 0 };
      daily[ent.id].push(rec ? v[ov.engMetric] : null);
      const t = totals[ent.id];
      t.missions += v.missions;
      t.crew += v.crew;
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
        crewPer: t.missions ? round1(t.crew / t.missions) : 0,
        activeDays: t.activeDays,
        share: grandMissions ? Math.round((t.missions / grandMissions) * 100) : 0,
      },
      _sort: t.missions,
    };
  });
  engRows.sort((a, b) => b._sort - a._sort || b.values.avgCrew - a.values.avgCrew || a.label.localeCompare(b.label));
  const grandCrew = Object.values(totals).reduce((a, t) => a + t.crew, 0);
  engRows.push({
    key: "__total__", label: "All engineers", isTotal: true,
    sub: `${n} working day${n === 1 ? "" : "s"}`,
    values: {
      avgMissions: round1(grandMissions / n),
      avgCrew: round1(grandCrew / n),
      crewPer: grandMissions ? round1(grandCrew / grandMissions) : 0,
      activeDays: dates.filter((d, i) => recs[i] && recs[i].staffedMissions > 0).length,
      share: grandMissions ? 100 : 0,
    },
  });
  sec.appendChild(ovCompareTable({
    cols: Object.assign([
      { key: "avgMissions", label: "Avg missions/day" },
      { key: "avgCrew", label: "Avg crew/day" },
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

  /* ---------- trend data, computed once and shared by the KPI sparkline and
     the merged Trend section further down ----------
     Ends on state.date, not real-world "today" — the KPI headline above it
     and every other number on this page (By board, Action queue, ...) are
     already state.date's numbers, so anchoring the trend/sparkline to a
     DIFFERENT date (real today) made them silently describe two different
     timelines the moment someone browsed to another day: the headline
     number and the sparkline sitting right next to it could disagree, and
     the Trend chart's last point wouldn't be the date its own "Ending
     today" caption (below) claimed. One date for the whole page. */
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
     calm confirmation, same tone as the ✓ empty-state elsewhere on this page. */
  const statusBar = document.createElement("div");
  statusBar.className = "ov-status-bar";
  statusBar.style.borderLeftColor = totalStandby ? "#f59e0b" : "#22c55e";
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
  statusShifts.appendChild(statChip("☀️ Day", todaysDayCount));
  statusShifts.appendChild(statChip("🌙 Night", todaysNightCount, null, "stat-chip-night"));
  statusBar.appendChild(statusShifts);
  panel.appendChild(statusBar);

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
  panel.appendChild(kpiRow);

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
        <span class="ov-avail-title">⚠ ${totalStandby} permanent staff not assigned yet</span>
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
      { className: "ov-avail ov-avail-ok", textContent: "✓ Everyone permanent is placed on every board." }));
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
  panel.appendChild(actionSec);

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
  panel.appendChild(boardSec);

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
      { className: "ov-avail ov-avail-ok", textContent: "✓ No thin coverage today — every host on today's missions has 3+ people who've worked it before, or no history yet to worry about." }));
  } else {
    const rowsWrap = document.createElement("div");
    rowsWrap.className = "ov-hostrisk-rows";
    for (const r of riskyHosts) {
      const row = document.createElement("div");
      row.className = "ov-hostrisk-row risk";
      const who = r.names.join(", ") + (r.count > r.names.length ? ` +${r.count - r.names.length}` : "");
      const countLabel = `${r.count} person${r.count === 1 ? "" : "s"} ever`;
      row.innerHTML = `
        <span class="ov-hostrisk-name">${escapeHtml(r.host)}</span>
        <span class="ov-hostrisk-count">⚠ ${countLabel}</span>
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

  /* ---------- 5. trend: one chart, a metric switcher instead of two near-
     identical 220px charts sharing one legend drawn twice. ---------- */
  const trendSec = document.createElement("section");
  trendSec.className = "ov-section";
  const trendHead = document.createElement("div");
  trendHead.className = "ov-trend-head";
  const trendEndLabel = state.date === todayStr() ? "today" : `${fmtDow(state.date)} ${fmtDate(state.date)}`;
  trendHead.innerHTML = `<div class="ov-trend-intro"><h3>Trend</h3><p class="ov-section-sub">Ending ${trendEndLabel}, weekends and shared holidays skipped.</p></div>`;
  const trendControlsGroup = document.createElement("div");
  trendControlsGroup.className = "ov-trend-controls-group";
  const metricBtns = document.createElement("div");
  metricBtns.className = "ov-trend-btns";
  const METRIC_LABELS = { util: "Utilization", oncallFree: "On-call free", idle: "Idle staff" };
  for (const key of ["util", "oncallFree", "idle"]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-small" + (state.overview.trendMetric === key ? " active" : "");
    btn.textContent = METRIC_LABELS[key];
    btn.onclick = () => {
      if (state.overview.trendMetric === key) return;
      state.overview.trendMetric = key;
      render();
    };
    metricBtns.appendChild(btn);
  }
  const rangeBtns = document.createElement("div");
  rangeBtns.className = "ov-trend-btns";
  for (const n of [7, 14, 30]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-small" + (state.overview.trendRange === n ? " active" : "");
    btn.textContent = n + "d";
    btn.onclick = () => {
      if (state.overview.trendRange === n) return;
      state.overview.trendRange = n;
      state.overview.utilCacheKey = null;
      refreshAndRender();
    };
    rangeBtns.appendChild(btn);
  }
  trendControlsGroup.appendChild(metricBtns);
  trendControlsGroup.appendChild(rangeBtns);
  trendHead.appendChild(trendControlsGroup);
  trendSec.appendChild(trendHead);

  const metric = state.overview.trendMetric;
  const trendSeries = boards.map((b, i) => ({
    key: b.id, label: b.name, color: boardColor(i),
    visible: !state.overview.trendHidden.has(b.id),
    points: xDates.map(d => ({ y: boardMetricPoint(metric, d, b.id, util), suffix: metric === "util" ? "%" : "" })),
  }));
  const trendWrap = document.createElement("div");
  trendWrap.className = "ov-trend-chart";
  if (noWorkingDays) {
    trendWrap.innerHTML = `<p class="import-note">No working days in the last ${state.overview.trendRange} days — every date was a weekend or holiday on every board.</p>`;
  } else {
    const yMax = metric === "util" ? 100
      : metric === "oncallFree" ? Math.max(4, Math.ceil(Math.max(1, ...boards.map(b => stats[b.id].oncall)) / 4) * 4)
      : Math.max(4, Math.ceil(Math.max(1, ...boards.map(b => stats[b.id].permanent)) / 4) * 4);
    pendingCharts.push(() => fillLineChart(trendWrap, { series: trendSeries, xLabels: xDates.map(shortDateLabel), yMax, height: 220 }));
  }
  trendSec.appendChild(trendWrap);
  trendSec.appendChild(Charts.legendEl(
    boards.map((b, i) => ({ key: b.id, label: b.name, color: boardColor(i), muted: state.overview.trendHidden.has(b.id) })),
    (key) => {
      state.overview.trendHidden.has(key) ? state.overview.trendHidden.delete(key) : state.overview.trendHidden.add(key);
      render();
    }
  ));
  panel.appendChild(trendSec);

  /* ---------- 5b. History + Engineer workload ----------
     Both read one fetch (state.overview.history) over one user-chosen range,
     computed here once and handed to both so the day records aren't summed
     twice. Full-width sections like Trend, not masonry cards: a 240px chart
     over a month of dates needs the whole row. */
  resolveHistoryRange();   // idempotent; ensureHistoryLoaded skips it when there are no boards
  const histBoards = historyBoardsInScope(boards);
  const histDates = historyDates(histBoards);
  const histRecs = histDates.map(d => historyDayRec(d, histBoards, state.overview.history || {}));
  panel.appendChild(historySection(histDates, histRecs, pendingCharts));
  panel.appendChild(engineerHistorySection(histDates, histRecs, pendingCharts));

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
  const engLoad = new Map();   // engineerId (or "" = unassigned) -> {missions, crew, boards:Set}
  const bump = (id, crew, boardName) => {
    const rec = engLoad.get(id) || { missions: 0, crew: 0, boards: new Set() };
    rec.missions += 1;
    rec.crew += crew;
    rec.boards.add(boardName);
    engLoad.set(id, rec);
  };
  for (const b of boards) {
    const ids = new Set(boardEmployees(b.id).map(e => e.id));
    for (const m of peekPlan(b.id).missions) {
      if (m.hidden) continue;
      bump(m.engineerId || "", m.members.filter(e => ids.has(e)).length, b.name);
    }
  }
  // every engineer gets a row (a zero tells you who is free today, which is the
  // other half of "who is loaded"); an "unassigned" row appears only if some
  // mission genuinely has no engineer on it.
  // naming every board stops fitting once an engineer covers 4+ of them —
  // past three, the count is the useful part
  const boardsSub = (set) => set.size > 3 ? `${set.size} boards` : [...set].join(" · ");
  const engRows = D().engineers.map(e => {
    const rec = engLoad.get(e.id) || { missions: 0, crew: 0, boards: new Set() };
    return {
      key: e.id, label: e.name, color: e.color,
      sub: rec.boards.size ? boardsSub(rec.boards) : "no missions today",
      values: { missions: rec.missions, crew: rec.crew },
    };
  });
  const noEng = engLoad.get("");
  if (noEng) {
    engRows.push({
      key: "__none__", label: "— no engineer set —", color: "var(--muted)",
      sub: boardsSub(noEng.boards),
      values: { missions: noEng.missions, crew: noEng.crew },
    });
  }
  engRows.sort((a, b) => b.values.missions - a.values.missions || b.values.crew - a.values.crew
    || a.label.localeCompare(b.label));
  if (engRows.length) {
    // Summed from engLoad, not from the rows above — the rows include a zero
    // entry for every engineer, and (when present) the "no engineer set" row,
    // so summing them would be right only by luck. This counts each mission
    // once regardless of who it's attributed to.
    const engTotals = [...engLoad.values()].reduce(
      (acc, r) => ({ missions: acc.missions + r.missions, crew: acc.crew + r.crew }),
      { missions: 0, crew: 0 });
    engRows.push({
      key: "__total__", label: "All engineers", isTotal: true,
      sub: `${boards.length} board${boards.length === 1 ? "" : "s"}`,
      values: engTotals,
    });
    engSec.appendChild(ovCompareTable({
      cols: Object.assign(
        [{ key: "missions", label: "Missions" }, { key: "crew", label: "Crew deployed" }],
        { nameLabel: "Engineer" }
      ),
      rows: engRows,
    }));
  } else {
    engSec.appendChild(Object.assign(document.createElement("p"),
      { className: "import-note", textContent: "No engineers defined yet — add them under ⚙ Settings." }));
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
    for (const r of areaData) {
      const row = document.createElement("div");
      row.className = "ov-area-row";
      row.innerHTML = `<span class="ov-area-row-label" title="${escapeHtml(r.area.name)}"><span class="ov-area-dot" style="background:${escapeHtml(r.area.color)}"></span><span class="ov-area-row-name">${escapeHtml(r.area.name)}</span></span>
        <div class="ov-area-row-track"></div><span class="ov-area-row-total">${r.total}</span>`;
      row.querySelector(".ov-area-row-track").innerHTML = Charts.stackedBarH({
        segments: [
          { label: "Permanent", value: r.perm, color: "var(--chart-permanent)" },
          { label: "On-call", value: r.oncall, color: "var(--chart-oncall)" },
        ],
        scaleMax: areaMax, height: 18,
      });
      areaWrap.appendChild(row);
    }
    areaSec.appendChild(areaWrap);
    areaSec.appendChild(Charts.legendEl([
      { key: "perm", label: `Permanent (${areaData.reduce((n, r) => n + r.perm, 0)})`, color: "var(--chart-permanent)" },
      { key: "oncall", label: `On-call (${areaData.reduce((n, r) => n + r.oncall, 0)})`, color: "var(--chart-oncall)" },
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
  for (const sec of [engSec, areaSec, hostRiskSec, daynightSec, leaveSec]) masonry.appendChild(sec);
  panel.appendChild(masonry);

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
const EMPLIST_FILTER_LABELS = { contract: "Contract", position: "Position", areaId: "Service area", boardId: "Board" };

function emplistFilterOptions(key) {
  if (key === "contract") return [{ value: "permanent", label: "Permanent" }, { value: "oncall", label: "On-call" }];
  if (key === "position") {
    return [...Object.keys(POSITIONS).map(k => ({ value: k, label: POSITIONS[k].label })), { value: "__none__", label: "— none —" }];
  }
  if (key === "areaId") return D().areas.map(a => ({ value: a.id, label: a.name }));
  if (key === "boardId") return D().boards.map(b => ({ value: b.id, label: b.name }));
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

function emplistFilteredSorted() {
  const f = state.emplist.filters;
  const q = state.emplist.search.trim().toLowerCase();
  const emps = D().employees.filter(e => {
    if (f.contract.length && !f.contract.includes(e.contract)) return false;
    if (f.position.length && !f.position.includes(e.position || "__none__")) return false;
    if (f.areaId.length && !f.areaId.includes(e.areaId)) return false;
    if (f.boardId.length && !f.boardId.includes(e.boardId)) return false;
    if (q && !e.name.toLowerCase().includes(q) && !(e.phone || "").toLowerCase().includes(q)) return false;
    return true;
  });
  const { sortKey, sortDir } = state.emplist;
  const sortVal = (e) => {
    switch (sortKey) {
      case "contract": return e.contract === "oncall" ? "On-call" : "Permanent";
      case "position": return e.position ? POSITIONS[e.position].label : "";
      case "phone": return e.phone || "";
      case "areaId": return D().areas.find(a => a.id === e.areaId)?.name || "";
      case "boardId": return D().boards.find(b => b.id === e.boardId)?.name || "";
      case "active": return e.active === false ? "Inactive" : "Active";
      default: return e.name;
    }
  };
  // utilization is the one numeric column — "100" vs "9" sorts wrong as text.
  // Unknown/no-working-days sorts to the bottom either way rather than as 0%,
  // which would read as "never deployed" and isn't the same claim.
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
/* CSV wants a bare number so it stays sortable/averageable in Excel */
function utilCsv(pct) { return (pct === undefined || pct === null) ? "" : String(pct); }
function utilCell(pct) {
  if (pct === undefined) return `<span class="el-util-empty">…</span>`;
  if (pct === null) return `<span class="el-util-empty" title="No working days for this board in the last 30 days">—</span>`;
  return `<span class="el-util-meter"><span class="el-util-fill" style="width:${Math.min(100, pct)}%"></span></span>`
    + `<b class="el-util-val">${pct}%</b>`;
}

/* RFC 4180: a field only needs quoting if it contains a comma, quote, or
   newline — quoting everything is also correct, just noisier to read raw */
function csvField(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportEmplistCsv() {
  const emps = emplistFilteredSorted();   // same rows the table is showing right now
  const header = ["Name", "Contract type", "Position", "Mobile number", "Service area", "Current board", "30D utilization", "Status"];
  const rows = emps.map(e => {
    const area = D().areas.find(a => a.id === e.areaId);
    const board = D().boards.find(b => b.id === e.boardId);
    const pos = e.position ? POSITIONS[e.position] : null;
    return [e.name, e.contract === "oncall" ? "On-call" : "Permanent", pos ? pos.label : "",
      e.phone || "", area ? area.name : "", board ? board.name : "",
      utilCsv(state.emplist.util ? state.emplist.util[e.id] : undefined),
      e.active === false ? "Inactive" : "Active"];
  });
  const csv = [header, ...rows].map(r => r.map(csvField).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });   // BOM so Excel picks up UTF-8 (Thai names)
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `manpower_list_${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function updateEmplistBulkBar() {
  const bar = $("#emplist-bulkbar");
  if (!bar) return;
  const n = state.selectedEmps.size;
  bar.classList.toggle("hidden", n === 0);
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
      <td data-label="Name">${escapeHtml(e.name)}</td>
      <td data-label="Contract type">${e.contract === "oncall" ? "On-call" : "Permanent"}</td>
      <td data-label="Position">${pos ? pos.label : "—"}</td>
      <td data-label="Mobile number">${e.phone ? telLink(e.phone) : "—"}</td>
      <td data-label="Service area">${area ? `<span class="area-pill" style="background:${escapeHtml(area.color)};color:${inkOn(area.color)}">${escapeHtml(area.name)}</span>` : "—"}</td>
      <td data-label="Current board">${board ? escapeHtml(board.name) : "—"}</td>
      <td data-label="30D utilization" class="el-util">${utilCell(util)}</td>
      <td data-label="Status" class="el-status">
        <label class="toggle toggle-active">
          <input type="checkbox" ${isActive ? "checked" : ""}>
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
  renderEmplistFilterOptions();
  renderEmployeeRows();
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
  const entries = [];
  for (const id of empIds) {
    const prior = currentAssignmentOf(id);
    if (samePayload(prior, payload)) continue;   // no-op, skip
    entries.push({ empId: id, prior });
  }
  if (!entries.length) { clearSelection(); return; }
  safely(async () => {
    for (const e of entries) await cloud.setAssignment(e.empId, state.date, payload);
    state.undoStack.push({ date: state.date, entries });
    if (state.undoStack.length > 25) state.undoStack.shift();
    clearSelection();
    await refreshAndRender();
    updateUndoButton();
  });
}

function undoLast() {
  const action = state.undoStack.pop();
  updateUndoButton();
  if (!action) return;
  state.date = action.date;   // jump back to the affected date so the change is visible
  safely(async () => {
    for (const e of action.entries) await cloud.setAssignment(e.empId, action.date, e.prior);
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

function showConfirm(title, message, onYes, onCancel) {
  $("#confirm-title").textContent = title;
  $("#confirm-message").textContent = message;
  _confirmCancel = onCancel || null;
  openModal("#modal-confirm");
  $("#btn-confirm-yes").onclick = () => { _confirmCancel = null; closeModal(); onYes(); };
  $("#btn-confirm-no").onclick = closeModal;
}

/* mission modal */
function openMissionModal(missionId) {
  state.editingMissionId = missionId || null;
  const form = $("#form-mission");
  form.reset();
  $("#mission-modal-title").textContent = missionId ? "Edit Mission" : "New Mission";
  $("#btn-delete-mission").classList.toggle("hidden", !missionId);
  $("#btn-hide-mission").classList.toggle("hidden", !missionId);
  form.engineerId.innerHTML = D().engineers.map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("");
  if (missionId) {
    const m = getPlan().missions.find(x => x.id === missionId);
    form.number.value = m.number;
    form.host.value = m.host;
    form.customer.value = m.customer;
    form.ppe.value = m.ppe || "";
    form.shift.value = m.shift;
    form.startTime.value = m.startTime;
    form.endTime.value = m.endTime;
    form.engineerId.value = m.engineerId;
    form.remark.value = m.remark || "";
  }
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
    engineerId: form.engineerId.value,
  };
  // instant client-side check (same number + shift, excluding the mission being edited);
  // scans hidden missions too — the DB unique constraint covers them regardless —
  // this just avoids a round trip and points at the hidden one if that's the clash
  const dup = getPlan().missions.find(m =>
    m.number.trim().toLowerCase() === vals.number.toLowerCase() &&
    m.shift === vals.shift && m.id !== state.editingMissionId);
  if (dup) {
    const shiftLabel = vals.shift === "night" ? "Night" : "Day";
    toast(dup.hidden
      ? `A hidden mission "${vals.number}" already exists on the ${shiftLabel} shift for this date. Use "👁 Hide/Unhide" to unhide and reuse it, or pick a different shift.`
      : `A mission "${vals.number}" already exists on the ${shiftLabel} shift for this date. Use a different shift, or edit the existing mission instead.`, "warn");
    return;
  }
  safely(async () => {
    await cloud.saveMission(D().activeBoardId, state.date, state.editingMissionId, vals);
    closeModal();
    await refreshAndRender();
  });
}

function deleteMission() {
  const m = getPlan().missions.find(x => x.id === state.editingMissionId);
  showConfirm("Delete mission?", `Delete ${m.number}? Its employees return to the Available pool.`, () => {
    safely(async () => {
      await cloud.deleteMission(state.editingMissionId);
      await refreshAndRender();
    });
  });
}

/* Hide takes a mission off the board without deleting its record — its number,
   host, engineer etc. all survive so it can be brought back with "👁 Hide/Unhide".
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
      `Hide ${m.number}? Its ${m.members.length} assigned employee${m.members.length === 1 ? "" : "s"} return to Standby. The mission itself is kept — unhide it any time from "👁 Hide/Unhide".`,
      doHide);
  } else {
    doHide();
  }
}

/* employee modal */
function openEmployeeModal(empId) {
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
    form.contract.value = e.contract;
    form.position.value = e.position || "";
    form.phone.value = e.phone || "";
    form.areaId.value = e.areaId;
    form.boardId.value = e.boardId;
  } else if (!isOverview() && !isEmployeeList()) {
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
  if (empId) loadEmployeeHostRecord(empId);
  openModal("#modal-employee");
}

function saveEmployee(ev) {
  ev.preventDefault();
  const form = $("#form-employee");
  const vals = { name: form.name.value.trim(), contract: form.contract.value, position: form.position.value, phone: form.phone.value.trim(), areaId: form.areaId.value, boardId: form.boardId.value };
  // instant client-side check (same pattern as duplicate missions); the DB-cache
  // check in cloud.saveEmployee is the real guard, this just avoids a round trip
  const dup = D().employees.find(e =>
    e.id !== state.editingEmployeeId && e.name.trim().toLowerCase() === vals.name.toLowerCase());
  if (dup) {
    toast(`An employee named "${vals.name}" already exists. Use a different name (e.g. add an ID/initial) to tell them apart.`, "warn");
    return;
  }
  safely(async () => {
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
   recent first. One row per host, not per mission — a host they've visited
   ten times is one line with a count, not ten. Loaded on modal open (not on
   first tab click) so switching tabs feels instant; the query is a single
   indexed read (assignments.employee_id) so this is cheap even for someone
   with a long history. */
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
    box.innerHTML = '<p class="import-note">No mission history yet.</p>';
    return;
  }
  const byHost = new Map();   // host name -> { count, lastDate, lastNumber, lastCustomer }
  for (const r of rows) {
    const rec = byHost.get(r.host) || { count: 0, lastDate: r.date, lastNumber: r.number, lastCustomer: r.customer };
    rec.count++;
    byHost.set(r.host, rec);
  }
  // rows arrive most-recent-first, so the first row seen per host is already its most recent
  const hosts = [...byHost.entries()].sort((a, b) => b[1].lastDate.localeCompare(a[1].lastDate));
  box.innerHTML = `<div class="host-list">${hosts.map(([host, rec]) => `
    <div class="host-row">
      <div class="host-name">${escapeHtml(host)}</div>
      <div class="host-meta">${rec.count} mission${rec.count === 1 ? "" : "s"} · last ${fmtDate(rec.lastDate)}
        (${escapeHtml(rec.lastNumber)}${rec.lastCustomer ? " — " + escapeHtml(rec.lastCustomer) : ""})</div>
    </div>`).join("")}</div>`;
}

/* settings modal — Engineer / Service Area / Board sub-menu tabs */
function applySettingsTab() {
  for (const btn of $$("#settings-tabs .settings-tab")) {
    btn.classList.toggle("active", btn.dataset.tab === state.settingsTab);
  }
  for (const pane of $$(".settings-pane")) {
    pane.classList.toggle("hidden", pane.dataset.pane !== state.settingsTab);
  }
}

function renderSettings() {
  const engBox = $("#settings-engineers");
  engBox.innerHTML = "";
  for (const e of D().engineers) {
    const row = document.createElement("div");
    row.className = "settings-row";
    row.innerHTML = `
      <input type="color" value="${e.color}" title="Engineer color">
      <input type="text" value="${e.name}" placeholder="Name">
      <input type="tel" value="${e.phone || ""}" placeholder="Phone">
      <button class="btn btn-danger btn-small">✕</button>`;
    const [color, name, phone, del] = row.children;
    color.onchange = () => safely(async () => { await cloud.saveEngineerField(e.id, "color", color.value); render(); });
    name.onchange = () => safely(async () => { await cloud.saveEngineerField(e.id, "name", name.value.trim() || e.name); render(); });
    phone.onchange = () => safely(async () => { await cloud.saveEngineerField(e.id, "phone", phone.value.trim()); render(); });
    del.onclick = () => showConfirm("Delete engineer?", `Delete ${e.name}?`, () => safely(async () => {
      await cloud.deleteEngineer(e.id);
      renderSettings(); render(); openModal("#modal-settings");
    }));
    engBox.appendChild(row);
  }
  const areaBox = $("#settings-areas");
  areaBox.innerHTML = "";
  for (const a of D().areas) {
    const row = document.createElement("div");
    row.className = "settings-row";
    row.innerHTML = `
      <input type="color" value="${a.color}" title="Area color">
      <input type="text" value="${a.name}" placeholder="Area name">
      <button class="btn btn-danger btn-small">✕</button>`;
    const [color, name, del] = row.children;
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
    const row = document.createElement("div");
    row.className = "settings-board-row";
    const nameEl = document.createElement("div");
    nameEl.className = "settings-board-name";
    nameEl.textContent = b.name;
    const picker = document.createElement("div");
    picker.className = "weekday-picker settings-board-days";
    for (let i = 0; i < DOW_LABELS.length; i++) {
      const lab = document.createElement("label");
      lab.className = "weekday-chip";
      lab.innerHTML = `<input type="checkbox" value="${i}" ${b.weekendDays.includes(i) ? "checked" : ""}> ${DOW_LABELS[i]}`;
      lab.querySelector("input").onchange = () => {
        const weekendDays = Array.from(picker.querySelectorAll("input:checked")).map(c => Number(c.value));
        safely(async () => {
          await cloud.saveBoardWeekendDays(b.id, weekendDays);
          renderSettings();
          render();
        });
      };
      picker.appendChild(lab);
    }
    row.appendChild(nameEl);
    row.appendChild(picker);
    boardsBox.appendChild(row);
  }

  applySettingsTab();
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
     must hold 3 × 114px .emp-card + two 6px flex gaps = 354
     → W ≥ 372

   390 leaves an 18px cushion. If .emp-card's width goes above 118px this
   silently drops back to two per row — the failure is quiet, so re-derive
   this sum rather than eyeballing the board. */
const MASONRY_GAP = 12, MASONRY_MIN_CARD = 390;
function layoutMasonry() {
  const grid = $("#missions-grid");
  if (!grid || grid.classList.contains("hidden")) return;
  const W = grid.clientWidth;
  if (!W) return;
  const cards = [...grid.children].filter(
    c => c.classList && c.classList.contains("mission-card") && c.style.display !== "none");
  const cols = Math.max(1, Math.floor((W + MASONRY_GAP) / (MASONRY_MIN_CARD + MASONRY_GAP)));
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
    colH[j] += c.offsetHeight + MASONRY_GAP;
  });
  grid.style.height = (Math.max(...colH) - MASONRY_GAP) + "px";
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
  const btn = $("#btn-export");
  btn.disabled = true;
  btn.textContent = "Exporting…";
  const board = D().boards.find(b => b.id === D().activeBoardId);
  const boardName = board ? board.name : "Overview";
  $("#capture-title").textContent = boardName + " Manpower Board";
  $("#capture-date").innerHTML = `${fmtDow(state.date)} ${fmtDate(state.date)}<small>${fmtDateThai(state.date)}</small>`;
  $("#capture-header").classList.remove("hidden");
  document.body.classList.add("exporting");
  // The exported JPG is a shared artifact (printed, posted, sent to a customer) —
  // it must not depend on the viewer's own dark-mode preference. Force light for
  // the capture, since --bg/--panel/--emp-card etc. all redefine under
  // [data-theme="dark"] and body.exporting only swaps the glass tokens.
  const wasDark = document.documentElement.getAttribute("data-theme") === "dark";
  if (wasDark) document.documentElement.removeAttribute("data-theme");
  // temporarily fold the available pools into the captured board — but not on a
  // holiday, where only the employees actually assigned to work should show up
  // (standby/available on-call are meaningless when nobody is expected in)
  let pools = null;
  if (!isOverview() && !isNonWorkingDate(state.date)) {
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
    // On a real board only (the Overview capture has no mission grid): drop the
    // empty missions and empty leave zones, then re-pack the masonry at the wider
    // export width so the JPG is as tight as possible.
    if (!isOverview()) {
      restoreEmptyMissions = hideEmptyMissionsForExport();
      restoreLeaveZones = hideEmptyLeaveZonesForExport();
      layoutMasonry();
    }
    const el = $("#board-capture");
    const windowWidth = Math.max(document.documentElement.scrollWidth, 1600);
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
    document.body.classList.remove("exporting");
    if (wasDark) document.documentElement.setAttribute("data-theme", "dark");
    btn.disabled = false;
    btn.textContent = "📷 Export";
    if (!isOverview()) layoutMasonry();   // re-pack at the normal on-screen width
  }
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

function openImportModal() {
  guardEdit(async () => {
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
        $("#import-list").innerHTML = '<p class="import-note">Every mission from that date is hidden. Unhide from "👁 Hide/Unhide" first if you want to bring one forward.</p>';
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

function confirmImport() {
  const ids = Array.from($$("#import-list input[type=checkbox]:checked")).map(c => c.value);
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
  const board = D().boards.find(b => b.id === D().activeBoardId);
  const boardName = board ? board.name : "this board";
  const run = () => safely(async () => {
    const src = await cloud.resetBoardFromLastWorkingDay(D().activeBoardId, state.date);
    await refreshAndRender();
    if (!src) toast("No previous working-day plan was found to copy from.", "warn");
  });
  // On an untouched day there's nothing to overwrite, so carry over straight
  // away. Once the day has content, confirm first — this replaces it.
  if (planIsEmpty(getPlan())) { run(); return; }
  showConfirm("Reset board?",
    `This will replace ${fmtDow(state.date)} ${fmtDate(state.date)} on ${boardName} with a fresh copy of the last working day's plan — its missions and employee assignments. Any changes already made to this day will be overwritten. Continue?`,
    run);
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
    lab.className = "weekday-chip";
    lab.innerHTML = `<input type="checkbox" value="${i}" ${(i === 0 || i === 6) ? "checked" : ""}> ${label}`;
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
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
}
function initTheme() {
  applyTheme(localStorage.getItem("mpm-theme") || "light");
}

/* ---------- login ---------- */
function showLogin() {
  $("#login-screen").classList.remove("hidden");
  $("#app-root").classList.add("hidden");
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
}

/* ---------- wiring ---------- */
function wireApp() {
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
  $("#btn-add-engineer").onclick = () => safely(async () => { await cloud.addEngineer(); renderSettings(); });
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
  for (const ms of $$("#filters .ms, #emplist-filters .ms")) {
    ms.querySelector(".ms-btn").onclick = (ev) => {
      ev.stopPropagation();
      const pop = ms.querySelector(".ms-pop");
      const wasOpen = !pop.classList.contains("hidden");
      closeFilterPops();
      if (!wasOpen) pop.classList.remove("hidden");
    };
  }
  $("#sort-by").onchange = (e) => { state.sort = e.target.value; render(); };

  $("#btn-export").onclick = exportBoard;
  $("#btn-reset-board").onclick = () => guardEdit(() => resetBoard());

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
  $("#btn-emplist-csv").onclick = exportEmplistCsv;
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
    if (!ev.target.closest("#filters .ms") && !ev.target.closest("#emplist-filters .ms")) closeFilterPops();
    if (!ev.target.closest("#toolbar-more")) hideToolbarMore();
  });
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

async function boot() {
  $("#login-screen").classList.add("hidden");
  $("#app-root").classList.remove("hidden");
  wireSaveStatus();
  wireApp();
  try { const session = await cloud.getSession(); state.myEmail = session && session.user && session.user.email; } catch (e) { /* toast attribution just won't fire */ }
  await cloud.init(() => state.date);
  // holidays are known now — restore the last board/date the user was on, falling
  // back to the next working day if there's nothing saved (or it's stale/invalid)
  restoreViewState();
  cloud.onChange((payload) => {
    state.overview.utilCacheKey = null;
    state.overview.historyCacheKey = null;
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
    refreshAndRender();
  });
  await refreshAndRender();
  // fonts can settle after the first paint and change card heights — re-pack once ready
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutMasonry);
}

async function main() {
  wireLogin();
  let session = null;
  try { session = await cloud.getSession(); } catch (e) { console.error(e); }
  let hadSession = !!session;
  if (session) {
    await boot();
  } else {
    showLogin();
  }
  // onAuthStateChange always fires once on load (even with no session ever set) —
  // only reload on a genuine sign-out transition, not that initial null event.
  cloud.onAuthChange((s) => {
    if (s) { hadSession = true; return; }
    if (hadSession) location.reload();
  });
}

main();
