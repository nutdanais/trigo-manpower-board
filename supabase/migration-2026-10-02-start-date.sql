-- Migration 2026-10-02: employee start date (first day of work)
-- Run once in the Supabase SQL Editor (safe to re-run). Then redeploy the app.
--
--   1. adds the optional employees.start_date column (existing people keep it
--      empty until someone fills it in on the Edit Employee form);
--   2. fills it for the 82 people in "รายชื่อ LCB Port 01-Oct-2026.xlsx"
--      (sheet รายชื่อ2026, column "Start Date"). People are matched by their
--      Thai full name, spaces tidied — exactly how migration-2026-10-01 stored
--      them. Names are unique across the roster (the app refuses a duplicate),
--      so this does not depend on which board someone is on today.
--
-- Re-running never overwrites a start date that is already filled in, so a date
-- corrected by hand in the app is safe. Anyone in the list who isn't found is
-- reported as a NOTICE (e.g. renamed since the import) rather than failing.

alter table employees add column if not exists start_date date;

do $$
declare
  r record;
  n int;
  v_set int := 0;
begin
  for r in
    select * from (values
    ('นาตยา คล้ายคลี่', date '2023-04-20'),
    ('วาสนา ภูโต', date '2023-04-20'),
    ('ณารัฐติกาญจน์ มะลิหวล', date '2023-04-20'),
    ('ปัญญา นาลาด', date '2023-04-20'),
    ('ปนัดดา แสนสิริ', date '2023-04-20'),
    ('ขนิษฐา วรชินา', date '2023-04-20'),
    ('นิตยา ชุมพร', date '2023-05-03'),
    ('ประกายฟ้า มาพะเนา', date '2023-05-03'),
    ('ฮีดายะห์ สูเด็ง', date '2023-05-03'),
    ('นันท์วุฒิ อิ่มกมล', date '2023-05-25'),
    ('ธิดา เลิศวานิชย์กุล', date '2023-05-25'),
    ('ณัฐดนัย ผ่องแผ้ว', date '2023-05-25'),
    ('วิชัย คงวงค์', date '2023-05-25'),
    ('ธีระศักดิ์ ดวงจิตร', date '2023-07-05'),
    ('ชัยรัตน์ วรชินา', date '2023-07-05'),
    ('ฐิติมา หวังแซงกลาง', date '2023-07-05'),
    ('ภัทรดนัย ศรีชัยยา', date '2023-07-05'),
    ('พรพรรณ เพ็ชรรินทร์', date '2023-07-05'),
    ('ฉลาด มั่นคง', date '2023-07-05'),
    ('ไพลิน เบาคำ', date '2023-07-05'),
    ('ธนกร สาลีคงชัย', date '2023-08-11'),
    ('อามีเนาะห์ สูเด็ง', date '2023-08-15'),
    ('จิราภรณ์ ณะกลองดี', date '2023-08-15'),
    ('สุดารัตน์ นันทะวงค์', date '2023-08-15'),
    ('นพดล ปียะ', date '2023-10-16'),
    ('วีระพล จบศรี', date '2023-10-16'),
    ('ศิริวุฒิ เมืองสุข', date '2024-02-13'),
    ('จรยุทธ เกื้อกูล', date '2024-02-13'),
    ('สุรีนารถ พยัคกูล', date '2024-02-13'),
    ('อดิศร คนหมั่น', date '2024-02-13'),
    ('กฤษณพงศ์ ไชยมูละ', date '2024-02-13'),
    ('สุพัตรา ศิลาชัย', date '2024-02-13'),
    ('อัฎพร สอนซี', date '2024-02-13'),
    ('ธิฆัมภรณ์ คำผุย', date '2024-03-01'),
    ('จิรัญญา ทศพิมพ์', date '2025-03-01'),
    ('กิ่งเพชร สีโม้', date '2024-03-05'),
    ('อัจฉรา ภุมรินทร์', date '2024-03-05'),
    ('วีระศักดิ์ บุญอาจ', date '2024-03-05'),
    ('นพรัตน์ ชมภูนุช', date '2024-04-08'),
    ('สุธิชา ประสาร', date '2024-04-25'),
    ('วรรนิศา ศรียัง', date '2024-06-07'),
    ('รพีพร ชินพันธ์', date '2024-06-13'),
    ('มีศักดิ์ สุขเพิ่ม', date '2024-07-01'),
    ('บุษบา มาตรวิจิตร', date '2024-08-06'),
    ('ครรชิต พูลผกา', date '2024-08-06'),
    ('เกียรติสุดา อ่างงาม', date '2024-08-21'),
    ('อรนุช รูปหล่อ', date '2024-09-02'),
    ('นิลนิญา ไสวกุล', date '2024-10-08'),
    ('เล็ก ตองติดรัมย์', date '2024-03-01'),
    ('จิรชยา มีบ่าว', date '2025-03-07'),
    ('จิตรานุช บุญทั่ง', date '2025-03-07'),
    ('ภรณ์พิพัฒน์ จินดา', date '2025-05-06'),
    ('กัญญารัตน์ พูลสาริกิจ', date '2025-05-06'),
    ('ศิริวัฒน์ คำภาบุตร', date '2025-05-07'),
    ('โสภิน สุขล้นเหลือ', date '2025-01-29'),
    ('ภานุพงศ์ ทองอยู่', date '2023-10-16'),
    ('ดวงใจ ชงวิชัย', date '2024-02-13'),
    ('ณัฐกาล คมศรโมกข์', date '2025-08-12'),
    ('นิวัฒน์ จิรัฏฐ์รุจ', date '2025-08-12'),
    ('วัชรพงษ์ หอมเย็น', date '2025-08-21'),
    ('วาสนา ทองพาทำ', date '2025-10-13'),
    ('ดาวุฒิ แว่นแก้ว', date '2025-12-24'),
    ('สุริยันต์ กุลสำโรง', date '2026-01-13'),
    ('โสภา ยศหาญ', date '2026-01-22'),
    ('อนุรักษ์ วรรณชิยา', date '2026-01-22'),
    ('นรินทร์ธิรา พรหมศิริ', date '2026-01-22'),
    ('ทวีศักดิ์ ตนภู', date '2026-02-02'),
    ('ศิริพร มือชัยภูมิ', date '2026-02-18'),
    ('ธนายุทธ นาคทอง', date '2026-03-24'),
    ('สุมินท์ตา เกณชัยภูมิ', date '2026-05-12'),
    ('ภัทระ พรหมจันทร์', date '2026-06-02'),
    ('ดุสิต พรหมจันทร์', date '2026-06-02'),
    ('วรภพ วรรณชิยา', date '2026-06-20'),
    ('กัญญารัตน์ แก้วเหล็ก', date '2026-06-20'),
    ('ณิชานันท์ ทองพาทำ', date '2026-07-07'),
    ('ศิริรุ่งธโสพาพร โนนเวียงแก', date '2026-07-21'),
    ('นิธิธาดา ราศรี', date '2026-07-21'),
    ('กัญนิกา มัหวัง', date '2026-07-22'),
    ('จินตหรา ดีเพียร', date '2026-08-17'),
    ('วรรณศา ขาวหมดจด', date '2026-08-17'),
    ('เกียรติดนัย คมศรโมกข์', date '2026-09-03'),
    ('ภานุณุพงษ์ ปานแดง', date '2026-09-23')
    ) as v(name, start_date)
  loop
    update employees set start_date = r.start_date
     where name = r.name and start_date is null;
    get diagnostics n = row_count;
    v_set := v_set + n;
    if n = 0 and not exists (select 1 from employees where name = r.name) then
      raise notice 'No employee named % — start date % not applied', r.name, r.start_date;
    end if;
  end loop;
  raise notice 'Start date filled in for % employee(s)', v_set;
end $$;
