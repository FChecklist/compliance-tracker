-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session: "the external AI / internal AI can make the complete project, edit, delete, update, etc for that user as per role and its organization"; this file rolls that migration back.
-- Down-migration for drizzle/0685_awl_ai_crud.sql (PROJEXA AI create/update/delete, package lf-b2-ai-crud). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the forward file.
--
-- WHAT IT RESTORES: the state after 0669 and before 0685.
--   1. The 24 function rows 0685 added are deleted, exactly those ids and no other, and public.ai_work_link__registry_version() is put back to
--      the hash of the 0669 seed. The other 113 function rows and the 33 record kinds are the same in both seeds and are not touched.
--   2. (GROUP 2) the per-person switch: every switch is turned off and the functions that set and read it are dropped (section below).
--
-- WHAT STOPS WORKING, read before running: an AI's update, delete and archive of BOQs, progress, tasks, sprints, timesheets, documents, minutes,
-- meetings, materials and the design studio. A call to one of the 24 answers 403 FUNCTION_NOT_ON_LINK; drafts already recorded stay and are refused
-- when claimed (ROLE_CHANGED). The Edge Function's generated registry lists them until it is redeployed from the commit before this one.
--
-- DATA LOSS: none of project data. The rows deleted are registry rows; applying 0685 again puts them back.
--
-- WHEN IT REFUSES: never. Safe to run twice, and safe when the table is already gone (the down file of 0621 drops it).

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $do$
BEGIN
  IF to_regclass('platform.ai_work_link_functions') IS NOT NULL THEN
    DELETE FROM platform.ai_work_link_functions
    WHERE function_id = ANY (ARRAY[
      'update_boq', 'delete_boq', 'update_boq_line_amounts', 'delete_progress_entry',
      'archive_task', 'create_sprint', 'update_sprint', 'close_sprint', 'add_sprint_task', 'remove_sprint_task',
      'update_time_entry', 'delete_time_entry',
      'dispose_document', 'update_mom_details', 'delete_mom', 'update_meeting', 'update_material',
      'update_room', 'remove_room', 'update_placement', 'remove_placement', 'update_floor_plan_status', 'update_mood_board', 'remove_mood_board_item'
    ]::text[]);
  END IF;
END
$do$;

-- the hash of the 0669 seed (drizzle/0669_awl_seed_user_link_create_project.sql, its "registry version" line)
CREATE OR REPLACE FUNCTION public.ai_work_link__registry_version()
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT '5b33c8360d904b7dcfab372719689d80e1d2536d8dcef5d1c67ac220f4e11cd4'::text $fn$;

REVOKE ALL ON FUNCTION public.ai_work_link__registry_version() FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__registry_version() TO service_role;

-- GROUP 2: the per-person switch. Rolled back FUNCTIONALLY, not by re-creating 0668's four function bodies: every person's switch is turned off
-- and the two functions that set and read it are dropped, so no one can turn it on again. With every switch off, ai_work_link__direct_ok(ctx,
-- level) is exactly 0668's predicate (effective level 1 and a level-1 function), so record_intent and intent_claim behave as before 0685; the
-- context carries one more field, act_without_asking, always false. The table and the two owner-only helpers stay (nothing can reach them), and
-- the rows stay with act_without_asking = false (no row is deleted). Re-applying 0685 brings the setter back; each person switches on again.
DO $do$
BEGIN
  IF to_regclass('platform.ai_work_link_person_settings') IS NOT NULL THEN
    UPDATE platform.ai_work_link_person_settings SET act_without_asking = false, updated_at = now() WHERE act_without_asking;
  END IF;
END
$do$;
DROP FUNCTION IF EXISTS public.ai_work_link_person_setting_set(text, boolean);
DROP FUNCTION IF EXISTS public.ai_work_link_person_setting(text);

COMMIT;
