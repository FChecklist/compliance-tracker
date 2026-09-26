-- Down-migration for drizzle/0651_build002_awl_seed_submit_timesheet.sql (PROJEXA-BUILD-002 persona-run finding 3). Convention:
-- docs/ROLLBACK_RUNBOOK.md section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same
-- always-aborted rehearsal as the forward file.
--
-- WHAT IT RESTORES: the state after 0649 and before 0651. The 1 row 0651 added to platform.ai_work_link_functions (submit_timesheet) is deleted,
--   and public.ai_work_link__registry_version() is put back to the hash of the 0649 seed. The other 112 function rows and the 33 record kinds
--   are the same in both seeds and are not touched.
--
-- WHAT STOPS WORKING, read before running: a link minted while 0651 was live may hold submit_timesheet in its allowed_functions; with the row
--   gone that function is no longer on the link's effective list, so a call to it answers 403 FUNCTION_NOT_ON_LINK. The links themselves are
--   not touched. The Edge Function's generated registry lists the function until it is redeployed from the commit before this one; the version
--   check then reads as a mismatch until it is.
--
-- ORDER: run it BEFORE the down file of 0649 (0651 is the later migration).
--
-- DATA LOSS: the 1 seed row only; applying 0651 again puts it back.
--
-- WHEN IT REFUSES: never. Safe to run twice, and safe when the table is already gone (the down file of 0621 drops it).

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $do$
BEGIN
  IF to_regclass('platform.ai_work_link_functions') IS NOT NULL THEN
    DELETE FROM platform.ai_work_link_functions WHERE function_id = 'submit_timesheet';
  END IF;
END
$do$;

-- the hash of the 0649 seed (drizzle/0649_build002_awl_seed_waves_7_9.sql, its "registry version" line)
CREATE OR REPLACE FUNCTION public.ai_work_link__registry_version()
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT '36301f55c9329c2e2484ec1d90aa4ba34cd9a089bde6b5dd0c255d2b4d2ec554'::text $fn$;

REVOKE ALL ON FUNCTION public.ai_work_link__registry_version() FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__registry_version() TO service_role;

COMMIT;
