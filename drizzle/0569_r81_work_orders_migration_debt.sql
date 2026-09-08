-- R81 D1-04: pay the migration debt for platform.work_orders.
--
-- platform.work_orders was created on 2026-09-08 by Claude Chat via
-- execute_sql, NOT via a registered migration. That was recorded honestly
-- rather than concealed, in the table's own MIGRATION-DEBT row and in
-- platform.claude_log id 290, and it added one more table to fault E-103
-- (live tables with no migration file).
--
-- This file is that missing migration. The DDL below is reproduced verbatim
-- from platform.work_orders.notes where wo_ref='MIGRATION-DEBT' -- it is not
-- reconstructed from the live table, so the file and the recorded debt agree
-- by construction.
--
-- IF NOT EXISTS is deliberate and load-bearing here, for two reasons:
--   1. the table already exists live, so a plain CREATE would fail on every
--      environment that already has it;
--   2. compliance-tracker's CI runs a "Migration Replay From Empty" check
--      (E-103), so this must also succeed against an empty database.
-- Additive only: it creates, it never drops, renames or narrows anything.
--
-- Why hand-written: drizzle.config.ts sets schemaFilter: ['compliance'], so
-- `bun run db:generate` silently produces NOTHING for any platform.* object.
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.work_orders (
  id serial primary key,
  wo_ref text not null unique,
  title text not null,
  authored_on date not null,
  authored_by text not null default 'claude-chat',
  target_tool text not null default 'claude-code',
  scope_summary text,
  body text,
  body_location text,
  supersedes text,
  superseded_by text,
  executed_by_session text,
  closed_log_id int,
  status text not null default 'ISSUED',
  notes text,
  created_at timestamptz not null default now()
);
