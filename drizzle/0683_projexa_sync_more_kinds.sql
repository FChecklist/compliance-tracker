-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session: "complete veridian-ai software and complete database of that user and for that user organization is downloaded in the user laptop" and "user gets to see its own data, its own projects data, its own organization data - as per role". This migration widens the PROJEXA local-first sync from 13 to 28 project-scoped kinds: everything the visible screens read and the rest of what the AI work link can read.
-- PROJEXA SYNC: MORE KINDS (feat/lf-sync-backend).
--
-- WHAT
--   public.projexa_sync__kinds()   REPLACED: the one list of synced kinds, now 28 (the 13 of 0677, in the same order, then): roster, attendance, timesheets, meetings, meeting_minutes, site_diaries,
--                                  site_instructions, progress_claims, interim_bills, material_receipts, material_issues, expenses, schedule_baselines, ffe_items, wiki_pages.
--   public.projexa_sync__src()     REPLACED: the table, scope and relation of each of the 28 (the first 13 exactly as 0677). The scope is the AI work link's own (drizzle/0643, 0644): organisation AND project.
--   the 15 new tables get the three statement-level tracking triggers of 0679 (projexa_track_i / _u / _d), attached by platform.projexa_track__attach: a time entry is filed
--                                  under its issue's project (mode parent, and a time entry deleted with an untracked issue is resolved by the issue's delete), a MoM only
--                                  while it is about a project (mode link: unlinking it is a tombstone), a wiki page only while it is not archived (archiving it is a
--                                  tombstone). platform.projexa_track_change() itself is NOT redefined here (sql:SQL-09: re-running 0679 after this file regresses nothing).
--                                  A table missing in an environment is skipped.
-- ORDER: 0678 .. 0686 are one chain; apply them together and in order, roll back strictly in reverse (see 0679's header).
-- Documents already carry drawings and permits (the same rows, by category), so those are not separate kinds. `people` and the organisation-wide masters (vendors, customers, companies, categories, currencies,
-- departments) are not project-scoped and come in a later migration; `kpi_entries` (hidden module, joined scope) and `pipeline_tasks` are left out on purpose.
--
-- NOTHING IS REIMPLEMENTED AS AUTHORITY. Every row that leaves is produced by ai_work_link__records_core for that one id under the person's bound context (0677), so its columns, its money redaction by role
-- (wages, rates, costs, amounts are NULL below the role that may see them: ai_work_link__hidden_cols and cost_visibility_config), the person-masking and the project scope are the AI link's own, byte for byte.
-- The candidate list built here (ids and cursor timestamps only, scoped on organisation and project) only decides WHICH ids to ask the core about and in what order.
--
-- LOCKS: SHARE ROW EXCLUSIVE on each of the 15 tables (writes wait, reads do not), taken together NOWAIT with a short retry and held until COMMIT; none at all on a re-apply
-- whose triggers are already right. lock_timeout 5 s; one transaction.
-- DATA LOSS: none. Functions replaced, triggers added; no table altered. Applying it twice changes nothing.
-- ROLLBACK: drizzle/down/0683_projexa_sync_more_kinds.down.sql (back to the 13 kinds; drops the 15 tables' triggers)

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

-- 3. the 15 new tables get the tracking triggers of 0679 (the function is 0679's, unchanged; only the arguments say where a row belongs) ----------------
DO $$
DECLARE
  v_specs jsonb := '[
    {"k": "roster",             "t": "construction_labour_roster",     "m": "col", "a": "project_id"},
    {"k": "attendance",         "t": "construction_attendance",        "m": "col", "a": "project_id"},
    {"k": "timesheets",         "t": "pms_time_entries",               "m": "parent", "a": "pms_issues", "b": "issue_id", "p": "tasks"},
    {"k": "meetings",           "t": "pms_meetings",                   "m": "col", "a": "project_id"},
    {"k": "meeting_minutes",    "t": "veri_meetings",                  "m": "link", "a": "context_entity_type", "b": "context_entity_id"},
    {"k": "site_diaries",       "t": "construction_site_diaries",      "m": "col", "a": "project_id"},
    {"k": "site_instructions",  "t": "construction_site_instructions", "m": "col", "a": "project_id"},
    {"k": "progress_claims",    "t": "construction_progress_claims",   "m": "col", "a": "project_id"},
    {"k": "interim_bills",      "t": "construction_interim_bills",     "m": "col", "a": "project_id"},
    {"k": "material_receipts",  "t": "construction_material_receipts", "m": "col", "a": "project_id"},
    {"k": "material_issues",    "t": "construction_material_issues",   "m": "col", "a": "project_id"},
    {"k": "expenses",           "t": "construction_expense_entries",   "m": "col", "a": "project_id"},
    {"k": "schedule_baselines", "t": "pms_schedule_baselines",         "m": "col", "a": "project_id"},
    {"k": "ffe_items",          "t": "interior_ffe_items",             "m": "col", "a": "project_id"},
    {"k": "wiki_pages",         "t": "pms_wiki_pages",                 "m": "col_unless", "a": "project_id", "b": "is_archived"}
  ]'::jsonb;
BEGIN
  PERFORM platform.projexa_track__attach(v_specs);
  -- self-check (sql:SQL-08): a second pass must find nothing left to do
  IF platform.projexa_track__attach(v_specs) <> 0 THEN
    RAISE EXCEPTION 'projexa tracking self-check failed: triggers are not as specified';
  END IF;
END $$;

COMMIT;
