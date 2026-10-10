-- Down-migration for drizzle/0644_build002_awl_seed_project_boq.sql (PROJEXA-BUILD-002 WP-03, WP-04, WP-07). Convention:
-- docs/ROLLBACK_RUNBOOK.md section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same
-- always-aborted rehearsal as the forward file.
--
-- WHAT IT RESTORES: the state after 0628 and before 0644. The six rows 0644 added to platform.ai_work_link_functions are deleted
--   (add_boq_lines, create_activity, create_boq, create_project, seal_boq, update_project), and public.ai_work_link__registry_version() is
--   put back to the hash of the 0628 seed. The other 27 function rows and the 13 record kinds are the same in both seeds and are not
--   touched.
--
-- WHAT STOPS WORKING, read before running: a link minted while 0644 was live may hold one of the six functions in its allowed_functions;
--   with the row gone that function is no longer on the link's effective list, so a call to it answers 403 FUNCTION_NOT_ON_LINK. The
--   links themselves are not touched. The Edge Function's generated registry lists the six functions until it is redeployed from the
--   commit before this one; the version check then reads as a mismatch until it is.
--
-- ORDER: run it BEFORE the down file of 0628 (0644 is the later migration).
--
-- DATA LOSS: the six seed rows only; applying 0644 again puts them back.
--
-- WHEN IT REFUSES: never. Safe to run twice, and safe when the table is already gone (the down file of 0621 drops it).

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $do$
BEGIN
  IF to_regclass('platform.ai_work_link_functions') IS NOT NULL THEN
    DELETE FROM platform.ai_work_link_functions
     WHERE function_id IN ('add_boq_lines', 'create_activity', 'create_boq', 'create_project', 'seal_boq', 'update_project');
  END IF;
END
$do$;

-- the hash of the 0628 seed (drizzle/0628_build001_awl_seed.sql, its "registry version" line)
CREATE OR REPLACE FUNCTION public.ai_work_link__registry_version()
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT '85752edfdebd5f46329b0cb60f14e5a96a98ec0e3aa454db2412a1462c58c696'::text $fn$;

REVOKE ALL ON FUNCTION public.ai_work_link__registry_version() FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__registry_version() TO service_role;

COMMIT;
