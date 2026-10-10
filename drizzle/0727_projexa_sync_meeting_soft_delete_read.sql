-- PRE-APPROVED-LIVE-DDL: Owner delegated full PM authority and ordered the 100-point audit gaps closed, in chat on 2026-10-05; re-creates public.projexa_sync__src and the SECURITY DEFINER public.ai_work_link__records_core so a soft-deleted project meeting (pms_meetings.deleted_at set) is no longer served by the sync pull, the sync id list, the pull-by-ids or the AI link's record reads (AUDIT-100 B8).
-- PROJEXA SYNC: A DELETED MEETING LEAVES THE READ PATH TOO (AUDIT-100 row B8, fix/b8-sync-deletes-remove-source).
--
-- THE DEFECT (measured 2026-10-05 against the live service): delete_meeting pushed through projexa-sync /push answered "applied"; the meeting service set
-- compliance.pms_meetings.deleted_at (the documented soft delete, drizzle/0687) and the tracking trigger (0687's mode col_unset) recorded the tombstone
-- (platform.projexa_record_head deleted = true, version 2). But the READ side never learned about the column: public.projexa_sync__src('meetings') (0683)
-- and public.ai_work_link__records_core('meetings') (0643) still scoped meetings on project and organisation only. So /pull kept serving the deleted
-- meeting as a live row, /ids kept listing it (a laptop drops only what is no longer listed), and pull-by-ids handed it back. The laptop never dropped it.
-- 0687 changed the write side and the tracking; this file brings the two read functions into line with them.
--
-- WHAT
--   public.projexa_sync__src()           REPLACED: identical to 0683 except the meetings scope gains `AND t.deleted_at IS NULL` (feeds /pull, /ids, the ids digest)
--   public.ai_work_link__records_core()  REPLACED: identical to 0643 (verified byte-equal, whitespace-normalised, to the live definition on 2026-10-05) except the
--                                        meetings scope gains `AND t.deleted_at IS NULL` (feeds pull-by-ids, the sync items and the AI link's records/meetings)
--   No other kind changes. Every other delete_* function was checked (see the PR): hard deletes leave the source table (the delete trigger tombstones them);
--   the other soft deletes (archive_task is_archived, delete_mom status 'deleted', delete_boq_category is_active false, void_material_receipt, cancel_change_order)
--   stay IN the stream as an ordinary versioned update carrying their new status, consistently on the tracking and the read side; wiki_pages was already filtered on both.
-- GRANTS: CREATE OR REPLACE keeps each function's owner and privileges (0643 / 0683 set them); none are changed here.
-- LOCKS: none on any table. DATA LOSS: none (functions only). Applying it twice changes nothing.
-- ORDER: after 0687 (the column). Roll back this file BEFORE 0687's down file (that one may drop deleted_at).
-- ROLLBACK: drizzle/down/0727_projexa_sync_meeting_soft_delete_read.down.sql (puts 0683's and 0643's definitions back)

BEGIN;

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
    ('meetings',      'compliance.pms_meetings t',                                                                          't.project_id = $1 AND t.org_id = $2 AND t.deleted_at IS NULL',         'compliance.pms_meetings'),
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

CREATE OR REPLACE FUNCTION public.ai_work_link__records_core(
  p_ctx jsonb, p_kind text, p_after text, p_limit integer, p_filters jsonb, p_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_org text := p_ctx ->> 'org_id';
  v_project text := p_ctx ->> 'project_id';
  v_user text := p_ctx ->> 'user_id';
  v_role text := p_ctx ->> 'live_role';
  v_hide boolean := coalesce((p_ctx ->> 'hide_personal')::boolean, true);
  v_kind record;
  v_hidden text[];
  v_omit text[];
  v_from text;
  v_scope text;
  v_cols text[];
  v_natural text[];
  v_select text;
  v_where text := '';
  v_ord text[];
  v_dir text := 'asc';
  v_order text;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_key text;
  v_val jsonb;
  v_op text;
  v_field text;
  v_def jsonb;
  v_type text;
  v_lit text;
  v_sort text;
  v_list text;
  v_ok boolean;
  v_sql text;
  v_items jsonb;
  v_next text;
BEGIN
  SELECT k.kind, k.filters INTO v_kind FROM platform.ai_work_link_record_kinds k WHERE k.kind = p_kind;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_KIND' USING ERRCODE = 'AW400';
  END IF;
  IF jsonb_typeof(v_filters) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'BAD_FILTER_VALUE' USING ERRCODE = 'AW400';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(v_filters)) > 12 THEN
    RAISE EXCEPTION 'BAD_FILTER_VALUE' USING ERRCODE = 'AW400';
  END IF;
  IF p_id IS NOT NULL AND p_id !~ '^[A-Za-z0-9._:-]{1,64}$' THEN
    RETURN jsonb_build_object('kind', p_kind, 'items', '[]'::jsonb, 'next_after', NULL, 'hidden_fields', '[]'::jsonb);
  END IF;

  v_hidden := public.ai_work_link__hidden_cols(p_kind, v_org, v_role);
  v_omit := ARRAY(SELECT jsonb_array_elements_text(coalesce(v_kind.filters -> 'omit_when_hidden', '[]'::jsonb)));

  -- 1. what the kind is: its table, its scope in the link's project and organisation, its columns ---------------------------------
  --    $1 project id, $2 organisation id, $3 the link's person, $4 hide_personal, $5 cursor id, $6 record id
  IF p_kind = 'project' THEN
    v_from := 'compliance.projects t';
    v_scope := 't.id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'name', 'description', 'is_active', 'status', 'access_level', 'health_status', 'lead_user_id',
                    'start_date', 'target_date', 'rollup_percentage', 'created_at', 'updated_at',
                    'project_value', 'vat_rate_percent', 'retention_percent'];
    v_natural := ARRAY['t.id'];
  ELSIF p_kind = 'boqs' THEN
    v_from := 'compliance.construction_boqs t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'project_id', 'version', 'parent_boq_id', 'title', 'status', 'created_by_id', 'approved_by_id',
                    'approved_at', 'created_at', 'updated_at', 'contract_value_override'];
    v_natural := ARRAY['t.id'];
  ELSIF p_kind = 'boq_lines' THEN
    v_from := 'compliance.construction_boq_line_items t JOIN compliance.construction_boqs b ON b.id = t.boq_id';
    v_scope := 'b.project_id = $1 AND b.org_id = $2 AND t.org_id = $2';
    v_cols := ARRAY['id', 'boq_id', 'activity_id', 'item_code', 'description', 'unit', 'quantity', 'category',
                    'parent_line_item_id', 'created_at', 'qty_contract', 'rate', 'amount', 'material_cost', 'labour_cost',
                    'equipment_cost', 'budget_percentage', 'vendor_amount', 'material_amount', 'manpower_amount',
                    'rate_project', 'rate_contract',
                    'breakdown_percentage', 'vendor_id', 'overhead_percent', 'profit_percent'];
    v_natural := ARRAY['t.boq_id', 't.id'];
  ELSIF p_kind = 'activities' THEN
    v_from := 'compliance.construction_activities t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'category_id', 'name', 'unit', 'planned_quantity', 'created_at'];
    v_natural := ARRAY['t.id'];
  ELSIF p_kind = 'progress' THEN
    v_from := 'compliance.construction_work_progress_entries t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'activity_id', 'boq_line_item_id', 'entry_date', 'quantity_done', 'percent_complete', 'remarks',
                    'recorded_by_id', 'entry_basis', 'created_at'];
    v_natural := ARRAY['t.id'];
  ELSIF p_kind = 'tasks' THEN
    v_from := 'compliance.pms_issues t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'number', 'title', 'description', 'priority', 'status_id', 'type_id', 'assignee_id', 'parent_issue_id',
                    'milestone_id', 'start_date', 'due_date', 'is_archived', 'completion_percentage', 'created_by_id',
                    'created_at', 'updated_at'];
    v_natural := ARRAY['t.id'];
  ELSIF p_kind = 'meetings' THEN
    v_from := 'compliance.pms_meetings t';
    -- 0727: a soft-deleted meeting (deleted_at set, drizzle/0687) is absent, exactly as the meeting service and the sync's own tracking (mode col_unset) treat it
    v_scope := 't.project_id = $1 AND t.org_id = $2 AND t.deleted_at IS NULL';
    v_cols := ARRAY['id', 'title', 'scheduled_at', 'duration_minutes', 'recurrence_rule', 'created_at'];
    v_natural := ARRAY['t.id'];
  ELSIF p_kind = 'documents' THEN
    -- metadata is a curated object of the keys the drawing register and the permits keep there, each as text and nulls left out;
    -- no other key of documents.metadata is ever shown
    v_from := $q$(SELECT d.id, d.org_id, d.name, d.category, d.file_type, d.file_size, d.expiry_date, d.version_number,
                         d.is_latest_version, d.created_at, d.linked_entity_type, d.linked_entity_id,
                         nullif(jsonb_strip_nulls(jsonb_build_object(
                           'drawingNo', left(d.metadata ->> 'drawingNo', 500), 'rev', left(d.metadata ->> 'rev', 500), 'status', left(d.metadata ->> 'status', 500),
                           'discipline', left(d.metadata ->> 'discipline', 500), 'supersedesId', left(d.metadata ->> 'supersedesId', 500),
                           'permitNumber', left(d.metadata ->> 'permitNumber', 500), 'permitAuthority', left(d.metadata ->> 'permitAuthority', 500),
                           'issueDate', left(d.metadata ->> 'issueDate', 500), 'isExternalLink', left(d.metadata ->> 'isExternalLink', 500))),
                           '{}'::jsonb) AS metadata
                    FROM compliance.documents d) t$q$;
    v_scope := 't.linked_entity_type = ''project'' AND t.linked_entity_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'name', 'category', 'file_type', 'file_size', 'expiry_date', 'version_number', 'is_latest_version',
                    'created_at', 'linked_entity_type', 'linked_entity_id', 'metadata'];
    v_natural := ARRAY['t.id'];
  ELSIF p_kind = 'roster' THEN
    v_from := 'compliance.construction_labour_roster t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'name', 'trade', 'skill_level', 'employee_code', 'is_active', 'created_at', 'daily_rate'];
    v_natural := ARRAY['t.id'];
  ELSIF p_kind = 'attendance' THEN
    v_from := 'compliance.construction_attendance t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'roster_id', 'attendance_date', 'status', 'hours_worked', 'created_at', 'daily_cost'];
    v_natural := ARRAY['t.id'];
  ELSIF p_kind = 'timesheets' THEN
    v_from := 'compliance.pms_time_entries t JOIN compliance.pms_issues i ON i.id = t.issue_id';
    v_scope := 'i.project_id = $1 AND i.org_id = $2 AND t.org_id = $2';
    v_cols := ARRAY['id', 'issue_id', 'user_id', 'hours', 'spent_on', 'activity_type', 'comments', 'billable',
                    'approval_status', 'created_at', 'hourly_rate_snapshot', 'invoice_item_id'];
    v_natural := ARRAY['t.id'];
  ELSIF p_kind = 'pipeline_tasks' THEN
    v_from := 'compliance.pipeline_tasks t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'submission_id', 'sequence', 'function_id', 'status', 'executor', 'error_code', 'created_at',
                    'updated_at', 'params', 'result'];
    v_natural := ARRAY['t.id'];
  ELSIF p_kind = 'people' THEN
    v_from := 'compliance.users t';
    v_scope := 't.org_id = $2 AND (t.id = $3 OR t.id IN (SELECT public.ai_work_link__project_people($2, $1)))';
    v_natural := ARRAY['lower(t.name)', 't.id'];
  ELSIF p_kind = 'rfis' THEN
    v_from := 'compliance.construction_rfis t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'number', 'subject', 'question', 'status', 'ball_in_court', 'raised_by_id', 'assigned_to_id', 'due_date',
                    'answer', 'answered_by_id', 'answered_at', 'created_at'];
    v_natural := ARRAY['t.number', 't.id'];
  ELSIF p_kind = 'submittals' THEN
    v_from := 'compliance.construction_submittals t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'number', 'title', 'spec_section', 'type', 'status', 'submitted_by_id', 'due_date', 'reviewed_by_id',
                    'reviewed_at', 'review_comments', 'created_at'];
    v_natural := ARRAY['t.number', 't.id'];
  ELSIF p_kind = 'punch_list' THEN
    v_from := 'compliance.construction_punch_list_items t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'number', 'description', 'location', 'trade', 'priority', 'status', 'assigned_to_id', 'due_date',
                    'verified_by_id', 'verified_at', 'created_by_id', 'created_at'];
    v_natural := ARRAY['t.number', 't.id'];
  ELSIF p_kind = 'change_orders' THEN
    -- esignature_request_id is left out on purpose: it points at a signing request that stores external signers' e-mail addresses
    v_from := 'compliance.construction_change_orders t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'number', 'title', 'description', 'reason', 'cost_impact', 'schedule_impact_days', 'status',
                    'requested_by_id', 'approved_by_id', 'approved_at', 'trade', 'boq_revision_id', 'created_at'];
    v_natural := ARRAY['t.number', 't.id'];
  ELSIF p_kind = 'site_diaries' THEN
    v_from := 'compliance.construction_site_diaries t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'diary_date', 'weather', 'work_done', 'visitors', 'issues', 'instructions', 'material_received',
                    'labour_count', 'remarks', 'recorded_by_id', 'created_at'];
    v_natural := ARRAY['t.diary_date', 't.id'];
  ELSIF p_kind = 'site_instructions' THEN
    -- cost_impact and time_impact are yes/no flags on this table, not amounts
    v_from := 'compliance.construction_site_instructions t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'si_number', 'issue_date', 'issued_by', 'to_contractor', 'description', 'drawing_ref', 'cost_impact',
                    'time_impact', 'boq_id', 'created_at'];
    v_natural := ARRAY['t.si_number', 't.id'];
  ELSIF p_kind = 'milestones' THEN
    v_from := 'compliance.pms_milestones t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'name', 'description', 'status', 'target_date', 'created_at'];
    v_natural := ARRAY['t.created_at', 't.id'];
  ELSIF p_kind = 'progress_claims' THEN
    v_from := 'compliance.construction_progress_claims t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'boq_id', 'milestone_description', 'scheduled_date', 'status', 'drafted_at', 'submitted_at', 'approved_at',
                    'rejected_at', 'rejection_reason', 'invoiced_at', 'created_at', 'updated_at',
                    'retention_percent', 'customer_id', 'interim_bill_id'];
    v_natural := ARRAY['t.scheduled_date', 't.id'];
  ELSIF p_kind = 'interim_bills' THEN
    v_from := 'compliance.construction_interim_bills t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'boq_id', 'bill_number', 'bill_date', 'retention_released_at', 'created_at',
                    'retention_percent', 'gross_amount', 'retention_amount', 'net_payable', 'retention_released_amount',
                    'sales_invoice_id'];
    v_natural := ARRAY['t.bill_number', 't.id'];
  ELSIF p_kind = 'materials' THEN
    v_from := 'compliance.construction_materials t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'name', 'spec', 'unit', 'reorder_level', 'is_active', 'created_at', 'unit_cost'];
    v_natural := ARRAY['t.name', 't.id'];
  ELSIF p_kind = 'material_receipts' THEN
    v_from := 'compliance.construction_material_receipts t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'material_id', 'received_date', 'quantity', 'reference', 'notes', 'voided_at', 'void_reason', 'created_at',
                    'unit_cost', 'vendor_id'];
    v_natural := ARRAY['t.received_date', 't.id'];
  ELSIF p_kind = 'material_issues' THEN
    v_from := 'compliance.construction_material_issues t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'material_id', 'issued_date', 'quantity', 'boq_line_item_id', 'issued_to', 'note', 'created_at'];
    v_natural := ARRAY['t.issued_date', 't.id'];
  ELSIF p_kind = 'kpi_entries' THEN
    -- an entry has no organisation or project of its own: both come from its KPI definition, and an organisation-wide KPI
    -- (project_id null) is never in a project's link
    v_from := $q$(SELECT e.id, d.org_id, d.project_id, e.kpi_definition_id, d.metric_name, d.unit, e.period,
                         e.approval_status::text AS approval_status, e.approved_at, e.created_at, d.target_value, e.actual_value
                    FROM compliance.construction_kpi_entries e
                    JOIN compliance.construction_kpi_definitions d ON d.id = e.kpi_definition_id) t$q$;
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'kpi_definition_id', 'metric_name', 'unit', 'period', 'approval_status', 'approved_at', 'created_at',
                    'target_value', 'actual_value'];
    v_natural := ARRAY['t.created_at', 't.id'];
  ELSIF p_kind = 'expenses' THEN
    -- linked_entity_id and journal_entry_id are left out on purpose (they point at ledger records); description can quote an amount
    v_from := 'compliance.construction_expense_entries t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'expense_head', 'expense_date', 'is_rework', 'recorded_by_id', 'created_at', 'amount', 'description'];
    v_natural := ARRAY['t.expense_date', 't.id'];
  ELSIF p_kind = 'drawings' THEN
    -- the drawing register lives in documents.metadata (drawingNo, rev, status, discipline, supersedesId): read from there
    v_from := $q$(SELECT d.id, d.org_id, d.linked_entity_id AS project_id, d.name, d.category, d.file_type,
                         left(d.metadata ->> 'drawingNo', 500) AS drawing_no, left(d.metadata ->> 'rev', 500) AS revision,
                         left(d.metadata ->> 'status', 500) AS drawing_status, left(d.metadata ->> 'discipline', 500) AS discipline,
                         left(d.metadata ->> 'supersedesId', 500) AS supersedes_id, d.version_number, d.is_latest_version, d.created_at
                    FROM compliance.documents d
                   WHERE d.linked_entity_type = 'project' AND d.category IN ('drawing', 'drawing_3d')) t$q$;
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'name', 'category', 'file_type', 'drawing_no', 'revision', 'drawing_status', 'discipline', 'supersedes_id',
                    'version_number', 'is_latest_version', 'created_at'];
    v_natural := ARRAY['t.name', 't.id'];
  ELSIF p_kind = 'permits' THEN
    v_from := $q$(SELECT d.id, d.org_id, d.linked_entity_id AS project_id, d.name, d.expiry_date,
                         left(d.metadata ->> 'permitNumber', 500) AS permit_number, left(d.metadata ->> 'permitAuthority', 500) AS permit_authority,
                         left(d.metadata ->> 'issueDate', 500) AS issue_date, d.created_at
                    FROM compliance.documents d
                   WHERE d.linked_entity_type = 'project' AND d.category = 'permit') t$q$;
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'name', 'permit_number', 'permit_authority', 'issue_date', 'expiry_date', 'created_at'];
    v_natural := ARRAY['t.name', 't.id'];
  ELSIF p_kind = 'meeting_minutes' THEN
    -- the attendee list is not shown (it can hold e-mail addresses): only how many people were invited. No model output is shown.
    v_from := $q$(SELECT m.id, m.org_id, m.context_entity_id AS project_id, m.title, m.meeting_type, m.scheduled_at, m.status,
                         m.published_at, m.agenda, m.minutes,
                         CASE WHEN jsonb_typeof(m.attendees) = 'array' THEN jsonb_array_length(m.attendees) END AS attendee_count,
                         m.created_at
                    FROM compliance.veri_meetings m
                   WHERE m.context_entity_type = 'project') t$q$;
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'title', 'meeting_type', 'scheduled_at', 'status', 'published_at', 'agenda', 'minutes', 'attendee_count',
                    'created_at'];
    v_natural := ARRAY['t.scheduled_at', 't.id'];
  ELSIF p_kind = 'wiki_pages' THEN
    v_from := 'compliance.pms_wiki_pages t';
    v_scope := 't.project_id = $1 AND t.org_id = $2 AND NOT t.is_archived';
    v_cols := ARRAY['id', 'parent_page_id', 'slug', 'title', 'content', 'version', 'created_at', 'updated_at'];
    v_natural := ARRAY['t.slug', 't.id'];
  ELSIF p_kind = 'ffe_items' THEN
    v_from := 'compliance.interior_ffe_items t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'room_or_area', 'category', 'item_name', 'description', 'sku', 'quantity', 'lead_time_days', 'status',
                    'document_id', 'created_at', 'unit_cost', 'unit_price', 'vendor_id'];
    v_natural := ARRAY['t.item_name', 't.id'];
  ELSIF p_kind = 'schedule_baselines' THEN
    v_from := 'compliance.pms_schedule_baselines t';
    v_scope := 't.project_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'name', 'captured_by_id', 'created_at'];
    v_natural := ARRAY['t.created_at', 't.id'];
  ELSE
    RAISE EXCEPTION 'UNKNOWN_KIND' USING ERRCODE = 'AW400';
  END IF;

  -- 2. the select list: a hidden column is never selected (NULL in its place, or left out for omit_when_hidden) --------------------
  IF p_kind = 'people' THEN
    v_select := 't.id AS id, t.name AS name, '
      || 'CASE WHEN $4 AND t.id <> $3 THEN public.ai_work_link__mask_email(t.email) ELSE t.email END AS email, '
      || 't.role::text AS role, '
      || $q$COALESCE((SELECT m.role FROM compliance.project_team_members m
                       WHERE m.project_id = $1 AND m.org_id = $2 AND m.user_id = t.id ORDER BY m.created_at, m.id LIMIT 1),
                     CASE WHEN t.id = (SELECT p.lead_user_id FROM compliance.projects p WHERE p.id = $1 AND p.org_id = $2)
                          THEN 'lead' END) AS project_role, $q$
      || '(t.id = $3) AS is_you';
  ELSE
    v_select := array_to_string(ARRAY(
      SELECT CASE
               WHEN c = ANY (v_hidden) AND c = ANY (v_omit) THEN NULL
               WHEN c = ANY (v_hidden) THEN 'NULL AS ' || quote_ident(c)
               ELSE 't.' || quote_ident(c) || ' AS ' || quote_ident(c)
             END
      FROM unnest(v_cols) WITH ORDINALITY AS u(c, n)
      ORDER BY n), ', ');
  END IF;

  -- 3. filters and sort ---------------------------------------------------------------------------------------------------------------
  FOR v_key, v_val IN SELECT e.key, e.value FROM jsonb_each(v_filters) AS e ORDER BY e.key LOOP
    IF v_key = 'sort' THEN
      v_sort := btrim(v_val #>> '{}');
      IF v_sort IS NULL OR v_sort = '' THEN
        RAISE EXCEPTION 'UNKNOWN_FILTER' USING ERRCODE = 'AW400';
      END IF;
      v_dir := CASE WHEN left(v_sort, 1) = '-' THEN 'desc' ELSE 'asc' END;
      v_field := regexp_replace(v_sort, '^-', '');
      IF NOT coalesce(v_kind.filters -> 'sort', '[]'::jsonb) ? v_field THEN
        RAISE EXCEPTION 'UNKNOWN_FILTER' USING ERRCODE = 'AW400';
      END IF;
      IF v_field = ANY (v_hidden) THEN
        RAISE EXCEPTION 'HIDDEN_FIELD' USING ERRCODE = 'AW403';
      END IF;
      v_ord := ARRAY['t.' || quote_ident(v_field), 't.id'];
    ELSE
      v_op := (regexp_match(v_key, '_(eq|gt|lt|in)$'))[1];
      IF v_op IS NULL THEN
        RAISE EXCEPTION 'UNKNOWN_FILTER' USING ERRCODE = 'AW400';
      END IF;
      v_field := left(v_key, length(v_key) - length(v_op) - 1);
      v_def := v_kind.filters -> 'fields' -> v_field;
      IF v_def IS NULL OR NOT coalesce(v_def -> 'ops', '[]'::jsonb) ? v_op THEN
        RAISE EXCEPTION 'UNKNOWN_FILTER' USING ERRCODE = 'AW400';
      END IF;
      IF v_field = ANY (v_hidden) THEN
        RAISE EXCEPTION 'HIDDEN_FIELD' USING ERRCODE = 'AW403';
      END IF;
      v_type := v_def ->> 'type';
      IF v_type IS NULL OR v_type NOT IN ('text', 'numeric', 'date', 'timestamptz', 'boolean') THEN
        RAISE EXCEPTION 'UNKNOWN_FILTER' USING ERRCODE = 'AW400';
      END IF;
      v_lit := v_val #>> '{}';
      IF v_lit IS NULL OR jsonb_typeof(v_val) IN ('object', 'array', 'null') THEN
        RAISE EXCEPTION 'BAD_FILTER_VALUE' USING ERRCODE = 'AW400';
      END IF;
      IF v_op = 'in' THEN
        IF cardinality(string_to_array(v_lit, ',')) > 50 THEN
          RAISE EXCEPTION 'BAD_FILTER_VALUE' USING ERRCODE = 'AW400';
        END IF;
        v_where := v_where || format(' AND (t.%I)::%s = ANY (string_to_array(%L, '','')::%s[])', v_field, v_type, v_lit, v_type);
      ELSE
        v_where := v_where || format(' AND (t.%I)::%s %s (%L)::%s', v_field, v_type,
                                     CASE v_op WHEN 'eq' THEN '=' WHEN 'gt' THEN '>' ELSE '<' END, v_lit, v_type);
      END IF;
    END IF;
  END LOOP;

  v_ord := coalesce(v_ord, v_natural);
  v_order := array_to_string(ARRAY(SELECT e || ' ' || v_dir FROM unnest(v_ord) AS e), ', ');

  -- 4. the cursor: the id of the last row of the previous page, read back inside this link's scope ------------------------------------
  IF p_after IS NOT NULL THEN
    IF p_after !~ '^[A-Za-z0-9._:-]{1,64}$' THEN
      RAISE EXCEPTION 'BAD_CURSOR' USING ERRCODE = 'AW400';
    END IF;
    v_list := array_to_string(v_ord, ', ');
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %s AND t.id = $5)', v_from, v_scope)
      INTO v_ok USING v_project, v_org, v_user, v_hide, p_after, p_id;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'BAD_CURSOR' USING ERRCODE = 'AW400';
    END IF;
    v_where := v_where || format(' AND (%s) %s (SELECT %s FROM %s WHERE %s AND t.id = $5)',
                                 v_list, CASE v_dir WHEN 'asc' THEN '>' ELSE '<' END, v_list, v_from, v_scope);
  END IF;
  IF p_id IS NOT NULL THEN
    v_where := v_where || ' AND t.id = $6';
  END IF;

  -- 5. the page: one row more than asked for tells whether another page exists ------------------------------------------------------
  v_sql := format(
    'SELECT coalesce(jsonb_agg(to_jsonb(q) - ''_rn'' ORDER BY q._rn), ''[]''::jsonb) FROM ('
    || 'SELECT row_number() OVER (ORDER BY %1$s) AS _rn, %2$s FROM %3$s WHERE %4$s%5$s ORDER BY %1$s LIMIT %6$s) q',
    v_order, v_select, v_from, v_scope, v_where, v_limit + 1);
  BEGIN
    EXECUTE v_sql INTO v_items USING v_project, v_org, v_user, v_hide, p_after, p_id;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
                 OR numeric_value_out_of_range OR invalid_parameter_value THEN
    RAISE EXCEPTION 'BAD_FILTER_VALUE' USING ERRCODE = 'AW400';
  END;

  IF jsonb_array_length(v_items) > v_limit THEN
    v_next := (v_items -> (v_limit - 1)) ->> 'id';
    v_items := v_items - v_limit;
  END IF;

  RETURN jsonb_build_object('kind', p_kind, 'items', v_items, 'next_after', v_next, 'hidden_fields', to_jsonb(v_hidden));
END
$fn$;

COMMIT;
