/* Present mode (Overview and Board tab).
   A read-only, large-type view for a meeting room or a wall screen.
     - Overview: the page's OWN sections, one per slide, on a stage. The Overview panel itself is moved onto the
       stage, laid out at BASE_W and scaled to fit, so a slide is the real section (the numbers, the charts and the
       filters cannot drift from the page) and its buttons are live: Group by, the History tiles, People's views and
       the rest change what the slide shows and nothing else. Slides (data-pslide, set in renderOverview):
         In detail  By engineer, By service area, Shifts and Host coverage: the page's own group
         Period     History, People, Engineer workload, Workforce, Boards & areas
       A slide needs the Overview permission of its section ("In detail": any of its four; Period: "History + Engineer
       workload"). Present adds no permission of its own.
       The stage header carries the board chips (they set the board selector) and, on a Period slide, the period strip
       (range, Compare with, board View). Filters changed while presenting are put back when you leave, or with Reset
       filters. A click only reaches a control marked live (LIVE below): anything else, such as a day, a name or an
       arrow that would open a board or a profile, does nothing. A slide taller than the screen scrolls (↑ ↓).
       Keys: ← → move, 1-6 jump, B next board, G Group by, C Compare, M next tile, ↑ ↓ scroll, N names, ? keys, Esc leave.
     - Board tab: the board itself with the banner and toolbar removed, bigger, and nothing editable
       (pointer events are off and keys are swallowed). ← → switch board.
   Names show by default (Show names switch in the top bar, which appears when the pointer moves; the choice is
   remembered on this device). Hiding them replaces every staff name on a slide, in its text and its tooltips, with
   dots. Esc leaves, and so does Exit. The screen goes full screen where the browser allows it and is kept awake.
   Slides follow live data: render() in app.js calls Present.redraw(). Loaded after app.js: it reads that file's
   globals when it runs, never while it loads. */
"use strict";

const Present = (() => {
  const KEY = "manpower.present";
  const SLIDES = [
    { key: "detail",    label: "In detail",         chapter: "In detail", perms: ["ov.byEngineer", "ov.byArea", "ov.dayNight", "ov.hostRisk"] },
    { key: "history",   label: "History",           chapter: "Period",    perms: ["ov.history"] },
    { key: "people",    label: "People",            chapter: "Period",    perms: ["ov.history"] },
    { key: "engineer",  label: "Engineer workload", chapter: "Period",    perms: ["ov.history"] },
    { key: "workforce", label: "Workforce",         chapter: "Period",    perms: ["ov.history"] },
    { key: "areas",     label: "Boards & areas",    chapter: "Period",    perms: ["ov.history"] },
  ];
  const CHAPTERS = ["In detail", "Period"];
  const BASE_W = 1280;        // the width the page's sections are laid out at, then scaled to the stage
  const K_MIN = 1.3;          // a slide is never scaled below this (text stays readable from the back of the room); a taller one scrolls
  const NARROW = 700;         // a stage narrower than this (a phone) shows the sections at their own width and scrolls
  const GUTTER = 28;          // px kept clear at each side of a scaled slide
  const HIDE_MS = 2600;       // how long the top bar stays after the pointer stops
  const NOTE_MS = 2600;
  /* what a click may reach on a slide (default deny). Everything here only changes what is shown. A day, a name, a
     row's arrow, "See all hosts" and "Show all" are left out on purpose: they open a board or a profile, or print
     a table that cannot fit. */
  const LIVE = [".ov-trend-btns .btn", ".ov-htile", ".ov-lv-chip", ".ov-wf-chip", ".ov-band", ".ov-flagrow", "[data-pslide=\"people\"] [data-date]", ".ov-band-chip .ov-linkbtn", ".ov-sort",
    ".ov-eng-select", "tr[data-eng]", ".ov-small-head .ov-linkbtn", ".ov-ba-table tr[data-i]", ".ov-ba-loans > .ov-linkbtn"].join(",");
  /* the Overview state a presenter can change, put back when they leave */
  const FIELDS = ["boardIds", "period", "historyPreset", "historyFrom", "historyTo", "historyMeasure", "historyLeaveView", "historyLeaveHidden",
    "historyGroup", "historyCompare", "historyOncallMode", "historyDeployedBy", "historyDeployedShow", "historyDeployedStyle", "historyAreaHidden", "baView", "baLoansOpen", "wfWindow", "wfHidden", "pplView", "pplWho", "pplChart",
    "pplPick", "pplSort", "pplAll", "engPick", "engGroup", "engMeasure"];
  const e = escapeHtml;
  let run = null;             // { kind: "overview" | "board", slides: [keys], i, names, t0, fs, snap, orig, home, keys }
  let wake = null, hideTimer = 0, noteTimer = 0, draft = null;

  /* ---------- what is remembered ---------- */
  function load() {
    const d = { slides: SLIDES.map(s => s.key), names: true };
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!s) return d;
      return { slides: Array.isArray(s.slides) ? s.slides.filter(k => d.slides.includes(k)) : d.slides, names: s.names !== false };
    } catch (err) { return d; }
  }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (err) { /* remembering is a courtesy */ } }

  /* ---------- what may be presented ---------- */
  const available = () => SLIDES.filter(s => s.perms.some(a => can(a)));
  const slideOf = (k) => SLIDES.find(s => s.key === k) || SLIDES[0];
  const isPeriod = (k) => slideOf(k).chapter === "Period";
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
    const av = available().map(s => s.key);
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
        <p class="rp-scope"><b${all ? "" : " data-no-i18n"}>${e(ovScopeLabel(boards))}</b> <small>(the Board picker; change it live with the chips on the screen)</small></p>
        <div class="form-group">Slides</div>
        ${SLIDES.filter(s => av.includes(s.key)).map(s => `<label class="import-row"><input type="checkbox" id="pr-sl-${s.key}" data-slide="${s.key}"${draft.slides.includes(s.key) ? " checked" : ""}><span class="import-info">${s.label} <small>${s.chapter}</small></span></label>`).join("")}`;
    } else {
      const b = D().boards.find(x => x.id === D().activeBoardId);
      scope = `<div class="form-group">Board</div>
        <p class="rp-scope"><b data-no-i18n>${e(b ? b.name : "")}</b> <small>${e(fmtDow(state.date))} ${e(fmtDate(state.date))}</small></p>`;
    }
    body.innerHTML = scope + `
      <div class="form-group">Names</div>
      <div class="ov-trend-btns" role="group" aria-label="Names">${seg("pr-names-show", "Show", draft.names)}${seg("pr-names-hide", "Hide", !draft.names)}</div>
      <p class="import-note">${ov ? "Filters on the slides work while you present. When you leave they go back as they were. ← → move between slides, Esc leaves." : "The board is read-only while you present. ← → switch board, Esc leaves."}</p>`;
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
    const order = SLIDES.map(s => s.key);
    const slides = ov ? order.filter(k => draft.slides.includes(k)) : [];
    if (ov && !slides.length) return;
    save({ slides: ov ? slides : load().slides, names: draft.names });
    closeModal();
    start({ kind: ov ? "overview" : "board", slides, names: draft.names });
  }

  /* ---------- the filters a presenter can change ---------- */
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  function pick() { const ov = state.overview, o = {}; for (const k of FIELDS) o[k] = clone(ov[k]); return o; }
  const changed = () => !!run && !!run.snap && JSON.stringify(pick()) !== run.snapJson;
  /* puts the fields back, and the two that are saved on the device; true when the History range moved (it is fetched again) */
  function restore(s) {
    const ov = state.overview;
    const ranged = ov.historyFrom !== s.historyFrom || ov.historyTo !== s.historyTo || ov.historyPreset !== s.historyPreset;
    for (const k of FIELDS) { if (s[k] === undefined) delete ov[k]; else ov[k] = clone(s[k]); }
    try {
      localStorage.setItem("manpower.ovBoard", (s.boardIds || []).join(","));
      localStorage.setItem(OV_PERIOD_KEY, JSON.stringify(s.period));
    } catch (err) { /* not remembered */ }
    if (ranged) ov.historyCacheKey = null;
    return ranged;
  }
  const renderAfter = (ranged) => (ranged ? refreshAndRender() : render());

  /* ---------- running ---------- */
  function start(opts) {
    run = { kind: opts.kind, slides: opts.slides, i: 0, names: opts.names, t0: Date.now(), fs: false, snap: null, snapJson: "", orig: null, home: null, keys: false };
    const b = document.body;
    b.classList.add("presenting", run.kind === "board" ? "presenting-board" : "presenting-overview");
    b.classList.toggle("pres-hide-names", !run.names);
    const host = document.createElement("div");
    host.id = "present-root";
    host.innerHTML = `<div class="pr-hover" role="toolbar" aria-label="Presenting"></div>` + (run.kind === "board" ? `<div class="pr-id"></div>` : "") + (run.kind === "overview"
      ? `<div id="present-stage" class="pr-stage" tabindex="-1" role="dialog" aria-modal="true" aria-label="Presenting">
          <div class="pr-head"></div><div class="pr-scroll"><div class="pr-fit"></div></div>
          <div class="pr-more" hidden aria-hidden="true">More below ↓</div><div class="pr-note" role="status"></div><div class="pr-keys" hidden></div><div class="pr-nav"></div></div>` : "");
    b.appendChild(host);
    host.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointermove", showBar, { passive: true });
    window.addEventListener("pointerdown", showBar, { passive: true });
    window.addEventListener("resize", layout);
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("visibilitychange", onVis);
    if (run.kind === "overview") {
      const panel = $("#overview-panel");
      run.home = { parent: panel.parentNode, next: panel.nextSibling };
      run.orig = pick();
      // the Period follows the stage's board chips while presenting (it is put back on leaving)
      if (!state.overview.period.linked) state.overview.period.linked = true;
      run.snap = pick();
      run.snapJson = JSON.stringify(run.snap);
      $(".pr-fit").appendChild(panel);
      const sc = $(".pr-scroll");
      sc.addEventListener("click", onCanvasClick, true);
      sc.addEventListener("scroll", cue, { passive: true });
    }
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
    render();   // draws the page again for the stage: the board without its toolbar, the sections at the stage's width
  }
  function exit() {
    if (!run) return;
    const kind = run.kind, orig = run.orig, home = run.home;
    run = null;
    clearTimeout(hideTimer); clearTimeout(noteTimer);
    const b = document.body;
    b.classList.remove("presenting", "presenting-board", "presenting-overview", "pres-hide-names", "pr-bar-on");
    if (kind === "overview") {
      // the panel goes back where it was before the stage (and its host) is thrown away
      const panel = $("#overview-panel");
      panel.style.transform = ""; panel.style.width = "";
      for (const c of panel.children) c.classList.remove("pr-on");
      if (home && home.parent) home.parent.insertBefore(panel, home.next && home.next.parentNode === home.parent ? home.next : null);
    }
    const host = $("#present-root");
    if (host) host.remove();
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointermove", showBar);
    window.removeEventListener("pointerdown", showBar);
    window.removeEventListener("resize", layout);
    document.removeEventListener("fullscreenchange", onFs);
    document.removeEventListener("visibilitychange", onVis);
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch (err) { /* already out */ }
    releaseAwake();
    if (kind === "overview") renderAfter(restore(orig));   // the filters go back as they were
    else render();
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
  /* a short line on the stage: why a key did nothing */
  function note(text) {
    const n = $(".pr-note");
    if (!n) return;
    n.textContent = text;
    n.classList.add("on");
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => n.classList.remove("on"), NOTE_MS);
  }

  /* ← → and friends move on; everything else is kept away from the page underneath (no Ctrl+Z on a shared screen) */
  function onKey(ev) {
    if (!run) return;
    const k = ev.key;
    const mod = ev.ctrlKey || ev.metaKey || ev.altKey;
    if (k === "Escape") { ev.preventDefault(); ev.stopImmediatePropagation(); if (run.keys) toggleKeys(false); else exit(); return; }
    if (k === "Tab" || mod && !/^(z|y|x|c|v|a)$/i.test(k)) return;   // Tab reaches the bar; browser shortcuts (reload, zoom) still work
    ev.stopImmediatePropagation();
    const t = ev.target;
    // a control that has keyboard focus keeps its own keys: Enter and space press it, a drop-down moves
    if (t && t.closest && t.matches(":focus-visible") && ((t.closest(".pr-hover, .pr-head, .pr-scroll") && (k === "Enter" || k === " ")) || t.matches("select"))) return;
    let handled = true;
    if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter") step(1);
    else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") step(-1);
    else if (k === "Home") jump(0);
    else if (k === "End") jump(run.kind === "overview" ? run.slides.length - 1 : D().boards.length - 1);
    else if (/^[1-9]$/.test(k) && run.kind === "overview" && +k <= run.slides.length) jump(+k - 1);
    else if (k === "n" || k === "N") setNames(!run.names);
    else if (run.kind === "overview" && (k === "ArrowUp" || k === "ArrowDown")) scrollBy(k === "ArrowDown" ? 1 : -1);
    else if (run.kind === "overview" && !mod && /^[bgcm]$/i.test(k)) liveKey(k.toLowerCase());
    else if (run.kind === "overview" && k === "?") toggleKeys();
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
    if (run.kind === "overview") {
      run.i = Math.max(0, Math.min(run.slides.length - 1, i));
      const sc = $(".pr-scroll");
      if (sc) sc.scrollTop = 0;
      render();   // draws the page again with the new slide showing, so its charts are measured at the stage's width
    } else { const b = D().boards[i]; if (b) { D().activeBoardId = b.id; refreshAndRender(); } }
  }
  function setNames(v) {
    run.names = v;
    document.body.classList.toggle("pres-hide-names", !v);
    const p = load(); p.names = v; save(p);
    if (run.kind === "overview") render(); else draw();   // showing names again needs the sections drawn afresh
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
    else if (a === "chap") { const at = run.slides.findIndex(k => slideOf(k).chapter === t.dataset.ch); if (at > -1) jump(at); }
    else if (a === "chip") chip(t.dataset.id);
    else if (a === "reset") renderAfter(restore(run.snap));
    else if (a === "keys") toggleKeys();
  }
  /* a click on a slide only reaches a control marked live; anything else would open a board or a profile */
  function onCanvasClick(ev) {
    if (!run || run.kind !== "overview") return;
    if (ev.target.closest("[data-live]")) return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  /* ---------- the boards, and the keys that change a filter ---------- */
  /* All boards is exclusive: from All, a board means only that board; then boards are added and taken away, and none left means All */
  function chip(id) {
    const all = D().boards.map(b => b.id), cur = ovScopeBoards().map(b => b.id), isAll = cur.length === all.length;
    if (id === "all") return setOvBoard("");
    if (isAll) return setOvBoard([id]);
    const next = cur.includes(id) ? cur.filter(x => x !== id) : cur.concat(id);
    setOvBoard(next.length ? next : "");
  }
  const cycle = (list, now) => list[(Math.max(0, list.indexOf(now)) + 1) % list.length];
  function liveKey(k) {
    const ov = state.overview, key = run.slides[run.i];
    if (k === "b") {
      const ids = D().boards.map(b => b.id), cur = ovScopeBoards().map(b => b.id);
      if (ids.length < 2) { note("There is only one board."); return; }
      if (cur.length !== 1) setOvBoard(ids[0]);                                  // all of them, or a few: the first board
      else { const at = ids.indexOf(cur[0]); setOvBoard(at + 1 < ids.length ? ids[at + 1] : ""); }   // then each in turn, then all again
    } else if (k === "g") {
      if (key === "history") { ov.historyGroup = cycle(["day", "week", "month"], ov.historyGroup || "day"); render(); }
      else if (key === "engineer") { ov.engGroup = cycle(["day", "week", "month"], ov.engGroup || "week"); render(); }
      else note("Group by is on the History and Engineer workload slides.");
    } else if (k === "c") {
      if (!isPeriod(key)) note("Compare is on the Period slides.");
      else if (ovPeriodView() === "vs") note("Compare is off while two boards are compared.");
      else { ov.historyCompare = ov.historyCompare === "ly" ? "prev" : "ly"; render(); refreshAndRender(); }   // as its button does: last year is fetched only now
    } else if (k === "m") {
      if (key === "history") { ov.historyMeasure = cycle(OV_HISTORY_MEASURES.map(m => m.key), ov.historyMeasure); render(); }
      else if (key === "engineer") { ov.engMeasure = cycle(OV_ENG_MEASURES.map(m => m.key), ov.engMeasure || "missions"); render(); }
      else note("The tiles are on the History and Engineer workload slides.");
    }
  }
  function scrollBy(dir) {
    const sc = $(".pr-scroll");
    if (sc) sc.scrollBy({ top: dir * Math.round(sc.clientHeight * 0.6), behavior: "smooth" });
  }
  function toggleKeys(on) {
    run.keys = on === undefined ? !run.keys : on;
    const el = $(".pr-keys");
    if (!el) return;
    el.hidden = !run.keys;
    if (run.keys) {
      const row = (ks, t) => `<div><span>${ks.map(x => `<kbd>${x}</kbd>`).join("")}</span><span>${t}</span></div>`;
      el.innerHTML = `<h4>Keys</h4>` + row(["←", "→"], "Previous or next slide") + row(["1", "–", "6"], "Jump to a slide") + row(["Home", "End"], "First or last slide")
        + row(["B"], "Next board, then all again") + row(["G"], "Group by day, week or month") + row(["C"], "Compare with the previous period or last year")
        + row(["M"], "Next tile") + row(["↑", "↓"], "Scroll a tall slide") + row(["N"], "Names on or off") + row(["?"], "This list") + row(["Esc"], "Leave");
    }
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
  /* the stage's header: the day, the board chips and Reset; on a Period slide a second row with the period strip */
  function drawHead(key) {
    const head = $(".pr-head");
    if (!head) return;
    const boards = D().boards, scope = ovScopeBoards(), all = scope.length === boards.length;
    const chipBtn = (id, label, on, data) => `<button type="button" class="pr-chip${on ? " on" : ""}" data-pa="chip" data-id="${e(id)}" aria-pressed="${on}"${data ? " data-no-i18n" : ""}>${e(label)}</button>`;
    const period = isPeriod(key);
    head.innerHTML = `<div class="pr-r1"><b>Overview</b><span class="pr-d">${e(fmtDow(state.date))} ${e(fmtDate(state.date))}</span>`
      + (boards.length > 1 ? `<div class="pr-chips" role="group" aria-label="Boards">${chipBtn("all", "All boards", all, false)}${boards.map(b => chipBtn(b.id, b.name, !all && scope.includes(b), true)).join("")}</div>` : "")
      + (changed() ? `<button type="button" class="pr-reset" data-pa="reset">↺ Reset filters</button>` : "") + `</div>`
      + (period ? `<div class="pr-r2"><span class="pr-pc"><b>Period</b> ${e(fmtDate(state.overview.historyFrom))} → ${e(fmtDate(state.overview.historyTo))}</span><span class="pr-strip"></span></div>` : "");
    if (period) {
      const strip = head.querySelector(".pr-strip");
      strip.appendChild(historyControls());           // the range and Compare with: the page's own controls, not copies
      const view = periodScopeControls({ viewOnly: true });
      if (view) strip.appendChild(view);
    }
  }
  function drawNav(key) {
    const nav = $(".pr-nav");
    if (!nav) return;
    const chaps = CHAPTERS.filter(c => run.slides.some(k => slideOf(k).chapter === c));
    const tabs = chaps.length > 1 ? `<div class="pr-tabs" role="group" aria-label="Chapters">${chaps.map(c => `<button type="button" data-pa="chap" data-ch="${e(c)}" aria-pressed="${slideOf(key).chapter === c}">${c}</button>`).join("")}</div>` : "";
    const dots = run.slides.map((k, i) => `<button type="button" data-pa="go" data-i="${i}" aria-label="Slide ${i + 1}: ${e(slideOf(k).label)}"${i === run.i ? ' aria-current="true"' : ""}${i > 0 && slideOf(run.slides[i - 1]).chapter !== slideOf(k).chapter ? ' class="gap"' : ""}></button>`).join("");
    nav.innerHTML = `<button type="button" class="pr-ab" data-pa="prev" aria-label="Previous slide">${icon("chevron-left")}</button>${tabs}`
      + `<span class="pr-dots">${dots}</span><span class="pr-count"><span class="num">${run.i + 1} / ${run.slides.length}</span> · <span>${slideOf(key).label}</span></span>`
      + `<button type="button" class="pr-ab" data-pa="next" aria-label="Next slide">${icon("chevron-right")}</button>`
      + `<button type="button" class="pr-kb" data-pa="keys" aria-label="Keys" aria-pressed="${run.keys}"><kbd>?</kbd> Keys</button>`;
  }
  /* marks the controls a click may reach, and hides staff names when they are off */
  function decorate(panel) {
    for (const el of panel.querySelectorAll(LIVE)) el.setAttribute("data-live", "");
    if (!run.names) scrub(panel);
  }
  /* Hide names: every staff name in the text, and in the tooltip and label attributes, becomes dots */
  function scrub(root) {
    const names = [...new Set(D().employees.flatMap(x => [x.name, x.nameEn]).filter(n => n && n.trim().length > 2).map(n => n.trim()))].sort((a, b) => b.length - a.length);
    if (!names.length) return;
    const src = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const has = new RegExp(src), all = new RegExp(src, "g");
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) if (has.test(n.nodeValue)) hits.push(n);
    for (const n of hits) n.nodeValue = n.nodeValue.replace(all, "•••");
    for (const el of root.querySelectorAll("[title],[aria-label],[data-tip-label],[data-tip-value]")) {
      for (const a of ["title", "aria-label", "data-tip-label", "data-tip-value"]) {
        const v = el.getAttribute(a);
        if (v && has.test(v)) el.setAttribute(a, v.replace(all, "•••"));
      }
    }
  }
  /* shows only the slide's own section(s); called from renderOverview before its charts are measured, and again here */
  function mark(panel) {
    if (!run || run.kind !== "overview" || !panel) return;
    const key = run.slides[run.i];
    for (const c of panel.children) c.classList.toggle("pr-on", c.dataset.pslide === key);
  }
  /* the page's sections are laid out at BASE_W and scaled to the stage: as large as the width allows, no smaller than
     K_MIN, and a slide that is still taller than the screen scrolls */
  function layout() {
    if (!run || run.kind !== "overview") return;
    const st = $("#present-stage"), sc = $(".pr-scroll"), fit = $(".pr-fit"), panel = $("#overview-panel");
    if (!st || !sc || !fit || !panel) return;
    const narrow = st.clientWidth < NARROW;
    st.classList.toggle("pr-narrow", narrow);
    if (narrow) { panel.style.transform = ""; panel.style.width = ""; fit.style.width = ""; fit.style.height = ""; cue(); return; }
    panel.style.width = BASE_W + "px";
    panel.style.transform = "none";
    const h = panel.offsetHeight, wk = (sc.clientWidth - 2 * GUTTER) / BASE_W;
    const k = Math.max(Math.min(wk, sc.clientHeight / Math.max(1, h)), Math.min(wk, K_MIN));
    panel.style.transform = `scale(${k.toFixed(4)})`;
    fit.style.width = Math.round(BASE_W * k) + "px";
    fit.style.height = Math.round(h * k) + "px";
    cue();
  }
  /* "More below" while the slide scrolls and there is more to see */
  function cue() {
    const sc = $(".pr-scroll"), m = $(".pr-more");
    if (sc && m) m.hidden = !(sc.scrollHeight - sc.clientHeight - sc.scrollTop > 8);
  }
  function draw() {
    if (!run) return;
    drawBar();
    if (run.kind !== "overview") return;
    const panel = $("#overview-panel");
    if (!$("#present-stage") || !panel) return;
    const key = run.slides[run.i];
    mark(panel);
    drawHead(key);
    drawNav(key);
    decorate(panel);
    layout();
  }
  /* called from render(): the data moved, so the slide in front moves with it */
  function redraw() { if (run) draw(); }

  return { open, go, canPresent, available, active, redraw, mark, exit };
})();
