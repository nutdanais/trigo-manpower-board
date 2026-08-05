-- Adds: mission remark field, employee mobile number field.
-- Safe to run more than once.

alter table missions add column if not exists remark text;
alter table employees add column if not exists phone text;
