-- Behavioural tests for migration-2026-09-29-forecast-merge-review.sql.
-- Run against a database built by tests/sql/setup-db.sh:
--   psql -v ON_ERROR_STOP=1 -d <db> -f tests/sql/forecast-merge-review.test.sql
-- Any failed assertion raises and stops the script. Fixtures are fake people
-- on example.com — nothing real.

\set QUIET on
\pset tuples_only on
\o /dev/null
set client_min_messages = warning;

-- ---------- fixtures ----------
delete from allowed_email_domains;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'eng.a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'eng.b@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer.c@example.com');
update profiles set status = 'active', role_key = 'engineer' where email in ('eng.a@example.com', 'eng.b@example.com');
update profiles set status = 'active', role_key = 'viewer'   where email = 'viewer.c@example.com';

insert into boards (id, name) values ('10000000-0000-0000-0000-000000000001', 'Board One'),
                                     ('10000000-0000-0000-0000-000000000002', 'Board Two');
insert into employees (id, name_th, contract, board_id) values
  ('20000000-0000-0000-0000-000000000001', 'Test Person 1', 'permanent', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', 'Test Person 2', 'oncall',    '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000003', 'Test Person 3', 'permanent', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000009', 'Test Person 9', 'permanent', '10000000-0000-0000-0000-000000000002');

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
create or replace function t.d() returns date language sql as $$ select (now() at time zone 'Asia/Bangkok')::date + 1 $$;
set client_min_messages = notice;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

-- eng.b forecast mission F1 (created) and F2 (edited by eng.b); holds:
-- P1 on F1 by eng.b, P2 on annual leave by eng.a (the planner's own), P3 on F1 by 'migrated'
insert into forecast_missions (id, board_id, plan_date, number, host, customer, shift, created_by, updated_by) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', t.d(), 'F1', 'Host X', 'Cust Y', 'day', 'eng.b@example.com', null),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', t.d(), 'F2', 'Host X', 'Cust Y', 'day', 'eng.a@example.com', 'eng.b@example.com');
insert into forecast_assignments (employee_id, plan_date, forecast_mission_id, zone, held_by) values
  ('20000000-0000-0000-0000-000000000001', t.d(), '40000000-0000-0000-0000-000000000001', null, 'eng.b@example.com'),
  ('20000000-0000-0000-0000-000000000002', t.d(), null, 'annual', 'eng.a@example.com'),
  ('20000000-0000-0000-0000-000000000003', t.d(), '40000000-0000-0000-0000-000000000001', null, 'migrated');

-- ---------- 1. a viewer can't record a merge ----------
select t.as_user('viewer.c@example.com');
set role authenticated;
do $$ begin
  perform public.record_forecast_merge('10000000-0000-0000-0000-000000000001', t.d(), '[]'::jsonb);
  raise exception 'FAILED: viewer recorded a merge';
exception when insufficient_privilege then raise notice 'ok - a viewer cannot record a merge';
end $$;
reset role;

-- ---------- 2. an employee from another board is refused, nothing written ----------
select t.as_user('eng.a@example.com');
set role authenticated;
do $$ begin
  perform public.record_forecast_merge('10000000-0000-0000-0000-000000000001', t.d(),
    '[{"type":"person","choice":"carry","employee_id":"20000000-0000-0000-0000-000000000009"}]'::jsonb);
  raise exception 'FAILED: another board''s employee was accepted';
exception when check_violation then raise notice 'ok - an employee from another board is refused';
end $$;
reset role;
select t.check((select count(*) = 0 from forecast_merge_decisions), 'a refused merge writes no decision');

-- ---------- 3. the merge ----------
select t.as_user('eng.a@example.com');
set role authenticated;
select public.record_forecast_merge('10000000-0000-0000-0000-000000000001', t.d(), '[
  {"type":"person","choice":"carry","employee_id":"20000000-0000-0000-0000-000000000001","mission_number":"F1","mission_shift":"day",
   "carry_value":"101 Day","forecast_value":"F1 Day","reason":"  Needed on site  ","forecaster":"viewer.c@example.com"},
  {"type":"person","choice":"carry","employee_id":"20000000-0000-0000-0000-000000000002","carry_value":"101 Day","forecast_value":"Annual Leave"},
  {"type":"person","choice":"carry","employee_id":"20000000-0000-0000-0000-000000000003","carry_value":"101 Day","forecast_value":"F1 Day"},
  {"type":"field","choice":"carry","mission_number":"F2","mission_shift":"day","field":"startTime","carry_value":"08:00","forecast_value":"07:00"},
  {"type":"add","choice":"forecast","mission_number":"F1","mission_shift":"day","carry_value":"","forecast_value":"F1 Day"},
  {"type":"remove","choice":"carry","mission_number":"102","mission_shift":"day","carry_value":"Keep","forecast_value":"Not in forecast"}
]'::jsonb);
reset role;

select t.check((select count(*) = 6 from forecast_merge_decisions), 'one decision row per item');
select t.check((select count(distinct merge_id) = 1 and bool_and(merged_by = 'eng.a@example.com') from forecast_merge_decisions),
  'all rows share one merge id and name the planner');
select t.check(
  (select forecaster = 'eng.b@example.com' and reason = 'Needed on site' from forecast_merge_decisions
    where employee_id = '20000000-0000-0000-0000-000000000001'),
  'the forecaster comes from the hold, not from the browser; the reason is trimmed');
select t.check(
  (select forecaster = 'eng.b@example.com' from forecast_merge_decisions where item_type = 'field'),
  'a changed mission detail is attributed to its last editor');
select t.check(
  (select forecaster = 'eng.b@example.com' from forecast_merge_decisions where item_type = 'add'),
  'a new mission is attributed to its creator');
select t.check(
  (select forecaster is null from forecast_merge_decisions where item_type = 'remove'),
  'a mission the forecast left out has no forecaster');

select t.check((select count(*) = 2 from forecast_hold_events where kind = 'merge'),
  'alerts only for carry choices over someone else''s forecast (not self, not migrated, not forecast choices)');
select t.check(
  (select from_held_by = 'eng.b@example.com' and taken_by = 'eng.a@example.com' and reason = 'Needed on site'
          and from_forecast_mission_id = '40000000-0000-0000-0000-000000000001' and acknowledged_at is null
     from forecast_hold_events where kind = 'merge' and employee_id = '20000000-0000-0000-0000-000000000001'),
  'the person alert goes to the holder, names the planner and carries the reason');
select t.check(
  (select employee_id is null and detail ->> 'field' = 'startTime' and detail ->> 'forecast_value' = '07:00'
          and from_forecast_mission_id = '40000000-0000-0000-0000-000000000002'
     from forecast_hold_events where kind = 'merge' and employee_id is null),
  'a mission-detail alert has no employee and says what was not used');
select t.check(
  (select forecast_merged_by = 'eng.a@example.com' and forecast_merged_at is not null from plan_day_stamps
    where board_id = '10000000-0000-0000-0000-000000000001' and plan_date = t.d()),
  'the day is stamped as merged');

-- ---------- 4. the log can't be written or edited directly ----------
select t.as_user('eng.a@example.com');
set role authenticated;
do $$ begin
  insert into forecast_merge_decisions (merge_id, board_id, plan_date, item_type, choice, merged_by)
  values (gen_random_uuid(), '10000000-0000-0000-0000-000000000001', t.d(), 'person', 'carry', 'x');
  raise exception 'FAILED: direct insert into the log';
exception when insufficient_privilege then raise notice 'ok - the log can''t be written directly';
end $$;
update forecast_merge_decisions set choice = 'forecast';
select t.check((select count(*) = 0 from forecast_merge_decisions where choice = 'forecast' and item_type <> 'add'),
  'an update to the log silently touches nothing');
select t.check((select count(*) = 6 from forecast_merge_decisions), 'anyone active can read the log');
reset role;

-- ---------- 5. existing hold events are unchanged ----------
select t.as_user('eng.a@example.com');
set role authenticated;
select public.set_forecast_assignment('20000000-0000-0000-0000-000000000001', t.d(), null, 'sick');
reset role;
select t.check(
  (select kind = 'taken' from forecast_hold_events where kind <> 'merge' and employee_id = '20000000-0000-0000-0000-000000000001'),
  'taking a hold still records a ''taken'' event');
do $$ begin
  insert into forecast_hold_events (kind, employee_id, plan_date, from_held_by, taken_by) values ('taken', null, t.d(), 'x', 'y');
  raise exception 'FAILED: a taken event without an employee';
exception when check_violation then raise notice 'ok - only a merge alert may have no employee';
end $$;
select t.as_user('eng.b@example.com');
set role authenticated;
select public.acknowledge_hold_events(array(select id from forecast_hold_events where kind = 'merge'));
reset role;
select t.check((select bool_and(acknowledged_by = 'eng.b@example.com') from forecast_hold_events where kind = 'merge'),
  'merge alerts are acknowledged like any other');

\echo 'ALL FORECAST-MERGE-REVIEW SQL TESTS PASSED'
