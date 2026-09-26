-- Down-migration for drizzle/0646_build002_source_object_job_state.sql
-- (PROJEXA-BUILD-002 WP-02). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it
-- deliberately, after the same always-aborted rehearsal as the forward file
-- (runbook section 4a).
--
-- WHAT IT RESTORES: the exact pre-0646 schema of compliance.source_object
--   (30 columns): the check source_object_job_state_check is dropped, then
--   the columns job_state and job_result.
--
-- DATA LOSS, read before running:
--   1. Every value in source_object.job_state and source_object.job_result is
--      lost, for every row: the state of each from-document job, the stored
--      extraction of a job that waits for answers (a second submit of that
--      file then extracts again, with a second model call) and the reason a
--      refused job was refused. Copy them out first if they are wanted
--      (select id, job_state, job_result from compliance.source_object where
--      job_state is not null).
--   2. Nothing else: no row is deleted and no other column is touched.
--
-- SEQUENCING: roll back the code first (runbook section 4, step 3). A build
--   whose src/lib/db/schema.ts declares source_object.job_state and
--   source_object.job_result names them in the ledger's statements, and a
--   build that reads whole source_object rows names them in every select, so
--   once this file has run that build fails every read of the table.
--
-- WHEN IT REFUSES: it does not.
--
-- Safe to run twice: DROP CONSTRAINT IF EXISTS and DROP COLUMN IF EXISTS.

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE compliance.source_object
  DROP CONSTRAINT IF EXISTS source_object_job_state_check;

ALTER TABLE compliance.source_object
  DROP COLUMN IF EXISTS job_result;

ALTER TABLE compliance.source_object
  DROP COLUMN IF EXISTS job_state;

COMMIT;
