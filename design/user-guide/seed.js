/* Sample data for the user-guide screenshots. Every person, site, customer and
   phone number here is invented; nothing comes from the live database. Dates are
   worked out from the day the script runs, so the board always opens on a
   planned "next working day" with about a month of history behind it. */
"use strict";

const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const isWeekend = (s) => [0, 6].includes(new Date(s + "T00:00:00").getDay());
const nextWorking = (s) => { let d = addDays(s, 1); while (isWeekend(d)) d = addDays(d, 1); return d; };
const prevWorking = (s) => { let d = addDays(s, -1); while (isWeekend(d)) d = addDays(d, -1); return d; };

const TODAY = iso(new Date());
const NEXT = nextWorking(TODAY);          // the confirmed day the board opens on
const FORECAST = nextWorking(NEXT);       // first forecast day

const AREAS = [
  { id: "a-insp", name: "Inspection", color: "#7fb8ec" },
  { id: "a-rework", name: "Rework", color: "#f6a06b" },
  { id: "a-sort", name: "Sorting", color: "#a8d98a" },
  { id: "a-res", name: "Resident", color: "#c9a0e8" },
];

const BOARDS = [
  { id: "b1", name: "Rayong", weekend_days: [0, 6] },
  { id: "b2", name: "Chonburi", weekend_days: [0, 6] },
  { id: "b3", name: "Ayutthaya", weekend_days: [0, 6] },
];

const maps = (q) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
const HOSTS = [
  { name: "Siam Auto Parts", location: "Pluak Daeng, Rayong", area_id: "a-insp", note: "Gate 2, ask for the QC office" },
  { name: "Rayong Precision", location: "Nikhom Phatthana, Rayong", area_id: "a-rework", note: "Safety shoes and glasses" },
  { name: "Eastern Seaboard Motors", location: "Pluak Daeng, Rayong", area_id: "a-insp", note: "" },
  { name: "Pluak Daeng Plastics", location: "Pluak Daeng, Rayong", area_id: "a-sort", note: "Badge at main gate" },
  { name: "Map Ta Phut Steel", location: "Map Ta Phut, Rayong", area_id: "a-rework", note: "" },
  { name: "Laem Chabang Logistics", location: "Laem Chabang, Chonburi", area_id: "a-sort", note: "Warehouse 4" },
  { name: "Amata Components", location: "Amata City, Chonburi", area_id: "a-res", note: "Resident office, 2nd floor" },
  { name: "Bowin Glass", location: "Bowin, Chonburi", area_id: "a-insp", note: "" },
  { name: "Rojana Electronics", location: "Rojana, Ayutthaya", area_id: "a-insp", note: "ESD smock provided" },
  { name: "Hi-Tech Bearings", location: "", area_id: "", note: "" },   // no location yet: shows in the Host list as missing one
].map((h, i) => ({ id: "h" + (i + 1), ...h, map_url: h.location ? maps(h.name + " " + h.location) : "", archived: false }));

/* first, last (Thai) · first, last (English) */
const NAMES = [
  ["สมชาย", "ใจดี", "Somchai", "Jaidee"], ["กิตติพงษ์", "วงศ์ใหญ่", "Kittipong", "Wongyai"], ["พิมพ์ชนก", "รักไทย", "Pimchanok", "Rakthai"],
  ["ณัฐพล", "ศรีสุข", "Nattapon", "Srisuk"], ["วรรณา", "ทองดี", "Wanna", "Thongdee"], ["อนุชา", "แก้วมณี", "Anucha", "Kaewmanee"],
  ["ธนากร", "บุญมา", "Thanakorn", "Boonma"], ["สุภาพร", "มีสุข", "Supaporn", "Meesuk"], ["ประเสริฐ", "ชัยวัฒน์", "Prasert", "Chaiwat"],
  ["จิราพร", "สายทอง", "Jiraporn", "Saithong"], ["วีระ", "พรหมมา", "Weera", "Promma"], ["ศิริพร", "นาคสวัสดิ์", "Siriporn", "Naksawat"],
  ["ชัยวัฒน์", "ทองคำ", "Chaiwat", "Thongkham"], ["นภัสสร", "อินทร์แก้ว", "Napatsorn", "Inkaew"], ["เอกชัย", "ปัญญา", "Ekkachai", "Panya"],
  ["อรุณี", "ศรีวงศ์", "Arunee", "Sriwong"], ["สุรชัย", "มั่นคง", "Surachai", "Mankong"], ["กาญจนา", "เพชรรัตน์", "Kanjana", "Petcharat"],
  ["ภานุวัฒน์", "สมบูรณ์", "Panuwat", "Somboon"], ["ดวงใจ", "วิเศษ", "Duangjai", "Wiset"], ["ธีรวัฒน์", "จันทร์เพ็ญ", "Teerawat", "Janpen"],
  ["ปิยะนุช", "แสงทอง", "Piyanuch", "Saengthong"], ["อภิชาติ", "ใจงาม", "Apichat", "Jaingam"], ["รัตนา", "บุญเรือง", "Rattana", "Boonruang"],
  ["สมศักดิ์", "พึ่งบุญ", "Somsak", "Puengboon"], ["มาลี", "ศักดิ์ดี", "Malee", "Sakdee"], ["วิทยา", "คงเจริญ", "Wittaya", "Kongcharoen"],
  ["ลัดดา", "ทองมา", "Ladda", "Thongma"], ["ชาญชัย", "รุ่งเรือง", "Chanchai", "Rungruang"], ["นันทนา", "สุขใจ", "Nantana", "Sukjai"],
  ["พงศกร", "ธนพัฒน์", "Pongsakorn", "Thanapat"], ["สุนิสา", "ดีมาก", "Sunisa", "Deemak"], ["บุญชัย", "อ่อนศรี", "Boonchai", "Onsri"],
  ["ทิพวรรณ", "เรืองศรี", "Tippawan", "Ruangsri"], ["อดิศร", "กล้าหาญ", "Adisorn", "Klahan"], ["เพ็ญศรี", "มณีวงศ์", "Pensri", "Maneewong"],
  ["สมพงษ์", "ศรีทอง", "Sompong", "Srithong"], ["กนกวรรณ", "แสนดี", "Kanokwan", "Saendee"], ["ไพโรจน์", "บัวทอง", "Pairoj", "Buathong"],
  ["อัญชลี", "วงศ์สวัสดิ์", "Anchalee", "Wongsawat"], ["สมหญิง", "ทองแท้", "Somying", "Thongtae"], ["เกียรติศักดิ์", "ใจเย็น", "Kiattisak", "Jaiyen"],
];

/* who sits on which board, and which of them are on call */
const ROSTER = { b1: 26, b2: 10, b3: 6 };
const ONCALL = { b1: 4, b2: 1, b3: 1 };
const AREA_CYCLE = ["a-insp", "a-insp", "a-rework", "a-sort", "a-res"];

function employees() {
  const out = [];
  let n = 0;
  for (const b of BOARDS) {
    for (let i = 0; i < ROSTER[b.id]; i++) {
      const [th1, th2, en1, en2] = NAMES[n];
      const oncall = i >= ROSTER[b.id] - ONCALL[b.id];
      const years = (n * 7) % 9;
      out.push({
        id: "e" + (n + 1), name_th: th1 + " " + th2, name_en: en1 + " " + en2, trigo_id: "T" + (210 + n * 3),
        contract: oncall ? "oncall" : "permanent", position: oncall ? "" : (i % 7 === 0 ? "Team Leader" : "Inspector"),
        phone: "080-555-" + String(1000 + n * 17).slice(-4), start_date: years ? `${2026 - years}-0${(n % 9) + 1}-15` : null,
        area_id: AREA_CYCLE[n % AREA_CYCLE.length], board_id: b.id, active: true,
      });
      n++;
    }
  }
  return out;
}

const ME = { id: "00000000-0000-0000-0000-0000000000a1", email: "nattaya.s@trigo-group.com", role: "admin" };
const PROFILES = [
  { id: ME.id, email: ME.email, full_name: "Nattaya Suwan", display_name: "Nattaya.S", role_key: "admin", phone: "080-555-0100" },
  { id: "00000000-0000-0000-0000-0000000000b1", email: "somchai.p@trigo-group.com", full_name: "Somchai Prasert", display_name: "Somchai.P", role_key: "engineer", phone: "080-555-0111" },
  { id: "00000000-0000-0000-0000-0000000000b2", email: "kittipong.w@trigo-group.com", full_name: "Kittipong Wattana", display_name: "Kittipong.W", role_key: "engineer", phone: "080-555-0122" },
  { id: "00000000-0000-0000-0000-0000000000b3", email: "pimchanok.r@trigo-group.com", full_name: "Pimchanok Ruang", display_name: "Pimchanok.R", role_key: "engineer", phone: "080-555-0133" },
  { id: "00000000-0000-0000-0000-0000000000c1", email: "wichai.k@trigo-group.com", full_name: "Wichai Kanha", display_name: "Wichai.K", role_key: "manager", phone: "" },
  { id: "00000000-0000-0000-0000-0000000000d1", email: "suda.m@trigo-group.com", full_name: "Suda Mekin", display_name: "Suda.M", role_key: "viewer", phone: "" },
].map((p) => ({ ...p, status: "active", last_seen_at: new Date(Date.now() - 3600e3).toISOString() }));
const PENDING = [
  { id: "00000000-0000-0000-0000-0000000000e1", email: "arthit.c@trigo-group.com", full_name: "Arthit Chaiyo", display_name: "Arthit.C", role_key: "engineer", status: "pending", requested_at: new Date(Date.now() - 2 * 3600e3).toISOString() },
  { id: "00000000-0000-0000-0000-0000000000e2", email: "kanya.t@trigo-group.com", full_name: "Kanya Thong", display_name: "Kanya.T", role_key: "engineer", status: "pending", requested_at: new Date(Date.now() - 26 * 3600e3).toISOString() },
];
const ENGINEERS = [
  { id: "eng-1", name: "Somchai.P", phone: "080-555-0111", color: "#2a78d6", profile_id: PROFILES[1].id },
  { id: "eng-2", name: "Kittipong.W", phone: "080-555-0122", color: "#e07b39", profile_id: PROFILES[2].id },
  { id: "eng-3", name: "Pimchanok.R", phone: "080-555-0133", color: "#4d9a3a", profile_id: PROFILES[3].id },
];

/* number, host, customer, shift, engineer, crew size, PPE */
const MISSIONS = {
  b1: [
    ["101", "Siam Auto Parts", "Tier-1 Seating", "day", "eng-1", 4, "Gloves"],
    ["102", "Rayong Precision", "Brake Systems Ltd.", "day", "eng-2", 3, ""],
    ["103", "Eastern Seaboard Motors", "EV Battery Co.", "night", "eng-1", 3, "Reflective vest"],
    ["104", "Pluak Daeng Plastics", "Interior Trim Co.", "day", "eng-3", 4, ""],
    ["105", "Map Ta Phut Steel", "Chassis Works", "day", "eng-2", 2, "Helmet"],
    ["106", "Rayong Precision", "Brake Systems Ltd.", "night", "eng-3", 2, ""],
    ["107", "Siam Auto Parts", "Door Module Co.", "day", "eng-1", 0, ""],
  ],
  b2: [
    ["201", "Laem Chabang Logistics", "Export Packing Co.", "day", "eng-2", 4, ""],
    ["202", "Amata Components", "Wiring Harness Co.", "day", "eng-3", 3, ""],
    ["203", "Bowin Glass", "Glazing Partners", "night", "eng-2", 2, ""],
  ],
  b3: [
    ["301", "Rojana Electronics", "Sensor Tech", "day", "eng-3", 3, ""],
    ["302", "Hi-Tech Bearings", "Motion Parts", "day", "eng-1", 2, ""],
  ],
};
const TIMES = { day: ["08:00:00", "17:00:00"], night: ["20:00:00", "05:00:00"] };
const LEAVE_PATTERN = ["annual", "sick", "business"];

/* One day's plan for one board: missions plus who goes where. `k` rotates the
   crew so people's history and the Host list's "inspectors" chips vary. */
function dayPlan(board, date, k, emps, { loanOut } = {}) {
  const mine = emps.filter((e) => e.board_id === board && e.id !== loanOut);
  const perm = mine.filter((e) => e.contract === "permanent");
  const onc = mine.filter((e) => e.contract === "oncall");
  const rot = (arr, by) => arr.map((_, i) => arr[(i + by) % arr.length]);
  const p = rot(perm, k % Math.max(1, perm.length));
  const leaveCount = board === "b1" ? 3 : board === "b2" ? 1 : 0;
  const onLeave = p.slice(0, leaveCount);
  const workers = [...p.slice(leaveCount), ...onc.slice(0, board === "b1" ? 2 : 0)];
  const missions = [], assignments = [];
  let w = 0;
  // a little day-to-day variation in history: some past days run one short
  const short = k > 0 && k % 5 === 0;
  for (const [num, host, customer, shift, eng, crew, ppe] of MISSIONS[board]) {
    const id = `m-${board}-${num}-${date}`;
    missions.push({ id, board_id: board, plan_date: date, number: num, host, customer, shift, start_time: TIMES[shift][0], end_time: TIMES[shift][1], engineer_id: eng, ppe: ppe || null, remark: null, hidden: false });
    const size = short && crew > 2 ? crew - 1 : crew;
    for (let i = 0; i < size && w < workers.length; i++) assignments.push({ employee_id: workers[w++].id, plan_date: date, mission_id: id, zone: null });
  }
  onLeave.forEach((e, i) => assignments.push({ employee_id: e.id, plan_date: date, mission_id: null, zone: LEAVE_PATTERN[i % LEAVE_PATTERN.length] }));
  return { missions, assignments };
}

function seed(db) {
  const emps = employees();
  db.seed("roles", [
    { key: "admin", label: "Admin", rank: 10, protected: true }, { key: "manager", label: "Manager", rank: 20, protected: false },
    { key: "engineer", label: "Engineer", rank: 30, protected: false }, { key: "viewer", label: "Viewer", rank: 40, protected: false },
  ]);
  const AREAS_P = ["board", "overview", "orgchart", "emplist", "hostlist", "settings", "users", "capacity", "forecast", "loans",
    "ov.status", "ov.kpi", "ov.actionQueue", "ov.byBoard", "ov.history", "ov.byEngineer", "ov.dayNight", "ov.hostRisk", "ov.byArea", "ov.leave", "ov.loans"];
  const perms = [];
  for (const role of ["admin", "manager", "engineer", "viewer"]) {
    for (const area of AREAS_P) {
      let level = area.startsWith("ov.") || area === "overview" || area === "orgchart" ? "view" : (role === "viewer" ? "view" : "edit");
      if (area === "users") level = role === "admin" ? "edit" : "none";
      if (area === "settings" && role === "viewer") level = "none";
      if ((area === "ov.history" || area === "ov.byEngineer") && (role === "engineer" || role === "viewer")) level = "none";
      perms.push({ role_key: role, area, level });
    }
  }
  db.seed("role_permissions", perms);
  db.seed("profiles", [...PROFILES, ...PENDING]);
  db.seed("service_areas", AREAS);
  db.seed("engineers", ENGINEERS);
  db.seed("hosts", HOSTS);
  db.seed("boards", BOARDS);
  db.seed("employees", emps);

  // about 25 working days of history, then the confirmed next working day
  const days = [];
  let d = TODAY;
  if (isWeekend(d)) d = prevWorking(d);
  for (let i = 0; i < 25; i++) { days.unshift(d); d = prevWorking(d); }
  if (!days.includes(TODAY) && !isWeekend(TODAY)) days.push(TODAY);
  days.push(NEXT);
  const LOANED = "e24";   // a Rayong standby lent to Chonburi from today
  const missions = [], assignments = [], history = [];
  days.forEach((date, k) => {
    for (const b of BOARDS) {
      const loanOut = b.id === "b1" && date >= TODAY ? LOANED : undefined;
      const plan = dayPlan(b.id, date, days.length - 1 - k, emps, { loanOut });
      missions.push(...plan.missions);
      assignments.push(...plan.assignments);
      for (const a of plan.assignments) {
        if (!a.mission_id) continue;
        const m = plan.missions.find((x) => x.id === a.mission_id);
        history.push({ id: "dh-" + a.employee_id + "-" + date, employee_id: a.employee_id, plan_date: date, mission_number: m.number, host: m.host, customer: m.customer, board_id: b.id });
      }
    }
  });
  db.seed("missions", missions);
  db.seed("assignments", assignments);
  db.seed("deployment_history", history);
  db.seed("employee_loans", [{ id: "loan-1", employee_id: LOANED, to_board_id: "b2", start_date: TODAY, end_date: addDays(NEXT, 2), note: "Extra sorting at Laem Chabang", created_by: ME.email }]);

  // the first forecast day on Rayong, held by Somchai
  const fc = dayPlan("b1", FORECAST, 3, emps, { loanOut: LOANED });
  const fmap = {};
  db.seed("forecast_missions", fc.missions.filter((m) => m.number !== "107").map((m) => {
    const id = m.id.replace("m-", "f-"); fmap[m.id] = id;
    return { id, board_id: m.board_id, plan_date: m.plan_date, number: m.number, host: m.host, customer: m.customer, shift: m.shift, start_time: m.start_time, end_time: m.end_time, engineer_id: m.engineer_id, created_by: PROFILES[1].email };
  }));
  db.seed("forecast_assignments", fc.assignments.filter((a) => !a.mission_id || fmap[a.mission_id]).map((a) => ({
    employee_id: a.employee_id, plan_date: a.plan_date, forecast_mission_id: a.mission_id ? fmap[a.mission_id] : null, zone: a.zone, held_by: PROFILES[1].email,
  })));

  // Capacity: Rayong's demand per host and shift for the next three weeks, a few days short
  const cap = [];
  let c = NEXT;
  for (let i = 0; i < 15; i++) {
    for (const [, host, , shift, , crew] of MISSIONS.b1) {
      if (!crew) continue;
      const bump = (i === 3 || i === 4 || i === 9) && host === "Siam Auto Parts" ? 3 : 0;
      const row = cap.find((r) => r.plan_date === c && r.host === host && r.shift === shift);
      if (row) row.headcount += crew; else cap.push({ board_id: "b1", plan_date: c, host, shift, headcount: crew + bump });
    }
    c = nextWorking(c);
  }
  db.seed("capacity_demand", cap);
  return { emps };
}

module.exports = { seed, ME, PROFILES, TODAY, NEXT, FORECAST, BOARDS };
