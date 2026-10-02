-- LIVE probe of the push ledger (0681) on real people of real organisations. Runs as ONE statement and ends in a deliberate exception that carries
-- the results, so EVERYTHING it wrote (ledger rows) is rolled back. Read by scripts/verify/projexa-sync-live-write-check.ts.
DO $p$
DECLARE
  A constant text := '4ecc472f-4152-4310-ae8d-cf8b7c52ab6d';
  B constant text := '1850e900-6b54-4108-b01c-cc42c00f3eb9';
  s_mem text; s_cv text; s_b text; v_proj text; v_rec text; v_uid text; r jsonb := '{}'::jsonb; op jsonb; v_head bigint;
BEGIN
  SELECT auth_user_id::text INTO s_mem FROM compliance.users WHERE org_id = A AND role = 'member' AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT auth_user_id::text INTO s_cv  FROM compliance.users WHERE org_id = A AND role = 'client_viewer' AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT auth_user_id::text INTO s_b   FROM compliance.users WHERE org_id = B AND role = 'admin' AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  FOR v_proj IN SELECT id FROM compliance.projects WHERE org_id = A ORDER BY id LOOP
    v_rec := public.projexa_sync_pull(s_mem, NULL, v_proj, 'tasks', NULL, NULL, 1) -> 'items' -> 0 ->> 'id';
    EXIT WHEN v_rec IS NOT NULL;
  END LOOP;
  r := r || jsonb_build_object('have_record', v_rec IS NOT NULL, 'proj', v_proj, 'record', v_rec);
  v_head := coalesce((public.projexa_sync_pull(s_mem, NULL, v_proj, 'tasks', NULL, NULL, 1) -> 'items' -> 0 ->> 'version')::bigint, 0);
  op := jsonb_build_object('op_id', 'livecheck-op-0001', 'function_id', 'update_task', 'project_id', v_proj,
          'params', jsonb_build_object('taskId', v_rec, 'title', 'livecheck'), 'record', jsonb_build_object('kind', 'tasks', 'id', v_rec, 'base_version', v_head));
  r := r || jsonb_build_object('first',  public.projexa_sync_push_begin(s_mem, NULL, 'live-device-0001', op));
  r := r || jsonb_build_object('second', public.projexa_sync_push_begin(s_mem, NULL, 'live-device-0001', op));
  SELECT user_id INTO v_uid FROM public.projexa_read_resolve_user(s_mem, NULL);
  r := r || jsonb_build_object('finish', public.projexa_sync_push_finish(v_uid, 'livecheck-op-0001', 'applied', jsonb_build_object('id', v_rec), NULL, 'tasks', v_rec));
  r := r || jsonb_build_object('third',  public.projexa_sync_push_begin(s_mem, NULL, 'live-device-0001', op));
  BEGIN
    r := r || jsonb_build_object('viewer', public.projexa_sync_push_begin(s_cv, NULL, 'live-device-0002', jsonb_set(op, '{op_id}', '"livecheck-op-0002"')));
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('viewer_error', SQLERRM);
  END;
  BEGIN
    r := r || jsonb_build_object('other_org', public.projexa_sync_push_begin(s_b, NULL, 'live-device-0003', jsonb_set(op, '{op_id}', '"livecheck-op-0003"')));
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('other_org_error', SQLERRM);
  END;
  RAISE EXCEPTION 'PROBE_RESULT %', r::text;
END
$p$;
