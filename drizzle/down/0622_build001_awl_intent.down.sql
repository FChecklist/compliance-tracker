-- Down-migration for drizzle/0622_build001_awl_intent.sql (PROJEXA-BUILD-001 U-46 step 1). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the
-- forward file.
--
-- WHAT IT RESTORES: the schema as it was before 0622. platform.ai_work_link_intent is dropped with its indexes and constraints.
--   platform.user_ai_links is untouched (the foreign key lived on the dropped table).
--
-- ORDER: run it after the down file of 0626 (the intent functions read this table) and before the down file of 0621.
--
-- DATA LOSS: every intent row, that is every recorded write and draft that any link proposed, with its outcome. The audit trail of
--   what an AI proposed through a link is gone. The business rows an executed intent wrote (compliance.submissions and the tables it
--   wrote to) are NOT touched: nothing is written by this phase before spike S-1 passes, so on the first rollback there are none.
--
-- WHEN IT REFUSES: never; DROP TABLE IF EXISTS. Safe to run twice.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS platform.ai_work_link_intent;

COMMIT;
