-- Down-migration for drizzle/0648_build002_awl_seed_waves_5_6.sql (PROJEXA-BUILD-002 WP-05e, WP-05f and AW-312). Convention:
-- docs/ROLLBACK_RUNBOOK.md section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same
-- always-aborted rehearsal as the forward file.
--
-- WHAT IT RESTORES: the state after 0647 and before 0648. The 22 rows 0648 added to platform.ai_work_link_functions are deleted
--   (add_meeting_action_item, add_meeting_outcome, approve_timesheet, capture_artifact, capture_schedule_baseline, compare_boq_revisions,
--   compare_schedule_baseline, create_drawing, create_mom, get_gantt_schedule, get_project_budget_variance, get_project_exceptions,
--   link_roster_employee, publish_mom, record_customer_approval, record_customer_complaint, record_material_receipt, record_vendor_dispute,
--   reject_timesheet, set_progress_drawing, update_mom_minutes, update_task), and public.ai_work_link__registry_version() is put back to the
--   hash of the 0647 seed. The other 70 function rows and the 33 record kinds are the same in both seeds and are not touched.
--
-- WHAT STOPS WORKING, read before running: a link minted while 0648 was live may hold some of the 21 on-link functions in its
--   allowed_functions; with the row gone that function is no longer on the link's effective list, so a call to it answers 403
--   FUNCTION_NOT_ON_LINK. The links themselves are not touched. The Edge Function's generated registry lists the 22 functions until it is
--   redeployed from the commit before this one; the version check then reads as a mismatch until it is.
--
-- ORDER: run it BEFORE the down file of 0647 (0648 is the later migration).
--
-- DATA LOSS: the 22 seed rows only; applying 0648 again puts them back.
--
-- WHEN IT REFUSES: never. Safe to run twice, and safe when the table is already gone (the down file of 0621 drops it).

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $do$
BEGIN
  IF to_regclass('platform.ai_work_link_functions') IS NOT NULL THEN
    DELETE FROM platform.ai_work_link_functions
     WHERE function_id IN (
       'add_meeting_action_item', 'add_meeting_outcome', 'approve_timesheet', 'capture_artifact', 'capture_schedule_baseline',
       'compare_boq_revisions', 'compare_schedule_baseline', 'create_drawing', 'create_mom', 'get_gantt_schedule',
       'get_project_budget_variance', 'get_project_exceptions', 'link_roster_employee', 'publish_mom', 'record_customer_approval',
       'record_customer_complaint', 'record_material_receipt', 'record_vendor_dispute', 'reject_timesheet', 'set_progress_drawing',
       'update_mom_minutes', 'update_task'
     );
  END IF;
END
$do$;

-- the hash of the 0647 seed (drizzle/0647_build002_awl_seed_waves_3_4.sql, its "registry version" line)
CREATE OR REPLACE FUNCTION public.ai_work_link__registry_version()
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT '1b5f621a65fe1a636ae74a628ee0b55ad027f1413b21bfb61e7d27395c8711a6'::text $fn$;

REVOKE ALL ON FUNCTION public.ai_work_link__registry_version() FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__registry_version() TO service_role;

COMMIT;
