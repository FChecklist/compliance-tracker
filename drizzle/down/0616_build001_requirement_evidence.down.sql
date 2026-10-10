-- Down-migration for drizzle/0616_build001_requirement_evidence.sql
-- (PROJEXA-BUILD-001 U-22). Convention: docs/ROLLBACK_RUNBOOK.md section 3.
-- Not auto-applied by any script or CI job; the PM runs it deliberately, after
-- the same always-aborted rehearsal as the forward file (runbook section 4a).
--
-- WHAT IT RESTORES: the exact pre-0616 schema of platform.sumeet_requirements
--   (23 columns): the two added columns verify_command and evidence_ref are
--   dropped.
--
-- DATA LOSS, read before running:
--   1. Every value in verify_command and evidence_ref is lost, for every row:
--      the ones drizzle/0617_build001_requirement_evidence_data.sql wrote and
--      any written by hand since. Copy them out first if they are wanted
--      (select id, verify_command, evidence_ref from platform.sumeet_requirements
--      where verify_command is not null or evidence_ref is not null).
--   2. Nothing else: no row is deleted and no other column is touched. The 31
--      EXC-ITEM rows added by 0617 are NOT removed by this file; run
--      drizzle/down/0617_build001_requirement_evidence_data.down.sql first to
--      remove them.
--
-- WHEN IT REFUSES: it does not. Run 0617's down file first (see DATA LOSS 2):
--   this file does not check for it, and 0617's down file needs these columns
--   to find what 0617 wrote.
--
-- Safe to run twice: DROP COLUMN IF EXISTS.

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE platform.sumeet_requirements
  DROP COLUMN IF EXISTS evidence_ref,
  DROP COLUMN IF EXISTS verify_command;

COMMIT;
