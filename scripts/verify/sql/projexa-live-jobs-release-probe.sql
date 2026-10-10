-- LIVE probe of leased work jobs (0682), the release registry (0680) and the signing keys (0678) on real people. One statement, ends in a deliberate
-- exception carrying the results, so every row it wrote is rolled back. Read by scripts/verify/projexa-sync-live-write-check.ts.
DO $p$
DECLARE
  A constant text := '4ecc472f-4152-4310-ae8d-cf8b7c52ab6d';
  B constant text := '1850e900-6b54-4108-b01c-cc42c00f3eb9';
  s_adm text; s_mem text; s_b text; v_proj text; v_job text; v_lease text; r jsonb := '{}'::jsonb; x jsonb;
BEGIN
  SELECT auth_user_id::text INTO s_adm FROM compliance.users WHERE org_id = A AND role = 'admin'  AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT auth_user_id::text INTO s_mem FROM compliance.users WHERE org_id = A AND role = 'member' AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT auth_user_id::text INTO s_b   FROM compliance.users WHERE org_id = B AND role = 'admin'  AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT id INTO v_proj FROM compliance.projects WHERE org_id = A ORDER BY id LIMIT 1;

  -- the job: queued by the member, leased by one laptop, finished, read back; nobody else may see or lease it
  x := public.projexa_job_enqueue(s_mem, NULL, v_proj, 'csv_export', jsonb_build_object('kind', 'tasks'), 'requester');
  r := r || jsonb_build_object('enqueue', x);
  v_job := x ->> 'job_id';
  -- `-> 'job'` is a JSON null (not SQL NULL) when nothing was leased, so the test is on the JSON type
  r := r || jsonb_build_object('other_person_claim', jsonb_typeof(public.projexa_job_claim(s_adm, NULL, 'live-laptop-admin', ARRAY['csv_export'], 60) -> 'job') = 'object');
  BEGIN
    r := r || jsonb_build_object('other_org_get', public.projexa_job_get(s_b, NULL, v_job));
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('other_org_get', SQLERRM);
  END;
  x := public.projexa_job_claim(s_mem, NULL, 'live-laptop-0001', ARRAY['csv_export'], 60);
  r := r || jsonb_build_object('claim', x);
  v_lease := x -> 'job' ->> 'lease_id';
  r := r || jsonb_build_object('heartbeat', public.projexa_job_heartbeat(s_mem, NULL, v_job, v_lease));
  BEGIN
    r := r || jsonb_build_object('wrong_lease_result', public.projexa_job_result(s_mem, NULL, v_job, 'not-the-lease', true, '{}'::jsonb, NULL));
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('wrong_lease_result', SQLERRM);
  END;
  r := r || jsonb_build_object('result', public.projexa_job_result(s_mem, NULL, v_job, v_lease, true, jsonb_build_object('rows', 0), NULL));
  r := r || jsonb_build_object('get_done', public.projexa_job_get(s_mem, NULL, v_job));
  BEGIN
    PERFORM public.projexa_job_enqueue(s_mem, NULL, v_proj, 'csv_export', jsonb_build_object('kind', 'not_a_kind'), 'requester');
    r := r || jsonb_build_object('bad_kind', 'ACCEPTED');
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('bad_kind', SQLERRM);
  END;
  BEGIN
    PERFORM public.projexa_job_enqueue(s_b, NULL, v_proj, 'csv_export', jsonb_build_object('kind', 'tasks'), 'requester');
    r := r || jsonb_build_object('foreign_project_job', 'ACCEPTED');
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('foreign_project_job', SQLERRM);
  END;

  -- the release registry and the keys
  r := r || jsonb_build_object('release_current', public.projexa_release_current());
  r := r || jsonb_build_object('public_keys', jsonb_array_length(coalesce(to_jsonb(public.projexa_sync_public_keys()), '[]'::jsonb)));
  r := r || jsonb_build_object('tracking_health', platform.projexa_tracking_health());
  RAISE EXCEPTION 'PROBE_RESULT %', r::text;
END
$p$;
