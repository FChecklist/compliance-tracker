-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session ("a user sees their own organisation's data as per role"); this is the rollback of the organisation-masters migration of the PROJEXA local-first sync.
-- Down-migration for drizzle/0684_projexa_sync_org_masters.sql. Run deliberately by the PM, not by any script.
-- ORDER: the 9 triggers go FIRST (so no business write can reach a function that is about to change), then the trigger function is put back to 0683's
-- definition and the manifest to 0678's (both copied byte for byte), then the organisation functions are dropped.
-- DATA LOSS: the version heads and change-log rows already recorded under the sentinel project '__org__' stay (harmless: nothing reads them once the
-- functions are gone; a later re-apply continues their version numbers). No business table is touched. Laptops that copied organisation kinds keep
-- their copy until they next read a manifest without `org_kinds`.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_suppliers', 'erp_customers', 'erp_companies', 'construction_boq_categories', 'erp_currencies', 'erp_exchange_rates', 'departments', 'users', 'cost_visibility_config'] LOOP
    IF to_regclass('compliance.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_change ON compliance.%I', t);
    END IF;
  END LOOP;
END $$;

-- 0683's trigger function, exactly
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

-- 0678's manifest, exactly
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

  SELECT jsonb_agg(jsonb_build_object('kind', k.kind, 'project_scoped', true, 'cursor_field', public.projexa_sync__cursor_field((SELECT s.rel FROM public.projexa_sync__src(k.kind) s)), 'deletes_supported', true) ORDER BY k.n)
    INTO v_kinds
  FROM unnest(public.projexa_sync__kinds()) WITH ORDINALITY AS k(kind, n);

  RETURN jsonb_build_object(
    'status', 'ok',
    'user', jsonb_build_object('id', v_user, 'name', v_ctx ->> 'user_name', 'role', v_ctx ->> 'live_role', 'org_id', v_org),
    'projects', v_projects,
    'kinds', v_kinds,
    'view_class', public.projexa_sync__view_class(v_org, v_ctx ->> 'live_role'));
END
$fn$;
REVOKE ALL ON FUNCTION public.projexa_sync_manifest(text, text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_manifest(text, text) FROM app_runtime';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.projexa_sync_manifest(text, text) TO service_role;

DROP FUNCTION IF EXISTS public.projexa_sync_org_changes(text, text, bigint, integer);
DROP FUNCTION IF EXISTS public.projexa_sync_org_ids(text, text, text, text, integer);
DROP FUNCTION IF EXISTS public.projexa_sync_org_pull_ids(text, text, text, text[]);
DROP FUNCTION IF EXISTS public.projexa_sync_org_pull(text, text, text, text, text, integer);
DROP FUNCTION IF EXISTS public.projexa_sync__org_who(text, text);
DROP FUNCTION IF EXISTS public.projexa_sync__org_items(text, text, text, text[], jsonb);
DROP FUNCTION IF EXISTS public.projexa_sync__org_row_sql(text, text[]);
DROP FUNCTION IF EXISTS public.projexa_sync__org_view_class(text, text);
DROP FUNCTION IF EXISTS public.projexa_sync__org_hidden_cols(text, text, text);
DROP FUNCTION IF EXISTS public.projexa_sync__org_can_read(text, text);
DROP FUNCTION IF EXISTS public.projexa_sync__org_cols(text);
DROP FUNCTION IF EXISTS public.projexa_sync__org_src(text);
DROP FUNCTION IF EXISTS public.projexa_sync__org_kinds();

COMMIT;
