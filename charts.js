/* Overview dashboard charts — hand-drawn inline SVG, no charting library, no build
   step (loaded as a plain <script> between cloud.js and app.js). Two rules drove
   every shape here:

   1. No <foreignObject> anywhere. The Export button rasterizes the board with
      html2canvas, which can't render foreignObject text — every label below is a
      real SVG <text> element instead.
   2. Every mark is a real element with data-tip-* attributes (read by
      wireChartTooltips) plus a <title> child, so hovering, focusing, AND a no-JS
      fallback all show the same value. Tooltips enhance; the legend, direct
      labels and the underlying numbers (still readable in the DOM) never gate.

   Colors are always the LITERAL CSS custom property reference (e.g.
   "var(--chart-assigned)"), embedded as-is into the SVG's fill/stroke
   attributes — never resolved to a hex value in JS. SVG presentation
   attributes participate in the normal CSS cascade in every browser this app
   targets, so the browser re-resolves the var() live whenever the page's
   data-theme flips — no re-render needed for chart colors to follow a dark
   mode toggle. (An earlier version of this file read colors eagerly via
   getComputedStyle() at build time; that baked in whichever theme was active
   the moment the chart was built, so a same-session theme toggle left
   per-board colors — trend lines, leave-by-type segments — stuck on the old
   theme until the next unrelated re-render. Embedding the reference instead
   of the value fixes that structurally, for every chart, permanently.) */
"use strict";

const Charts = (() => {

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  /* the app's own fixed 8-slot categorical order (see styles.css) — cycle for
     "however many boards/categories" series (leave types, board trend lines) */
  function catColor(i) { return `var(--chart-cat-${(i % 8) + 1})`; }

  /* ---------- sparkline ---------- */
  /* `points`: [number|null, ...], oldest first. A decorative trend indicator
     for a KPI tile, not a full chart — no axes, no gridlines, no tooltip (the
     full Trend chart below carries the interaction; this is a glance). Draws
     one polyline per contiguous run of non-null points (same gap handling as
     lineChart, minus the parts a tile-sized chart has no room for) and marks
     only the last real point, since that's the value the tile's own number
     already states. */
  function sparkline({ points, width = 92, height = 34, color = "var(--primary)" }) {
    const vals = points.filter((v) => v != null);
    if (vals.length < 2) return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"></svg>`;
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    const n = points.length;
    const padY = 4;
    const xAt = (i) => (n <= 1 ? width / 2 : (i / (n - 1)) * width);
    const yAt = (v) => height - padY - ((v - min) / range) * (height - 2 * padY);
    let path = "", run = [];
    const flushRun = () => {
      if (run.length > 1) {
        const pts = run.map((i) => `${xAt(i).toFixed(1)},${yAt(points[i]).toFixed(1)}`).join(" ");
        path += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      }
      run = [];
    };
    points.forEach((v, i) => { if (v == null) { flushRun(); return; } run.push(i); });
    flushRun();
    let lastIdx = -1;
    for (let i = points.length - 1; i >= 0; i--) if (points[i] != null) { lastIdx = i; break; }
    const dot = lastIdx >= 0
      ? `<circle cx="${xAt(lastIdx).toFixed(1)}" cy="${yAt(points[lastIdx]).toFixed(1)}" r="3" fill="${color}" stroke="var(--panel)" stroke-width="1.5"/>`
      : "";
    return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="trend sparkline, ${vals.length} points">${path}${dot}</svg>`;
  }

  /* ---------- 100%-stacked horizontal bar ---------- */
  /* `segments`: [{label, value, color}]. `scaleMax` lets several bars share one
     scale (e.g. the five leave-type rows, so "40 on Annual" visibly outweighs
     "2 on Exchange"); omit it and the bar always fills its full width instead
     (used for a single board's own deployment mix, which has no useful
     "compared to what" — that board's own total IS the 100%). */
  function stackedBarH({ segments, scaleMax, width = 480, height = 22 }) {
    const total = segments.reduce((s, x) => s + (x.value || 0), 0);
    const denom = scaleMax != null ? scaleMax : total;
    const gap = 2;
    let x = 0, rects = "";
    if (denom > 0) {
      const usable = segments.filter(s => s.value > 0);
      usable.forEach((seg, i) => {
        const raw = (seg.value / denom) * width;
        const w = Math.max(0, raw - (i < usable.length - 1 ? gap : 0));
        rects += `<rect class="chart-mark" x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}" rx="3" fill="${seg.color}"
          data-tip-label="${esc(seg.label)}" data-tip-value="${seg.value}" data-tip-pct="${total ? Math.round(seg.value / total * 100) : 0}"
          tabindex="0"><title>${esc(seg.label)}: ${seg.value}${total ? ` (${Math.round(seg.value / total * 100)}%)` : ""}</title></rect>`;
        x += w + gap;
      });
    }
    if (!total) {
      // zero is zero — a full-width placeholder here would read as "100% of
      // something" and defeat the whole point of a shared scaleMax (a
      // 0-person Exchange-leave row must look visibly emptier than a
      // 40-person Annual-leave row, not identical to it). A thin baseline
      // says "no data" without implying any magnitude.
      rects += `<rect x="0" y="${(height / 2 - 1).toFixed(1)}" width="${width}" height="2" rx="1" fill="var(--border)"/>`;
    }
    return `<svg class="chart-svg chart-stackedbar" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" role="img" aria-label="Stacked bar, total ${total}">${rects}</svg>`;
  }

  /* ---------- horizontal bar list (one color per row) ---------- */
  /* `rows`: [{label, value, color}]. Value is printed past the bar's end
     rather than inside it — these rows have short bars at low counts, and a
     label that won't reliably fit inside the mark belongs outside it (or in
     the tooltip), never clipped. */
  function barsH({ rows, max, width = 460, barHeight = 16, rowGap = 10, labelWidth = 108 }) {
    const usableW = width - labelWidth - 40;
    const rowH = barHeight + rowGap;
    const height = Math.max(1, rows.length * rowH - rowGap);
    let body = "";
    rows.forEach((row, i) => {
      const y = i * rowH;
      const w = max > 0 ? (row.value > 0 ? Math.max(3, (row.value / max) * usableW) : 0) : 0;
      body += `
        <text x="0" y="${y + barHeight - 3}" class="chart-axis-label chart-row-label">${esc(row.label)}</text>
        <rect class="chart-mark" x="${labelWidth}" y="${y}" width="${w.toFixed(2)}" height="${barHeight}" rx="4" fill="${row.color}"
          data-tip-label="${esc(row.label)}" data-tip-value="${row.value}" tabindex="0"><title>${esc(row.label)}: ${row.value}</title></rect>
        <text x="${labelWidth + w + 6}" y="${y + barHeight - 3}" class="chart-value-label">${row.value}</text>`;
    });
    return `<svg class="chart-svg chart-barsh" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Bar chart">${body}</svg>`;
  }

  /* ---------- multi-line trend ---------- */
  /* `series`: [{key, label, color, points:[{y, suffix}], visible}]. `visible:false`
     series are skipped entirely — legend-toggle lives in app.js, this just obeys
     it. Gridlines are hairline and recessive; every point is a real hit target
     (see wireChartTooltips), not just the line itself. */
  function lineChart({ series, xLabels, yMax = 100, width = 640, height = 220 }) {
    const padL = 32, padR = 16, padT = 10, padB = 22;
    const w = width - padL - padR, h = height - padT - padB;
    const n = xLabels.length;
    const xAt = (i) => padL + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
    const yAt = (v) => padT + h - (Math.max(0, Math.min(yMax, v)) / yMax) * h;

    let grid = "";
    for (let g = 0; g <= 4; g++) {
      const v = (yMax / 4) * g;
      const y = yAt(v);
      grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + w}" y2="${y.toFixed(1)}" class="chart-grid"/>
        <text x="${padL - 6}" y="${(y + 3.5).toFixed(1)}" class="chart-axis-label" text-anchor="end">${Math.round(v)}</text>`;
    }
    // as many date labels as fit without colliding — a wider chart shows more,
    // rather than being stuck at the 6 that suited the old fixed 640px width
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 64))));
    let xAxis = "";
    xLabels.forEach((lbl, i) => {
      if (i % step !== 0 && i !== n - 1) return;
      xAxis += `<text x="${xAt(i).toFixed(1)}" y="${height - 4}" class="chart-axis-label" text-anchor="middle">${esc(lbl)}</text>`;
    });

    let marks = "";
    const visible = series.filter(s => s.visible !== false);
    for (const s of visible) {
      // a point with y == null is a deliberate gap (a skipped date — weekend,
      // holiday, whatever the caller excluded) — draw one polyline per
      // contiguous run of real points so the line actually breaks there
      // instead of "Math.min(yMax, null)" silently coercing to 0 and drawing
      // a fake dip down to the baseline.
      let run = [];
      const flushRun = () => {
        if (run.length > 1) {
          const pts = run.map(i => `${xAt(i).toFixed(1)},${yAt(s.points[i].y).toFixed(1)}`).join(" ");
          marks += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" class="chart-line"/>`;
        }
        run = [];
      };
      s.points.forEach((p, i) => {
        if (p.y == null) { flushRun(); return; }
        run.push(i);
      });
      flushRun();
      s.points.forEach((p, i) => {
        if (p.y == null) return;   // no dot, no tooltip, no "null" text — the date simply isn't plotted
        marks += `<circle class="chart-mark chart-dot" cx="${xAt(i).toFixed(1)}" cy="${yAt(p.y).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--panel)" stroke-width="2"
          data-tip-label="${esc(s.label)} — ${esc(xLabels[i])}" data-tip-value="${p.y}${p.suffix || ""}" tabindex="0">
          <title>${esc(s.label)} ${esc(xLabels[i])}: ${p.y}${p.suffix || ""}</title></circle>`;
      });
    }
    if (!visible.length) {
      marks = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-axis-label">No boards selected — click a legend entry to show it</text>`;
    }
    return `<svg class="chart-svg chart-line-chart" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Trend chart">
      ${grid}${xAxis}${marks}
    </svg>`;
  }

  /* ---------- legend (standard HTML UI, not an SVG mark — see dataviz skill) ---------- */
  /* `items`: [{key, label, color, muted}]. `onToggle`, if given, makes every
     entry clickable (used by the trend chart to show/hide a board's line);
     omit it for a plain read-only legend. */
  function legendEl(items, onToggle) {
    const el = document.createElement("div");
    el.className = "chart-legend";
    for (const item of items) {
      const tag = document.createElement(onToggle ? "button" : "span");
      tag.className = "chart-legend-item" + (item.muted ? " muted" : "");
      if (onToggle) tag.type = "button";
      const dot = document.createElement("span");
      dot.className = "chart-legend-dot";
      dot.style.background = item.muted ? "transparent" : item.color;
      dot.style.borderColor = item.color;
      const label = document.createElement("span");
      label.textContent = item.label;   // untrusted-ish (board/employee names) — textContent, never innerHTML
      tag.appendChild(dot);
      tag.appendChild(label);
      if (onToggle) tag.onclick = () => onToggle(item.key);
      el.appendChild(tag);
    }
    return el;
  }

  /* ---------- hover/focus tooltip (shared #chart-tip element) ---------- */
  /* Event-delegated so it only needs wiring once per container after each
     render (charts are rebuilt from scratch on every render(), same as the
     rest of this app's DOM). Reads data-tip-* off whatever .chart-mark was
     actually hit — works for donut arcs, bar segments and line dots alike. */
  function wireChartTooltips(root) {
    if (!root || root.dataset.tipWired) return;
    root.dataset.tipWired = "1";
    const tip = document.getElementById("chart-tip");
    if (!tip) return;
    const show = (target, x, y) => {
      const label = target.dataset.tipLabel;
      if (label == null) return;
      const value = target.dataset.tipValue;
      const pct = target.dataset.tipPct;
      tip.innerHTML = "";
      const v = document.createElement("div");
      v.className = "chart-tip-value";
      v.textContent = pct ? `${value} (${pct}%)` : value;
      const l = document.createElement("div");
      l.className = "chart-tip-label";
      l.textContent = label;
      tip.appendChild(v);
      tip.appendChild(l);
      tip.classList.remove("hidden");
      const margin = 12;
      let left = x + margin, top = y + margin;
      tip.style.left = "0px"; tip.style.top = "0px";   // measure at a stable position first
      const r = tip.getBoundingClientRect();
      if (left + r.width > window.innerWidth - 8) left = x - r.width - margin;
      if (top + r.height > window.innerHeight - 8) top = y - r.height - margin;
      tip.style.left = Math.max(8, left) + "px";
      tip.style.top = Math.max(8, top) + "px";
    };
    const hide = () => tip.classList.add("hidden");
    root.addEventListener("pointermove", (ev) => {
      const mark = ev.target.closest(".chart-mark");
      if (!mark || !root.contains(mark)) { hide(); return; }
      show(mark, ev.clientX, ev.clientY);
    });
    root.addEventListener("pointerleave", hide, true);
    root.addEventListener("focusin", (ev) => {
      const mark = ev.target.closest(".chart-mark");
      if (!mark) return;
      const r = mark.getBoundingClientRect();
      show(mark, r.left + r.width / 2, r.top);
    });
    root.addEventListener("focusout", hide);
  }

  return { sparkline, stackedBarH, barsH, lineChart, legendEl, wireChartTooltips, catColor, esc };
})();
