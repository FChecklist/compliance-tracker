-- Down-migration for drizzle/0643_build002_record_kinds.sql (PROJEXA-BUILD-002 WP-06). Convention: docs/ROLLBACK_RUNBOOK.md section 3.
-- Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the forward file.
--
-- WHAT IT RESTORES: the state after 0644 (0643 is applied after it). public.ai_work_link__records_core is re-created with the body of drizzle/0625 (13 kinds; documents
-- without metadata, boq_lines and people without the added columns), the 20 kinds of 0643 are deleted from
-- platform.ai_work_link_record_kinds, the 13 old kind rows are put back as 0644 wrote them (boq_lines with its old money columns and
-- filters), the function rows are those of 0644, and public.ai_work_link__registry_version() returns the hash of 0644 again. The seed
-- block below is the block of drizzle/0644_build002_awl_seed_project_boq.sql, unchanged.
--
-- ORDER: run it after the down file of any migration numbered above 0643 that re-seeds the kinds, and before the down file of 0644.
-- A link minted after 0643 keeps working: its record kinds are looked up at read time, and a kind that no longer exists answers 404.
--
-- DATA LOSS: none. Functions and configuration rows only.
--
-- WHEN IT REFUSES: never. Create or replace, delete by key and upsert by key; safe to run twice.

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
                    'rate_project', 'rate_contract'];
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
    v_from := 'compliance.documents t';
    v_scope := 't.linked_entity_type = ''project'' AND t.linked_entity_id = $1 AND t.org_id = $2';
    v_cols := ARRAY['id', 'name', 'category', 'file_type', 'file_size', 'expiry_date', 'version_number', 'is_latest_version',
                    'created_at', 'linked_entity_type', 'linked_entity_id'];
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
  ELSE
    RAISE EXCEPTION 'UNKNOWN_KIND' USING ERRCODE = 'AW400';
  END IF;

  -- 2. the select list: a hidden column is never selected (NULL in its place, or left out for omit_when_hidden) --------------------
  IF p_kind = 'people' THEN
    v_select := 't.id AS id, t.name AS name, '
      || 'CASE WHEN $4 AND t.id <> $3 THEN public.ai_work_link__mask_email(t.email) ELSE t.email END AS email, '
      || 't.role::text AS role, (t.id = $3) AS is_you';
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

REVOKE ALL ON FUNCTION public.ai_work_link__records_core(jsonb, text, text, integer, jsonb, text) FROM PUBLIC, anon, authenticated, app_runtime, service_role;

-- BEGIN GENERATED BY scripts/gen-ai-link-registry.ts (do not edit by hand; run the generator)
-- registry version f44aa5a72b3cb232f582912fb2d32e4dfea3fddc973afecf707af86faafdfa8c
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

DELETE FROM platform.ai_work_link_record_kinds WHERE kind <> ALL (ARRAY['project', 'boqs', 'boq_lines', 'activities', 'progress', 'tasks', 'meetings', 'documents', 'roster', 'attendance', 'timesheets', 'pipeline_tasks', 'people']::text[]);
INSERT INTO platform.ai_work_link_record_kinds (kind, money_columns, filters) VALUES
  ('project', ARRAY['project_value', 'vat_rate_percent', 'retention_percent']::text[], '{"fields":{},"sort":[]}'::jsonb),
  ('boqs', ARRAY['contract_value_override']::text[], '{"fields":{"status":{"type":"text","ops":["eq","in"]},"version":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["version","created_at"]}'::jsonb),
  ('boq_lines', ARRAY['rate', 'amount', 'material_cost', 'labour_cost', 'equipment_cost', 'budget_percentage', 'vendor_amount', 'material_amount', 'manpower_amount', 'rate_project', 'rate_contract']::text[], '{"fields":{"boq_id":{"type":"text","ops":["eq","in"]},"item_code":{"type":"text","ops":["eq","in"]},"category":{"type":"text","ops":["eq","in"]},"quantity":{"type":"numeric","ops":["eq","gt","lt"]},"rate":{"type":"numeric","ops":["eq","gt","lt"]},"amount":{"type":"numeric","ops":["eq","gt","lt"]},"budget_percentage":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["created_at","quantity","rate","amount","budget_percentage"]}'::jsonb),
  ('activities', '{}'::text[], '{"fields":{"category_id":{"type":"text","ops":["eq","in"]},"name":{"type":"text","ops":["eq"]}},"sort":["name","created_at"]}'::jsonb),
  ('progress', '{}'::text[], '{"fields":{"entry_date":{"type":"date","ops":["eq","gt","lt"]},"activity_id":{"type":"text","ops":["eq","in"]},"boq_line_item_id":{"type":"text","ops":["eq","in"]},"percent_complete":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["entry_date","percent_complete","created_at"]}'::jsonb),
  ('tasks', '{}'::text[], '{"fields":{"status_id":{"type":"text","ops":["eq","in"]},"priority":{"type":"text","ops":["eq","in"]},"assignee_id":{"type":"text","ops":["eq","in"]},"number":{"type":"numeric","ops":["eq","gt","lt"]},"due_date":{"type":"date","ops":["eq","gt","lt"]},"completion_percentage":{"type":"numeric","ops":["eq","gt","lt"]},"is_archived":{"type":"boolean","ops":["eq"]}},"sort":["number","priority","completion_percentage","created_at","updated_at"]}'::jsonb),
  ('meetings', '{}'::text[], '{"fields":{"scheduled_at":{"type":"timestamptz","ops":["gt","lt"]}},"sort":["scheduled_at","created_at"]}'::jsonb),
  ('documents', '{}'::text[], '{"fields":{"category":{"type":"text","ops":["eq","in"]},"name":{"type":"text","ops":["eq"]}},"sort":["name","created_at","version_number"]}'::jsonb),
  ('roster', ARRAY['daily_rate']::text[], '{"fields":{"trade":{"type":"text","ops":["eq","in"]},"is_active":{"type":"boolean","ops":["eq"]},"daily_rate":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["name","created_at","daily_rate"]}'::jsonb),
  ('attendance', ARRAY['daily_cost']::text[], '{"fields":{"attendance_date":{"type":"date","ops":["eq","gt","lt"]},"roster_id":{"type":"text","ops":["eq","in"]},"status":{"type":"text","ops":["eq","in"]},"daily_cost":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["attendance_date","created_at","daily_cost"]}'::jsonb),
  ('timesheets', ARRAY['hourly_rate_snapshot', 'invoice_item_id']::text[], '{"fields":{"spent_on":{"type":"date","ops":["eq","gt","lt"]},"issue_id":{"type":"text","ops":["eq","in"]},"user_id":{"type":"text","ops":["eq","in"]},"activity_type":{"type":"text","ops":["eq","in"]},"hours":{"type":"numeric","ops":["eq","gt","lt"]},"hourly_rate_snapshot":{"type":"numeric","ops":["eq","gt","lt"]}},"sort":["spent_on","hours","created_at"]}'::jsonb),
  ('pipeline_tasks', ARRAY['params', 'result']::text[], '{"fields":{"function_id":{"type":"text","ops":["eq","in"]},"status":{"type":"text","ops":["eq","in"]},"created_at":{"type":"timestamptz","ops":["gt","lt"]}},"sort":["created_at","sequence","status"],"omit_when_hidden":["params","result"]}'::jsonb),
  ('people', '{}'::text[], '{"fields":{"role":{"type":"text","ops":["eq","in"]}},"sort":["name"]}'::jsonb)
ON CONFLICT (kind) DO UPDATE SET money_columns = EXCLUDED.money_columns, filters = EXCLUDED.filters;

CREATE OR REPLACE FUNCTION public.ai_work_link__registry_version()
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT 'f44aa5a72b3cb232f582912fb2d32e4dfea3fddc973afecf707af86faafdfa8c'::text $fn$;

REVOKE ALL ON FUNCTION public.ai_work_link__registry_version() FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__registry_version() TO service_role;
-- END GENERATED

COMMIT;
