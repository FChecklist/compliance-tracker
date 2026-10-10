-- Down-migration for drizzle/0628_build001_awl_seed.sql (PROJEXA-BUILD-001 U-46 step 1). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the
-- forward file.
--
-- WHAT IT RESTORES: the state before 0628. Every row of platform.ai_work_link_functions and platform.ai_work_link_record_kinds is
--   deleted (both tables were empty before the seed), and public.ai_work_link__registry_version() is dropped. The tables and the
--   settings row stay (the down file of 0621 drops them).
--
-- WHAT STOPS WORKING, read before running: with the allow-list empty, every link has an empty effective function list and every
--   record request answers UNKNOWN_KIND. The links themselves are not touched.
--
-- ORDER: run it FIRST of the eight down files (it is the last migration).
--
-- DATA LOSS: the seed rows only; applying 0628 again puts them back. Anything an operator changed in these two tables by hand is lost.
--
-- WHEN IT REFUSES: never. Safe to run twice.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.ai_work_link__registry_version();

-- the two tables may already be gone on a second run, or when the down file of 0621 ran first
DO $do$
BEGIN
  IF to_regclass('platform.ai_work_link_record_kinds') IS NOT NULL THEN
    DELETE FROM platform.ai_work_link_record_kinds;
  END IF;
  IF to_regclass('platform.ai_work_link_functions') IS NOT NULL THEN
    DELETE FROM platform.ai_work_link_functions;
  END IF;
END
$do$;

COMMIT;
