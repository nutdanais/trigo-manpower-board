/* Forward-planning logic with no DOM and no database: the plan diff behind
   "Review changes" / "Review & merge", the confirm horizon, and the Capacity
   tab's arithmetic. Kept pure so the same code runs in the browser and in the
   node tests (tests/*.test.js). Loaded before app.js; defines PlanDiff,
   Horizon and Capacity. */

"use strict";

(function (root) {
  const LEAVE_ZONE_KEYS = ["annual", "sick", "business", "unpaid", "exchange"];

  function addDaysISO(iso, n) {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /* ================= PlanDiff =================
     Compares two versions of one board's day — `base` (what the day holds now)
     and `proposed` (a fresh carry preview, or a forecast) — and lists the
     differences as items a planner can tick one by one. Both plans have the
     shape cloud.ensurePlanLoaded returns: { missions: [{id, number, shift,
     host, customer, startTime, endTime, engineerId, ppe, remark, hidden,
     members: [empId]}], zones: {annual: [empId], ...} }.

     Missions are matched by number + shift, exactly as the carry-over itself
     matches them (ids differ from day to day). */

  const MISSION_FIELDS = [
    { key: "host", label: "Host" },
    { key: "customer", label: "Customer" },
    { key: "startTime", label: "Start" },
    { key: "endTime", label: "End" },
    { key: "engineerId", label: "Engineer" },
    { key: "ppe", label: "PPE" },
    { key: "remark", label: "Remark" },
  ];

  const missionKey = (m) => m.number + "|" + m.shift;
  const norm = (v) => (v == null ? "" : String(v).trim());

  /* where each in-scope employee sits in a plan: a mission (by key), a leave
     zone, or standby (not stored anywhere) */
  function placements(plan, scope) {
    const out = new Map();
    for (const m of plan.missions || []) {
      for (const id of m.members || []) {
        if (scope && !scope.has(id)) continue;
        if (!out.has(id)) out.set(id, { kind: "mission", key: missionKey(m) });
      }
    }
    for (const z of LEAVE_ZONE_KEYS) {
      for (const id of ((plan.zones || {})[z] || [])) {
        if (scope && !scope.has(id)) continue;
        if (!out.has(id)) out.set(id, { kind: "zone", zone: z });
      }
    }
    return out;
  }
  const STANDBY = Object.freeze({ kind: "standby" });
  const samePlace = (a, b) =>
    a.kind === b.kind && (a.kind === "standby" || (a.kind === "mission" ? a.key === b.key : a.zone === b.zone));

  /* opts.employeeIds: the people this diff may touch (a board's active
     roster). Anyone outside it is ignored on both sides. */
  function compute(base, proposed, opts = {}) {
    const scope = opts.employeeIds ? new Set(opts.employeeIds) : null;
    const baseByKey = new Map((base.missions || []).map((m) => [missionKey(m), m]));
    const propByKey = new Map((proposed.missions || []).map((m) => [missionKey(m), m]));
    const items = [];
    const added = new Set();

    for (const [key, pm] of propByKey) {
      const bm = baseByKey.get(key);
      if (!bm) {
        // a hidden mission is a dormant copy — nothing to add to a board
        if (pm.hidden) continue;
        added.add(key);
        items.push({ id: "add:" + key, type: "add", key, mission: pm, members: [], ticked: true });
        continue;
      }
      if (pm.hidden) continue;
      const changes = [];
      for (const f of MISSION_FIELDS) {
        if (norm(bm[f.key]) !== norm(pm[f.key])) changes.push({ field: f.key, label: f.label, before: bm[f.key] ?? "", after: pm[f.key] ?? "" });
      }
      if (bm.hidden) changes.push({ field: "hidden", label: "Visibility", before: "Hidden", after: "Visible" });
      if (changes.length) {
        items.push({ id: "update:" + key, type: "update", key, baseId: bm.id, mission: pm, baseMission: bm, changes, ticked: false });
      }
    }
    for (const [key, bm] of baseByKey) {
      if (propByKey.has(key) || bm.hidden) continue;
      // unticked: the planner may have added it on purpose
      items.push({ id: "remove:" + key, type: "remove", key, baseId: bm.id, mission: bm, ticked: false });
    }

    const bPlace = placements(base, scope);
    const pPlace = placements(proposed, scope);
    const everyone = new Set([...bPlace.keys(), ...pPlace.keys()]);
    const addItemByKey = new Map(items.filter((i) => i.type === "add").map((i) => [i.key, i]));
    for (const empId of everyone) {
      const from = bPlace.get(empId) || STANDBY;
      const to = pPlace.get(empId) || STANDBY;
      if (samePlace(from, to)) continue;
      if (to.kind === "mission" && added.has(to.key)) {
        addItemByKey.get(to.key).members.push({ empId, from });
      } else if (to.kind === "zone") {
        items.push({ id: "leave:" + empId, type: "leave", empId, from, to, ticked: true });
      } else {
        items.push({ id: "move:" + empId, type: "move", empId, from, to, ticked: false });
      }
    }
    return { items, baseByKey, proposedByKey: propByKey };
  }

  /* For the review panel: one group per mission (in mission-number order),
     then leave, then standby. A move or leave item sits under where the
     person is GOING, which is the question the planner is answering. */
  function groups(diff) {
    const byGroup = new Map();
    const put = (gkey, item) => { if (!byGroup.has(gkey)) byGroup.set(gkey, []); byGroup.get(gkey).push(item); };
    for (const it of diff.items) {
      if (it.type === "add" || it.type === "update" || it.type === "remove") put("m:" + it.key, it);
      else if (it.to.kind === "mission") put("m:" + it.to.key, it);
      else if (it.to.kind === "zone") put("z:leave", it);
      else put("z:standby", it);
    }
    const missionOf = (key) => diff.proposedByKey.get(key) || diff.baseByKey.get(key);
    const out = [];
    const missionKeys = [...byGroup.keys()].filter((k) => k.startsWith("m:")).map((k) => k.slice(2));
    missionKeys.sort((a, b) => {
      const ma = missionOf(a), mb = missionOf(b);
      return String(ma.number).localeCompare(String(mb.number), undefined, { numeric: true }) || String(ma.shift).localeCompare(String(mb.shift));
    });
    for (const k of missionKeys) out.push({ id: "m:" + k, kind: "mission", mission: missionOf(k), items: byGroup.get("m:" + k) });
    if (byGroup.has("z:leave")) out.push({ id: "z:leave", kind: "leave", items: byGroup.get("z:leave") });
    if (byGroup.has("z:standby")) out.push({ id: "z:standby", kind: "standby", items: byGroup.get("z:standby") });
    return out;
  }

  /* Each ticked item becomes a list of writes. The order matters: missions are
     created before anyone is placed on them, and removals go last so a person
     moved OUT of a mission that is being removed has already left it. */
  function plan(diff) {
    const ticked = diff.items.filter((i) => i.ticked);
    return {
      adds: ticked.filter((i) => i.type === "add"),
      updates: ticked.filter((i) => i.type === "update"),
      placements: ticked.filter((i) => i.type === "move" || i.type === "leave"),
      removes: ticked.filter((i) => i.type === "remove"),
      count: ticked.length,
    };
  }

  const PlanDiff = { compute, groups, plan, missionKey, MISSION_FIELDS, STANDBY };

  /* ================= Horizon =================
     A confirmed plan exists up to the Nth next working day (N = 1: tomorrow,
     or Monday from a Friday). Every date after that is forecast. Past dates,
     today and non-working days in between stay confirmed as they always were. */
  function horizonEnd(today, isNonWorking, n = 1) {
    let d = today;
    let found = 0;
    // a board that never works would loop forever; 60 days is far past any holiday
    for (let i = 0; i < 60 && found < n; i++) {
      d = addDaysISO(d, 1);
      if (!isNonWorking(d)) found++;
    }
    return d;
  }
  const Horizon = { end: horizonEnd, N: 1 };

  /* ================= Capacity =================
     Everything the Capacity grid shows is derived here from raw rows, so the
     numbers can be tested without a browser. */

  /* ISO week, Monday first: the Sunday that closes the week `iso` is in */
  function weekEnd(iso) {
    const dow = new Date(iso + "T00:00:00").getDay();   // 0 = Sun
    return addDaysISO(iso, dow === 0 ? 0 : 7 - dow);
  }
  function weekStart(iso) {
    const dow = new Date(iso + "T00:00:00").getDay();
    return addDaysISO(iso, dow === 0 ? -6 : 1 - dow);
  }

  /* inputs:
       boards      [{id}]
       employees   [{id, boardId, contract, active}]
       dates       [iso]
       isForecast  (boardId, date) -> bool — beyond that board's horizon
       confirmed   { assignments: [{employee_id, plan_date, mission_id, zone}],
                     missions:    [{id, board_id, hidden}] }
       forecast    { assignments: [{employee_id, plan_date, forecast_mission_id, zone}],
                     missions:    [{id, board_id}] }
     returns { [boardId]: { [date]: { headPerm, headOncall, leavePerm,
       leaveOncall, availPerm, availOncall, available, named } } }

     Available is the CURRENT roster minus leave — future hires and exits are
     not known here (the UI says so). Leave and "named" come from confirmed
     rows up to a board's horizon and from forecast rows after it. */
  function aggregate({ boards, employees, dates, isForecast, confirmed, forecast }) {
    const active = employees.filter((e) => e.active !== false);
    const empById = new Map(active.map((e) => [e.id, e]));
    const out = {};
    for (const b of boards) {
      const emps = active.filter((e) => e.boardId === b.id);
      const headPerm = emps.filter((e) => e.contract !== "oncall").length;
      const headOncall = emps.length - headPerm;
      out[b.id] = {};
      for (const d of dates) {
        out[b.id][d] = { headPerm, headOncall, leavePerm: 0, leaveOncall: 0, availPerm: headPerm, availOncall: headOncall, available: headPerm + headOncall, named: 0, _named: new Set() };
      }
    }
    const cMissions = new Map(((confirmed && confirmed.missions) || []).map((m) => [m.id, m]));
    const fMissions = new Map(((forecast && forecast.missions) || []).map((m) => [m.id, m]));
    const tally = (rows, missionField, missions, wantForecast) => {
      for (const a of rows || []) {
        const e = empById.get(a.employee_id);
        if (!e) continue;
        const cell = out[e.boardId] && out[e.boardId][a.plan_date];
        if (!cell) continue;
        if (!!isForecast(e.boardId, a.plan_date) !== wantForecast) continue;
        if (a.zone && LEAVE_ZONE_KEYS.includes(a.zone)) {
          if (e.contract === "oncall") cell.leaveOncall++; else cell.leavePerm++;
        } else if (a[missionField]) {
          const m = missions.get(a[missionField]);
          if (!m || m.hidden || m.board_id !== e.boardId) continue;
          cell._named.add(a.employee_id);
        }
      }
    };
    tally(confirmed && confirmed.assignments, "mission_id", cMissions, false);
    tally(forecast && forecast.assignments, "forecast_mission_id", fMissions, true);
    for (const b of Object.keys(out)) {
      for (const d of Object.keys(out[b])) {
        const c = out[b][d];
        c.availPerm = Math.max(0, c.headPerm - c.leavePerm);
        c.availOncall = Math.max(0, c.headOncall - c.leaveOncall);
        c.available = c.availPerm + c.availOncall;
        c.named = c._named.size;
        delete c._named;
      }
    }
    return out;
  }

  /* demand rows -> { [boardId]: { [date]: total } } */
  function demandTotals(rows) {
    const out = {};
    for (const r of rows || []) {
      const b = out[r.board_id] || (out[r.board_id] = {});
      b[r.plan_date] = (b[r.plan_date] || 0) + (Number(r.headcount) || 0);
    }
    return out;
  }

  /* The dates "Fill right to end of week" writes: every date after `date` up
     to that week's Sunday, restricted to the ones on the grid and working for
     the board. */
  function fillRightDates(date, gridDates, isWorking) {
    const end = weekEnd(date);
    return gridDates.filter((d) => d > date && d <= end && isWorking(d));
  }

  const Capacity = { aggregate, demandTotals, fillRightDates, weekStart, weekEnd };

  const api = { PlanDiff, Horizon, Capacity };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(globalThis);
