-- PROJEXA-BUILD-001 U-46 step 1 (database), migration 5 of 8 (register rows BR-484; spec sections 6.2 and 6.6, audit A-09, A-11, A-21):
-- the Tier-1 read functions of the Universal AI Work Link. SQL row sets, no Vercel function, no model.
--
-- WHAT
--   public.ai_work_link_records(p_token, p_kind, p_after, p_limit, p_filters) -> jsonb
--     one page of one record kind of the link's project: {kind, items[], next_after, hidden_fields[]}. The kinds are project, boqs,
--     boq_lines, activities, progress, tasks, meetings, documents, roster, attendance, timesheets, pipeline_tasks and people
--     (spec 6.2); a kind must also have a row in platform.ai_work_link_record_kinds (migration 8 fills it).
--   public.ai_work_link_record(p_token, p_kind, p_id) -> jsonb
--     one record by id, or NULL: an id that is not in the link's project is NULL, exactly like a missing id (harness H17, the 404).
--   public.ai_work_link__records_core(ctx, kind, after, limit, filters, id) -> jsonb
--     the one implementation of both. Not callable by anyone but its owner (it trusts the link context it is given), so the two
--     functions above are the only way in.
--
-- WHAT THE LINK'S SCOPE IS. The organisation and the project come only from the resolved link (ai_work_link__resolve of migration 4),
--   never from an argument. Every kind carries its own scope predicate on org_id AND project_id (documents through
--   linked_entity_type = 'project'; boq_lines through their BOQ; timesheets through their issue), and the link's person is the
--   person: hide_personal masks every other person's e-mail in the 'people' kind.
--
-- WHAT A ROW SHOWS. Each kind selects an explicit column list, never *, so a column added to a table later is not shown until this
--   file is changed: the deny-list residual of threat T10 does not apply to the record kinds. Money columns are listed per kind in
--   platform.ai_work_link_record_kinds.money_columns. For a role below rank 3 they are NULL in the row (the value is never selected),
--   and for the kinds that list them in filters.omit_when_hidden (pipeline_tasks params and result, which can carry a daily rate) the
--   key is left out. From rank 3 the project-side cost fields (rate_project, qty_project, project_value) are still hidden unless the
--   organisation's cost-visibility configuration grants the role (ai_work_link__hidden_cols, migration 4).
--
-- FILTERS AND SORT (spec 6.6, audit A-09). p_filters is a JSON object: <field>_<op> with op eq, gt, lt or in (in takes a comma list of
--   at most 50 values), and sort = <field> or -<field>; at most 12 keys in all. Only the fields the kind's filters name are accepted; anything else is
--   UNKNOWN_FILTER. A field that is hidden for the role, a money column below rank 3 or a cost field the configuration withholds, can
--   be neither filtered nor sorted: HIDDEN_FIELD. Otherwise repeated range filters would recover a value the row shows as NULL.
--   Values reach SQL only as quoted literals cast to the field's declared type; a value that does not cast is BAD_FILTER_VALUE.
--
-- PAGING. Keyset. p_limit is 1 to 200 (default 50). p_after is the id of the last row of the previous page (at most 64 characters
--   of A-Z a-z 0-9 . _ : -); the function reads that row's sort key in the link's scope and continues after it, so the cursor
--   carries no value and cannot point outside the link's project (an id that is not in scope is BAD_CURSOR). Default order: id, and for
--   boq_lines (boq_id, id); people by lower(name), id. With sort the order is that field then id, in one direction.
--
-- ERRORS: coded exceptions, listed in the header of drizzle/0624_build001_awl_link_functions.sql.
--
-- GRANTS: the three functions are SECURITY DEFINER with search_path = pg_catalog, pg_temp, revoked from public, anon,
--   authenticated and app_runtime. ai_work_link_records and ai_work_link_record are granted to service_role alone; the core is owner-only
--   (register row BR-484, SHARED_BOUNDARY.md R5).
--
-- DATA LOSS: none. Additive: functions only.
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the claim (ACTIVE-CLAIMS, 2026-09-25) is on main, the always-aborted
--   rehearsal passed, and migrations 0621 to 0624 are applied. Idempotent: create or replace.
--
-- ROLLBACK: drizzle/down/0625_build001_awl_read_functions.down.sql

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

CREATE OR REPLACE FUNCTION public.ai_work_link_records(
  p_token text, p_kind text, p_after text DEFAULT NULL, p_limit integer DEFAULT 50, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN public.ai_work_link__records_core(public.ai_work_link__require(p_token), p_kind, p_after, p_limit, p_filters, NULL);
END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link_record(p_token text, p_kind text, p_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_page jsonb := public.ai_work_link__records_core(public.ai_work_link__require(p_token), p_kind, NULL, 1, '{}'::jsonb, p_id);
BEGIN
  RETURN v_page -> 'items' -> 0;
END
$fn$;

-- the core trusts the link context it is given (organisation and project), so nobody but the owner, that is the two functions below, may run it
REVOKE ALL ON FUNCTION public.ai_work_link__records_core(jsonb, text, text, integer, jsonb, text) FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_records(text, text, text, integer, jsonb) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_records(text, text, text, integer, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_record(text, text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_record(text, text, text) TO service_role;

COMMIT;
