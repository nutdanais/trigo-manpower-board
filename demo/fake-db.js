/* An in-memory stand-in for the Supabase/PostgREST backend, for the tests and
   for the browser-only demo.
   It speaks the small query language fake-client.js builds (the subset of
   supabase-js the app uses), keeps the tables in memory, enforces the unique
   keys and cascades the app relies on, emulates the forward-planning triggers
   and RPCs, and broadcasts row changes to subscribers like Realtime does.

   One FakeDb can serve several "users" (browser pages) at once, which is how
   the end-to-end tests check that a second user sees a change live. Fixtures
   are fake people on example.com — nothing real.

   It also runs in a browser (demo mode, see demo/demo.js): the whole file is
   wrapped in a function so its helpers do not become globals of the page, and
   it exports FakeDb on window instead of module.exports. */
"use strict";
(function (root) {

const crypto = (typeof require === "function") ? require("crypto") : root.crypto;
/* randomUUID exists only in secure contexts in a browser (https, localhost) */
const uuid = () => (crypto && crypto.randomUUID) ? crypto.randomUUID()
  : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });

const UNIQUE = {
  missions: ["board_id", "plan_date", "number", "shift"],
  assignments: ["employee_id", "plan_date"],
  deployment_history: ["employee_id", "plan_date"],
  plan_days: ["board_id", "plan_date"],
  plan_day_stamps: ["board_id", "plan_date"],
  day_overrides: ["board_id", "override_date"],
  capacity_demand: ["board_id", "plan_date", "host", "shift"],
  forecast_missions: ["board_id", "plan_date", "number", "shift"],
  forecast_assignments: ["employee_id", "plan_date"],
  hosts: ["name"],
  role_permissions: ["role_key", "area"],
  profiles: ["id"],
  mission_register: ["board_id", "number", "shift"],
  app_settings: ["key"],
  plan_day_ready: ["board_id", "plan_date", "engineer_id"],
};
const NO_ID = new Set(["plan_days", "plan_day_stamps", "day_overrides", "role_permissions", "roles", "app_settings", "plan_day_ready"]);
const FORWARD_TABLES = new Set(["plan_day_stamps", "capacity_demand", "forecast_missions", "forecast_assignments", "forecast_hold_events"]);
const DEFAULTS = {
  missions: () => ({ start_time: "08:00:00", end_time: "17:00:00", hidden: false, ppe: null, remark: null, engineer_id: null }),
  forecast_missions: () => ({ start_time: "08:00:00", end_time: "17:00:00", ppe: null, remark: null, engineer_id: null }),
  employees: () => ({ active: true, position: null, phone: null, start_date: null, added_on: null }),
  boards: () => ({ weekend_days: [0, 6] }),
  plan_day_ready: () => ({ ticked_at: new Date().toISOString() }),
  mission_register: () => ({ status: "open", source: "board", host: null, customer: null, start_time: null, end_time: null, engineer_id: null,
    ppe: null, remark: null, opened_on: null, last_on: null, closed_on: null, closed_by: null, closed_at: null, close_note: null, updated_by: null }),
};
const TIMESTAMPS = new Set(["mission_register", "missions", "assignments", "forecast_missions", "forecast_assignments", "capacity_demand", "boards", "employees", "deployment_history", "hosts", "employee_notes", "forecast_hold_events"]);

const clone = (x) => JSON.parse(JSON.stringify(x));
const nowIso = () => new Date(Date.now()).toISOString();

class FakeDb {
  constructor(opts = {}) {
    this.forwardPlanning = opts.forwardPlanning !== false;
    // migration-2026-09-29 (merge decisions + merge alerts) on top of it
    this.mergeLog = this.forwardPlanning && opts.mergeLog !== false;
    // migration-2026-10-20 (employee_loans); { loans: false } is a database without it
    this.loans = opts.loans !== false;
    // migration-2026-10-28 (missions.highlight, highlight_note); { highlight: false } is a database without it
    this.highlight = opts.highlight !== false;
    // migration-2026-10-28b ('short' allowed); { highlightShort: false } has the columns but the first list of reasons
    this.highlightShort = this.highlight && opts.highlightShort !== false;
    // migration-2026-11-04 (employees.exit_reason); { exitReason: false } is a database without it
    this.exitReason = opts.exitReason !== false;
    // migration-2026-11-09 (mission_register, mission_number_history and their RPCs); { missions: false } is a database without it
    this.missions = opts.missions !== false;
    // migration-2026-11-09b (app_settings: shared settings such as the days that make someone experienced); { appSettings: false } is a database without it
    this.appSettings = opts.appSettings !== false;
    // migration-2026-11-12 (plan_day_ready: the "my part is planned" ticks); { ready: false } is a database without it
    this.ready = opts.ready !== false;
    // migration-2026-11-11 (replace_mission_number); { numberFix: false } is a database without it
    this.numberFix = this.missions && opts.numberFix !== false;
    // migration-2026-11-12b (the capitals trigger on mission numbers); { numberCaps: false } is a database without it
    this.numberCaps = this.missions && opts.numberCaps !== false;
    this.tables = {};
    this.listeners = new Set();
    this.rpcs = {};
    this.clock = 0;
    this._installRpcs();
  }

  t(name) { return this.tables[name] || (this.tables[name] = []); }
  seed(table, rows) { for (const r of rows) this._insertRow(table, r, null); }

  /* monotonic, strictly increasing timestamps: several writes inside one test
     step must still compare in the order they happened */
  now() {
    const t = Math.max(Date.now(), this.clock + 1);
    this.clock = t;
    return new Date(t).toISOString();
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(table, eventType, row, old) {
    for (const fn of this.listeners) fn({ table, eventType, new: row ? clone(row) : {}, old: old ? { id: old.id } : {} });
  }

  _missing(table) {
    return (!this.forwardPlanning && FORWARD_TABLES.has(table)) || (!this.mergeLog && table === "forecast_merge_decisions")
      || (!this.loans && table === "employee_loans")
      || (!this.missions && (table === "mission_register" || table === "mission_number_history"))
      || (!this.appSettings && table === "app_settings")
      || (!this.ready && table === "plan_day_ready");
  }

  /* plan_day_ready's row level security (migration-2026-11-12, public.can_tick_ready): ticking or
     unticking an engineer needs Edit on the Board, and either that engineer's own account or the
     Admin or Manager role. A refused delete removes nothing and says nothing, as in Postgres. */
  _canTick(user, engineerId) {
    if (!this._can(user, "board", "edit")) return false;
    const p = this.t("profiles").find((x) => x.id === user.id || (x.email || "").toLowerCase() === (user.email || "").toLowerCase());
    if (p && (p.role_key === "admin" || p.role_key === "manager")) return true;
    const e = this.t("engineers").find((x) => x.id === engineerId);
    return !!(e && p && e.profile_id === p.id);
  }

  /* app_settings' row level security and check constraint (migration-2026-11-09b): changing a
     setting needs Edit on Settings, host_experienced_days is a whole number from 1 to 365 and
     host_at_risk_max one from 0 to 99 */
  _appSettingsGuard(q, user) {
    if (q.op === "select") return null;
    if (!this._can(user, "settings", "edit")) return { code: "42501", message: 'new row violates row-level security policy for table "app_settings"' };
    for (const v of [].concat(q.values || [])) {
      const range = v && { host_experienced_days: [1, 365], host_at_risk_max: [0, 99], mission_prefix_length: [2, 10] }[v.key];
      if (range && !(Number.isInteger(v.value) && v.value >= range[0] && v.value <= range[1])) {
        return { code: "23514", message: 'new row for relation "app_settings" violates check constraint "app_settings_value_ok"' };
      }
    }
    return null;
  }

  /* A column-level migration not run yet: the errors Postgres / PostgREST give
     for reading or writing a column that isn't there. Only the highlight columns and employees.exit_reason
     are emulated (the others predate every test). */
  _missingColumn(q) {
    const cols = q.table === "missions" && !this.highlight ? ["highlight", "highlight_note"]
      : q.table === "employees" && !this.exitReason ? ["exit_reason"] : null;
    if (!cols) return null;
    const col = cols.find((c) =>
      (typeof q.select === "string" && q.select.split(",").map((x) => x.trim()).includes(c))
      || [].concat(q.values || []).some((v) => v && c in v));
    if (!col) return null;
    return q.op === "select"
      ? { code: "42703", message: `column ${q.table}.${col} does not exist` }
      : { code: "PGRST204", message: `Could not find the '${col}' column of '${q.table}' in the schema cache` };
  }


  /* ---------- query execution ---------- */
  exec(q, user) {
    try {
      if (this._missing(q.table)) {
        return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${q.table}' in the schema cache` } };
      }
      const noCol = this._missingColumn(q);
      if (noCol) return { data: null, error: noCol };
      if (q.table === "app_settings") {
        const refused = this._appSettingsGuard(q, user);
        if (refused) return { data: null, error: refused };
      }
      if (q.table === "plan_day_ready" && (q.op === "insert" || q.op === "upsert")
          && [].concat(q.values || []).some((v) => !this._canTick(user, v && v.engineer_id))) {
        return { data: null, error: { code: "42501", message: 'new row violates row-level security policy for table "plan_day_ready"' } };
      }
      if (q.table === "plan_day_ready" && q.op === "delete") {
        const allowed = this.t("plan_day_ready").filter((r) => this._match(r, q.filters) && this._canTick(user, r.engineer_id));
        for (const r of allowed) this._deleteRow("plan_day_ready", r, user);
        return { data: null, error: null };
      }
      if (!this.highlightShort && q.table === "missions" && [].concat(q.values || []).some((v) => v && v.highlight === "short")) {
        return { data: null, error: { code: "23514", message: 'new row for relation "missions" violates check constraint "missions_highlight_kind"' } };
      }
      switch (q.op) {
        case "select": return this._select(q);
        case "insert": return this._write(q, user, false);
        case "upsert": return this._write(q, user, true);
        case "update": return this._update(q, user);
        case "delete": return this._delete(q, user);
        case "rpc": return this._rpc(q, user);
        default: throw new Error("unknown op " + q.op);
      }
    } catch (e) {
      return { data: null, error: { code: e.code || "FAKE", message: e.message } };
    }
  }

  _match(row, filters) {
    for (const [op, col, val] of filters || []) {
      const v = row[col] === undefined ? null : row[col];
      switch (op) {
        case "eq": if (!(v === val || (v != null && val != null && String(v) === String(val)))) return false; break;
        case "neq": if (v === val) return false; break;
        case "lt": if (!(v != null && v < val)) return false; break;
        case "lte": if (!(v != null && v <= val)) return false; break;
        case "gt": if (!(v != null && v > val)) return false; break;
        case "gte": if (!(v != null && v >= val)) return false; break;
        case "in": if (!val.map(String).includes(String(v))) return false; break;
        case "is": if (val === null ? v !== null : v !== val) return false; break;
        case "notis": if (val === null ? v === null : v === val) return false; break;
        default: throw new Error("unsupported filter " + op);
      }
    }
    return true;
  }

  _project(rows, cols) {
    if (!cols || cols.trim() === "*") return rows.map(clone);
    const names = cols.split(",").map((c) => c.trim()).filter(Boolean);
    return rows.map((r) => Object.fromEntries(names.map((n) => [n, r[n] === undefined ? null : clone(r[n])])));
  }

  _finish(rows, q) {
    let out = rows;
    if (q.order && q.order.length) {
      out = out.slice().sort((a, b) => {
        for (const o of q.order) {
          const x = a[o.col], y = b[o.col];
          if (x === y) continue;
          if (x == null) return 1;
          if (y == null) return -1;
          return (x < y ? -1 : 1) * (o.asc ? 1 : -1);
        }
        return 0;
      });
    }
    const count = out.length;
    if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
    if (q.limit != null) out = out.slice(0, q.limit);
    let data = this._project(out, q.select);
    if (q.head) data = null;
    if (q.single) {
      if (data.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows returned" } };
      if (!data.length) return q.single === "maybe" ? { data: null, error: null } : { data: null, error: { code: "PGRST116", message: "no rows returned" } };
      data = data[0];
    }
    return { data, error: null, count };
  }

  _select(q) {
    return this._finish(this.t(q.table).filter((r) => this._match(r, q.filters)), q);
  }

  _key(table, row) {
    const cols = UNIQUE[table];
    return cols ? cols.map((c) => String(row[c])).join("\u0001") : null;
  }
  _findConflict(table, row, cols) {
    const keyCols = cols || UNIQUE[table];
    if (!keyCols) return null;
    return this.t(table).find((r) => keyCols.every((c) => String(r[c]) === String(row[c]))) || null;
  }

  /* the trigger aaa_uppercase_mission_number: a mission number is saved in capitals, before anything else
     looks at it (so an upsert on a lower-case number meets the capital row) */
  _caps(table, row) {
    if (this.numberCaps && (table === "missions" || table === "forecast_missions" || table === "mission_register") && typeof row.number === "string") row.number = row.number.toUpperCase();
    return row;
  }

  _insertRow(table, values, user) {
    const row = this._caps(table, { ...(DEFAULTS[table] ? DEFAULTS[table]() : {}), ...clone(values) });
    // skip_closed_mission (migration-2026-11-09): a closed mission is never put on a day after it closed
    if (table === "missions" && this.missions && this.t("mission_register").some((r) => r.board_id === row.board_id && r.number === row.number
        && r.shift === row.shift && r.status === "closed" && r.closed_on && row.plan_date > r.closed_on)) return null;
    if (!NO_ID.has(table) && !row.id) row.id = uuid();
    if (TIMESTAMPS.has(table)) {
      const ts = this.now();
      if (!row.created_at && table !== "assignments") row.created_at = ts;
      if (!row.updated_at && table !== "deployment_history" && table !== "employee_notes" && table !== "forecast_hold_events") row.updated_at = ts;
      if (table === "forecast_hold_events" && !row.taken_at) row.taken_at = ts;
    }
    if (table === "assignments" || table === "forecast_assignments") {
      const m = table === "assignments" ? row.mission_id : row.forecast_mission_id;
      if ((m == null) === (row.zone == null)) {
        const e = new Error(`new row for relation "${table}" violates check constraint`); e.code = "23514"; throw e;
      }
    }
    if (this._findConflict(table, row)) {
      const e = new Error(`duplicate key value violates unique constraint "${table}_key"`); e.code = "23505"; throw e;
    }
    this._checkLoanOverlap(table, row);
    this.t(table).push(row);
    this._afterWrite(table, "INSERT", row, null, user);
    return row;
  }

  _write(q, user, isUpsert) {
    const rows = Array.isArray(q.values) ? q.values : [q.values];
    const conflictCols = q.onConflict ? q.onConflict.split(",").map((s) => s.trim()) : null;
    const written = [];
    for (const v of rows) {
      const existing = isUpsert ? this._findConflict(q.table, this._caps(q.table, { ...v }), conflictCols) : null;
      if (existing) {
        if (q.ignoreDuplicates) continue;
        const old = clone(existing);
        Object.assign(existing, this._caps(q.table, clone(v)));
        if (TIMESTAMPS.has(q.table) && existing.updated_at !== undefined && !("updated_at" in v)) existing.updated_at = this.now();
        this._afterWrite(q.table, "UPDATE", existing, old, user);
        written.push(existing);
      } else {
        // the column default from migration-2026-10-02b: a client insert that doesn't
        // name added_on gets today (seeded rows keep the null from DEFAULTS above)
        let row = v;
        if (q.table === "employees" && !("added_on" in v)) {
          const d = new Date();
          row = { ...v, added_on: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") };
        }
        const inserted = this._insertRow(q.table, row, user);
        if (inserted) written.push(inserted);
      }
    }
    if (!q.returning) return { data: null, error: null };
    return this._finish(written, { ...q, filters: [], order: null, range: null, limit: null });
  }

  /* employee_loans_no_overlap (migration-2026-10-27): no two loans of one
     person share a day */
  _checkLoanOverlap(table, row) {
    if (table !== "employee_loans") return;
    if (this.t(table).some((l) => l !== row && l.id !== row.id && l.employee_id === row.employee_id
        && l.start_date <= row.end_date && row.start_date <= l.end_date)) {
      const e = new Error('conflicting key value violates exclusion constraint "employee_loans_no_overlap"'); e.code = "23P01"; throw e;
    }
  }

  _update(q, user) {
    const hits = this.t(q.table).filter((r) => this._match(r, q.filters));
    for (const r of hits) {
      const old = clone(r);
      Object.assign(r, this._caps(q.table, clone(q.values)));
      try { this._checkLoanOverlap(q.table, r); } catch (e) { Object.assign(r, old); throw e; }
      this._afterWrite(q.table, "UPDATE", r, old, user);
    }
    if (!q.returning) return { data: null, error: null };
    return this._finish(hits, { ...q, filters: [] });
  }

  _delete(q, user) {
    const hits = this.t(q.table).filter((r) => this._match(r, q.filters));
    for (const r of hits) this._deleteRow(q.table, r, user);
    return { data: null, error: null };
  }

  _deleteRow(table, row, user) {
    const list = this.t(table);
    const i = list.indexOf(row);
    if (i < 0) return;
    list.splice(i, 1);
    this._afterWrite(table, "DELETE", null, row, user);
    // foreign-key cascades the app depends on
    const cascade = (t, pred) => { for (const r of this.t(t).filter(pred)) this._deleteRow(t, r, user); };
    if (table === "missions") cascade("assignments", (r) => r.mission_id === row.id);
    if (table === "forecast_missions") {
      cascade("forecast_assignments", (r) => r.forecast_mission_id === row.id);
      cascade("forecast_hold_events", (r) => r.from_forecast_mission_id === row.id);
      for (const r of this.t("forecast_hold_events")) if (r.to_forecast_mission_id === row.id) r.to_forecast_mission_id = null;
    }
    if (table === "engineers") cascade("plan_day_ready", (r) => r.engineer_id === row.id);
    if (table === "employees") {
      for (const t of ["assignments", "deployment_history", "forecast_assignments", "forecast_hold_events"]) cascade(t, (r) => r.employee_id === row.id);
    }
    if (table === "boards") {
      for (const t of ["missions", "employees", "plan_days", "plan_day_stamps", "capacity_demand", "forecast_missions", "day_overrides", "mission_register", "plan_day_ready"]) cascade(t, (r) => r.board_id === row.id);
    }
  }

  /* ---------- triggers ---------- */
  _afterWrite(table, op, row, old, user) {
    this._emit(table, op, row, old);
    if (table === "missions" && this.missions) this._syncRegister(op, row, old, user);
    if (!this.forwardPlanning) return;
    if (table !== "missions" && table !== "assignments") return;
    const by = (user && user.email) || "system";
    const bump = (boardId, date) => {
      if (!boardId || !date || !this.t("boards").some((b) => b.id === boardId)) return;
      const key = { board_id: boardId, plan_date: date };
      let s = this._findConflict("plan_day_stamps", key);
      if (!s) { s = { ...key }; this.t("plan_day_stamps").push(s); }
      s.last_edited_at = this.now();
      s.last_edited_by = by;
    };
    // assignments: effective_board() — the loan covering that date, else the employee's own board
    const loanOf = (r) => this.loans && this.t("employee_loans").find((l) => l.employee_id === r.employee_id && l.start_date <= r.plan_date && r.plan_date <= l.end_date);
    const boardOf = (r) => table === "missions" ? r.board_id
      : ((loanOf(r) || {}).to_board_id || (this.t("employees").find((e) => e.id === r.employee_id) || {}).board_id);
    if (old) bump(boardOf(old), old.plan_date);
    if (row && (!old || boardOf(row) !== boardOf(old) || row.plan_date !== old.plan_date)) bump(boardOf(row), row.plan_date);
  }

  /* sync_mission_register / forget_unused_mission (migration-2026-11-09) */
  _syncRegister(op, row, old, user) {
    if (this._renumbering) return;   // renumber_missions renames the register itself
    if (row && (op === "INSERT" || op === "UPDATE")) {
      if (!this.t("boards").some((b) => b.id === row.board_id)) return;
      const key = { board_id: row.board_id, number: row.number, shift: row.shift };
      const r = this._findConflict("mission_register", key);
      const details = { host: row.host, customer: row.customer, start_time: row.start_time, end_time: row.end_time,
        engineer_id: row.engineer_id, ppe: row.ppe, remark: row.remark };
      if (!r) {
        this._insertRow("mission_register", { ...key, ...details, opened_on: row.plan_date, last_on: row.plan_date, updated_by: (user && user.email) || "system" }, user);
      } else {
        const prev = clone(r);
        if (!r.opened_on || row.plan_date < r.opened_on) r.opened_on = row.plan_date;
        if (!r.last_on || row.plan_date >= r.last_on) { Object.assign(r, details); r.last_on = row.plan_date; }
        r.updated_at = this.now();
        this._emit("mission_register", "UPDATE", r, prev);
      }
    }
    if (op === "DELETE" && old) {
      const r = this._findConflict("mission_register", { board_id: old.board_id, number: old.number, shift: old.shift });
      if (r && r.status === "open" && r.source === "board"
          && !this.t("missions").some((m) => m.board_id === old.board_id && m.number === old.number && m.shift === old.shift)
          && !this.t("mission_number_history").some((h) => h.new_number === old.number || h.old_number === old.number)) {
        this._deleteRow("mission_register", r, user);
      }
    }
  }

  /* public.can() for the RPCs: the caller's role from profiles, its level from role_permissions */
  _can(user, area, need) {
    const p = user && this.t("profiles").find((x) => x.id === user.id || (x.email || "").toLowerCase() === (user.email || "").toLowerCase());
    if (!p || p.status !== "active") return false;
    const rp = this.t("role_permissions").find((x) => x.role_key === p.role_key && x.area === area);
    const L = { none: 0, view: 1, edit: 2 };
    return !!rp && (L[rp.level] || 0) >= (L[need] || 0);
  }

  /* public.mission_prefix_length (migration-2026-11-11): the site code length from app_settings, 5 until set */
  _sitePattern() {
    const r = this.appSettings && this.t("app_settings").find((x) => x.key === "mission_prefix_length");
    const n = r && Number.isInteger(r.value) && r.value >= 2 && r.value <= 10 ? r.value : 5;
    return "[A-Z][A-Z0-9]{" + (n - 1) + "}";
  }

  /* ---------- RPCs ---------- */
  _rpc(q, user) {
    const fn = q.fn === "replace_mission_number" && !this.numberFix ? null : this.rpcs[q.fn];
    if (!fn) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${q.fn} in the schema cache` } };
    if (this._missing({ stamp_carry: "plan_day_stamps", stamp_forecast_merge: "plan_day_stamps", set_forecast_assignment: "forecast_assignments", acknowledge_hold_events: "forecast_hold_events", record_forecast_merge: "forecast_merge_decisions",
      close_mission: "mission_register", reopen_mission: "mission_register", renumber_missions: "mission_register" }[q.fn] || "")) {
      return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${q.fn} in the schema cache` } };
    }
    return { data: fn(q.args || {}, user), error: null };
  }

  _installRpcs() {
    const email = (u) => ((u && u.email) || "unknown").toLowerCase();
    this.rpcs.engineer_directory = () => [];
    this.rpcs.touch_last_seen = () => null;
    this.rpcs.clear_must_change_password = () => null;
    this.rpcs.stamp_carry = (a) => {
      const key = { board_id: a.p_board_id, plan_date: a.p_plan_date };
      let s = this._findConflict("plan_day_stamps", key);
      if (!s) { s = { ...key }; this.t("plan_day_stamps").push(s); }
      s.carried_from = a.p_carried_from;
      s.carried_at = this.now();
      return null;
    };
    this.rpcs.stamp_forecast_merge = (a, u) => {
      const key = { board_id: a.p_board_id, plan_date: a.p_plan_date };
      let s = this._findConflict("plan_day_stamps", key);
      if (!s) { s = { ...key }; this.t("plan_day_stamps").push(s); }
      s.forecast_merged_at = this.now();
      s.forecast_merged_by = email(u);
      return null;
    };
    this.rpcs.set_forecast_assignment = (a, u) => {
      const me = email(u);
      const mission = a.p_mission_id || null, zone = a.p_zone || null;
      const old = this.t("forecast_assignments").find((r) => r.employee_id === a.p_employee_id && r.plan_date === a.p_plan_date);
      if (old && (old.forecast_mission_id || null) === mission && (old.zone || null) === zone) return { changed: false };
      let eventId = null;
      if (old && old.held_by && old.held_by.toLowerCase() !== me && old.held_by.toLowerCase() !== "migrated") {
        eventId = this._insertRow("forecast_hold_events", {
          employee_id: a.p_employee_id, plan_date: a.p_plan_date,
          from_forecast_mission_id: old.forecast_mission_id || null, from_zone: old.zone || null, from_held_by: old.held_by,
          to_forecast_mission_id: mission, to_zone: zone, taken_by: me, acknowledged_at: null, acknowledged_by: null, kind: "taken",
        }, u).id;
      }
      if (!mission && !zone) {
        if (old) this._deleteRow("forecast_assignments", old, u);
      } else if (old) {
        const prev = clone(old);
        Object.assign(old, { forecast_mission_id: mission, zone, held_by: me, updated_at: this.now() });
        this._afterWrite("forecast_assignments", "UPDATE", old, prev, u);
      } else {
        this._insertRow("forecast_assignments", { employee_id: a.p_employee_id, plan_date: a.p_plan_date, forecast_mission_id: mission, zone, held_by: me }, u);
      }
      return { changed: true, event_id: eventId, taken_from: eventId ? old.held_by : null };
    };
    /* mirrors public.record_forecast_merge: one log row per decision, the
       forecaster read from the forecast rows (never from the item), an alert
       only for a carry choice over somebody else's forecast */
    this.rpcs.record_forecast_merge = (a, u) => {
      const me = email(u);
      const mergeId = uuid();
      const at = this.now();
      let events = 0;
      for (const it of a.p_items || []) {
        let fm = null, zone = null, forecaster = null;
        if (it.type === "person") {
          const emp = this.t("employees").find((e) => e.id === it.employee_id);
          if (!emp || emp.board_id !== a.p_board_id) throw Object.assign(new Error("That employee is not on this board."), { code: "23514" });
          const fa = this.t("forecast_assignments").find((r) => r.employee_id === it.employee_id && r.plan_date === a.p_plan_date);
          if (fa) { fm = fa.forecast_mission_id || null; zone = fa.zone || null; forecaster = fa.held_by || null; }
        } else if (it.type === "field" || it.type === "add") {
          const m = this.t("forecast_missions").find((r) => r.board_id === a.p_board_id && r.plan_date === a.p_plan_date && r.number === it.mission_number && r.shift === it.mission_shift);
          if (m) { fm = m.id; forecaster = it.type === "add" ? (m.created_by || null) : (m.updated_by || m.created_by || null); }
        }
        const reason = ((it.reason || "").trim().slice(0, 500)) || null;
        this._insertRow("forecast_merge_decisions", {
          merge_id: mergeId, board_id: a.p_board_id, plan_date: a.p_plan_date, item_type: it.type, employee_id: it.employee_id || null,
          mission_number: it.mission_number || null, mission_shift: it.mission_shift || null, field: it.field || null,
          carry_value: it.carry_value ?? null, forecast_value: it.forecast_value ?? null, choice: it.choice,
          forecaster, reason, merged_by: me, merged_at: at,
        }, u);
        if (it.choice === "carry" && forecaster && forecaster.toLowerCase() !== me && forecaster.toLowerCase() !== "migrated") {
          this._insertRow("forecast_hold_events", {
            kind: "merge", employee_id: it.type === "person" ? it.employee_id : null, plan_date: a.p_plan_date,
            from_forecast_mission_id: fm, from_zone: zone, from_held_by: forecaster, to_forecast_mission_id: null, to_zone: null,
            taken_by: me, taken_at: at, reason, merge_id: mergeId, acknowledged_at: null, acknowledged_by: null,
            detail: { type: it.type, board_id: a.p_board_id, mission_number: it.mission_number || null, mission_shift: it.mission_shift || null,
                      field: it.field || null, carry_value: it.carry_value ?? null, forecast_value: it.forecast_value ?? null },
          }, u);
          events++;
        }
      }
      this.rpcs.stamp_forecast_merge({ p_board_id: a.p_board_id, p_plan_date: a.p_plan_date }, u);
      return { merge_id: mergeId, decisions: (a.p_items || []).length, events };
    };
    const fail = (msg, code) => { throw Object.assign(new Error(msg), { code }); };
    /* mirrors public.close_mission (migration-2026-11-09) */
    this.rpcs.close_mission = (a, u) => {
      if (!this._can(u, "missions", "edit")) fail("Your role cannot close missions.", "42501");
      if (!a.p_closed_on) fail("Choose the last working day.", "23514");
      const r = this.t("mission_register").find((x) => x.id === a.p_id);
      if (!r) fail("That mission is not in the Missions list.", "P0002");
      if (r.status === "closed") fail(`Mission ${r.number} is already closed.`, "23514");
      const after = (m) => m.board_id === r.board_id && m.number === r.number && m.shift === r.shift && m.plan_date > a.p_closed_on;
      if (this.t("missions").some((m) => after(m) && this.t("plan_days").some((d) => d.board_id === m.board_id && d.plan_date === m.plan_date && d.locked_at))) {
        fail(`Mission ${r.number} is on a locked day after ${a.p_closed_on}. Unlock that day first, or choose a later last working day.`, "23514");
      }
      const prev = clone(r);
      Object.assign(r, { status: "closed", closed_on: a.p_closed_on, closed_by: email(u), closed_at: this.now(),
        close_note: ((a.p_note || "").trim()) || null, last_on: r.last_on && r.last_on < a.p_closed_on ? r.last_on : a.p_closed_on, updated_at: this.now() });
      this._emit("mission_register", "UPDATE", r, prev);
      const gone = this.t("missions").filter(after);
      for (const m of gone) {
        const crew = this.t("assignments").filter((x) => x.mission_id === m.id).map((x) => x.employee_id);
        for (const h of this.t("deployment_history").filter((h) => h.plan_date === m.plan_date && crew.includes(h.employee_id) && h.mission_number === r.number)) this._deleteRow("deployment_history", h, u);
        this._deleteRow("missions", m, u);
      }
      if (this.forwardPlanning) for (const m of this.t("forecast_missions").filter(after)) this._deleteRow("forecast_missions", m, u);
      return null;
    };
    this.rpcs.reopen_mission = (a, u) => {
      if (!this._can(u, "missionadmin", "edit")) fail("Your role cannot reopen missions.", "42501");
      const r = this.t("mission_register").find((x) => x.id === a.p_id && x.status === "closed");
      if (!r) fail("That mission is not closed.", "P0002");
      const prev = clone(r);
      Object.assign(r, { status: "open", closed_on: null, closed_by: null, closed_at: null, close_note: null, updated_at: this.now() });
      this._emit("mission_register", "UPDATE", r, prev);
      return null;
    };
    /* mirrors public.renumber_missions: all or nothing, the days from p_valid_from on, stamps kept */
    this.rpcs.renumber_missions = (a, u) => {
      if (!this._can(u, "missionadmin", "edit")) fail("Your role cannot enter new mission numbers.", "42501");
      if (!a.p_valid_from) fail("Choose the date the new numbers start.", "23514");
      const items = (a.p_items || []).map((it) => ({ old: String(it.old || "").trim().toUpperCase(), new: String(it.new || "").trim().toUpperCase() }));
      const reg = () => this.t("mission_register");
      for (const it of items) {
        if (!new RegExp("^" + this._sitePattern() + "\\.[0-9]{2}\\.[0-9]{4}$").test(it.new)) fail(`Mission number ${it.new} is not in the form PREFIX.YY.NNNN.`, "23514");
        if (it.new === it.old) continue;
        if (!reg().some((r) => r.number === it.old)) fail(`Mission ${it.old} is not in the Missions list.`, "P0002");
        if (reg().some((r) => r.number === it.new) || items.filter((x) => x.new === it.new).length > 1) fail(`Mission number ${it.new} is already used.`, "23505");
      }
      const stamps = clone(this.t("plan_day_stamps"));
      let n = 0;
      this._renumbering = true;
      try {
        for (const it of items) {
          if (it.new === it.old) continue;
          for (const r of reg().filter((r) => r.number === it.old)) { const prev = clone(r); r.number = it.new; r.updated_at = this.now(); this._emit("mission_register", "UPDATE", r, prev); }
          for (const t of ["missions"].concat(this.forwardPlanning ? ["forecast_missions"] : [])) {
            for (const m of this.t(t).filter((m) => m.number === it.old && m.plan_date >= a.p_valid_from)) { const prev = clone(m); m.number = it.new; this._emit(t, "UPDATE", m, prev); }
          }
          for (const h of this.t("deployment_history").filter((h) => h.mission_number === it.old && h.plan_date >= a.p_valid_from)) h.mission_number = it.new;
          this._insertRow("mission_number_history", { old_number: it.old, new_number: it.new, valid_from: a.p_valid_from, entered_by: email(u), entered_at: this.now() }, u);
          n++;
        }
      } finally { this._renumbering = false; }
      this.tables.plan_day_stamps = stamps;
      return n;
    };
    /* mirrors public.replace_mission_number (migration-2026-11-11): a wrong or temporary number corrected on
       every day, every board and shift, the forecast days and the Host Record; the history written; stamps kept */
    this.rpcs.replace_mission_number = (a, u) => {
      if (!this._can(u, "missions", "edit")) fail("Your role cannot change mission numbers.", "42501");
      const from = String(a.p_old || "").trim(), to = String(a.p_new || "").replace(/\s/g, "").toUpperCase();
      const site = this._sitePattern();
      if (!new RegExp("^" + site + "\\.[0-9]{2}\\.([0-9]{4}|TMP[0-9]{3})$").test(to)) fail(`Mission number ${to} is not in the form PREFIX.YY.NNNN (or a temporary PREFIX.YY.TMPNNN).`, "23514");
      if (to === from) return 0;
      if (/\.TMP[0-9]{3}$/.test(to) && new RegExp("^" + site + "\\.[0-9]{2}\\.[0-9]{4}$").test(from)) fail(`Mission ${from} already has its Etraq number.`, "23514");
      const reg = this.t("mission_register").filter((r) => r.number === from);
      if (!reg.length) fail(`Mission ${from} is not in the Missions list.`, "P0002");
      if (this.t("mission_register").some((r) => r.number === to) || this.t("missions").some((m) => m.number === to)
        || this.t("mission_number_history").some((h) => h.old_number === to)) fail(`Mission number ${to} is already used.`, "23505");
      const firstOn = reg.map((r) => r.opened_on).filter(Boolean).sort()[0] || this.now().slice(0, 10);
      const stamps = clone(this.t("plan_day_stamps"));
      this._renumbering = true;
      try {
        for (const r of reg) { const prev = clone(r); r.number = to; r.updated_at = this.now(); r.updated_by = email(u); this._emit("mission_register", "UPDATE", r, prev); }
        for (const t of ["missions"].concat(this.forwardPlanning ? ["forecast_missions"] : [])) {
          for (const m of this.t(t).filter((m) => m.number === from)) { const prev = clone(m); m.number = to; this._emit(t, "UPDATE", m, prev); }
        }
        for (const h of this.t("deployment_history").filter((h) => h.mission_number === from)) h.mission_number = to;
        this._insertRow("mission_number_history", { old_number: from, new_number: to, valid_from: firstOn, entered_by: email(u), entered_at: this.now() }, u);
      } finally { this._renumbering = false; }
      this.tables.plan_day_stamps = stamps;
      return reg.length;
    };
    this.rpcs.acknowledge_hold_events = (a, u) => {
      let n = 0;
      for (const r of this.t("forecast_hold_events")) {
        if (a.p_ids.includes(r.id) && !r.acknowledged_at) {
          const prev = clone(r);
          r.acknowledged_at = this.now();
          r.acknowledged_by = email(u);
          this._afterWrite("forecast_hold_events", "UPDATE", r, prev, u);
          n++;
        }
      }
      return n;
    };
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { FakeDb };
else root.FakeDb = FakeDb;

})(typeof window !== "undefined" ? window : globalThis);
