-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session: "Complete the PROJEXA local-first system ... Vercel and external servers are used ~zero so the bill is zero or inside the free plan; the user never has to think. Priority: cost near zero FIRST, ease of work SECOND, security THIRD." This migration hardens the version / change-feed machinery of 0679-0684 after an independent review (cloud package lf-d3-versions-sql-fixes): one cheap poll for every head, a digest so the delete reconcile rarely lists ids, a health check that proves tracking works, and RETENTION so the append-only tables cannot fill a free-tier database.
-- PROJEXA SYNC HARDENING (claude/lf-d3-versions-sql-fixes).
--
-- ORDER: the last link of the 0678 .. 0686 chain (see 0679's header): apply after 0684 (and after 0680-0682, whose tables the prune functions trim when they exist);
-- roll back FIRST (its down file has no prerequisites).
--
-- WHAT
--   public.projexa_sync_heads(sub, email)        ONE call that answers "did anything I can see change?": {heads: {<project>: head, ..., "__org__": head}, projects_etag,
--                                                 role, view_class, org_view_class, epoch}. One index probe per readable project (and one for the organisation feed,
--                                                 only the organisation kinds the role may read), the same xid heads as /changes. A laptop polls THIS (one
--                                                 invocation) and calls /changes only for a head that moved, /manifest only when projects_etag changed, and resets
--                                                 its copy when view_class / org_view_class / epoch changed (role or cost-visibility change, rollback).
--   public.projexa_sync_ids_digest(sub, email, project, kinds[])
--                                                the delete-reconcile digest: per kind {count, xor} where xor is the bitwise XOR of the first 8 bytes of
--                                                SHA-256(id) over every id the person may read (16 hex digits, '0000000000000000' for none), plus head_seq and
--                                                epoch. A laptop computes the same over its local ids and lists ids (/ids) only for a kind whose digest differs.
--                                                project '__org__' digests the organisation kinds (only those the role may read; another is the one AW404).
--   platform.projexa_tracking_health()           proves tracking works, for the deploy runbook: for every synced kind whose table exists, its three triggers
--                                                exist, are enabled and carry that kind, and the project / content expressions the trigger builds still compile
--                                                against the live columns; a PROBE writes through the real trigger function into the real head and log tables
--                                                (as their real owner) on a temporary table and rolls itself back; tracking errors counted in the last 24 hours.
--                                                Answers {ok, kinds:[...], probe:{ok, error}, errors:[...], missing_tables:[...]}; ok is false on any defect.
--   platform.projexa_prune_change_log(keep, max)  deletes change-log rows older than `keep` (default 90 days), oldest first, at most `max` (100,000) per call, and
--                                                raises each (organisation, project)'s FLOOR to the newest pruned transaction: a laptop whose cursor is below its
--                                                floor is told reset_required (a full resync) instead of silently missing a tombstone.
--   platform.projexa_prune_record_heads(keep, max) deletes TOMBSTONE heads (deleted records) older than `keep` (90 days). Live records keep their head.
--   platform.projexa_prune_sync_tables()         the bounded tables of 0680-0682 (each only if the table exists): finished work-job results nulled after
--                                                24 hours and the jobs deleted after 7 days;
--                                                ledger ops applied / rejected / failed after 90 days, uncertain / needs_server / running after 180 days (a laptop
--                                                retries within hours; an op older than that is re-run as new, as documented); install reports after 365 days
--                                                (the newest per device is kept). projexa_release_file is NOT pruned (old releases must stay servable).
--   platform.projexa_sync_prune()                runs all of the above with their defaults, each step isolated (one failing step does not stop the others),
--                                                and answers the counts. Wire it to the owner's EXISTING daily job (see below); this migration schedules nothing.
--
-- RETENTION, AND HOW TO RUN IT (no cron is created here): once a day, from the existing daily mechanism (the pg_cron job list of the Supabase project, or the
-- daily GitHub workflow that already calls SQL), run `select platform.projexa_sync_prune();` as the database owner. Cost on the free tier: one statement a day that
-- deletes about one day's worth of old rows (a few thousand); no Edge invocation, no egress. Without it the change log grows about 450 bytes per change (an
-- estimate from the review: 50 people x 200 changes a day is about 4.5 MB/day) and job results up to 256 KB each, so the 500 MB free database would fill in months.
--
-- ERRORS (coded, same as 0677): AW404 NOT_FOUND; AW400 BAD_LIMIT. A person who does not resolve gets {"status": <reason>} and no data.
-- GRANTS: SECURITY DEFINER, search_path = pg_catalog, pg_temp, timezone UTC; every function revoked from public, anon, authenticated, app_runtime;
-- projexa_sync_heads and projexa_sync_ids_digest are granted to service_role alone (the Edge function); the health and prune functions to nobody (the owner runs them).
-- DATA LOSS: none by applying it (functions only). Running the prune functions deletes OLD history by design (the documented retention above).
-- ROLLBACK: drizzle/down/0686_projexa_sync_hardening.down.sql (drops the functions).

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. every head in one call -------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync_heads(p_sub text, p_email text)
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
  v_role text;
  v_horizon xid8;
  v_kinds text[];
  v_org_kinds text[];
  v_heads jsonb;
  v_etag text;
  v_org_head bigint;
BEGIN
  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  v_ctx := public.projexa_sync__ctx(v_user, v_org);
  IF v_ctx IS NULL THEN
    RETURN jsonb_build_object('status', 'not_linked');
  END IF;
  v_role := v_ctx ->> 'live_role';
  v_horizon := public.projexa_sync__horizon();
  v_kinds := public.projexa_sync__kinds();
  v_org_kinds := ARRAY(SELECT k FROM unnest(public.projexa_sync__org_kinds()) AS k WHERE public.projexa_sync__org_can_read(k, v_role));

  -- the projects this person may read NOW (the manifest's own rule), each with its head: one backward index probe per project
  SELECT coalesce(jsonb_object_agg(pr.id, coalesce(h.x, 0)), '{}'::jsonb),
         md5(coalesce(string_agg(pr.id || '|' || coalesce(pr.name, '') || '|' || coalesce(pr.status::text, ''), ',' ORDER BY pr.id), ''))
    INTO v_heads, v_etag
  FROM compliance.projects pr
  LEFT JOIN LATERAL (SELECT c.xid::text::bigint AS x FROM platform.projexa_change_log c
                     WHERE c.org_id = v_org AND c.project_id = pr.id AND c.xid < v_horizon AND c.kind = ANY (v_kinds)
                     ORDER BY c.xid DESC, c.seq DESC LIMIT 1) h ON true
  WHERE pr.org_id = v_org AND public.ai_work_link__can_read_project(pr.access_level::text, pr.lead_user_id, v_user, v_role);

  SELECT c.xid::text::bigint INTO v_org_head FROM platform.projexa_change_log c
  WHERE c.org_id = v_org AND c.project_id = '__org__' AND c.xid < v_horizon AND c.kind = ANY (v_org_kinds)
  ORDER BY c.xid DESC, c.seq DESC LIMIT 1;

  RETURN jsonb_build_object(
    'status', 'ok',
    'heads', v_heads || jsonb_build_object('__org__', coalesce(v_org_head, 0)),
    'projects_etag', substr(v_etag, 1, 16),
    'role', v_role,
    'view_class', public.projexa_sync__view_class(v_org, v_role),
    'org_view_class', public.projexa_sync__org_view_class(v_org, v_role),
    'epoch', (SELECT e.epoch FROM platform.projexa_sync_epoch e));
END
$fn$;

-- 2. the delete-reconcile digest --------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync_ids_digest(p_sub text, p_email text, p_project_id text, p_kinds text[])
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
  v_org_feed boolean := p_project_id = '__org__';
  v_kind text;
  v_from text;
  v_scope text;
  v_n bigint;
  v_x bigint;
  v_out jsonb := '{}'::jsonb;
  v_feed jsonb;
BEGIN
  IF p_kinds IS NULL OR cardinality(p_kinds) < 1 OR cardinality(p_kinds) > 64 THEN
    RAISE EXCEPTION 'BAD_LIMIT' USING ERRCODE = 'AW400';
  END IF;
  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  v_ctx := public.projexa_sync__ctx(v_user, v_org);
  IF v_ctx IS NULL THEN
    RETURN jsonb_build_object('status', 'not_linked');
  END IF;
  IF NOT v_org_feed THEN
    v_bound := public.ai_work_link__bind(v_ctx, p_project_id);
    IF v_bound IS NULL THEN
      RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
    END IF;
  END IF;

  -- the head BEFORE the lists are read (the same rule as /ids)
  v_feed := public.projexa_sync__feed(v_org, p_project_id,
                                      CASE WHEN v_org_feed THEN public.projexa_sync__org_kinds() ELSE public.projexa_sync__kinds() END, NULL, 1);

  FOREACH v_kind IN ARRAY (SELECT array_agg(DISTINCT k ORDER BY k) FROM unnest(p_kinds) AS k) LOOP
    IF v_org_feed THEN
      SELECT s.rel || ' t', s.scope_sql INTO v_from, v_scope FROM public.projexa_sync__org_src(v_kind) s;
      IF NOT FOUND OR NOT public.projexa_sync__org_can_read(v_kind, v_ctx ->> 'live_role') THEN
        RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
      END IF;
      EXECUTE format('SELECT count(*), coalesce(bit_xor((''x'' || substr(encode(sha256(convert_to(t.id::text, ''UTF8'')), ''hex''), 1, 16))::bit(64)::bigint), 0) FROM %s WHERE %s',
                     v_from, v_scope) INTO v_n, v_x USING v_org;
    ELSE
      SELECT s.from_sql, s.scope_sql INTO v_from, v_scope FROM public.projexa_sync__src(v_kind) s;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
      END IF;
      EXECUTE format('SELECT count(*), coalesce(bit_xor((''x'' || substr(encode(sha256(convert_to(t.id::text, ''UTF8'')), ''hex''), 1, 16))::bit(64)::bigint), 0) FROM %s WHERE %s',
                     v_from, v_scope) INTO v_n, v_x USING p_project_id, v_org;
    END IF;
    v_out := v_out || jsonb_build_object(v_kind, jsonb_build_object('count', v_n, 'xor', lpad(to_hex(v_x), 16, '0')));
  END LOOP;

  RETURN jsonb_build_object('status', 'ok', 'digests', v_out, 'head_seq', v_feed -> 'head_seq', 'epoch', v_feed -> 'epoch');
END
$fn$;

-- 3. the health check -------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.projexa_tracking_health()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  r record;
  v_rel regclass;
  v_n integer;
  v_enabled boolean;
  v_args text[];
  v_cols text[];
  v_expr_ok boolean;
  v_expr_err text;
  v_kinds jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_ok boolean := true;
  v_probe_ok boolean := false;
  v_probe_err text;
  v_errors jsonb;
  v_fn oid := 'platform.projexa_track_change()'::regprocedure;
BEGIN
  FOR r IN
    SELECT k.kind, s.rel, false AS org FROM unnest(public.projexa_sync__kinds()) AS k(kind) CROSS JOIN LATERAL public.projexa_sync__src(k.kind) s
    UNION ALL
    SELECT k.kind, s.rel, true FROM unnest(public.projexa_sync__org_kinds()) AS k(kind) CROSS JOIN LATERAL public.projexa_sync__org_src(k.kind) s
  LOOP
    v_rel := to_regclass(r.rel);
    IF v_rel IS NULL THEN
      v_missing := v_missing || to_jsonb(r.rel);   -- a table missing in an environment is skipped by design, and reported
      CONTINUE;
    END IF;
    SELECT count(*), coalesce(bool_and(tg.tgenabled <> 'D'), false) INTO v_n, v_enabled FROM pg_trigger tg
    WHERE tg.tgrelid = v_rel AND tg.tgfoid = v_fn AND tg.tgname IN ('projexa_track_i', 'projexa_track_u', 'projexa_track_d')
      AND (string_to_array(encode(tg.tgargs, 'escape'), '\000'))[1] = r.kind;
    SELECT string_to_array(encode(tg.tgargs, 'escape'), '\000') INTO v_args FROM pg_trigger tg
    WHERE tg.tgrelid = v_rel AND tg.tgfoid = v_fn AND tg.tgname = 'projexa_track_i';
    -- the expressions the trigger builds must still compile against the live columns (a renamed project_id would otherwise make every write a WARNING)
    v_expr_ok := true;
    v_expr_err := NULL;
    BEGIN
      v_cols := CASE WHEN r.org THEN public.projexa_sync__org_cols(r.kind) END;
      EXECUTE format('SELECT %s, %s, %s FROM %s n LIMIT 0',
                     coalesce(platform.projexa_track__project_sql(coalesce(v_args[2], 'col'), nullif(v_args[3], ''), nullif(v_args[4], ''), 'n'), 'NULL'),
                     platform.projexa_track__json_sql(v_rel, v_cols, 'n'), platform.projexa_track__actor_sql(v_rel, 'n'), v_rel);
    EXCEPTION WHEN OTHERS THEN
      v_expr_ok := false;
      v_expr_err := left(SQLERRM, 200);
    END;
    IF v_n <> 3 OR NOT v_enabled OR NOT v_expr_ok THEN
      v_ok := false;
    END IF;
    v_kinds := v_kinds || jsonb_build_array(jsonb_build_object('kind', r.kind, 'table', r.rel, 'triggers', v_n, 'enabled', v_enabled, 'expr_ok', v_expr_ok, 'expr_error', v_expr_err));
  END LOOP;

  -- the probe: a temporary table with the real trigger function, written as the real owner into the real tables, then rolled back
  BEGIN
    CREATE TEMP TABLE projexa_health_probe (id text PRIMARY KEY, org_id text NOT NULL, project_id text, note text) ON COMMIT DROP;
    CREATE TRIGGER projexa_track_i AFTER INSERT ON projexa_health_probe REFERENCING NEW TABLE AS projexa_new FOR EACH STATEMENT
      EXECUTE FUNCTION platform.projexa_track_change('__probe__', 'col', 'project_id', '', '');
    CREATE TRIGGER projexa_track_u AFTER UPDATE ON projexa_health_probe REFERENCING OLD TABLE AS projexa_old NEW TABLE AS projexa_new FOR EACH STATEMENT
      EXECUTE FUNCTION platform.projexa_track_change('__probe__', 'col', 'project_id', '', '');
    CREATE TRIGGER projexa_track_d AFTER DELETE ON projexa_health_probe REFERENCING OLD TABLE AS projexa_old FOR EACH STATEMENT
      EXECUTE FUNCTION platform.projexa_track_change('__probe__', 'col', 'project_id', '', '');
    INSERT INTO projexa_health_probe VALUES ('probe-1', '__health__', '__health__', 'a');
    UPDATE projexa_health_probe SET note = 'b';
    DELETE FROM projexa_health_probe;
    v_probe_ok := (SELECT string_agg(c.op::text || c.version::text, ',' ORDER BY c.seq) FROM platform.projexa_change_log c
                   WHERE c.org_id = '__health__' AND c.kind = '__probe__' AND c.record_id = 'probe-1') = 'I1,U2,D3'
                  AND EXISTS (SELECT 1 FROM platform.projexa_record_head h WHERE h.org_id = '__health__' AND h.kind = '__probe__' AND h.record_id = 'probe-1' AND h.deleted AND h.version = 3);
    IF NOT v_probe_ok THEN
      v_probe_err := 'the probe write did not produce I1,U2,D3 in the change log (see platform.projexa_track_error and the server log WARNINGs)';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'PX999', MESSAGE = 'probe rollback';
  EXCEPTION
    WHEN SQLSTATE 'PX999' THEN
      NULL;
    WHEN OTHERS THEN
      v_probe_ok := false;
      v_probe_err := left(SQLERRM, 200);
  END;
  IF NOT v_probe_ok THEN
    v_ok := false;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'errors', e.errors, 'last_sqlstate', e.last_sqlstate, 'last_message', e.last_message, 'last_at', e.last_at) ORDER BY e.kind), '[]'::jsonb)
    INTO v_errors
  FROM platform.projexa_track_error e WHERE e.last_at > clock_timestamp() - interval '24 hours';
  IF jsonb_array_length(v_errors) > 0 THEN
    v_ok := false;
  END IF;

  RETURN jsonb_build_object('ok', v_ok, 'kinds', v_kinds, 'probe', jsonb_build_object('ok', v_probe_ok, 'error', v_probe_err), 'errors', v_errors, 'missing_tables', v_missing);
END
$fn$;

-- 4. retention ----------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.projexa_prune_change_log(p_keep interval DEFAULT interval '90 days', p_max integer DEFAULT 100000)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_n bigint;
BEGIN
  IF p_keep IS NULL OR p_keep < interval '1 day' OR p_max IS NULL OR p_max < 1 THEN
    RAISE EXCEPTION 'BAD_RETENTION' USING ERRCODE = 'AW400';
  END IF;
  WITH del AS (
    DELETE FROM platform.projexa_change_log c
    WHERE c.seq IN (SELECT c2.seq FROM platform.projexa_change_log c2 WHERE c2.at < clock_timestamp() - p_keep ORDER BY c2.seq LIMIT p_max)
    RETURNING c.org_id, c.project_id, c.xid
  ), fl AS (
    INSERT INTO platform.projexa_change_floor AS f (org_id, project_id, floor_xid, updated_at)
    SELECT d.org_id, d.project_id, (array_agg(d.xid ORDER BY d.xid DESC))[1], clock_timestamp() FROM del d GROUP BY d.org_id, d.project_id
    ON CONFLICT (org_id, project_id) DO UPDATE SET floor_xid = greatest(f.floor_xid, EXCLUDED.floor_xid), updated_at = EXCLUDED.updated_at
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM del;
  RETURN v_n;
END
$fn$;

CREATE OR REPLACE FUNCTION platform.projexa_prune_record_heads(p_keep interval DEFAULT interval '90 days', p_max integer DEFAULT 100000)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_n bigint;
BEGIN
  IF p_keep IS NULL OR p_keep < interval '1 day' OR p_max IS NULL OR p_max < 1 THEN
    RAISE EXCEPTION 'BAD_RETENTION' USING ERRCODE = 'AW400';
  END IF;
  WITH del AS (
    DELETE FROM platform.projexa_record_head h
    WHERE (h.org_id, h.kind, h.record_id) IN (SELECT h2.org_id, h2.kind, h2.record_id FROM platform.projexa_record_head h2
                                               WHERE h2.deleted AND h2.updated_at < clock_timestamp() - p_keep LIMIT p_max)
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM del;
  RETURN v_n;
END
$fn$;

CREATE OR REPLACE FUNCTION platform.projexa_prune_sync_tables()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_n bigint;
BEGIN
  IF to_regclass('platform.projexa_work_job') IS NOT NULL THEN
    EXECUTE $q$UPDATE platform.projexa_work_job SET result = NULL, result_bytes = NULL
               WHERE status IN ('done', 'failed', 'cancelled') AND result IS NOT NULL AND coalesce(finished_at, created_at) < clock_timestamp() - interval '24 hours'$q$;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('work_job_results_cleared', v_n);
    EXECUTE $q$DELETE FROM platform.projexa_work_job
               WHERE status IN ('done', 'failed', 'cancelled') AND coalesce(finished_at, created_at) < clock_timestamp() - interval '7 days'$q$;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('work_jobs_deleted', v_n);
  END IF;

  IF to_regclass('platform.projexa_sync_op') IS NOT NULL THEN
    EXECUTE $q$DELETE FROM platform.projexa_sync_op
               WHERE (status IN ('applied', 'rejected', 'failed') AND coalesce(finished_at, created_at) < clock_timestamp() - interval '90 days')
                  OR (status NOT IN ('applied', 'rejected', 'failed') AND created_at < clock_timestamp() - interval '180 days')$q$;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('sync_ops_deleted', v_n);
  END IF;

  IF to_regclass('platform.projexa_client_install') IS NOT NULL THEN
    EXECUTE $q$DELETE FROM platform.projexa_client_install c
               WHERE c.recorded_at < clock_timestamp() - interval '365 days'
                 AND c.id <> (SELECT max(c2.id) FROM platform.projexa_client_install c2 WHERE c2.device_id = c.device_id)$q$;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('client_installs_deleted', v_n);
  END IF;
  RETURN v_out;
END
$fn$;

CREATE OR REPLACE FUNCTION platform.projexa_sync_prune()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_out jsonb := '{}'::jsonb;
BEGIN
  BEGIN
    v_out := v_out || jsonb_build_object('change_log_deleted', platform.projexa_prune_change_log());
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('change_log_error', left(SQLERRM, 200));
  END;
  BEGIN
    v_out := v_out || jsonb_build_object('tombstone_heads_deleted', platform.projexa_prune_record_heads());
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('record_heads_error', left(SQLERRM, 200));
  END;
  BEGIN
    v_out := v_out || platform.projexa_prune_sync_tables();
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('sync_tables_error', left(SQLERRM, 200));
  END;
  RETURN v_out;
END
$fn$;

-- 5. grants ---------------------------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.projexa_sync_heads(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_ids_digest(text, text, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION platform.projexa_tracking_health() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION platform.projexa_prune_change_log(interval, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION platform.projexa_prune_record_heads(interval, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION platform.projexa_prune_sync_tables() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION platform.projexa_sync_prune() FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_heads(text, text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_ids_digest(text, text, text, text[]) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION platform.projexa_tracking_health() FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION platform.projexa_prune_change_log(interval, integer) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION platform.projexa_prune_record_heads(interval, integer) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION platform.projexa_prune_sync_tables() FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION platform.projexa_sync_prune() FROM app_runtime';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.projexa_sync_heads(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_ids_digest(text, text, text, text[]) TO service_role;

COMMIT;
