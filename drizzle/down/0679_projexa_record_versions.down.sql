-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session ("complete this 100%"; "each file in user to have proper number, version and recorded in backend"); this is the rollback of the record-versions / change-log migration of that work.
-- Down-migration for drizzle/0679_projexa_record_versions.sql. Run deliberately by the PM, not by any script.
-- ORDER: the triggers go FIRST (so no business write can reach the function while it is being dropped), then the function, then the tables.
-- DATA LOSS: the whole version head and change log (every record version and every tombstone recorded so far). No business table is touched. Laptops re-pull (versions read 0 again).
-- projexa_sync_pull is restored to exactly its 0677 definition (no version on items).
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY['projects', 'pms_issues', 'construction_boqs', 'construction_boq_line_items', 'construction_activities', 'construction_work_progress_entries', 'construction_rfis',
                               'construction_submittals', 'construction_punch_list_items', 'construction_change_orders', 'pms_milestones', 'construction_materials', 'documents']) AS tbl
  LOOP
    IF to_regclass('compliance.' || r.tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_change ON compliance.%I', r.tbl);
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.projexa_sync_changes(text, text, text, bigint, integer);
DROP FUNCTION IF EXISTS public.projexa_sync_pull_ids(text, text, text, text, text[]);

CREATE OR REPLACE FUNCTION public.projexa_sync_pull(
  p_sub text, p_email text, p_project_id text, p_kind text, p_after_ts text, p_after_id text, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_user text;
  v_org text;
  v_reason text;
  v_ctx jsonb;
  v_bound jsonb;
  v_src record;
  v_ts text;
  v_limit integer;
  v_cands jsonb;
  v_n integer;
  v_after_ts timestamptz;
  v_where text := '';
  v_items jsonb := '[]'::jsonb;
  v_c jsonb;
  v_page jsonb;
  v_row jsonb;
  v_hidden text[];
  v_has_more boolean := false;
  v_last jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'BAD_LIMIT' USING ERRCODE = 'AW400';
  END IF;
  v_limit := p_limit;

  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  v_ctx := public.projexa_sync__ctx(v_user, v_org);
  IF v_ctx IS NULL THEN
    RETURN jsonb_build_object('status', 'not_linked');
  END IF;

  -- the project binds for this person NOW (same organisation, readable by the person) or the answer is the one 404
  v_bound := public.ai_work_link__bind(v_ctx, p_project_id);
  IF v_bound IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  SELECT s.from_sql, s.scope_sql, s.rel INTO v_src FROM public.projexa_sync__src(p_kind) s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;

  v_ts := format('(coalesce(t.%1$I, t.created_at))::timestamptz', public.projexa_sync__cursor_field(v_src.rel));

  IF p_after_ts IS NOT NULL OR p_after_id IS NOT NULL THEN
    IF p_after_ts IS NULL OR p_after_id IS NULL OR p_after_ts !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
       OR p_after_id !~ '^[A-Za-z0-9._:-]{1,64}$' THEN
      RAISE EXCEPTION 'BAD_CURSOR' USING ERRCODE = 'AW400';
    END IF;
    v_after_ts := p_after_ts::timestamptz;
    v_where := format(' AND (%s, t.id) > ($3, $4)', v_ts);
  END IF;

  -- candidates: ids and cursor timestamps only, in keyset order, one more than the page to learn whether another page exists
  EXECUTE format(
    'SELECT coalesce(jsonb_agg(jsonb_build_object(''id'', c.id, ''ts'', to_char(c.ts AT TIME ZONE ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')) ORDER BY c.ts, c.id), ''[]''::jsonb) '
    || 'FROM (SELECT t.id AS id, %1$s AS ts FROM %2$s WHERE %3$s%4$s ORDER BY %1$s, t.id LIMIT %5$s) c',
    v_ts, v_src.from_sql, v_src.scope_sql, v_where, v_limit + 1)
    INTO v_cands USING p_project_id, v_org, v_after_ts, p_after_id;

  v_n := jsonb_array_length(v_cands);
  IF v_n > v_limit THEN
    v_has_more := true;
    v_cands := v_cands - v_limit;
  END IF;

  v_hidden := public.ai_work_link__hidden_cols(p_kind, v_org, v_ctx ->> 'live_role');

  -- every row is the AI work link's own row for that id, produced under the bound context (scope, columns, money and person redaction)
  FOR v_c IN SELECT e FROM jsonb_array_elements(v_cands) AS e LOOP
    v_page := public.ai_work_link__records_core(v_bound, p_kind, NULL, 1, '{}'::jsonb, v_c ->> 'id');
    v_row := v_page -> 'items' -> 0;
    IF v_row IS NOT NULL THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object('id', v_c ->> 'id', 'updated_at', v_c ->> 'ts', 'data', v_row));
    END IF;
  END LOOP;

  v_n := jsonb_array_length(v_cands);
  v_last := CASE WHEN v_n > 0 THEN v_cands -> (v_n - 1) END;
  RETURN jsonb_build_object(
    'status', 'ok',
    'items', v_items,
    'has_more', v_has_more,
    'next_ts', v_last ->> 'ts',
    'next_id', v_last ->> 'id',
    'hidden_fields', to_jsonb(v_hidden),
    'money_visible', (v_ctx ->> 'live_rank')::integer >= 3,
    'redacted', coalesce(cardinality(v_hidden), 0) > 0);
END
$fn$;

DROP FUNCTION IF EXISTS public.projexa_sync__items(jsonb, text, text, jsonb);
DROP FUNCTION IF EXISTS platform.projexa_track_change();
DROP TABLE IF EXISTS platform.projexa_change_log;
DROP TABLE IF EXISTS platform.projexa_record_head;

COMMIT;
