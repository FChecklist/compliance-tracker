-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session ("complete database of that user and for that user organization is downloaded in the user laptop"); this is the rollback of the 28-kinds migration of that work.
-- Down-migration for drizzle/0683_projexa_sync_more_kinds.sql. Run deliberately by the PM, not by any script.
-- ORDER: roll back strictly in REVERSE (0686, 0684, then this file, then 0682 .. 0678; see 0679's header).
-- Inside: the 15 new tables' tracking triggers go FIRST, then the lists are put back to their 0677 definitions (13 kinds). The trigger function is 0679's and is not touched.
-- DATA LOSS: the version heads and change-log rows already recorded for the 15 new kinds stay (harmless: the list no longer includes them, the feed filters them out); no
-- business table is touched. Laptops that already copied those kinds keep their copy until their next full sync, which removes them (the manifest no longer lists the kinds).
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['construction_labour_roster', 'construction_attendance', 'pms_time_entries', 'pms_meetings', 'veri_meetings', 'construction_site_diaries', 'construction_site_instructions',
                           'construction_progress_claims', 'construction_interim_bills', 'construction_material_receipts', 'construction_material_issues', 'construction_expense_entries',
                           'pms_schedule_baselines', 'interior_ffe_items', 'pms_wiki_pages'] LOOP
    IF to_regclass('compliance.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_i ON compliance.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_u ON compliance.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_d ON compliance.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_change ON compliance.%I', t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.projexa_sync__src(p_kind text)
RETURNS TABLE (from_sql text, scope_sql text, rel text)
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.f, v.s, v.r FROM (VALUES
    ('project',       'compliance.projects t',                                                                              't.id = $1 AND t.org_id = $2',                                          'compliance.projects'),
    ('tasks',         'compliance.pms_issues t',                                                                            't.project_id = $1 AND t.org_id = $2',                                  'compliance.pms_issues'),
    ('boqs',          'compliance.construction_boqs t',                                                                     't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_boqs'),
    ('boq_lines',     'compliance.construction_boq_line_items t JOIN compliance.construction_boqs b ON b.id = t.boq_id',    'b.project_id = $1 AND b.org_id = $2 AND t.org_id = $2',                'compliance.construction_boq_line_items'),
    ('activities',    'compliance.construction_activities t',                                                               't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_activities'),
    ('progress',      'compliance.construction_work_progress_entries t',                                                    't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_work_progress_entries'),
    ('rfis',          'compliance.construction_rfis t',                                                                     't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_rfis'),
    ('submittals',    'compliance.construction_submittals t',                                                               't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_submittals'),
    ('punch_list',    'compliance.construction_punch_list_items t',                                                         't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_punch_list_items'),
    ('change_orders', 'compliance.construction_change_orders t',                                                            't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_change_orders'),
    ('milestones',    'compliance.pms_milestones t',                                                                        't.project_id = $1 AND t.org_id = $2',                                  'compliance.pms_milestones'),
    ('materials',     'compliance.construction_materials t',                                                                't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_materials'),
    ('documents',     'compliance.documents t',                                                                             't.linked_entity_type = ''project'' AND t.linked_entity_id = $1 AND t.org_id = $2', 'compliance.documents')
  ) AS v(k, f, s, r) WHERE v.k = p_kind
$fn$;

CREATE OR REPLACE FUNCTION public.projexa_sync__kinds()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT ARRAY['project', 'tasks', 'boqs', 'boq_lines', 'activities', 'progress', 'rfis', 'submittals', 'punch_list', 'change_orders', 'milestones', 'materials', 'documents']::text[] $fn$;

COMMIT;
