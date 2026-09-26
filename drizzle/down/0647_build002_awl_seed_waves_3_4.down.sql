-- Down-migration for drizzle/0647_build002_awl_seed_waves_3_4.sql (PROJEXA-BUILD-002 WP-05c, WP-05d). Convention:
-- docs/ROLLBACK_RUNBOOK.md section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same
-- always-aborted rehearsal as the forward file.
--
-- WHAT IT RESTORES: the state after 0650 and before 0647. The eighteen rows 0647 added to platform.ai_work_link_functions are deleted
--   (answer_rfi, close_rfi, create_material, create_progress_category, create_punch_list_item, create_rfi, create_site_diary,
--   create_submittal, get_daily_progress_report, get_material_cost_report, mark_punch_item_ready, record_attendance_batch,
--   record_material_issue, review_submittal, update_progress_entry, update_roster_entry, verify_punch_item_closed,
--   void_material_receipt), and public.ai_work_link__registry_version() is put back to the hash of the 0650 seed. The other 52 function
--   rows and the 33 record kinds are the same in both seeds and are not touched.
--
-- WHAT STOPS WORKING, read before running: a link minted while 0647 was live may hold one of the eighteen functions in its
--   allowed_functions; with the row gone that function is no longer on the link's effective list, so a call to it answers 403
--   FUNCTION_NOT_ON_LINK. The links themselves are not touched. The Edge Function's generated registry lists the eighteen functions until
--   it is redeployed from the commit before this one; the version check then reads as a mismatch until it is.
--
-- ORDER: run it BEFORE the down file of 0650 (0647 is the later migration).
--
-- DATA LOSS: the eighteen seed rows only; applying 0647 again puts them back.
--
-- WHEN IT REFUSES: never. Safe to run twice, and safe when the table is already gone (the down file of 0621 drops it).

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $do$
BEGIN
  IF to_regclass('platform.ai_work_link_functions') IS NOT NULL THEN
    DELETE FROM platform.ai_work_link_functions
     WHERE function_id IN (
       'answer_rfi', 'close_rfi', 'create_material', 'create_progress_category', 'create_punch_list_item', 'create_rfi', 'create_site_diary',
       'create_submittal', 'get_daily_progress_report', 'get_material_cost_report', 'mark_punch_item_ready', 'record_attendance_batch',
       'record_material_issue', 'review_submittal', 'update_progress_entry', 'update_roster_entry', 'verify_punch_item_closed',
       'void_material_receipt'
     );
  END IF;
END
$do$;

-- the hash of the 0650 seed (drizzle/0650_build002_awl_seed_coverage_waves_1_2.sql, its "registry version" line)
CREATE OR REPLACE FUNCTION public.ai_work_link__registry_version()
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT '19fafe5f95e7c0eef28ad40cfac925cfe09e5b102ef54aa2422496ef78f862e4'::text $fn$;

REVOKE ALL ON FUNCTION public.ai_work_link__registry_version() FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__registry_version() TO service_role;

COMMIT;
