-- Down-migration for drizzle/0621_build001_awl_config_tables.sql (PROJEXA-BUILD-001 U-46 step 1). Convention:
-- docs/ROLLBACK_RUNBOOK.md section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same
-- always-aborted rehearsal as the forward file.
--
-- WHAT IT RESTORES: the schema as it was before 0621. The three tables platform.ai_work_link_settings,
--   platform.ai_work_link_record_kinds and platform.ai_work_link_functions are dropped.
--
-- ORDER: run this file LAST. It must run after the down files of 0622 to 0628 (reverse number order): the functions of those
--   migrations read these tables, and PL/pgSQL does not record that dependency, so dropping the tables first would leave functions
--   that fail on their first call.
--
-- DATA LOSS: the one settings row (including the state of the writes_enabled switch) and the generated rows of the record kinds and
--   the function allow-list. The generated rows come back by applying 0628 again; a switch that was turned on has to be turned on
--   again by its own reviewed migration.
--
-- WHEN IT REFUSES: never; DROP TABLE IF EXISTS. Safe to run twice.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS platform.ai_work_link_functions;
DROP TABLE IF EXISTS platform.ai_work_link_record_kinds;
DROP TABLE IF EXISTS platform.ai_work_link_settings;

COMMIT;
