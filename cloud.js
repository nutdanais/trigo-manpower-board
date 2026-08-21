/* Cloud data layer — Supabase backend (replaces the old localStorage `store`).
   Exposes the same shape app.js already expects: cloud.data.{areas,engineers,employees,boards,plans,activeBoardId}
   Reads are synchronous from an in-memory cache; writes go to Supabase and the cache is
   refreshed afterwards (both from our own write and from other users via Realtime). */

"use strict";

const sb = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);

/* zone keys shared with app.js (loaded after this script) */
const ZONES = ["annual", "sick", "business", "unpaid", "exchange"]; // "standby" is computed (permanent + unassigned), not a manual zone

function todayStrISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function addDaysISO(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const hhmm = (t) => (t || "08:00:00").slice(0, 5);
const dowOf = (iso) => new Date(iso + "T00:00:00").getDay();
const boardWeekendDays = (boardId) => {
  const b = cloud.data.boards.find((x) => x.id === boardId);
  return (b && b.weekendDays && b.weekendDays.length !== undefined) ? b.weekendDays : [0, 6];
};
/* is this date a weekend by the board's configured weekend days (ignores overrides) */
const isWeekendDate = (iso, boardId = cloud.data.activeBoardId) =>
  boardWeekendDays(boardId).includes(dowOf(iso));
/* a per-date override, if any, for this board */
const findOverride = (iso, boardId = cloud.data.activeBoardId) =>
  cloud.data.overrides.find((o) => o.date === iso && o.boardId === boardId);
const hasOverride = (iso, boardId = cloud.data.activeBoardId) => !!findOverride(iso, boardId);
/* final answer: is this a non-working day (weekend/holiday) for this board?
   an override wins over the board's default weekend config */
const isNonWorkingDate = (iso, boardId = cloud.data.activeBoardId) => {
  const o = findOverride(iso, boardId);
  return o ? !o.isWorking : isWeekendDate(iso, boardId);
};
const emptyZones = () => Object.fromEntries(ZONES.map((z) => [z, []]));

const cloud = {
  data: { areas: [], engineers: [], employees: [], boards: [], plans: {}, overrides: [], locks: [], activeBoardId: null },
  _listeners: [],
  _currentDate: () => todayStrISO(),

  onChange(fn) { this._listeners.push(fn); },
  notify() { for (const fn of this._listeners) fn(); },

  /* ---------- auth ---------- */
  async getSession() {
    const { data } = await sb.auth.getSession();
    return data.session;
  },
  onAuthChange(fn) { sb.auth.onAuthStateChange((_event, session) => fn(session)); },
  async signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async signOut() { await sb.auth.signOut(); },

  /* ---------- initial load ---------- */
  async init(getCurrentDate) {
    this._currentDate = getCurrentDate;
    await Promise.all([this._loadAreas(), this._loadEngineers(), this._loadBoards(), this._loadEmployees(), this._loadOverrides(), this._loadLocks()]);
    if (!this.data.activeBoardId && this.data.boards.length) this.data.activeBoardId = this.data.boards[0].id;
    this._subscribeRealtime();
  },

  async _loadAreas() {
    const { data, error } = await sb.from("service_areas").select("*").order("name");
    if (error) throw error;
    this.data.areas = data.map((a) => ({ id: a.id, name: a.name, color: a.color }));
  },
  async _loadEngineers() {
    const { data, error } = await sb.from("engineers").select("*").order("name");
    if (error) throw error;
    this.data.engineers = data.map((e) => ({ id: e.id, name: e.name, phone: e.phone, color: e.color }));
  },
  async _loadBoards() {
    const { data, error } = await sb.from("boards").select("*").order("created_at");
    if (error) throw error;
    this.data.boards = data.map((b) => ({ id: b.id, name: b.name, weekendDays: b.weekend_days || [0, 6] }));
  },
  async _loadEmployees() {
    const { data, error } = await sb.from("employees").select("*").order("name");
    if (error) throw error;
    this.data.employees = data.map((e) => ({ id: e.id, name: e.name, contract: e.contract, position: e.position || "", phone: e.phone || "", areaId: e.area_id, boardId: e.board_id }));
  },
  async _loadOverrides() {
    // tolerate the table not existing yet (before the workweek migration is run) —
    // the app still works, overrides just stay empty until the migration + redeploy.
    try {
      const { data, error } = await sb.from("day_overrides").select("board_id, override_date, is_working");
      if (error) throw error;
      this.data.overrides = (data || []).map((o) => ({ boardId: o.board_id, date: o.override_date, isWorking: o.is_working }));
    } catch (e) {
      console.warn("day_overrides table unavailable (run the workweek migration):", e.message || e);
      this.data.overrides = [];
    }
  },
  async _loadLocks() {
    // tolerate the lock columns not existing yet (before the locking migration
    // is run) — the app still works, "Lock board" just no-ops until then.
    try {
      const { data, error } = await sb.from("plan_days")
        .select("board_id, plan_date, locked_by, locked_at").not("locked_by", "is", null);
      if (error) throw error;
      this.data.locks = (data || []).map((r) => ({ boardId: r.board_id, date: r.plan_date, lockedBy: r.locked_by, lockedAt: r.locked_at }));
    } catch (e) {
      if (!this._planDaysMissing(e)) console.warn("plan_days locking unavailable (run the locking migration):", e.message || e);
      this.data.locks = [];
    }
  },

  /* ---------- plan (missions + assignments) for one board+date ---------- */
  /* A PURE READ — loading a board+date never writes to the database. There is
     no auto carry-forward / seeding here: a future day stays empty until a user
     explicitly brings the last working day's plan into it (the "Carry over" /
     "Reset Board" button → resetBoardFromLastWorkingDay). This is deliberate.
     The old design seeded the day during the load, so merely opening or
     exporting a board — or a Realtime ping, or a tab refocus — could rewrite a
     plan and broadcast that revert to everyone, including the planner. That was
     the "adjusted board disappears when another user logs in" bug. Making the
     load read-only removes the whole class of problem: only deliberate user
     actions ever change a plan. */
  async ensurePlanLoaded(boardId, date, opts = {}) {
    const { force = false } = opts;
    if (!boardId) return { missions: [], zones: emptyZones(), updatedAt: null };
    if (!this.data.plans[boardId]) this.data.plans[boardId] = {};
    if (this.data.plans[boardId][date] && !force) return this.data.plans[boardId][date];

    const { data: missionRows, error } = await sb.from("missions").select("*").eq("board_id", boardId).eq("plan_date", date);
    if (error) throw error;

    const { data: aRows, error: aErr } = await sb.from("assignments").select("*").eq("plan_date", date);
    if (aErr) throw aErr;
    const assignRows = aRows || [];

    const boardEmpIds = new Set(this.data.employees.filter((e) => e.boardId === boardId).map((e) => e.id));

    const plan = { missions: [], zones: emptyZones(), updatedAt: null };
    const missionMap = {};
    for (const m of missionRows || []) {
      const obj = {
        id: m.id, number: m.number, host: m.host, customer: m.customer, shift: m.shift,
        startTime: hhmm(m.start_time), endTime: hhmm(m.end_time), engineerId: m.engineer_id,
        ppe: m.ppe || "", remark: m.remark || "", hidden: !!m.hidden, members: [],
      };
      missionMap[m.id] = obj;
      plan.missions.push(obj);
    }
    let latest = null;
    for (const a of assignRows) {
      if (!boardEmpIds.has(a.employee_id)) continue;
      if (a.mission_id && missionMap[a.mission_id]) missionMap[a.mission_id].members.push(a.employee_id);
      else if (a.zone && plan.zones[a.zone]) plan.zones[a.zone].push(a.employee_id);
      if (!latest || a.updated_at > latest) latest = a.updated_at;
    }
    for (const m of missionRows || []) if (!latest || m.updated_at > latest) latest = m.updated_at;
    plan.updatedAt = latest;

    this.data.plans[boardId][date] = plan;
    return plan;
  },

  /* True when an error means the plan_days table isn't there yet (migration not
     run) — lets the lock code degrade gracefully instead of breaking. */
  _planDaysMissing(error) {
    const code = error && error.code;
    const msg = (error && error.message) || "";
    return code === "42P01" || code === "PGRST205" ||
      (/plan_days/i.test(msg) && /(does not exist|schema cache|could not find)/i.test(msg));
  },

  /* upsert mission rows guarding against duplicates (board_id,plan_date,number,shift).
     Requires the missions_unique_number_shift constraint from migration-2026-07-15;
     if that hasn't been run yet, Postgres rejects the ON CONFLICT target (42P10) —
     fall back to a plain insert so the app still works, just without the guard,
     exactly like before that migration existed. */
  async _upsertMissionsGuarded(rows) {
    if (!rows.length) return;
    const { error } = await sb.from("missions")
      .upsert(rows, { onConflict: "board_id,plan_date,number,shift", ignoreDuplicates: true });
    if (!error) return;
    // a column-level migration (remark, hidden, ...) hasn't been run yet on this
    // database - read the missing column's name out of Postgres's error message
    // and retry without it, so saves still work either way.
    const missingCol = this._missingColumnFromError(error);
    if (missingCol && rows.some((r) => missingCol in r)) {
      return this._upsertMissionsGuarded(rows.map((r) => { const { [missingCol]: _drop, ...rest } = r; return rest; }));
    }
    const noConstraintYet = error.code === "42P10" || /no unique or exclusion constraint/i.test(error.message || "");
    if (!noConstraintYet) throw error;
    const { error: fallbackErr } = await sb.from("missions").insert(rows);
    if (fallbackErr) throw fallbackErr;
  },

  /* Postgres reports a missing column as e.g. "column missions.hidden does not
     exist" (or, on insert/upsert, "Could not find the 'hidden' column of
     'missions' in the schema cache" from PostgREST) - pull the column name out
     of either shape so callers can retry without it. Returns null if the error
     doesn't look like a missing-column error at all. */
  _missingColumnFromError(error) {
    const msg = (error && error.message) || "";
    if (!/column/i.test(msg)) return null;
    let m = msg.match(/column\s+"?(?:[\w]+"?\.)?"?(\w+)"?\b[^]*does not exist/i);
    if (m) return m[1];
    m = msg.match(/find the .([\w]+). column/i);
    if (m) return m[1];
    return null;
  },

  async _copyPlanForward(boardId, srcDate, destDate) {
    const { data: srcMissions } = await sb.from("missions").select("*").eq("board_id", boardId).eq("plan_date", srcDate);
    const { data: srcAssignments } = await sb.from("assignments").select("*").eq("plan_date", srcDate);

    // Only a day with NO missions of its own gets yesterday's missions seeded in.
    // If the planner has already created/edited missions (or remarks) for this
    // day, leave those untouched and carry over ONLY the employees — so pre-set
    // mission details survive while the previous day's people still come across.
    let { data: destMissions, error: destErr } = await sb
      .from("missions").select("id, number, shift").eq("board_id", boardId).eq("plan_date", destDate);
    if (destErr) throw destErr;

    if ((!destMissions || destMissions.length === 0) && srcMissions && srcMissions.length) {
      const inserts = srcMissions.map((m) => ({
        board_id: boardId, plan_date: destDate, number: m.number, host: m.host, customer: m.customer,
        shift: m.shift, start_time: m.start_time, end_time: m.end_time, engineer_id: m.engineer_id,
        ppe: m.ppe, remark: m.remark, hidden: m.hidden,
      }));
      // guarded upsert makes this safe to run twice at once (e.g. the holiday
      // toggle's own refresh racing with the Realtime-triggered one): whichever
      // call gets there first wins, the other silently skips instead of
      // inserting a second copy of the same mission.
      await this._upsertMissionsGuarded(inserts);
      ({ data: destMissions } = await sb
        .from("missions").select("id, number, shift").eq("board_id", boardId).eq("plan_date", destDate));
    }

    // map each source mission to the destination mission with the same
    // number+shift (matching by content, not id, since ids differ per day)
    const idMap = {};
    for (const sm of srcMissions || []) {
      const match = (destMissions || []).find((dm) => dm.number === sm.number && dm.shift === sm.shift);
      if (match) idMap[sm.id] = match.id;
    }
    const boardEmpIds = new Set(this.data.employees.filter((e) => e.boardId === boardId).map((e) => e.id));
    const assignInserts = [];
    for (const a of srcAssignments || []) {
      if (!boardEmpIds.has(a.employee_id)) continue;
      if (a.mission_id) {
        const mapped = idMap[a.mission_id];
        if (!mapped) continue;   // that mission isn't on the destination day → leave the employee on standby
        assignInserts.push({ employee_id: a.employee_id, plan_date: destDate, mission_id: mapped, zone: null });
      } else if (a.zone) {
        assignInserts.push({ employee_id: a.employee_id, plan_date: destDate, mission_id: null, zone: a.zone });
      }
    }
    if (assignInserts.length) {
      // insert-only (never overwrite): the caller already guarantees the target
      // day has no assignments, and ignoreDuplicates keeps a racing/duplicate
      // copy from clobbering a plan someone just made.
      const { error } = await sb.from("assignments").upsert(assignInserts, { onConflict: "employee_id,plan_date", ignoreDuplicates: true });
      if (error) throw error;
    }
  },

  /* ---------- mutations ---------- */
  /* Drop the in-memory plan cache so the editing client re-reads fresh data on
     its next render. Writes must NOT rely on the Realtime echo of their own
     change to refresh the view — that echo is delayed or dropped when a mobile
     tab is backgrounded or the network flips, which left saved edits invisible
     until a full reload. Realtime stays the cross-user sync layer; this makes a
     client always see its own write immediately. */
  _invalidatePlans() { this.data.plans = {}; },

  /* "Carry over" / "Reset Board": the ONLY way a plan is carried forward — there
     is no automatic seeding anymore. Explicitly clear this board's plan for
     `date` and re-clone the latest working-day plan (missions + employee
     assignments) into it. On an empty day this is a plain carry-over; on a day
     that already has content it is a destructive replace, which is why the UI
     confirms first. Returns the source date used, or null if there was no prior
     working-day plan to copy. */
  async resetBoardFromLastWorkingDay(boardId, date) {
    const srcDate = await this.findLatestWeekdayMissionDate(boardId, date);
    if (!srcDate) return null;
    const boardEmpIds = this.data.employees.filter((e) => e.boardId === boardId).map((e) => e.id);
    // clear the day first so the copy is a clean full clone, not a merge
    if (boardEmpIds.length) {
      const { error: aErr } = await sb.from("assignments").delete().eq("plan_date", date).in("employee_id", boardEmpIds);
      if (aErr) throw aErr;
    }
    const { error: mErr } = await sb.from("missions").delete().eq("board_id", boardId).eq("plan_date", date);
    if (mErr) throw mErr;
    await this._copyPlanForward(boardId, srcDate, date);
    this._invalidatePlans();
    return srcDate;
  },

  async setAssignment(employeeId, date, target) {
    if (!target) {
      const { error } = await sb.from("assignments").delete().eq("employee_id", employeeId).eq("plan_date", date);
      if (error) throw error;
    } else {
      const { error } = await sb.from("assignments").upsert(
        { employee_id: employeeId, plan_date: date, mission_id: target.missionId || null, zone: target.zone || null },
        { onConflict: "employee_id,plan_date" }
      );
      if (error) throw error;
    }
    this._invalidatePlans();
  },

  /* Postgres unique_violation (23505) on missions_unique_number_shift → a friendlier message */
  _friendlyMissionError(error) {
    if (error && error.code === "23505") {
      return new Error("A mission with this number already exists on this shift for this date. Use a different shift, or edit the existing mission instead.");
    }
    return error;
  },

  async saveMission(boardId, date, missionId, vals) {
    const row = {
      number: vals.number, host: vals.host, customer: vals.customer, shift: vals.shift,
      start_time: vals.startTime, end_time: vals.endTime, engineer_id: vals.engineerId,
      ppe: vals.ppe || null,
      updated_at: new Date().toISOString(),
    };
    const rowWithRemark = { ...row, remark: vals.remark || null };
    const attempt = (r) => missionId
      ? sb.from("missions").update(r).eq("id", missionId)
      : sb.from("missions").insert({ ...r, board_id: boardId, plan_date: date });
    let { error } = await attempt(rowWithRemark);
    if (error && /remark/i.test(error.message || "") && /column/i.test(error.message || "")) {
      // remark migration not run yet — retry without it so saves still work
      ({ error } = await attempt(row));
    }
    if (error) throw this._friendlyMissionError(error);
    this._invalidatePlans();
  },
  async deleteMission(missionId) {
    const { error } = await sb.from("missions").delete().eq("id", missionId);
    if (error) throw error;
    this._invalidatePlans();
  },

  /* ---------- weekend "Add Mission" import ---------- */
  /* most recent weekday (strictly before `beforeDate`) that has missions on this board */
  async findLatestWeekdayMissionDate(boardId, beforeDate) {
    const { data, error } = await sb
      .from("missions").select("plan_date")
      .eq("board_id", boardId).lt("plan_date", beforeDate)
      .order("plan_date", { ascending: false }).limit(60);
    if (error) throw error;
    return [...new Set((data || []).map((r) => r.plan_date))].find((d) => !isNonWorkingDate(d, boardId)) || null;
  },
  async getMissionsForDate(boardId, date) {
    const { data, error } = await sb
      .from("missions").select("*").eq("board_id", boardId).eq("plan_date", date).order("number");
    if (error) throw error;
    return (data || []).map((m) => ({
      id: m.id, number: m.number, host: m.host, customer: m.customer, shift: m.shift,
      startTime: hhmm(m.start_time), endTime: hhmm(m.end_time), engineerId: m.engineer_id, ppe: m.ppe || "",
      hidden: !!m.hidden,
    }));
  },
  /* copy chosen missions (definitions only, no member assignments) onto targetDate.
     Returns how many were actually added vs. skipped because that number+shift
     already exists on the target date. */
  async importMissions(boardId, targetDate, missionIds) {
    if (!missionIds.length) return { added: 0, skipped: 0 };
    const { data: rows, error } = await sb.from("missions").select("*").in("id", missionIds);
    if (error) throw error;
    const inserts = rows.map((m) => ({
      board_id: boardId, plan_date: targetDate, number: m.number, host: m.host, customer: m.customer,
      shift: m.shift, start_time: m.start_time, end_time: m.end_time, engineer_id: m.engineer_id, ppe: m.ppe,
      remark: m.remark, hidden: false,   // an explicitly imported mission is always visible
    }));
    const before = await sb.from("missions").select("id", { count: "exact", head: true }).eq("board_id", boardId).eq("plan_date", targetDate);
    await this._upsertMissionsGuarded(inserts);
    const after = await sb.from("missions").select("id", { count: "exact", head: true }).eq("board_id", boardId).eq("plan_date", targetDate);
    const added = (after.count || 0) - (before.count || 0);
    return { added, skipped: inserts.length - added };
  },

  /* ---------- hide/unhide missions (declutter without deleting) ---------- */
  /* Hiding a mission that still has people on it first returns them to Standby
     (their assignments for this mission are deleted outright, not moved to a
     zone - "unassigned" is exactly what Standby already means) so nobody
     becomes invisible and the stats stay truthful. missionIds are already
     date-scoped (each day has its own mission rows), so this only ever touches
     the day the mission belongs to. */
  async setMissionsHidden(missionIds, hidden) {
    if (!missionIds.length) return;
    if (hidden) {
      const { error: aErr } = await sb.from("assignments").delete().in("mission_id", missionIds);
      if (aErr) throw aErr;
    }
    const { error } = await sb.from("missions").update({ hidden }).in("id", missionIds);
    if (error) {
      const missingCol = this._missingColumnFromError(error);
      if (missingCol === "hidden") {
        throw new Error("Hiding missions needs a one-time database update (migration-2026-08-13-hidden-missions.sql) before it can be used.");
      }
      throw error;
    }
    this._invalidatePlans();
  },

  /* ---------- per-date working/non-working override (per board) ---------- */
  /* Force `date` on `boardId` to working or non-working. If the requested state
     already matches the board's default weekend config, we just drop any override;
     otherwise we store one. Turning a day non-working clears that board's missions
     for the day so it starts empty like a weekend. */
  async setDayWorking(boardId, date, isWorking) {
    const matchesDefault = isWorking === !isWeekendDate(date, boardId);
    if (matchesDefault) {
      const { error } = await sb.from("day_overrides")
        .delete().eq("board_id", boardId).eq("override_date", date);
      if (error) throw error;
    } else {
      const { error } = await sb.from("day_overrides").upsert(
        { board_id: boardId, override_date: date, is_working: isWorking },
        { onConflict: "board_id,override_date" });
      if (error) throw error;
    }
    if (!isWorking) {
      const { error: delErr } = await sb.from("missions").delete().eq("board_id", boardId).eq("plan_date", date);
      if (delErr) throw delErr;
    }
    await this._loadOverrides();
  },

  /* ---------- lock/unlock a finished day's board (view-only for everyone) ---------- */
  /* Locking never creates a new row type — it sets locked_by/locked_at on the
     same plan_days row the auto-seed marker lives on, and never deletes that
     row, so unlocking can't re-arm the "adjusted board disappears" bug. */
  async lockDay(boardId, date) {
    const { data: { session } } = await sb.auth.getSession();
    const email = (session && session.user && session.user.email) || "unknown";
    const { error } = await sb.from("plan_days").upsert(
      { board_id: boardId, plan_date: date, locked_by: email, locked_at: new Date().toISOString() },
      { onConflict: "board_id,plan_date" });
    if (error) {
      if (this._missingColumnFromError(error) || this._planDaysMissing(error)) {
        throw new Error("Locking a board needs a one-time database update (migration-2026-08-14b-plan-day-locks.sql) before it can be used.");
      }
      throw error;
    }
    await this._loadLocks();
  },
  async unlockDay(boardId, date) {
    const { error } = await sb.from("plan_days")
      .update({ locked_by: null, locked_at: null })
      .eq("board_id", boardId).eq("plan_date", date);
    if (error) throw error;
    await this._loadLocks();
  },

  async saveEmployee(employeeId, vals) {
    const name = vals.name.trim();
    // guard against two employee cards for the same name (checked against the
    // synced local cache, not a hard DB constraint — a real company can have two
    // genuinely different people share a name, so this is a soft, app-level rule
    // rather than something that could ever require merging real people's records)
    const conflict = this.data.employees.find(
      (e) => e.id !== employeeId && e.name.trim().toLowerCase() === name.toLowerCase());
    if (conflict) {
      throw new Error(`An employee named "${name}" already exists. Use a different name (e.g. add an ID/initial) to tell them apart.`);
    }
    const baseRow = { name, contract: vals.contract, area_id: vals.areaId, board_id: vals.boardId };
    // newest optional columns first, falling back to fewer columns if a migration
    // hasn't been run yet on this database — so saves keep working either way
    const candidates = [
      { ...baseRow, position: vals.position || null, phone: vals.phone || null },
      { ...baseRow, position: vals.position || null },
      baseRow,
    ];
    const attempt = (row) => employeeId
      ? sb.from("employees").update(row).eq("id", employeeId)
      : sb.from("employees").insert(row);
    let error;
    for (const row of candidates) {
      ({ error } = await attempt(row));
      if (!error || !/column/i.test(error.message || "")) break;
    }
    if (error) throw error;
    await this._loadEmployees();
  },
  async deleteEmployee(employeeId) {
    const { error } = await sb.from("employees").delete().eq("id", employeeId);
    if (error) throw error;
    this._invalidatePlans();   // their assignments cascade-delete — drop stale plan cache
    await this._loadEmployees();
  },
  /* bulk-delete one or many employees (Manpower List multi-select) */
  async deleteEmployees(ids) {
    if (!ids.length) return;
    const { error } = await sb.from("employees").delete().in("id", ids);
    if (error) throw error;
    this._invalidatePlans();
    await this._loadEmployees();
  },
  /* bulk-set the position of one or many employees */
  async setEmployeesPosition(ids, position) {
    if (!ids.length) return;
    const { error } = await sb.from("employees").update({ position: position || null }).in("id", ids);
    if (error) {
      if (/position/i.test(error.message || "") && /column/i.test(error.message || "")) {
        throw new Error("Employee positions need a one-time database update (migration-2026-07-16-position.sql) before they can be saved.");
      }
      throw error;
    }
    await this._loadEmployees();
  },
  /* bulk-set the contract type of one or many employees */
  async setEmployeesContract(ids, contract) {
    if (!ids.length) return;
    const { error } = await sb.from("employees").update({ contract }).in("id", ids);
    if (error) throw error;
    await this._loadEmployees();
  },
  /* bulk-set the service area of one or many employees */
  async setEmployeesArea(ids, areaId) {
    if (!ids.length) return;
    const { error } = await sb.from("employees").update({ area_id: areaId }).in("id", ids);
    if (error) throw error;
    await this._loadEmployees();
  },
  async moveEmployeeToBoard(employeeId, targetBoardId, date) {
    await sb.from("assignments").delete().eq("employee_id", employeeId).eq("plan_date", date);
    const { error } = await sb.from("employees").update({ board_id: targetBoardId }).eq("id", employeeId);
    if (error) throw error;
    this._invalidatePlans();
    await this._loadEmployees();
  },
  /* bulk move-to-board (Manpower List multi-select) — same date-scoped assignment
     clear as the single-employee version, just batched. Skips ids already on
     targetBoardId: a mixed-board selection moved to one of its own boards would
     otherwise still wipe that day's assignment for the employees who don't move. */
  async moveEmployeesToBoard(ids, targetBoardId, date) {
    const movingIds = ids.filter((id) => {
      const e = this.data.employees.find((x) => x.id === id);
      return e && e.boardId !== targetBoardId;
    });
    if (!movingIds.length) return;
    await sb.from("assignments").delete().in("employee_id", movingIds).eq("plan_date", date);
    const { error } = await sb.from("employees").update({ board_id: targetBoardId }).in("id", movingIds);
    if (error) throw error;
    this._invalidatePlans();
    await this._loadEmployees();
  },

  async createBoard(name, weekendDays) {
    const { data, error } = await sb.from("boards")
      .insert({ name, weekend_days: weekendDays || [0, 6] }).select("*").single();
    if (error) throw error;
    await this._loadBoards();
    return data.id;
  },
  async renameBoard(boardId, name) {
    const { error } = await sb.from("boards").update({ name }).eq("id", boardId);
    if (error) throw error;
    await this._loadBoards();
  },
  /* which days of the week are this board's normal weekend — set once at
     board creation (see createBoard) and, until now, never editable after
     that. An empty array is valid and means "no weekly day off" (a board
     that runs every day); it's the caller's job to confirm that's intended,
     not this function's. */
  async saveBoardWeekendDays(boardId, weekendDays) {
    const { error } = await sb.from("boards").update({ weekend_days: weekendDays }).eq("id", boardId);
    if (error) throw error;
    await this._loadBoards();
  },

  async saveEngineerField(id, field, value) {
    const { error } = await sb.from("engineers").update({ [field]: value }).eq("id", id);
    if (error) throw error;
    await this._loadEngineers();
  },
  async addEngineer() {
    const { error } = await sb.from("engineers").insert({ name: "New Engineer", phone: "", color: "#9ca3af" });
    if (error) throw error;
    await this._loadEngineers();
  },
  async deleteEngineer(id) {
    const { error } = await sb.from("engineers").delete().eq("id", id);
    if (error) throw error;
    await this._loadEngineers();
  },

  async saveAreaField(id, field, value) {
    const { error } = await sb.from("service_areas").update({ [field]: value }).eq("id", id);
    if (error) throw error;
    await this._loadAreas();
  },
  async addArea() {
    const { error } = await sb.from("service_areas").insert({ name: "New Area", color: "#9ca3af" });
    if (error) throw error;
    await this._loadAreas();
  },
  async deleteArea(id) {
    const { error } = await sb.from("service_areas").delete().eq("id", id);
    if (error) throw error;
    await this._loadAreas();
  },

  /* ---------- utilization trend (Overview 7/14/30-day chart) ---------- */
  /* Two bulk queries (not one per day) covering `boardIds` over
     [fromDate, toDate] inclusive. Returns { [boardId]: { [date]: { assigned,
     leave, headcount, oncallAssigned, oncallLeave, oncallHeadcount } } } with
     an entry for EVERY calendar date in range — working day, weekend, and
     holiday alike. Different charts need different subsets of dates (the
     utilization trend skips non-working days; the on-call availability trend
     skips only each board's weekly weekend, deliberately keeping holidays —
     see renderOverview() in app.js), so the "which dates count" decision is
     made by each chart at render time, not baked in here.
     Caveats (surfaced in the UI, not hidden here): headcount/oncallHeadcount
     use each employee's CURRENT board membership for the whole window - board
     moves aren't tracked historically - and hidden missions on that date are
     excluded from `assigned`/`oncallAssigned`, matching what the board
     itself shows today. */
  async getUtilizationRange(boardIds, fromDate, toDate) {
    if (!boardIds.length) return {};
    const [{ data: missionRows, error: mErr }, { data: assignRows, error: aErr }] = await Promise.all([
      sb.from("missions").select("id, board_id, plan_date, hidden")
        .in("board_id", boardIds).gte("plan_date", fromDate).lte("plan_date", toDate),
      sb.from("assignments").select("employee_id, plan_date, mission_id, zone")
        .gte("plan_date", fromDate).lte("plan_date", toDate),
    ]);
    if (mErr) throw mErr;
    if (aErr) throw aErr;

    const missionBoard = new Map();    // mission id -> board id
    const missionHidden = new Set();   // mission ids that are hidden on their date
    for (const m of missionRows || []) {
      missionBoard.set(m.id, m.board_id);
      if (m.hidden) missionHidden.add(m.id);
    }
    const empBoard = new Map(this.data.employees.map((e) => [e.id, e.boardId]));
    const empContract = new Map(this.data.employees.map((e) => [e.id, e.contract]));
    const headcountByBoard = {};
    const oncallHeadcountByBoard = {};
    for (const id of boardIds) {
      const emps = this.data.employees.filter((e) => e.boardId === id);
      headcountByBoard[id] = emps.length;
      oncallHeadcountByBoard[id] = emps.filter((e) => e.contract === "oncall").length;
    }

    // seed every calendar date for every requested board so each chart has a
    // full axis to work from, even on dates with zero assignments
    const result = Object.fromEntries(boardIds.map((id) => [id, {}]));
    for (let d = fromDate; d <= toDate; d = addDaysISO(d, 1)) {
      for (const boardId of boardIds) {
        result[boardId][d] = {
          assigned: 0, leave: 0, headcount: headcountByBoard[boardId],
          oncallAssigned: 0, oncallLeave: 0, oncallHeadcount: oncallHeadcountByBoard[boardId],
        };
      }
    }
    for (const a of assignRows || []) {
      const boardId = empBoard.get(a.employee_id);
      const bucket = boardId && result[boardId] && result[boardId][a.plan_date];
      if (!bucket) continue;
      const isOncall = empContract.get(a.employee_id) === "oncall";
      if (a.mission_id) {
        if (missionHidden.has(a.mission_id)) continue;
        if (missionBoard.get(a.mission_id) !== boardId) continue;   // employee has since moved boards
        bucket.assigned++;
        if (isOncall) bucket.oncallAssigned++;
      } else if (a.zone && ZONES.includes(a.zone)) {
        bucket.leave++;
        if (isOncall) bucket.oncallLeave++;
      }
    }
    return result;
  },

  /* ---------- realtime ---------- */
  _subscribeRealtime() {
    // Drop all cached plans on any missions/assignments change — app.js's own
    // onChange handler reloads exactly what the current view needs before redrawing.
    const refreshPlanAndNotify = async () => {
      this.data.plans = {};
      this.notify();
    };
    sb.channel("db-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, async () => { await this._loadEmployees(); this.notify(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "boards" }, async () => { await this._loadBoards(); this.notify(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "engineers" }, async () => { await this._loadEngineers(); this.notify(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "service_areas" }, async () => { await this._loadAreas(); this.notify(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "missions" }, refreshPlanAndNotify)
      .on("postgres_changes", { event: "*", schema: "public", table: "assignments" }, refreshPlanAndNotify)
      .on("postgres_changes", { event: "*", schema: "public", table: "day_overrides" }, async () => { await this._loadOverrides(); this.data.plans = {}; this.notify(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "plan_days" }, async () => { await this._loadLocks(); this.notify(); })
      .subscribe();
  },
};
