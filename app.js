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
/* default landing = next working day: tomorrow, skipping weekends & holidays */
function defaultPlanningDate() {
  let d = addDays(todayStr(), 1);
  while (isNonWorkingDate(d)) d = addDays(d, 1);
  return d;
}

/* Remember the last board+date the user was looking at, so closing the tab and
   coming back lands them where they left off instead of always resetting to
   tomorrow's date on the first board. Without this, a plan made for a later
   date (or on the non-default board) looked "gone" after a reopen — it was
   never deleted, the app just landed somewhere else and nobody scrolled to find it. */
const VIEW_KEY = "mpm-last-view";
function saveViewState() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ boardId: D().activeBoardId, date: state.date }));
  } catch { /* storage unavailable (private mode, quota) — just skip persisting */ }
}
/* apply the saved board+date if still valid, else fall back to today's default */
function restoreViewState() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY));
    if (v && (v.boardId === OVERVIEW_ID || v.boardId === EMPLIST_ID || D().boards.some(b => b.id === v.boardId))) {
      D().activeBoardId = v.boardId;
    }
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.date)) { state.date = v.date; return; }
  } catch { /* no saved view, or it's corrupt — fall through to the default */ }
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
async function safely(fn) {
  try { await fn(); } catch (e) { alert("Something went wrong: " + (e.message || e)); }
}

/* ---------- app state ---------- */
const state = {
  date: defaultPlanningDate(),   // land on the next weekday's plan, not today
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
  emplist: {                  // Manpower List tab: search/filter/sort, independent of any board or date
    search: "",
    filters: { contract: [], position: [], areaId: [], boardId: [] },
    sortKey: "name",
    sortDir: 1,
  },
  overview: {                 // Overview tab: utilization trend chart controls + its cache
    trendRange: 14,           // 7 | 14 | 30 days, ending today (not state.date — the trend is
                               // "recent history", independent of whatever date the rest of Overview is showing)
    trendHidden: new Set(),   // board ids toggled off via the trend chart's legend
    util: null,               // cloud.getUtilizationRange() result, keyed by utilCacheKey below
    utilCacheKey: null,
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
   realtime data change, which is what forces a real refetch after an edit. */
async function ensureUtilizationLoaded() {
  const boardIds = D().boards.map(b => b.id);
  if (!boardIds.length) { state.overview.util = {}; state.overview.utilCacheKey = "empty"; return; }
  const toDate = todayStr();   // the trend is "recent history", always ending today
  const fromDate = addDays(toDate, -(state.overview.trendRange - 1));
  const cacheKey = boardIds.slice().sort().join(",") + "|" + fromDate + ".." + toDate;
  if (state.overview.utilCacheKey === cacheKey) return;
  state.overview.util = await cloud.getUtilizationRange(boardIds, fromDate, toDate);
  state.overview.utilCacheKey = cacheKey;
}

/* warm the cache for whatever is currently in view, then redraw */
async function refreshData() {
  if (isOverview()) {
    // Read-only: the Overview aggregates every board, so it must never seed —
    // otherwise one glance (or a login landing here) would materialize every
    // board's day. A future day nobody has opened yet simply shows empty.
    await Promise.all(D().boards.map(b => cloud.ensurePlanLoaded(b.id, state.date)));
    await ensureUtilizationLoaded();
  } else if (isEmployeeList()) {
    // employee master data is already kept warm in the cache — nothing date-scoped to load
  } else if (D().activeBoardId) {
    // Intentional single-board open: this is the one place allowed to seed a
    // brand-new day (once) with the previous working day's missions + crew.
    await cloud.ensurePlanLoaded(D().activeBoardId, state.date, { allowSeed: true });
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
  }
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
  eml.textContent = "🧑‍🤝‍🧑 Manpower List";
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
    t.className = "board-tab" + (b.id === D().activeBoardId ? " active" : "");
    t.textContent = b.name;
    t.title = "Click to switch. Double-click to rename.";
    t.onclick = () => { clearSelection(); D().activeBoardId = b.id; refreshAndRender(); };
    t.ondblclick = () => {
      const name = prompt("Rename board:", b.name);
      if (name && name.trim()) safely(async () => { await cloud.renameBoard(b.id, name.trim()); render(); });
    };
    el.appendChild(t);
  }
}

function renderDateButton() {
  $("#btn-date").textContent = "📅 " + fmtDow(state.date) + " " + fmtDate(state.date);
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
    btn.textContent = "🔒 Locked";
    btn.title = `Locked by ${lock.lockedBy}${when ? " on " + when : ""} — click to unlock for everyone`;
  } else {
    btn.textContent = "🔓 Lock";
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
  card.draggable = true;
  card.dataset.empId = emp.id;
  card.innerHTML = `<span class="emp-badge">${emp.contract === "oncall" ? "OC" : "P"}</span><span class="emp-name">${emp.name}</span>`
    + (pos ? `<span class="emp-pos">${pos.short}</span>` : "")
    + (area ? `<span class="emp-area" style="background:${area.color}">${area.name}</span>` : "");
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
  card.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    if (!state.selectedEmps.has(emp.id)) selectOnly(emp.id);
    showContextMenu(emp, ev.clientX, ev.clientY);
  });
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

/* ---------- context menu ---------- */
function hideContextMenu() { $("#context-menu").classList.add("hidden"); }

function showContextMenu(emp, x, y) {
  const menu = $("#context-menu");
  // acts on the whole selection when >1 is selected, else just this employee
  const ids = state.selectedEmps.size > 1 && state.selectedEmps.has(emp.id) ? [...state.selectedEmps] : [emp.id];
  const many = ids.length > 1;
  menu.innerHTML = `<div class="ctx-title">${many ? ids.length + " employees selected" : emp.name}</div>`;
  const addItem = (label, fn, cls) => {
    const it = document.createElement("div");
    it.className = "ctx-item" + (cls ? " " + cls : "");
    it.textContent = label;
    it.onclick = () => { hideContextMenu(); fn(); };
    menu.appendChild(it);
  };
  const addSep = () => { const s = document.createElement("div"); s.className = "ctx-sep"; menu.appendChild(s); };
  const addHead = (label) => { const h = document.createElement("div"); h.className = "ctx-subhead"; h.textContent = label; menu.appendChild(h); };

  // Kept deliberately short: Edit / Move to board / Delete. Position, contract
  // and service area are still editable — one at a time from the Edit Employee
  // modal, or in bulk from the Manpower List's selection bar — this menu just
  // isn't the place for them any more (it grew to 15+ items and slowed down
  // the three actions people actually reach for from the board).
  if (!many) addItem("✏ Edit employee", () => guardEdit(() => openEmployeeModal(emp.id)));

  // move to another board (bulk if multiple selected)
  const targetBoards = many ? D().boards : D().boards.filter(b => b.id !== emp.boardId);
  if (targetBoards.length) {
    addSep();
    if (many) addHead(`Move ${ids.length} to board`);
    for (const b of targetBoards) {
      const label = many ? b.name : `➜ Move to ${b.name}`;
      addItem(label, () => guardEdit(() => safely(async () => {
        await cloud.moveEmployeesToBoard(ids, b.id, state.date);
        clearSelection();
        await refreshAndRender();
      })), many ? "ctx-pos" : undefined);
    }
  }

  addSep();
  addItem(many ? `🗑 Delete ${ids.length} employees` : "🗑 Delete employee", () => {
    showConfirm("Delete employee" + (many ? "s" : "") + "?",
      many
        ? `Delete ${ids.length} selected employees? This removes them from every mission/zone assignment, past and future.`
        : `Delete ${emp.name}? This removes them from every mission/zone assignment, past and future.`,
      () => safely(async () => { await cloud.deleteEmployees(ids); clearSelection(); await refreshAndRender(); }));
  }, "ctx-danger");

  menu.classList.remove("hidden");
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + "px";
  menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + "px";
}

function renderZones() {
  const plan = getPlan();
  for (const z of ZONES) {
    const body = $(`[data-drop="zone:${z}"]`);
    body.innerHTML = "";
    const emps = plan.zones[z]
      .map(empId => D().employees.find(e => e.id === empId))
      .filter(e => e && e.boardId === D().activeBoardId);
    for (const emp of sortEmployeesDisplay(emps)) body.appendChild(empCard(emp));
  }
  renderFloatPool();
}

/* which employees on the active board are unassigned right now (Map for reuse) */
function unassignedEmployees() {
  const plan = getPlan();
  const placed = new Set();
  for (const m of plan.missions) for (const e of m.members) placed.add(e);
  for (const z of ZONES) for (const e of plan.zones[z]) placed.add(e);
  return boardEmployees(D().activeBoardId).filter(e => !placed.has(e.id));
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
    chip.innerHTML = `<span class="dot" style="background:${a.color}"></span>${a.name}<b>${counts.get(a.id)}</b>`;
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
    const card = document.createElement("div");
    card.className = "mission-card" + (missionMatchesFilters(m) ? "" : " dimmed");
    const header = document.createElement("div");
    header.className = "mission-header";
    header.style.background = eng ? eng.color : "#ccc";
    header.title = "Click to edit mission";
    header.innerHTML = `
      <div class="m-number">${m.number}</div>
      <div>Host: ${m.host}</div>
      <div>${m.shift === "night" ? '<span class="night-badge">🌙 NIGHT</span>' : "☀️ Day"} ${m.startTime}-${m.endTime}</div>
      <div>Cust: ${m.customer}</div>
      ${m.ppe ? `<div class="m-ppe">PPE: ${m.ppe}</div>` : ""}
      <div class="m-eng">${eng ? eng.name : "?"}${eng && eng.phone ? "<br>" + eng.phone : ""}</div>`;
    header.onclick = () => guardEdit(() => openMissionModal(m.id));
    const body = document.createElement("div");
    body.className = "mission-body dropzone";
    body.dataset.drop = "mission:" + m.id;
    const empRow = document.createElement("div");
    empRow.className = "mission-emps";
    const memberEmps = m.members
      .map(empId => D().employees.find(e => e.id === empId))
      .filter(e => e && e.boardId === D().activeBoardId);
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
}

/* stats for one board on the current date (reads cache only, never fetches) */
function boardStats(boardId) {
  const emps = boardEmployees(boardId);
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
    bar.appendChild(statChip("All employees", D().employees.length));
    for (const b of D().boards) bar.appendChild(statChip(b.name, boardEmployees(b.id).length));
    return;
  }
  if (isEmployeeList()) {
    const permN = D().employees.filter(e => e.contract === "permanent").length;
    bar.appendChild(statChip("Total employees", D().employees.length));
    bar.appendChild(statChip("Permanent", permN));
    bar.appendChild(statChip("On-call", D().employees.length - permN));
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

/* assigned ÷ (headcount − leave − onHoliday) — "how much of the people actually
   available today is deployed". onHoliday defaults to 0 for callers (e.g. the
   historical trend chart) that don't track it separately. Spelled out in the
   UI (not just this comment) since it's not guessable from the number alone. */
function utilizationPct(assigned, headcount, leave, onHoliday = 0) {
  const denom = headcount - leave - onHoliday;
  return denom > 0 ? Math.round((assigned / denom) * 100) : 0;
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

/* the 5-way split every deployment chart in Overview uses: Assigned / Leave /
   Standby / Holiday / On-call free. `s` is anything shaped like boardStats()'s
   return (or a hand-built aggregate with the same fields). onHoliday is 0 on
   any board/date that isn't a holiday, so the segment just disappears then. */
function deploySegments(s) {
  return [
    { key: "assigned", label: "Assigned", value: s.assigned, color: "var(--chart-assigned)" },
    { key: "leave", label: "Leave", value: s.leave, color: "var(--chart-leave)" },
    { key: "standby", label: "Standby", value: s.standby, color: "var(--chart-standby)" },
    { key: "onHoliday", label: "Holiday", value: s.onHoliday || 0, color: "var(--chart-holiday)" },
    { key: "oncallFree", label: "On-call free", value: s.oncallAvailable, color: "var(--muted)" },
  ];
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

  const totalEmp = D().employees.length;
  const totalAssigned = boards.reduce((s, b) => s + stats[b.id].assigned, 0);
  const totalLeave = boards.reduce((s, b) => s + stats[b.id].leave, 0);
  const totalStandby = boards.reduce((s, b) => s + stats[b.id].standby, 0);
  const totalOnHoliday = boards.reduce((s, b) => s + stats[b.id].onHoliday, 0);
  const totalOncallFree = boards.reduce((s, b) => s + stats[b.id].oncallAvailable, 0);
  const totalMissions = boards.reduce((s, b) => s + stats[b.id].missions, 0);
  const totalPerm = D().employees.filter(e => e.contract === "permanent").length;
  const totalOncall = totalEmp - totalPerm;
  const overallUtil = utilizationPct(totalAssigned, totalEmp, totalLeave, totalOnHoliday);

  /* ---------- KPI strip: the handful of numbers that read fine as numbers ---------- */
  const kpiRow = document.createElement("div");
  kpiRow.className = "ov-kpi-row";
  // `perBoard`: [[boardName, value], ...] — one line under the tile's label
  // breaking the headline number down per board. Omit it for a tile where a
  // per-board split wouldn't mean anything (e.g. the board COUNT itself).
  const kpi = (value, label, perBoard) => {
    const tile = document.createElement("div");
    tile.className = "ov-kpi-tile";
    tile.innerHTML = `<div class="ov-kpi-value">${value}</div><div class="ov-kpi-label">${label}</div>`;
    if (perBoard && perBoard.length) {
      const sub = document.createElement("div");
      sub.className = "ov-kpi-breakdown";
      sub.textContent = perBoard.map(([name, v]) => `${name} ${v}`).join(" · ");
      tile.appendChild(sub);
    }
    return tile;
  };
  kpiRow.appendChild(kpi(totalEmp, "Total employees", boards.map(b => [b.name, stats[b.id].total])));
  kpiRow.appendChild(kpi(boards.length, "Boards"));
  kpiRow.appendChild(kpi(totalMissions, `Missions (${fmtDate(state.date)})`, boards.map(b => [b.name, stats[b.id].missions])));
  kpiRow.appendChild(kpi(overallUtil + "%", "Overall utilization",
    boards.map(b => [b.name, utilizationPct(stats[b.id].assigned, stats[b.id].total, stats[b.id].leave, stats[b.id].onHoliday) + "%"])));
  panel.appendChild(kpiRow);

  /* ---------- deployment: whole-workforce donut + one 100%-stacked bar per board ---------- */
  const deploySec = ovSection("Deployment", `Utilized = assigned ÷ (headcount − leave − holiday), for ${fmtDow(state.date)} ${fmtDate(state.date)}`);
  const deployGrid = document.createElement("div");
  deployGrid.className = "ov-deploy-grid";
  const allDeploy = deploySegments({ assigned: totalAssigned, leave: totalLeave, standby: totalStandby, onHoliday: totalOnHoliday, oncallAvailable: totalOncallFree });
  const donutWrap = document.createElement("div");
  donutWrap.className = "ov-deploy-donut-wrap";
  donutWrap.innerHTML = Charts.donut({ segments: allDeploy, centerValue: overallUtil + "%", centerLabel: "Utilized", size: 152, thickness: 24 });
  donutWrap.appendChild(Charts.legendEl(allDeploy.filter(s => s.value > 0).map(s => ({ key: s.key, label: `${s.label} (${s.value})`, color: s.color }))));
  deployGrid.appendChild(donutWrap);

  const barsWrap = document.createElement("div");
  barsWrap.className = "ov-deploy-bars";
  for (const b of boards) {
    const s = stats[b.id];
    const row = document.createElement("div");
    row.className = "ov-deploy-bar-row";
    row.innerHTML = `<button type="button" class="ov-deploy-bar-board" title="Open ${b.name}">${b.name}</button>
      <div class="ov-deploy-bar-track"></div><span class="ov-deploy-bar-total">${s.total}</span>`;
    row.querySelector(".ov-deploy-bar-board").onclick = () => { D().activeBoardId = b.id; refreshAndRender(); };
    row.querySelector(".ov-deploy-bar-track").innerHTML = Charts.stackedBarH({ segments: deploySegments(s), height: 20 });
    barsWrap.appendChild(row);
  }
  deployGrid.appendChild(barsWrap);
  deploySec.appendChild(deployGrid);
  panel.appendChild(deploySec);

  /* ---------- needs attention: kept as an action list, not a stat — a chart
     would just make "here are their names, click to jump" worse. Placed right
     after Deployment since it's the direct follow-up action to that chart. ---------- */
  const attnSec = ovSection("Needs attention");
  let anyAttn = false;
  for (const b of boards) {
    const s = stats[b.id];
    // onHoliday deliberately does NOT trigger a card here — a holiday isn't
    // something needing attention, and giving it a card (even calm-styled)
    // under an "action list" heading recreates the exact problem this bucket
    // exists to avoid.
    if (!s.standby && !s.oncallAvailable) continue;
    anyAttn = true;
    const card = document.createElement("div");
    card.className = "ov-card";
    card.innerHTML = `<h4>${b.name}</h4>`;
    if (s.standby) {
      const box = document.createElement("div");
      box.className = "ov-avail";
      box.innerHTML = `<div class="ov-avail-title">⚠ Permanent, not assigned yet — assign to a mission:</div><div class="ov-avail-cards"></div>`;
      const cardsBox = box.querySelector(".ov-avail-cards");
      for (const emp of s.availableList) cardsBox.appendChild(makeMini(emp, b));
      card.appendChild(box);
    }
    if (s.oncallAvailable) {
      const box = document.createElement("div");
      box.className = "ov-avail ov-avail-calm";
      box.innerHTML = `<div class="ov-avail-title">Available on-call (not flagged):</div><div class="ov-avail-cards-oncall"></div>`;
      const cardsBox = box.querySelector(".ov-avail-cards-oncall");
      for (const emp of s.oncallAvailableList) cardsBox.appendChild(makeMini(emp, b));
      card.appendChild(box);
    }
    attnSec.appendChild(card);
  }
  if (!anyAttn) {
    attnSec.appendChild(Object.assign(document.createElement("p"), { className: "ov-avail ov-avail-ok", textContent: "✓ Everyone permanent is placed on every board." }));
  }
  panel.appendChild(attnSec);

  /* ---------- contract mix: permanent vs on-call, all boards + each board ---------- */
  const contractSec = ovSection("Contract mix", "Permanent vs on-call — all boards, then each board individually");
  const contractGrid = document.createElement("div");
  contractGrid.className = "ov-contract-grid";
  const contractItem = (label, perm, oncall, onClick) => {
    const item = document.createElement("div");
    item.className = "ov-contract-item" + (onClick ? " clickable" : "");
    item.innerHTML = Charts.donut({
      segments: [
        { label: "Permanent", value: perm, color: "var(--chart-permanent)" },
        { label: "On-call", value: oncall, color: "var(--chart-oncall)" },
      ],
      centerValue: perm + oncall, size: 100, thickness: 15,
    });
    const cap = document.createElement("div");
    cap.className = "ov-contract-item-label";
    cap.textContent = label;
    item.appendChild(cap);
    if (onClick) { item.title = `Open ${label}`; item.onclick = onClick; }
    return item;
  };
  contractGrid.appendChild(contractItem("All boards", totalPerm, totalOncall, null));
  for (const b of boards) {
    const s = stats[b.id];
    contractGrid.appendChild(contractItem(b.name, s.permanent, s.oncall, () => { D().activeBoardId = b.id; refreshAndRender(); }));
  }
  contractSec.appendChild(contractGrid);
  contractSec.appendChild(Charts.legendEl([
    { key: "perm", label: `Permanent (${totalPerm})`, color: "var(--chart-permanent)" },
    { key: "oncall", label: `On-call (${totalOncall})`, color: "var(--chart-oncall)" },
  ]));

  /* ---------- service-area distribution, all boards ---------- */
  const areaSec = ovSection("By service area", "Headcount across all boards");
  const areaRows = D().areas.map(a => ({ label: a.name, value: D().employees.filter(e => e.areaId === a.id).length, color: a.color }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value);
  if (areaRows.length) {
    const areaMax = Math.max(...areaRows.map(r => r.value));
    const areaWrap = document.createElement("div");
    areaWrap.className = "ov-area-bars";
    areaWrap.innerHTML = Charts.barsH({ rows: areaRows, max: areaMax, barHeight: 16, rowGap: 10 });
    areaSec.appendChild(areaWrap);
  } else {
    areaSec.appendChild(Object.assign(document.createElement("p"), { className: "import-note", textContent: "No employees have a service area set yet." }));
  }

  // side by side to save vertical space — both are compact enough to share a row
  const contractAreaRow = document.createElement("div");
  contractAreaRow.className = "ov-side-by-side";
  contractAreaRow.appendChild(contractSec);
  contractAreaRow.appendChild(areaSec);
  panel.appendChild(contractAreaRow);

  /* ---------- utilization trend: 7/14/30 days, one line per board ---------- */
  const trendSec = ovSection("Utilization trend",
    "Utilized = assigned ÷ (headcount − leave), ending today. Headcount uses each employee's CURRENT board — a past board move isn't tracked historically, so a moved employee counts on their new board for the whole window shown.");
  const controls = document.createElement("div");
  controls.className = "ov-trend-controls";
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
    controls.appendChild(btn);
  }
  trendSec.appendChild(controls);

  const util = state.overview.util || {};
  const toDate = todayStr();
  const fromDate = addDays(toDate, -(state.overview.trendRange - 1));
  const xDates = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) xDates.push(d);
  // cloud.getUtilizationRange now seeds every calendar date (working, weekend,
  // and holiday alike) — this chart deliberately still skips non-working days
  // (isNonWorkingDate: weekends + holiday overrides), so the line gaps on
  // them instead of dipping toward zero on a day nobody expected coverage.
  const trendSeries = boards.map((b, i) => ({
    key: b.id,
    label: b.name,
    color: boardColor(i),
    visible: !state.overview.trendHidden.has(b.id),
    points: xDates.map(d => {
      if (isNonWorkingDate(d, b.id)) return { y: null };
      const rec = util[b.id] && util[b.id][d];
      return rec ? { y: utilizationPct(rec.assigned, rec.headcount, rec.leave), suffix: "%" } : { y: null };
    }),
  }));
  const trendWrap = document.createElement("div");
  trendWrap.className = "ov-trend-chart";
  trendWrap.innerHTML = Charts.lineChart({ series: trendSeries, xLabels: xDates.map(shortDateLabel), yMax: 100, height: 200 });
  trendSec.appendChild(trendWrap);
  trendSec.appendChild(Charts.legendEl(
    boards.map((b, i) => ({ key: b.id, label: b.name, color: boardColor(i), muted: state.overview.trendHidden.has(b.id) })),
    (key) => {
      state.overview.trendHidden.has(key) ? state.overview.trendHidden.delete(key) : state.overview.trendHidden.add(key);
      render();
    }
  ));
  panel.appendChild(trendSec);

  /* ---------- on-call availability trend: same range/data fetch as above,
     and now the SAME date filter too — excludes weekends AND holidays, same
     as the utilization chart above (isNonWorkingDate covers both, honoring
     any per-date override in either direction). Shares state.overview.trendRange
     and trendHidden with the chart above (same range buttons, same legend
     board-visibility set) rather than duplicating those controls. ---------- */
  const oncallTrendSec = ovSection("On-call availability trend",
    "Available on-call = on-call headcount − assigned to a mission − on leave, per board. Excludes weekends and holidays, same as the trend above — uses the same date range.");
  const oncallYMax = Math.max(4, Math.ceil(Math.max(1, ...boards.map(b => stats[b.id].oncall)) / 4) * 4);
  const oncallTrendSeries = boards.map((b, i) => ({
    key: b.id,
    label: b.name,
    color: boardColor(i),
    visible: !state.overview.trendHidden.has(b.id),
    points: xDates.map(d => {
      if (isNonWorkingDate(d, b.id)) return { y: null };
      const rec = util[b.id] && util[b.id][d];
      if (!rec) return { y: null };
      const avail = Math.max(0, rec.oncallHeadcount - rec.oncallAssigned - rec.oncallLeave);
      return { y: avail };
    }),
  }));
  const oncallTrendWrap = document.createElement("div");
  oncallTrendWrap.className = "ov-trend-chart";
  oncallTrendWrap.innerHTML = Charts.lineChart({ series: oncallTrendSeries, xLabels: xDates.map(shortDateLabel), yMax: oncallYMax, height: 200 });
  oncallTrendSec.appendChild(oncallTrendWrap);
  oncallTrendSec.appendChild(Charts.legendEl(
    boards.map((b, i) => ({ key: b.id, label: b.name, color: boardColor(i), muted: state.overview.trendHidden.has(b.id) })),
    (key) => {
      state.overview.trendHidden.has(key) ? state.overview.trendHidden.delete(key) : state.overview.trendHidden.add(key);
      render();
    }
  ));
  panel.appendChild(oncallTrendSec);

  /* ---------- leave by type, broken down by board on a shared scale — the
     last section on the page ---------- */
  const leaveSec = ovSection("Leave by type", "Bar length is comparable across leave types; segments break each one down by board");
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
  panel.appendChild(leaveSec);

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
    D().areas.map(a => `<option value="${a.id}">${a.name}</option>`).join("");
  $("#emplist-bulk-board").innerHTML = `<option value="">Move to board…</option>` +
    D().boards.map(b => `<option value="${b.id}">${b.name}</option>`).join("");
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
      default: return e.name;
    }
  };
  emps.sort((a, b) => sortVal(a).localeCompare(sortVal(b)) * sortDir || a.name.localeCompare(b.name));
  return emps;
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
    const tr = document.createElement("tr");
    tr.dataset.empId = e.id;
    if (state.selectedEmps.has(e.id)) tr.classList.add("selected");
    tr.innerHTML = `
      <td class="el-check"><input type="checkbox" ${state.selectedEmps.has(e.id) ? "checked" : ""}></td>
      <td>${e.name}</td>
      <td>${e.contract === "oncall" ? "On-call" : "Permanent"}</td>
      <td>${pos ? pos.label : "—"}</td>
      <td>${e.phone || "—"}</td>
      <td>${area ? `<span class="area-pill" style="background:${area.color}">${area.name}</span>` : "—"}</td>
      <td>${board ? board.name : "—"}</td>`;
    tr.querySelector(".el-check input").onchange = (ev) => {
      ev.target.checked ? state.selectedEmps.add(e.id) : state.selectedEmps.delete(e.id);
      tr.classList.toggle("selected", ev.target.checked);
      updateEmplistBulkBar();
      $("#emplist-select-all").checked = emps.length > 0 && emps.every(x => state.selectedEmps.has(x.id));
    };
    tr.addEventListener("dblclick", () => guardEdit(() => openEmployeeModal(e.id)));
    tr.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      if (!state.selectedEmps.has(e.id)) selectOnly(e.id);
      showContextMenu(e, ev.clientX, ev.clientY);
    });
    body.appendChild(tr);
  }
  $("#emplist-count").textContent = `${emps.length} of ${D().employees.length}`;
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
function currentAssignmentOf(empId) {
  const plan = getPlan();
  for (const m of plan.missions) if (m.members.includes(empId)) return { missionId: m.id };
  for (const z of ZONES) if (plan.zones[z].includes(empId)) return { zone: z };
  return null;
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
  form.engineerId.innerHTML = D().engineers.map(e => `<option value="${e.id}">${e.name}</option>`).join("");
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
    alert(dup.hidden
      ? `A hidden mission "${vals.number}" already exists on the ${shiftLabel} shift for this date. Use "👁 Hide/Unhide" to unhide and reuse it, or pick a different shift.`
      : `A mission "${vals.number}" already exists on the ${shiftLabel} shift for this date. Use a different shift, or edit the existing mission instead.`);
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
  $("#btn-delete-employee").classList.toggle("hidden", !empId);
  form.areaId.innerHTML = D().areas.map(a => `<option value="${a.id}">${a.name}</option>`).join("");
  form.boardId.innerHTML = D().boards.map(b => `<option value="${b.id}">${b.name}</option>`).join("");
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
    alert(`An employee named "${vals.name}" already exists. Use a different name (e.g. add an ID/initial) to tell them apart.`);
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

function deleteEmployee() {
  const e = D().employees.find(x => x.id === state.editingEmployeeId);
  showConfirm("Delete employee?", `Delete ${e.name}? This removes them from every mission/zone assignment, past and future.`, () => {
    safely(async () => {
      await cloud.deleteEmployee(state.editingEmployeeId);
      await refreshAndRender();
    });
  });
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
  for (const g of groups) {
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
    if (!g.list.length) body.innerHTML = `<span class="fp-empty">None</span>`;
    zone.appendChild(lab);
    zone.appendChild(body);
    sec.appendChild(zone);
  }
  return sec;
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
  // temporarily fold the available pools into the captured board — but not on a
  // holiday, where only the employees actually assigned to work should show up
  // (standby/available on-call are meaningless when nobody is expected in)
  let pools = null;
  if (!isOverview() && !isNonWorkingDate(state.date)) {
    pools = buildExportPools();
    $("#status-zones").insertAdjacentElement("afterend", pools);
  }
  try {
    await document.fonts.ready;   // avoid capturing the fallback font mid-swap
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
    if (pools) pools.remove();
    $("#capture-header").classList.add("hidden");
    document.body.classList.remove("exporting");
    btn.disabled = false;
    btn.textContent = "📷 Export";
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
          <span class="import-info"><b>${m.number}</b> — ${m.host} → ${m.customer}
          <small>${m.shift === "night" ? "Night" : "Day"} ${m.startTime}-${m.endTime}${eng ? " • " + eng.name : ""}</small></span>`;
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
      alert(`${result.added} mission(s) added. ${result.skipped} already existed on this date/shift and were skipped.`);
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
        <span class="import-info"><b>${m.number}</b> — ${m.host} → ${m.customer}
        <small>${m.shift === "night" ? "Night" : "Day"} ${m.startTime}-${m.endTime}${eng ? " • " + eng.name : ""} • ${m.members.length} assigned</small></span>`;
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
  showConfirm("Reset board?",
    `This will replace ${fmtDow(state.date)} ${fmtDate(state.date)} on ${boardName} with a fresh copy of the last working day's plan — its missions and employee assignments. Any changes already made to this day will be overwritten. Continue?`,
    () => safely(async () => {
      const src = await cloud.resetBoardFromLastWorkingDay(D().activeBoardId, state.date);
      await refreshAndRender();
      if (!src) alert("No previous working-day plan was found to copy from.");
    }));
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
  $("#btn-new-mission").onclick = () => guardEdit(() => openMissionModal(null));
  $("#btn-new-employee").onclick = () => guardEdit(() => openEmployeeModal(null));
  $("#form-mission").onsubmit = saveMission;
  $("#form-employee").onsubmit = saveEmployee;
  $("#btn-delete-mission").onclick = deleteMission;
  $("#btn-hide-mission").onclick = hideMission;
  $("#btn-hide-missions").onclick = openHideMissionsModal;
  $("#btn-hide-missions-save").onclick = saveHideMissions;
  $("#btn-delete-employee").onclick = deleteEmployee;

  $("#btn-settings").onclick = () => { renderSettings(); openModal("#modal-settings"); };
  for (const btn of $$("#settings-tabs .settings-tab")) {
    btn.onclick = () => { state.settingsTab = btn.dataset.tab; applySettingsTab(); };
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
  $("#emplist-bulk-delete").onclick = () => {
    const ids = [...state.selectedEmps];
    if (!ids.length) return;
    showConfirm("Delete employees?",
      `Delete ${ids.length} selected employee${ids.length === 1 ? "" : "s"}? This removes them from every mission/zone assignment, past and future.`,
      () => safely(async () => { await cloud.deleteEmployees(ids); state.selectedEmps = new Set(); await refreshAndRender(); }));
  };
  $("#emplist-bulk-clear").onclick = clearSelection;

  // dismiss context menu / date picker on any outside click or Escape
  document.addEventListener("click", (ev) => {
    hideContextMenu();
    if (!ev.target.closest("#datepicker-pop") && !ev.target.closest("#btn-date")) hideDatePicker();
    if (!ev.target.closest("#filters .ms") && !ev.target.closest("#emplist-filters .ms")) closeFilterPops();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { hideContextMenu(); hideDatePicker(); closeFilterPops(); clearSelection(); closeModal(); }
    // Ctrl/Cmd+Z = undo last assignment change (ignore while typing in a field)
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !/^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) {
      ev.preventDefault();
      undoLast();
    }
  });
  window.addEventListener("scroll", hideContextMenu, true);

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
  wireApp();
  await cloud.init(() => state.date);
  // holidays are known now — restore the last board/date the user was on, falling
  // back to the next working day if there's nothing saved (or it's stale/invalid)
  restoreViewState();
  cloud.onChange(() => { state.overview.utilCacheKey = null; refreshAndRender(); });
  await refreshAndRender();
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
