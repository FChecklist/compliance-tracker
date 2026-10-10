-- Down-migration for drizzle/0650_build002_awl_seed_coverage_waves_1_2.sql (PROJEXA-BUILD-002 WP-05a, waves 1 and 2). Convention:
-- docs/ROLLBACK_RUNBOOK.md section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same
-- always-aborted rehearsal as the forward file.
--
-- WHAT IT RESTORES: the state after 0643 (WP-06, applied after 0644) and before 0650. The 19 rows 0650 added to platform.ai_work_link_functions are deleted
--   (wave 1: get_boq_line_items, run_named_report, get_project_schedule, list_milestones, create_milestone, update_milestone,
--   create_schedule_task, get_manpower_cost_report, get_designer_timesheet_report, get_project_analysis; wave 2: apply_boq_import,
--   preview_boq_import, create_change_order, list_change_orders, get_change_order, create_site_instruction, update_line_item_budget,
--   list_billing_claims, get_billing_due_queue), and public.ai_work_link__registry_version() is put back to the hash of the 0643 seed.
--   The other 33 function rows and the 33 record kinds are the same in both seeds and are not touched.
--
-- WHAT STOPS WORKING, read before running: a link minted while 0650 was live may hold some of the 19 functions in its allowed_functions;
--   with the row gone that function is no longer on the link's effective list, so a call to it answers 403 FUNCTION_NOT_ON_LINK. The
--   links themselves are not touched. The Edge Function's generated registry lists the 19 functions until it is redeployed from the
--   commit before this one; the version check then reads as a mismatch until it is.
--
-- ORDER: run it BEFORE the down file of 0643 (0650 is the later migration), and AFTER the down file of any later seed.
--
-- DATA LOSS: the 19 seed rows only; applying 0650 again puts them back.
--
-- WHEN IT REFUSES: never. Safe to run twice, and safe when the table is already gone (the down file of 0621 drops it).

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $do$
BEGIN
  IF to_regclass('platform.ai_work_link_functions') IS NOT NULL THEN
    DELETE FROM platform.ai_work_link_functions
     WHERE function_id IN ('apply_boq_import', 'create_change_order', 'create_milestone', 'create_schedule_task', 'create_site_instruction', 'get_billing_due_queue', 'get_boq_line_items', 'get_change_order', 'get_designer_timesheet_report', 'get_manpower_cost_report', 'get_project_analysis', 'get_project_schedule', 'list_billing_claims', 'list_change_orders', 'list_milestones', 'preview_boq_import', 'run_named_report', 'update_line_item_budget', 'update_milestone');
  END IF;
END
$do$;

-- the hash of the 0643 seed (drizzle/0643_build002_record_kinds.sql, its "registry version" line)
CREATE OR REPLACE FUNCTION public.ai_work_link__registry_version()
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT 'de06635d6880e20033899f2b45d50773186f2630a31628abbf43c28df949d446'::text $fn$;

REVOKE ALL ON FUNCTION public.ai_work_link__registry_version() FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__registry_version() TO service_role;

COMMIT;
