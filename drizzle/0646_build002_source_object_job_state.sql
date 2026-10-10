-- PROJEXA-BUILD-002 WP-02 (register rows AW-111 to AW-115): the state of a "create a project from a workbook" job. Schema only; no
-- row is written, changed or deleted by this file.
--
-- WHAT
--   compliance.source_object, extended in place:
--     + job_state  text, NULLABLE, no default
--         CHECK source_object_job_state_check: NULL, or one of
--           received       the file was accepted and claimed
--           reading        the workbook is being read and the extraction is running
--           needs_answers  the extraction is finished and has questions for a person; nothing is created
--           ready          the extraction is finished, has no open question and was asked only to prepare
--           created        the project and its BOQ exist
--           rejected       the file was refused with a stable code
--     + job_result jsonb, NULLABLE, no default
--         what a parked job keeps (the validated extraction, its questions and its reconciliation) or what a refused job keeps
--         (the code, the message and the issues), so a second submit of the same file can finish the job without a second model
--         call and a person can read why a job was refused.
--   The table goes from 30 to 32 columns.
--
-- WHY
--   The route that creates a project from an uploaded workbook (POST /api/v1/projexa/projects/from-document) already keeps one
--   ledger row per file, keyed by the file's sha256, in compliance.source_object (document-extraction-service.ts, ledger notes).
--   That row is the natural job record, but it had no state: a job with open questions had nowhere to wait, and a request could
--   not be answered before the model had finished. With these two columns the same row is the job record and no queue or second
--   table is added.
--
-- NOT IN THIS FILE: no index (a job is found by the existing unique key on (org_id, sha256) or by its id), no backfill (every
--   existing row keeps NULL: a row written before this file reads as created when it has a project and as received otherwise, which
--   jobViewFromRow() in document-extraction-service.ts does), no change to row-level security, the policies or the grants (the new
--   columns inherit the table's), no trigger.
--
-- SEQUENCING: src/lib/db/schema.ts declares both columns, so every Drizzle statement that names them (the ledger's claim and its
--   state updates) needs them to exist. A build carrying that declaration must not serve traffic before this file is applied.
--
-- HOW IT IS APPLIED: through the Supabase MCP (apply_migration) by the PM, after the always-aborted rollback rehearsal and after the
--   PGlite proof passes (src/lib/services/document-extraction-job-migration.pglite.test.ts). Idempotent: ADD COLUMN IF NOT EXISTS,
--   and the check is added only when no constraint of that name exists, so a second run changes nothing.
--
-- DATA LOSS: none. Two nullable columns with no default; every existing row keeps every value it has and reads NULL in the new
--   columns, which the check allows. Adding the check reads the table once under the ACCESS EXCLUSIVE lock the ALTER takes;
--   lock_timeout bounds the wait for that lock.
--
-- ROLLBACK: drizzle/down/0646_build002_source_object_job_state.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE compliance.source_object
  ADD COLUMN IF NOT EXISTS job_state text;

ALTER TABLE compliance.source_object
  ADD COLUMN IF NOT EXISTS job_result jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'compliance.source_object'::regclass
                   AND conname = 'source_object_job_state_check') THEN
    ALTER TABLE compliance.source_object
      ADD CONSTRAINT source_object_job_state_check
      CHECK (job_state IS NULL
             OR job_state IN ('received',
                              'reading',
                              'needs_answers',
                              'ready',
                              'created',
                              'rejected'));
  END IF;
END $$;

COMMIT;
