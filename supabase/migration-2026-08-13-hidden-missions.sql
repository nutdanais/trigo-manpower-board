-- Adds: mission hidden flag (declutter the board without deleting the mission).
-- Safe to run more than once.

alter table missions add column if not exists hidden boolean not null default false;
