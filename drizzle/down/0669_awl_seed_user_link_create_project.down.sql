-- Down-migration for drizzle/0669_awl_seed_user_link_create_project.sql (PROJEXA user-wide AI work link). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the forward file.
--
-- WHAT IT RESTORES: the state after 0651 and before 0669. create_project is put back to "on no link" exactly as 0644 and 0651 wrote it (link_level
-- NULL, rank 0, no text parameters, the reason that a link is bound to one project), and public.ai_work_link__registry_version() is put back to the
-- hash of the 0651 seed. The other 112 function rows and the 33 record kinds are the same in both seeds and are not touched.
--
-- WHAT STOPS WORKING, read before running: a user link that proposes a new project. With the row back to link_level NULL create_project is on no
-- effective list, so a call to it answers 403 FUNCTION_NOT_ON_LINK; drafts already recorded stay and are refused when claimed (ROLE_CHANGED). The
-- Edge Function's generated registry lists the function until it is redeployed from the commit before this one.
--
-- ORDER: run it BEFORE the down file of 0668 (0669 is the later migration).
--
-- DATA LOSS: none; applying 0669 again puts the row back.
--
-- WHEN IT REFUSES: never. Safe to run twice, and safe when the table is already gone (the down file of 0621 drops it).

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $do$
BEGIN
  IF to_regclass('platform.ai_work_link_functions') IS NOT NULL THEN
    UPDATE platform.ai_work_link_functions
    SET link_level = NULL, money_sensitive = false, min_role_rank = 0,
        excluded_reason = 'A link is bound to one project, so it cannot make another one: the New project with my AI flow and the internal pipeline do.',
        text_params = '{}'::text[]
    WHERE function_id = 'create_project';
  END IF;
END
$do$;

-- the hash of the 0651 seed (drizzle/0651_build002_awl_seed_submit_timesheet.sql, its "registry version" line)
CREATE OR REPLACE FUNCTION public.ai_work_link__registry_version()
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT '3e91138670810d93780d17569f7c4d8b514d4fede563047d7f626d7eddabbed5'::text $fn$;

REVOKE ALL ON FUNCTION public.ai_work_link__registry_version() FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__registry_version() TO service_role;

COMMIT;
