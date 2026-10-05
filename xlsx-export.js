/* "Export to Excel": turns one board's day into an .xlsx workbook. No DOM and
   no database here, so the same code runs in the browser (after ExcelJS is
   loaded, see vendor/exceljs.min.js) and in the node tests. app.js gathers the
   data (who is on which mission) and hands it over as flat rows; this file
   owns everything about the sheet: the column set, the navy banner that
   mirrors the app's top bar, the table and the totals. It also builds the
   plain Manpower List sheet (header row only, no banner). Everything in the
   file can come out in English or Thai (opts.lang: "en" | "th"). Defines
   ManpowerXlsx. */

"use strict";

(function (root) {
  /* The sixteen exportable columns, in sheet order. `width` is Excel's
     character width. `center` columns are the short ones (shift, times). */
  const COLUMNS = [
    { key: "name",     label: "Name",          th: "ชื่อ",             width: 30 },
    { key: "contract", label: "Contract Type", th: "ประเภทสัญญา",     width: 17 },
    { key: "position", label: "Position",      th: "ตำแหน่ง",         width: 25 },
    { key: "phone",    label: "Mobile Number", th: "เบอร์มือถือ",      width: 16 },
    { key: "startDate", label: "Start Date",   th: "วันที่เริ่มงาน",   width: 14, center: true },
    { key: "service",  label: "Years of Service", th: "อายุงาน",      width: 26 },
    { key: "area",     label: "Service Area",  th: "พื้นที่บริการ",    width: 16 },
    { key: "mission",  label: "Mission",       th: "ภารกิจ",          width: 11 },
    { key: "host",     label: "Host",          th: "โฮสต์",           width: 22 },
    { key: "customer", label: "Customer",      th: "ลูกค้า",          width: 24 },
    { key: "ppe",      label: "PPE",           th: "PPE",             width: 31 },
    { key: "shift",    label: "Shift",         th: "กะ",              width: 8, center: true },
    { key: "start",    label: "Start",         th: "เริ่ม",            width: 8, center: true },
    { key: "end",      label: "End",           th: "สิ้นสุด",          width: 8, center: true },
    { key: "engineer", label: "Engineer",      th: "วิศวกร",          width: 18 },
    { key: "remark",   label: "Remark",        th: "หมายเหตุ",        width: 28 },
  ];
  const ALL_KEYS = COLUMNS.map((c) => c.key);
  /* The TRIGO ID is not one of the picked columns: it is on every sheet,
     right after Name (or first, when Name is unticked). */
  const TRIGO_ID_COL = { key: "trigoId", label: "TRIGO ID", th: "รหัส TRIGO", width: 11, center: true };
  function withTrigoId(cols) {
    const out = cols.slice();
    out.splice(out.findIndex((c) => c.key === "name") + 1, 0, TRIGO_ID_COL);
    return out;
  }

  /* TRIGO palette, ARGB. Same navy/green as the app's top bar (styles.css
     --primary / --brand-green) and the shift tints from the design system. */
  const C = {
    navy: "FF004983", green: "FFA8C855", ink: "FF13222F", mut: "FF5C707F", line: "FFD8E0E7",
    paper: "FFF2F5F8", pale: "FFEAF1F7", onNavy: "FFB8CCDD", divider: "FF6F93B2",
    dayBg: "FFFFF3CC", dayFg: "FF7A5B00", nightBg: "FFE4E5F7", nightFg: "FF31357D", oncall: "FFB45309",
    okBg: "FFEAF4D5", okFg: "FF40610A",
  };

  const pxOf = (w) => w * 7 + 5;   // Excel column width (chars) -> approx. pixels

  /* ---------- language ----------
     Rows always arrive in English (that is what app.js and the tests speak);
     the words in the file are chosen here. Hosts, customers, service areas and
     free text are the user's own data and are never translated; a person's name
     comes out as their English name in an English file and their Thai name in a
     Thai one (rows carry both: name = Thai, nameEn = English). */
  const normLang = (l) => (l === "th" ? "th" : "en");
  /* a person's name in the file's language: English file -> the English name, Thai file -> the
     Thai name (row.name); whichever one exists when the wanted one is empty */
  const personName = (r, lang) => (normLang(lang) === "en" ? (r.nameEn || r.name) : (r.name || r.nameEn)) || "";
  const labelOf = (col, lang) => (normLang(lang) === "th" && col.th ? col.th : col.label);
  const TEXT = {
    en: {
      title: "Manpower Board", subtitle: "OPERATIONS PLANNING", totalEmployees: "TOTAL EMPLOYEES", total: "TOTAL",
      permanent: "Permanent", oncall: "On-call", page: "Page &P of &N", listSheet: "Manpower List",
    },
    th: {
      title: "บอร์ดกำลังคน", subtitle: "การวางแผนปฏิบัติการ", totalEmployees: "พนักงานทั้งหมด", total: "รวม",
      permanent: "ประจำ", oncall: "ออนคอล", page: "หน้า &P จาก &N", listSheet: "รายชื่อพนักงาน",
    },
  };
  const VALUES = {
    th: {
      contract: { "Permanent": "ประจำ", "On-call": "ออนคอล" },
      shift: { "Day": "กลางวัน", "Night": "กลางคืน" },
      position: {
        "Inspector": "ผู้ตรวจสอบ", "Senior Inspector": "ผู้ตรวจสอบอาวุโส", "Technician": "ช่างเทคนิค",
        "Team Leader": "หัวหน้าทีม", "Assistant Site Engineer": "ผู้ช่วยวิศวกรหน้างาน",
      },
      status: { "Active": "ใช้งาน", "Inactive": "ไม่ใช้งาน" },
    },
  };
  /* one English value -> the file's language; anything unknown is left as it is */
  function say(kind, value, lang) {
    const m = VALUES[normLang(lang)];
    return (m && m[kind] && m[kind][value]) || value;
  }

  /* Start dates travel as "YYYY-MM-DD" text (what the database and the date
     input use). Parsed to a UTC midnight so no time zone can move the day. */
  function parseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? t : null;
  }

  /* Length of service from a start date until `todayIso`, in whole calendar
     years / months / days. Whole months are counted from the start date (a
     start on the 31st lands on the last day of a shorter month), and the days
     are what is left after them, so nothing is ever negative. A missing,
     invalid or future start date gives null. */
  function serviceParts(startIso, todayIso) {
    const s = parseIso(startIso), t = parseIso(todayIso);
    if (!s || !t || s > t) return null;
    let months = (t.getUTCFullYear() - s.getUTCFullYear()) * 12 + (t.getUTCMonth() - s.getUTCMonth());
    if (t.getUTCDate() < s.getUTCDate()) months--;
    const anchorMonth = s.getUTCMonth() + months;
    const lastDay = new Date(Date.UTC(s.getUTCFullYear(), anchorMonth + 1, 0)).getUTCDate();
    const anchor = new Date(Date.UTC(s.getUTCFullYear(), anchorMonth, Math.min(s.getUTCDate(), lastDay)));
    return { years: Math.floor(months / 12), months: months % 12, days: Math.round((t - anchor) / 86400000) };
  }

  /* "3 years 5 months 12 days" (Thai: "3 ปี 5 เดือน 12 วัน"). All three parts
     are always shown ("0 years 0 months 5 days"); English is singular for
     exactly 1. "" when there is no usable start date. */
  function serviceLength(startIso, todayIso, lang) {
    const p = serviceParts(startIso, todayIso);
    if (!p) return "";
    if (normLang(lang) === "th") return p.years + " ปี " + p.months + " เดือน " + p.days + " วัน";
    const unit = (n, one) => n + " " + one + (n === 1 ? "" : "s");
    return unit(p.years, "year") + " " + unit(p.months, "month") + " " + unit(p.days, "day");
  }

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
     Name and TRIGO ID are always there (a list without names is useless); Contract Type /
     Position / Mobile Number / Start Date / Years of Service / Service Area follow the same ticks as the main
     sheet (so unticking Mobile Number keeps phone numbers out of every sheet). */
  const LEAVE_ORDER = ["annual", "sick", "business", "unpaid", "exchange"];
  const PICKER_SHARED = ["contract", "position", "phone", "startDate", "service", "area"];
  const LEAVE_TYPE_COL = { key: "leave", label: "Leave Type", th: "ประเภทการลา", width: 34 };
  /* what each extra sheet is called and says about itself */
  const GROUPS = {
    leave:   { sheetName: "Leave & Exchange",  subtitle: "LEAVE & EXCHANGE WORKING DAY", bigLabel: "ON LEAVE / EXCHANGE", extra: [LEAVE_TYPE_COL],
               th: { sheetName: "ลาและสลับวันหยุด", subtitle: "วันลาและสลับวันหยุด", bigLabel: "ลา / สลับวันหยุด" } },
    standby: { sheetName: "Standby",           subtitle: "STANDBY · PERMANENT, UNASSIGNED", bigLabel: "ON STANDBY", extra: [],
               th: { sheetName: "สแตนด์บาย", subtitle: "สแตนด์บาย · พนักงานประจำที่ยังไม่มีภารกิจ", bigLabel: "สแตนด์บาย" } },
    oncall:  { sheetName: "Available On-call", subtitle: "AVAILABLE ON-CALL · UNASSIGNED", bigLabel: "AVAILABLE ON-CALL", extra: [],
               th: { sheetName: "ออนคอลที่ว่าง", subtitle: "ออนคอลที่ว่าง · ยังไม่มีภารกิจ", bigLabel: "ออนคอลที่ว่าง" } },
  };
  const groupText = (g, lang) => (normLang(lang) === "th" ? GROUPS[g].th : GROUPS[g]);
  const GROUP_KEYS = Object.keys(GROUPS);
  /* leave type cell tints: Exchange Working Day is a worked day so it reads green,
     every real leave reads amber */
  const LEAVE_TINT = { exchange: [C.okBg, C.okFg] };
  function groupColumns(group, keys) {
    const want = new Set(Array.isArray(keys) ? keys : ALL_KEYS);
    const base = COLUMNS.filter((c) => c.key === "name" || (PICKER_SHARED.includes(c.key) && want.has(c.key)));
    return withTrigoId(base).concat(GROUPS[group].extra);
  }
  /* the leave type in the file's language (a row may carry only a combined `leave`) */
  const leaveLabel = (r, lang) => (normLang(lang) === "th" ? (r.leaveTh || r.leave) : (r.leaveEn || r.leave)) || "";
  /* people once each; for leave, per-type counts in leave-zone order */
  function summarizeLeave(rows, lang) {
    const seen = new Set();
    const byType = new Map();
    for (const r of rows) {
      if (seen.has(r.empId)) continue;
      seen.add(r.empId);
      byType.set(r.leaveKey, { label: leaveLabel(r, lang), n: (byType.has(r.leaveKey) ? byType.get(r.leaveKey).n : 0) + 1 });
    }
    const types = LEAVE_ORDER.filter((k) => byType.has(k)).map((k) => byType.get(k));
    return { total: seen.size, types };
  }
  const countPeople = (rows) => new Set(rows.map((r) => r.empId)).size;

  async function loadLogo(ExcelJS, wb, logo) {
    if (!logo) return null;
    return wb.addImage({ buffer: logo, extension: "png" });
  }

  const fillOf = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const fontOf = (o) => Object.assign({ name: "Calibri", size: 11, color: { argb: C.ink } }, o);

  /* The value and look of one body cell, shared by the board sheets and the
     Manpower List sheet. `k` is the row index (odd rows get a light tint).
     spec: { lang, today } */
  function writeBodyCell(cell, col, r, k, spec) {
    const lang = normLang(spec.lang);
    let v = r[col.key];
    if (col.key === "startDate") {
      // a real Excel date (sorts and filters as one), shown like the app: 20-Apr-2023
      const d = parseIso(r.startDate);
      v = d || "";
      if (d) cell.numFmt = "dd-mmm-yyyy";
    } else if (col.key === "service") {
      v = serviceLength(r.startDate, spec.today, lang);
    } else if (col.key === "name" && !col.exact) {
      v = personName(r, lang);
    } else if (col.key === "contract" || col.key === "shift" || col.key === "position") {
      v = say(col.key, v, lang);
    } else if (col.key === "leave") {
      v = leaveLabel(r, lang);
    } else if (col.key === "status") {
      v = say("status", r.active === false ? "Inactive" : "Active", lang);
    } else if (col.key === "util") {
      // a real percentage (0.05 shows as 5%); blank while unknown or no working days
      v = typeof r.util === "number" ? r.util / 100 : "";
      if (v !== "") cell.numFmt = "0%";
    }
    cell.value = v === undefined || v === null ? "" : v;
    cell.font = fontOf({ bold: col.key === "name" });
    cell.alignment = { vertical: "middle", horizontal: col.center ? "center" : "left", indent: col.center ? 0 : 1 };
    cell.border = { bottom: { style: "thin", color: { argb: C.line } } };
    if (k % 2 === 1) cell.fill = fillOf(C.paper);
    if (col.key === "contract" && r.contract === "On-call") cell.font = fontOf({ bold: true, color: { argb: C.oncall } });
    if (col.key === "status" && r.active === false) cell.font = fontOf({ color: { argb: C.mut } });
    if (col.key === "shift") {
      const night = r.shift === "Night";
      cell.fill = fillOf(night ? C.nightBg : C.dayBg);
      cell.font = fontOf({ bold: true, color: { argb: night ? C.nightFg : C.dayFg } });
    }
    if (col.key === "leave") {
      const t = LEAVE_TINT[r.leaveKey] || [C.dayBg, C.dayFg];
      cell.fill = fillOf(t[0]);
      cell.font = fontOf({ bold: true, color: { argb: t[1] } });
    }
    if (col.key === "remark") cell.font = fontOf({ italic: true, color: { argb: C.mut } });
  }

  /* The pale total row under a table: label (and a muted detail) merged over
     the first columns. Same on the board sheets and the Manpower List. */
  function writeTotalRow(ws, rowNo, nTable, footer) {
    ws.getRow(rowNo).height = 26;
    for (let c = 1; c <= nTable; c++) {
      const cell = ws.getCell(rowNo, c);
      cell.fill = fillOf(C.pale);
      cell.border = { top: { style: "medium", color: { argb: C.navy } } };
    }
    const labelSpan = Math.min(nTable, 4);
    if (labelSpan > 1) ws.mergeCells(rowNo, 1, rowNo, labelSpan);
    const tc = ws.getCell(rowNo, 1);
    const rich = [{ text: footer.main, font: fontOf({ size: 12, bold: true, color: { argb: C.navy } }) }];
    if (footer.detail) rich.push({ text: "   " + footer.detail, font: fontOf({ size: 10.5, color: { argb: C.mut } }) });
    tc.value = { richText: rich };
    tc.alignment = { vertical: "middle", indent: 1 };
  }

  /* One sheet in the TRIGO layout: navy banner (logo, title, board + date, a
     big number), green rule, table, total row. spec: { sheetName, title,
     subtitle, boardName, dateLine, lang, today, bigNumber, bigLabel, cols, rows,
     footer: {main, detail}, logoId, styleCell(col, row, cell, helpers) } */
  function addSheet(wb, spec) {
    const { cols, rows } = spec;
    const ws = wb.addWorksheet(spec.sheetName, {
      views: [{ showGridLines: false }],
      pageSetup: {
        orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.25 },
      },
      headerFooter: { oddFooter: "&L&8" + TEXT[normLang(spec.lang)].title + " — " + String(spec.boardName || "").replace(/&/g, "&&") + "&R&8" + TEXT[normLang(spec.lang)].page },
    });

    const widths = cols.map((c) => c.width);
    const layout = bannerLayout(widths);
    const nTable = cols.length;
    const nCols = Math.max(nTable, layout.bannerCols);
    const allWidths = widths.concat(layout.fillers);
    // anything past the four blocks (spare table columns) is blank navy; widths of fillers come after table columns
    for (let c = 0; c < nCols; c++) ws.getColumn(c + 1).width = allWidths[c] || 14;

    const fill = fillOf, font = fontOf;

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
    block(sBoard, sTotal - 1, spec.boardName || "", spec.dateLine,
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
      cell.value = labelOf(col, spec.lang);
      cell.font = font({ bold: true, color: white });
      cell.fill = fill(C.navy);
      cell.alignment = { vertical: "middle", horizontal: col.center ? "center" : "left", indent: col.center ? 0 : 1 };
      cell.border = { bottom: { style: "medium", color: { argb: C.green } } };
    });

    // ---- body ----
    rows.forEach((r, k) => {
      const row = ws.getRow(HEAD + 1 + k);
      row.height = 20;
      cols.forEach((col, i) => writeBodyCell(row.getCell(i + 1), col, r, k, spec));
    });

    // ---- total row ----
    const lastData = HEAD + rows.length;
    writeTotalRow(ws, lastData + 1, nTable, spec.footer);

    ws.views = [{ showGridLines: false, state: "frozen", ySplit: HEAD }];
    ws.pageSetup.printTitlesRow = HEAD + ":" + HEAD;
    if (rows.length) ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: lastData, column: nTable } };
    return ws;
  }

  /* Builds the workbook. `ExcelJS` is passed in so the browser can lazy-load it.
     opts: { boardName, dateEn, dateTh, columns: [keys], rows: [row],
             groups: { leave: [pRow], standby: [pRow], oncall: [pRow] } (each optional),
             today: "YYYY-MM-DD" (what Years of Service counts up to; the real today),
             logo: ArrayBuffer|Buffer|null }
     A row (sheet 1: people on missions) is { empId, name, trigoId, contract: "Permanent"|"On-call",
     position, phone, startDate: "YYYY-MM-DD"|"", area, mission, host, customer, ppe, shift: "Day"|"Night", start, end, engineer, remark }.
     A pRow (people not on a mission) is { empId, name, trigoId, contract, position, area, phone, startDate }, and for
     the leave group also { leaveKey: one of LEAVE_ORDER, leave: "Annual Leave · ลาพักร้อน", leaveEn }.
     An empty or missing group adds no sheet. The header and the total row show only the
     total number of employees; the Permanent / On-call split appears only when the
     Contract Type column was picked. */
  async function buildWorkbook(ExcelJS, opts) {
    const picked = normalizeColumns(opts.columns);
    if (!picked.length) throw new Error("Pick at least one column to export.");
    const cols = withTrigoId(picked);
    const lang = normLang(opts.lang), T = TEXT[lang];
    const rows = opts.rows || [];
    const sum = summarize(rows);
    const wb = new ExcelJS.Workbook();
    wb.creator = "TRIGO Manpower Board";
    wb.created = new Date();
    const logoId = await loadLogo(ExcelJS, wb, opts.logo);
    // one language per file: the banner carries the date in that language only
    const dateLine = lang === "th" ? (opts.dateTh || opts.dateEn || "") : (opts.dateEn || "");
    const common = { boardName: opts.boardName, dateLine, lang, today: opts.today, logoId, title: T.title };

    const withContract = cols.some((c) => c.key === "contract");
    const used = new Set();
    const mainName = safeSheetName(opts.boardName);
    used.add(mainName.toLowerCase());
    addSheet(wb, Object.assign({}, common, {
      sheetName: mainName, subtitle: T.subtitle,
      bigNumber: sum.total, bigLabel: T.totalEmployees, cols, rows,
      footer: {
        main: T.totalEmployees + ": " + sum.total,
        detail: withContract ? "(" + T.permanent + " " + sum.permanent + " · " + T.oncall + " " + sum.oncall + ")" : "",
      },
    }));

    const groupSummary = {};
    for (const g of GROUP_KEYS) {
      const grows = (opts.groups && opts.groups[g]) || [];
      if (!grows.length) { groupSummary[g] = null; continue; }
      const gt = groupText(g, lang);
      let name = safeSheetName(gt.sheetName);
      if (used.has(name.toLowerCase())) name += " (2)";   // a board literally named "Standby" must not collide
      used.add(name.toLowerCase());
      let footer;
      if (g === "leave") {
        const ls = summarizeLeave(grows, lang);
        groupSummary[g] = ls;
        footer = { main: T.total + ": " + ls.total, detail: "(" + ls.types.map((t) => t.label + " " + t.n).join(" · ") + ")" };
      } else {
        const n = countPeople(grows);
        groupSummary[g] = { total: n };
        footer = { main: T.total + ": " + n, detail: "" };
      }
      addSheet(wb, Object.assign({}, common, {
        sheetName: name, subtitle: gt.subtitle, bigNumber: groupSummary[g].total, bigLabel: gt.bigLabel,
        cols: groupColumns(g, opts.columns), rows: grows, footer,
      }));
    }
    return { workbook: wb, summary: Object.assign({}, sum, { groups: groupSummary }) };
  }

  /* ---------- the Manpower List: one plain sheet ----------
     No banner or logo: row 1 is the header, in the same table design as the
     board export (navy header with the green rule, tinted alternate rows, pale
     total row under the table), frozen, filterable and repeated on every
     printed page. One row per person in the order given. A row is { name, contract: "Permanent"|"On-call",
     position (English label or ""), phone, trigoId, startDate: "YYYY-MM-DD"|"", area,
     board, util: percent|null|undefined, active: boolean }. */
  const LIST_COLUMNS = [
    // the list carries both names whatever the file language: the language only changes the headers
    // and the words (the English column stays empty for someone with no English name yet)
    { key: "name",      label: "Thai Name",       th: "ชื่อ (ไทย)",         width: 30, exact: true },
    { key: "nameEn",    label: "English Name",    th: "ชื่อ (อังกฤษ)",      width: 30 },
    { key: "trigoId",   label: "TRIGO ID",        th: "รหัส TRIGO",         width: 11, center: true },
    { key: "contract",  label: "Contract Type",   th: "ประเภทสัญญา",       width: 17 },
    { key: "position",  label: "Position",        th: "ตำแหน่ง",           width: 25 },
    { key: "phone",     label: "Mobile Number",   th: "เบอร์มือถือ",        width: 16 },
    { key: "startDate", label: "Start Date",      th: "วันที่เริ่มงาน",     width: 14, center: true },
    { key: "service",   label: "Years of Service", th: "อายุงาน",          width: 26 },
    { key: "area",      label: "Service Area",    th: "พื้นที่บริการ",      width: 16 },
    { key: "board",     label: "Current Board",   th: "บอร์ดปัจจุบัน",      width: 20 },
    { key: "util",      label: "30D Utilization", th: "การใช้งาน 30 วัน",   width: 17, center: true },
    { key: "status",    label: "Status",          th: "สถานะ",             width: 12, center: true },
  ];
  async function buildListWorkbook(ExcelJS, opts) {
    const lang = normLang(opts.lang), T = TEXT[lang];
    const rows = opts.rows || [];
    const wb = new ExcelJS.Workbook();
    wb.creator = "TRIGO Manpower Board";
    wb.created = new Date();
    const ws = wb.addWorksheet(safeSheetName(T.listSheet), {
      views: [{ showGridLines: false, state: "frozen", ySplit: 1 }],
      pageSetup: {
        orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.25 },
        printTitlesRow: "1:1",
      },
      headerFooter: { oddFooter: "&L&8" + T.listSheet + "&R&8" + T.page },
    });
    LIST_COLUMNS.forEach((col, i) => {
      ws.getColumn(i + 1).width = col.width;
      const cell = ws.getCell(1, i + 1);
      cell.value = labelOf(col, lang);
      cell.font = fontOf({ bold: true, color: { argb: "FFFFFFFF" } });
      cell.fill = fillOf(C.navy);
      cell.alignment = { vertical: "middle", horizontal: col.center ? "center" : "left", indent: col.center ? 0 : 1 };
      cell.border = { bottom: { style: "medium", color: { argb: C.green } } };
    });
    ws.getRow(1).height = 24;
    rows.forEach((r, k) => {
      const row = ws.getRow(2 + k);
      row.height = 20;
      LIST_COLUMNS.forEach((col, i) => writeBodyCell(row.getCell(i + 1), col, r, k, { lang, today: opts.today }));
    });
    const perm = rows.filter((r) => r.contract !== "On-call").length, oc = rows.length - perm;
    writeTotalRow(ws, 2 + rows.length, LIST_COLUMNS.length, {
      main: T.totalEmployees + ": " + rows.length,
      detail: "(" + T.permanent + " " + perm + " · " + T.oncall + " " + oc + ")",
    });
    if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + rows.length, column: LIST_COLUMNS.length } };
    return { workbook: wb, summary: { total: rows.length, permanent: perm, oncall: oc } };
  }

  /* Any plain table (Host List, Users) in the Manpower List sheet's design: no
     banner, header on row 1 (navy, green rule), frozen and filterable, tinted
     alternate rows, a pale total row. spec: { sheetName, columns: [{label, width,
     center?}], rows: [[cell, ...]], totalText }. Cells are written as values,
     never as formulas, so text that starts with "=" stays text. */
  async function buildTableWorkbook(ExcelJS, spec) {
    const cols = spec.columns, rows = spec.rows || [];
    const wb = new ExcelJS.Workbook();
    wb.creator = "TRIGO Manpower Board";
    wb.created = new Date();
    const ws = wb.addWorksheet(safeSheetName(spec.sheetName), {
      views: [{ showGridLines: false, state: "frozen", ySplit: 1 }],
      pageSetup: {
        orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.25 },
        printTitlesRow: "1:1",
      },
    });
    cols.forEach((col, i) => {
      ws.getColumn(i + 1).width = col.width || 16;
      const cell = ws.getCell(1, i + 1);
      cell.value = col.label;
      cell.font = fontOf({ bold: true, color: { argb: "FFFFFFFF" } });
      cell.fill = fillOf(C.navy);
      cell.alignment = { vertical: "middle", horizontal: col.center ? "center" : "left", indent: col.center ? 0 : 1 };
      cell.border = { bottom: { style: "medium", color: { argb: C.green } } };
    });
    ws.getRow(1).height = 24;
    rows.forEach((r, k) => {
      const row = ws.getRow(2 + k);
      row.height = 20;
      cols.forEach((col, i) => {
        const cell = row.getCell(i + 1);
        const v = r[i];
        cell.value = v === undefined || v === null ? "" : v;
        cell.font = fontOf({ bold: i === 0 });
        cell.alignment = { vertical: "middle", horizontal: col.center ? "center" : "left", indent: col.center ? 0 : 1 };
        cell.border = { bottom: { style: "thin", color: { argb: C.line } } };
        if (k % 2 === 1) cell.fill = fillOf(C.paper);
      });
    });
    writeTotalRow(ws, 2 + rows.length, cols.length, { main: spec.totalText || "TOTAL: " + rows.length });
    if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + rows.length, column: cols.length } };
    return { workbook: wb, summary: { total: rows.length } };
  }

  /* The Capacity tab as a WORKING workbook: one sheet per board that keeps
     planning in Excel. Yellow cells are inputs (host demand, Available people,
     host / shift names in the spare rows); Demand, Gap and Total are real
     formulas over them, the Gap colours are conditional formatting, and each
     sheet carries a native Excel chart (Available and Demand as columns, Gap
     as a line) reading the same cells — change a number and all of it follows.
     ExcelJS cannot write charts, so the chart is added afterwards by
     addCapacityCharts (JSZip). Layout per sheet:
       1 banner · 2 range · 3 dates · 4 CONFIRMED / FORECAST
       5 Available · 6 Demand · 7 Gap · 8 Named on board · 9 section title
       10.. one row per host x shift, then CAP_SPARE_ROWS blank rows
       a note, then the chart.
     spec: { boards: [Capacity.exportBoard(...)], rangeText, generatedOn, note }
     -> { workbook, charts: [chart spec per sheet, for addCapacityCharts] } */
  const CAP_SPARE_ROWS = 5;
  const CAP_INPUT = "FFFFFBE6";   // pale yellow: "type here"
  function colLetter(n) {
    let s = "";
    for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }
  async function buildCapacityWorkbook(ExcelJS, spec) {
    const wb = new ExcelJS.Workbook();
    wb.creator = "TRIGO Manpower Board";
    wb.created = new Date();
    wb.calcProperties = { fullCalcOnLoad: true };
    const used = new Set();
    const charts = [];
    const KIND = {
      short: { bg: "FFFBE4E4", fg: "FFB42318" },
      tight: { bg: C.dayBg, fg: C.dayFg },
      ok: { bg: C.okBg, fg: C.okFg },
    };
    const R_AV = 5, R_DEM = 6, R_GAP = 7, R_NAMED = 8, R_SEC = 9, R_HOST = 10;
    for (const b of spec.boards) {
      let name = safeSheetName(b.name), n = 2;
      while (used.has(name.toLowerCase())) name = safeSheetName(b.name).slice(0, 28) + " " + n++;
      used.add(name.toLowerCase());
      const fixed = 1 + b.extras.length + 1;                  // Host, host columns, Shift
      const nd = b.dates.length;
      const c0 = fixed + 1, c1 = fixed + nd;                  // the day columns
      const cTot = c1 + 1;                                    // Total
      const last = cTot;
      const L = colLetter;
      const hostLast = R_HOST + b.rows.length + CAP_SPARE_ROWS - 1;
      const ws = wb.addWorksheet(name, {
        views: [{ showGridLines: false, state: "frozen", xSplit: fixed, ySplit: 4 }],
        pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
          margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.25 } },
      });
      const WIDTH = { area: 16, location: 30, note: 30, mapUrl: 36 };
      ws.getColumn(1).width = 30;
      b.extras.forEach((c, i) => { ws.getColumn(2 + i).width = WIDTH[c.key] || 20; });
      ws.getColumn(fixed).width = 9;
      for (let c = c0; c <= c1; c++) ws.getColumn(c).width = 11;
      ws.getColumn(cTot).width = 10;

      const span = (row, text, style) => {
        ws.mergeCells(row, 1, row, last);
        const cell = ws.getCell(row, 1);
        cell.value = text;
        Object.assign(cell, style);
        for (let c = 1; c <= last; c++) if (style.fill) ws.getCell(row, c).fill = style.fill;
      };
      ws.getRow(1).height = 30;
      span(1, "TRIGO  ·  Capacity  —  " + b.name, {
        font: fontOf({ size: 15, bold: true, color: { argb: "FFFFFFFF" } }), fill: fillOf(C.navy),
        alignment: { vertical: "middle", indent: 1 },
      });
      ws.getRow(2).height = 20;
      span(2, [spec.rangeText, spec.generatedOn ? "exported " + spec.generatedOn : "", "yellow cells are inputs — Demand, Gap, Total and the chart recalculate"].filter(Boolean).join("  ·  "), {
        font: fontOf({ size: 10.5, color: { argb: C.mut } }), fill: fillOf(C.pale),
        alignment: { vertical: "middle", indent: 1 },
      });
      // header: labels on row 3, CONFIRMED / FORECAST on row 4
      const navyHead = (cell, text, center) => {
        cell.value = text;
        cell.font = fontOf({ bold: true, color: { argb: "FFFFFFFF" } });
        cell.fill = fillOf(C.navy);
        cell.alignment = { vertical: "middle", horizontal: center ? "center" : "left", indent: center ? 0 : 1 };
      };
      const heads = ["Host", ...b.extras.map((c) => c.label), "Shift"];
      heads.forEach((t, i) => {
        ws.mergeCells(3, i + 1, 4, i + 1);
        navyHead(ws.getCell(3, i + 1), t, i === heads.length - 1);
      });
      b.dates.forEach((d, i) => {
        navyHead(ws.getCell(3, c0 + i), d.label, true);
        const c2 = ws.getCell(4, c0 + i);
        c2.value = d.forecast ? "FORECAST" : "CONFIRMED";
        c2.font = fontOf({ size: 8, bold: true, color: { argb: d.forecast ? C.green : C.onNavy } });
        c2.fill = fillOf(C.navy);
        c2.alignment = { vertical: "middle", horizontal: "center" };
      });
      ws.mergeCells(3, cTot, 4, cTot);
      navyHead(ws.getCell(3, cTot), "Total", true);
      for (let c = 1; c <= last; c++) ws.getCell(4, c).border = { bottom: { style: "medium", color: { argb: C.green } } };
      ws.getRow(3).height = 22;
      ws.getRow(4).height = 16;

      const wholeNumber = { type: "whole", operator: "greaterThanOrEqual", formulae: [0], allowBlank: true,
        showErrorMessage: true, errorTitle: "Whole number", error: "Type a whole number of people (0 or more), or leave it empty." };
      const label = (r, text) => {
        ws.getRow(r).height = 20;
        ws.mergeCells(r, 1, r, fixed);
        const lc = ws.getCell(r, 1);
        lc.value = text;
        lc.font = fontOf({ bold: true, color: { argb: C.navy } });
        lc.alignment = { vertical: "middle", indent: 1 };
        for (let c = 1; c <= fixed; c++) ws.getCell(r, c).fill = fillOf(C.pale);
      };
      const sumCell = (cell, value, o = {}) => {
        cell.value = value;
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = { bottom: { style: "thin", color: { argb: C.line } } };
        cell.font = fontOf({ bold: true });
        cell.fill = fillOf(o.input ? CAP_INPUT : C.pale);
        if (o.numFmt) cell.numFmt = o.numFmt;
        if (o.input) cell.dataValidation = wholeNumber;
      };
      // demand per day, for the formula results the file opens with
      const demandOf = (i) => b.rows.reduce((t, r) => t + (Number(r.values[i]) || 0), 0);
      const hostRange = (c) => `${L(c)}${R_HOST}:${L(c)}${hostLast}`;

      label(R_AV, "Available people  (editable)");
      label(R_DEM, "Demand (all hosts)");
      label(R_GAP, "Gap  (available − demand)");
      label(R_NAMED, "Named on board");
      b.dates.forEach((d, i) => {
        const c = c0 + i, col = L(c);
        const av = b.summary.available[i];
        sumCell(ws.getCell(R_AV, c), av == null ? null : av, { input: true });
        const dem = demandOf(i);
        sumCell(ws.getCell(R_DEM, c), { formula: `SUM(${hostRange(c)})`, result: dem });
        sumCell(ws.getCell(R_GAP, c), { formula: `IF(${col}${R_AV}="","",${col}${R_AV}-${col}${R_DEM})`, result: av == null ? "" : av - dem }, { numFmt: "+0;-0;0" });
        const named = b.summary.named[i];
        sumCell(ws.getCell(R_NAMED, c), named == null ? null : named);
      });
      // Total column: demand over the whole range; blank for the per-day rows
      for (const r of [R_AV, R_GAP, R_NAMED]) sumCell(ws.getCell(r, cTot), null);
      const allDem = b.dates.reduce((t, d, i) => t + demandOf(i), 0);
      sumCell(ws.getCell(R_DEM, cTot), { formula: `SUM(${L(c0)}${R_DEM}:${L(c1)}${R_DEM})`, result: allDem });
      // the gap colours follow the numbers: red short, amber 0-1 spare, green more
      const gapRef = `${L(c0)}${R_GAP}:${L(c1)}${R_GAP}`;
      const cf = (k) => ({ fill: { type: "pattern", pattern: "solid", bgColor: { argb: KIND[k].bg } }, font: { bold: true, color: { argb: KIND[k].fg } } });
      ws.addConditionalFormatting({ ref: gapRef, rules: [
        { type: "cellIs", operator: "lessThan", formulae: ["0"], style: cf("short"), priority: 1 },
        { type: "cellIs", operator: "between", formulae: ["0", "1"], style: cf("tight"), priority: 2 },
        { type: "cellIs", operator: "greaterThan", formulae: ["1"], style: cf("ok"), priority: 3 },
      ] });

      ws.getRow(R_SEC).height = 22;
      ws.mergeCells(R_SEC, 1, R_SEC, last);
      const sh = ws.getCell(R_SEC, 1);
      sh.value = "Demand by host · shift  —  type in the yellow cells; the spare rows at the bottom are for new hosts";
      sh.font = fontOf({ bold: true, color: { argb: "FFFFFFFF" } });
      for (let c = 1; c <= last; c++) ws.getCell(R_SEC, c).fill = fillOf(C.divider);
      sh.alignment = { vertical: "middle", indent: 1 };

      const shiftRule = { type: "list", allowBlank: true, formulae: ['"DAY,NIGHT"'],
        showErrorMessage: true, errorTitle: "Shift", error: "Pick DAY or NIGHT." };
      const rows = [...b.rows, ...Array.from({ length: CAP_SPARE_ROWS }, () => null)];
      rows.forEach((row, k) => {
        const r = R_HOST + k;
        ws.getRow(r).height = 20;
        const tint = k % 2 === 1 ? fillOf(C.paper) : null;
        const put = (c, v, o = {}) => {
          const cell = ws.getCell(r, c);
          cell.value = v;
          cell.font = fontOf(o.font || {});
          cell.alignment = Object.assign({ vertical: "middle" }, o.align);
          cell.border = { bottom: { style: "thin", color: { argb: C.line } } };
          if (o.fill || tint) cell.fill = o.fill || tint;
          if (o.validation) cell.dataValidation = o.validation;
        };
        const spare = !row;
        put(1, spare ? null : row.host, { font: { bold: true }, align: { indent: 1 }, fill: spare ? fillOf(CAP_INPUT) : null });
        b.extras.forEach((c, i) => {
          const v = spare ? "" : row.extra[c.key] || "";
          if (c.key === "mapUrl" && /^https?:\/\//i.test(v)) {
            put(2 + i, { text: v, hyperlink: v }, { font: { color: { argb: "FF0563C1" }, underline: true }, align: { indent: 1 } });
          } else put(2 + i, v || null, { align: { indent: 1 } });
        });
        const night = !spare && row.shift === "night";
        put(fixed, spare ? null : night ? "NIGHT" : "DAY", {
          font: { bold: true, size: 9, color: { argb: night ? C.nightFg : C.dayFg } },
          fill: spare ? fillOf(CAP_INPUT) : fillOf(night ? C.nightBg : C.dayBg), align: { horizontal: "center" }, validation: shiftRule,
        });
        b.dates.forEach((d, i) => {
          const v = spare ? null : row.values[i];
          put(c0 + i, v == null ? null : v, { align: { horizontal: "center" }, fill: fillOf(CAP_INPUT), validation: wholeNumber });
        });
        const rng = `${L(c0)}${r}:${L(c1)}${r}`;
        const tot = spare ? 0 : row.values.reduce((t, v) => t + (Number(v) || 0), 0);
        const has = !spare && row.values.some((v) => v != null);
        put(cTot, { formula: `IF(COUNT(${rng})=0,"",SUM(${rng}))`, result: has ? tot : "" }, { font: { bold: true }, align: { horizontal: "center" } });
      });
      let r = hostLast + 2;
      if (spec.note) {
        ws.mergeCells(r, 1, r, last);
        const nc = ws.getCell(r, 1);
        nc.value = spec.note;
        nc.font = fontOf({ size: 9, italic: true, color: { argb: C.mut } });
        nc.alignment = { wrapText: true, vertical: "top", indent: 1 };
        ws.getRow(r).height = 28;
        r += 2;
      }
      // the chart goes under the table, over the day columns (at least ~12 wide)
      const q = "'" + name.replace(/'/g, "''") + "'!";
      const abs = (c, row) => `$${L(c)}$${row}`;
      const gapVals = b.dates.map((d, i) => (b.summary.available[i] == null ? null : b.summary.available[i] - demandOf(i)));
      charts.push({
        sheetName: name,
        title: `Demand against available people — ${b.name}`,
        categories: { ref: `${q}${abs(c0, 3)}:${abs(c1, 3)}`, values: b.dates.map((d) => d.label) },
        series: [
          { name: "Available", ref: `${q}${abs(c0, R_AV)}:${abs(c1, R_AV)}`, values: b.summary.available, color: "C3CCD6", type: "bar" },
          { name: "Demand", ref: `${q}${abs(c0, R_DEM)}:${abs(c1, R_DEM)}`, values: b.dates.map((d, i) => demandOf(i)), color: "004983", type: "bar" },
          { name: "Gap", ref: `${q}${abs(c0, R_GAP)}:${abs(c1, R_GAP)}`, values: gapVals, color: "E0701F", type: "line" },
        ],
        anchor: { fromCol: 0, fromRow: r - 1, toCol: Math.max(last, fixed + 12), toRow: r - 1 + 20 },
      });
    }
    return { workbook: wb, charts };
  }

  /* ----- native Excel charts, added to an ExcelJS workbook after the fact -----
     ExcelJS writes no charts, so this opens the finished .xlsx (a zip) with
     JSZip and adds, per chart: the chart part, a drawing that anchors it to
     cells, the relationships tying sheet -> drawing -> chart, and their content
     types. Pure string work on the package; nothing else in it is touched.
     charts: [{ sheetName, title, categories: {ref, values}, series: [{name,
     ref, values, color, type: "bar"|"line"}], anchor: {fromCol, fromRow,
     toCol, toRow} }] (0-based cells). Returns the new file as a Uint8Array. */
  const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function chartXml(ch) {
    const strCache = (vals) => `<c:strCache><c:ptCount val="${vals.length}"/>` +
      vals.map((v, i) => `<c:pt idx="${i}"><c:v>${xmlEsc(v)}</c:v></c:pt>`).join("") + `</c:strCache>`;
    const numCache = (vals) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>` +
      vals.map((v, i) => (v == null || v === "" ? "" : `<c:pt idx="${i}"><c:v>${Number(v)}</c:v></c:pt>`)).join("") + `</c:numCache>`;
    const fill = (rgb) => `<a:solidFill><a:srgbClr val="${rgb}"/></a:solidFill>`;
    const ser = (s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>` +
      `<c:tx><c:v>${xmlEsc(s.name)}</c:v></c:tx>` +
      (s.type === "line"
        ? `<c:spPr><a:ln w="28575" cap="rnd">${fill(s.color)}<a:round/></a:ln></c:spPr>` +
          `<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr>${fill(s.color)}<a:ln>${fill(s.color)}</a:ln></c:spPr></c:marker>`
        : `<c:spPr>${fill(s.color)}</c:spPr><c:invertIfNegative val="0"/>`) +
      `<c:cat><c:strRef><c:f>${xmlEsc(ch.categories.ref)}</c:f>${strCache(ch.categories.values)}</c:strRef></c:cat>` +
      `<c:val><c:numRef><c:f>${xmlEsc(s.ref)}</c:f>${numCache(s.values)}</c:numRef></c:val>` +
      (s.type === "line" ? `<c:smooth val="0"/>` : "") + `</c:ser>`;
    const bars = ch.series.map((s, i) => [s, i]).filter(([s]) => s.type !== "line");
    const lines = ch.series.map((s, i) => [s, i]).filter(([s]) => s.type === "line");
    const AX = `<c:axId val="50010"/><c:axId val="50020"/>`;
    const text = (sz, b) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}"${b ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="13222F"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<c:roundedCorners val="0"/><c:chart>` +
      `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="1"><a:solidFill><a:srgbClr val="004983"/></a:solidFill></a:rPr><a:t>${xmlEsc(ch.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
      `<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>` +
      (bars.length ? `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>` +
        bars.map(([s, i]) => ser(s, i)).join("") + `<c:gapWidth val="60"/><c:overlap val="-10"/>${AX}</c:barChart>` : "") +
      (lines.length ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>` +
        lines.map(([s, i]) => ser(s, i)).join("") + `<c:marker val="1"/>${AX}</c:lineChart>` : "") +
      `<c:catAx><c:axId val="50010"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>` +
      `<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>` +
      `<c:spPr><a:ln w="9525">${fill("8A9AA8")}</a:ln></c:spPr>${text(900)}` +
      `<c:crossAx val="50020"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
      `<c:valAx><c:axId val="50020"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>` +
      `<c:majorGridlines><c:spPr><a:ln w="6350">${fill("D8E0E7")}</a:ln></c:spPr></c:majorGridlines>` +
      `<c:title><c:tx><c:rich><a:bodyPr rot="-5400000" vert="horz"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:r><a:rPr lang="en-US" sz="900"/><a:t>People</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
      `<c:numFmt formatCode="0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
      `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${text(900)}` +
      `<c:crossAx val="50010"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>` +
      `</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/>${text(1000)}</c:legend>` +
      `<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
      `<c:spPr>${fill("FFFFFF")}<a:ln w="9525">${fill("D8E0E7")}</a:ln></c:spPr></c:chartSpace>`;
  }
  function drawingXml(ch) {
    const a = ch.anchor;
    const pt = (tag, col, row) => `<xdr:${tag}><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${tag}>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
      `<xdr:twoCellAnchor editAs="oneCell">${pt("from", a.fromCol, a.fromRow)}${pt("to", a.toCol, a.toRow)}` +
      `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Capacity chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
      `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
      `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>` +
      `</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
  }
  const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
  async function addCapacityCharts(JSZip, data, charts) {
    const zip = await JSZip.loadAsync(data);
    const read = async (p) => { const f = zip.file(p); return f ? f.async("string") : null; };
    // sheet name -> its part, from the workbook and its relationships
    const wbXml = await read("xl/workbook.xml");
    const wbRels = await read("xl/_rels/workbook.xml.rels");
    const target = {};
    for (const m of wbRels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]+)"/.exec(m[0]), t = /\bTarget="([^"]+)"/.exec(m[0]);
      if (id && t) target[id[1]] = t[1].replace(/^\/?xl\//, "");
    }
    const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const sheetPart = {};
    for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
      const nm = /\bname="([^"]*)"/.exec(m[0]), rid = /\br:id="([^"]+)"/.exec(m[0]);
      if (nm && rid && target[rid[1]]) sheetPart[unesc(nm[1])] = "xl/" + target[rid[1]];
    }
    let types = await read("[Content_Types].xml");
    let k = 0;
    for (const ch of charts) {
      const sheet = sheetPart[ch.sheetName];
      if (!sheet) throw new Error("no sheet named " + ch.sheetName);
      k++;
      const chartPart = `xl/charts/capchart${k}.xml`, drawPart = `xl/drawings/capdrawing${k}.xml`;
      zip.file(chartPart, chartXml(ch));
      zip.file(drawPart, drawingXml(ch));
      zip.file(`xl/drawings/_rels/capdrawing${k}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${REL}chart" Target="../charts/capchart${k}.xml"/></Relationships>`);
      // sheet -> drawing relationship (the sheet may already have rels, e.g. hyperlinks)
      const dir = sheet.slice(0, sheet.lastIndexOf("/") + 1), file = sheet.slice(sheet.lastIndexOf("/") + 1);
      const relsPath = `${dir}_rels/${file}.rels`;
      let rels = (await read(relsPath)) || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}"></Relationships>`;
      let n = 1;
      while (new RegExp(`\\bId="rIdCap${n}"`).test(rels)) n++;
      const rid = `rIdCap${n}`;
      rels = rels.replace("</Relationships>", `<Relationship Id="${rid}" Type="${REL}drawing" Target="../drawings/capdrawing${k}.xml"/></Relationships>`);
      zip.file(relsPath, rels);
      // <drawing> has a fixed place in a worksheet: before these, after everything else
      let xml = await read(sheet);
      if (!/xmlns:r="/.test(xml.slice(0, xml.indexOf(">", xml.indexOf("<worksheet")))))
        xml = xml.replace("<worksheet", `<worksheet xmlns:r="${REL.replace(/\/$/, "")}"`);
      const at = ["<legacyDrawing", "<legacyDrawingHF", "<drawingHF", "<picture", "<oleObjects", "<controls", "<webPublishItems", "<tableParts", "<extLst", "</worksheet>"]
        .map((t) => xml.indexOf(t)).filter((i) => i >= 0).reduce((a, b) => Math.min(a, b));
      xml = xml.slice(0, at) + `<drawing r:id="${rid}"/>` + xml.slice(at);
      zip.file(sheet, xml);
      types = types.replace("</Types>",
        `<Override PartName="/${chartPart}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>` +
        `<Override PartName="/${drawPart}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    }
    zip.file("[Content_Types].xml", types);
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }

  const api = { buildCapacityWorkbook, addCapacityCharts, colLetter, personName, COLUMNS, ALL_KEYS, LEAVE_ORDER, GROUPS, GROUP_KEYS, normalizeColumns, summarize, summarizeLeave, groupColumns, safeSheetName, bannerLayout, serviceParts, serviceLength, buildWorkbook, LIST_COLUMNS, buildListWorkbook, buildTableWorkbook };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ManpowerXlsx = api;
})(globalThis);
