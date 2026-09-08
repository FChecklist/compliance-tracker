-- R81 PHASE 4 -- the gap ledger.
--
-- WHY THIS FILE EXISTS AT ALL, WRITTEN AFTER THE FACT AND SAYING SO PLAINLY.
-- The table it creates was applied to the live database on 2026-09-08 through
-- Supabase's own migration path, which records into
-- `supabase_migrations.schema_migrations`. This repository does NOT read that
-- ledger. `bun db:migrate` (scripts/apply-migrations.mjs) and the CI replay
-- harness (scripts/replay-migrations-from-empty.mjs) both iterate
-- `drizzle/meta/_journal.json` and reconcile against
-- `drizzle.__drizzle_migrations` -- a second, independent ledger whose
-- watermark was still 2026-08-27 when this was written.
--
-- The consequence, which is the whole point: platform.r81_gap was live and
-- populated while being INVISIBLE to every mechanism that builds a fresh
-- database. A CI database replayed from drizzle/ would not have had it, and
-- nothing would have reported that -- the replay harness cannot miss a file it
-- never looks at. That is the same shape as E-103, and the same shape as the
-- MIGRATION-DEBT this session recorded against platform.work_orders: DDL whose
-- only home was somewhere the build does not read.
--
-- So this file is the missing half. It is written to match the LIVE table
-- column-for-column (recovered from information_schema, not from memory), and
-- is idempotent because the table already exists on the live database while a
-- CI database replays it from nothing.
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.r81_gap (
  gap_id            text PRIMARY KEY,
  requirement       text NOT NULL,
  location          text NOT NULL,
  current_state     text NOT NULL,
  missing           text NOT NULL,
  stream            text NOT NULL,
  evidence          text NOT NULL,
  intent_what       text,
  intent_why        text,
  intent_where      text,
  intent_when       text,
  verdict           text,
  verdict_evidence  text,
  discard_category  text,
  discard_reason    text,
  blocks_launch     boolean NOT NULL DEFAULT false,
  source_fault      text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
