-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session: "the external AI / internal AI can make the complete project, edit, delete, update, etc for that user as per role and its organization"; this file rolls that migration back.
-- Down-migration for drizzle/0687_awl_ai_crud_b5.sql (PROJEXA AI create/update/delete part 2, package lf-b5-ai-crud). Convention:
-- docs/ROLLBACK_RUNBOOK.md section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal
-- as the forward file.
--
-- WHAT IT RESTORES: the state after 0685 and before 0687.
--   1. The 19 function rows 0687 added are deleted, exactly those ids and no other, and public.ai_work_link__registry_version() is put back to the
--      hash of the 0685 seed. The other 140 function rows and the 33 record kinds are the same in both seeds and are not touched.
--   2. public.ai_work_link_draft_impact and the meeting tombstone trigger and its function are dropped.
--   3. compliance.pms_meetings.deleted_at is dropped ONLY when no meeting carries a soft delete. When one does, the column is KEPT (dropping it would
--      bring deleted meetings back, and this file never loses data) and a NOTICE says how many; the code before 0687 does not read the column, so
--      those meetings show again in the app until the forward file is re-applied -- read that before rolling back.
--   4. The enum value 'cancelled' of compliance.construction_change_order_status STAYS: Postgres has no ALTER TYPE ... DROP VALUE, and rebuilding the
--      type would rewrite the table. Change orders cancelled through 0687 keep status 'cancelled'; every reader filters on 'approved', so they still
--      count nowhere. Their voided e-signature requests stay voided.
--
-- WHAT STOPS WORKING: an AI's edit of activities, categories, attendance, change orders and BOQ line text, its delete of attendance and meetings, its
-- cancel of change orders, and the organisation functions (BOQ categories, vendors, customers, companies, currencies, exchange rates). A call to one
-- of the 19 answers 403 FUNCTION_NOT_ON_LINK; drafts already recorded stay and are refused when claimed (ROLE_CHANGED). The draft preview no longer
-- shows a category's blast radius (it answers without it). The Edge Function's generated registry lists the 19 until it is redeployed from the
-- commit before this one.
--
-- DATA LOSS: none of project data. The rows deleted are registry rows; applying 0687 again puts them back.
--
-- WHEN IT REFUSES: never. Safe to run twice; each step is skipped when its table is absent.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $do$
BEGIN
  IF to_regclass('platform.ai_work_link_functions') IS NOT NULL THEN
    DELETE FROM platform.ai_work_link_functions
    WHERE function_id = ANY (ARRAY[
      'update_activity', 'update_progress_category', 'update_attendance', 'delete_attendance', 'update_change_order', 'cancel_change_order',
      'update_boq_line', 'delete_meeting',
      'create_boq_category', 'rename_boq_category', 'delete_boq_category', 'create_vendor', 'update_vendor', 'create_customer', 'update_customer',
      'create_company', 'create_currency', 'create_exchange_rate', 'list_organisation_records'
    ]::text[]);
  END IF;
END
$do$;

-- the hash of the 0685 seed (drizzle/0685_awl_ai_crud.sql, its "registry version" line)
CREATE OR REPLACE FUNCTION public.ai_work_link__registry_version()
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT '1ebba97f7025068298c0f1a5b466e35c30f35ef8b1350ff3b174ad71d1f54763'::text $fn$;

REVOKE ALL ON FUNCTION public.ai_work_link__registry_version() FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.ai_work_link__registry_version() FROM anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.ai_work_link__registry_version() FROM app_runtime';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ai_work_link__registry_version() TO service_role';
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.ai_work_link_draft_impact(text, text, text);

DO $do$
DECLARE
  v_deleted integer;
BEGIN
  IF to_regclass('compliance.pms_meetings') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS projexa_track_meeting_tombstone ON compliance.pms_meetings;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'compliance' AND table_name = 'pms_meetings' AND column_name = 'deleted_at') THEN
      EXECUTE 'SELECT count(*)::int FROM compliance.pms_meetings WHERE deleted_at IS NOT NULL' INTO v_deleted;
      IF v_deleted = 0 THEN
        ALTER TABLE compliance.pms_meetings DROP COLUMN deleted_at;
      ELSE
        RAISE NOTICE '0687 down: compliance.pms_meetings.deleted_at kept: % meeting(s) are soft-deleted and dropping the column would bring them back', v_deleted;
      END IF;
    END IF;
  END IF;
END
$do$;
DROP FUNCTION IF EXISTS platform.projexa_track_meeting_tombstone();

COMMIT;
