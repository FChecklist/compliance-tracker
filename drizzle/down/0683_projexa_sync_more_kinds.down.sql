-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session ("complete database of that user and for that user organization is downloaded in the user laptop"); this is the rollback of the 28-kinds migration of that work.
-- Down-migration for drizzle/0683_projexa_sync_more_kinds.sql. Run deliberately by the PM, not by any script.
-- ORDER: the 15 new triggers go FIRST, then the trigger function and the lists are put back to their 0679 / 0677 definitions (13 kinds).
-- DATA LOSS: the version heads and change-log rows already recorded for the 15 new kinds stay (harmless: the list no longer includes them); no business table is touched. Laptops that already copied those kinds
-- keep their copy until their next full sync, which removes them (the manifest no longer lists the kinds).
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
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_change ON compliance.%I', t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION platform.projexa_track_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_kind text := TG_ARGV[0];
  v_row jsonb;
  v_op char(1);
  v_id text;
  v_org text;
  v_project text;
  v_hash text;
  v_prev record;
  v_ver bigint;
  v_actor text;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_row := to_jsonb(OLD);
      v_op := 'D';
    ELSE
      v_row := to_jsonb(NEW);
      v_op := CASE TG_OP WHEN 'INSERT' THEN 'I' ELSE 'U' END;
    END IF;
    v_id := v_row ->> 'id';
    v_org := v_row ->> 'org_id';

    IF v_kind = 'project' THEN
      v_project := v_id;
    ELSIF v_kind = 'boq_lines' THEN
      SELECT b.project_id INTO v_project FROM compliance.construction_boqs b WHERE b.id = (v_row ->> 'boq_id') AND b.org_id = v_org;
    ELSIF v_kind = 'documents' THEN
      IF v_row ->> 'linked_entity_type' IS DISTINCT FROM 'project' THEN
        RETURN NULL;
      END IF;
      v_project := v_row ->> 'linked_entity_id';
    ELSE
      v_project := v_row ->> 'project_id';
    END IF;

    SELECT h.version, h.content_hash, h.deleted, h.project_id INTO v_prev
    FROM platform.projexa_record_head h WHERE h.org_id = v_org AND h.kind = v_kind AND h.record_id = v_id FOR UPDATE;

    IF v_project IS NULL AND FOUND THEN
      v_project := v_prev.project_id;
    END IF;
    IF v_org IS NULL OR v_id IS NULL OR v_project IS NULL THEN
      RETURN NULL;
    END IF;

    v_hash := encode(sha256(convert_to((v_row - 'updated_at' - 'search_vector' - 'embedding')::text, 'UTF8')), 'hex');
    IF FOUND THEN
      IF v_op <> 'D' AND NOT v_prev.deleted AND v_prev.content_hash = v_hash THEN
        RETURN NULL;
      END IF;
      v_ver := v_prev.version + 1;
    ELSE
      v_ver := 1;
    END IF;

    v_actor := coalesce(v_row ->> 'updated_by_id', v_row ->> 'updated_by', v_row ->> 'created_by_id', v_row ->> 'requested_by_id', v_row ->> 'raised_by_id');

    INSERT INTO platform.projexa_record_head (org_id, kind, record_id, project_id, version, content_hash, deleted, updated_at, actor_id)
    VALUES (v_org, v_kind, v_id, v_project, v_ver, v_hash, v_op = 'D', clock_timestamp(), v_actor)
    ON CONFLICT (org_id, kind, record_id)
    DO UPDATE SET project_id = EXCLUDED.project_id, version = EXCLUDED.version, content_hash = EXCLUDED.content_hash, deleted = EXCLUDED.deleted, updated_at = EXCLUDED.updated_at, actor_id = EXCLUDED.actor_id;

    INSERT INTO platform.projexa_change_log (org_id, project_id, kind, record_id, version, op, content_hash, actor_id, db_role)
    VALUES (v_org, v_project, v_kind, v_id, v_ver, v_op, v_hash, v_actor, session_user::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'projexa_track_change(%): % (%)', v_kind, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION platform.projexa_track_change() FROM PUBLIC, anon, authenticated, app_runtime;

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
