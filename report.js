/* Monthly management report (Overview → Report).
   One model, two outputs: buildModel() turns a period and a choice of sections into plain data,
   built from the SAME functions the Overview draws from (historyDates / historyDayRec / historyMean
   and OV_HISTORY_MEASURES for the tiles, historyDeltaParts for the changes, historyPeopleRows,
   historyEngineerRows, workforceModel, boardPeriodRow / areaPeriodRows / loanPersonDays, hostExperience),
   so the numbers cannot drift from the screen. The PDF draws that model as a printable sheet (the
   browser's print dialog, like the other PDF exports); the Excel file writes one sheet per section
   (ManpowerXlsx.buildReportWorkbook, in the TRIGO table style). Both can be English or Thai whatever
   the app is showing (I18N.th). Names are shown only when "include names" is ticked; the whole
   thing needs the Overview History permission. Everything chosen is remembered on this device.
   Loaded after app.js: it reads that file's globals when it runs, never while it loads. */
"use strict";

const OvReport = (() => {
  const KEY = "manpower.report";
  const SECTIONS = [["summary", "Summary"], ["history", "History"], ["people", "People"], ["engineer", "Engineer workload"],
    ["workforce", "Workforce"], ["boards", "Boards & areas"], ["skills", "Skills risks"]];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  /* ---------- what is remembered ---------- */
  const lastMonth = () => { const p = addDays(monthStart(todayStr()), -1); return p.slice(0, 7); };
  function defaults() {
    return { period: "month", month: lastMonth(), sections: Object.fromEntries(SECTIONS.map(([k]) => [k, true])),
      tiles: OV_HISTORY_MEASURES.map(m => m.key), charts: true, names: false, format: "pdf", lang: "en" };
  }
  function load() {
    const d = defaults();
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!s) return d;
      return { ...d, ...s, sections: { ...d.sections, ...(s.sections || {}) }, tiles: Array.isArray(s.tiles) ? s.tiles.filter(k => d.tiles.includes(k)) : d.tiles,
        month: /^\d{4}-\d{2}$/.test(s.month) && s.month <= todayStr().slice(0, 7) ? s.month : d.month, period: s.period === "range" ? "range" : "month",
        format: s.format === "xlsx" ? "xlsx" : "pdf", lang: s.lang === "th" ? "th" : "en" };
    } catch (e) { return d; }
  }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* remembering is a courtesy */ } }

  /* ---------- the period ---------- */
  function rangeOf(p) {
    const today = todayStr();
    if (p.period === "range") { resolveHistoryRange(); return [state.overview.historyFrom, state.overview.historyTo]; }
    const from = p.month + "-01", end = monthEnd(from);
    return [from, end < today ? end : today];
  }
  const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  const periodLabel = (p, from, to) => (p.period === "range" ? `${fmtDate(from)} → ${fmtDate(to)}` : monthLabel(p.month));
  const scopeLabel = (boards) => (boards.length === 1 && D().boards.length > 1 ? boards[0].name : "All boards");

  /* the period before comes in the same fetch (People's runs, Previous period); last year has its own, only when it is the choice */
  async function loadHist(from, to) {
    const ids = D().boards.map(b => b.id);
    const main = await cloud.getUtilizationRange(ids, prevRangeOf(from, to)[0], to);
    if (state.overview.historyCompare !== "ly") return main;
    const [cf, ct] = historyCompareRange(from, to);
    const ly = await cloud.getUtilizationRange(ids, cf, ct);
    const out = {};
    for (const id of ids) out[id] = { ...(ly[id] || {}), ...(main[id] || {}) };
    return out;
  }

  /* ---------- the model ---------- */
  async function buildModel(p) {
    const ov = state.overview, boards = ovScopeBoards();
    const [from, to] = rangeOf(p);
    const hist = await loadHist(from, to);
    const dates = historyDates(boards, from, to);
    const recs = dates.map(d => historyDayRec(d, boards, hist));
    const [cf, ct] = historyCompareRange(from, to);
    const cmpRecs = historyDates(boards, cf, ct).map(d => historyDayRec(d, boards, hist));
    const ly = ov.historyCompare === "ly";
    const len = Math.round((new Date(to + "T00:00:00") - new Date(from + "T00:00:00")) / 86400000) + 1;
    const shift = (d) => addDays(d, -(ly ? LY_SHIFT_DAYS : len));
    const model = { title: `Manpower report · ${periodLabel(p, from, to)} · ${scopeLabel(boards)}`, from, to, period: periodLabel(p, from, to), scope: scopeLabel(boards), compareName: historyCompareName(),
      compareRange: [cf, ct], workingDays: dates.length, lang: p.lang, names: !!p.names, sections: {}, generated: todayStr() };
    const measure = (m) => {
      const values = recs.map(r => (r ? m.value(r) : null));
      const mean = historyMean(values), prevMean = historyMean(cmpRecs.map(r => (r ? m.value(r) : null)));
      return { key: m.key, label: m.label, suffix: m.suffix, mean, prevMean, values, delta: historyDeltaParts(m, mean, prevMean, {}) };
    };
    const sel = p.sections;
    if (sel.summary) model.sections.summary = { tiles: OV_HISTORY_MEASURES.map(measure) };
    if (sel.history) {
      const picked = OV_HISTORY_MEASURES.filter(m => p.tiles.includes(m.key));
      model.sections.history = { dates, measures: picked.map(m => {
        const x = measure(m);
        x.cmpValues = dates.map(d => { const r = historyDayRec(shift(d), boards, hist); return r ? m.value(r) : null; });
        if (m.key === "leave") {
          x.types = OV_LEAVE_TYPES.map(z => ({ key: z, label: ZONE_LABELS[z], total: recs.reduce((a, r) => a + (r ? r.leaveBy[z] || 0 : 0), 0), mean: historyMean(recs.map(r => (r ? r.leaveBy[z] || 0 : null))) }));
        }
        if (m.key === "oncall") {
          const called = recs.reduce((a, r) => a + (r ? r.oncallAssigned : 0), 0), avail = recs.reduce((a, r) => a + (r ? historyOncallAvail(r) : 0), 0), crew = recs.reduce((a, r) => a + (r ? r.assigned : 0), 0);
          x.rate = avail ? Math.round((called / avail) * 100) : null; x.share = crew ? Math.round((called / crew) * 100) : null;
        }
        return x;
      }), charts: !!p.charts };
    }
    if (sel.people) {
      const rows = historyPeopleRows({ dates, recs, hist, boards, from, to });
      const stats = peopleSpreadStats(rows.filter(r => !r.oncall)), stats2 = peopleSpreadStats(rows.filter(r => r.oncall));
      const flags = {};
      for (const r of rows) for (const f of r.flags) flags[f.key] = (flags[f.key] || 0) + 1;
      model.sections.people = { people: rows.length, permanent: stats, oncall: stats2, flags,
        onLeaveRed: rows.filter(r => r.share > OV_LEAVE_RED).length, nights: rows.reduce((a, r) => a + r.nights, 0), rows: p.names ? rows : null };
    }
    if (sel.engineer) model.sections.engineer = { rows: historyEngineerRows(dates, recs) };
    if (sel.workforce) {
      let wfFrom = monthStart(to);   // the twelve months ending with the report's last month
      for (let i = 0; i < 11; i++) wfFrom = monthStart(addDays(wfFrom, -1));
      model.sections.workforce = workforceModel(new Set(boards.map(b => b.id)), wfFrom, to);
      model.sections.workforce.names = !!p.names;
    }
    if (sel.boards) {
      const loans = loanPersonDays(from, to);
      model.sections.boards = {
        rows: boards.map(b => ({ name: b.name, ...boardPeriodRow([b], dates, hist), net: (loans.borrowed[b.id] || 0) - (loans.lent[b.id] || 0) })),
        total: boards.length > 1 ? boardPeriodRow(boards, dates, hist) : null,
        areas: areaPeriodRows(boards, dates, hist),
        loans: [...loans.routes.values()].sort((a, b) => b.days - a.days).map(r => ({ from: (D().boards.find(x => x.id === r.from) || {}).name || "?", to: (D().boards.find(x => x.id === r.to) || {}).name || "?", days: r.days, people: r.people.size })),
      };
    }
    if (sel.skills) {
      await ensureHostDirectoryLoaded();
      model.sections.skills = { rows: hostRiskRows(!!p.names) };
    }
    return model;
  }

  /* ---------- tables: the one place every section's rows are listed (the sheet and the file both read them) ---------- */
  const f1 = (v, s = "") => (v == null ? "" : Math.round(v * 10) / 10 + s);
  function tables(m) {
    const out = [];
    const S = m.sections;
    out.push({ key: "cover", name: "Report", blocks: [{ title: "", columns: [{ label: "Item", width: 26 }, { label: "Value", width: 60 }], rows: [
      ["Report", m.title], ["Period", m.period], ["Working days", m.workingDays], ["Scope", m.scope], ["Compared with", `${m.compareName} (${fmtDate(m.compareRange[0])} → ${fmtDate(m.compareRange[1])})`],
      ["Names", m.names ? "Included" : "Left out"], ["Created", fmtDate(m.generated)]] }] });
    if (S.summary) out.push({ key: "summary", name: "Summary", blocks: [{ title: "", columns: [{ label: "Measure", width: 26 }, { label: "Average", width: 14, center: true }, { label: "Change", width: 40 }, { label: "Compared with", width: 16, center: true }],
      rows: S.summary.tiles.map(t => [t.label, t.mean == null ? "" : t.mean, t.delta.text, t.prevMean == null ? "" : t.prevMean]) }] });
    if (S.history) {
      const H = S.history;
      const blocks = [{ title: "", columns: [{ label: "Date", width: 14 }, ...H.measures.map(x => ({ label: x.label, width: 16, center: true }))],
        rows: H.dates.map((d, i) => [d, ...H.measures.map(x => (x.values[i] == null ? "" : x.values[i]))]) }];
      const lv = H.measures.find(x => x.key === "leave");
      if (lv) blocks.push({ title: "Leave by type", columns: [{ label: "Leave type", width: 22 }, { label: "Person-days", width: 14, center: true }, { label: "Avg / day", width: 12, center: true }], rows: lv.types.map(t => [t.label, t.total, t.mean == null ? "" : t.mean]) });
      out.push({ key: "history", name: "Daily history", blocks });   // Excel reserves the sheet name "History"
    }
    if (S.people) {
      const P = S.people;
      const blocks = [{ title: "Spread of working days on a mission", columns: [{ label: "Group", width: 16 }, { label: "People", width: 10, center: true }, { label: "Median %", width: 10, center: true }, { label: "90% or more", width: 12, center: true }, { label: "Under 50%", width: 12, center: true }, ...Array.from({ length: 10 }, (_, i) => ({ label: pplBandLabel(i), width: 9, center: true }))],
        rows: [["Permanent", P.permanent.n, P.permanent.median, P.permanent.hi, P.permanent.lo, ...P.permanent.bands], ["On-call", P.oncall.n, P.oncall.median, P.oncall.hi, P.oncall.lo, ...P.oncall.bands]] },
        { title: "Flags", columns: [{ label: "Flag", width: 28 }, { label: "People", width: 10, center: true }],
          rows: [["Days in a row", P.flags.run || 0], ["Mostly nights", P.flags.nights || 0], [`Leave above ${OV_LEAVE_RED}%`, P.flags.leave || 0], ["Never called in", P.flags.never || 0], ["Newcomer-only mission", P.flags.newcomer || 0]] }];
      if (P.rows) blocks.push({ title: "Per person", columns: [{ label: "Name", width: 28 }, { label: "Contract", width: 11 }, { label: "Working days", width: 10, center: true }, { label: "Worked", width: 9, center: true }, { label: "Leave", width: 9, center: true }, { label: "Leave share %", width: 12, center: true }, { label: "Nights", width: 9, center: true }, { label: "Days in a row", width: 12, center: true }, { label: "Flags", width: 40 }],
        rows: P.rows.slice().sort((a, b) => a.name.localeCompare(b.name)).map(r => [r.name, r.oncall ? "On-call" : "Permanent", r.working, r.worked, r.leave, f1(r.share), r.nights, r.run ? r.run.len : 0, r.flags.map(x => ({ run: "days in a row", nights: "mostly nights", leave: "leave above " + OV_LEAVE_RED + "%", never: "never called in", newcomer: "newcomer-only mission" }[x.key])).join(", ")]) });
      out.push({ key: "people", name: "People", blocks });
    }
    if (S.engineer) out.push({ key: "engineer", name: "Engineer workload", blocks: [{ title: "", columns: [{ label: "Engineer", width: 26 }, { label: "Missions / day", width: 14, center: true }, { label: "Crew / day", width: 12, center: true }, { label: "Permanent crew / day", width: 16, center: true }, { label: "On-call crew / day", width: 16, center: true }, { label: "Missions", width: 10, center: true }, { label: "Active days", width: 11, center: true }],
      rows: S.engineer.rows.map(r => [r.name, f1(r.avgM), f1(r.avgC), f1(r.avgP), f1(r.avgO), r.totM, r.active]) }] });
    if (S.workforce) {
      const W = S.workforce;
      const blocks = [{ title: "Headcount at the end of each month", columns: [{ label: "Month", width: 16 }, { label: "Headcount", width: 12, center: true }, ...WF_BANDS.map(b => ({ label: b.label, width: 14, center: true })), { label: "Joiners", width: 9, center: true }, { label: "Leavers", width: 9, center: true }, { label: "Inactive for now", width: 14, center: true }],
        rows: W.months.map(x => [monthLabel(x.month), x.hc.total, ...WF_BANDS.map(b => x.hc[b.key]), x.joiners.length, x.leavers.length, x.pausers.length]) },
        { title: "Window", columns: [{ label: "Measure", width: 28 }, { label: "Value", width: 14, center: true }], rows: [["Headcount now", W.now.total], ["Joiners", W.joined], ["Leavers (resigned)", W.left], ["Turnover %", f1(W.turnover)], ["Under 1 year %", W.now.total ? f1((W.now.u1 / W.now.total) * 100) : ""]] }];
      if (W.names) {
        const ev = [];
        for (const x of W.months) { for (const e of x.joiners) ev.push([monthLabel(x.month), "Joined", e.name]); for (const e of x.leavers) ev.push([monthLabel(x.month), "Resigned", e.name]); for (const e of x.pausers) ev.push([monthLabel(x.month), "Inactive for now", e.name]); }
        if (ev.length) blocks.push({ title: "Who", columns: [{ label: "Month", width: 16 }, { label: "Event", width: 18 }, { label: "Name", width: 30 }], rows: ev });
      }
      out.push({ key: "workforce", name: "Workforce", blocks });
    }
    if (S.boards) {
      const B = S.boards;
      const blocks = [{ title: "By board", columns: [{ label: "Board", width: 22 }, { label: "Utilization %", width: 13, center: true }, { label: "Deployed / day", width: 14, center: true }, { label: "Standby / day", width: 13, center: true }, { label: "Leave / day", width: 12, center: true }, { label: "On-call share %", width: 14, center: true }, { label: "Net loans", width: 11, center: true }],
        rows: [...B.rows.map(r => [r.name, r.util == null ? "" : r.util, r.deployed == null ? "" : r.deployed, r.idle == null ? "" : r.idle, r.leave == null ? "" : r.leave, r.oncall == null ? "" : r.oncall, r.net]),
          ...(B.total ? [["All boards", B.total.util == null ? "" : B.total.util, B.total.deployed == null ? "" : B.total.deployed, B.total.idle == null ? "" : B.total.idle, B.total.leave == null ? "" : B.total.leave, B.total.oncall == null ? "" : B.total.oncall, ""]] : [])] },
        { title: "By service area", columns: [{ label: "Service area", width: 22 }, { label: "Demand / day", width: 14, center: true }, { label: "Supply / day", width: 13, center: true }, { label: "Permanent / day", width: 14, center: true }, { label: "On-call / day", width: 13, center: true }, { label: "Gap", width: 10, center: true }, { label: "Covered by other areas / day", width: 18, center: true }],
          rows: B.areas.rows.map(r => [r.name, f1(r.demand), f1(r.supply), f1(r.perm), f1(r.oncall), f1(r.gap), f1(r.other)]) }];
      if (B.loans.length) blocks.push({ title: "Loans in the range", columns: [{ label: "From", width: 22 }, { label: "To", width: 22 }, { label: "Person-days", width: 13, center: true }, { label: "People", width: 10, center: true }], rows: B.loans.map(r => [r.from, r.to, r.days, r.people]) });
      out.push({ key: "boards", name: "Boards & areas", blocks });
    }
    if (S.skills) out.push({ key: "skills", name: "Skills risks", blocks: [{ title: "Hosts where two or fewer active people are experienced", columns: [{ label: "Host", width: 30 }, { label: "Experienced", width: 13, center: true }, { label: "Active experienced", width: 17, center: true }, { label: "Who (active)", width: 44 }],
      rows: S.skills.rows.map(r => [r.host, r.experienced, r.active, r.who || ""]) }] });
    return out;
  }

  /* ---------- the PDF: a printable sheet drawn from the same model ---------- */
  const e = (s) => escapeHtml(String(s == null ? "" : s));
  function table(cols, rows) {
    return `<table class="rp-table"><thead><tr>${cols.map(c => `<th class="${c.center ? "r" : ""}">${e(c.label)}</th>`).join("")}</tr></thead><tbody>${
      rows.map(r => `<tr>${r.map((v, i) => `<td class="${cols[i] && cols[i].center ? "r" : ""}">${e(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  function chartSvg(dates, x, color) {
    const series = [{ key: x.key, label: x.label, color, visible: true, points: x.values.map(y => ({ y, suffix: x.suffix })) }];
    if (x.cmpValues && x.cmpValues.some(v => v != null)) series.push({ key: "cmp", label: "Comparison", color: "#7b8794", visible: true, dashed: true, points: x.cmpValues.map(y => ({ y, suffix: x.suffix })) });
    const all = [...x.values, ...(x.cmpValues || [])].filter(v => v != null);
    // the hover titles mean nothing on paper (and are English), so they are left out of the sheet
    return Charts.lineChart({ series, xLabels: dates.map(shortDateLabel), yMax: Charts.niceMax(all), width: 700, height: 170,
      refLines: x.mean != null ? [{ y: x.mean, color: "#7b8794", label: "avg" }] : [], emptyLabel: "No data in this range", dates: null }).replace(/<title>[^]*?<\/title>/g, "");
  }
  function sheet(m) {
    const S = m.sections, el = document.createElement("div");
    el.id = "report-sheet";
    el.className = "rp";
    const parts = [`<header class="rp-head"><h1>${e(m.title)}</h1><p><span>${e(m.period)}</span> · <span>${e(`${m.workingDays} working ${m.workingDays === 1 ? "day" : "days"}`)}</span> · <span>${e(`compared with ${m.compareName} (${fmtDate(m.compareRange[0])} → ${fmtDate(m.compareRange[1])})`)}</span> · <span>${e(m.names ? "names included" : "names left out")}</span></p></header>`];
    const sec = (title, body) => parts.push(`<section class="rp-sec"><h2>${e(title)}</h2>${body}</section>`);
    if (S.summary) sec("Summary", `<div class="rp-tiles">${S.summary.tiles.map(t => `<div class="rp-tile"><span>${e(t.label)}</span> <b>${t.mean == null ? "—" : e(t.mean + t.suffix)}<small> avg</small></b> <i class="${t.delta.cls}">${e(t.delta.text)}</i></div>`).join("")}</div>`);
    if (S.history) {
      const H = S.history;
      sec("History", `<p class="rp-sub">${e(`The dashed line is the comparison (${m.compareName}).`)}</p>` + H.measures.map(x => `<div class="rp-block"><h3>${e(x.label)}</h3><p class="rp-sub">${x.mean == null ? "No data" : e(x.mean + x.suffix + " average")} · <span class="${x.delta.cls}">${e(x.delta.text)}</span>${x.types ? ` · ${x.types.map(t => `<span>${e(t.label)}</span> <b>${t.total}</b>`).join(" · ")}` : ""}${x.rate != null ? ` · <span>${e(`Called in on ${x.rate}% of the available on-call days`)}</span> · <span>${e(`${x.share}% of the people on missions`)}</span>` : ""}</p>${H.charts ? chartSvg(H.dates, x, "#2a78d6") : ""}</div>`).join("") || `<p class="rp-sub">No tile picked.</p>`);
    }
    if (S.people) {
      const P = S.people;
      const sp = (name, s) => `<tr><td>${e(name)}</td><td class="r">${s.n}</td><td class="r">${s.n ? e(f1(s.median) + "%") : "—"}</td><td class="r">${s.hi}</td><td class="r">${s.lo}</td></tr>`;
      /* the spread as a smooth curve over the ten bands, the counts above and the band labels below (the app's own chart, flat for print) */
      const bands = (s) => {
        const max = Math.max(1, ...s.bands);
        const curve = spreadCurve(s.bands.map((n, k) => [k * 10 + 5, 42 - (s.n ? (n / max) * 38 : 0)]));
        const row = (cls, f) => `<div class="${cls}">${s.bands.map((n, k) => `<span>${f(n, k)}</span>`).join("")}</div>`;
        return `<div class="rp-bands">${row("rp-bn", (n) => (n || ""))}<svg viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="42" x2="100" y2="42" stroke="#d8e0e7" stroke-width="1" vector-effect="non-scaling-stroke"/><path d="${curve} L95,42 L5,42 Z" fill="#2a78d6" opacity=".16"/><path d="${curve}" fill="none" stroke="#2a78d6" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>${row("rp-bl", (n, k) => `${k * 10}${k === 9 ? "+" : ""}`)}</div>`;
      };
      sec("People", `<table class="rp-table"><thead><tr><th>Share of working days on a mission</th><th class="r">People</th><th class="r">Median</th><th class="r">90% or more</th><th class="r">Under 50%</th></tr></thead><tbody>${sp("Permanent", P.permanent)}${sp("On-call", P.oncall)}</tbody></table>
        <div class="rp-two"><div><h3>Permanent</h3>${bands(P.permanent)}</div><div><h3>On-call</h3>${bands(P.oncall)}</div></div>
        <p class="rp-sub"><span>Flags</span>: <span>${e(`${P.flags.run || 0} in a row (${OV_RUN_AMBER}+ days)`)}</span> · <span>${e(`${P.flags.nights || 0} mostly nights`)}</span> · <span>${e(`${P.flags.leave || 0} with leave above ${OV_LEAVE_RED}%`)}</span> · <span>${e(`${P.flags.never || 0} never called in`)}</span> · <span>${e(`${P.flags.newcomer || 0} newcomer-only mission`)}</span></p>
        ${P.rows ? (() => { const t = tables(m).find(x => x.key === "people").blocks.find(b => b.title === "Per person"); return table(t.columns, t.rows); })() : `<p class="rp-sub">Names left out.</p>`}`);
    }
    if (S.engineer) { const t = tables(m).find(x => x.key === "engineer").blocks[0]; sec("Engineer workload", S.engineer.rows.length ? table(t.columns, t.rows) : `<p class="rp-sub">No missions in this range.</p>`); }
    if (S.workforce) {
      const W = S.workforce, t = tables(m).find(x => x.key === "workforce");
      sec("Workforce", `<div class="rp-tiles"><div class="rp-tile"><span>Headcount now</span><b>${W.now.total}</b></div><div class="rp-tile"><span>Joiners</span><b>${W.joined}</b></div><div class="rp-tile"><span>Leavers</span><b>${W.left}</b></div><div class="rp-tile"><span>Turnover</span><b>${e(f1(W.turnover))}%</b></div></div>${table(t.blocks[0].columns, t.blocks[0].rows)}${t.blocks[2] ? `<h3>Who</h3>${table(t.blocks[2].columns, t.blocks[2].rows)}` : ""}`);
    }
    if (S.boards) {
      const t = tables(m).find(x => x.key === "boards");
      sec("Boards & areas", t.blocks.map(b => `<h3>${e(b.title)}</h3>${table(b.columns, b.rows)}`).join(""));
    }
    if (S.skills) {
      const t = tables(m).find(x => x.key === "skills").blocks[0];
      sec("Skills risks", S.skills.rows.length ? table(t.columns, t.rows) : `<p class="rp-sub">No host has two or fewer active experienced people.</p>`);
    }
    el.innerHTML = parts.join("");
    return el;
  }
  /* the whole tree in the report's language, whatever the app shows (I18N.th ignores the app's language) */
  function translateTree(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (const t of nodes) {
      if (t.parentElement && t.parentElement.closest("[data-no-i18n], script, style")) continue;
      const v = t.nodeValue;
      if (/[A-Za-z]{2}/.test(v)) { const th = I18N.th(v); if (th !== v) t.nodeValue = th; }
    }
    for (const el of root.querySelectorAll("[title], [aria-label]")) for (const a of ["title", "aria-label"]) { const v = el.getAttribute(a); if (v && /[A-Za-z]{2}/.test(v)) el.setAttribute(a, I18N.th(v)); }
  }

  /* ---------- the dialog ---------- */
  let current = null;
  function open() {
    if (!can("ov.history")) { toast("Your role cannot see Overview History, so it cannot make this report.", "info"); return; }
    current = load();
    render();
    openModal("#modal-report");
  }
  function render() {
    const p = current, ov = state.overview;
    resolveHistoryRange();
    const body = $("#report-body");
    const cb = (id, label, checked, extra = "") => `<label class="import-row"><input type="checkbox" id="${id}"${checked ? " checked" : ""}><span class="import-info">${label}${extra}</span></label>`;
    body.innerHTML = `
      <div class="form-group">Period</div>
      <div class="rp-period">
        <label><input type="radio" name="rp-period" value="month"${p.period === "month" ? " checked" : ""}> <span>Month</span></label>
        <input type="month" id="rp-month" value="${e(p.month)}" max="${e(todayStr().slice(0, 7))}" aria-label="Month">
        <label><input type="radio" name="rp-period" value="range"${p.period === "range" ? " checked" : ""}> <span>History range</span> <small class="ov-muted">${e(fmtDate(ov.historyFrom))} → ${e(fmtDate(ov.historyTo))}</small></label>
      </div>
      <p class="rp-scope"><span>Compared with</span> <b>${e(historyCompareName())}</b> <small>(the choice in the Period heading)</small><br><span>Scope</span> <b${scopeLabel(ovScopeBoards()) === "All boards" ? "" : " data-no-i18n"}>${e(scopeLabel(ovScopeBoards()))}</b> <small>(the board selector)</small></p>
      <div class="form-group">Sections</div>
      ${SECTIONS.map(([k, l]) => cb("rp-sec-" + k, l, p.sections[k])
        + (k === "history" ? `<div class="rp-sub-opts" id="rp-hist-opts">${OV_HISTORY_MEASURES.map(m => cb("rp-tile-" + m.key, m.label, p.tiles.includes(m.key))).join("")}${cb("rp-charts", "Include charts (PDF)", p.charts)}</div>` : "")
        + (k === "people" ? `<div class="rp-sub-opts" id="rp-people-opts">${cb("rp-names", "Include names", p.names)}<small class="ov-muted">Per-person rows, who joined and left, who covers a host. Off by default.</small></div>` : "")).join("")}
      <div class="form-group">Format</div>
      <div class="rp-format" role="radiogroup" aria-label="Format">
        <label><input type="radio" name="rp-format" value="pdf"${p.format === "pdf" ? " checked" : ""}> <span>PDF</span> <small class="ov-muted">opens the print dialog: choose Save as PDF</small></label>
        <label><input type="radio" name="rp-format" value="xlsx"${p.format === "xlsx" ? " checked" : ""}> <span>Excel</span> <small class="ov-muted">one sheet per section</small></label>
      </div>
      <div class="xlsx-lang" role="radiogroup" aria-label="Report language"><b>Language</b>
        <label data-no-i18n><input type="radio" name="rp-lang" value="en"${p.lang === "en" ? " checked" : ""}> English</label>
        <label data-no-i18n><input type="radio" name="rp-lang" value="th"${p.lang === "th" ? " checked" : ""}> ไทย</label></div>`;
    const sync = () => {
      $("#rp-hist-opts").classList.toggle("hidden", !$("#rp-sec-history").checked);
      $("#rp-people-opts").classList.toggle("hidden", !($("#rp-sec-people").checked || $("#rp-sec-workforce").checked || $("#rp-sec-skills").checked));
      $("#rp-month").disabled = document.querySelector('input[name="rp-period"]:checked').value !== "month";
      $("#btn-report-go").disabled = !SECTIONS.some(([k]) => $("#rp-sec-" + k).checked);
    };
    for (const i of body.querySelectorAll("input")) i.onchange = () => { read(); sync(); };
    sync();
  }
  function read() {
    const p = current;
    p.period = document.querySelector('input[name="rp-period"]:checked').value;
    p.month = $("#rp-month").value || p.month;
    for (const [k] of SECTIONS) p.sections[k] = $("#rp-sec-" + k).checked;
    p.tiles = OV_HISTORY_MEASURES.filter(m => $("#rp-tile-" + m.key).checked).map(m => m.key);
    p.charts = $("#rp-charts").checked; p.names = $("#rp-names").checked;
    p.format = document.querySelector('input[name="rp-format"]:checked').value;
    p.lang = document.querySelector('input[name="rp-lang"]:checked').value;
    save(p);
    return p;
  }
  async function generate() {
    const p = read();
    const btn = $("#btn-report-go");
    btn.disabled = true;
    try {
      const m = await buildModel(p);
      closeModal();
      if (p.format === "xlsx") await excel(m);
      else pdf(m);
    } finally { btn.disabled = false; }
  }
  const tr = (lang) => (lang === "th" ? (s) => I18N.th(String(s)) : (s) => String(s));
  async function excel(m) {
    const T = tr(m.lang), ExcelJS = await loadExcelJS();
    const sheets = tables(m).map(t => ({ name: T(t.name), blocks: t.blocks.map(b => ({ title: b.title ? T(b.title) : "", columns: b.columns.map(c => ({ ...c, label: T(c.label) })),
      rows: b.rows.map(r => r.map(v => (typeof v === "string" && m.lang === "th" ? T(v) : v))) })) }));
    const { workbook } = await ManpowerXlsx.buildReportWorkbook(ExcelJS, { sheets, title: T(m.title) });
    const buf = await workbook.xlsx.writeBuffer();
    const name = `Manpower_report_${m.from}_${m.scope.replace(/\s+/g, "_")}.xlsx`;
    bulkSaveBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
    toast("The report is saved as an Excel file.", "info");
  }
  function pdf(m) {
    const el = sheet(m);
    if (m.lang === "th") translateTree(el);
    document.body.appendChild(el);
    document.body.classList.add("printing-report");
    const prevTitle = document.title;
    document.title = `Manpower_report_${m.from}_${m.scope.replace(/\s+/g, "_")}`;
    let st = document.getElementById("print-page-size");
    if (!st) { st = document.createElement("style"); st.id = "print-page-size"; document.head.appendChild(st); }
    st.textContent = "@page { size: A4 portrait; margin: 12mm; }";
    // set before print(), so beforeprint's own preparation (prepareForPrint) leaves the page alone and afterprint undoes this
    printRestore = () => { el.remove(); document.body.classList.remove("printing-report"); document.title = prevTitle; clearPrintPageSize(); };
    window.print();
  }

  return { open, generate, buildModel, tables, sheet, load, defaults, SECTIONS };
})();
