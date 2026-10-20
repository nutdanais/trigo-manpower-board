-- Behavioural tests for migration-2026-10-20-employee-loans.sql (and the same
-- table in schema.sql). Run against a database built by tests/sql/setup-db.sh:
--   psql -v ON_ERROR_STOP=1 -d <db> -f supabase/migration-2026-10-20-employee-loans.sql   (re-run: safe)
--   psql -v ON_ERROR_STOP=1 -d <db> -f tests/sql/employee-loans.test.sql
-- Any failed assertion raises and stops the script. Fixtures are fake people
-- on example.com — nothing real.

\set QUIET on
\pset tuples_only on
\o /dev/null
set client_min_messages = warning;

delete from allowed_email_domains;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'eng.a@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer.c@example.com');
update profiles set status = 'active', role_key = 'engineer' where email = 'eng.a@example.com';
update profiles set status = 'active', role_key = 'viewer'   where email = 'viewer.c@example.com';

insert into boards (id, name) values ('10000000-0000-0000-0000-000000000001', 'Board One'),
                                     ('10000000-0000-0000-0000-000000000002', 'Board Two');
insert into employees (id, name_th, contract, board_id) values
  ('20000000-0000-0000-0000-000000000001', 'Test Person 1', 'permanent', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', 'Test Person 2', 'permanent', '10000000-0000-0000-0000-000000000001');

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
create or replace function t.d(p_days int) returns date language sql as $$
  select (now() at time zone 'Asia/Bangkok')::date + p_days
$$;
set client_min_messages = notice;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

-- ---------- 1. who may lend ----------
select t.as_user('eng.a@example.com');
set role authenticated;
insert into employee_loans (employee_id, to_board_id, start_date, end_date, created_by)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', t.d(1), t.d(3), 'eng.a@example.com');
reset role;
select t.check((select count(*) = 1 from employee_loans), 'an engineer (Board = Edit) can lend');

select t.as_user('viewer.c@example.com');
set role authenticated;
do $$ begin
  insert into employee_loans (employee_id, to_board_id, start_date, end_date)
  values ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', t.d(1), t.d(1));
  raise exception 'FAILED: a viewer could lend';
exception when insufficient_privilege then raise notice 'ok - a viewer cannot lend';
end $$;
select t.check((select count(*) = 1 from employee_loans), 'a viewer can read loans');
reset role;

do $$ begin
  insert into employee_loans (employee_id, to_board_id, start_date, end_date)
  values ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', t.d(3), t.d(1));
  raise exception 'FAILED: an end before the start was accepted';
exception when check_violation then raise notice 'ok - the end date can''t be before the start';
end $$;

-- ---------- 2. effective_board ----------
select t.check(public.effective_board('20000000-0000-0000-0000-000000000001', t.d(0)) = '10000000-0000-0000-0000-000000000001', 'the day before the loan: own board');
select t.check(public.effective_board('20000000-0000-0000-0000-000000000001', t.d(1)) = '10000000-0000-0000-0000-000000000002', 'first day of the loan: the borrowing board');
select t.check(public.effective_board('20000000-0000-0000-0000-000000000001', t.d(3)) = '10000000-0000-0000-0000-000000000002', 'last day of the loan: the borrowing board');
select t.check(public.effective_board('20000000-0000-0000-0000-000000000001', t.d(4)) = '10000000-0000-0000-0000-000000000001', 'the day after: back on own board');
select t.check(public.effective_board('20000000-0000-0000-0000-000000000002', t.d(1)) = '10000000-0000-0000-0000-000000000001', 'someone not lent: own board');

-- ---------- 3. the day's stamp goes to the board they work on ----------
select t.as_user('eng.a@example.com');
set role authenticated;
insert into missions (id, board_id, plan_date, number, host, customer, shift)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', t.d(2), 'B1', 'Host X', 'Cust Y', 'day');
reset role;
delete from plan_day_stamps;
select t.as_user('eng.a@example.com');
set role authenticated;
insert into assignments (employee_id, plan_date, mission_id)
values ('20000000-0000-0000-0000-000000000001', t.d(2), '30000000-0000-0000-0000-000000000001');
reset role;
select t.check((select count(*) = 1 from plan_day_stamps where board_id = '10000000-0000-0000-0000-000000000002' and plan_date = t.d(2)),
  'placing a borrowed person stamps the borrowing board');
select t.check((select count(*) = 0 from plan_day_stamps where board_id = '10000000-0000-0000-0000-000000000001'),
  'and not their own board');

-- ---------- 4. cascades ----------
delete from employees where id = '20000000-0000-0000-0000-000000000001';
select t.check((select count(*) = 0 from employee_loans), 'deleting the employee removes their loans');

\o
select 'all employee loan checks passed';
