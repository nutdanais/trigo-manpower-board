/* "Export to Excel": turns one board's day into an .xlsx workbook. No DOM and
   no database here, so the same code runs in the browser (after ExcelJS is
   loaded, see vendor/exceljs.min.js) and in the node tests. app.js gathers the
   data (who is on which mission) and hands it over as flat rows; this file
   owns everything about the sheet: the column set, the navy banner that
   mirrors the app's top bar, the table and the totals. Defines ManpowerXlsx. */

"use strict";

(function (root) {
  /* The thirteen exportable columns, in sheet order. `width` is Excel's
     character width. `center` columns are the short ones (shift, times). */
  const COLUMNS = [
    { key: "name",     label: "Name",          width: 30 },
    { key: "contract", label: "Contract Type", width: 17 },
    { key: "position", label: "Position",      width: 25 },
    { key: "area",     label: "Service Area",  width: 16 },
    { key: "mission",  label: "Mission",       width: 11 },
    { key: "host",     label: "Host",          width: 22 },
    { key: "customer", label: "Customer",      width: 24 },
    { key: "ppe",      label: "PPE",           width: 31 },
    { key: "shift",    label: "Shift",         width: 8, center: true },
    { key: "start",    label: "Start",         width: 8, center: true },
    { key: "end",      label: "End",           width: 8, center: true },
    { key: "engineer", label: "Engineer",      width: 18 },
    { key: "remark",   label: "Remark",        width: 28 },
  ];
  const ALL_KEYS = COLUMNS.map((c) => c.key);

  /* TRIGO palette, ARGB. Same navy/green as the app's top bar (styles.css
     --primary / --brand-green) and the shift tints from the design system. */
  const C = {
    navy: "FF004983", green: "FFA8C855", ink: "FF13222F", mut: "FF5C707F", line: "FFD8E0E7",
    paper: "FFF2F5F8", pale: "FFEAF1F7", onNavy: "FFB8CCDD", divider: "FF6F93B2",
    dayBg: "FFFFF3CC", dayFg: "FF7A5B00", nightBg: "FFE4E5F7", nightFg: "FF31357D", oncall: "FFB45309",
    okBg: "FFEAF4D5", okFg: "FF40610A",
  };

  const pxOf = (w) => w * 7 + 5;   // Excel column width (chars) -> approx. pixels

  /* Keep only known keys, in sheet order, whatever order or junk was passed. */
  function normalizeColumns(keys) {
    const want = new Set(Array.isArray(keys) ? keys : ALL_KEYS);
    return COLUMNS.filter((c) => want.has(c.key));
  }

  /* One employee counted once, however many rows they appear on. */
  function summarize(rows) {
    const seen = new Map();
    const missions = new Set();
    for (const r of rows) {
      if (!seen.has(r.empId)) seen.set(r.empId, r.contract);
      missions.add(r.mission + "|" + r.shift);
    }
    let permanent = 0, oncall = 0;
    for (const c of seen.values()) { if (c === "On-call") oncall++; else permanent++; }
    return { total: seen.size, permanent, oncall, missions: missions.size };
  }

  /* Sheet names: Excel forbids []:*?/\ and caps the name at 31 characters. */
  function safeSheetName(name) {
    const s = String(name || "").replace(/[\[\]:*?\/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31);
    return s || "Manpower Board";
  }

  /* Splits the banner into four blocks (logo, title, board + date, total) over
     consecutive columns. A block takes columns until it is wide enough for its
     content; when the ticked columns are too few to hold all four, blank navy
     filler columns are added to the right so nothing is ever cut off. */
  function bannerLayout(widths) {
    const needs = [200, 250, 330, 160];            // min pixels: logo, title, board/date, total
    const spans = [];
    let i = 0;
    const fillers = [];
    for (const need of needs) {
      let w = 0, n = 0;
      while (w < need) {
        if (i < widths.length) w += pxOf(widths[i]);
        else { fillers.push(14); w += pxOf(14); }
        i++; n++;
      }
      spans.push(n);
    }
    return { spans, fillers, bannerCols: i };      // i = banner columns incl. fillers (leftover table columns stay blank navy)
  }

  /* People on the board who are not on a mission get their own sheets, one per
     reason, so each list can be read (or sent) on its own:
       leave    - every leave type plus Exchange Working Day, with the type shown
       standby  - permanent staff with no mission
       oncall   - on-call staff with no mission (Available On-call)
     Name is always there (a list without names is useless); Contract Type /
     Position / Service Area follow the same ticks as the main sheet; Mobile
     Number is added because these are the people a planner may need to ring. */
  const LEAVE_ORDER = ["annual", "sick", "business", "unpaid", "exchange"];
  const PICKER_SHARED = ["contract", "position", "area"];
  const PHONE_COL = { key: "phone", label: "Mobile Number", width: 16 };
  const LEAVE_TYPE_COL = { key: "leave", label: "Leave Type", width: 34 };
  /* what each extra sheet is called and says about itself */
  const GROUPS = {
    leave:   { sheetName: "Leave & Exchange",  subtitle: "LEAVE & EXCHANGE WORKING DAY", bigLabel: "ON LEAVE / EXCHANGE", extra: [LEAVE_TYPE_COL, PHONE_COL] },
    standby: { sheetName: "Standby",           subtitle: "STANDBY · PERMANENT, UNASSIGNED", bigLabel: "ON STANDBY", extra: [PHONE_COL] },
    oncall:  { sheetName: "Available On-call", subtitle: "AVAILABLE ON-CALL · UNASSIGNED", bigLabel: "AVAILABLE ON-CALL", extra: [PHONE_COL] },
  };
  const GROUP_KEYS = Object.keys(GROUPS);
  /* leave type cell tints: Exchange Working Day is a worked day so it reads green,
     every real leave reads amber */
  const LEAVE_TINT = { exchange: [C.okBg, C.okFg] };
  function groupColumns(group, keys) {
    const want = new Set(Array.isArray(keys) ? keys : ALL_KEYS);
    const base = COLUMNS.filter((c) => c.key === "name" || (PICKER_SHARED.includes(c.key) && want.has(c.key)));
    return base.concat(GROUPS[group].extra);
  }
  /* people once each; for leave, per-type counts in leave-zone order */
  function summarizeLeave(rows) {
    const seen = new Set();
    const byType = new Map();
    for (const r of rows) {
      if (seen.has(r.empId)) continue;
      seen.add(r.empId);
      byType.set(r.leaveKey, { label: r.leaveEn, n: (byType.has(r.leaveKey) ? byType.get(r.leaveKey).n : 0) + 1 });
    }
    const types = LEAVE_ORDER.filter((k) => byType.has(k)).map((k) => byType.get(k));
    return { total: seen.size, types };
  }
  const countPeople = (rows) => new Set(rows.map((r) => r.empId)).size;

  async function loadLogo(ExcelJS, wb, logo) {
    if (!logo) return null;
    return wb.addImage({ buffer: logo, extension: "png" });
  }

  /* One sheet in the TRIGO layout: navy banner (logo, title, board + date, a
     big number), green rule, table, total row. spec: { sheetName, title,
     subtitle, boardName, dateEn, dateTh, bigNumber, bigLabel, cols, rows,
     footer: {main, detail}, logoId, styleCell(col, row, cell, helpers) } */
  function addSheet(wb, spec) {
    const { cols, rows } = spec;
    const ws = wb.addWorksheet(spec.sheetName, {
      views: [{ showGridLines: false }],
      pageSetup: {
        orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.25 },
      },
      headerFooter: { oddFooter: "&L&8Manpower Board — " + String(spec.boardName || "").replace(/&/g, "&&") + "&R&8Page &P of &N" },
    });

    const widths = cols.map((c) => c.width);
    const layout = bannerLayout(widths);
    const nTable = cols.length;
    const nCols = Math.max(nTable, layout.bannerCols);
    const allWidths = widths.concat(layout.fillers);
    // anything past the four blocks (spare table columns) is blank navy; widths of fillers come after table columns
    for (let c = 0; c < nCols; c++) ws.getColumn(c + 1).width = allWidths[c] || 14;

    const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
    const font = (o) => Object.assign({ name: "Calibri", size: 11, color: { argb: C.ink } }, o);

    // ---- banner: rows 1-3 navy, 4 green rule, 5 spacer ----
    const heights = [14, 26, 18, 4, 10];
    heights.forEach((h, r) => { ws.getRow(r + 1).height = h; });
    for (let c = 1; c <= nCols; c++) {
      for (let r = 1; r <= 3; r++) ws.getCell(r, c).fill = fill(C.navy);
      ws.getCell(4, c).fill = fill(C.green);
    }
    // block start columns (1-based)
    const start = [1];
    layout.spans.forEach((n, k) => start.push(start[k] + n));
    const [, sTitle, sBoard, sTotal, sEnd] = start;
    const divider = { left: { style: "thin", color: { argb: C.divider } } };
    const block = (colFrom, colTo, top, bottom, topCfg, bottomCfg) => {
      if (colTo < colFrom) return;
      if (colTo > colFrom) {   // a one-column block needs no merge (and Excel flags a one-cell merge for repair)
        ws.mergeCells(2, colFrom, 2, colTo);
        ws.mergeCells(3, colFrom, 3, colTo);
      }
      const a = ws.getCell(2, colFrom), b = ws.getCell(3, colFrom);
      a.value = top; a.font = topCfg.font; a.alignment = Object.assign({ vertical: "bottom", indent: 1 }, topCfg.align);
      b.value = bottom; b.font = bottomCfg.font; b.alignment = Object.assign({ vertical: "top", indent: 1 }, bottomCfg.align);
      a.border = divider; b.border = divider;
    };
    const white = { argb: "FFFFFFFF" };
    block(sTitle, sBoard - 1, spec.title, spec.subtitle,
      { font: font({ size: 20, bold: true, color: white }) }, { font: font({ size: 10, color: { argb: C.onNavy } }) });
    block(sBoard, sTotal - 1, spec.boardName || "", [spec.dateEn, spec.dateTh].filter(Boolean).join("  ·  "),
      { font: font({ size: 18, bold: true, color: white }) }, { font: font({ size: 10.5, color: { argb: C.onNavy } }) });
    block(sTotal, sEnd - 1, spec.bigNumber, spec.bigLabel,
      { font: font({ size: 20, bold: true, color: { argb: C.green } }), align: { horizontal: "left" } },
      { font: font({ size: 10, color: { argb: C.onNavy } }) });

    // logo sits over the first block (rows 1-3)
    if (spec.logoId !== null && spec.logoId !== undefined) {
      ws.addImage(spec.logoId, { tl: { col: 0.15, row: 0.35 }, ext: { width: 175, height: 43.1 }, editAs: "oneCell" });
    } else {
      ws.mergeCells(2, 1, 3, Math.max(1, sTitle - 1));
      const t = ws.getCell(2, 1);
      t.value = "TRIGO"; t.font = font({ size: 22, bold: true, color: white }); t.alignment = { vertical: "middle", indent: 1 };
    }

    // ---- table header (row 6) ----
    const HEAD = 6;
    ws.getRow(HEAD).height = 24;
    cols.forEach((col, i) => {
      const cell = ws.getCell(HEAD, i + 1);
      cell.value = col.label;
      cell.font = font({ bold: true, color: white });
      cell.fill = fill(C.navy);
      cell.alignment = { vertical: "middle", horizontal: col.center ? "center" : "left", indent: col.center ? 0 : 1 };
      cell.border = { bottom: { style: "medium", color: { argb: C.green } } };
    });

    // ---- body ----
    rows.forEach((r, k) => {
      const row = ws.getRow(HEAD + 1 + k);
      row.height = 20;
      cols.forEach((col, i) => {
        const cell = row.getCell(i + 1);
        cell.value = r[col.key] === undefined || r[col.key] === null ? "" : r[col.key];
        cell.font = font({ bold: col.key === "name" });
        cell.alignment = { vertical: "middle", horizontal: col.center ? "center" : "left", indent: col.center ? 0 : 1 };
        cell.border = { bottom: { style: "thin", color: { argb: C.line } } };
        if (k % 2 === 1) cell.fill = fill(C.paper);
        if (col.key === "contract" && r.contract === "On-call") cell.font = font({ bold: true, color: { argb: C.oncall } });
        if (col.key === "shift") {
          const night = r.shift === "Night";
          cell.fill = fill(night ? C.nightBg : C.dayBg);
          cell.font = font({ bold: true, color: { argb: night ? C.nightFg : C.dayFg } });
        }
        if (col.key === "leave") {
          const t = LEAVE_TINT[r.leaveKey] || [C.dayBg, C.dayFg];
          cell.fill = fill(t[0]);
          cell.font = font({ bold: true, color: { argb: t[1] } });
        }
        if (col.key === "remark") cell.font = font({ italic: true, color: { argb: C.mut } });
      });
    });

    // ---- total row ----
    const lastData = HEAD + rows.length;
    const TOT = lastData + 1;
    ws.getRow(TOT).height = 26;
    for (let c = 1; c <= nTable; c++) {
      const cell = ws.getCell(TOT, c);
      cell.fill = fill(C.pale);
      cell.border = { top: { style: "medium", color: { argb: C.navy } } };
    }
    const labelSpan = Math.min(nTable, 4);
    if (labelSpan > 1) ws.mergeCells(TOT, 1, TOT, labelSpan);
    const tc = ws.getCell(TOT, 1);
    const rich = [{ text: spec.footer.main, font: font({ size: 12, bold: true, color: { argb: C.navy } }) }];
    if (spec.footer.detail) rich.push({ text: "   " + spec.footer.detail, font: font({ size: 10.5, color: { argb: C.mut } }) });
    tc.value = { richText: rich };
    tc.alignment = { vertical: "middle", indent: 1 };

    ws.views = [{ showGridLines: false, state: "frozen", ySplit: HEAD }];
    ws.pageSetup.printTitlesRow = HEAD + ":" + HEAD;
    if (rows.length) ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: lastData, column: nTable } };
    return ws;
  }

  /* Builds the workbook. `ExcelJS` is passed in so the browser can lazy-load it.
     opts: { boardName, dateEn, dateTh, columns: [keys], rows: [row],
             groups: { leave: [pRow], standby: [pRow], oncall: [pRow] } (each optional),
             logo: ArrayBuffer|Buffer|null }
     A row (sheet 1: people on missions) is { empId, name, contract: "Permanent"|"On-call",
     position, area, mission, host, customer, ppe, shift: "Day"|"Night", start, end, engineer, remark }.
     A pRow (people not on a mission) is { empId, name, contract, position, area, phone }, and for
     the leave group also { leaveKey: one of LEAVE_ORDER, leave: "Annual Leave · ลาพักร้อน", leaveEn }.
     An empty or missing group adds no sheet. The header and the total row show only the
     total number of employees; the Permanent / On-call split appears only when the
     Contract Type column was picked. */
  async function buildWorkbook(ExcelJS, opts) {
    const cols = normalizeColumns(opts.columns);
    if (!cols.length) throw new Error("Pick at least one column to export.");
    const rows = opts.rows || [];
    const sum = summarize(rows);
    const wb = new ExcelJS.Workbook();
    wb.creator = "TRIGO Manpower Board";
    wb.created = new Date();
    const logoId = await loadLogo(ExcelJS, wb, opts.logo);
    const common = { boardName: opts.boardName, dateEn: opts.dateEn, dateTh: opts.dateTh, logoId, title: "Manpower Board" };

    const withContract = cols.some((c) => c.key === "contract");
    const used = new Set();
    const mainName = safeSheetName(opts.boardName);
    used.add(mainName.toLowerCase());
    addSheet(wb, Object.assign({}, common, {
      sheetName: mainName, subtitle: "OPERATIONS PLANNING",
      bigNumber: sum.total, bigLabel: "TOTAL EMPLOYEES", cols, rows,
      footer: {
        main: "TOTAL EMPLOYEES: " + sum.total,
        detail: withContract ? "(Permanent " + sum.permanent + " · On-call " + sum.oncall + ")" : "",
      },
    }));

    const groupSummary = {};
    for (const g of GROUP_KEYS) {
      const grows = (opts.groups && opts.groups[g]) || [];
      if (!grows.length) { groupSummary[g] = null; continue; }
      let name = GROUPS[g].sheetName;
      if (used.has(name.toLowerCase())) name += " (2)";   // a board literally named "Standby" must not collide
      used.add(name.toLowerCase());
      let footer;
      if (g === "leave") {
        const ls = summarizeLeave(grows);
        groupSummary[g] = ls;
        footer = { main: "TOTAL: " + ls.total, detail: "(" + ls.types.map((t) => t.label + " " + t.n).join(" · ") + ")" };
      } else {
        const n = countPeople(grows);
        groupSummary[g] = { total: n };
        footer = { main: "TOTAL: " + n, detail: "" };
      }
      addSheet(wb, Object.assign({}, common, {
        sheetName: name, subtitle: GROUPS[g].subtitle, bigNumber: groupSummary[g].total, bigLabel: GROUPS[g].bigLabel,
        cols: groupColumns(g, opts.columns), rows: grows, footer,
      }));
    }
    return { workbook: wb, summary: Object.assign({}, sum, { groups: groupSummary }) };
  }

  const api = { COLUMNS, ALL_KEYS, LEAVE_ORDER, GROUPS, GROUP_KEYS, normalizeColumns, summarize, summarizeLeave, groupColumns, safeSheetName, bannerLayout, buildWorkbook };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ManpowerXlsx = api;
})(globalThis);
