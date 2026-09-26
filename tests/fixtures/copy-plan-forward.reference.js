/* The carry-over write path exactly as it was on main (commit 816e077), before
   it was split into buildCarryPreview / applyCarry. Frozen here so
   tests/carry-parity.test.js can hold the new code to producing the same rows.
   Do not "fix" or modernise this file — its only job is to stay the old code.
   Installed onto a loaded cloud object as cloud._referenceCopyPlanForward;
   `sb` is that cloud's client. */
module.exports = function install(cloud, sb) {
  const methods = {
    async _referenceCopyPlanForward(boardId, srcDate, destDate) {
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
  };
  Object.assign(cloud, methods);
};
