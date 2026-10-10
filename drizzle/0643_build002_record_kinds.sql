-- PROJEXA-BUILD-002 WP-06 (register rows AW-321 and AW-322; BUILD-001 spec sections 6.2 and 6.6, register row BR-484): the Tier-1 record kinds
-- a project manager reads besides the first 13. Twenty new kinds, three extended ones. SQL row sets, no Vercel function, no model.
--
-- WHAT
--   public.ai_work_link__records_core(ctx, kind, after, limit, filters, id) is re-created (create or replace, same signature, same
--     owner-only grants) with these changes to the version of drizzle/0625. The two public functions that call it,
--     public.ai_work_link_records and public.ai_work_link_record, are not touched: they only pass the link context in.
--   NEW KINDS (20), each with the table it reads, a scope on org_id AND project_id, an explicit column list and a sensible default order:
--     rfis, submittals, punch_list, change_orders, site_diaries, site_instructions, milestones (pms_milestones), progress_claims,
--     interim_bills, materials, material_receipts, material_issues, kpi_entries (through its KPI definition), expenses, drawings and
--     permits (both are documents of the project, read through the drawing register and permit keys of documents.metadata),
--     meeting_minutes (veri_meetings of the project), wiki_pages (not archived), ffe_items, schedule_baselines.
--   EXTENDED KINDS (3)
--     documents   gains `metadata`: a curated object made of exactly these keys of documents.metadata, each as text cut at 500 characters, null keys
--                 left out: drawingNo, rev, status, discipline, supersedesId, permitNumber, permitAuthority, issueDate, isExternalLink.
--                 Any other key (an e-mail sender, a project id, a location path) is never shown. The scope of the kind is unchanged.
--     boq_lines   gains breakdown_percentage, vendor_id, overhead_percent and profit_percent (the last three are money, see below).
--     people      gains project_role: the person's role in the project team (lead, member, ...), or `lead` for the project's lead.
--   The hidden-columns function public.ai_work_link__hidden_cols of drizzle/0624 is NOT changed: it reads the money columns of a kind
--     from platform.ai_work_link_record_kinds, so the kinds seeded below are covered by it as they are (below rank 3 every money column
--     of the kind, from rank 3 only the project-side cost fields). It is the same mechanism, not a copy of it.
--
-- MONEY. A column in a kind's money_columns is NULL in the row for a role below rank 3 (the value is never selected) and can be neither
--   filtered nor sorted for that role (HIDDEN_FIELD, unchanged rules of 0625). Money columns of the new kinds: change_orders.cost_impact;
--   progress_claims.retention_percent, customer_id, interim_bill_id; interim_bills retention_percent, gross_amount, retention_amount,
--   net_payable, retention_released_amount, sales_invoice_id; materials.unit_cost; material_receipts unit_cost, vendor_id;
--   kpi_entries target_value, actual_value (a KPI can be a money figure); expenses amount and description (a description can quote the
--   amount); ffe_items unit_cost, unit_price, vendor_id; boq_lines vendor_id, overhead_percent, profit_percent. Columns that point at
--   ledger or signing records (expenses.journal_entry_id, expenses.linked_entity_id, change_orders.esignature_request_id) are not selected.
--
-- FREE TEXT. Text columns (questions, answers, descriptions, minutes, wiki content) reach the AI as data: the Edge Function fences and
--   cleans every row it renders and says text_fields_are_data on every page, for every kind, exactly as for the first 13.
--
-- SEED. The block between the BEGIN and END GENERATED markers below is written by scripts/gen-ai-link-registry.ts (this file is the
--   generator's CURRENT_SEED_MIGRATION from now on; 0628 and 0644 keep the blocks they were applied with). It upserts the rows of
--   platform.ai_work_link_functions (the whole registry, as drizzle/0644 wrote it) and platform.ai_work_link_record_kinds (13 old rows,
--   20 new, boq_lines with three more money columns and one more filter) and re-creates public.ai_work_link__registry_version() with
--   the hash of exactly those rows. THIS FILE IS APPLIED AFTER 0644: over 0644's rows it changes only the kind rows and the version.
--
-- WHAT A ROW SHOWS, PAGING, FILTERS, ERRORS: unchanged from drizzle/0625 (header of that file). Filters and sort come only from the
--   kind's allow-list in the seed; a sort field is a NOT NULL column.
--
-- GRANTS: the core is owner-only (revoked from public, anon, authenticated, app_runtime and service_role): it trusts the link context it
--   is given, so nobody but the two public functions of 0625 may run it. Nothing new is granted to anyone (register row BR-484).
--
-- DATA LOSS: none. Functions and configuration rows only; no table of project data is touched.
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the always-aborted rehearsal passed, in the order the PM's plan gives
--   (BUILD-002 plan, migration numbers). Idempotent: create or replace, and rows upserted by key. Needs 0621 to 0628 and 0644 applied first.
--
-- ROLLBACK: drizzle/down/0643_build002_record_kinds.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

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
    v_scope := 't.project_id = $1 AND t.org_id = $2';
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

-- the core trusts the link context it is given (organisation and project), so nobody but the owner, that is the two public functions of 0625, may run it
REVOKE ALL ON FUNCTION public.ai_work_link__records_core(jsonb, text, text, integer, jsonb, text) FROM PUBLIC, anon, authenticated, app_runtime, service_role;

-- BEGIN GENERATED BY scripts/gen-ai-link-registry.ts (do not edit by hand; run the generator)
-- registry version de06635d6880e20033899f2b45d50773186f2630a31628abbf43c28df949d446
DELETE FROM platform.ai_work_link_functions WHERE function_id <> ALL (ARRAY['add_boq_lines', 'add_roster_entry', 'create_activity', 'create_boq', 'create_boq_revision', 'create_document', 'create_meeting', 'create_project', 'detect_construction_budget_schedule_risk', 'generate_construction_progress_summary', 'get_compliance_stats', 'get_construction_budget_status', 'get_construction_kpi_status', 'get_construction_project_dashboard', 'get_overdue_items', 'get_sales_pipeline_overview', 'list_compliance_items', 'list_customers', 'list_delayed_activities', 'list_departments', 'list_gst_import_batches', 'list_gst_returns', 'list_leads', 'list_notices', 'list_opportunities', 'list_over_budget_projects', 'list_sales_orders', 'record_attendance', 'record_timesheet', 'record_work_progress', 'review_budget', 'seal_boq', 'update_project']::text[]);
INSERT INTO platform.ai_work_link_functions (function_id, product, kind, link_level, money_sensitive, min_role_rank, excluded_reason, text_params) VALUES
  ('add_boq_lines', 'projexa', 'write', 2, true, 2, NULL, '{}'::text[]),
  ('add_roster_entry', 'projexa', 'write', 2, true, 2, NULL, ARRAY['name', 'trade', 'employeeCode']::text[]),
  ('create_activity', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name', 'unit']::text[]),
  ('create_boq', 'projexa', 'write', 2, true, 2, NULL, ARRAY['title']::text[]),
  ('create_boq_revision', 'projexa', 'write', 2, true, 2, NULL, ARRAY['title']::text[]),
  ('create_document', 'projexa', 'write', 1, false, 2, NULL, ARRAY['name', 'category']::text[]),
  ('create_meeting', 'projexa', 'write', 1, false, 2, NULL, ARRAY['title']::text[]),
  ('create_project', 'projexa', 'write', NULL, false, 0, 'A link is bound to one project, so it cannot make another one: the New project with my AI flow and the internal pipeline do.', '{}'::text[]),
  ('detect_construction_budget_schedule_risk', 'projexa', 'read', NULL, false, 0, 'Calls a server-side model (F-2): the internal AI never runs on link traffic.', '{}'::text[]),
  ('generate_construction_progress_summary', 'projexa', 'read', NULL, false, 0, 'Calls a server-side model (F-2): the internal AI never runs on link traffic.', '{}'::text[]),
  ('get_compliance_stats', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('get_construction_budget_status', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('get_construction_kpi_status', 'projexa', 'read', 0, true, 3, NULL, '{}'::text[]),
  ('get_construction_project_dashboard', 'projexa', 'read', 0, true, 1, NULL, '{}'::text[]),
  ('get_overdue_items', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('get_sales_pipeline_overview', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_compliance_items', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_customers', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_delayed_activities', 'projexa', 'read', NULL, false, 0, 'Reads the whole organisation, not one project (F-3).', '{}'::text[]),
  ('list_departments', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_gst_import_batches', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_gst_returns', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_leads', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_notices', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_opportunities', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('list_over_budget_projects', 'projexa', 'read', NULL, false, 0, 'Reads the whole organisation, not one project (F-3).', '{}'::text[]),
  ('list_sales_orders', 'projexa', 'read', NULL, false, 0, 'Organisation-scoped read, not project data (F-3).', '{}'::text[]),
  ('record_attendance', 'projexa', 'write', 1, false, 2, NULL, '{}'::text[]),
  ('record_timesheet', 'projexa', 'write', 1, false, 2, NULL, ARRAY['task', 'activityType']::text[]),
  ('record_work_progress', 'projexa', 'write', 1, false, 2, NULL, ARRAY['remarks']::text[]),
  ('review_budget', 'projexa', 'read', NULL, false, 0, 'An alias that duplicates get_construction_budget_status.', '{}'::text[]),
  ('seal_boq', 'projexa', 'write', 2, true, 3, NULL, '{}'::text[]),
  ('update_project', 'projexa', 'write', 2, true, 2, NULL, ARRAY['name', 'description']::text[])
ON CONFLICT (function_id) DO UPDATE SET
  product = EXCLUDED.product, kind = EXCLUDED.kind, link_level = EXCLUDED.link_level, money_sensitive = EXCLUDED.money_sensitive,
  min_role_rank = EXCLUDED.min_role_rank, excluded_reason = EXCLUDED.excluded_reason, text_params = EXCLUDED.text_params;

DELETE FROM platform.ai_work_link_record_kinds WHERE kind <> ALL (ARRAY['project', 'boqs', 'boq_lines', 'activities', 'progress', 'tasks', 'meetings', 'documents', 'roster', 'attendance', 'timesheets', 'pipeline_tasks', 'people', 'rfis', 'submittals', 'punch_list', 'change_orders', 'site_diaries', 'site_instructions', 'milestones', 'progress_claims', 'interim_bills', 'materials', 'material_receipts', 'material_issues', 'kpi_entries', 'expenses', 'drawings', 'permits', 'meeting_minutes', 'wiki_pages', 'ffe_items', 'schedule_baselines']::text[]);
INSERT INTO platform.ai_work_link_record_kinds (kind, money_columns, filters) VALUES
  ('project', ARRAY['project_value', 'vat_rate_percent', 'retention_percent']::text[], '{"fields":{},"sort":[]}'::jsonb),
  ('boqs', ARRAY['contract_value_override']::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"version":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["version","created_at"]}'::jsonb),
  ('boq_lines', ARRAY['rate', 'amount', 'material_cost', 'labour_cost', 'equipment_cost', 'budget_percentage', 'vendor_amount', 'material_amount', 'manpower_amount', 'rate_project', 'rate_contract', 'vendor_id', 'overhead_percent', 'profit_percent']::text[], '{"fields":{"boq_id":{"type":"text","ops":["eq","in"]},"item_code":{"type":"text","ops":["eq","in"]},"category":{"type":"text","ops":["eq","in"]},"quantity":{"type":"numeric","ops":["eq","gt","lt"]},"rate":{"type":"numeric","ops":["eq","gt","lt"]},"amount":{"type":"numeric","ops":["eq","gt","lt"]},"budget_percentage":{"type":"numeric","ops":["eq","gt","lt"]},"breakdown_percentage":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["created_at","quantity","rate","amount","budget_percentage"]}'::jsonb),
  ('activities', '{}'::text[], '{"fields":{"category_id":{"type":"text","ops":["eq","in"]},"name":{"type":"text","ops":["eq"]}},"sort":["name","created_at"]}'::jsonb),
  ('progress', '{}'::text[], '{"fields":{"entry_date":{"type":"date","ops":["eq","gt","lt"]},"activity_id":{"type":"text","ops":["eq","in"]},"boq_line_item_id":{"type":"text","ops":["eq","in"]},"percent_complete":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["entry_date","percent_complete","created_at"]}'::jsonb),
  ('tasks', '{}'::text[], '{"fields":{"status_id":{"type":"text","ops":["eq","in"]},"priority":{"type":"text","ops":["eq","in"]},"assignee_id":{"type":"text","ops":["eq","in"]},"number":{"type":"numeric","ops":["eq","gt","lt"]},"due_date":{"type":"date","ops":["eq","gt","lt"]},"completion_percentage":{"type":"numeric","ops":["eq","gt","lt"]},"is_archived":{"type":"boolean","ops":["eq"]}},"sort":["number","priority","completion_percentage","created_at","updated_at"]}'::jsonb),
  ('meetings', '{}'::text[], '{"fields":{"scheduled_at":{"type":"timestamptz","ops":["gt","lt"]}},"sort":["scheduled_at","created_at"]}'::jsonb),
  ('documents', '{}'::text[], '{"fields":{"category":{"type":"text","ops":["eq","in"]},"name":{"type":"text","ops":["eq"]}},"sort":["name","created_at","version_number"]}'::jsonb),
  ('roster', ARRAY['daily_rate']::text[], '{"fields":{"trade":{"type":"text","ops":["eq","in"]},"is_active":{"type":"boolean","ops":["eq"]},"daily_rate":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["name","created_at","daily_rate"]}'::jsonb),
  ('attendance', ARRAY['daily_cost']::text[], '{"fields":{"attendance_date":{"type":"date","ops":["eq","gt","lt"]},"roster_id":{"type":"text","ops":["eq","in"]},"status":{"type":"text","ops":["eq","in"]},"daily_cost":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["attendance_date","created_at","daily_cost"]}'::jsonb),
  ('timesheets', ARRAY['hourly_rate_snapshot', 'invoice_item_id']::text[], '{"fields":{"spent_on":{"type":"date","ops":["eq","gt","lt"]},"issue_id":{"type":"text","ops":["eq","in"]},"user_id":{"type":"text","ops":["eq","in"]},"activity_type":{"type":"text","ops":["eq","in"]},"hours":{"type":"numeric","ops":["eq","gt","lt"]},"hourly_rate_snapshot":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["spent_on","hours","created_at"]}'::jsonb),
  ('pipeline_tasks', ARRAY['params', 'result']::text[], '{"fields":{"function_id":{"type":"text","ops":["eq","in"]},"status":{"type":"text","ops":["eq","in"]},"created_at":{"type":"timestamptz","ops":["gt","lt"]}},"sort":["created_at","sequence","status"],"omit_when_hidden":["params","result"]}'::jsonb),
  ('people', '{}'::text[], '{"fields":{"role":{"type":"text","ops":["eq","in"]}},"sort":["name"]}'::jsonb),
  ('rfis', '{}'::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"ball_in_court":{"type":"text","ops":["eq","in"]},"assigned_to_id":{"type":"text","ops":["eq","in"]},"due_date":{"type":"date","ops":["eq","gt","lt"]},"number":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["number","created_at"]}'::jsonb),
  ('submittals', '{}'::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"type":{"type":"text","ops":["eq","in"]},"due_date":{"type":"date","ops":["eq","gt","lt"]},"number":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["number","created_at"]}'::jsonb),
  ('punch_list', '{}'::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"priority":{"type":"text","ops":["eq","in"]},"trade":{"type":"text","ops":["eq","in"]},"assigned_to_id":{"type":"text","ops":["eq","in"]},"due_date":{"type":"date","ops":["eq","gt","lt"]},"number":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["number","created_at"]}'::jsonb),
  ('change_orders', ARRAY['cost_impact']::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"trade":{"type":"text","ops":["eq","in"]},"number":{"type":"numeric","ops":["eq","gt","lt"]},"cost_impact":{"type":"numeric","ops":["eq","gt","lt"]},"schedule_impact_days":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["number","created_at","cost_impact","schedule_impact_days"]}'::jsonb),
  ('site_diaries', '{}'::text[], '{"fields":{"diary_date":{"type":"date","ops":["eq","gt","lt"]}},"sort":["diary_date","created_at"]}'::jsonb),
  ('site_instructions', '{}'::text[], '{"fields":{"issue_date":{"type":"date","ops":["eq","gt","lt"]},"si_number":{"type":"numeric","ops":["eq","gt","lt"]},"cost_impact":{"type":"boolean","ops":["eq"]},"time_impact":{"type":"boolean","ops":["eq"]}},"sort":["si_number","issue_date","created_at"]}'::jsonb),
  ('milestones', '{}'::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"target_date":{"type":"date","ops":["eq","gt","lt"]}},"sort":["name","created_at"]}'::jsonb),
  ('progress_claims', ARRAY['retention_percent', 'customer_id', 'interim_bill_id']::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"boq_id":{"type":"text","ops":["eq","in"]},"scheduled_date":{"type":"date","ops":["eq","gt","lt"]},"retention_percent":{"type":"numeric","ops":["eq","gt","lt"]},"customer_id":{"type":"text","ops":["eq","in"]}},"sort":["scheduled_date","created_at","retention_percent"]}'::jsonb),
  ('interim_bills', ARRAY['retention_percent', 'gross_amount', 'retention_amount', 'net_payable', 'retention_released_amount', 'sales_invoice_id']::text[], '{"fields":{"boq_id":{"type":"text","ops":["eq","in"]},"bill_number":{"type":"numeric","ops":["eq","gt","lt"]},"bill_date":{"type":"date","ops":["eq","gt","lt"]},"gross_amount":{"type":"numeric","ops":["eq","gt","lt"]},"net_payable":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["bill_number","bill_date","created_at","gross_amount","net_payable"]}'::jsonb),
  ('materials', ARRAY['unit_cost']::text[], '{"fields":{"name":{"type":"text","ops":["eq"]},"is_active":{"type":"boolean","ops":["eq"]},"unit_cost":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["name","created_at","unit_cost"]}'::jsonb),
  ('material_receipts', ARRAY['unit_cost', 'vendor_id']::text[], '{"fields":{"material_id":{"type":"text","ops":["eq","in"]},"received_date":{"type":"date","ops":["eq","gt","lt"]},"quantity":{"type":"numeric","ops":["eq","gt","lt"]},"unit_cost":{"type":"numeric","ops":["eq","gt","lt"]},"vendor_id":{"type":"text","ops":["eq","in"]}},"sort":["received_date","created_at","quantity"]}'::jsonb),
  ('material_issues', '{}'::text[], '{"fields":{"material_id":{"type":"text","ops":["eq","in"]},"boq_line_item_id":{"type":"text","ops":["eq","in"]},"issued_date":{"type":"date","ops":["eq","gt","lt"]},"quantity":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["issued_date","created_at","quantity"]}'::jsonb),
  ('kpi_entries', ARRAY['target_value', 'actual_value']::text[], '{"fields":{"kpi_definition_id":{"type":"text","ops":["eq","in"]},"metric_name":{"type":"text","ops":["eq","in"]},"period":{"type":"text","ops":["eq","in"]},"approval_status":{"type":"text","ops":["eq","in"]},"actual_value":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["created_at","period","actual_value"]}'::jsonb),
  ('expenses', ARRAY['amount', 'description']::text[], '{"fields":{"expense_head":{"type":"text","ops":["eq","in"]},"expense_date":{"type":"date","ops":["eq","gt","lt"]},"is_rework":{"type":"boolean","ops":["eq"]},"amount":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["expense_date","created_at","amount"]}'::jsonb),
  ('drawings', '{}'::text[], '{"fields":{"drawing_no":{"type":"text","ops":["eq","in"]},"revision":{"type":"text","ops":["eq","in"]},"drawing_status":{"type":"text","ops":["eq","in"]},"discipline":{"type":"text","ops":["eq","in"]},"category":{"type":"text","ops":["eq","in"]}},"sort":["name","created_at","version_number"]}'::jsonb),
  ('permits', '{}'::text[], '{"fields":{"permit_number":{"type":"text","ops":["eq","in"]},"permit_authority":{"type":"text","ops":["eq","in"]},"expiry_date":{"type":"timestamptz","ops":["gt","lt"]}},"sort":["name","created_at"]}'::jsonb),
  ('meeting_minutes', '{}'::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"meeting_type":{"type":"text","ops":["eq","in"]},"scheduled_at":{"type":"timestamptz","ops":["gt","lt"]}},"sort":["scheduled_at","created_at"]}'::jsonb),
  ('wiki_pages', '{}'::text[], '{"fields":{"slug":{"type":"text","ops":["eq","in"]},"title":{"type":"text","ops":["eq"]}},"sort":["slug","title","updated_at"]}'::jsonb),
  ('ffe_items', ARRAY['unit_cost', 'unit_price', 'vendor_id']::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"category":{"type":"text","ops":["eq","in"]},"room_or_area":{"type":"text","ops":["eq","in"]},"unit_cost":{"type":"numeric","ops":["eq","gt","lt"]},"unit_price":{"type":"numeric","ops":["eq","gt","lt"]},"vendor_id":{"type":"text","ops":["eq","in"]}},"sort":["item_name","created_at","unit_cost","unit_price"]}'::jsonb),
  ('schedule_baselines', '{}'::text[], '{"fields":{"name":{"type":"text","ops":["eq"]}},"sort":["name","created_at"]}'::jsonb)
ON CONFLICT (kind) DO UPDATE SET money_columns = EXCLUDED.money_columns, filters = EXCLUDED.filters;

CREATE OR REPLACE FUNCTION public.ai_work_link__registry_version()
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT 'de06635d6880e20033899f2b45d50773186f2630a31628abbf43c28df949d446'::text $fn$;

REVOKE ALL ON FUNCTION public.ai_work_link__registry_version() FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__registry_version() TO service_role;
-- END GENERATED

COMMIT;
