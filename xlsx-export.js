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

  /* The Capacity tab as a workbook: one sheet per board. Each is the grid as
     the screen shows it — a navy banner, the days across (CONFIRMED or
     FORECAST under each date), the Available / Demand / Gap / Named rows, then
     one row per host x shift with the host columns the user ticked. Numbers
     are real numbers. spec: { boards: [Capacity.exportBoard(...)], rangeText,
     generatedOn, note } */
  async function buildCapacityWorkbook(ExcelJS, spec) {
    const wb = new ExcelJS.Workbook();
    wb.creator = "TRIGO Manpower Board";
    wb.created = new Date();
    const used = new Set();
    const KIND = {
      short: { bg: "FFFBE4E4", fg: "FFB42318" },
      tight: { bg: C.dayBg, fg: C.dayFg },
      ok: { bg: C.okBg, fg: C.okFg },
    };
    for (const b of spec.boards) {
      let name = safeSheetName(b.name), n = 2;
      while (used.has(name.toLowerCase())) name = safeSheetName(b.name).slice(0, 28) + " " + n++;
      used.add(name.toLowerCase());
      const fixed = 1 + b.extras.length + 1;                  // Host, host columns, Shift
      const last = fixed + b.dates.length;
      const ws = wb.addWorksheet(name, {
        views: [{ showGridLines: false, state: "frozen", xSplit: fixed, ySplit: 4 }],
        pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
          margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.25 } },
      });
      const WIDTH = { area: 16, location: 30, note: 30, mapUrl: 36 };
      ws.getColumn(1).width = 30;
      b.extras.forEach((c, i) => { ws.getColumn(2 + i).width = WIDTH[c.key] || 20; });
      ws.getColumn(fixed).width = 9;
      for (let c = fixed + 1; c <= last; c++) ws.getColumn(c).width = 9.5;

      const span = (row, text, style) => {
        if (last > 1) ws.mergeCells(row, 1, row, last);
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
      span(2, [spec.rangeText, spec.generatedOn ? "exported " + spec.generatedOn : ""].filter(Boolean).join("  ·  "), {
        font: fontOf({ size: 10.5, color: { argb: C.mut } }), fill: fillOf(C.pale),
        alignment: { vertical: "middle", indent: 1 },
      });
      // header: labels on row 3, CONFIRMED / FORECAST on row 4
      const heads = ["Host", ...b.extras.map((c) => c.label), "Shift"];
      heads.forEach((t, i) => {
        ws.mergeCells(3, i + 1, 4, i + 1);
        const cell = ws.getCell(3, i + 1);
        cell.value = t;
        cell.font = fontOf({ bold: true, color: { argb: "FFFFFFFF" } });
        cell.fill = fillOf(C.navy);
        cell.alignment = { vertical: "middle", horizontal: i === heads.length - 1 ? "center" : "left", indent: i === heads.length - 1 ? 0 : 1 };
        ws.getCell(4, i + 1).fill = fillOf(C.navy);
      });
      b.dates.forEach((d, i) => {
        const c1 = ws.getCell(3, fixed + 1 + i), c2 = ws.getCell(4, fixed + 1 + i);
        c1.value = d.label;
        c1.font = fontOf({ bold: true, color: { argb: "FFFFFFFF" } });
        c1.fill = fillOf(C.navy);
        c1.alignment = { vertical: "middle", horizontal: "center" };
        c2.value = d.forecast ? "FORECAST" : "CONFIRMED";
        c2.font = fontOf({ size: 8, bold: true, color: { argb: d.forecast ? C.green : C.onNavy } });
        c2.fill = fillOf(C.navy);
        c2.alignment = { vertical: "middle", horizontal: "center" };
        c2.border = { bottom: { style: "medium", color: { argb: C.green } } };
      });
      for (let c = 1; c <= fixed; c++) ws.getCell(4, c).border = { bottom: { style: "medium", color: { argb: C.green } } };
      ws.getRow(3).height = 22;
      ws.getRow(4).height = 16;

      let r = 5;
      const sumRow = (label, vals, kinds) => {
        ws.getRow(r).height = 20;
        ws.mergeCells(r, 1, r, fixed);
        const lc = ws.getCell(r, 1);
        lc.value = label;
        lc.font = fontOf({ bold: true, color: { argb: C.navy } });
        lc.alignment = { vertical: "middle", indent: 1 };
        for (let c = 1; c <= fixed; c++) ws.getCell(r, c).fill = fillOf(C.pale);
        vals.forEach((v, i) => {
          const cell = ws.getCell(r, fixed + 1 + i);
          cell.value = v == null ? "" : v;
          cell.alignment = { vertical: "middle", horizontal: "center" };
          cell.border = { bottom: { style: "thin", color: { argb: C.line } } };
          const k = kinds && kinds[i] && KIND[kinds[i]];
          cell.font = fontOf({ bold: true, color: { argb: k ? k.fg : C.ink } });
          cell.fill = fillOf(k ? k.bg : C.pale);
          if (kinds && typeof v === "number") cell.numFmt = "+0;-0;0";
        });
        r++;
      };
      sumRow("Available people", b.summary.available);
      sumRow("Demand (all hosts)", b.summary.demand);
      sumRow("Gap  (available − demand)", b.summary.gap, b.summary.kind);
      sumRow("Named on board", b.summary.named);

      ws.getRow(r).height = 22;
      ws.mergeCells(r, 1, r, last);
      const sh = ws.getCell(r, 1);
      sh.value = "Demand by host · shift";
      sh.font = fontOf({ bold: true, color: { argb: "FFFFFFFF" } });
      for (let c = 1; c <= last; c++) ws.getCell(r, c).fill = fillOf(C.divider);
      sh.alignment = { vertical: "middle", indent: 1 };
      r++;

      if (!b.rows.length) {
        ws.mergeCells(r, 1, r, last);
        ws.getCell(r, 1).value = "No demand entered.";
        ws.getCell(r, 1).font = fontOf({ italic: true, color: { argb: C.mut } });
        ws.getCell(r, 1).alignment = { indent: 1 };
        r++;
      }
      b.rows.forEach((row, k) => {
        ws.getRow(r).height = 20;
        const tint = k % 2 === 1 ? fillOf(C.paper) : null;
        const put = (c, v, o) => {
          const cell = ws.getCell(r, c);
          cell.value = v;
          cell.font = fontOf(o.font || {});
          cell.alignment = Object.assign({ vertical: "middle" }, o.align);
          cell.border = { bottom: { style: "thin", color: { argb: C.line } } };
          if (o.fill || tint) cell.fill = o.fill || tint;
        };
        put(1, row.host, { font: { bold: true }, align: { indent: 1 } });
        b.extras.forEach((c, i) => {
          const v = row.extra[c.key] || "";
          if (c.key === "mapUrl" && /^https?:\/\//i.test(v)) {
            put(2 + i, { text: v, hyperlink: v }, { font: { color: { argb: "FF0563C1" }, underline: true }, align: { indent: 1 } });
          } else put(2 + i, v, { align: { indent: 1 } });
        });
        const night = row.shift === "night";
        put(fixed, night ? "NIGHT" : "DAY", {
          font: { bold: true, size: 9, color: { argb: night ? C.nightFg : C.dayFg } },
          fill: fillOf(night ? C.nightBg : C.dayBg), align: { horizontal: "center" },
        });
        row.values.forEach((v, i) => put(fixed + 1 + i, v == null ? "" : v, { align: { horizontal: "center" } }));
        r++;
      });
      if (spec.note) {
        r++;
        ws.mergeCells(r, 1, r, last);
        const nc = ws.getCell(r, 1);
        nc.value = spec.note;
        nc.font = fontOf({ size: 9, italic: true, color: { argb: C.mut } });
        nc.alignment = { wrapText: true, vertical: "top", indent: 1 };
        ws.getRow(r).height = 28;
      }
    }
    return { workbook: wb };
  }

  const api = { buildCapacityWorkbook, personName, COLUMNS, ALL_KEYS, LEAVE_ORDER, GROUPS, GROUP_KEYS, normalizeColumns, summarize, summarizeLeave, groupColumns, safeSheetName, bannerLayout, serviceParts, serviceLength, buildWorkbook, LIST_COLUMNS, buildListWorkbook, buildTableWorkbook };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ManpowerXlsx = api;
})(globalThis);
