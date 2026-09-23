-- Behavioural tests for migration-2026-09-24-forward-planning.sql.
-- Run against a database built by tests/sql/setup-db.sh:
--   psql -v ON_ERROR_STOP=1 -d <db> -f tests/sql/forward-planning.test.sql
-- Any failed assertion raises and stops the script. Fixtures are fake people
-- on example.com — nothing real.

\set QUIET on
\pset tuples_only on
\o /dev/null
set client_min_messages = warning;

-- ---------- fixtures ----------
-- the domain rule is covered elsewhere; fixtures use example.com addresses
delete from allowed_email_domains;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'eng.a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'eng.b@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer.c@example.com');
update profiles set status = 'active', role_key = 'engineer' where email in ('eng.a@example.com', 'eng.b@example.com');
update profiles set status = 'active', role_key = 'viewer'   where email = 'viewer.c@example.com';

insert into boards (id, name) values ('10000000-0000-0000-0000-000000000001', 'Board One'),
                                     ('10000000-0000-0000-0000-000000000002', 'Board Two');
insert into employees (id, name, contract, board_id) values
  ('20000000-0000-0000-0000-000000000001', 'Test Person 1', 'permanent', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', 'Test Person 2', 'oncall',    '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000003', 'Test Person 3', 'permanent', '10000000-0000-0000-0000-000000000002');

create schema if not exists t;
create or replace function t.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'email', p_email)::text, false);
end $$;
create or replace function t.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAILED: %', p_what; end if;
  raise notice 'ok - %', p_what;
end $$;
set client_min_messages = notice;

grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

-- ---------- 1. stamps: trigger bumps on insert / update / delete ----------
select t.as_user('eng.a@example.com');
set role authenticated;
insert into missions (id, board_id, plan_date, number, host, customer, shift)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        (now() at time zone 'Asia/Bangkok')::date, 'M1', 'Host X', 'Cust Y', 'day');
insert into assignments (employee_id, plan_date, mission_id)
values ('20000000-0000-0000-0000-000000000001', (now() at time zone 'Asia/Bangkok')::date, '30000000-0000-0000-0000-000000000001');
reset role;

select t.check(
  (select last_edited_by = 'eng.a@example.com' and last_edited_at is not null
     from plan_day_stamps where board_id = '10000000-0000-0000-0000-000000000001'
      and plan_date = (now() at time zone 'Asia/Bangkok')::date),
  'mission/assignment insert stamps the day with the editor''s email');

update plan_day_stamps set last_edited_at = now() - interval '1 hour';
select t.as_user('eng.b@example.com');
set role authenticated;
delete from assignments where employee_id = '20000000-0000-0000-0000-000000000001';
reset role;
select t.check(
  (select last_edited_by = 'eng.b@example.com' and last_edited_at > now() - interval '1 minute'
     from plan_day_stamps where board_id = '10000000-0000-0000-0000-000000000001'
      and plan_date = (now() at time zone 'Asia/Bangkok')::date),
  'deleting an assignment (unassign) bumps the stamp too');

-- ---------- 2. stamp_carry ----------
select t.as_user('eng.a@example.com');
set role authenticated;
select public.stamp_carry('10000000-0000-0000-0000-000000000001', (now() at time zone 'Asia/Bangkok')::date + 1,
                          (now() at time zone 'Asia/Bangkok')::date);
reset role;
select t.check(
  (select carried_from = (now() at time zone 'Asia/Bangkok')::date and carried_at is not null
     from plan_day_stamps where board_id = '10000000-0000-0000-0000-000000000001'
      and plan_date = (now() at time zone 'Asia/Bangkok')::date + 1),
  'stamp_carry records source day and server time');

select t.as_user('viewer.c@example.com');
set role authenticated;
do $$ begin
  perform public.stamp_carry('10000000-0000-0000-0000-000000000001', current_date, current_date);
  raise exception 'FAILED: viewer could stamp a carry';
exception when insufficient_privilege then raise notice 'ok - viewer cannot stamp a carry';
end $$;
do $$ begin
  insert into plan_day_stamps (board_id, plan_date, carried_from) values ('10000000-0000-0000-0000-000000000001', current_date + 3, current_date);
  raise exception 'FAILED: viewer wrote plan_day_stamps directly';
exception when insufficient_privilege then raise notice 'ok - RLS stops a viewer writing plan_day_stamps';
end $$;
reset role;

-- ---------- 3. horizon backstop ----------
select t.as_user('eng.a@example.com');
set role authenticated;
insert into missions (board_id, plan_date, number, host, customer, shift)
values ('10000000-0000-0000-0000-000000000001', (now() at time zone 'Asia/Bangkok')::date + 10, 'H10', 'Host X', 'Cust Y', 'day');
do $$ begin
  insert into missions (board_id, plan_date, number, host, customer, shift)
  values ('10000000-0000-0000-0000-000000000001', (now() at time zone 'Asia/Bangkok')::date + 11, 'H11', 'Host X', 'Cust Y', 'day');
  raise exception 'FAILED: a confirmed mission 11 days ahead was accepted';
exception when insufficient_privilege then raise notice 'ok - RLS rejects a confirmed mission beyond +10 days';
end $$;
do $$ begin
  insert into assignments (employee_id, plan_date, zone)
  values ('20000000-0000-0000-0000-000000000002', (now() at time zone 'Asia/Bangkok')::date + 30, 'annual');
  raise exception 'FAILED: a confirmed assignment 30 days ahead was accepted';
exception when insufficient_privilege then raise notice 'ok - RLS rejects a confirmed assignment beyond +10 days';
end $$;
insert into missions (board_id, plan_date, number, host, customer, shift)
values ('10000000-0000-0000-0000-000000000001', date '2020-01-06', 'PAST', 'Host X', 'Cust Y', 'day');
reset role;
select t.check((select count(*) = 1 from missions where number = 'H10'), 'a confirmed mission exactly +10 days is allowed');
select t.check((select count(*) = 1 from missions where number = 'PAST'), 'past dates are unaffected by the backstop');

-- ---------- 4. forecast holds ----------
insert into forecast_missions (id, board_id, plan_date, number, host, customer, shift, created_by)
values ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', current_date + 12, 'F123', 'Host X', 'Cust Y', 'day', 'eng.a@example.com'),
       ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', current_date + 12, 'F456', 'Host X', 'Cust Y', 'day', 'eng.b@example.com'),
       ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', current_date + 12, 'OTHER', 'Host X', 'Cust Y', 'day', 'eng.b@example.com');

select t.as_user('eng.a@example.com');
set role authenticated;
select public.set_forecast_assignment('20000000-0000-0000-0000-000000000001', current_date + 12, '40000000-0000-0000-0000-000000000001', null);
-- A re-arranging A's own hold: no event
select public.set_forecast_assignment('20000000-0000-0000-0000-000000000001', current_date + 12, null, 'annual');
select public.set_forecast_assignment('20000000-0000-0000-0000-000000000001', current_date + 12, '40000000-0000-0000-0000-000000000001', null);
do $$ begin
  perform public.set_forecast_assignment('20000000-0000-0000-0000-000000000001', current_date + 12, '40000000-0000-0000-0000-000000000003', null);
  raise exception 'FAILED: placed an employee on another board''s forecast mission';
exception when check_violation then raise notice 'ok - cannot place someone on another board''s forecast mission';
end $$;
reset role;
select t.check((select count(*) = 0 from forecast_hold_events), 'moving your own hold records no event');
select t.check((select held_by = 'eng.a@example.com' from forecast_assignments where employee_id = '20000000-0000-0000-0000-000000000001'),
  'placement records who holds the person');

select t.as_user('eng.b@example.com');
set role authenticated;
select t.check(
  (public.set_forecast_assignment('20000000-0000-0000-0000-000000000001', current_date + 12, '40000000-0000-0000-0000-000000000002', null)) ->> 'taken_from' = 'eng.a@example.com',
  'B taking A''s hold reports who lost the person');
reset role;
select t.check(
  (select count(*) = 1 from forecast_hold_events
    where from_held_by = 'eng.a@example.com' and taken_by = 'eng.b@example.com'
      and from_forecast_mission_id = '40000000-0000-0000-0000-000000000001'
      and to_forecast_mission_id = '40000000-0000-0000-0000-000000000002'
      and acknowledged_at is null),
  'B taking A''s hold writes one unacknowledged event, from A''s mission to B''s');
select t.check((select held_by = 'eng.b@example.com' from forecast_assignments where employee_id = '20000000-0000-0000-0000-000000000001'),
  'the hold now belongs to B');

select t.as_user('viewer.c@example.com');
set role authenticated;
do $$ begin
  perform public.set_forecast_assignment('20000000-0000-0000-0000-000000000002', current_date + 12, null, 'sick');
  raise exception 'FAILED: viewer placed a forecast hold';
exception when insufficient_privilege then raise notice 'ok - viewer cannot place forecast holds';
end $$;
do $$ begin
  perform public.acknowledge_hold_events(array(select id from forecast_hold_events));
  raise exception 'FAILED: viewer acknowledged an event';
exception when insufficient_privilege then raise notice 'ok - viewer cannot acknowledge';
end $$;
reset role;

select t.as_user('eng.a@example.com');
set role authenticated;
select t.check(public.acknowledge_hold_events(array(select id from forecast_hold_events)) = 1, 'A acknowledges the lost hold');
reset role;
select t.check((select acknowledged_by = 'eng.a@example.com' and acknowledged_at is not null from forecast_hold_events),
  'acknowledgement records who and when');

-- a hold the data migration could not attribute ('migrated') belongs to nobody
insert into forecast_assignments (employee_id, plan_date, zone, held_by)
values ('20000000-0000-0000-0000-000000000002', current_date + 12, 'sick', 'migrated');
select t.as_user('eng.b@example.com');
set role authenticated;
select public.set_forecast_assignment('20000000-0000-0000-0000-000000000002', current_date + 12, '40000000-0000-0000-0000-000000000002', null);
reset role;
select t.check((select count(*) = 1 from forecast_hold_events), 'taking a ''migrated'' hold records no event');

-- ---------- 5. capacity RLS ----------
select t.as_user('eng.a@example.com');
set role authenticated;
insert into capacity_demand (board_id, plan_date, host, shift, headcount) values ('10000000-0000-0000-0000-000000000001', current_date + 5, 'Host X', 'day', 12);
reset role;
select t.as_user('viewer.c@example.com');
set role authenticated;
select t.check((select count(*) = 1 from capacity_demand), 'a viewer can read capacity');
do $$ begin
  insert into capacity_demand (board_id, plan_date, host, shift, headcount) values ('10000000-0000-0000-0000-000000000001', current_date + 6, 'Host X', 'day', 3);
  raise exception 'FAILED: viewer wrote capacity_demand';
exception when insufficient_privilege then raise notice 'ok - RLS rejects a viewer''s capacity write';
end $$;
update capacity_demand set headcount = 99;
reset role;
select t.check((select headcount = 12 from capacity_demand), 'a viewer''s update silently touches nothing');

-- ---------- 6. cascades don't trip the stamp trigger ----------
delete from employees where id = '20000000-0000-0000-0000-000000000003';
delete from boards where id = '10000000-0000-0000-0000-000000000002';
select t.check(true, 'deleting an employee and a board still works with the stamp trigger in place');

-- ---------- 7. realtime publication ----------
select t.check(
  (select count(*) = 4 from pg_publication_tables where pubname = 'supabase_realtime'
     and tablename in ('capacity_demand', 'forecast_missions', 'forecast_assignments', 'forecast_hold_events')),
  'capacity and forecast tables are in the realtime publication');
select t.check(
  (select count(*) = 0 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'plan_day_stamps'),
  'plan_day_stamps is NOT in the realtime publication');

-- ---------- 8. seeded permissions ----------
select t.check(
  (select count(*) = 8 from role_permissions where area in ('capacity', 'forecast')
     and level = case when role_key = 'viewer' then 'view' else 'edit' end),
  'capacity and forecast are seeded: edit for admin/manager/engineer, view for viewer');

\echo 'ALL FORWARD-PLANNING SQL TESTS PASSED'
