-- PRE-APPROVED-LIVE-DDL: Owner delegated full PM authority and ordered the PROJEXA laptop chat built on the per-organisation internal-AI flag, in chat on 2026-10-08 (PM package P6/P9: laptop-chat flag gap); replaces public.projexa_sync_manifest with the same body plus one top-level boolean `internal_ai`.
-- PROJEXA SYNC MANIFEST: emit `internal_ai` (the laptop reads manifest.internal_ai in src/lib/local-first/sync-client.ts and ai-off/internal-ai.ts).
--
-- WHAT: CREATE OR REPLACE public.projexa_sync_manifest(text, text) with the LIVE body (read with pg_get_functiondef on 2026-10-08) plus
--   'internal_ai': true when compliance.org_product_branch_enablements has an is_enabled row for the person's organisation and the platform.product_branches
--   row whose branch_key = 'internal_ai' (migration 0692); false when there is no row, a disabled row or no registered branch.
--   Every existing field, the SECURITY DEFINER setting, search_path (pg_catalog, pg_temp), TimeZone UTC and the grants are exactly as live.
--   The "not linked" answers carry no internal_ai (the laptop treats a missing value as off).
--   The master deployment switch PROJEXA_INTERNAL_AI_ENABLED is a server setting this function cannot see; it stays the master off on the server.
-- GRANTS: re-stated exactly as live (postgres + service_role EXECUTE only).
-- DATA LOSS: none. Applying twice changes nothing.
-- ROLLBACK: drizzle/down/0739_projexa_sync_manifest_internal_ai.down.sql
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
  v_internal_ai boolean;
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

  -- the per-organisation internal-AI allow flag (migration 0692, set through /api/v1/projexa/internal-ai-allowance): an enabled row for the branch
  -- 'internal_ai' means true; no row, a disabled row or no registered branch means false (closed by default). The laptop reads this top-level boolean.
  SELECT coalesce(bool_or(e.is_enabled IS TRUE), false) INTO v_internal_ai
  FROM compliance.org_product_branch_enablements e
  JOIN platform.product_branches b ON b.id = e.product_branch_id
  WHERE e.org_id = v_org AND b.branch_key = 'internal_ai';

  RETURN jsonb_build_object(
    'status', 'ok',
    'user', jsonb_build_object('id', v_user, 'name', v_ctx ->> 'user_name', 'role', v_ctx ->> 'live_role', 'org_id', v_org),
    'projects', v_projects,
    'kinds', v_kinds,
    'view_class', public.projexa_sync__view_class(v_org, v_ctx ->> 'live_role'),
    'org_kinds', v_org_kinds,
    'org_view_class', public.projexa_sync__org_view_class(v_org, v_ctx ->> 'live_role'),
    'epoch', (SELECT e.epoch FROM platform.projexa_sync_epoch e),
    'internal_ai', v_internal_ai);
END
$function$;

REVOKE ALL ON FUNCTION public.projexa_sync_manifest(text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.projexa_sync_manifest(text, text) TO service_role;
