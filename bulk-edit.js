/* Bulk edit by file: export a list, change many rows in a spreadsheet, upload it
   back and review exactly what would change before anything is written.

   This file is pure logic (no DOM, no network) so it can be tested in node:
     - building the edit template (Excel) from the rows the app holds;
     - reading a file back (an Excel worksheet) into a table;
     - planning: matching every row to an existing record, validating every
       cell, and producing the per-field "from -> to" diff the preview shows.
   Nothing here writes. app.js shows the plan and cloud.js applies it.

   Rules the design rests on (README, "Bulk edit by file"):
     * Rows are matched on a hidden-in-plain-sight ID column first, then on the
       name, so a rename is possible and a typo never silently becomes a new
       person. Hosts have no id: the name IS the host.
     * Only columns that are in the file are touched. A column that is there
       with a blank cell CLEARS an optional field (position, mobile number,
       start date); a column that is missing leaves it alone. A blank
       "On the board from" also leaves it alone - clearing it would make a
       person count on every past day.
     * Rows missing from the file are never deleted or deactivated.
     * Any row with a problem is reported and skipped; the rest can still be
       applied, and re-uploading the corrected file only changes what still
       differs (it is idempotent). */
(function (root) {
  "use strict";

  const EmployeeId = (typeof module !== "undefined" && module.exports) ? require("./employee-id.js") : root.EmployeeId;

  /* ---------- small helpers ---------- */
  const norm = (s) => String(s == null ? "" : s).normalize("NFC").replace(/\s+/g, " ").trim();
  const lower = (s) => norm(s).toLowerCase();
  /* "Start date (optional)" and "start date *" both mean "start date" */
  const headerKey = (s) => lower(s).replace(/\s*[(\[].*?[)\]]\s*$/, "").replace(/\s*\*+$/, "").trim();

  /* a cell as the spreadsheet library hands it back -> a plain value. Rich text,
     hyperlinks and formulas all arrive as objects. */
  function plain(v) {
    if (v == null) return "";
    if (v instanceof Date) return v;
    if (typeof v === "number" || typeof v === "string") return v;
    if (typeof v === "boolean") return String(v);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v.result !== undefined) return plain(v.result);
    if (v.text !== undefined) return plain(v.text);
    if (v.error) return "";
    return String(v);
  }
  const str = (v) => { const p = plain(v); return p instanceof Date ? "" : norm(p); };

  /* an Excel worksheet -> rows of plain values; row N of the array is row N of
     the sheet, so "row 14" in a message is row 14 in the file */
  function rowsFromWorksheet(ws) {
    const out = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const vals = ws.getRow(r).values || [];
      const cells = [];
      for (let c = 1; c < vals.length; c++) cells.push(plain(vals[c]));
      out.push(cells);
    }
    return out;
  }

  /* ---------- columns ---------- */
  const EMP_COLUMNS = [
    { key: "id",        label: "ID",                 aliases: ["id", "employee id"], width: 12 },
    { key: "name",      label: "Thai name",          aliases: ["name", "employee name", "thai name", "name (thai)", "ชื่อ", "ชื่อไทย", "ชื่อ (ไทย)"], width: 30 },
    { key: "nameEn",    label: "English name",       aliases: ["english name", "name (english)", "eng name", "ชื่ออังกฤษ", "ชื่อ (อังกฤษ)"], width: 30 },
    { key: "trigoId",   label: "TRIGO ID",           aliases: ["trigo id", "trigoid", "trigo", "employee code", "รหัสพนักงาน", "รหัส trigo"], width: 12 },
    { key: "contract",  label: "Contract type",      aliases: ["contract type", "contract", "ประเภทสัญญา"], width: 15 },
    { key: "position",  label: "Position",           aliases: ["position", "ตำแหน่ง"], width: 24 },
    { key: "phone",     label: "Mobile number",      aliases: ["mobile number", "mobile", "phone", "เบอร์มือถือ"], width: 16 },
    { key: "startDate", label: "Start date",         aliases: ["start date", "วันที่เริ่มงาน"], width: 14 },
    { key: "addedOn",   label: "On the board from",  aliases: ["on the board from", "added on", "on board from"], width: 18 },
    { key: "area",      label: "Service area",       aliases: ["service area", "area", "พื้นที่บริการ"], width: 16 },
    { key: "board",     label: "Board",              aliases: ["board", "current board", "บอร์ด", "บอร์ดปัจจุบัน"], width: 18 },
    { key: "status",    label: "Status",             aliases: ["status", "สถานะ"], width: 12 },
  ];
  const HOST_COLUMNS = [
    { key: "name",     label: "Host name",        aliases: ["host name", "host", "name"], width: 32 },
    { key: "status",   label: "Status",           aliases: ["status"], width: 12 },
    { key: "location", label: "Location",         aliases: ["location"], width: 34 },
    { key: "mapUrl",   label: "Google Maps link", aliases: ["google maps link", "map link", "map url", "maps link"], width: 40 },
    { key: "area",     label: "Service area",     aliases: ["service area", "area"], width: 16 },
    { key: "note",     label: "Note",             aliases: ["note", "notes", "remark"], width: 36 },
  ];

  /* Find the header row (a banner or a few blank lines above it is fine) and
     read every row under it. rows2d: arrays of cell values. */
  function readTable(rows2d, columns, opts = {}) {
    const alias = new Map();
    // a header is first matched as typed ("Name (English)" is the English name), then without a
    // trailing "(note)" like "Start date (dd/mm/yyyy)"
    const exact = new Map();
    const asTyped = (s) => lower(s).replace(/\s+/g, " ").trim();
    for (const c of columns) for (const a of [c.label, ...c.aliases]) { if (headerKey(a) === asTyped(a)) alias.set(headerKey(a), c.key); exact.set(asTyped(a), c.key); }
    let headerAt = -1, colIndex = null, ignored = [];
    for (let r = 0; r < Math.min(rows2d.length, 15); r++) {
      const map = {}, extra = [];
      (rows2d[r] || []).forEach((cell, i) => {
        const h = headerKey(str(cell));
        if (!h) return;
        const k = exact.get(asTyped(str(cell))) || alias.get(h);
        if (k && !(k in map)) map[k] = i; else extra.push(norm(str(cell)));
      });
      if ("name" in map && Object.keys(map).length >= 2) { headerAt = r; colIndex = map; ignored = extra; break; }
    }
    if (headerAt < 0) {
      return { cols: new Set(), records: [], ignored: [], fatal: ["Could not find a header row with at least a Thai name (or Name) column and one more known column. Use the template from the Download button."] };
    }
    const records = [];
    for (let r = headerAt + 1; r < rows2d.length; r++) {
      const cells = {};
      let any = false;
      for (const [k, i] of Object.entries(colIndex)) {
        const v = (rows2d[r] || [])[i];
        cells[k] = v === undefined ? "" : v;
        if (str(v) !== "" || v instanceof Date) any = true;
      }
      if (any) records.push({ rowNumber: r + 1, cells });
    }
    const max = opts.maxRows || 5000;
    if (records.length > max) return { cols: new Set(Object.keys(colIndex)), records: [], ignored, fatal: [`The file has ${records.length} rows; the limit is ${max} per upload. Split it into smaller files.`] };
    return { cols: new Set(Object.keys(colIndex)), records, ignored, fatal: [] };
  }

  /* ---------- cell parsers: each returns { value, warn? } or { error } ---------- */
  const THAI_POSITION = {
    inspector: "ผู้ตรวจสอบ", senior_inspector: "ผู้ตรวจสอบอาวุโส", technician: "ช่างเทคนิค",
    team_leader: "หัวหน้าทีม", assistant_site_engineer: "ผู้ช่วยวิศวกรหน้างาน",
  };
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad2 = (n) => String(n).padStart(2, "0");

  function isoOrNull(y, m, d) {
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad2(m)}-${pad2(d)}` : null;
  }
  /* ISO, 2023-04-20 / 2023/04/20, 20-Apr-2023 (the app's own display), and
     day-first 20/04/2023 (never month-first: this is a Thai workplace). A
     Buddhist-era year (2566) is converted and flagged. Real Excel date cells
     arrive as Date objects at UTC midnight. */
  function parseDate(raw) {
    const p = plain(raw);
    if (p === "") return { value: "" };
    let y, m, d, warn = "";
    if (p instanceof Date) { y = p.getUTCFullYear(); m = p.getUTCMonth() + 1; d = p.getUTCDate(); }
    else if (typeof p === "number") {
      if (p < 20000 || p > 80000) return { error: `"${p}" is not a date` };
      const t = new Date(Date.UTC(1899, 11, 30) + Math.round(p) * 86400000);
      y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate();
    } else {
      const s = norm(p);
      let x;
      if ((x = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) { y = +x[1]; m = +x[2]; d = +x[3]; }
      else if ((x = /^(\d{1,2})[-/ .]([A-Za-z]{3,9})[-/ .,]*(\d{4})$/.exec(s)) && MONTHS[x[2].slice(0, 3).toLowerCase()]) { d = +x[1]; m = MONTHS[x[2].slice(0, 3).toLowerCase()]; y = +x[3]; }
      else if ((x = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) { d = +x[1]; m = +x[2]; y = +x[3]; }
      else return { error: `"${s}" is not a date (use 2023-04-20)` };
    }
    if (y >= 2400) { y -= 543; warn = "year read as Buddhist era (−543)"; }
    if (y < 1950 || y > 2100) return { error: `year ${y} is out of range` };
    const iso = isoOrNull(y, m, d);
    return iso ? { value: iso, warn } : { error: `${d}/${m}/${y} is not a real date` };
  }

  function parsePhone(raw) {
    const p = plain(raw);
    if (p === "") return { value: "" };
    if (p instanceof Date) return { error: "a date was found in the mobile number cell" };
    let s = typeof p === "number" ? String(Math.round(p)) : norm(p);
    let warn = "";
    // Excel turns 0812345678 into the number 812345678 when the cell is not text:
    // nine digits starting 6, 8 or 9 is a Thai mobile that lost its 0
    if (/^[689]\d{8}$/.test(s)) { s = "0" + s; warn = "leading 0 restored"; }
    if (s.length > 40) return { error: "mobile number is too long" };
    return { value: s, warn };
  }

  function parseContract(raw) {
    const s = lower(str(raw));
    if (!s) return { error: "Contract type is empty" };
    if (["permanent", "perm", "ประจำ"].includes(s)) return { value: "permanent" };
    if (["on-call", "oncall", "on call", "ออนคอล"].includes(s)) return { value: "oncall" };
    return { error: `Contract type "${str(raw)}" must be Permanent or On-call` };
  }
  function parseStatus(raw) {
    const s = lower(str(raw));
    if (!s) return { value: null };   // blank = leave as it is (never silently deactivates)
    if (["active", "ใช้งาน", "yes", "true", "1"].includes(s)) return { value: true };
    if (["inactive", "ไม่ใช้งาน", "no", "false", "0", "archived"].includes(s)) return { value: false };
    return { error: `Status "${str(raw)}" must be Active or Inactive` };
  }
  function positionIndex(positions) {
    const m = new Map();
    for (const [k, p] of Object.entries(positions || {})) {
      for (const a of [k, k.replace(/_/g, " "), p.label, p.short, THAI_POSITION[k]]) if (a) m.set(lower(a), k);
    }
    return m;
  }
  const nameIndex = (items) => { const m = new Map(); for (const it of items) { const k = lower(it.name); if (!m.has(k)) m.set(k, it); } return m; };
  function parseHttpUrl(raw) {
    const s = str(raw);
    if (!s) return { value: "" };
    if (/^https?:\/\/\S+$/i.test(s)) return { value: s };
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return { error: "link must start with http:// or https://" };
    return { error: `"${s}" is not a web link (it must start with https://)` };
  }
  const limitText = (s, n, what) => (s.length > n ? { error: `${what} is longer than ${n} characters` } : { value: s });

  /* ---------- planning: employees ---------- */
  const CONTRACT_LABEL = { permanent: "Permanent", oncall: "On-call" };

  /* ctx: { employees:[{id,name,contract,position,phone,startDate,addedOn,areaId,boardId,active}],
            areas:[{id,name}], boards:[{id,name}], positions:{key:{label,short}} }
     -> { rows:[{rowNumber, kind:"update"|"create"|"same"|"error", id, name, changes, patch, create, errors, warnings}],
          counts, fatal, ignored } */
  function planEmployees(table, ctx) {
    const emps = ctx.employees || [];
    const res = { rows: [], counts: {}, fatal: [...(table.fatal || [])], ignored: table.ignored || [], cols: table.cols };
    if (res.fatal.length) return finish(res);
    const has = (k) => table.cols.has(k);
    const areaByName = nameIndex(ctx.areas || []), boardByName = nameIndex(ctx.boards || []);
    const posIdx = positionIndex(ctx.positions);
    const areaName = (id) => ((ctx.areas || []).find((a) => a.id === id) || {}).name || "";
    const boardName = (id) => ((ctx.boards || []).find((b) => b.id === id) || {}).name || "";
    const posLabel = (k) => (k && ctx.positions && ctx.positions[k] ? ctx.positions[k].label : k || "");
    const byId = new Map(emps.map((e) => [e.id, e]));
    const byTrigo = new Map(emps.filter((e) => e.trigoId).map((e) => [e.trigoId.toUpperCase(), e]));
    const byNameKey = new Map();
    for (const e of emps) { const k = lower(e.name); if (!byNameKey.has(k)) byNameKey.set(k, []); byNameKey.get(k).push(e); }
    const claimed = new Map();   // employee id -> first row that matched them

    for (const rec of table.records) {
      const c = rec.cells;
      const row = { rowNumber: rec.rowNumber, kind: "", id: null, name: "", changes: [], patch: {}, create: null, errors: [], warnings: [] };
      res.rows.push(row);
      const err = (m) => row.errors.push(m);
      const name = norm(str(c.name));
      row.name = name;
      if (!name) { err("Name is empty"); row.kind = "error"; continue; }
      if (name.length > 200) { err("Name is longer than 200 characters"); row.kind = "error"; continue; }

      // --- who is this row? ---  the ID column first, then the TRIGO ID, then the name
      let cur = null;
      const idRaw = has("id") ? str(c.id) : "";
      const tidRaw = has("trigoId") ? str(c.trigoId) : "";
      const tid = tidRaw ? EmployeeId.normalizeTrigoId(tidRaw) : "";
      if (tid === null) err(`TRIGO ID "${tidRaw}" must be the letter T and digits, like T329`);
      else if (idRaw) {
        cur = byId.get(idRaw) || byId.get(idRaw.toLowerCase()) || null;
        if (!cur) err("ID not found — was this person deleted? Clear the ID cell to add them as a new person.");
      } else {
        if (tid) cur = byTrigo.get(tid) || null;
        if (!cur) {
          const hits = byNameKey.get(lower(name)) || [];
          if (hits.length > 1) err(`${hits.length} existing employees are named "${name}" — fill in their TRIGO ID (or keep the ID column from the template) to tell them apart`);
          else if (hits.length === 1) {
            if (tid && hits[0].trigoId && hits[0].trigoId !== tid) err(`${hits[0].name} already has the TRIGO ID ${hits[0].trigoId}, but this row says ${tid} — is this a different person with the same name?`);
            else cur = hits[0];
          }
        }
      }
      if (row.errors.length) { row.kind = "error"; continue; }
      if (cur) {
        if (claimed.has(cur.id)) { err(`Same person as row ${claimed.get(cur.id)} — each person may appear once`); row.kind = "error"; continue; }
        claimed.set(cur.id, rec.rowNumber);
        row.id = cur.id;
      }

      // --- every cell: parse, compare with what is stored ---
      const next = {};      // field -> parsed new value (only for columns in the file)
      const note = (r) => { if (r.warn) row.warnings.push(r.warn); };
      next.name = name;
      // English name: optional, an empty cell clears it
      if (has("nameEn")) {
        const en = norm(str(c.nameEn));
        if (en.length > 200) { err("English name is longer than 200 characters"); row.kind = "error"; continue; }
        next.nameEn = en;
      }
      // blank = leave the TRIGO ID as it is (clearing an identity by accident is worse than not clearing)
      if (tid) next.trigoId = tid;

      if (has("contract")) { const r = parseContract(c.contract); if (r.error) err(r.error); else next.contract = r.value; }
      if (has("position")) {
        const s = str(c.position);
        if (!s) next.position = "";
        else { const k = posIdx.get(lower(s)); if (!k) err(`Position "${s}" is not one of: ${Object.values(ctx.positions || {}).map((p) => p.label).join(", ")}`); else next.position = k; }
      }
      if (has("phone")) { const r = parsePhone(c.phone); if (r.error) err(r.error); else { next.phone = r.value; note(r); } }
      if (has("startDate")) { const r = parseDate(c.startDate); if (r.error) err("Start date: " + r.error); else { next.startDate = r.value; note(r); } }
      // blank = leave as it is (unlike the other optional fields): clearing it would make
      // someone count on every past day, and a new person's blank cell is filled with today
      if (has("addedOn") && str(c.addedOn) !== "" || (has("addedOn") && plain(c.addedOn) instanceof Date)) {
        const r = parseDate(c.addedOn); if (r.error) err("On the board from: " + r.error); else { next.addedOn = r.value; note(r); }
      }
      if (has("area")) {
        const s = str(c.area);
        if (!s) {
          if (cur && cur.areaId) err("Service area is blank — pick one (it can't be cleared)");
          else next.areaId = null;
        } else {
          const a = areaByName.get(lower(s));
          if (!a) err(`Service area "${s}" does not exist (existing: ${(ctx.areas || []).map((x) => x.name).join(", ") || "none"})`);
          else next.areaId = a.id;
        }
      }
      if (has("board")) {
        const s = str(c.board);
        if (!s) err("Board is empty");
        else { const b = boardByName.get(lower(s)); if (!b) err(`Board "${s}" does not exist (existing: ${(ctx.boards || []).map((x) => x.name).join(", ")})`); else next.boardId = b.id; }
      }
      if (has("status")) { const r = parseStatus(c.status); if (r.error) err(r.error); else if (r.value !== null) next.active = r.value; }
      if (row.errors.length) { row.kind = "error"; continue; }

      if (cur) {
        const was = {
          name: norm(cur.name), nameEn: norm(cur.nameEn || ""), trigoId: cur.trigoId || "", contract: cur.contract, position: cur.position || "", phone: cur.phone || "",
          startDate: cur.startDate || "", addedOn: cur.addedOn || "", areaId: cur.areaId || null, boardId: cur.boardId,
          active: cur.active !== false,
        };
        const label = {
          name: "Thai name", nameEn: "English name", trigoId: "TRIGO ID", contract: "Contract type", position: "Position", phone: "Mobile number", startDate: "Start date",
          addedOn: "On the board from", areaId: "Service area", boardId: "Board", active: "Status",
        };
        const text = {
          contract: (v) => CONTRACT_LABEL[v] || v, position: posLabel, areaId: areaName, boardId: boardName,
          active: (v) => (v ? "Active" : "Inactive"),
        };
        for (const f of Object.keys(next)) {
          if (next[f] === was[f]) continue;
          const t = text[f] || ((v) => v || "");
          row.changes.push({ field: f, label: label[f], from: t(was[f]), to: t(next[f]) });
          row.patch[f] = next[f];
        }
        row.kind = row.changes.length ? "update" : "same";
        // the name is the full name only: enforced when it is being changed, flagged when it is not yet
        const why = EmployeeId.checkFullName(next.name);
        if (why && next.name !== was.name) err(why);
        else if (why) row.warnings.push(why.charAt(0).toLowerCase() + why.slice(1));
        if (row.errors.length) { row.kind = "error"; row.changes = []; row.patch = {}; continue; }
      } else {
        // a new person needs the fields the New Employee form requires
        const why = EmployeeId.checkFullName(next.name);
        if (why) err(why);
        if (!has("contract") || next.contract === undefined) err("A new person needs a Contract type");
        if (!has("board") || next.boardId === undefined) err("A new person needs a Board");
        if (row.errors.length) { row.kind = "error"; continue; }
        row.create = {
          name, nameEn: next.nameEn || "", trigoId: next.trigoId || "", contract: next.contract, position: next.position || "", phone: next.phone || "",
          startDate: next.startDate || "", addedOn: next.addedOn || "",   // blank addedOn = the database default (today)
          areaId: next.areaId || null, boardId: next.boardId, active: next.active !== false,
        };
        row.kind = "create";
      }
    }

    // --- identity must stay clean once everything is applied (a swap A<->B is fine) ---
    //   * a TRIGO ID belongs to one person;
    //   * two people may share a name only when both have a TRIGO ID.
    const fin = new Map();   // who -> { name, trigoId }
    for (const e of emps) fin.set(e.id, { name: norm(e.name), trigoId: (e.trigoId || "").toUpperCase() });
    for (const r of res.rows) {
      if (r.kind === "update") { const f = fin.get(r.id); if (r.patch.name !== undefined) f.name = r.patch.name; if (r.patch.trigoId !== undefined) f.trigoId = r.patch.trigoId; }
      else if (r.kind === "create") fin.set("row" + r.rowNumber, { name: r.create.name, trigoId: r.create.trigoId || "" });
    }
    const idOwners = new Map(), nameOwners = new Map();
    for (const [who, f] of fin) {
      if (f.trigoId) { if (!idOwners.has(f.trigoId)) idOwners.set(f.trigoId, []); idOwners.get(f.trigoId).push(who); }
      const k = lower(f.name);
      if (!nameOwners.has(k)) nameOwners.set(k, []);
      nameOwners.get(k).push(who);
    }
    for (const r of res.rows) {
      if (r.kind !== "update" && r.kind !== "create") continue;
      const who = r.kind === "create" ? "row" + r.rowNumber : r.id;
      const f = fin.get(who);
      const touchesName = r.kind === "create" || r.patch.name !== undefined;
      const touchesId = r.kind === "create" || r.patch.trigoId !== undefined;
      let bad = "";
      if (touchesId && f.trigoId && idOwners.get(f.trigoId).length > 1) bad = `The TRIGO ID ${f.trigoId} would belong to more than one person`;
      else if ((touchesName || touchesId) && (nameOwners.get(lower(f.name)) || []).some((w) => w !== who && !(f.trigoId && fin.get(w).trigoId))) {
        bad = `The name "${f.name}" would be shared with another employee — give both people their TRIGO ID`;
      }
      if (bad) { r.errors.push(bad); r.kind = "error"; r.changes = []; r.patch = {}; r.create = null; }
    }
    return finish(res);

    function finish(out) {
      const n = { update: 0, create: 0, same: 0, error: 0, moves: 0, clears: 0, deactivate: 0, reactivate: 0, noTrigoId: 0, shortName: 0, total: out.rows.length };
      for (const r of out.rows) {
        n[r.kind]++;
        if (r.kind !== "error") {
          const cur = r.id ? (emps.find((e) => e.id === r.id) || {}) : {};
          const tidAfter = r.kind === "create" ? r.create.trigoId : (r.patch && r.patch.trigoId !== undefined ? r.patch.trigoId : cur.trigoId);
          const nameAfter = r.kind === "create" ? r.create.name : (r.patch && r.patch.name !== undefined ? r.patch.name : cur.name);
          if (!tidAfter) n.noTrigoId++;
          if (EmployeeId.checkFullName(nameAfter)) n.shortName++;
        }
        for (const ch of r.changes) {
          if (ch.field === "boardId") n.moves++;
          if (ch.field === "active") ch.to === "Inactive" ? n.deactivate++ : n.reactivate++;
          if (ch.from && !ch.to && ["position", "phone", "startDate"].includes(ch.field)) n.clears++;
        }
      }
      out.counts = n;
      return out;
    }
  }

  /* ---------- planning: hosts ---------- */
  /* ctx: { hosts:[{name, hasRecord, location, mapUrl, areaId, archived, note}], areas:[{id,name}],
            similarKey?: (name) => string }   — the name is the key; a name that is not
     already in the list is a NEW host (the preview asks before creating those). */
  function planHosts(table, ctx) {
    const hosts = ctx.hosts || [];
    const res = { rows: [], counts: {}, fatal: [...(table.fatal || [])], ignored: table.ignored || [], cols: table.cols };
    const finish = () => {
      const n = { update: 0, create: 0, same: 0, error: 0, clears: 0, total: res.rows.length };
      for (const r of res.rows) { n[r.kind]++; for (const ch of r.changes) if (ch.from && !ch.to && ["location", "mapUrl", "note", "areaId"].includes(ch.field)) n.clears++; }
      res.counts = n;
      return res;
    };
    if (res.fatal.length) return finish();
    const has = (k) => table.cols.has(k);
    const areaByName = nameIndex(ctx.areas || []);
    const areaName = (id) => ((ctx.areas || []).find((a) => a.id === id) || {}).name || "";
    const exact = new Map(), folded = new Map();
    for (const h of hosts) {
      exact.set(norm(h.name), h);
      const k = lower(h.name);
      if (!folded.has(k)) folded.set(k, []);
      folded.get(k).push(h);
    }
    const claimed = new Map();
    for (const rec of table.records) {
      const c = rec.cells;
      const row = { rowNumber: rec.rowNumber, kind: "", name: norm(str(c.name)), changes: [], patch: {}, create: null, errors: [], warnings: [] };
      res.rows.push(row);
      const err = (m) => row.errors.push(m);
      if (!row.name) { err("Host name is empty"); row.kind = "error"; continue; }
      if (row.name.length > 200) { err("Host name is longer than 200 characters"); row.kind = "error"; continue; }

      let cur = exact.get(row.name) || null;
      if (!cur) {
        const hits = folded.get(lower(row.name)) || [];
        if (hits.length > 1) { err(`"${row.name}" matches ${hits.length} hosts that differ only by capital letters — use the exact name`); row.kind = "error"; continue; }
        if (hits.length === 1) { cur = hits[0]; row.warnings.push(`matched "${cur.name}" (capital letters differ)`); }
      }
      if (cur) {
        if (claimed.has(cur.name)) { err(`Same host as row ${claimed.get(cur.name)}`); row.kind = "error"; continue; }
        claimed.set(cur.name, rec.rowNumber);
        row.name = cur.name;
      } else if ([...claimed.keys()].some((k) => lower(k) === lower(row.name)) || res.rows.some((r) => r !== row && r.kind === "create" && lower(r.name) === lower(row.name))) {
        err("This new host name appears twice in the file"); row.kind = "error"; continue;
      }

      const next = {};
      if (has("location")) { const r = limitText(str(plain(c.location)), 500, "Location"); if (r.error) err(r.error); else next.location = r.value; }
      if (has("mapUrl")) { const r = parseHttpUrl(c.mapUrl); if (r.error) err("Google Maps link: " + r.error); else next.mapUrl = r.value; }
      if (has("note")) { const r = limitText(norm(str(c.note)), 2000, "Note"); if (r.error) err(r.error); else next.note = r.value; }
      if (has("area")) {
        const s = str(c.area);
        if (!s) next.areaId = null;
        else { const a = areaByName.get(lower(s)); if (!a) err(`Service area "${s}" does not exist`); else next.areaId = a.id; }
      }
      if (has("status")) {
        const s = lower(str(c.status));
        if (s) {
          if (["active", "ใช้งาน"].includes(s)) next.archived = false;
          else if (["archived", "inactive", "ไม่ใช้งาน"].includes(s)) next.archived = true;
          else err(`Status "${str(c.status)}" must be Active or Archived`);
        }
      }
      if (row.errors.length) { row.kind = "error"; continue; }

      if (cur) {
        const was = { location: cur.location || "", mapUrl: cur.mapUrl || "", note: cur.note || "", areaId: cur.areaId || null, archived: !!cur.archived };
        const label = { location: "Location", mapUrl: "Google Maps link", note: "Note", areaId: "Service area", archived: "Status" };
        const text = { areaId: areaName, archived: (v) => (v ? "Archived" : "Active") };
        for (const f of Object.keys(next)) {
          if (next[f] === was[f]) continue;
          const t = text[f] || ((v) => v || "");
          row.changes.push({ field: f, label: label[f], from: t(was[f]), to: t(next[f]) });
          row.patch[f] = next[f];
        }
        // a host known only from its missions has no record yet: only write one if something is being set
        row.kind = row.changes.length ? "update" : "same";
      } else {
        row.create = { name: row.name, location: next.location || "", mapUrl: next.mapUrl || "", note: next.note || "", areaId: next.areaId || null, archived: !!next.archived };
        row.kind = "create";
        if (ctx.similarKey) {
          const k = ctx.similarKey(row.name);
          const twin = k && hosts.find((h) => ctx.similarKey(h.name) === k);
          if (twin) row.warnings.push(`looks like the existing host "${twin.name}" — fix the name if this is a typo`);
        }
      }
    }
    return finish();
  }

  /* ---------- the template (rows -> Excel) ---------- */
  const dateOut = (iso) => (iso ? iso : "");
  function employeeTable(ctx) {
    const cols = EMP_COLUMNS;
    const areaName = (id) => ((ctx.areas || []).find((a) => a.id === id) || {}).name || "";
    const boardName = (id) => ((ctx.boards || []).find((b) => b.id === id) || {}).name || "";
    const rows = (ctx.employees || []).map((e) => ({
      id: e.id, name: e.name, nameEn: e.nameEn || "", trigoId: e.trigoId || "", contract: CONTRACT_LABEL[e.contract] || e.contract,
      position: e.position && ctx.positions && ctx.positions[e.position] ? ctx.positions[e.position].label : "",
      phone: e.phone || "", startDate: dateOut(e.startDate), addedOn: dateOut(e.addedOn),
      area: areaName(e.areaId), board: boardName(e.boardId), status: e.active === false ? "Inactive" : "Active",
    }));
    return { cols, rows };
  }
  function hostTable(ctx) {
    const areaName = (id) => ((ctx.areas || []).find((a) => a.id === id) || {}).name || "";
    const rows = (ctx.hosts || []).map((h) => ({
      name: h.name, status: h.archived ? "Archived" : "Active", location: h.location || "", mapUrl: h.mapUrl || "",
      area: areaName(h.areaId), note: h.note || "",
    }));
    return { cols: HOST_COLUMNS, rows };
  }
  
  const NAVY = "FF004983", GREEN = "FFA8C855", GREY = "FFE6EAEE", GREY_TXT = "FF7A8794", INK = "FF13222F";
  const EXTRA_ROWS = 300;   // validated, formatted blank rows under the data, for people who add new rows

  /* kind: "employees" | "hosts". The workbook has the data sheet, a Lists sheet
     the dropdowns read from, and a short Read me. */
  async function buildTemplateWorkbook(ExcelJS, kind, ctx) {
    const isEmp = kind === "employees";
    const t = isEmp ? employeeTable(ctx) : hostTable(ctx);
    const wb = new ExcelJS.Workbook();
    wb.creator = "TRIGO Manpower Board";
    wb.created = new Date();
    const ws = wb.addWorksheet(isEmp ? "Employees" : "Hosts", { views: [{ state: "frozen", xSplit: isEmp ? 2 : 1, ySplit: 1 }] });
    const lists = wb.addWorksheet("Lists");
    const readme = wb.addWorksheet("Read me");

    const posLabels = Object.values(ctx.positions || {}).map((p) => p.label);
    const listDefs = isEmp
      ? { contract: ["Permanent", "On-call"], position: posLabels, area: (ctx.areas || []).map((a) => a.name), board: (ctx.boards || []).map((b) => b.name), status: ["Active", "Inactive"] }
      : { status: ["Active", "Archived"], area: (ctx.areas || []).map((a) => a.name) };
    const listRef = {};
    let lc = 1;
    for (const [key, vals] of Object.entries(listDefs)) {
      const col = t.cols.find((c) => c.key === key);
      lists.getCell(1, lc).value = col ? col.label : key;
      lists.getCell(1, lc).font = { bold: true };
      vals.forEach((v, i) => { lists.getCell(2 + i, lc).value = v; });
      lists.getColumn(lc).width = 24;
      if (vals.length) {
        const letter = lists.getColumn(lc).letter;
        listRef[key] = `Lists!$${letter}$2:$${letter}$${1 + vals.length}`;
      }
      lc++;
    }

    t.cols.forEach((col, i) => {
      ws.getColumn(i + 1).width = col.width;
      const h = ws.getCell(1, i + 1);
      h.value = col.label;
      h.font = { bold: true, color: { argb: col.key === "id" ? GREY_TXT : "FFFFFFFF" } };
      h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col.key === "id" ? GREY : NAVY } };
      h.border = { bottom: { style: "medium", color: { argb: GREEN } } };
      h.alignment = { vertical: "middle" };
    });
    ws.getRow(1).height = 22;
    const dateCols = new Set(["startDate", "addedOn"]);
    const last = 1 + t.rows.length + EXTRA_ROWS;
    for (let r = 2; r <= last; r++) {
      const data = t.rows[r - 2];
      t.cols.forEach((col, i) => {
        const cell = ws.getCell(r, i + 1);
        let v = data ? data[col.key] : "";
        if (dateCols.has(col.key)) {
          cell.numFmt = "yyyy-mm-dd";
          if (v) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); v = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : v; }
        } else cell.numFmt = "@";   // text: keeps 081-… and 0812… exactly as typed
        if (v !== "" && v != null) cell.value = v;
        if (col.key === "id") { cell.font = { color: { argb: GREY_TXT }, size: 9 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F6F8" } }; }
        else cell.font = { color: { argb: INK } };
        if (listRef[col.key]) cell.dataValidation = { type: "list", allowBlank: true, formulae: [listRef[col.key]], showErrorMessage: true, errorTitle: col.label, error: "Pick a value from the list (see the Lists sheet)." };
      });
    }
    if (t.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + t.rows.length, column: t.cols.length } };

    const lines = isEmp ? [
      "BULK EDIT — EMPLOYEES",
      "1. Change the cells you need on the Employees sheet. You can also add new people on the empty rows at the bottom.",
      "2. Save the file as .xlsx and upload it with 'Bulk edit' on the Manpower List.",
      "3. The app shows what would change and asks you to confirm before anything is saved.",
      "",
      "RULES",
      "• Thai name = the person's FULL name in Thai (first name and surname), required. It is the name the app shows by default. Never put the TRIGO ID, an initial or a nickname in it.",
      "• English name = the same name in English, optional; it is what an English Excel export uses. An empty cell clears it. If it is empty, the Thai name is used.",
      "• TRIGO ID (T + digits, e.g. T329) goes in its own column. It must be unique. Two people may share a name only if both have a TRIGO ID.",
      "  Leave it empty to keep the current one. To fill in IDs for people who have none, just type them next to the names.",
      "• Do not edit or delete the grey ID column. It is how the app tracks a row, so you can rename someone safely.",
      "  A row is matched by ID, then TRIGO ID, then name. A name that does not exist yet adds a NEW person (you will be asked first).",
      "• Only the columns present are updated. Delete a column you do not want touched. Keep the header names.",
      "• An empty cell clears that field (Position, Mobile number, Start date). Thai name, Contract type and Board cannot be empty. An empty 'On the board from' leaves it as it is.",
      "• Rows you delete from the file are NOT deleted in the app. To retire someone, set Status to Inactive.",
      "• Contract type, Position, Service area, Board and Status must match the Lists sheet (use the dropdowns).",
      "• Dates: 2023-04-20 (also 20-Apr-2023 or 20/04/2023, day first). Buddhist-era years are converted.",
      "• Changing a Board clears that person's assignment on the day you are viewing in the app.",
      "• 'On the board from' is the day someone was added to the app; headcount and Standby count them only from that day.",
    ] : [
      "BULK EDIT — HOSTS",
      "1. Change the cells you need on the Hosts sheet (Location, Google Maps link, Service area, Note, Status).",
      "2. Save as .xlsx and upload it with 'Bulk edit' on the Host List. You confirm before anything is saved.",
      "",
      "RULES",
      "• The Host name is the key. Do NOT rename a host here: a changed name is treated as a different (new) host.",
      "  To rename or merge a host use its Edit dialog / Review duplicates, which also fixes its missions.",
      "• Only the columns present are updated; an empty cell clears that field.",
      "• Google Maps link must start with https://.",
      "• Status: Active or Archived. Hosts are never deleted by an upload.",
    ];
    readme.getColumn(1).width = 120;
    lines.forEach((l, i) => { const c = readme.getCell(i + 1, 1); c.value = l; if (i === 0 || l === "RULES") c.font = { bold: true }; });
    return wb;
  }

  /* an Excel workbook that was uploaded -> rows of its data sheet */
  function rowsFromWorkbook(wb, kind) {
    const want = kind === "hosts" ? "hosts" : "employees";
    const ws = wb.worksheets.find((s) => s.name.toLowerCase() === want) || wb.worksheets[0];
    return ws ? rowsFromWorksheet(ws) : [];
  }

  const api = {
    EMP_COLUMNS, HOST_COLUMNS, plain, readTable, rowsFromWorksheet, rowsFromWorkbook,
    parseDate, parsePhone, planEmployees, planHosts, employeeTable, hostTable, buildTemplateWorkbook,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BulkEdit = api;
})(globalThis);
