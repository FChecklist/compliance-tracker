-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session ("a user sees their own organisation's data as per role"); this is the rollback of the organisation-masters migration of the PROJEXA local-first sync.
-- Down-migration for drizzle/0684_projexa_sync_org_masters.sql. Run deliberately by the PM, not by any script.
-- ORDER: roll back strictly in REVERSE (0686, then this file, then 0683 .. 0678; see 0679's header). This file refuses to run while 0686's functions exist.
-- Inside: the 9 tables' tracking triggers go FIRST (so no business write reaches a function that is about to be dropped), then the manifest is put back to
-- 0678's definition (copied byte for byte), then the organisation functions are dropped. The trigger function is 0679's and is not touched.
-- DATA LOSS: the version heads and change-log rows already recorded under the sentinel project '__org__' stay (harmless: nothing reads them once the
-- functions are gone; a later re-apply continues their version numbers). No business table is touched. Laptops that copied organisation kinds keep
-- their copy until they next read a manifest without `org_kinds`.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  t text;
BEGIN
  IF to_regprocedure('public.projexa_sync_heads(text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'roll back 0686 before 0684 (strict reverse order)';
  END IF;
  FOREACH t IN ARRAY ARRAY['erp_suppliers', 'erp_customers', 'erp_companies', 'construction_boq_categories', 'erp_currencies', 'erp_exchange_rates', 'departments', 'users', 'cost_visibility_config'] LOOP
    IF to_regclass('compliance.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_i ON compliance.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_u ON compliance.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_d ON compliance.%I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS projexa_track_change ON compliance.%I', t);
    END IF;
  END LOOP;
END $$;

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
