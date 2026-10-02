-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session: "complete this 100%" -- the user's laptop syncs TWO ways with the backend, so what a person edits on their laptop is pushed to Supabase without Vercel. This migration is the SQL half of that push: the idempotency ledger and the decisions made BEFORE a write runs.
-- PROJEXA LOCAL-FIRST SYNC, PUSH SIDE (feat/lf-sync-backend).
--
-- WHAT
--   platform.projexa_sync_op                  the push LEDGER, one row per (person, op_id): what was asked, its status (running / applied / rejected / failed / uncertain / needs_server), the closed result, the record it touched,
--                                             the record version before the edit was made (base_version) and after it was applied (applied_version). RLS forced, no grants: only the functions below.
--   public.projexa_sync_push_begin(sub, email, device, op)   decides, in SQL, whether an op may RUN: the person resolves; the function is a REGISTERED WRITE on the AI work link registry
--                                             (platform.ai_work_link_functions, kind write, on a link level) and the person's LIVE role rank is at least its min_role_rank; the project binds for that person NOW
--                                             (ai_work_link__bind: same organisation, readable); the op id was not already used for different content; the record's HEAD version has not moved past the version the laptop edited
--                                             (else CONFLICT, nothing written). It answers one of: run | duplicate | conflict | reject | retry. It writes the ledger row 'running'.
--   public.projexa_sync_push_finish(user, op, status, result, error_code, kind, id)   stores the outcome and reads the record's new version from projexa_record_head (0679).
--
-- THE WRITE ITSELF IS NOT HERE. It runs in the ai-work-link-exec Edge function through the REAL pipeline (link-exec-entry runSyncOp -> runDirectTask -> the executors): the same role gates, project pin, validation, cost
-- visibility and money rules as every other write, as the person, with their live role. A laptop only PROPOSES; it never supplies a computed money or approval figure the server would accept as such.
--
-- IDEMPOTENCY. The same (person, op_id) with the same content never has two effects: applied/rejected ops answer `duplicate` with the stored result; a `running` op younger than 10 minutes answers retry IN_PROGRESS; older than 10 minutes it
-- is marked `uncertain` (the response may have been lost after the write) and answers retry EXECUTION_UNCERTAIN, never re-run blindly (the same rule as the AI link's intents). `failed` and `needs_server` mean NOTHING was written and may be re-run.
-- The same op_id with other content is refused OP_ID_REUSED.
--
-- LIMITS. 600 ops per person per hour (retry RATE_LIMITED), 5 create_project per person per day (reject CAP_DAY), params at most 64 KB.
--
-- ERRORS: none raised for a normal refusal; every refusal is a coded `action` so one op never fails the whole batch. A person who does not resolve gets {"status": <reason>} and nothing is written.
-- GRANTS: SECURITY DEFINER, search_path = pg_catalog, pg_temp, timezone UTC; revoked from public, anon, authenticated, app_runtime; granted to service_role alone. The table is revoked from every role including service_role.
-- DATA LOSS: none. One new table and two new functions; nothing existing is altered. Applying it twice changes nothing.
-- ROLLBACK: drizzle/down/0681_projexa_sync_push.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS platform.projexa_sync_op (
  user_id text NOT NULL,
  op_id text NOT NULL,
  org_id text NOT NULL,
  device_id text NOT NULL,
  function_id text NOT NULL,
  project_id text,
  params_hash text NOT NULL,
  status text NOT NULL,
  record_kind text,
  record_id text,
  base_version bigint,
  applied_version bigint,
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  PRIMARY KEY (user_id, op_id),
  CONSTRAINT projexa_sync_op_status_check CHECK (status IN ('running', 'applied', 'rejected', 'failed', 'uncertain', 'needs_server')),
  CONSTRAINT projexa_sync_op_ids_check CHECK (op_id ~ '^[A-Za-z0-9_-]{8,128}$' AND device_id ~ '^[A-Za-z0-9_-]{8,64}$')
);
CREATE INDEX IF NOT EXISTS projexa_sync_op_user_created_idx ON platform.projexa_sync_op (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS projexa_sync_op_org_created_idx ON platform.projexa_sync_op (org_id, created_at DESC);
ALTER TABLE platform.projexa_sync_op ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.projexa_sync_op FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.projexa_sync_op FROM PUBLIC, anon, authenticated, app_runtime, service_role;

CREATE OR REPLACE FUNCTION public.projexa_sync_push_begin(p_sub text, p_email text, p_device_id text, p_op jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_user text;
  v_org text;
  v_reason text;
  v_ctx jsonb;
  v_op_id text := p_op ->> 'op_id';
  v_fn text := p_op ->> 'function_id';
  v_project text := p_op ->> 'project_id';
  v_params jsonb := p_op -> 'params';
  v_rec jsonb := p_op -> 'record';
  v_kind text;
  v_rid text;
  v_base bigint;
  v_cur bigint;
  v_hash text;
  v_reg record;
  v_old record;
  v_had boolean;
  v_rank integer;
BEGIN
  IF p_device_id IS NULL OR p_device_id !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RETURN jsonb_build_object('status', 'ok', 'action', 'reject', 'code', 'BAD_OP');
  END IF;

  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  v_ctx := public.projexa_sync__ctx(v_user, v_org);
  IF v_ctx IS NULL THEN
    RETURN jsonb_build_object('status', 'not_linked');
  END IF;
  v_rank := (v_ctx ->> 'live_rank')::integer;

  -- 1. shape
  IF jsonb_typeof(p_op) IS DISTINCT FROM 'object' OR v_op_id IS NULL OR v_op_id !~ '^[A-Za-z0-9_-]{8,128}$'
     OR v_fn IS NULL OR v_fn !~ '^[A-Za-z0-9_-]{1,128}$'
     OR jsonb_typeof(v_params) IS DISTINCT FROM 'object' OR length(p_op::text) > 65536
     OR (v_fn <> 'create_project' AND (v_project IS NULL OR v_project = '' OR char_length(v_project) > 128))
     OR (v_fn = 'create_project' AND v_project IS NOT NULL) THEN
    RETURN jsonb_build_object('status', 'ok', 'action', 'reject', 'code', 'BAD_OP');
  END IF;
  IF v_rec IS NOT NULL AND v_rec <> 'null'::jsonb THEN
    v_kind := v_rec ->> 'kind';
    v_rid := v_rec ->> 'id';
    IF jsonb_typeof(v_rec) IS DISTINCT FROM 'object' OR v_kind IS NULL OR v_rid IS NULL OR v_rid !~ '^[A-Za-z0-9._:-]{1,64}$'
       OR v_kind <> ALL (public.projexa_sync__kinds())
       OR coalesce(v_rec ->> 'base_version', '') !~ '^[0-9]{1,15}$' THEN
      RETURN jsonb_build_object('status', 'ok', 'action', 'reject', 'code', 'BAD_OP');
    END IF;
    v_base := (v_rec ->> 'base_version')::bigint;
  END IF;

  -- 2. the function: a REGISTERED WRITE on a link level, and a role that may run it NOW
  SELECT f.kind, f.link_level, f.min_role_rank INTO v_reg FROM platform.ai_work_link_functions f WHERE f.function_id = v_fn;
  IF NOT FOUND OR v_reg.kind <> 'write' OR v_reg.link_level IS NULL THEN
    RETURN jsonb_build_object('status', 'ok', 'action', 'reject', 'code', 'FUNCTION_NOT_ALLOWED');
  END IF;
  IF v_rank < v_reg.min_role_rank THEN
    RETURN jsonb_build_object('status', 'ok', 'action', 'reject', 'code', 'ROLE_TOO_LOW');
  END IF;

  -- 3. the project binds for this person now (create_project has none: it makes one)
  IF v_fn <> 'create_project' AND public.ai_work_link__bind(v_ctx, v_project) IS NULL THEN
    RETURN jsonb_build_object('status', 'ok', 'action', 'reject', 'code', 'PROJECT_NOT_READABLE');
  END IF;

  v_hash := encode(sha256(convert_to(v_fn || '|' || coalesce(v_project, '') || '|' || v_params::text || '|' || coalesce(v_kind, '') || '|' || coalesce(v_rid, ''), 'UTF8')), 'hex');

  -- 4. the ledger: the same op never has two effects
  SELECT * INTO v_old FROM platform.projexa_sync_op o WHERE o.user_id = v_user AND o.op_id = v_op_id FOR UPDATE;
  v_had := FOUND;
  IF v_had THEN
    IF v_old.params_hash <> v_hash THEN
      RETURN jsonb_build_object('status', 'ok', 'action', 'reject', 'code', 'OP_ID_REUSED');
    END IF;
    IF v_old.status IN ('applied', 'rejected') THEN
      RETURN jsonb_build_object('status', 'ok', 'action', 'duplicate', 'stored_status', v_old.status, 'result', coalesce(v_old.result, '{}'::jsonb), 'error_code', v_old.error_code,
                                'record_kind', v_old.record_kind, 'record_id', v_old.record_id, 'version', v_old.applied_version);
    END IF;
    IF v_old.status = 'uncertain' THEN
      RETURN jsonb_build_object('status', 'ok', 'action', 'retry', 'code', 'EXECUTION_UNCERTAIN');
    END IF;
    IF v_old.status = 'running' THEN
      IF v_old.created_at < clock_timestamp() - interval '10 minutes' THEN
        UPDATE platform.projexa_sync_op SET status = 'uncertain', error_code = 'EXECUTION_UNCERTAIN', finished_at = clock_timestamp() WHERE user_id = v_user AND op_id = v_op_id;
        RETURN jsonb_build_object('status', 'ok', 'action', 'retry', 'code', 'EXECUTION_UNCERTAIN');
      END IF;
      RETURN jsonb_build_object('status', 'ok', 'action', 'retry', 'code', 'IN_PROGRESS');
    END IF;
    -- failed / needs_server: nothing was written, it may run again (falls through to the checks below)
  END IF;

  -- 5. limits
  IF NOT v_had AND (SELECT count(*) FROM platform.projexa_sync_op o WHERE o.user_id = v_user AND o.created_at > clock_timestamp() - interval '1 hour') >= 600 THEN
    RETURN jsonb_build_object('status', 'ok', 'action', 'retry', 'code', 'RATE_LIMITED');
  END IF;
  IF v_fn = 'create_project' AND NOT v_had
     AND (SELECT count(*) FROM platform.projexa_sync_op o WHERE o.user_id = v_user AND o.function_id = 'create_project' AND o.status IN ('running', 'applied') AND o.created_at > clock_timestamp() - interval '1 day') >= 5 THEN
    RETURN jsonb_build_object('status', 'ok', 'action', 'reject', 'code', 'CAP_DAY');
  END IF;

  -- 6. the record moved since the laptop edited it: CONFLICT, nothing is written
  IF v_kind IS NOT NULL THEN
    SELECT coalesce((SELECT h.version FROM platform.projexa_record_head h WHERE h.org_id = v_org AND h.kind = v_kind AND h.record_id = v_rid), 0) INTO v_cur;
    IF v_cur > v_base THEN
      RETURN jsonb_build_object('status', 'ok', 'action', 'conflict', 'kind', v_kind, 'id', v_rid, 'server_version', v_cur, 'base_version', v_base);
    END IF;
  END IF;

  INSERT INTO platform.projexa_sync_op (user_id, op_id, org_id, device_id, function_id, project_id, params_hash, status, record_kind, record_id, base_version)
  VALUES (v_user, v_op_id, v_org, p_device_id, v_fn, v_project, v_hash, 'running', v_kind, v_rid, v_base)
  ON CONFLICT (user_id, op_id) DO UPDATE SET status = 'running', error_code = NULL, result = NULL, created_at = clock_timestamp(), finished_at = NULL, device_id = EXCLUDED.device_id, base_version = EXCLUDED.base_version;

  RETURN jsonb_build_object('status', 'ok', 'action', 'run', 'op_id', v_op_id, 'function_id', v_fn,
    'ctx', jsonb_build_object('org_id', v_org, 'user_id', v_user, 'project_id', v_project, 'live_role', v_ctx ->> 'live_role', 'live_rank', v_rank, 'device_id', p_device_id));
END
$fn$;

CREATE OR REPLACE FUNCTION public.projexa_sync_push_finish(
  p_user_id text, p_op_id text, p_status text, p_result jsonb, p_error_code text, p_record_kind text, p_record_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_row record;
  v_ver bigint;
  v_kind text;
  v_rid text;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('applied', 'rejected', 'failed', 'uncertain', 'needs_server') THEN
    RAISE EXCEPTION 'BAD_STATUS' USING ERRCODE = 'AW400';
  END IF;
  SELECT * INTO v_row FROM platform.projexa_sync_op o WHERE o.user_id = p_user_id AND o.op_id = p_op_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  v_kind := coalesce(p_record_kind, v_row.record_kind);
  v_rid := coalesce(p_record_id, v_row.record_id);
  IF p_status = 'applied' AND v_kind IS NOT NULL AND v_rid IS NOT NULL THEN
    SELECT h.version INTO v_ver FROM platform.projexa_record_head h WHERE h.org_id = v_row.org_id AND h.kind = v_kind AND h.record_id = v_rid;
  END IF;
  UPDATE platform.projexa_sync_op
     SET status = p_status, result = p_result, error_code = left(p_error_code, 64), record_kind = v_kind, record_id = v_rid, applied_version = v_ver, finished_at = clock_timestamp()
   WHERE user_id = p_user_id AND op_id = p_op_id;
  RETURN jsonb_build_object('status', p_status, 'version', v_ver, 'record_kind', v_kind, 'record_id', v_rid);
END
$fn$;

REVOKE ALL ON FUNCTION public.projexa_sync_push_begin(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_push_finish(text, text, text, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_push_begin(text, text, text, jsonb) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_push_finish(text, text, text, jsonb, text, text, text) FROM app_runtime';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.projexa_sync_push_begin(text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_push_finish(text, text, text, jsonb, text, text, text) TO service_role;

COMMIT;
