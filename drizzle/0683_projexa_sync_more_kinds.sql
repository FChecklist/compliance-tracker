-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session: "complete veridian-ai software and complete database of that user and for that user organization is downloaded in the user laptop" and "user gets to see its own data, its own projects data, its own organization data - as per role". This migration widens the PROJEXA local-first sync from 13 to 28 project-scoped kinds: everything the visible screens read and the rest of what the AI work link can read.
-- PROJEXA SYNC: MORE KINDS (feat/lf-sync-backend).
--
-- WHAT
--   public.projexa_sync__kinds()   REPLACED: the one list of synced kinds, now 28 (the 13 of 0677, in the same order, then): roster, attendance, timesheets, meetings, meeting_minutes, site_diaries,
--                                  site_instructions, progress_claims, interim_bills, material_receipts, material_issues, expenses, schedule_baselines, ffe_items, wiki_pages.
--   public.projexa_sync__src()     REPLACED: the table, scope and relation of each of the 28 (the first 13 exactly as 0677). The scope is the AI work link's own (drizzle/0643, 0644): organisation AND project.
--   platform.projexa_track_change() REPLACED: the version/history trigger also knows where a time entry (via its issue) and a MoM (a veri_meeting about a project) belong to.
--   15 triggers `projexa_track_change` on the new tables (a table missing in an environment is skipped).
-- Documents already carry drawings and permits (the same rows, by category), so those are not separate kinds. `people` and the organisation-wide masters (vendors, customers, companies, categories, currencies,
-- departments) are not project-scoped and come in a later migration; `kpi_entries` (hidden module, joined scope) and `pipeline_tasks` are left out on purpose.
--
-- NOTHING IS REIMPLEMENTED AS AUTHORITY. Every row that leaves is produced by ai_work_link__records_core for that one id under the person's bound context (0677), so its columns, its money redaction by role
-- (wages, rates, costs, amounts are NULL below the role that may see them: ai_work_link__hidden_cols and cost_visibility_config), the person-masking and the project scope are the AI link's own, byte for byte.
-- The candidate list built here (ids and cursor timestamps only, scoped on organisation and project) only decides WHICH ids to ask the core about and in what order.
--
-- DATA LOSS: none. Functions replaced, triggers added; no table altered. Applying it twice changes nothing.
-- ROLLBACK: drizzle/down/0683_projexa_sync_more_kinds.down.sql (back to the 13 kinds, and the 0679 trigger function)

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the list ------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync__kinds()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT ARRAY['project', 'tasks', 'boqs', 'boq_lines', 'activities', 'progress', 'rfis', 'submittals', 'punch_list', 'change_orders', 'milestones', 'materials', 'documents',
                    'roster', 'attendance', 'timesheets', 'meetings', 'meeting_minutes', 'site_diaries', 'site_instructions', 'progress_claims', 'interim_bills',
                    'material_receipts', 'material_issues', 'expenses', 'schedule_baselines', 'ffe_items', 'wiki_pages']::text[] $fn$;

-- 2. the sources ---------------------------------------------------------------------------------------------------------------------------------
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
    ('documents',     'compliance.documents t',                                                                             't.linked_entity_type = ''project'' AND t.linked_entity_id = $1 AND t.org_id = $2', 'compliance.documents'),
    ('roster',        'compliance.construction_labour_roster t',                                                            't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_labour_roster'),
    ('attendance',    'compliance.construction_attendance t',                                                               't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_attendance'),
    ('timesheets',    'compliance.pms_time_entries t JOIN compliance.pms_issues i ON i.id = t.issue_id',                    'i.project_id = $1 AND i.org_id = $2 AND t.org_id = $2',                'compliance.pms_time_entries'),
    ('meetings',      'compliance.pms_meetings t',                                                                          't.project_id = $1 AND t.org_id = $2',                                  'compliance.pms_meetings'),
    ('meeting_minutes','compliance.veri_meetings t',                                                                        't.context_entity_type = ''project'' AND t.context_entity_id = $1 AND t.org_id = $2', 'compliance.veri_meetings'),
    ('site_diaries',  'compliance.construction_site_diaries t',                                                             't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_site_diaries'),
    ('site_instructions','compliance.construction_site_instructions t',                                                     't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_site_instructions'),
    ('progress_claims','compliance.construction_progress_claims t',                                                         't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_progress_claims'),
    ('interim_bills', 'compliance.construction_interim_bills t',                                                            't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_interim_bills'),
    ('material_receipts','compliance.construction_material_receipts t',                                                     't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_material_receipts'),
    ('material_issues','compliance.construction_material_issues t',                                                         't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_material_issues'),
    ('expenses',      'compliance.construction_expense_entries t',                                                          't.project_id = $1 AND t.org_id = $2',                                  'compliance.construction_expense_entries'),
    ('schedule_baselines','compliance.pms_schedule_baselines t',                                                            't.project_id = $1 AND t.org_id = $2',                                  'compliance.pms_schedule_baselines'),
    ('ffe_items',     'compliance.interior_ffe_items t',                                                                    't.project_id = $1 AND t.org_id = $2',                                  'compliance.interior_ffe_items'),
    ('wiki_pages',    'compliance.pms_wiki_pages t',                                                                        't.project_id = $1 AND t.org_id = $2 AND NOT t.is_archived',            'compliance.pms_wiki_pages')
  ) AS v(k, f, s, r) WHERE v.k = p_kind
$fn$;

-- 3. the trigger function, 0679's plus the two kinds whose project is not a column of the row -----------------------------------------------------
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
    ELSIF v_kind = 'timesheets' THEN
      SELECT i.project_id INTO v_project FROM compliance.pms_issues i WHERE i.id = (v_row ->> 'issue_id') AND i.org_id = v_org;
    ELSIF v_kind = 'documents' THEN
      IF v_row ->> 'linked_entity_type' IS DISTINCT FROM 'project' THEN
        RETURN NULL;
      END IF;
      v_project := v_row ->> 'linked_entity_id';
    ELSIF v_kind = 'meeting_minutes' THEN
      IF v_row ->> 'context_entity_type' IS DISTINCT FROM 'project' THEN
        RETURN NULL;
      END IF;
      v_project := v_row ->> 'context_entity_id';
    ELSE
      v_project := v_row ->> 'project_id';
    END IF;

    SELECT h.version, h.content_hash, h.deleted, h.project_id INTO v_prev
    FROM platform.projexa_record_head h WHERE h.org_id = v_org AND h.kind = v_kind AND h.record_id = v_id FOR UPDATE;

    -- a child removed together with its parent (cascade): the parent is already gone, so the project is the one we recorded before
    IF v_project IS NULL AND FOUND THEN
      v_project := v_prev.project_id;
    END IF;
    IF v_org IS NULL OR v_id IS NULL OR v_project IS NULL THEN
      RETURN NULL;
    END IF;

    v_hash := encode(sha256(convert_to((v_row - 'updated_at' - 'search_vector' - 'embedding')::text, 'UTF8')), 'hex');
    IF FOUND THEN
      IF v_op <> 'D' AND NOT v_prev.deleted AND v_prev.content_hash = v_hash THEN
        RETURN NULL; -- not a real change
      END IF;
      v_ver := v_prev.version + 1;
    ELSE
      v_ver := 1;
    END IF;

    v_actor := coalesce(v_row ->> 'updated_by_id', v_row ->> 'updated_by', v_row ->> 'created_by_id', v_row ->> 'requested_by_id', v_row ->> 'raised_by_id', v_row ->> 'recorded_by_id');

    INSERT INTO platform.projexa_record_head (org_id, kind, record_id, project_id, version, content_hash, deleted, updated_at, actor_id)
    VALUES (v_org, v_kind, v_id, v_project, v_ver, v_hash, v_op = 'D', clock_timestamp(), v_actor)
    ON CONFLICT (org_id, kind, record_id)
    DO UPDATE SET project_id = EXCLUDED.project_id, version = EXCLUDED.version, content_hash = EXCLUDED.content_hash, deleted = EXCLUDED.deleted, updated_at = EXCLUDED.updated_at, actor_id = EXCLUDED.actor_id;

    INSERT INTO platform.projexa_change_log (org_id, project_id, kind, record_id, version, op, content_hash, actor_id, db_role)
    VALUES (v_org, v_project, v_kind, v_id, v_ver, v_op, v_hash, v_actor, session_user::text);
  EXCEPTION WHEN OTHERS THEN
    -- tracking is best effort by design: it must never be the reason a business write fails
    RAISE WARNING 'projexa_track_change(%): % (%)', v_kind, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION platform.projexa_track_change() FROM PUBLIC, anon, authenticated, app_runtime;

-- 4. the new triggers ------------------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('roster', 'construction_labour_roster'), ('attendance', 'construction_attendance'), ('timesheets', 'pms_time_entries'), ('meetings', 'pms_meetings'),
    ('meeting_minutes', 'veri_meetings'), ('site_diaries', 'construction_site_diaries'), ('site_instructions', 'construction_site_instructions'),
    ('progress_claims', 'construction_progress_claims'), ('interim_bills', 'construction_interim_bills'), ('material_receipts', 'construction_material_receipts'),
    ('material_issues', 'construction_material_issues'), ('expenses', 'construction_expense_entries'), ('schedule_baselines', 'pms_schedule_baselines'),
    ('ffe_items', 'interior_ffe_items'), ('wiki_pages', 'pms_wiki_pages')
  ) AS v(kind, tbl)
  LOOP
    IF to_regclass('compliance.' || r.tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_change ON compliance.%I', r.tbl);
      EXECUTE format('CREATE TRIGGER projexa_track_change AFTER INSERT OR UPDATE OR DELETE ON compliance.%I FOR EACH ROW EXECUTE FUNCTION platform.projexa_track_change(%L)', r.tbl, r.kind);
    END IF;
  END LOOP;
END $$;

COMMIT;
