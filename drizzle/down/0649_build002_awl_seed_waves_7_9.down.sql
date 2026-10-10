-- Down-migration for drizzle/0649_build002_awl_seed_waves_7_9.sql (PROJEXA-BUILD-002 WP-05g and WP-05h). Convention:
-- docs/ROLLBACK_RUNBOOK.md section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same
-- always-aborted rehearsal as the forward file.
--
-- WHAT IT RESTORES: the state after 0648 and before 0649. The 20 rows 0649 added to platform.ai_work_link_functions are deleted
--   (add_mood_board_item, add_room, approve_kpi_entry, create_ffe_item, create_floor_plan, create_mood_board, create_permit,
--   create_progress_claim, create_wiki_page, draft_progress_claim, get_ffe_margin_summary, place_furniture, reject_progress_claim,
--   submit_boq_for_approval, submit_change_order_for_approval, submit_kpi_entry, submit_progress_claim, update_document_metadata,
--   update_ffe_status, update_wiki_page), and public.ai_work_link__registry_version() is put back to the hash of the 0648 seed. The other
--   92 function rows and the 33 record kinds are the same in both seeds and are not touched.
--
-- WHAT STOPS WORKING, read before running: a link minted while 0649 was live may hold some of the 20 on-link functions in its
--   allowed_functions; with the row gone that function is no longer on the link's effective list, so a call to it answers 403
--   FUNCTION_NOT_ON_LINK. The links themselves are not touched. The Edge Function's generated registry lists the 20 functions until it is
--   redeployed from the commit before this one; the version check then reads as a mismatch until it is.
--
-- ORDER: run it BEFORE the down file of 0648 (0649 is the later migration).
--
-- DATA LOSS: the 20 seed rows only; applying 0649 again puts them back.
--
-- WHEN IT REFUSES: never. Safe to run twice, and safe when the table is already gone (the down file of 0621 drops it).

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $do$
BEGIN
  IF to_regclass('platform.ai_work_link_functions') IS NOT NULL THEN
    DELETE FROM platform.ai_work_link_functions
     WHERE function_id IN (
       'add_mood_board_item', 'add_room', 'approve_kpi_entry', 'create_ffe_item', 'create_floor_plan',
       'create_mood_board', 'create_permit', 'create_progress_claim', 'create_wiki_page', 'draft_progress_claim',
       'get_ffe_margin_summary', 'place_furniture', 'reject_progress_claim', 'submit_boq_for_approval', 'submit_change_order_for_approval',
       'submit_kpi_entry', 'submit_progress_claim', 'update_document_metadata', 'update_ffe_status', 'update_wiki_page'
     );
  END IF;
END
$do$;

-- the hash of the 0648 seed (drizzle/0648_build002_awl_seed_waves_5_6.sql, its "registry version" line)
CREATE OR REPLACE FUNCTION public.ai_work_link__registry_version()
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT '9a7682c82eb3dfaa65e6836871fdab63d5efe3c6a1e8b267835a7fe3d25bbff4'::text $fn$;

REVOKE ALL ON FUNCTION public.ai_work_link__registry_version() FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__registry_version() TO service_role;

COMMIT;
