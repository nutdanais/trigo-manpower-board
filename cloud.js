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

/* PostgREST caps an unbounded .select() at the project's default row limit
   (1000, typically) — silently, with NO error, just a truncated result. Any
   query whose row count scales with headcount × days (utilization trend,
   host coverage) can exceed that once the org/history is big enough, and
   only the wider ranges (14D/30D vs. 7D) tend to cross the line — which
   looks exactly like "the value for the same day changes with the range"
   even though every date's own bucket is computed correctly from whatever
   rows actually came back. `buildQuery` is called fresh per page since a
   query builder can't be re-run once it's fired. */
const FETCH_PAGE_SIZE = 1000;
async function fetchAllPages(buildQuery) {
  let all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + FETCH_PAGE_SIZE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < FETCH_PAGE_SIZE) return all;
    from += FETCH_PAGE_SIZE;
  }
}

const cloud = {
  data: { areas: [], engineers: [], employees: [], boards: [], plans: {}, overrides: [], locks: [], activeBoardId: null },
  _listeners: [],
  _currentDate: () => todayStrISO(),

  onChange(fn) { this._listeners.push(fn); },
  // optional payload, currently only set by the missions/assignments realtime
  // handlers ({boardId, updatedBy}) — every other caller still calls notify()
  // with nothing, and existing listeners that ignore the argument are unaffected
  notify(payload) { for (const fn of this._listeners) fn(payload); },

  /* ---------- auth ---------- */
  async getSession() {
    const { data } = await sb.auth.getSession();
    return data.session;
  },
  /* same pattern lockDay already used for locked_by — stamp the acting
     user's email into updated_by on every missions/assignments write, so
     the realtime "changed by someone else" toast has something to compare
     against (see _attributionFromPayload) */
  async _currentEmail() {
    const { data: { session } } = await sb.auth.getSession();
    return (session && session.user && session.user.email) || "unknown";
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
    // active is carried through as-is (undefined pre-migration, true/false after)
    // and NOT filtered out here — a deactivated employee's past mission/zone
    // assignments still need to resolve through D().employees when rendering
    // history. app.js filters to "active only" at the specific call sites
    // where "current roster" (not "who was really there") is the right idea.
    this.data.employees = data.map((e) => ({ id: e.id, name: e.name, contract: e.contract, position: e.position || "", phone: e.phone || "", areaId: e.area_id, boardId: e.board_id, active: e.active }));
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

  /* Same idea as _planDaysMissing, generalized to any table: true when an error
     means the table itself isn't there yet (migration not run), as opposed to
     some other failure worth surfacing. */
  _tableMissing(error) {
    const code = error && error.code;
    const msg = (error && error.message) || "";
    return code === "42P01" || code === "PGRST205" || /(does not exist|schema cache|could not find)/i.test(msg);
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
    const updatedBy = await this._currentEmail();
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
        ppe: m.ppe, remark: m.remark, hidden: m.hidden, updated_by: updatedBy,
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
    // active !== false — a new day's plan is a "current roster" operation,
    // unlike a historical read (ensurePlanLoaded's own boardEmpIds, above,
    // deliberately does NOT filter this way). Employees load unfiltered now
    // (see _loadEmployees), so a deactivated employee's old assignment would
    // otherwise get carried into a brand new day — exactly what deactivating
    // them should prevent.
    const boardEmpIds = new Set(this.data.employees.filter((e) => e.boardId === boardId && e.active !== false).map((e) => e.id));
    const assignInserts = [];
    const historyInserts = [];
    const srcMissionById = Object.fromEntries((srcMissions || []).map((m) => [m.id, m]));
    for (const a of srcAssignments || []) {
      if (!boardEmpIds.has(a.employee_id)) continue;
      if (a.mission_id) {
        const mapped = idMap[a.mission_id];
        if (!mapped) continue;   // that mission isn't on the destination day → leave the employee on standby
        assignInserts.push({ employee_id: a.employee_id, plan_date: destDate, mission_id: mapped, zone: null, updated_by: updatedBy });
        // same content as the source mission (it was just cloned onto destDate),
        // so no extra lookup needed — see cloud.js's _writeDeploymentHistory for
        // why this is a plain-text snapshot rather than a mission_id FK
        const sm = srcMissionById[a.mission_id];
        if (sm) historyInserts.push({ employee_id: a.employee_id, plan_date: destDate, mission_number: sm.number, host: sm.host, customer: sm.customer, board_id: boardId });
      } else if (a.zone) {
        assignInserts.push({ employee_id: a.employee_id, plan_date: destDate, mission_id: null, zone: a.zone, updated_by: updatedBy });
      }
    }
    if (assignInserts.length) {
      // insert-only (never overwrite): the caller already guarantees the target
      // day has no assignments, and ignoreDuplicates keeps a racing/duplicate
      // copy from clobbering a plan someone just made.
      let { error } = await sb.from("assignments").upsert(assignInserts, { onConflict: "employee_id,plan_date", ignoreDuplicates: true });
      if (error && this._missingColumnFromError(error) === "updated_by") {
        const stripped = assignInserts.map(({ updated_by, ...rest }) => rest);
        ({ error } = await sb.from("assignments").upsert(stripped, { onConflict: "employee_id,plan_date", ignoreDuplicates: true }));
      }
      if (error) throw error;
    }
    if (historyInserts.length) {
      // best-effort, same as _writeDeploymentHistory: never block carry-over on this
      const { error } = await sb.from("deployment_history").upsert(historyInserts, { onConflict: "employee_id,plan_date" });
      if (error) console.error("deployment_history bulk write failed (Host Record may be missing these entries):", error);
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
      const row = { employee_id: employeeId, plan_date: date, mission_id: target.missionId || null, zone: target.zone || null };
      const updatedBy = await this._currentEmail();
      let { error } = await sb.from("assignments").upsert({ ...row, updated_by: updatedBy }, { onConflict: "employee_id,plan_date" });
      if (error && this._missingColumnFromError(error) === "updated_by") {
        ({ error } = await sb.from("assignments").upsert(row, { onConflict: "employee_id,plan_date" }));
      }
      if (error) throw error;
      if (target.missionId) await this._writeDeploymentHistory(employeeId, date, target.missionId);
    }
    this._invalidatePlans();
  },

  /* ---------- deployment_history writer (see migration-2026-08-31) ---------- */
  /* Snapshots a mission's host/number/customer as plain text at the moment an
     employee is assigned to it — the whole point is that this record must
     survive the mission later being hidden or deleted, so it can't be a
     foreign key. Reads the mission from the in-memory plan cache when it's
     already there (the common case: you can only assign someone to a mission
     that's rendered on screen) to avoid an extra round trip; falls back to a
     direct lookup otherwise. Never throws — an audit-log write must not block
     or error out the actual assignment, including on a DB that hasn't run the
     migration yet (relation-does-not-exist), so failures are just logged. */
  async _writeDeploymentHistory(employeeId, date, missionId) {
    try {
      const emp = this.data.employees.find((e) => e.id === employeeId);
      let boardId = emp && emp.boardId;
      const cachedPlan = boardId && this.data.plans[boardId] && this.data.plans[boardId][date];
      let mission = cachedPlan && cachedPlan.missions.find((m) => m.id === missionId);
      if (!mission) {
        const { data } = await sb.from("missions").select("number, host, customer, board_id").eq("id", missionId).maybeSingle();
        if (!data) return;   // mission vanished between the assignment write and this lookup
        mission = data;
        boardId = boardId || data.board_id;
      }
      const { error } = await sb.from("deployment_history").upsert({
        employee_id: employeeId, plan_date: date, mission_number: mission.number,
        host: mission.host, customer: mission.customer, board_id: boardId,
      }, { onConflict: "employee_id,plan_date" });
      if (error) console.error("deployment_history write failed (Host Record may be missing this entry):", error);
    } catch (e) {
      console.error("deployment_history write failed (Host Record may be missing this entry):", e);
    }
  },

  /* Postgres unique_violation (23505) on missions_unique_number_shift → a friendlier message */
  _friendlyMissionError(error) {
    if (error && error.code === "23505") {
      return new Error("A mission with this number already exists on this shift for this date. Use a different shift, or edit the existing mission instead.");
    }
    return error;
  },

  async saveMission(boardId, date, missionId, vals) {
    const updatedBy = await this._currentEmail();
    let row = {
      number: vals.number, host: vals.host, customer: vals.customer, shift: vals.shift,
      start_time: vals.startTime, end_time: vals.endTime, engineer_id: vals.engineerId,
      ppe: vals.ppe || null, remark: vals.remark || null,
      updated_at: new Date().toISOString(), updated_by: updatedBy,
    };
    const attempt = (r) => missionId
      ? sb.from("missions").update(r).eq("id", missionId)
      : sb.from("missions").insert({ ...r, board_id: boardId, plan_date: date });
    // remark and updated_by are both optional (migrations that may not have
    // run yet) — shed whichever column Postgres reports missing and retry,
    // same guarded pattern as _upsertMissionsGuarded, so saves still work
    // either way
    let error;
    for (let i = 0; i < 3; i++) {
      ({ error } = await attempt(row));
      if (!error) break;
      const missingCol = this._missingColumnFromError(error);
      if (!missingCol || !(missingCol in row)) break;
      const { [missingCol]: _drop, ...rest } = row;
      row = rest;
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
    const updatedBy = await this._currentEmail();
    let { error } = await sb.from("missions").update({ hidden, updated_by: updatedBy }).in("id", missionIds);
    if (error && this._missingColumnFromError(error) === "updated_by") {
      ({ error } = await sb.from("missions").update({ hidden }).in("id", missionIds));
    }
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
  /* The single way an employee goes on/off the roster — the Manpower List's
     Status column, the right-click menu and the Edit Employee modal all land
     here. Flips `active` rather than deleting the row: a hard DELETE cascades
     (assignments.employee_id references employees(id) on delete cascade —
     schema.sql) and silently wipes every past mission/zone assignment for that
     person, which is exactly the "rewrites finished plans" problem this
     exists to avoid.

     There is deliberately no pre-migration fallback. The earlier archive
     helpers (removed) fell back to that hard DELETE when the `active` column was
     missing, which meant the one path that was supposed to protect history
     could destroy it instead. Failing with a clear "run the migration"
     message is strictly better than silently doing the destructive thing. */
  async setEmployeesActive(ids, active) {
    if (!ids.length) return;
    const { error } = await sb.from("employees").update({ active }).in("id", ids);
    if (error) {
      if (this._missingColumnFromError(error) === "active") {
        throw new Error('Run supabase/migration-2026-08-23-employee-active.sql in the Supabase SQL editor to use Active/Inactive.');
      }
      throw error;
    }
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

  /* ---------- daily stats range (Overview Trend + History charts) ---------- */
  /* Two bulk queries (not one per day) covering `boardIds` over
     [fromDate, toDate] inclusive. Returns { [boardId]: { [date]: { assigned,
     leave, headcount, oncallAssigned, oncallLeave, oncallHeadcount,
     staffedMissions, byEngineer } } } with
     an entry for EVERY calendar date in range — working day, weekend, and
     holiday alike. Different charts need different subsets of dates (the
     utilization trend skips non-working days; the on-call availability trend
     skips only each board's weekly weekend, deliberately keeping holidays —
     see renderOverview() in app.js), so the "which dates count" decision is
     made by each chart at render time, not baked in here.
     `staffedMissions` counts the missions on that board+date that have at
     least one (active, non-hidden) person on them, and `byEngineer` breaks
     those same missions down as { [engineerId|""]: { missions, crew } } —
     "" being missions with no engineer set. Both feed the History charts;
     an EMPTY mission counts for neither, since "a mission nobody was sent
     to" is not deployment.
     Caveats (surfaced in the UI, not hidden here): headcount/oncallHeadcount
     use each employee's CURRENT board membership for the whole window - board
     moves aren't tracked historically - and hidden missions on that date are
     excluded from `assigned`/`oncallAssigned`, matching what the board
     itself shows today. `byEngineer` is the one genuinely historical
     dimension in here: engineer_id lives on the mission row for that date,
     so it is who actually ran the job, not who runs it now. */
  async getUtilizationRange(boardIds, fromDate, toDate) {
    if (!boardIds.length) return {};
    const [missionRows, assignRows] = await Promise.all([
      fetchAllPages(() => sb.from("missions").select("id, board_id, plan_date, hidden, engineer_id")
        .in("board_id", boardIds).gte("plan_date", fromDate).lte("plan_date", toDate)),
      fetchAllPages(() => sb.from("assignments").select("employee_id, plan_date, mission_id, zone")
        .gte("plan_date", fromDate).lte("plan_date", toDate)),
    ]);

    const missionBoard = new Map();      // mission id -> board id
    const missionDate = new Map();       // mission id -> plan date
    const missionEngineer = new Map();   // mission id -> engineer id ("" = none set)
    const missionHidden = new Set();     // mission ids that are hidden on their date
    for (const m of missionRows) {
      missionBoard.set(m.id, m.board_id);
      missionDate.set(m.id, m.plan_date);
      missionEngineer.set(m.id, m.engineer_id || "");
      if (m.hidden) missionHidden.add(m.id);
    }
    // A deactivated employee drops out of "today"'s figures everywhere else
    // on the board (onRoster() in app.js: showsDeactivated() || active !==
    // false — a PAST date is a record of who was actually there, so it keeps
    // showing them). This trend is one static current-roster snapshot for
    // the whole window (already true of board membership below), so it can
    // only approximate that per-date rule with one flag keyed on `toDate`,
    // the window's end — but leaving inactive employees in unconditionally
    // inflated the headcount denominator for every "today" trend point
    // relative to the KPI/By-board figures for that same date.
    const includeInactive = toDate < todayStrISO();
    const activeEmpIds = includeInactive ? null : new Set(this.data.employees.filter((e) => e.active !== false).map((e) => e.id));
    const isActiveEmp = (id) => includeInactive || activeEmpIds.has(id);
    const empBoard = new Map(this.data.employees.map((e) => [e.id, e.boardId]));
    const empContract = new Map(this.data.employees.map((e) => [e.id, e.contract]));
    const headcountByBoard = {};
    const oncallHeadcountByBoard = {};
    for (const id of boardIds) {
      const emps = this.data.employees.filter((e) => e.boardId === id && isActiveEmp(e.id));
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
          staffedMissions: 0, byEngineer: {},
        };
      }
    }
    for (const a of assignRows) {
      if (!isActiveEmp(a.employee_id)) continue;   // keep the numerator consistent with the headcount denominator above
      const isOncall = empContract.get(a.employee_id) === "oncall";
      if (a.mission_id) {
        // Bucket by the MISSION's own board, not the employee's current one —
        // a mission that ran on Rayong on this date belongs to Rayong's trend
        // regardless of which board the employee is on today. Using the
        // employee's current board here used to require the two to match and
        // silently dropped the assignment otherwise ("employee has since
        // moved boards"), which could zero out an entire board's trend if
        // its whole current roster had since been reassigned.
        if (missionHidden.has(a.mission_id)) continue;
        const boardId = missionBoard.get(a.mission_id);
        const bucket = boardId && result[boardId] && result[boardId][a.plan_date];
        if (!bucket) continue;
        bucket.assigned++;
        if (isOncall) bucket.oncallAssigned++;
      } else if (a.zone && ZONES.includes(a.zone)) {
        // A leave/zone entry isn't tied to a mission, so its board can only
        // come from the employee's CURRENT board membership (same caveat as
        // headcount above — board moves aren't tracked historically here).
        const boardId = empBoard.get(a.employee_id);
        const bucket = boardId && result[boardId] && result[boardId][a.plan_date];
        if (!bucket) continue;
        bucket.leave++;
        if (isOncall) bucket.oncallLeave++;
      }
    }

    /* Second pass, per MISSION rather than per person: how many missions
       actually had someone on them, and how that splits by responsible
       engineer. Counted here and not in the loop above because the unit is
       the mission — incrementing per assignment would count a 5-person
       mission five times. A mission row is one card on one board on one
       date, so a mission NUMBER that runs both a day and a night shift is
       two missions here, exactly as the board and the single-day "By
       engineer" table already show it. */
    const crewByMission = new Map();
    for (const a of assignRows) {
      if (!a.mission_id || !isActiveEmp(a.employee_id)) continue;
      if (missionHidden.has(a.mission_id)) continue;
      crewByMission.set(a.mission_id, (crewByMission.get(a.mission_id) || 0) + 1);
    }
    for (const [missionId, crew] of crewByMission) {
      const boardId = missionBoard.get(missionId);
      const bucket = boardId && result[boardId] && result[boardId][missionDate.get(missionId)];
      if (!bucket) continue;
      bucket.staffedMissions++;
      const engId = missionEngineer.get(missionId) || "";
      const rec = bucket.byEngineer[engId] || (bucket.byEngineer[engId] = { missions: 0, crew: 0 });
      rec.missions++;
      rec.crew += crew;
    }
    return result;
  },

  /* ---------- per-employee utilization (Manpower List's 30D column) ---------- */
  /* Same two bulk queries as getUtilizationRange, bucketed by employee instead
     of by board. Returns { [employeeId]: { workedDates:Set, leaveDates:Set } }
     — raw date sets, not a percentage, because the denominator is each
     employee's own board's working days, and only app.js knows the weekend /
     holiday rules. A hidden mission doesn't count as work; that's the only
     exclusion — this is per-employee, so unlike getUtilizationRange there's
     no board-level headcount denominator that active status could throw off. */
  async getEmployeeUtilization(fromDate, toDate) {
    const [missionRows, assignRows] = await Promise.all([
      fetchAllPages(() => sb.from("missions").select("id, plan_date, hidden")
        .gte("plan_date", fromDate).lte("plan_date", toDate)),
      fetchAllPages(() => sb.from("assignments").select("employee_id, plan_date, mission_id, zone")
        .gte("plan_date", fromDate).lte("plan_date", toDate)),
    ]);

    const missionHidden = new Set();
    for (const m of missionRows) if (m.hidden) missionHidden.add(m.id);
    const empBoard = new Map(this.data.employees.map((e) => [e.id, e.boardId]));

    const out = {};
    const rec = (id) => (out[id] = out[id] || { workedDates: new Set(), leaveDates: new Set() });
    for (const a of assignRows) {
      if (!empBoard.has(a.employee_id)) continue;   // employee record no longer exists at all
      if (a.mission_id) {
        // A mission worked is a mission worked, whichever board the employee
        // is on today — same fix as getUtilizationRange above (see its
        // comment): cross-checking against their CURRENT board here used to
        // silently drop the day from workedDates for anyone who's since
        // moved boards, undercounting exactly the person this 30D column
        // exists to show.
        if (missionHidden.has(a.mission_id)) continue;
        rec(a.employee_id).workedDates.add(a.plan_date);
      } else if (a.zone && ZONES.includes(a.zone)) {
        rec(a.employee_id).leaveDates.add(a.plan_date);
      }
    }
    return out;
  },

  /* ---------- per-employee host history (Manpower List's Host Record tab) ---------- */
  /* Reads deployment_history (migration-2026-08-31), not assignments/missions
     directly — a hidden mission deletes its assignment rows outright (see
     setMissionsHidden) and a deleted mission cascades the same way, so a live
     join would lose exactly the history this tab exists to preserve.
     deployment_history is written once per (employee, date) the moment an
     assignment is made (see _writeDeploymentHistory / _copyPlanForward) and
     never deleted by the board's normal hide/unassign/delete flows. Not
     date-bounded like the 30D util figure — this answers "which hosts has
     this person ever worked". Degrades to an empty history (instead of
     throwing) on a database that hasn't run the migration yet, so the tab
     reads "No mission history yet." rather than a raw Postgres error. */
  async getEmployeeHostHistory(employeeId) {
    const { data, error } = await sb.from("deployment_history")
      .select("plan_date, mission_number, host, customer")
      .eq("employee_id", employeeId)
      .order("plan_date", { ascending: false });
    if (error) {
      if (this._tableMissing(error)) return [];
      throw error;
    }
    return (data || []).map((r) => ({ date: r.plan_date, host: r.host, number: r.mission_number, customer: r.customer }));
  },

  /* ---------- host coverage (Overview's "Host coverage risk" module) ---------- */
  /* The inverse of getEmployeeHostHistory: for each host in the given list,
     how many distinct employees have ever been deployed there, and who (up to
     2 names — enough to answer "who do I ask", not a full roster). Reads the
     same deployment_history rows, grouped by host instead of by employee.
     Degrades to an empty coverage map (not an error) pre-migration, same as
     getEmployeeHostHistory. */
  async getHostCoverageForHosts(hosts) {
    if (!hosts || !hosts.length) return {};
    let data;
    try {
      data = await fetchAllPages(() => sb.from("deployment_history")
        .select("host, employee_id")
        .in("host", hosts));
    } catch (error) {
      if (this._tableMissing(error)) return {};
      throw error;
    }
    const setsByHost = {};
    for (const row of data || []) {
      (setsByHost[row.host] || (setsByHost[row.host] = new Set())).add(row.employee_id);
    }
    const nameOf = new Map(this.data.employees.map((e) => [e.id, e.name]));
    const out = {};
    for (const host of hosts) {
      const ids = setsByHost[host];
      if (!ids) { out[host] = { count: 0, names: [] }; continue; }
      out[host] = { count: ids.size, names: [...ids].map((id) => nameOf.get(id)).filter(Boolean).slice(0, 2) };
    }
    return out;
  },

  /* Resolve {boardId, planDate, updatedBy} from a missions/assignments
     realtime payload — app.js compares updatedBy to the viewing user's own
     email, and boardId+planDate to what's currently on screen, to decide
     whether to toast "changed by someone else". missions rows carry board_id
     directly; assignments rows don't (schema.sql), so resolve it via the
     employee cache instead. Pre-migration (no updated_by column yet) every
     row.updated_by is simply undefined, so this returns null and nothing
     toasts — same silent-refetch behavior as before this feature existed.
     DELETE payloads only carry the primary key by default (no table here has
     REPLICA IDENTITY FULL), so a deleted row can't be attributed — also null. */
  _attributionFromPayload(payload) {
    const row = payload && payload.new;
    if (!row || !row.updated_by) return null;
    const boardId = row.board_id || (this.data.employees.find((e) => e.id === row.employee_id) || {}).boardId;
    return boardId ? { boardId, planDate: row.plan_date, updatedBy: row.updated_by } : null;
  },

  /* ---------- realtime ---------- */
  _subscribeRealtime() {
    // Drop all cached plans on any missions/assignments change — app.js's own
    // onChange handler reloads exactly what the current view needs before redrawing.
    const refreshPlanAndNotify = async (payload) => {
      this.data.plans = {};
      this.notify(this._attributionFromPayload(payload));
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
