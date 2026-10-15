-- PRE-APPROVED-LIVE-DDL: roll-back of drizzle/0739_projexa_sync_manifest_internal_ai.sql (Owner-delegated PM authority, 2026-10-08)
-- down: restore the manifest body exactly as live before 0739 (no internal_ai field)
CREATE OR REPLACE FUNCTION public.projexa_sync_manifest(p_sub text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_user text;
  v_org text;
  v_reason text;
  v_ctx jsonb;
  v_projects jsonb;
  v_kinds jsonb;
  v_org_kinds jsonb;
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

  -- only the organisation kinds this person's role may read (the others answer the one 404)
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'project_scoped', false, 'cursor_field', public.projexa_sync__cursor_field((SELECT s.rel FROM public.projexa_sync__org_src(k.kind) s)),
                                               'deletes_supported', true, 'peer_shareable', k.kind <> 'org_people') ORDER BY k.n), '[]'::jsonb)
    INTO v_org_kinds
  FROM unnest(public.projexa_sync__org_kinds()) WITH ORDINALITY AS k(kind, n)
  WHERE public.projexa_sync__org_can_read(k.kind, v_ctx ->> 'live_role');

  RETURN jsonb_build_object(
    'status', 'ok',
    'user', jsonb_build_object('id', v_user, 'name', v_ctx ->> 'user_name', 'role', v_ctx ->> 'live_role', 'org_id', v_org),
    'projects', v_projects,
    'kinds', v_kinds,
    'view_class', public.projexa_sync__view_class(v_org, v_ctx ->> 'live_role'),
    'org_kinds', v_org_kinds,
    'org_view_class', public.projexa_sync__org_view_class(v_org, v_ctx ->> 'live_role'),
    'epoch', (SELECT e.epoch FROM platform.projexa_sync_epoch e));
END
$function$;

REVOKE ALL ON FUNCTION public.projexa_sync_manifest(text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.projexa_sync_manifest(text, text) TO service_role;
