/* Present mode (Overview and Board tab).
   A read-only, large-type view for a meeting room or a wall screen.
     - Overview: slides, one section per screen (Today, Idle people, Boards, Trend), moved with the arrow
       keys, a clicker or the dots. Built from the SAME functions the Overview draws from (boardStats,
       rosterEmployees, utilizationPct, aggregateMetricPoint) and from the board selector's scope
       (ovScopeBoards), so the numbers cannot drift from the page. A section the role cannot see has no slide:
       Today needs "Attention card: headline", Idle people "Attention card: idle names", Boards "By board",
       Trend the KPI tiles. Present mode adds no permission of its own.
     - Board tab: the board itself with the banner and toolbar removed, bigger, and nothing editable
       (pointer events are off and keys are swallowed). ← → switch board.
   Names show by default (Show names switch in the top bar, which appears when the pointer moves; the choice
   is remembered on this device). Esc leaves, and so does Exit. The screen goes full screen where the browser
   allows it and is kept awake. Slides follow live data: render() in app.js calls Present.redraw().
   Loaded after app.js: it reads that file's globals when it runs, never while it loads. */
"use strict";

const Present = (() => {
  const KEY = "manpower.present";
  const SLIDES = [["today", "Today", "ov.status"], ["idle", "Idle people", "ov.actionQueue"], ["boards", "Boards", "ov.byBoard"], ["trend", "Trend", "ov.kpi"]];
  const IDLE_SHOWN = 24;      // names per board on the Idle slide; the rest read "+N more"
  const HIDE_MS = 2600;       // how long the top bar stays after the pointer stops
  const e = escapeHtml;
  let run = null;             // { kind: "overview" | "board", slides: [keys], i, names, t0 }
  let wake = null, hideTimer = 0, draft = null;

  /* ---------- what is remembered ---------- */
  function load() {
    const d = { slides: SLIDES.map(s => s[0]), names: true };
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!s) return d;
      return { slides: Array.isArray(s.slides) ? s.slides.filter(k => d.slides.includes(k)) : d.slides, names: s.names !== false };
    } catch (err) { return d; }
  }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (err) { /* remembering is a courtesy */ } }

  /* ---------- what may be presented ---------- */
  const available = () => SLIDES.filter(s => can(s[2]));
  const slideName = (k) => (SLIDES.find(s => s[0] === k) || [0, k])[1];
  function canPresent() {
    if (isOverview()) return available().length > 0;
    if (isNonBoardView()) return false;
    return !isForecastView();   // a forecast is tentative: like Export, it is never put on a screen
  }
  const active = () => !!run;

  /* ---------- the start sheet ---------- */
  function open() {
    if (run) return;
    if (!canPresent()) { toast("There is nothing to present on this tab.", "info"); return; }
    const p = load();
    const ov = isOverview();
    const av = available().map(s => s[0]);
    draft = { slides: p.slides.filter(k => av.includes(k)), names: p.names };
    if (ov && !draft.slides.length) draft.slides = av.slice();
    renderSheet(ov, av);
    openModal("#modal-present");
  }
  function renderSheet(ov, av) {
    const body = $("#present-body");
    const seg = (id, label, on) => `<button type="button" class="btn btn-small${on ? " active" : ""}" id="${id}" aria-pressed="${on}">${label}</button>`;
    let scope;
    if (ov) {
      const boards = ovScopeBoards();
      const all = boards.length === D().boards.length;
      scope = `<div class="form-group">Boards</div>
        <p class="rp-scope"><b${all ? "" : " data-no-i18n"}>${e(ovScopeLabel(boards))}</b> <small>(the Board picker)</small></p>
        <div class="form-group">Slides</div>
        ${SLIDES.filter(s => av.includes(s[0])).map(([k, l]) => `<label class="import-row"><input type="checkbox" id="pr-sl-${k}" data-slide="${k}"${draft.slides.includes(k) ? " checked" : ""}><span class="import-info">${l}</span></label>`).join("")}`;
    } else {
      const b = D().boards.find(x => x.id === D().activeBoardId);
      scope = `<div class="form-group">Board</div>
        <p class="rp-scope"><b data-no-i18n>${e(b ? b.name : "")}</b> <small>${e(fmtDow(state.date))} ${e(fmtDate(state.date))}</small></p>`;
    }
    body.innerHTML = scope + `
      <div class="form-group">Names</div>
      <div class="ov-trend-btns" role="group" aria-label="Names">${seg("pr-names-show", "Show", draft.names)}${seg("pr-names-hide", "Hide", !draft.names)}</div>
      <p class="import-note">${ov ? "Slides are read-only. ← → move between slides, Esc leaves." : "The board is read-only while you present. ← → switch board, Esc leaves."}</p>`;
    const setNames = (v) => { draft.names = v; $("#pr-names-show").classList.toggle("active", v); $("#pr-names-show").setAttribute("aria-pressed", String(v));
      $("#pr-names-hide").classList.toggle("active", !v); $("#pr-names-hide").setAttribute("aria-pressed", String(!v)); };
    $("#pr-names-show").onclick = () => setNames(true);
    $("#pr-names-hide").onclick = () => setNames(false);
    for (const cb of body.querySelectorAll("input[data-slide]")) {
      cb.onchange = () => {
        draft.slides = [...body.querySelectorAll("input[data-slide]")].filter(x => x.checked).map(x => x.dataset.slide);
        $("#btn-present-go").disabled = ov && !draft.slides.length;
      };
    }
    $("#btn-present-go").disabled = ov && !draft.slides.length;
  }
  function go() {
    if (!draft) return;
    const ov = isOverview();
    const order = SLIDES.map(s => s[0]);
    const slides = ov ? order.filter(k => draft.slides.includes(k)) : [];
    if (ov && !slides.length) return;
    save({ slides: ov ? slides : load().slides, names: draft.names });
    closeModal();
    start({ kind: ov ? "overview" : "board", slides, names: draft.names });
  }

  /* ---------- running ---------- */
  function start(opts) {
    run = { kind: opts.kind, slides: opts.slides, i: 0, names: opts.names, t0: Date.now(), fs: false };
    const b = document.body;
    b.classList.add("presenting", run.kind === "board" ? "presenting-board" : "presenting-overview");
    b.classList.toggle("pres-hide-names", !run.names);
    const host = document.createElement("div");
    host.id = "present-root";
    host.innerHTML = `<div class="pr-hover" role="toolbar" aria-label="Presenting"></div>` + (run.kind === "board" ? `<div class="pr-id"></div>` : "") + (run.kind === "overview"
      ? `<div id="present-stage" class="pr-stage" tabindex="-1" role="dialog" aria-modal="true" aria-label="Presenting"><div class="pr-slide"></div><div class="pr-nav"></div></div>` : "");
    b.appendChild(host);
    host.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointermove", showBar, { passive: true });
    window.addEventListener("pointerdown", showBar, { passive: true });
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("visibilitychange", onVis);
    draw();
    showBar();
    // full screen needs the click that started us; a browser (or an iPhone) that refuses still presents, just in the window
    try {
      const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
      if (p && p.then) p.then(() => { if (run) run.fs = true; }, () => {});
    } catch (err) { /* window only */ }
    holdAwake();
    const st = $("#present-stage");
    if (st) st.focus({ preventScroll: true });
    if (run.kind === "board") render();   // lay the board out again without the toolbar
  }
  function exit() {
    if (!run) return;
    const kind = run.kind;
    run = null;
    clearTimeout(hideTimer);
    const b = document.body;
    b.classList.remove("presenting", "presenting-board", "presenting-overview", "pres-hide-names", "pr-bar-on");
    const host = $("#present-root");
    if (host) host.remove();
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointermove", showBar);
    window.removeEventListener("pointerdown", showBar);
    document.removeEventListener("fullscreenchange", onFs);
    document.removeEventListener("visibilitychange", onVis);
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch (err) { /* already out */ }
    releaseAwake();
    if (kind === "board") render();
  }
  function onFs() {
    // Esc in full screen leaves full screen first and the page never sees the key: that is "leave" too
    if (run && run.fs && !document.fullscreenElement) exit();
  }
  async function holdAwake() {
    try { if (run && navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { wake = null; }); } } catch (err) { /* asked, not given */ }
  }
  function releaseAwake() { try { if (wake) wake.release(); } catch (err) { /* gone already */ } wake = null; }
  function onVis() { if (run && !document.hidden) holdAwake(); }

  /* the top bar shows when the pointer moves, and stays while a button in it has focus */
  function showBar() {
    if (!run) return;
    document.body.classList.add("pr-bar-on");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const bar = $(".pr-hover");
      if (bar && bar.contains(document.activeElement) && document.activeElement.matches(":focus-visible")) return;
      document.body.classList.remove("pr-bar-on");
    }, HIDE_MS);
  }

  /* ← → and friends move on; everything else is kept away from the page underneath (no Ctrl+Z on a shared screen) */
  function onKey(ev) {
    if (!run) return;
    const k = ev.key;
    const mod = ev.ctrlKey || ev.metaKey || ev.altKey;
    if (k === "Escape") { ev.preventDefault(); ev.stopImmediatePropagation(); exit(); return; }
    if (k === "Tab" || mod && !/^(z|y|x|c|v|a)$/i.test(k)) return;   // Tab reaches the bar; browser shortcuts (reload, zoom) still work
    ev.stopImmediatePropagation();
    if (ev.target && ev.target.closest && ev.target.closest(".pr-hover") && (k === "Enter" || k === " ")) return;   // a focused button in the bar keeps its keys
    let handled = true;
    if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter") step(1);
    else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") step(-1);
    else if (k === "Home") jump(0);
    else if (k === "End") jump(run.kind === "overview" ? run.slides.length - 1 : D().boards.length - 1);
    else if (/^[1-9]$/.test(k) && run.kind === "overview" && +k <= run.slides.length) jump(+k - 1);
    else if (k === "n" || k === "N") setNames(!run.names);
    else handled = false;
    if (handled) { ev.preventDefault(); showBar(); }
  }
  function step(d) {
    if (run.kind === "overview") jump((run.i + d + run.slides.length) % run.slides.length);
    else {
      const ids = D().boards.map(b => b.id);
      if (ids.length < 2) return;
      const at = ids.indexOf(D().activeBoardId);
      D().activeBoardId = ids[(at + d + ids.length) % ids.length];
      refreshAndRender();
    }
  }
  function jump(i) {
    if (run.kind === "overview") { run.i = Math.max(0, Math.min(run.slides.length - 1, i)); draw(); }
    else { const b = D().boards[i]; if (b) { D().activeBoardId = b.id; refreshAndRender(); } }
  }
  function setNames(v) {
    run.names = v;
    document.body.classList.toggle("pres-hide-names", !v);
    const p = load(); p.names = v; save(p);
    draw();
  }
  function onClick(ev) {
    const t = ev.target.closest("[data-pa]");
    if (!t || !run) return;
    const a = t.dataset.pa;
    if (a === "exit") exit();
    else if (a === "names") setNames(!run.names);
    else if (a === "next") step(1);
    else if (a === "prev") step(-1);
    else if (a === "go") jump(+t.dataset.i);
  }

  /* ---------- drawing ---------- */
  function scopeText() {
    if (run.kind === "board") { const b = D().boards.find(x => x.id === D().activeBoardId); return { text: b ? b.name : "", data: true }; }
    const boards = ovScopeBoards();
    return { text: ovScopeLabel(boards), data: boards.length !== D().boards.length };
  }
  function drawBar() {
    const bar = $(".pr-hover");
    if (!bar) return;
    const sc = scopeText();
    // a board has no slide heading: its name and day stay on screen in a strip, even when the top bar is away
    const id = $(".pr-id");
    if (id) id.innerHTML = `<b${sc.data ? " data-no-i18n" : ""}>${e(sc.text)}</b><span>${e(fmtDow(state.date))} ${e(fmtDate(state.date))}</span>`;
    bar.innerHTML = `<b>Presenting</b><span class="pr-sc"${sc.data ? " data-no-i18n" : ""}>${e(sc.text)}</span><span>${e(fmtDow(state.date))} ${e(fmtDate(state.date))}</span>`
      + ((run.kind === "board" && D().boards.length > 1) ? `<button type="button" class="pr-btn" data-pa="prev" aria-label="Previous board">${icon("chevron-left")}</button><button type="button" class="pr-btn" data-pa="next" aria-label="Next board">${icon("chevron-right")}</button>` : "")
      + `<button type="button" class="pr-tg" data-pa="names" aria-pressed="${run.names}"><span class="pr-tgb"></span>Show names</button>`
      + `<button type="button" class="pr-x" data-pa="exit">Exit · Esc</button>`;
  }
  function draw() {
    if (!run) return;
    drawBar();
    if (run.kind !== "overview") return;
    const st = $("#present-stage");
    if (!st) return;
    const key = run.slides[run.i];
    st.querySelector(".pr-slide").innerHTML = SLIDE_HTML[key]();
    const dots = run.slides.map((k, i) => `<button type="button" data-pa="go" data-i="${i}" aria-label="Slide ${i + 1}: ${e(slideName(k))}"${i === run.i ? ' aria-current="true"' : ""}></button>`).join("");
    st.querySelector(".pr-nav").innerHTML = `<button type="button" data-pa="prev" aria-label="Previous slide">${icon("chevron-left")}</button>`
      + `<span class="pr-count"><span class="num">${run.i + 1} / ${run.slides.length}</span> · <span>${slideName(key)}</span></span><span class="pr-dots">${dots}</span>`
      + `<button type="button" data-pa="next" aria-label="Next slide">${icon("chevron-right")}</button>`;
  }
  /* called from render(): the data moved, so the slide in front moves with it */
  function redraw() { if (run) draw(); }

  /* ---------- the slides ---------- */
  function figures() {
    const boards = ovScopeBoards();
    const scoped = boards.length !== D().boards.length;
    const stats = boards.map(b => ({ b, st: boardStats(b.id) }));
    const sum = (k) => stats.reduce((n, x) => n + x.st[k], 0);
    const roster = scoped ? boards.flatMap(b => rosterEmployees(b.id)) : D().employees.filter(onRoster);
    // boardStats' dayMissions / nightMissions are a HEADCOUNT of the people on each shift, so they are the crew; the missions
    // themselves are counted from the visible ones on the boards in scope, as the Overview's attention card does
    const todays = boards.flatMap(b => peekPlan(b.id).missions.filter(m => !m.hidden));
    const dayMissions = todays.filter(m => m.shift !== "night").length;
    const f = { boards, scoped, stats, total: roster.length, assigned: sum("assigned"), leave: sum("leave"), standby: sum("standby"),
      holiday: sum("onHoliday"), free: sum("oncallAvailable"), missions: sum("missions"),
      dayMissions, nightMissions: todays.length - dayMissions, dayCrew: sum("dayMissions"), nightCrew: sum("nightMissions") };
    f.util = utilizationPct(f.assigned, f.total, f.leave, f.holiday, f.free);
    return f;
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const head = (f) => `<div class="pr-bar2"><b>Overview</b><span>${e(fmtDow(state.date))} ${e(fmtDate(state.date))}</span><span class="pr-sc"${f.scoped ? " data-no-i18n" : ""}>· ${e(ovScopeLabel(f.boards))}</span></div>`;
  const boardColor = (b) => Charts.catColor(D().boards.indexOf(b));

  const SLIDE_HTML = {
    today() {
      const f = figures();
      const title = !f.standby ? "All permanent staff are on a mission" : f.standby === 1 ? "1 permanent staff member has no mission" : `${f.standby} permanent staff have no mission`;
      const tile = (label, value) => `<div class="pr-tile"><div class="k">${label}</div><div class="v num">${value}</div></div>`;
      return head(f) + `<div class="pr-h${f.standby ? "" : " ok"}">${title}</div>`
        + `<div class="pr-sub"><span><b>Day:</b> ${plural(f.dayMissions, "mission", "missions")} · <b>${f.dayCrew}</b> crew</span>`
        + `<span><b>Night:</b> ${plural(f.nightMissions, "mission", "missions")} · <b>${f.nightCrew}</b> crew</span></div>`
        + `<div class="pr-tiles">${tile("Utilization", f.util + "%")}${tile("Deployed on a mission", `${f.assigned}<small> / ${f.total}</small>`)}${tile("Missions", f.missions)}${tile("On-call free", f.free)}</div>`;
    },
    idle() {
      const f = figures();
      const groups = f.stats.filter(x => x.st.availableList.length).map(x => {
        const list = x.st.availableList.slice().sort((a, b) => a.name.localeCompare(b.name));
        const chips = list.slice(0, IDLE_SHOWN).map(emp => run.names ? `<span class="pr-chip" data-no-i18n>${e(emp.name)}</span>` : `<span class="pr-chip priv" aria-hidden="true">•••</span>`).join("");
        const more = list.length > IDLE_SHOWN ? `<span class="pr-chip more">+${list.length - IDLE_SHOWN} more</span>` : "";
        return `<div class="pr-group"><h6><i class="pr-dot" style="background:${e(boardColor(x.b))}"></i><span data-no-i18n>${e(x.b.name)}</span><span class="n">${list.length} idle</span></h6><div class="pr-chips">${chips}${more}</div></div>`;
      }).join("");
      return head(f) + `<div class="pr-title">Idle people</div>`
        + (groups ? `<div class="pr-groups">${groups}</div>` : `<p class="pr-empty">All permanent staff are on a mission</p>`);
    },
    boards() {
      const f = figures();
      const rows = f.stats.map(({ b, st }) => {
        const pct = st.total ? Math.round(st.assigned / st.total * 100) : 0;
        return `<div class="pr-brow"><span class="nmx"><i class="pr-dot" style="background:${e(boardColor(b))}"></i><span data-no-i18n>${e(b.name)}</span></span><span class="bar"><i style="width:${pct}%;background:${e(boardColor(b))}"></i></span><span class="r num">${st.assigned} / ${st.total}</span><span class="r num">${utilizationPct(st.assigned, st.total, st.leave, st.onHoliday, st.oncallAvailable)}%</span></div>`;
      }).join("");
      return head(f) + `<div class="pr-title">Boards</div><div class="pr-brows">${rows}</div>`;
    },
    trend() {
      const f = figures();
      const util = state.overview.util || {};
      const toDate = state.date, fromDate = addDays(toDate, -(state.overview.trendRange - 1));
      const pts = [];
      for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
        if (f.boards.every(b => isNonWorkingDate(d, b.id))) continue;
        const v = aggregateMetricPoint("util", d, f.boards, util);
        if (v != null) pts.push({ d, v });
      }
      let chart;
      if (pts.length < 2) chart = `<p class="pr-empty">Not enough working days yet to show a trend</p>`;
      else {
        const vals = pts.map(p => p.v);
        const lo = Math.max(0, Math.floor((Math.min(...vals) - 3) / 5) * 5), hi = Math.min(100, Math.max(lo + 10, Math.ceil((Math.max(...vals) + 3) / 5) * 5));
        const W = 300, H = 100, pad = 6;
        const xy = pts.map((p, i) => [i * W / (pts.length - 1), H - pad - (p.v - lo) / (hi - lo) * (H - 2 * pad)]);
        const line = xy.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" "), last = xy[xy.length - 1];
        const grid = [0.25, 0.5, 0.75].map(fr => { const y = pad + fr * (H - 2 * pad); return `<line x1="0" x2="${W}" y1="${y}" y2="${y}" class="g" vector-effect="non-scaling-stroke"/>`; }).join("");
        chart = `<div class="pr-chart"><div class="yl"><span>${hi}%</span><span>${lo}%</span></div>`
          + `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Utilization, ${pts.length} working days, from ${vals[0]}% to ${vals[vals.length - 1]}%">${grid}`
          + `<path d="M0,${H - pad} L${line.replace(/ /g, " L")} L${W},${H - pad} Z" class="a"/><polyline points="${line}" class="l" vector-effect="non-scaling-stroke"/>`
          + `<path d="M${last[0]},${last[1]} l0,0" class="e1" vector-effect="non-scaling-stroke"/><path d="M${last[0]},${last[1]} l0,0" class="e2" vector-effect="non-scaling-stroke"/></svg>`
          + `<div class="xl"><span>${e(fmtDate(pts[0].d))}</span><span>${e(fmtDate(pts[pts.length - 1].d))}</span></div></div>`;
      }
      return head(f) + `<div class="pr-title">Utilization</div>` + chart;
    },
  };

  return { open, go, canPresent, available, active, redraw, exit };
})();
