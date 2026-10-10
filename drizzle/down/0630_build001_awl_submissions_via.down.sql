-- Down-migration for drizzle/0630_build001_awl_submissions_via.sql (PROJEXA-BUILD-002 WP-09a). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the
-- forward file.
--
-- WHAT IT RESTORES: compliance.submissions as it was before 0630. The check submissions_via_check and the two columns via and ai_link_id
-- are dropped. Every other column, index, policy and grant of the table is untouched.
--
-- ORDER: run it before the down file of 0629 (reverse number order). Run it only after the code that names the two columns is no longer
-- deployed: an INSERT that names a dropped column is refused.
--
-- DATA LOSS: the values of via and ai_link_id written since the forward file was applied (the provenance of link submissions). The
-- submissions, their tasks and the records they wrote are not touched.
--
-- WHEN IT REFUSES: never; every step checks for its own object. Safe to run twice.

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE IF EXISTS compliance.submissions DROP CONSTRAINT IF EXISTS submissions_via_check;
ALTER TABLE IF EXISTS compliance.submissions DROP COLUMN IF EXISTS ai_link_id;
ALTER TABLE IF EXISTS compliance.submissions DROP COLUMN IF EXISTS via;

COMMIT;
