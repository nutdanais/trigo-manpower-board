/* Sample data for the user-guide screenshots. Every person, site, customer and
   phone number here is invented; nothing comes from the live database. Dates are
   worked out from the day the script runs, so the board always opens on a
   planned "next working day" with about a month of history behind it.

   Used by the user-guide screenshots (design/user-guide/capture.js) and by the
   browser-only demo (demo/demo.js), which is why it also runs in a page: the file
   is wrapped in a function, and exports DemoSeed on window. */
"use strict";
(function (root) {

const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const isWeekend = (s) => [0, 6].includes(new Date(s + "T00:00:00").getDay());
const nextWorking = (s) => { let d = addDays(s, 1); while (isWeekend(d)) d = addDays(d, 1); return d; };
const prevWorking = (s) => { let d = addDays(s, -1); while (isWeekend(d)) d = addDays(d, -1); return d; };

const TODAY = iso(new Date());
const YY = TODAY.slice(2, 4), LY = String(+TODAY.slice(0, 4) - 1).slice(2);   // this year's and last year's two digits
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
  // the site's administrator: keeps the mission numbers in step with Etraq (Missions tab)
  { id: "00000000-0000-0000-0000-0000000000f1", email: "ploy.s@trigo-group.com", full_name: "Ploy Sanit", display_name: "Ploy.S", role_key: "siteadmin", phone: "" },
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
/* Mission numbers in Etraq's form (PREFIX.YY.NNNN), except two typed wrongly before the rule was strict
   ("RYGTH.YY.104", three digits, and "203"): their cards and Missions rows carry the Wrong number flag. */
const N = (prefix, n) => `${prefix}.${YY}.${n}`;
const MISSIONS = {
  b1: [
    [N("RYGTH", "0101"), "Siam Auto Parts", "Tier-1 Seating", "day", "eng-1", 4, "Gloves"],
    [N("RYGTH", "0102"), "Rayong Precision", "Brake Systems Ltd.", "day", "eng-2", 3, ""],
    [N("RYGTH", "0103"), "Eastern Seaboard Motors", "EV Battery Co.", "night", "eng-1", 3, "Reflective vest"],
    [N("RYGTH", "104"), "Pluak Daeng Plastics", "Interior Trim Co.", "day", "eng-3", 4, ""],
    [N("RYGTH", "0105"), "Map Ta Phut Steel", "Chassis Works", "day", "eng-2", 2, "Helmet"],
    [N("RYGTH", "0106"), "Rayong Precision", "Brake Systems Ltd.", "night", "eng-3", 2, ""],
    [N("RYGTH", "0107"), "Siam Auto Parts", "Door Module Co.", "day", "eng-1", 0, ""],
  ],
  b2: [
    [N("CHBTH", "0201"), "Laem Chabang Logistics", "Export Packing Co.", "day", "eng-2", 4, ""],
    [N("CHBTH", "0202"), "Amata Components", "Wiring Harness Co.", "day", "eng-3", 3, ""],
    ["203", "Bowin Glass", "Glazing Partners", "night", "eng-2", 2, ""],
  ],
  b3: [
    [N("AYTTH", "0301"), "Rojana Electronics", "Sensor Tech", "day", "eng-3", 3, ""],
    // a mission number in Etraq's form, renumbered for this year three days ago (see seed():
    // the card shows "New number · was …" for two weeks)
    [`AYTTH.${YY}.0302`, "Hi-Tech Bearings", "Motion Parts", "day", "eng-1", 2, ""],
  ],
};
const TIMES = { day: ["08:00:00", "17:00:00"], night: ["20:00:00", "05:00:00"] };
/* a remark on a few missions, so the Missions tab's Remark column has something to show */
const REMARKS = { [N("RYGTH", "0107")]: "Waiting for the customer's PO before the crew is booked", "203": "Night crew enters by gate 2", [N("AYTTH", "0301")]: "Sorting and rework of door seals" };
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
    missions.push({ id, board_id: board, plan_date: date, number: num, host, customer, shift, start_time: TIMES[shift][0], end_time: TIMES[shift][1], engineer_id: eng, ppe: ppe || null, remark: REMARKS[num] || null, hidden: false,
      updated_by: PROFILES[1 + (num.length % 3)].email, updated_at: date + "T0" + (3 + (num.length % 5)) + ":2" + (num.length % 10) + ":00Z" });
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
    { key: "engineer", label: "Engineer", rank: 30, protected: false }, { key: "siteadmin", label: "Site Admin", rank: 35, protected: false },
    { key: "viewer", label: "Viewer", rank: 40, protected: false },
  ]);
  const AREAS_P = ["board", "overview", "orgchart", "emplist", "hostlist", "settings", "users", "capacity", "forecast", "loans",
    "ov.status", "ov.kpi", "ov.actionQueue", "ov.byBoard", "ov.history", "ov.byEngineer", "ov.dayNight", "ov.hostRisk", "ov.byArea", "ov.leave", "ov.loans",
    "missions", "missionadmin"];
  const perms = [];
  for (const role of ["admin", "manager", "engineer", "siteadmin", "viewer"]) {
    // the Site Admin starts as a Viewer, plus the Missions tab (migration-2026-11-09)
    const as = role === "siteadmin" ? "viewer" : role;
    for (const area of AREAS_P) {
      let level = area.startsWith("ov.") || area === "overview" || area === "orgchart" ? "view" : (as === "viewer" ? "view" : "edit");
      if (area === "users") level = as === "admin" ? "edit" : "none";
      if (area === "settings" && as === "viewer") level = "none";
      if ((area === "ov.history" || area === "ov.byEngineer") && (as === "engineer" || as === "viewer")) level = "none";
      if (area === "missions") level = role === "viewer" ? "view" : "edit";
      if (area === "missionadmin") level = ["admin", "manager", "siteadmin"].includes(role) ? "edit" : "none";
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
  // the Missions tab: a Chonburi job that ran for the first two weeks of the history and was
  // closed on its last day (the register rows are made by the database as the days are saved)
  const ended = days.slice(0, 10);
  for (const date of ended) {
    missions.push({ id: `m-b2-209-${date}`, board_id: "b2", plan_date: date, number: N("CHBTH", "0209"), host: "Amata Components", customer: "Seat Belt Co.",
      shift: "day", start_time: TIMES.day[0], end_time: TIMES.day[1], engineer_id: "eng-3", ppe: null, remark: null, hidden: false });
  }
  // ...a Chonburi job that was running and has been hidden on the board for its last ten days, so it is
  // open but on no board (Status: Hidden, with a pill suggesting Close)...
  const mk = (id, board, num, host, customer, eng, date, hidden) => ({ id: `${id}-${date}`, board_id: board, plan_date: date, number: num, host, customer,
    shift: "day", start_time: TIMES.day[0], end_time: TIMES.day[1], engineer_id: eng, ppe: null, remark: null, hidden });
  days.forEach((date, i) => missions.push(mk("m-b2-204", "b2", N("CHBTH", "0204"), "Amata Components", "Cable Assembly Co.", "eng-3", date, i >= days.length - 10)));
  // ...an Ayutthaya job that stopped being planned nine working days ago (Status: Off the board, with Add to board)
  days.slice(0, days.length - 9).forEach((date) => missions.push(mk("m-b3-303", "b3", N("AYTTH", "0303"), "Rojana Electronics", "Optic Parts Ltd.", "eng-1", date, false)));
  // ...two jobs started before Etraq had a number for them (temporary numbers, PREFIX.YY.TMPNNN): a Rayong one
  // made five days ago, flagged red from its third day, and a Chonburi one made today for the next working day
  const tempDays = days.filter((x) => x >= addDays(TODAY, -5));
  tempDays.forEach((date) => missions.push(mk("m-b1-tmp1", "b1", N("RYGTH", "TMP001"), "Pluak Daeng Plastics", "Bumper Line Co.", "eng-2", date, false)));
  missions.push(mk("m-b2-tmp1", "b2", N("CHBTH", "TMP001"), "Laem Chabang Logistics", "Pallet Repair Co.", "eng-3", NEXT, false));
  db.seed("missions", missions);
  // ...and a mission registered in Bulk edit that has no day on a board yet (Status: Not started)
  db.seed("mission_register", [{ board_id: "b1", number: N("RYGTH", "0108"), shift: "day", source: "list", status: "open", host: "Map Ta Phut Steel", customer: "Gear Works Ltd.", engineer_id: "eng-2", updated_by: ME.email }]);
  // ...and a Rayong job that ended in December of last year: off the list until "from earlier years" is on
  const LAST = String(+TODAY.slice(0, 4) - 1);
  db.seed("mission_register", [{ board_id: "b1", number: `RAYTH.${LY}.0091`, shift: "day", source: "list", status: "closed", host: "Rayong Precision", customer: "Brake Systems Ltd.",
    engineer_id: "eng-2", opened_on: `${LAST}-09-01`, last_on: `${LAST}-12-18`, closed_on: `${LAST}-12-18`, closed_by: PROFILES[3].email, closed_at: `${LAST}-12-18T10:00:00.000Z`,
    close_note: "Contract ended", updated_by: ME.email }]);
  const closed = db.t("mission_register").find((r) => r.board_id === "b2" && r.number === N("CHBTH", "0209"));
  if (closed) Object.assign(closed, { status: "closed", closed_on: ended[ended.length - 1], closed_by: PROFILES[3].email, closed_at: new Date().toISOString(), close_note: "Contract ended" });
  // ...and the new-year number of Ayutthaya's bearing job, entered three days ago
  db.seed("mission_number_history", [{ id: "mnh-1", old_number: `AYTTH.${LY}.0157`, new_number: `AYTTH.${YY}.0302`, valid_from: TODAY.slice(0, 4) + "-01-01",
    entered_by: "ploy.s@trigo-group.com", entered_at: new Date(Date.now() - 3 * 86400e3).toISOString() }]);
  db.seed("assignments", assignments);
  db.seed("deployment_history", history);
  db.seed("employee_loans", [{ id: "loan-1", employee_id: LOANED, to_board_id: "b2", start_date: TODAY, end_date: addDays(NEXT, 2), note: "Extra sorting at Laem Chabang", created_by: ME.email }]);

  // the first forecast day on Rayong, held by Somchai
  const fc = dayPlan("b1", FORECAST, 3, emps, { loanOut: LOANED });
  const fmap = {};
  // the temporary number's three days count from when it was first registered
  const temp = db.t("mission_register").find((r) => r.number === N("RYGTH", "TMP001"));
  if (temp) temp.created_at = new Date(Date.now() - 5 * 86400e3).toISOString();
  db.seed("forecast_missions", fc.missions.filter((m) => m.number !== N("RYGTH", "0107")).map((m) => {
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

const api = { seed, ME, PROFILES, TODAY, NEXT, FORECAST, BOARDS };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.DemoSeed = api;

})(typeof window !== "undefined" ? window : globalThis);
