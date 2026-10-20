/* "Export → PowerPoint" for the Org Chart: lays the tree out on 16:9 slides and
   writes an editable .pptx (every card is a PowerPoint shape with its own text).
   No DOM and no database here, so the same layout runs in the browser (after
   PptxGenJS is loaded, see vendor/pptxgen.min.js) and in the node tests.

   app.js hands over the boards as plain trees, already cut to what is on
   screen: the filters applied and every collapsed node (the "Show to" level)
   left with no children. Each node: { type, name, sub, role, color, count,
   position, contract, areaName, areaColor, status, loan, shift, children }
   (loan: "↔ Board One" on someone borrowed, "→ Board Two" on someone lent out).

   One board per slide. A board too wide for one slide (even shrunk to
   MIN_SCALE) is split: its children are cut into runs that fit, each run on its
   own slide under the same board card; a child too wide on its own is split
   the same way one level down. Crew under a mission (or in the Standby / Leave
   pool) is a compact list, in columns, rather than one card per person side by
   side. layoutDeck() returns the slides as boxes and lines in inches; both the
   export preview (as SVG) and the .pptx are drawn from it. Defines OrgPptx. */

"use strict";

(function (root) {
  const SLIDE_W = 13.333, SLIDE_H = 7.5;
  const MARGIN = 0.35, TOP = 0.95, BOTTOM = 0.3;
  const AREA_W = SLIDE_W - 2 * MARGIN, AREA_H = SLIDE_H - TOP - BOTTOM;
  const BOX_W = 1.75, BOX_H = 0.62, HGAP = 0.18, VGAP = 0.32, LV = BOX_H + VGAP;
  const ROW_W = 1.75, ROW_H = 0.27, ROW_GAP = 0.04, COL_GAP = 0.12;
  const MIN_SCALE = 0.8;          // smaller than this and the crew lines stop being readable
  const MAX_W = AREA_W / MIN_SCALE;

  /* what a split cuts a node into, for the "split between its …" line */
  const CHILD_WORD = { board: "engineers", engineer: "service areas", area: "missions", mission: "crew", bucket: "people in the pool" };

  const isStack = (n) => n.children.length > 0 && n.children.every(c => c.type === "employee");
  /* how many crew rows fit under a node whose list starts at `level` */
  function maxRows(level) {
    const avail = AREA_H - level * LV;
    return Math.max(3, Math.floor((avail + ROW_GAP) / (ROW_H + ROW_GAP)));
  }
  function stackCols(n, level) { return Math.ceil(n.children.length / maxRows(level + 1)); }
  function width(n, level) {
    if (!n.children.length) return BOX_W;
    if (isStack(n)) {
      const cols = stackCols(n, level);
      return Math.max(BOX_W, cols * ROW_W + (cols - 1) * COL_GAP);
    }
    const sum = n.children.reduce((s, c) => s + width(c, level + 1), 0) + HGAP * (n.children.length - 1);
    return Math.max(BOX_W, sum);
  }

  /* Cut one node into pages. A page is { chain: ancestors shown above, root }
     where root may be the node with only some of its children (a part). */
  function paginate(n, chain, level, out, split) {
    if (width(n, level) <= MAX_W || !n.children.length) { out.push({ chain, root: n, split }); return; }
    let group = [];
    const flush = () => {
      if (group.length) out.push({ chain, root: Object.assign({}, n, { children: group }), split: n.type });
      group = [];
    };
    for (const c of n.children) {
      const trial = Object.assign({}, n, { children: group.concat([c]) });
      if (width(trial, level) <= MAX_W) { group.push(c); continue; }
      flush();
      const alone = Object.assign({}, n, { children: [c] });
      if (width(alone, level) <= MAX_W) group.push(c);
      else paginate(c, chain.concat([n]), level + 1, out, n.type);
    }
    flush();
  }

  /* lay one page out at scale 1 from the top-left of the content area */
  function placePage(page) {
    const boxes = [], lines = [];
    const lvl0 = page.chain.length;
    const rootW = width(page.root, lvl0);
    const nodeBox = (n, x, y) => ({ kind: "node", x, y, w: BOX_W, h: BOX_H, node: n });
    const link = (px, py, cx, cy) => {
      const mid = py + (cy - py) / 2;
      lines.push([px, py, px, mid], [px, mid, cx, mid], [cx, mid, cx, cy]);
    };
    function place(n, level, x0) {
      const w = width(n, level);
      const bx = x0 + (w - BOX_W) / 2, by = level * LV;
      const b = nodeBox(n, bx, by);
      boxes.push(b);
      const px = bx + BOX_W / 2, py = by + BOX_H;
      if (!n.children.length) return b;
      if (isStack(n)) {
        const rows = maxRows(level + 1), cols = stackCols(n, level);
        const sx = x0 + (w - (cols * ROW_W + (cols - 1) * COL_GAP)) / 2;
        n.children.forEach((e, i) => {
          const c = Math.floor(i / rows), r = i % rows;
          const x = sx + c * (ROW_W + COL_GAP), y = (level + 1) * LV + r * (ROW_H + ROW_GAP);
          boxes.push({ kind: "row", x, y, w: ROW_W, h: ROW_H, node: e });
          if (r === 0) link(px, py, x + ROW_W / 2, y);
        });
        return b;
      }
      let cx = x0;
      for (const c of n.children) {
        const cw = width(c, level + 1);
        const cb = place(c, level + 1, cx);
        link(px, py, cb.x + BOX_W / 2, cb.y);
        cx += cw + HGAP;
      }
      return b;
    }
    const rootBox = place(page.root, lvl0, 0);
    // the ancestors stack straight up above the page's root
    let below = rootBox;
    for (let i = lvl0 - 1; i >= 0; i--) {
      const b = nodeBox(page.chain[i], rootBox.x, i * LV);
      boxes.push(b);
      lines.push([b.x + BOX_W / 2, b.y + BOX_H, below.x + BOX_W / 2, below.y]);
      below = b;
    }
    const h = boxes.reduce((m, b) => Math.max(m, b.y + b.h), 0);
    return { boxes, lines, w: rootW, h };
  }

  /* scale to fit and move onto the slide */
  function fit(laid) {
    const s = Math.min(1, AREA_W / laid.w, AREA_H / laid.h);
    const ox = MARGIN + (AREA_W - laid.w * s) / 2, oy = TOP;
    const tx = (x) => ox + x * s, ty = (y) => oy + y * s;
    return {
      scale: s,
      boxes: laid.boxes.map(b => Object.assign({}, b, { x: tx(b.x), y: ty(b.y), w: b.w * s, h: b.h * s })),
      lines: laid.lines.map(([x1, y1, x2, y2]) => [tx(x1), ty(y1), tx(x2), ty(y2)]),
    };
  }

  /* boards → slides, each with its title, part number and what it was split by */
  function layoutDeck(boards) {
    const slides = [], summary = [];
    for (const b of boards) {
      const pages = [];
      paginate(b, [], 0, pages, null);
      const splits = [...new Set(pages.map(p => p.split).filter(Boolean))];
      summary.push({ board: b.name, slides: pages.length, splitBy: splits.map(t => CHILD_WORD[t] || t) });
      pages.forEach((p, i) => {
        slides.push(Object.assign(fit(placePage(p)), {
          board: b.name, part: i + 1, parts: pages.length,
          names: p.root === b ? [] : p.root.children.map(c => c.name),
        }));
      });
    }
    return { slides, summary, slideW: SLIDE_W, slideH: SLIDE_H };
  }

  /* the plain-language line under the preview, e.g. "4 slides: Board One 1;
     Board Two 3 (split between its engineers)" */
  function summaryText(deck) {
    const n = deck.slides.length;
    const parts = deck.summary.map(s => `${s.board}: ${s.slides} slide${s.slides === 1 ? "" : "s"}` +
      (s.splitBy.length ? ` (too wide for one slide, so split between its ${s.splitBy.join(" and ")})` : ""));
    return `${n} slide${n === 1 ? "" : "s"}, one per board. ${parts.join("; ")}.`;
  }

  /* ---- text and colour of a card, shared by the preview and the .pptx ---- */
  const LEVEL = { board: "Board", engineer: "Engineer", area: "Service area", mission: "Mission", bucket: "Pool" };
  const STATUS = { standby: "Standby", annual: "Annual leave", sick: "Sick leave", business: "Business leave", unpaid: "Unpaid leave", exchange: "Exchange day" };
  const hex = (c, d) => /^#[0-9a-f]{6}$/i.test(c || "") ? c.slice(1).toUpperCase() : /^#[0-9a-f]{3}$/i.test(c || "") ? c.slice(1).split("").map(x => x + x).join("").toUpperCase() : d;
  function cardText(n) {
    if (n.type === "employee") {
      const bits = [n.position, n.contract === "oncall" ? "On-call" : "Permanent", STATUS[n.status] || "", n.loan || ""].filter(Boolean);
      return { name: n.name, line: bits.join(" · ") };
    }
    const shift = n.type === "mission" ? (n.shift === "night" ? "Night" : "Day") : "";
    return {
      label: n.role || LEVEL[n.type] || "",
      name: n.name + (n.sub ? "  " + n.sub : ""),
      line: [shift, n.count].filter(Boolean).join(" · "),
    };
  }
  const accentOf = (n) => n.type === "employee" ? hex(n.areaColor, "C3CCD6") : n.type === "board" ? "00325A" : hex(n.color, "C3CCD6");

  /* ---- write the .pptx ---- */
  async function buildPptx(PptxGenJS, deck, opts) {
    const pres = new PptxGenJS();
    pres.layout = "LAYOUT_WIDE";   // 13.333 × 7.5 in, the size the layout assumes
    pres.title = opts.title || "Org Chart";
    for (const sl of deck.slides) {
      const s = pres.addSlide();
      s.background = { color: "FFFFFF" };
      s.addText(`Org Chart — ${sl.board}`, { x: MARGIN, y: 0.22, w: 8.5, h: 0.4, fontSize: 18, bold: true, color: "00325A", fontFace: "Calibri" });
      s.addText([opts.dateText, sl.parts > 1 ? `Part ${sl.part} of ${sl.parts}` : "", opts.scopeText].filter(Boolean).join("  ·  "),
        { x: MARGIN, y: 0.58, w: 12, h: 0.28, fontSize: 10, color: "5B6B7B", fontFace: "Calibri" });
      for (const [x1, y1, x2, y2] of sl.lines) {
        s.addShape(pres.ShapeType.line, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(Math.abs(x2 - x1), 0.001), h: Math.max(Math.abs(y2 - y1), 0.001),
          line: { color: "AEB8C3", width: 0.75 } });
      }
      const f = sl.scale;
      for (const b of sl.boxes) {
        const t = cardText(b.node);
        const accent = accentOf(b.node);
        const runs = b.kind === "row"
          ? [{ text: t.name, options: { bold: true, fontSize: 9 * f, color: "1D2733" } },
             { text: t.line ? "  " + t.line : "", options: { fontSize: 7.5 * f, color: "5B6B7B" } }]
          : [{ text: t.label, options: { fontSize: 7.5 * f, color: "5B6B7B", breakLine: true } },
             { text: t.name, options: { bold: true, fontSize: 11 * f, color: "1D2733", breakLine: true } },
             { text: t.line, options: { fontSize: 8 * f, color: "5B6B7B" } }];
        s.addText(runs, {
          shape: pres.ShapeType.roundRect, rectRadius: 0.06,
          x: b.x, y: b.y, w: b.w, h: b.h, fill: { color: "FFFFFF" }, line: { color: "C3CCD6", width: 0.75 },
          margin: [3, 5, 2, 6], valign: "middle", fontFace: "Calibri", fit: "shrink",
        });
        // the card's colour as a strip along its top edge, the way the app draws it
        s.addShape(pres.ShapeType.rect, { x: b.x + 0.05 * f, y: b.y, w: b.w - 0.1 * f, h: (b.kind === "row" ? 0.025 : 0.045) * f, fill: { color: accent }, line: { color: accent, width: 0 } });
      }
    }
    return pres.write({ outputType: "blob" });
  }

  /* ---- the preview: each slide as a small SVG ---- */
  function slideSvg(sl, deck, esc) {
    const k = 100;   // px per inch inside the viewBox
    const parts = [`<svg viewBox="0 0 ${deck.slideW * k} ${deck.slideH * k}" role="img" aria-label="Slide: ${esc(sl.board)}${sl.parts > 1 ? `, part ${sl.part} of ${sl.parts}` : ""}">`,
      `<rect width="100%" height="100%" fill="#fff"/>`,
      `<text x="${MARGIN * k}" y="${0.5 * k}" font-size="28" font-weight="700" fill="#00325a">Org Chart — ${esc(sl.board)}${sl.parts > 1 ? ` (${sl.part}/${sl.parts})` : ""}</text>`];
    for (const [x1, y1, x2, y2] of sl.lines) parts.push(`<line x1="${x1 * k}" y1="${y1 * k}" x2="${x2 * k}" y2="${y2 * k}" stroke="#aeb8c3" stroke-width="1.5"/>`);
    for (const b of sl.boxes) {
      const t = cardText(b.node);
      parts.push(`<rect x="${b.x * k}" y="${b.y * k}" width="${b.w * k}" height="${b.h * k}" rx="5" fill="#fff" stroke="#c3ccd6"/>`,
        `<rect x="${(b.x + 0.05 * sl.scale) * k}" y="${b.y * k}" width="${(b.w - 0.1 * sl.scale) * k}" height="${(b.kind === "row" ? 2.5 : 4.5) * sl.scale}" fill="#${accentOf(b.node)}"/>`,
        `<text x="${(b.x + 0.08 * sl.scale) * k}" y="${(b.y + b.h / 2) * k + 4 * sl.scale}" font-size="${(b.kind === "row" ? 12 : 14) * sl.scale}" font-weight="600" fill="#1d2733">${esc(t.name).slice(0, 26)}</text>`);
    }
    parts.push("</svg>");
    return parts.join("");
  }

  const api = { layoutDeck, summaryText, buildPptx, slideSvg, cardText, MIN_SCALE, SLIDE_W, SLIDE_H };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrgPptx = api;
})(globalThis);
