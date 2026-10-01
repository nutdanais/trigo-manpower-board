-- Migration 2026-10-01: add the 82 people from "รายชื่อ LCB Port 01-Oct-2026.xlsx"
-- to a board called "LCB Port", each under their full Thai name.
-- Run once in the Supabase SQL Editor (safe to re-run — it never duplicates).
--
-- What it does:
--   1. creates the board "LCB Port" if it isn't there yet;
--   2. creates any service area the list uses that doesn't exist yet
--      (ESIE1, ESIE2, AAT, FTM, LCB) — existing areas are matched by name,
--      ignoring case, and left untouched;
--   3. inserts every person into LCB Port. employees.name is the Thai
--      full name (spaces tidied), so that's what the employee card shows;
--      the card clamps a name that doesn't fit to two lines and ends it
--      with an ellipsis (see .emp-name in styles.css).
--
-- Notes on the source sheet:
--   * Every row of the sheet goes to LCB Port, including the 44 rows whose
--     สังกัด is Rayong — their service area (FTM/AAT/ESIE1/ESIE2) is kept, so
--     they stay told apart from the LCB area on the card.
--   * Contract comes from "Contract Type" (Permanent / On-call). The last row
--     (ภานุณุพงษ์ ปานแดง, started 2026-09-23) has no contract type, status or
--     service area in the sheet: it is loaded as on-call with no area — set
--     both from the Manpower List.
--   * Someone whose Thai name already exists on LCB Port is skipped, which is
--     what makes a re-run harmless. The same name on a *different* board is
--     not detected: check the Manpower List for duplicates after running.

do $$
declare
  v_board uuid;
begin
  select id into v_board from boards where lower(name) = 'lcb port' order by created_at limit 1;
  if v_board is null then
    insert into boards (name) values ('LCB Port') returning id into v_board;
  end if;

  insert into service_areas (name, color)
  select v.name, v.color from (values
    ('LCB',   '#f28ba0'),
    ('FTM',   '#7fb8ec'),
    ('AAT',   '#f6a06b'),
    ('ESIE1', '#a8d98a'),
    ('ESIE2', '#f7dd6c')
  ) as v(name, color)
  where not exists (select 1 from service_areas a where lower(a.name) = lower(v.name));

  insert into employees (name, contract, area_id, board_id)
  select v.name, v.contract,
         (select a.id from service_areas a where lower(a.name) = lower(v.area) order by a.name limit 1),
         v_board
  from (values
    ('นาตยา คล้ายคลี่', 'permanent', 'ESIE2'),
    ('วาสนา ภูโต', 'permanent', 'ESIE2'),
    ('ณารัฐติกาญจน์ มะลิหวล', 'permanent', 'ESIE1'),
    ('ปัญญา นาลาด', 'permanent', 'ESIE2'),
    ('ปนัดดา แสนสิริ', 'permanent', 'ESIE1'),
    ('ขนิษฐา วรชินา', 'permanent', 'ESIE1'),
    ('นิตยา ชุมพร', 'permanent', 'AAT'),
    ('ประกายฟ้า มาพะเนา', 'permanent', 'AAT'),
    ('ฮีดายะห์ สูเด็ง', 'permanent', 'FTM'),
    ('นันท์วุฒิ อิ่มกมล', 'permanent', 'FTM'),
    ('ธิดา เลิศวานิชย์กุล', 'permanent', 'FTM'),
    ('ณัฐดนัย ผ่องแผ้ว', 'permanent', 'FTM'),
    ('วิชัย คงวงค์', 'oncall', 'FTM'),
    ('ธีระศักดิ์ ดวงจิตร', 'permanent', 'FTM'),
    ('ชัยรัตน์ วรชินา', 'oncall', 'FTM'),
    ('ฐิติมา หวังแซงกลาง', 'permanent', 'FTM'),
    ('ภัทรดนัย ศรีชัยยา', 'permanent', 'FTM'),
    ('พรพรรณ เพ็ชรรินทร์', 'permanent', 'ESIE2'),
    ('ฉลาด มั่นคง', 'permanent', 'ESIE2'),
    ('ไพลิน เบาคำ', 'permanent', 'ESIE1'),
    ('ธนกร สาลีคงชัย', 'oncall', 'FTM'),
    ('อามีเนาะห์ สูเด็ง', 'oncall', 'FTM'),
    ('จิราภรณ์ ณะกลองดี', 'oncall', 'FTM'),
    ('สุดารัตน์ นันทะวงค์', 'oncall', 'FTM'),
    ('นพดล ปียะ', 'permanent', 'ESIE1'),
    ('วีระพล จบศรี', 'permanent', 'FTM'),
    ('ศิริวุฒิ เมืองสุข', 'oncall', 'FTM'),
    ('จรยุทธ เกื้อกูล', 'permanent', 'AAT'),
    ('สุรีนารถ พยัคกูล', 'permanent', 'FTM'),
    ('อดิศร คนหมั่น', 'permanent', 'AAT'),
    ('กฤษณพงศ์ ไชยมูละ', 'permanent', 'FTM'),
    ('สุพัตรา ศิลาชัย', 'permanent', 'FTM'),
    ('อัฎพร สอนซี', 'permanent', 'FTM'),
    ('ธิฆัมภรณ์ คำผุย', 'permanent', 'AAT'),
    ('จิรัญญา ทศพิมพ์', 'permanent', 'AAT'),
    ('กิ่งเพชร สีโม้', 'permanent', 'LCB'),
    ('อัจฉรา ภุมรินทร์', 'oncall', 'LCB'),
    ('วีระศักดิ์ บุญอาจ', 'permanent', 'LCB'),
    ('นพรัตน์ ชมภูนุช', 'permanent', 'FTM'),
    ('สุธิชา ประสาร', 'oncall', 'FTM'),
    ('วรรนิศา ศรียัง', 'oncall', 'LCB'),
    ('รพีพร ชินพันธ์', 'oncall', 'LCB'),
    ('มีศักดิ์ สุขเพิ่ม', 'permanent', 'FTM'),
    ('บุษบา มาตรวิจิตร', 'permanent', 'LCB'),
    ('ครรชิต พูลผกา', 'oncall', 'LCB'),
    ('เกียรติสุดา อ่างงาม', 'permanent', 'AAT'),
    ('อรนุช รูปหล่อ', 'oncall', 'LCB'),
    ('นิลนิญา ไสวกุล', 'oncall', 'LCB'),
    ('เล็ก ตองติดรัมย์', 'permanent', 'FTM'),
    ('จิรชยา มีบ่าว', 'oncall', 'LCB'),
    ('จิตรานุช บุญทั่ง', 'oncall', 'LCB'),
    ('ภรณ์พิพัฒน์ จินดา', 'oncall', 'LCB'),
    ('กัญญารัตน์ พูลสาริกิจ', 'oncall', 'LCB'),
    ('ศิริวัฒน์ คำภาบุตร', 'oncall', 'LCB'),
    ('โสภิน สุขล้นเหลือ', 'oncall', 'FTM'),
    ('ภานุพงศ์ ทองอยู่', 'permanent', 'FTM'),
    ('ดวงใจ ชงวิชัย', 'permanent', 'ESIE1'),
    ('ณัฐกาล คมศรโมกข์', 'oncall', 'LCB'),
    ('นิวัฒน์ จิรัฏฐ์รุจ', 'oncall', 'LCB'),
    ('วัชรพงษ์ หอมเย็น', 'oncall', 'LCB'),
    ('วาสนา ทองพาทำ', 'oncall', 'LCB'),
    ('ดาวุฒิ แว่นแก้ว', 'oncall', 'LCB'),
    ('สุริยันต์ กุลสำโรง', 'oncall', 'LCB'),
    ('โสภา ยศหาญ', 'oncall', 'LCB'),
    ('อนุรักษ์ วรรณชิยา', 'oncall', 'LCB'),
    ('นรินทร์ธิรา พรหมศิริ', 'oncall', 'LCB'),
    ('ทวีศักดิ์ ตนภู', 'oncall', 'FTM'),
    ('ศิริพร มือชัยภูมิ', 'oncall', 'LCB'),
    ('ธนายุทธ นาคทอง', 'oncall', 'LCB'),
    ('สุมินท์ตา เกณชัยภูมิ', 'oncall', 'LCB'),
    ('ภัทระ พรหมจันทร์', 'oncall', 'LCB'),
    ('ดุสิต พรหมจันทร์', 'oncall', 'LCB'),
    ('วรภพ วรรณชิยา', 'oncall', 'LCB'),
    ('กัญญารัตน์ แก้วเหล็ก', 'oncall', 'LCB'),
    ('ณิชานันท์ ทองพาทำ', 'oncall', 'LCB'),
    ('ศิริรุ่งธโสพาพร โนนเวียงแก', 'oncall', 'LCB'),
    ('นิธิธาดา ราศรี', 'oncall', 'LCB'),
    ('กัญนิกา มัหวัง', 'oncall', 'LCB'),
    ('จินตหรา ดีเพียร', 'oncall', 'LCB'),
    ('วรรณศา ขาวหมดจด', 'oncall', 'LCB'),
    ('เกียรติดนัย คมศรโมกข์', 'oncall', 'LCB'),
    ('ภานุณุพงษ์ ปานแดง', 'oncall', null::text)
  ) as v(name, contract, area)
  where not exists (select 1 from employees e where e.board_id = v_board and e.name = v.name);
end $$;
