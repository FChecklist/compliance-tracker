-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session: "complete this 100%" -- the user's laptop syncs TWO ways with the backend, so what a person edits on their laptop is pushed to Supabase without Vercel. This migration is the SQL half of that push: the idempotency ledger and the decisions made BEFORE a write runs.
-- PROJEXA LOCAL-FIRST SYNC, PUSH SIDE (feat/lf-sync-backend). Revised in place 2026-10-02 (package lf-d2-push-sql-fixes, review findings D2) BEFORE it was ever applied to a live database.
--
-- WHAT
--   platform.projexa_sync_op                  the push LEDGER, one row per (person, op_id): what was asked, its status (running / applied / rejected / failed / uncertain / needs_server), the closed result, the record it touched,
--                                             the record version before the edit was made (base_version) and after it was applied (applied_version), and how many times it was handed to the pipeline (attempts).
--                                             RLS forced, no grants: only the functions below.
--   platform.projexa_sync__op_claim(...)      the ATOMIC claim of a ledger row (internal, no grants): INSERT ... ON CONFLICT DO NOTHING for a new op, or a status-guarded UPDATE for a re-run. It answers true only to the one call
--                                             that actually created or re-claimed the row, so two concurrent first deliveries can never both be told to run.
--   public.projexa_sync_push_begin(sub, email, device, op)   decides, in SQL, whether an op may RUN: the person resolves; the function is a REGISTERED WRITE on the AI work link registry
--                                             (platform.ai_work_link_functions, kind write, on a link level) and the person's LIVE role rank is at least its min_role_rank; the project binds for that person NOW
--                                             (ai_work_link__bind: same organisation, readable); an EDIT carries the record it edits; the op id was not already used for different content; the record's HEAD version
--                                             IN THE BOUND PROJECT has not moved past the version the laptop edited (else CONFLICT, nothing written). It answers one of: run | duplicate | conflict | reject | retry.
--                                             It writes the ledger row 'running'.
--   public.projexa_sync_push_finish(user, op, status, result, error_code, kind, id)   stores the outcome (only from 'running' or 'uncertain') and reads the record's new version from projexa_record_head (0679), in the op's project.
--
-- THE WRITE ITSELF IS NOT HERE. It runs in the ai-work-link-exec Edge function through the REAL pipeline (link-exec-entry runSyncOp -> runDirectTask -> the executors): the same role gates, project pin, validation, cost
-- visibility and money rules as every other write, as the person, with their live role. A laptop only PROPOSES; it never supplies a computed money or approval figure the server would accept as such.
--
-- EXACTLY ONCE. The same (person, op_id) with the same content never has two effects:
--   * begin takes pg_advisory_xact_lock on (person, op_id) before it reads the ledger, so two concurrent begins of one op are serialised: the second waits, then sees 'running' and answers retry IN_PROGRESS.
--   * the ledger row itself is claimed atomically (projexa_sync__op_claim): a new op by INSERT ... ON CONFLICT DO NOTHING, a re-run by UPDATE ... WHERE status = <the status that allows a re-run>. A call that did not
--     create or re-claim the row is never told to run (belt and braces under the lock; the only guard if the lock is ever removed).
--   * applied/rejected ops answer `duplicate` with the stored result; `failed` and `needs_server` mean NOTHING was written and may be re-run (each re-run counts toward the hour's cap, see LIMITS).
--   * push_finish moves a row only from 'running' or 'uncertain'. A late or duplicate finish NEVER turns 'applied' into 'failed' (that would make the op re-runnable: a second effect); it answers the stored state
--     with `ignored: true` instead of raising.
--   * the same op_id with other content is refused OP_ID_REUSED.
--
-- UNCERTAIN IS NOT A DEAD END. An op is `uncertain` when the write may or may not have happened (the exec call was lost, or a `running` row is older than 10 minutes). Once it has SETTLED (2 minutes after it became
-- uncertain: past the exec timeout and the statement timeout, so nothing still in flight can commit), the next resend resolves it with no human:
--   * an EDIT (function update_* / set_* / delete_*) that carries record.base_version: the record's head version decides, because an applied edit always moves it. head = base: the write never happened, the op RUNS
--     again (re-claimed atomically). head > base: answer `conflict` with `uncertain_prior: true` and the server's current row, so the laptop sees whether its change is in (drop the op) or resends on the new base.
--   * anything else (a CREATE, or an action whose effect is not the record's version): there is no effect the server can look up safely, so it is resolved ONCE, terminally: the ledger row becomes 'rejected'
--     UNCERTAIN_CHECK_SERVER and the laptop is told so (status rejected). The person sees the record on their next pull if it was saved, and re-enters it if it was not. Never a blind re-run (a duplicate create).
--   * a finish that arrives late for an uncertain row resolves it with the real outcome.
--   Before it settles an uncertain op answers retry EXECUTION_UNCERTAIN, as before.
--
-- THE CONFLICT RULE. An edit (update_* / set_* / delete_*) MUST carry `record` {kind, id, base_version}; without it the op is refused RECORD_REQUIRED (it is never written last-writer-wins by accident). Other writes
-- (create_*, record_*, add_*, submit_*, approve_* ...) make new rows or move a state machine the executor guards itself; a `record` on them is optional. The head lookup is bound to the op's project: a record of
-- another project (a private one the person cannot read included) reads as version 0, exactly like a made-up id -- never `conflict`, never its version, never a distinct error (that would be an existence oracle).
-- Two ops on the same record in the same project are serialised by an advisory lock on (org, kind, id), and while one is 'running' (under 60 s) another op on that record answers retry RECORD_BUSY.
-- KNOWN WINDOW (documented, not closed here): an edit made through the WEB APP between begin and the executor's commit is not seen by begin; the executor would have to re-check base_version inside its own
-- transaction. begin's `run` answer carries `record` {kind, id, base_version} for that, and finish reports `overwrote_concurrent: true` when the applied version is more than base_version + 1.
--
-- LIMITS. 600 pipeline runs per person per hour, re-runs of failed / needs_server / uncertain ops included (sum of attempts of the hour's rows; retry RATE_LIMITED), 5 create_project per person per day counting
-- running, applied and uncertain ones (reject CAP_DAY), the op at most 64 KB.
--
-- ERRORS: none raised for a normal refusal; every refusal is a coded `action` so one op never fails the whole batch. A person who does not resolve gets {"status": <reason>} and nothing is written. push_finish raises
-- AW400 BAD_STATUS for an unknown status and AW404 NOT_FOUND for an unknown op.
-- GRANTS: SECURITY DEFINER, search_path = pg_catalog, pg_temp, timezone UTC; revoked from public, anon, authenticated, app_runtime; granted to service_role alone. The table and projexa_sync__op_claim are revoked
-- from every role including service_role.
-- DATA LOSS: none. One new table, one internal and two public functions; nothing existing is altered. Applying it twice changes nothing (IF NOT EXISTS / CREATE OR REPLACE).
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
  attempts integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  PRIMARY KEY (user_id, op_id),
  CONSTRAINT projexa_sync_op_status_check CHECK (status IN ('running', 'applied', 'rejected', 'failed', 'uncertain', 'needs_server')),
  CONSTRAINT projexa_sync_op_ids_check CHECK (op_id ~ '^[A-Za-z0-9_-]{8,128}$' AND device_id ~ '^[A-Za-z0-9_-]{8,64}$')
);
ALTER TABLE platform.projexa_sync_op ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS projexa_sync_op_user_created_idx ON platform.projexa_sync_op (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS projexa_sync_op_org_created_idx ON platform.projexa_sync_op (org_id, created_at DESC);
-- the per-record reservation (RECORD_BUSY) reads only running rows
CREATE INDEX IF NOT EXISTS projexa_sync_op_record_running_idx ON platform.projexa_sync_op (org_id, record_kind, record_id) WHERE status = 'running';
ALTER TABLE platform.projexa_sync_op ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.projexa_sync_op FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.projexa_sync_op FROM PUBLIC, anon, authenticated, app_runtime, service_role;

-- The atomic claim. p_from NULL: a NEW op, created only if no row exists (INSERT ... ON CONFLICT DO NOTHING). p_from 'failed' / 'needs_server' / 'uncertain': a RE-RUN, taken only if the row is STILL in that status
-- with the same content (UPDATE ... WHERE status = p_from). true only for the one call that created or re-claimed the row.
CREATE OR REPLACE FUNCTION platform.projexa_sync__op_claim(
  p_user text, p_op_id text, p_org text, p_device text, p_fn text, p_project text, p_hash text, p_kind text, p_rid text, p_base bigint, p_from text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF p_from IS NULL THEN
    INSERT INTO platform.projexa_sync_op (user_id, op_id, org_id, device_id, function_id, project_id, params_hash, status, record_kind, record_id, base_version)
    VALUES (p_user, p_op_id, p_org, p_device, p_fn, p_project, p_hash, 'running', p_kind, p_rid, p_base)
    ON CONFLICT (user_id, op_id) DO NOTHING;
  ELSIF p_from IN ('failed', 'needs_server', 'uncertain') THEN
    UPDATE platform.projexa_sync_op
       SET status = 'running', error_code = NULL, result = NULL, applied_version = NULL, created_at = clock_timestamp(), finished_at = NULL, device_id = p_device, base_version = p_base,
           attempts = attempts + 1
     WHERE user_id = p_user AND op_id = p_op_id AND status = p_from AND params_hash = p_hash;
  ELSE
    RETURN false;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END
$fn$;

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
  v_from text;
  v_rank integer;
  v_edit boolean;
  v_uncertain boolean := false;
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
       OR jsonb_typeof(v_rec -> 'base_version') IS DISTINCT FROM 'number' OR (v_rec ->> 'base_version') !~ '^[0-9]{1,15}$' THEN
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

  -- 4. an EDIT names the record it edits, or the conflict rule could be skipped by leaving it out
  v_edit := v_fn ~ '^(update|set|delete)_';
  IF v_edit AND v_kind IS NULL THEN
    RETURN jsonb_build_object('status', 'ok', 'action', 'reject', 'code', 'RECORD_REQUIRED');
  END IF;

  v_hash := encode(sha256(convert_to(v_fn || '|' || coalesce(v_project, '') || '|' || v_params::text || '|' || coalesce(v_kind, '') || '|' || coalesce(v_rid, ''), 'UTF8')), 'hex');

  -- 5. the ledger: the same op never has two effects. The lock serialises every begin of this (person, op) until this transaction ends.
  PERFORM pg_advisory_xact_lock(hashtextextended('projexa_sync_op:' || v_user || ':' || v_op_id, 0));
  SELECT * INTO v_old FROM platform.projexa_sync_op o WHERE o.user_id = v_user AND o.op_id = v_op_id FOR UPDATE;
  IF FOUND THEN
    IF v_old.params_hash <> v_hash THEN
      RETURN jsonb_build_object('status', 'ok', 'action', 'reject', 'code', 'OP_ID_REUSED');
    END IF;
    IF v_old.status IN ('applied', 'rejected') THEN
      RETURN jsonb_build_object('status', 'ok', 'action', 'duplicate', 'stored_status', v_old.status, 'result', coalesce(v_old.result, '{}'::jsonb), 'error_code', v_old.error_code,
                                'record_kind', v_old.record_kind, 'record_id', v_old.record_id, 'version', v_old.applied_version);
    END IF;
    IF v_old.status = 'running' THEN
      IF v_old.created_at >= clock_timestamp() - interval '10 minutes' THEN
        RETURN jsonb_build_object('status', 'ok', 'action', 'retry', 'code', 'IN_PROGRESS');
      END IF;
      -- ten minutes without a finish: the answer was lost. It has long settled (the exec times out after seconds), so it is resolved below like any settled uncertain op.
      -- finished_at is back-dated past the settle time: nothing started ten minutes ago can still commit
      UPDATE platform.projexa_sync_op SET status = 'uncertain', error_code = 'EXECUTION_UNCERTAIN', finished_at = clock_timestamp() - interval '2 minutes'
       WHERE user_id = v_user AND op_id = v_op_id AND status = 'running';
      v_old.status := 'uncertain';
      v_old.finished_at := clock_timestamp() - interval '2 minutes';
    END IF;
    IF v_old.status = 'uncertain' THEN
      IF coalesce(v_old.finished_at, v_old.created_at) > clock_timestamp() - interval '2 minutes' THEN
        RETURN jsonb_build_object('status', 'ok', 'action', 'retry', 'code', 'EXECUTION_UNCERTAIN');
      END IF;
      IF NOT v_edit OR v_base IS NULL THEN
        -- no effect the server can look up safely (a create): resolved once, terminally; never a blind re-run
        UPDATE platform.projexa_sync_op SET status = 'rejected', error_code = 'UNCERTAIN_CHECK_SERVER', finished_at = clock_timestamp()
         WHERE user_id = v_user AND op_id = v_op_id AND status = 'uncertain';
        RETURN jsonb_build_object('status', 'ok', 'action', 'reject', 'code', 'UNCERTAIN_CHECK_SERVER');
      END IF;
      v_uncertain := true; -- an edit with a base version: the version check below decides (head = base: it never happened, run; head > base: conflict)
    END IF;
    v_from := v_old.status; -- failed / needs_server / uncertain: may run again, re-claimed atomically below
  END IF;

  -- 6. limits: every pipeline run counts, re-runs included
  IF (SELECT coalesce(sum(o.attempts), 0) FROM platform.projexa_sync_op o WHERE o.user_id = v_user AND o.created_at > clock_timestamp() - interval '1 hour') >= 600 THEN
    RETURN jsonb_build_object('status', 'ok', 'action', 'retry', 'code', 'RATE_LIMITED');
  END IF;
  IF v_fn = 'create_project'
     AND (SELECT count(*) FROM platform.projexa_sync_op o WHERE o.user_id = v_user AND o.function_id = 'create_project' AND o.status IN ('running', 'applied', 'uncertain')
            AND o.created_at > clock_timestamp() - interval '1 day' AND o.op_id <> v_op_id) >= 5 THEN
    RETURN jsonb_build_object('status', 'ok', 'action', 'reject', 'code', 'CAP_DAY');
  END IF;

  -- 7. the record moved since the laptop edited it: CONFLICT, nothing is written. Only a record IN THE BOUND PROJECT is seen at all; any other reads as version 0, like a made-up id.
  IF v_kind IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('projexa_rec:' || v_org || ':' || v_kind || ':' || v_rid, 0));
    SELECT coalesce((SELECT h.version FROM platform.projexa_record_head h
                      WHERE h.org_id = v_org AND h.kind = v_kind AND h.record_id = v_rid AND h.project_id = v_project), 0) INTO v_cur;
    IF v_cur > v_base THEN
      RETURN jsonb_build_object('status', 'ok', 'action', 'conflict', 'kind', v_kind, 'id', v_rid, 'server_version', v_cur, 'base_version', v_base, 'uncertain_prior', v_uncertain);
    END IF;
    IF v_cur > 0 AND EXISTS (SELECT 1 FROM platform.projexa_sync_op o
                              WHERE o.org_id = v_org AND o.record_kind = v_kind AND o.record_id = v_rid AND o.status = 'running'
                                AND o.project_id IS NOT DISTINCT FROM v_project AND o.created_at > clock_timestamp() - interval '60 seconds'
                                AND NOT (o.user_id = v_user AND o.op_id = v_op_id)) THEN
      RETURN jsonb_build_object('status', 'ok', 'action', 'retry', 'code', 'RECORD_BUSY');
    END IF;
  END IF;

  -- 8. the claim: only the call that created or re-claimed the row runs
  IF NOT platform.projexa_sync__op_claim(v_user, v_op_id, v_org, p_device_id, v_fn, v_project, v_hash, v_kind, v_rid, v_base, v_from) THEN
    SELECT * INTO v_old FROM platform.projexa_sync_op o WHERE o.user_id = v_user AND o.op_id = v_op_id;
    IF FOUND AND v_old.status IN ('applied', 'rejected') THEN
      RETURN jsonb_build_object('status', 'ok', 'action', 'duplicate', 'stored_status', v_old.status, 'result', coalesce(v_old.result, '{}'::jsonb), 'error_code', v_old.error_code,
                                'record_kind', v_old.record_kind, 'record_id', v_old.record_id, 'version', v_old.applied_version);
    END IF;
    RETURN jsonb_build_object('status', 'ok', 'action', 'retry', 'code', 'IN_PROGRESS');
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'action', 'run', 'op_id', v_op_id, 'function_id', v_fn,
    'ctx', jsonb_build_object('org_id', v_org, 'user_id', v_user, 'project_id', v_project, 'live_role', v_ctx ->> 'live_role', 'live_rank', v_rank, 'device_id', p_device_id),
    'record', CASE WHEN v_kind IS NULL THEN NULL ELSE jsonb_build_object('kind', v_kind, 'id', v_rid, 'base_version', v_base) END,
    'rerun_of', v_from);
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
  -- a closed op stays closed: a late or duplicate finish never turns 'applied' into anything re-runnable
  IF v_row.status NOT IN ('running', 'uncertain') THEN
    RETURN jsonb_build_object('status', v_row.status, 'version', v_row.applied_version, 'record_kind', v_row.record_kind, 'record_id', v_row.record_id, 'ignored', true, 'overwrote_concurrent', false);
  END IF;
  v_kind := coalesce(p_record_kind, v_row.record_kind);
  v_rid := coalesce(p_record_id, v_row.record_id);
  IF p_status = 'applied' AND v_kind IS NOT NULL AND v_rid IS NOT NULL THEN
    -- the op's own project (create_project: the project it made, whose head names itself)
    SELECT h.version INTO v_ver FROM platform.projexa_record_head h
     WHERE h.org_id = v_row.org_id AND h.kind = v_kind AND h.record_id = v_rid AND h.project_id = coalesce(v_row.project_id, v_rid);
  END IF;
  UPDATE platform.projexa_sync_op
     SET status = p_status, result = p_result, error_code = left(p_error_code, 64), record_kind = v_kind, record_id = v_rid, applied_version = v_ver, finished_at = clock_timestamp()
   WHERE user_id = p_user_id AND op_id = p_op_id;
  RETURN jsonb_build_object('status', p_status, 'version', v_ver, 'record_kind', v_kind, 'record_id', v_rid, 'ignored', false,
                            'overwrote_concurrent', coalesce(v_ver > v_row.base_version + 1, false));
END
$fn$;

REVOKE ALL ON FUNCTION platform.projexa_sync__op_claim(text, text, text, text, text, text, text, text, text, bigint, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync_push_begin(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_push_finish(text, text, text, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION platform.projexa_sync__op_claim(text, text, text, text, text, text, text, text, text, bigint, text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_push_begin(text, text, text, jsonb) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_push_finish(text, text, text, jsonb, text, text, text) FROM app_runtime';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.projexa_sync_push_begin(text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_push_finish(text, text, text, jsonb, text, text, text) TO service_role;

COMMIT;
