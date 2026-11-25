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

/* Service areas: the codes the real board shows on a mission's header and at the foot of every person's card.
   The first six are the Non-Rayong board's; RYG and MTP are the Rayong board's. */
const AREAS = [
  { id: "a-amata", name: "AMATA", color: "#7fb8ec" },
  { id: "a-ayt", name: "AYT", color: "#a8d98a" },
  { id: "a-npt", name: "NPT", color: "#f2cf6b" },
  { id: "a-lcb", name: "LCB", color: "#f4a3c0" },
  { id: "a-benz", name: "BENZ", color: "#d6b38a" },
  { id: "a-well", name: "Wellgrow", color: "#f6a06b" },
  { id: "a-ryg", name: "RYG", color: "#7fd1c0" },
  { id: "a-mtp", name: "MTP", color: "#b9a7ee" },
];
/* short codes used by the crew and roster tables below */
const AREA_ID = { A: "a-amata", Y: "a-ayt", N: "a-npt", L: "a-lcb", B: "a-benz", W: "a-well", R: "a-ryg", M: "a-mtp" };
/* the five positions on a card (POSITIONS in app.js); OC is not a position but the on-call contract, which has none */
const POS_KEY = { Ins: "inspector", SI: "senior_inspector", TL: "team_leader", Tec: "technician", OC: null };

/* b1 is the board the demo opens on, like the real one. Rayong is the second board: it gives Overview,
   loans and the board tabs something to compare. */
const BOARDS = [
  { id: "b1", name: "Non-Rayong", weekend_days: [0, 6] },
  { id: "b2", name: "Rayong", weekend_days: [0, 6] },
];

const maps = (q) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
/* A host is the site where the crew works; its note is the PPE line every card at that site starts with.
   Names follow the real list's habits: a number in brackets after some, Thai place names, a note typed in Thai. */
const HOST_ROWS = [
  // Non-Rayong: AMATA
  ["Office AMATA(9)", "Amata City, Chonburi", "a-amata", ""],
  ["TTKM", "Amata City, Chonburi", "a-amata", "รองเท้าเซฟตี้"],
  ["TBKS(9)", "Amata Nakorn, Chonburi", "a-amata", ""],
  ["MCT(9)", "Amata City, Chonburi", "a-amata", "รองเท้าเซฟตี้ หมวก เสื้อสะท้อนแสง"],
  ["Eastern Toyoda(9)", "Amata City, Chonburi", "a-amata", ""],
  ["Alpha Industry", "", "a-amata", ""],   // no location yet: shows in the Host list as missing one
  // Non-Rayong: Ayutthaya
  ["Fortune Parts(S)", "Bang Pa-in, Ayutthaya", "a-ayt", "PPE : หมวก, รองเท้าเซฟตี้"],
  ["Sertec Ayutthaya", "Rojana, Ayutthaya", "a-ayt", ""],
  // Non-Rayong: Lat Krabang and Bangna
  ["KWC คลองส่งน้ำ (6)", "Lat Krabang, Bangkok", "a-npt", "หมวกแก๊ป,รองเท้าเซฟตี้"],
  ["Kodama คลองส่งน้ำ (6)", "Lat Krabang, Bangkok", "a-npt", "หมวกแก๊ป,รองเท้าเซฟตี้"],
  ["NSM นิวสมไทย", "Bang Phli, Samut Prakan", "a-npt", "PPE : หมวก, รองเท้าเซฟตี้"],
  ["UT Truck (6)", "Bang Na, Bangkok", "a-npt", "หมวกแก๊ป,เสื้อสะท้อนแสง,รองเท้าเซฟตี้"],
  ["Denko (5)", "Bang Phli, Samut Prakan", "a-benz", ""],
  ["Benz Logistics", "Bang Na, Bangkok", "a-benz", "หมวกแก๊ป,เสื้อสะท้อนแสง,รองเท้าเซฟตี้"],
  ["Tigra W/H Ladkrabang", "Lat Krabang, Bangkok", "a-npt", "PPE : หมวก, รองเท้าเซฟตี้, เสื้อสะท้อนแสง"],
  // Non-Rayong: Laem Chabang
  ["MKTH", "Laem Chabang, Chonburi", "a-lcb", "PPEทุกชนิด รองเท้าเซฟตี้,เสื้อสะท้อนแสง,หมวกแก๊ป,ปลอกแขนยีนส์"],
  ["Sakuda", "Laem Chabang, Chonburi", "a-lcb", "หมวกแก๊ป, เสื้อสะท้อนแสง, รองเท้าเซฟตี้"],
  ["YOSHEN ศรีราชา", "Si Racha, Chonburi", "a-lcb", "เสื้อสะท้อนแสง, รองเท้าเซฟตี้"],
  ["Hirota and Sumida", "Si Racha, Chonburi", "a-lcb", ""],
  // Rayong
  ["Siam Auto Parts", "Pluak Daeng, Rayong", "a-ryg", "Gate 2, ask for the QC office"],
  ["Rayong Precision", "Nikhom Phatthana, Rayong", "a-ryg", "Safety shoes and glasses"],
  ["Eastern Seaboard Motors", "Pluak Daeng, Rayong", "a-ryg", ""],
  ["Pluak Daeng Plastics", "Pluak Daeng, Rayong", "a-ryg", "Badge at main gate"],
  ["Map Ta Phut Steel", "Map Ta Phut, Rayong", "a-mtp", ""],
];
const HOSTS = HOST_ROWS.map(([name, location, area_id, note], i) => ({
  id: "h" + (i + 1), name, location, area_id, note, map_url: location ? maps(name + " " + location) : "", archived: false,
}));

/* first names and surnames, Thai script and Latin spelling. The real board holds a mix: most people typed in Latin
   letters, some in Thai script (the card shows the Thai name field; the English name field is only filled for Thai script). */
const FIRST = [
  ["สมชาย", "Somchai"], ["สมศักดิ์", "Somsak"], ["สมพร", "Somporn"], ["สมพงษ์", "Sompong"], ["ประเสริฐ", "Prasert"], ["ประสิทธิ์", "Prasit"],
  ["วิชัย", "Wichai"], ["วิรัตน์", "Wirat"], ["วีระ", "Weera"], ["สุรชัย", "Surachai"], ["สุริยา", "Suriya"], ["สุนันท์", "Sunan"],
  ["ศุภชัย", "Supachai"], ["สุพจน์", "Supot"], ["อนุชา", "Anucha"], ["อภิชาติ", "Apichat"], ["อาทิตย์", "Arthit"], ["อดิศร", "Adisorn"],
  ["เอกชัย", "Ekkachai"], ["กิตติพงษ์", "Kittipong"], ["เกียรติศักดิ์", "Kiattisak"], ["กองเกียรติ", "Kongkiat"], ["ชาญชัย", "Chanchai"],
  ["ชัยวัฒน์", "Chaiwat"], ["ฉัตรชัย", "Chatchai"], ["ธนากร", "Thanakorn"], ["ธนวัฒน์", "Thanawat"], ["ธีรวัฒน์", "Teerawat"],
  ["ณัฐพล", "Nattapon"], ["ณัฐวุฒิ", "Natthawut"], ["ณรงค์", "Narong"], ["ณัฐพงษ์", "Nuttapong"], ["ไพโรจน์", "Pairoj"],
  ["ภานุวัฒน์", "Panuwat"], ["พงศกร", "Pongsakorn"], ["ภาคิน", "Phakin"], ["วิทยา", "Wittaya"], ["วรวุฒิ", "Worawut"],
  ["ยุทธนา", "Yutthana"], ["รุ่งโรจน์", "Rungroj"], ["ศักดิ์ชัย", "Sakchai"], ["สราวุธ", "Sarawut"], ["สิทธิชัย", "Sitthichai"],
  ["ธวัชชัย", "Tawatchai"], ["บุญชัย", "Boonchai"], ["บุญมี", "Boonmee"], ["มนตรี", "Montri"], ["มานิตย์", "Manit"],
  ["ลัดดา", "Ladda"], ["มาลี", "Malee"], ["ศิริพร", "Siriporn"], ["สุภาพร", "Supaporn"], ["สุนิสา", "Sunisa"], ["วรรณา", "Wanna"],
  ["จิราพร", "Jiraporn"], ["จิรวรรณ", "Jirawan"], ["พิมพ์ชนก", "Pimchanok"], ["นภัสสร", "Napatsorn"], ["อรุณี", "Arunee"],
  ["กาญจนา", "Kanjana"], ["ดวงใจ", "Duangjai"], ["ปิยะนุช", "Piyanuch"], ["รัตนา", "Rattana"], ["นันทนา", "Nantana"],
  ["ทิพวรรณ", "Tippawan"], ["เพ็ญศรี", "Pensri"], ["กนกวรรณ", "Kanokwan"], ["อัญชลี", "Anchalee"], ["สมหญิง", "Somying"],
  ["อรวรรณ", "Orawan"], ["พัชรี", "Patcharee"], ["ศศิธร", "Sasithorn"], ["วารุณี", "Warunee"], ["ชุติมา", "Chutima"],
  ["นรีรัตน์", "Nareerat"], ["กมลชนก", "Kamonchanok"], ["ธัญญาพร", "Thanyaporn"],
];
const LAST = [
  ["ใจดี", "Jaidee"], ["วงศ์ใหญ่", "Wongyai"], ["รักไทย", "Rakthai"], ["ศรีสุข", "Srisuk"], ["ทองดี", "Thongdee"], ["แก้วมณี", "Kaewmanee"],
  ["บุญมา", "Boonma"], ["มีสุข", "Meesuk"], ["สายทอง", "Saithong"], ["พรหมมา", "Promma"], ["นาคสวัสดิ์", "Naksawat"], ["ทองคำ", "Thongkham"],
  ["อินทร์แก้ว", "Inkaew"], ["ปัญญา", "Panya"], ["ศรีวงศ์", "Sriwong"], ["มั่นคง", "Mankong"], ["เพชรรัตน์", "Petcharat"], ["สมบูรณ์", "Somboon"],
  ["วิเศษ", "Wiset"], ["จันทร์เพ็ญ", "Janpen"], ["แสงทอง", "Saengthong"], ["ใจงาม", "Jaingam"], ["บุญเรือง", "Boonruang"],
  ["พึ่งบุญ", "Puengboon"], ["ศักดิ์ดี", "Sakdee"], ["คงเจริญ", "Kongcharoen"], ["ทองมา", "Thongma"], ["รุ่งเรือง", "Rungruang"],
  ["สุขใจ", "Sukjai"], ["ธนพัฒน์", "Thanapat"], ["ดีมาก", "Deemak"], ["อ่อนศรี", "Onsri"], ["เรืองศรี", "Ruangsri"], ["กล้าหาญ", "Klahan"],
  ["มณีวงศ์", "Maneewong"], ["ศรีทอง", "Srithong"], ["แสนดี", "Saendee"], ["บัวทอง", "Buathong"], ["วงศ์สวัสดิ์", "Wongsawat"],
  ["ทองแท้", "Thongtae"], ["ใจเย็น", "Jaiyen"], ["พรหมศรี", "Phromsri"], ["ชัยสิทธิ์", "Chaiyasit"], ["สุขสวัสดิ์", "Suksawat"],
  ["ดอนชัย", "Donchai"], ["คำดี", "Khamdee"], ["ศิริวัฒน์", "Siriwat"], ["สมบัติ", "Sombat"], ["นาคประสิทธิ์", "Nakprasit"],
];

/* Who works where. A crew is a list of [area, position, how many]: the real board mixes people from several service
   areas on one mission (Wellgrow and AMATA inspectors at an AMATA host, BENZ people at an NPT host), so a mission asks
   for "AMATA inspectors" rather than for named people, and the day's plan picks them from that pool in turn. */
const MISSIONS = {
  b1: [
    // [number, host, customer, shift, engineer, crew, PPE of this mission, { remark, hours: [from, to] }]
    ["AMATA.%Y.0003", "Office AMATA(9)", "Hoshino High-Tech", "day", "eng-1", [["A", "Ins", 1]]],
    ["AMATA.%Y.0004", "TTKM", "Wolfen Electric", "day", "eng-1", [["A", "Ins", 6], ["A", "SI", 1], ["A", "OC", 1]], "", { remark: "ชาย 4" }],
    ["AMATA.%Y.0006", "TBKS(9)", "MKC", "day", "eng-1", [["A", "Ins", 2]]],
    ["AMATA.%Y.0011", "MCT(9)", "Guanghe Welling", "day", "eng-1", [["A", "Ins", 2], ["W", "Ins", 2], ["A", "OC", 2]], "", { remark: "เปิด 1 line ช 2 ญ 1 เปิด 2 line ช 4 ญ 2" }],
    ["AMATA.%Y.0018", "Eastern Toyoda(9)", "Aizen Seiki", "day", "eng-1", [["A", "Ins", 2]], "", { hours: ["07:30", "16:30"] }],
    ["AMATA.%Y.0056", "Alpha Industry", "Schaefer Bearings", "day", "eng-4", [["W", "Ins", 2]], "หมวกแก๊ป", { renumbered: "AMATA.%Y.TMP002" }],
    ["BANGN.%Y.0007", "Fortune Parts(S)", "Hayami", "day", "eng-2", [["Y", "Ins", 1]]],
    ["BANGN.%Y.0030", "Sertec Ayutthaya", "Sertec", "day", "eng-2", [["Y", "Ins", 4], ["W", "Ins", 3], ["Y", "SI", 1], ["Y", "OC", 8]]],
    ["BANGN.%Y.0083", "KWC คลองส่งน้ำ (6)", "Yokomi", "day", "eng-3", [["B", "Ins", 1]], "", { remark: "ลงข้อมูล paperless" }],
    ["BANGN.%Y.0085", "Kodama คลองส่งน้ำ (6)", "TPS", "day", "eng-3", [["N", "Ins", 2]]],
    ["BANGN.%Y.0108", "NSM นิวสมไทย", "NSM", "day", "eng-2", [["N", "Ins", 3], ["N", "SI", 1], ["A", "OC", 2]]],
    ["BANGN.%Y.0107", "UT Truck (6)", "UT Truck", "day", "eng-3", [["B", "Ins", 3], ["N", "OC", 1]], "", { hours: ["07:30", "16:30"] }],
    ["BANGN.%Y.0133", "UT Truck (6)", "TMBQ", "night", "eng-3", [["N", "Ins", 2], ["A", "Ins", 2], ["A", "OC", 2]], "", { hours: ["19:30", "07:30"] }],
    ["BANGN.%Y.0115", "Denko (5)", "Rosenthal", "day", "eng-3", [["N", "OC", 2]]],
    ["BANGN.%Y.0153", "Benz Logistics", "MBT", "day", "eng-3", [["B", "Tec", 1]]],
    ["BANGN.%Y.0158", "Tigra W/H Ladkrabang", "Ningbo ARK Audio", "day", "eng-7", [["Y", "Ins", 2], ["N", "SI", 2]], "", { remark: "ติดต่อเอนจิเนียร์ : 081-555-0142" }],
    ["LCBTH.%Y.0001", "MKTH", "MKC", "day", "eng-5", [["L", "Ins", 4], ["L", "OC", 2]]],
    ["LCBTH.%Y.0001", "MKTH", "MKC", "night", "eng-5", [["L", "Ins", 2], ["L", "OC", 2]]],
    ["LCBTH.%Y.0005", "MKTH", "MKC", "day", "eng-5", [["L", "Ins", 1], ["L", "OC", 1]], "", { remark: "CH gas" }],
    ["LCBTH.%Y.0008", "MKTH", "MKC", "day", "eng-5", [["L", "Ins", 1]]],
    ["LCBTH.%Y.0008", "MKTH", "MKC", "night", "eng-5", [["L", "Ins", 1]]],
    ["LCBTH.%Y.0010", "MKTH", "MKC", "day", "eng-5", [["A", "TL", 1]]],
    ["LCBTH.%Y.0035", "MKTH", "Neijiang Jinhong", "day", "eng-5", [["L", "OC", 2]], "เสื้อสะท้อนแสง"],
    ["LCBTH.%Y.0044", "MKTH", "MKC", "day", "eng-5", [["L", "OC", 2]]],
    ["LCBTH.%Y.0044", "MKTH", "MKC", "night", "eng-5", [["L", "Ins", 1], ["L", "OC", 2]]],
    ["LCBTH.%Y.0051", "YOSHEN ศรีราชา", "SCHAEFER (Thailand)", "day", "eng-6", [["L", "Ins", 1], ["L", "OC", 1]]],
    ["LCBTH.%Y.0060", "YOSHEN ศรีราชา", "SCHAEFER (Thailand)", "day", "eng-6", [["L", "Ins", 2]]],
    ["LCBTH.%Y.0064", "MKTH", "MKC", "day", "eng-5", [["L", "Ins", 1], ["L", "SI", 1]], "", { remark: "CB gass" }],
    ["LCBTH.%Y.0064", "MKTH", "MKC", "night", "eng-5", [["L", "Ins", 2], ["L", "OC", 2]], "", { hours: ["20:00", "05:00"] }],
    ["LCBTH.%Y.0068", "MKTH", "MKC", "day", "eng-5", [["L", "OC", 1]]],
    ["LCBTH.%Y.0075", "Sakuda", "SAKUDA (Thailand)", "day", "eng-6", [["L", "OC", 1]]],
    ["LCBTH.%Y.0076", "MKTH", "MKC", "day", "eng-5", [["L", "OC", 1]]],
    ["LCBTH.%Y.0078", "YOSHEN ศรีราชา", "SCHAEFER (Thailand)", "day", "eng-6", [["L", "Ins", 1]]],
    ["LCBTH.%Y.0084", "Hirota and Sumida", "WINTEK (Kunshan) Ltd.", "day", "eng-6", [["L", "Ins", 1], ["L", "OC", 1]]],
    ["LCBTH.%Y.0085", "YOSHEN ศรีราชา", "SCHAEFER (Thailand)", "day", "eng-6", [["L", "OC", 2]]],
    ["LCBTH.%Y.0087", "MKTH", "MKC", "day", "eng-5", [["L", "OC", 8]]],
  ],
  b2: [
    ["RYGTH.%Y.0101", "Siam Auto Parts", "Tier-1 Seating", "day", "eng-4", [["R", "Ins", 3], ["R", "TL", 1]], "Gloves"],
    ["RYGTH.%Y.0102", "Rayong Precision", "Brake Systems Ltd.", "day", "eng-6", [["R", "Ins", 3]]],
    ["RYGTH.%Y.0103", "Eastern Seaboard Motors", "EV Battery Co.", "night", "eng-4", [["M", "Ins", 3]], "Reflective vest", { hours: ["20:00", "05:00"] }],
    ["RYGTH.%Y.104", "Pluak Daeng Plastics", "Interior Trim Co.", "day", "eng-7", [["R", "Ins", 2], ["M", "Ins", 2]]],   // typed wrongly: carries the Wrong number flag
    ["RYGTH.%Y.0105", "Map Ta Phut Steel", "Chassis Works", "day", "eng-6", [["M", "Ins", 2], ["R", "OC", 1]], "Helmet"],
    ["RYGTH.%Y.0106", "Rayong Precision", "Brake Systems Ltd.", "night", "eng-7", [["R", "SI", 1], ["M", "Ins", 1]], "", { hours: ["20:00", "05:00"] }],
    ["RYGTH.%Y.0107", "Siam Auto Parts", "Door Module Co.", "day", "eng-4", [], "", { remark: "Waiting for the customer's PO before the crew is booked" }],
  ],
};
/* people on the roster beyond what the confirmed day needs: the Available On-call row (with the Rayong person lent over, the eight of
   the real board), and one inspector who is on leave that day */
const SURPLUS = {
  b1: { "A:OC": 4, "L:OC": 3, "B:Ins": 1 },
  b2: { "R:OC": 3, "M:OC": 2, "R:Ins": 1, "R:TL": 1 },
};
const POOL_ORDER = ["A:Ins", "A:SI", "A:TL", "A:OC", "W:Ins", "Y:Ins", "Y:SI", "Y:OC", "B:Ins", "B:Tec", "N:Ins", "N:SI", "N:OC", "L:Ins", "L:SI", "L:OC", "R:Ins", "R:TL", "R:SI", "R:OC", "M:Ins", "M:OC"];

/* roster size of each pool = the crews' demand on the confirmed day + the surplus */
function rosterOf(board) {
  const need = {};
  for (const m of MISSIONS[board]) for (const [a, p, n] of m[5]) need[a + ":" + p] = (need[a + ":" + p] || 0) + n;
  for (const [k, n] of Object.entries(SURPLUS[board])) need[k] = (need[k] || 0) + n;
  return POOL_ORDER.filter((k) => need[k]).map((k) => [k, need[k]]);
}

const N = (prefix, n) => `${prefix}.${YY}.${n}`;   // a mission number in Etraq's form: PREFIX.YY.NNNN
/* the same list in a fixed scrambled order, so people made one after the other (one crew) rarely share a surname */
const scramble = (list, seed) => { const a = list.slice(); let x = seed; for (let i = a.length - 1; i > 0; i--) { x = (x * 1103515245 + 12345) % 2147483648; const j = x % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const FIRST_S = scramble(FIRST, 7), LAST_S = scramble(LAST, 11);
const POOL_OF = new Map();   // employee id -> its pool ("A:Ins")
let LOANED = null;           // an on-call Rayong person lent to Non-Rayong from today

function employees() {
  const out = [];
  let n = 0;
  for (const b of BOARDS) {
    for (const [pool, count] of rosterOf(b.id)) {
      const [a, p] = pool.split(":");
      for (let i = 0; i < count; i++, n++) {
        const [th1, en1] = FIRST_S[n % FIRST_S.length], [th2, en2] = LAST_S[n % LAST_S.length];
        const thai = n % 4 === 3;   // one person in four is typed in Thai script
        const oncall = p === "OC";
        const years = (n * 7) % 9;
        const id = "e" + (n + 1);
        out.push({
          id, name_th: thai ? th1 + " " + th2 : en1 + " " + en2, name_en: thai ? en1 + " " + en2 : null,
          // on-call people usually have no TRIGO ID yet
          trigo_id: oncall ? null : "T" + (100 + (n * 37) % 900),
          contract: oncall ? "oncall" : "permanent", position: POS_KEY[p],
          phone: "08" + (1 + n % 9) + "-555-" + String(1000 + n * 17).slice(-4),
          start_date: years ? `${+TODAY.slice(0, 4) - years}-0${(n % 9) + 1}-15` : null,
          area_id: AREA_ID[a], board_id: b.id, active: true,
        });
        POOL_OF.set(id, pool);
        if (b.id === "b2" && pool === "R:OC") LOANED = id;   // the last Rayong on-call
      }
    }
  }
  return out;
}

const ME = { id: "00000000-0000-0000-0000-0000000000a1", email: "nattaya.s@trigo-group.com", role: "admin" };
const PROFILES = [
  { id: ME.id, email: ME.email, full_name: "Nattaya Suwan", display_name: "Nattaya.S", role_key: "admin", phone: "080-555-0100" },
  // the engineers: the "Trigo responsible" named on a mission card, with a phone number to tap
  { id: "00000000-0000-0000-0000-0000000000b1", email: "narin.k@trigo-group.com", full_name: "Narin Kasem", display_name: "Narin.K", role_key: "engineer", phone: "081-555-0111" },
  { id: "00000000-0000-0000-0000-0000000000b2", email: "pathum.c@trigo-group.com", full_name: "Pathum Charoen", display_name: "Pathum.C", role_key: "engineer", phone: "081-555-0122" },
  { id: "00000000-0000-0000-0000-0000000000b3", email: "sudarat.c@trigo-group.com", full_name: "Sudarat Chaiya", display_name: "Sudarat.C", role_key: "engineer", phone: "081-555-0133" },
  { id: "00000000-0000-0000-0000-0000000000b4", email: "somsak.p@trigo-group.com", full_name: "Somsak Pinyo", display_name: "Somsak.P", role_key: "engineer", phone: "081-555-0144" },
  { id: "00000000-0000-0000-0000-0000000000b5", email: "jarunee.j@trigo-group.com", full_name: "Jarunee Jantra", display_name: "Jarunee.J", role_key: "engineer", phone: "081-555-0155" },
  { id: "00000000-0000-0000-0000-0000000000b6", email: "wipawan.c@trigo-group.com", full_name: "Wipawan Chotiwan", display_name: "Wipawan.C", role_key: "engineer", phone: "081-555-0166" },
  { id: "00000000-0000-0000-0000-0000000000b7", email: "jirayu.s@trigo-group.com", full_name: "Jirayu Sombat", display_name: "Jirayu.S", role_key: "engineer", phone: "081-555-0177" },
  { id: "00000000-0000-0000-0000-0000000000c1", email: "wichai.k@trigo-group.com", full_name: "Wichai Kanha", display_name: "Wichai.K", role_key: "manager", phone: "" },
  { id: "00000000-0000-0000-0000-0000000000d1", email: "suda.m@trigo-group.com", full_name: "Suda Mekin", display_name: "Suda.M", role_key: "viewer", phone: "" },
  // the site's administrator: keeps the mission numbers in step with Etraq (Missions tab)
  { id: "00000000-0000-0000-0000-0000000000f1", email: "ploy.s@trigo-group.com", full_name: "Ploy Sanit", display_name: "Ploy.S", role_key: "siteadmin", phone: "" },
].map((p) => ({ ...p, status: "active", last_seen_at: new Date(Date.now() - 3600e3).toISOString() }));
const PENDING = [
  { id: "00000000-0000-0000-0000-0000000000e1", email: "arthit.c@trigo-group.com", full_name: "Arthit Chaiyo", display_name: "Arthit.C", role_key: "engineer", status: "pending", requested_at: new Date(Date.now() - 2 * 3600e3).toISOString() },
  { id: "00000000-0000-0000-0000-0000000000e2", email: "kanya.t@trigo-group.com", full_name: "Kanya Thong", display_name: "Kanya.T", role_key: "engineer", status: "pending", requested_at: new Date(Date.now() - 26 * 3600e3).toISOString() },
];
/* the colour is the top edge of an engineer's mission cards */
const ENGINEERS = PROFILES.filter((p) => p.role_key === "engineer").map((p, i) => ({
  id: "eng-" + (i + 1), name: p.display_name, phone: p.phone,
  color: ["#2a78d6", "#4d9a3a", "#d9548a", "#e07b39", "#d6204a", "#7b3fc4", "#e8a24f"][i], profile_id: p.id,
}));

const TIMES = { day: ["08:00", "17:00"], night: ["08:00", "17:00"] };   // a night card on these hours reads "Night · time not set"
const LEAVE_PATTERN = ["annual", "sick", "business"];
const fill = (s) => s.replace("%Y", YY);   // "AMATA.%Y.0003" -> this year's number
const mnum = (m) => fill(m[0]);

/* One day's plan for one board: missions plus who goes where. `k` is how many working days back from the
   confirmed day this is (0 = the confirmed day): it turns each pool round, so people's history and the Host list's
   "inspectors" chips vary, and a few past days run short. */
function dayPlan(board, date, k, emps, { loanOut } = {}) {
  const mine = emps.filter((e) => e.board_id === board && e.id !== loanOut);
  const rot = (arr, by) => arr.map((_, i) => arr[(i + by) % arr.length]);
  const wantLeave = board === "b1" ? 1 : 2;
  // leave: on the confirmed day the surplus permanent people (the SURPLUS above); on a past day a few people from round the roster,
  // who leave their crews a person short
  const perm = mine.filter((e) => e.contract === "permanent");
  const leavers = k > 0 ? rot(perm, Math.floor(k * perm.length * 0.618) % perm.length).slice(0, board === "b1" ? 1 + (k % 3 === 0 ? 1 : 0) : 1 + (k % 2)) : [];
  const away = new Set(leavers.map((e) => e.id));
  const pools = {};
  for (const e of mine) if (!away.has(e.id)) (pools[POOL_OF.get(e.id)] ||= []).push(e);
  for (const key of Object.keys(pools)) pools[key] = rot(pools[key], k % pools[key].length);
  const next = {};   // how far into each pool the day has used
  const missions = [], assignments = [], used = new Set();
  const short = k > 0 && k % 5 === 0;   // some past days run one short
  for (const m of MISSIONS[board]) {
    const [, host, customer, shift, eng, crew, ppe, extra = {}] = m;
    const number = mnum(m);
    const [from, to] = extra.hours || TIMES[shift];
    const id = `m-${board}-${number}-${shift}-${date}`;
    missions.push({ id, board_id: board, plan_date: date, number, host, customer, shift, start_time: from + ":00", end_time: to + ":00", engineer_id: eng, ppe: ppe || null, remark: extra.remark || null, hidden: false,
      updated_by: PROFILES[1 + (number.length % 3)].email, updated_at: date + "T0" + (3 + (number.length % 5)) + ":2" + (number.length % 10) + ":00Z" });
    const picks = [];
    for (const [a, p, n] of crew) {
      const list = pools[a + ":" + p] || [];
      for (let i = 0; i < n; i++) { const e = list[(next[a + ":" + p] = (next[a + ":" + p] || 0) + 1) - 1]; if (e) picks.push(e); }
    }
    if (short && picks.length > 2) picks.pop();
    for (const e of picks) { assignments.push({ employee_id: e.id, plan_date: date, mission_id: id, zone: null }); used.add(e.id); }
    // the head of the crew (right-click → Make Leader): on Rayong, every other mission with two or more people,
    // so a board shows missions with a head and without one (the real Non-Rayong board has none yet)
    if (board === "b2" && picks.length >= 2 && missions.length % 2 === 1) missions[missions.length - 1].lead_employee_id = picks[0].id;
  }
  if (k === 0) {
    // the permanent people nobody needed go on leave: Annual Leave on Non-Rayong, a mix on Rayong
    const spare = perm.filter((e) => !used.has(e.id)).slice(0, wantLeave);
    spare.forEach((e, i) => assignments.push({ employee_id: e.id, plan_date: date, mission_id: null, zone: LEAVE_PATTERN[i % LEAVE_PATTERN.length] }));
  } else {
    leavers.forEach((e, i) => assignments.push({ employee_id: e.id, plan_date: date, mission_id: null, zone: LEAVE_PATTERN[i % LEAVE_PATTERN.length] }));
  }
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
  const missions = [], assignments = [], history = [];
  days.forEach((date, k) => {
    for (const b of BOARDS) {
      const loanOut = b.id === "b2" && date >= TODAY ? LOANED : undefined;   // a Rayong on-call person lent to Non-Rayong from today
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
  // the Missions tab: a Non-Rayong job that ran for the first two weeks of the history and was
  // closed on its last day (the register rows are made by the database as the days are saved)
  const ended = days.slice(0, 10);
  const mk = (id, board, num, host, customer, eng, date, hidden) => ({ id: `${id}-${date}`, board_id: board, plan_date: date, number: num, host, customer,
    shift: "day", start_time: "08:00:00", end_time: "17:00:00", engineer_id: eng, ppe: null, remark: null, hidden });
  for (const date of ended) missions.push(mk("m-b1-0090", "b1", N("BANGN", "0090"), "Sertec Ayutthaya", "Kayaba Seat Belt Co.", "eng-2", date, false));
  // ...an Amata job that was running and has been hidden on the board for its last ten days, so it is
  // open but on no board (Status: Hidden, with a pill suggesting Close)...
  days.forEach((date, i) => missions.push(mk("m-b1-0020", "b1", N("AMATA", "0020"), "Office AMATA(9)", "Cable Assembly Co.", "eng-1", date, i >= days.length - 10)));
  // ...a Bangna job that stopped being planned nine working days ago (Status: Off the board, with Add to board)
  days.slice(0, days.length - 9).forEach((date) => missions.push(mk("m-b1-0066", "b1", N("BANGN", "0066"), "Fortune Parts(S)", "Optic Parts Ltd.", "eng-2", date, false)));
  // ...and a Rayong job started before Etraq had a number for it (a temporary number, PREFIX.YY.TMPNNN), made five days ago
  // and flagged red from its third day
  const tempDays = days.filter((x) => x >= addDays(TODAY, -5));
  tempDays.forEach((date) => missions.push(mk("m-b2-tmp1", "b2", N("RYGTH", "TMP001"), "Pluak Daeng Plastics", "Bumper Line Co.", "eng-6", date, false)));
  db.seed("missions", missions);
  // ...a mission registered in Bulk edit that has no day on a board yet (Status: Not started)
  db.seed("mission_register", [{ board_id: "b2", number: N("RYGTH", "0108"), shift: "day", source: "list", status: "open", host: "Map Ta Phut Steel", customer: "Gear Works Ltd.", engineer_id: "eng-6", updated_by: ME.email }]);
  // ...two missions at several hosts (one customer, several hosts): the registered job above is also done at Eastern Seaboard
  // Motors (Add to board asks which host), and a running Rayong one is also at Eastern Seaboard Motors, its latest card still asking
  // to be confirmed ("Confirm host", as after a carry over)
  const manyHosts = (num, hosts) => { const r = db.t("mission_register").find((x) => x.board_id === "b2" && x.number === num); if (r) r.hosts = hosts; return r; };
  manyHosts(N("RYGTH", "0108"), ["Map Ta Phut Steel", "Eastern Seaboard Motors"]);
  if (manyHosts(N("RYGTH", "0107"), ["Siam Auto Parts", "Eastern Seaboard Motors"])) {
    const last = db.t("missions").filter((m) => m.board_id === "b2" && m.number === N("RYGTH", "0107")).sort((a, b) => (a.plan_date < b.plan_date ? 1 : -1))[0];
    if (last) last.host_unconfirmed = true;
  }
  // ...and a Rayong job that ended in December of last year: off the list until "from earlier years" is on
  const LASTYEAR = String(+TODAY.slice(0, 4) - 1);
  db.seed("mission_register", [{ board_id: "b2", number: `RYGTH.${LY}.0091`, shift: "day", source: "list", status: "closed", host: "Rayong Precision", customer: "Brake Systems Ltd.",
    engineer_id: "eng-6", opened_on: `${LASTYEAR}-09-01`, last_on: `${LASTYEAR}-12-18`, closed_on: `${LASTYEAR}-12-18`, closed_by: PROFILES[3].email, closed_at: `${LASTYEAR}-12-18T10:00:00.000Z`,
    close_note: "Contract ended", updated_by: ME.email }]);
  const closed = db.t("mission_register").find((r) => r.board_id === "b1" && r.number === N("BANGN", "0090"));
  if (closed) Object.assign(closed, { status: "closed", closed_on: ended[ended.length - 1], closed_by: PROFILES[3].email, closed_at: new Date().toISOString(), close_note: "Contract ended" });
  // ...and the Etraq number of the Alpha Industry job, which ran on a temporary number until three days ago ("New number · was …" on its card for two weeks)
  const renumbered = MISSIONS.b1.find((m) => m[7] && m[7].renumbered);
  db.seed("mission_number_history", [{ id: "mnh-1", old_number: fill(renumbered[7].renumbered), new_number: mnum(renumbered), valid_from: TODAY.slice(0, 4) + "-01-01",
    entered_by: "ploy.s@trigo-group.com", entered_at: new Date(Date.now() - 3 * 86400e3).toISOString() }]);
  db.seed("assignments", assignments);
  db.seed("deployment_history", history);
  db.seed("employee_loans", [{ id: "loan-1", employee_id: LOANED, to_board_id: "b1", start_date: TODAY, end_date: addDays(NEXT, 2), note: "Extra on-call cover at Laem Chabang", created_by: ME.email }]);

  // the first forecast day on both boards, held by Narin
  const fmap = {}, fcM = [], fcA = [];
  for (const b of BOARDS) {
    const fc = dayPlan(b.id, FORECAST, 3, emps, { loanOut: b.id === "b2" ? LOANED : undefined });
    // Rayong's no-crew mission is not forecast yet
    const kept = fc.missions.filter((m) => !(b.id === "b2" && m.number === N("RYGTH", "0107")));
    for (const m of kept) {
      const id = m.id.replace("m-", "f-"); fmap[m.id] = id;
      fcM.push({ id, board_id: m.board_id, plan_date: m.plan_date, number: m.number, host: m.host, customer: m.customer, shift: m.shift, start_time: m.start_time, end_time: m.end_time, engineer_id: m.engineer_id, created_by: PROFILES[1].email });
    }
    fcA.push(...fc.assignments.filter((a) => !a.mission_id || fmap[a.mission_id]).map((a) => ({
      employee_id: a.employee_id, plan_date: a.plan_date, forecast_mission_id: a.mission_id ? fmap[a.mission_id] : null, zone: a.zone, held_by: PROFILES[1].email,
    })));
  }
  // the temporary number's three days count from when it was first registered
  const temp = db.t("mission_register").find((r) => r.number === N("RYGTH", "TMP001"));
  if (temp) temp.created_at = new Date(Date.now() - 5 * 86400e3).toISOString();
  db.seed("forecast_missions", fcM);
  db.seed("forecast_assignments", fcA);

  // Capacity needs no rows of its own: the tab reads the boards above, and a visitor's
  // requests stay in their own browser.
  // "my part is planned": on Non-Rayong's next working day Narin has ticked his part, the others not yet
  db.seed("plan_day_ready", [{ board_id: "b1", plan_date: NEXT, engineer_id: "eng-1", ticked_by: PROFILES[1].email,
    ticked_at: new Date(Date.now() - 40 * 60e3).toISOString() }]);
  return { emps };
}

const api = { seed, ME, PROFILES, TODAY, NEXT, FORECAST, BOARDS };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.DemoSeed = api;

})(typeof window !== "undefined" ? window : globalThis);
