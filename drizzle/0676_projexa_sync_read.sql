-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session ("this has to be done, build it"): every user's laptop works as a daughter server and keeps a local replica of the projects its person may read, so Vercel and GitHub do little or nothing; Supabase stays the durable relay and backup. This migration is the SQL half of the READ side of that sync (Edge function supabase/functions/projexa-sync).
-- PROJEXA LOCAL-FIRST SYNC, READ SIDE (feat/projexa-sync-read).
--
-- WHAT. Two functions, both reached only by the projexa-sync Edge function through the service-role key, both taking the PROJEXA person as
-- (p_sub, p_email) exactly as public.projexa_read_resolve_user (drizzle/0618) does:
--   public.projexa_sync_manifest(p_sub, p_email)  who the person is, the projects the person may read (the very rule of
--       ai_work_link_projects: same organisation and ai_work_link__can_read_project), and the record kinds that can be pulled with the field each uses as its cursor.
--   public.projexa_sync_pull(p_sub, p_email, p_project_id, p_kind, p_after_ts, p_after_id, p_limit)  one page of one kind of one project,
--       in keyset order (cursor field, id), with the cursor field being updated_at where the table has one and created_at where it does not.
-- NOTHING IS REIMPLEMENTED AS AUTHORITY. The person is resolved by projexa_read_resolve_user; the project is bound by ai_work_link__bind (0668: the
-- project must be in the person's organisation and readable by the person NOW, else AW404, the same answer as a project that does not exist);
-- and EVERY row that leaves is produced by ai_work_link__records_core (0643) called for that one id with that bound context, so the row's
-- scope (org_id AND project_id), its columns, its money redaction by role (ai_work_link__hidden_cols, cost-visibility config) and the person-masking
-- are the AI work link's own, byte for byte. The candidate list this file builds (ids and cursor timestamps only, scoped on org and project) only
-- decides WHICH ids to ask the core about and in WHAT order; a candidate the core does not return (outside scope, bad id) is simply absent.
-- The context is that of a USER link: hide_personal true, the same as ai_work_link_mint_user_for (0668).
--
-- ERRORS (coded, the same as the link): AW404 NOT_FOUND for an unknown project, a project of another organisation, a project the person may not read
-- and an unknown or unsupported kind (one answer, no existence oracle); AW400 BAD_CURSOR / BAD_LIMIT. A person who does not resolve (not linked,
-- deactivated, ambiguous) gets {"status": <reason>} and no data.
-- DELETES: no table of a supported kind is soft-deleted in a way that removes the row from the view; a hard delete is not propagated (manifest
-- says deletes_supported false). Rows that are archived (tasks.is_archived) are still returned, with the flag.
--
-- GRANTS: SECURITY DEFINER, search_path = pg_catalog, pg_temp, timezone UTC; revoked from public, anon, authenticated, app_runtime; granted to service_role alone. The
-- helper projexa_sync__src is owner-only.
-- DATA LOSS: none. Functions only; no table is touched. Applying it twice changes nothing.
-- ROLLBACK: drizzle/down/0676_projexa_sync_read.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- the table, scope (on $1 project, $2 organisation) and relation of every supported kind: the same scopes as ai_work_link__records_core (0643)
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

-- the cursor field of a relation: updated_at when the table has the column, else created_at
CREATE OR REPLACE FUNCTION public.projexa_sync__cursor_field(p_rel text)
RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(p_rel) AND a.attname = 'updated_at' AND NOT a.attisdropped AND a.attnum > 0)
              THEN 'updated_at' ELSE 'created_at' END
$fn$;

-- the user-link context of a resolved person (what ai_work_link__resolve answers for a user link, minus the link itself)
CREATE OR REPLACE FUNCTION public.projexa_sync__ctx(p_user_id text, p_org_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_u record;
BEGIN
  SELECT u.id, u.name, u.role::text AS role, u.is_active, u.org_id INTO v_u FROM compliance.users u WHERE u.id = p_user_id;
  IF NOT FOUND OR NOT v_u.is_active OR v_u.org_id IS DISTINCT FROM p_org_id THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'status', 'ok', 'scope', 'user', 'org_id', v_u.org_id, 'user_id', v_u.id, 'user_name', v_u.name,
    'project_id', NULL, 'project_name', NULL, 'live_role', v_u.role, 'live_rank', public.ai_work_link__role_rank(v_u.role),
    'allowed_functions', '[]'::jsonb, 'hide_personal', true);
END
$fn$;

CREATE OR REPLACE FUNCTION public.projexa_sync_manifest(p_sub text, p_email text)
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
  v_projects jsonb;
  v_kinds jsonb;
BEGIN
  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  v_ctx := public.projexa_sync__ctx(v_user, v_org);
  IF v_ctx IS NULL THEN
    RETURN jsonb_build_object('status', 'not_linked');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'status', pr.status::text)
                            ORDER BY pr.is_active DESC, pr.created_at DESC, pr.id), '[]'::jsonb)
    INTO v_projects
  FROM compliance.projects pr
  WHERE pr.org_id = v_org AND public.ai_work_link__can_read_project(pr.access_level::text, pr.lead_user_id, v_user, v_ctx ->> 'live_role');

  SELECT jsonb_agg(jsonb_build_object('kind', k.kind, 'project_scoped', true, 'cursor_field', public.projexa_sync__cursor_field((SELECT s.rel FROM public.projexa_sync__src(k.kind) s)), 'deletes_supported', false) ORDER BY k.n)
    INTO v_kinds
  FROM unnest(ARRAY['project', 'tasks', 'boqs', 'boq_lines', 'activities', 'progress', 'rfis', 'submittals', 'punch_list', 'change_orders', 'milestones', 'materials', 'documents']) WITH ORDINALITY AS k(kind, n);

  RETURN jsonb_build_object(
    'status', 'ok',
    'user', jsonb_build_object('id', v_user, 'name', v_ctx ->> 'user_name', 'role', v_ctx ->> 'live_role', 'org_id', v_org),
    'projects', v_projects,
    'kinds', v_kinds);
END
$fn$;

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

REVOKE ALL ON FUNCTION public.projexa_sync__src(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__cursor_field(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__ctx(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync_manifest(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_pull(text, text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__src(text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__cursor_field(text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__ctx(text, text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_manifest(text, text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_pull(text, text, text, text, text, text, integer) FROM app_runtime';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.projexa_sync_manifest(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_pull(text, text, text, text, text, text, integer) TO service_role;

COMMIT;
