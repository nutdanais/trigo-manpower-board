/* An in-memory stand-in for the Supabase/PostgREST backend, for tests only.
   It speaks the small query language fake-client.js builds (the subset of
   supabase-js the app uses), keeps the tables in memory, enforces the unique
   keys and cascades the app relies on, emulates the forward-planning triggers
   and RPCs, and broadcasts row changes to subscribers like Realtime does.

   One FakeDb can serve several "users" (browser pages) at once, which is how
   the end-to-end tests check that a second user sees a change live. Fixtures
   are fake people on example.com — nothing real. */
"use strict";

const crypto = require("crypto");

const UNIQUE = {
  missions: ["board_id", "plan_date", "number", "shift"],
  assignments: ["employee_id", "plan_date"],
  deployment_history: ["employee_id", "plan_date"],
  plan_days: ["board_id", "plan_date"],
  plan_day_stamps: ["board_id", "plan_date"],
  day_overrides: ["board_id", "override_date"],
  capacity_demand: ["board_id", "plan_date", "customer", "shift"],
  forecast_missions: ["board_id", "plan_date", "number", "shift"],
  forecast_assignments: ["employee_id", "plan_date"],
  hosts: ["name"],
  role_permissions: ["role_key", "area"],
  profiles: ["id"],
};
const NO_ID = new Set(["plan_days", "plan_day_stamps", "day_overrides", "role_permissions", "roles"]);
const FORWARD_TABLES = new Set(["plan_day_stamps", "capacity_demand", "forecast_missions", "forecast_assignments", "forecast_hold_events"]);
const DEFAULTS = {
  missions: () => ({ start_time: "08:00:00", end_time: "17:00:00", hidden: false, ppe: null, remark: null, engineer_id: null }),
  forecast_missions: () => ({ start_time: "08:00:00", end_time: "17:00:00", ppe: null, remark: null, engineer_id: null }),
  employees: () => ({ active: true, position: null, phone: null }),
  boards: () => ({ weekend_days: [0, 6] }),
};
const TIMESTAMPS = new Set(["missions", "assignments", "forecast_missions", "forecast_assignments", "capacity_demand", "boards", "employees", "deployment_history", "hosts", "employee_notes", "forecast_hold_events"]);

const clone = (x) => JSON.parse(JSON.stringify(x));
const nowIso = () => new Date(Date.now()).toISOString();

class FakeDb {
  constructor(opts = {}) {
    this.forwardPlanning = opts.forwardPlanning !== false;
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
    return !this.forwardPlanning && FORWARD_TABLES.has(table);
  }

  /* ---------- query execution ---------- */
  exec(q, user) {
    try {
      if (this._missing(q.table)) {
        return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${q.table}' in the schema cache` } };
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

  _insertRow(table, values, user) {
    const row = { ...(DEFAULTS[table] ? DEFAULTS[table]() : {}), ...clone(values) };
    if (!NO_ID.has(table) && !row.id) row.id = crypto.randomUUID();
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
    this.t(table).push(row);
    this._afterWrite(table, "INSERT", row, null, user);
    return row;
  }

  _write(q, user, isUpsert) {
    const rows = Array.isArray(q.values) ? q.values : [q.values];
    const conflictCols = q.onConflict ? q.onConflict.split(",").map((s) => s.trim()) : null;
    const written = [];
    for (const v of rows) {
      const existing = isUpsert ? this._findConflict(q.table, v, conflictCols) : null;
      if (existing) {
        if (q.ignoreDuplicates) continue;
        const old = clone(existing);
        Object.assign(existing, clone(v));
        if (TIMESTAMPS.has(q.table) && existing.updated_at !== undefined && !("updated_at" in v)) existing.updated_at = this.now();
        this._afterWrite(q.table, "UPDATE", existing, old, user);
        written.push(existing);
      } else {
        written.push(this._insertRow(q.table, v, user));
      }
    }
    if (!q.returning) return { data: null, error: null };
    return this._finish(written, { ...q, filters: [], order: null, range: null, limit: null });
  }

  _update(q, user) {
    const hits = this.t(q.table).filter((r) => this._match(r, q.filters));
    for (const r of hits) {
      const old = clone(r);
      Object.assign(r, clone(q.values));
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
    if (table === "employees") {
      for (const t of ["assignments", "deployment_history", "forecast_assignments", "forecast_hold_events"]) cascade(t, (r) => r.employee_id === row.id);
    }
    if (table === "boards") {
      for (const t of ["missions", "employees", "plan_days", "plan_day_stamps", "capacity_demand", "forecast_missions", "day_overrides"]) cascade(t, (r) => r.board_id === row.id);
    }
  }

  /* ---------- triggers ---------- */
  _afterWrite(table, op, row, old, user) {
    this._emit(table, op, row, old);
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
    const boardOf = (r) => table === "missions" ? r.board_id : (this.t("employees").find((e) => e.id === r.employee_id) || {}).board_id;
    if (old) bump(boardOf(old), old.plan_date);
    if (row && (!old || boardOf(row) !== boardOf(old) || row.plan_date !== old.plan_date)) bump(boardOf(row), row.plan_date);
  }

  /* ---------- RPCs ---------- */
  _rpc(q, user) {
    const fn = this.rpcs[q.fn];
    if (!fn) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${q.fn} in the schema cache` } };
    if (this._missing({ stamp_carry: "plan_day_stamps", stamp_forecast_merge: "plan_day_stamps", set_forecast_assignment: "forecast_assignments", acknowledge_hold_events: "forecast_hold_events" }[q.fn] || "")) {
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
          to_forecast_mission_id: mission, to_zone: zone, taken_by: me, acknowledged_at: null, acknowledged_by: null,
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

module.exports = { FakeDb };
