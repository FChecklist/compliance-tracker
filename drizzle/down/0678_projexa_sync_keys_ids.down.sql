-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session: "complete this 100%" and "do all these on local + supabase + git"; this is the rollback of the signing-keys / deletes-reconcile / view-class migration of that work.
-- Down-migration for drizzle/0678_projexa_sync_keys_ids.sql. Run deliberately by the PM, not by any script.
-- DATA LOSS: the signing key table (every key, so every signature made so far stops verifying; laptops simply re-pull). Nothing else is touched: no business table.
-- projexa_sync_manifest is restored to exactly its 0677 definition (deletes_supported false, no view_class).
BEGIN;

DROP FUNCTION IF EXISTS public.projexa_sync_ids(text, text, text, text, text, integer);

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

DROP FUNCTION IF EXISTS public.projexa_sync__view_class(text, text);
DROP FUNCTION IF EXISTS public.projexa_sync_public_keys();
DROP FUNCTION IF EXISTS public.projexa_sync_key_rotate();
DROP FUNCTION IF EXISTS public.projexa_sync_key_put(text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.projexa_sync_key_active();
DROP TABLE IF EXISTS platform.projexa_sync_key;

COMMIT;
