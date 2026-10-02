-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-01/02 in a live Claude Code session: heavy but safe work is handed to an ONLINE user's laptop and runs on that user's RAM and CPU, so the server does less ("the system knows who is online and hands work to an online user's browser, which runs it and returns the result"), and "complete this 100%". This migration is the queue and the lease of that work offload (WORK_ORDER_PROJEXA-LOCAL-FIRST section 2a, tests L-19..L-24).
-- PROJEXA WORK OFFLOAD (feat/lf-sync-backend). Revised in place 2026-10-02 (package lf-d2-push-sql-fixes, review findings D2) BEFORE it was ever applied to a live database.
--
-- THE SHAPE. A person's laptop enqueues a job {type, params} for a project. An online laptop CLAIMS it (a LEASE with an expiry), runs it in a Web Worker against ITS OWN local copy of the data, and returns the result. If the claimant vanishes
-- the lease expires and the job is offered again (up to 3 attempts). The server holds only the queue; no business data moves through it.
--
-- THE RULES (the owner's, enforced here, not by the browser):
--   1. WHO MAY RUN IT. By default only the REQUESTER's own devices. A colleague may claim only when the requester opted in (`visibility = 'project'`), the colleague is in the same organisation, may read the project NOW
--      (ai_work_link__can_read_project) AND has the same VIEW CLASS (drizzle/0678) as the one stored at enqueue -- which must ALSO still be the requester's CURRENT class (a requester demoted or promoted after enqueue
--      no longer has colleagues compute for them under the old class). Why the view class: the result is computed from the claimant's own local data; a colleague who sees money must never compute a result for a
--      requester who does not. Cross-organisation is impossible: every query is scoped on the person's organisation.
--   2. A RESULT IS A PROPOSAL. Only whitelisted, display-only types can be offloaded (boq_rollup, csv_export, report_preview, search_index). Nothing that feeds money, approvals, billing or permissions has a type, so none can
--      be offloaded; and the server never writes a business row from a result. If the requester wants to SAVE something derived, it goes through the push path (0681), where the server recomputes and validates.
--   3. PARAMS ARE AN ALLOW-LIST, not a blob handed verbatim to a colleague's browser (projexa_job__params_ok): per type, only the keys the laptop workers read, flat values only (no nesting), bounded lengths --
--        boq_rollup     {boqId?: id}                          the BOQ must belong to the job's own project (else the one 404: a BOQ of a project the person cannot read is indistinguishable from none)
--        csv_export     {kind: sync kind, columns?: <= 50 column names [A-Za-z0-9_]{1,64}}
--        report_preview {kind: sync kind, sampleSize?: whole number 1..1000}
--        search_index   {kinds?: 1..8 sync kinds}
--   4. LEASED, NOT ASSIGNED. A claim has a lease (10 to 120 s, at most 5 minutes in all with heartbeats; a heartbeat never shortens a lease). A result submitted after the lease expired is refused (LEASE_EXPIRED); the job
--      is offered again; a result submitted twice for the same lease answers the first outcome (idempotent).
--   5. NOTHING WAITS FOR EVER. Expired leases and stale queued jobs are swept by projexa_job__expire for the organisation (claim, when there is anything to look at) and for the one job (get, cancel): an expired lease is
--      re-queued (failed LEASE_EXPIRED after the third attempt); a job queued for more than 24 hours fails EXPIRED. The open-job cap counts only live jobs. The requester can cancel a job (projexa_job_cancel).
--   6. THE ANSWER IS RE-CHECKED. projexa_job_get answers only the requester, only while they may still read the project, and (for a result a colleague computed) only while their view class is still the stored one;
--      otherwise the one 404.
--   7. AN IDLE POLL COSTS ~NOTHING. projexa_job_claim first resolves the person and makes ONE indexed probe for a queued job of the asked types or an expired lease in the organisation; when there is none (almost
--      always) it returns at once with next_poll_seconds 300 -- no role context, no view class (28 hidden-column lookups), no UPDATE. The requester's own jobs are found before the view class is ever computed; it is
--      computed only when a colleague's shared job is actually queued.
--
-- LIMITS: params 16 KB, result 256 KB, 30 open jobs per person, 200 jobs per person per day, 3 attempts per job, 24 hours in the queue.
-- ERRORS (coded): AW400 BAD_JOB / BAD_RESULT; AW404 NOT_FOUND (an unknown job, a project the person may not read, a BOQ outside the project: one answer); AW429 JOB_CAP. A person who does not resolve gets {"status": <reason>}.
-- GRANTS: SECURITY DEFINER, search_path = pg_catalog, pg_temp, timezone UTC; revoked from public, anon, authenticated, app_runtime; granted to service_role alone. The table and the platform.* helpers are revoked from
-- every role including service_role.
-- DATA LOSS: none. One new table and functions; applying it twice changes nothing.
-- ROLLBACK: drizzle/down/0682_projexa_work_jobs.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS platform.projexa_work_job (
  id text PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  org_id text NOT NULL,
  project_id text NOT NULL,
  type text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility text NOT NULL DEFAULT 'requester',
  view_class text NOT NULL,
  requested_by text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  lease_id text,
  claimed_by text,
  claimed_device text,
  claimed_at timestamptz,
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  result jsonb,
  result_bytes integer,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  CONSTRAINT projexa_work_job_type_check CHECK (type IN ('boq_rollup', 'csv_export', 'report_preview', 'search_index')),
  CONSTRAINT projexa_work_job_visibility_check CHECK (visibility IN ('requester', 'project')),
  CONSTRAINT projexa_work_job_status_check CHECK (status IN ('queued', 'claimed', 'done', 'failed', 'cancelled')),
  CONSTRAINT projexa_work_job_attempts_check CHECK (attempts BETWEEN 0 AND 3)
);
CREATE INDEX IF NOT EXISTS projexa_work_job_queue_idx ON platform.projexa_work_job (org_id, status, created_at) WHERE status IN ('queued', 'claimed');
CREATE INDEX IF NOT EXISTS projexa_work_job_requester_idx ON platform.projexa_work_job (requested_by, created_at DESC);
ALTER TABLE platform.projexa_work_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.projexa_work_job FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.projexa_work_job FROM PUBLIC, anon, authenticated, app_runtime, service_role;

-- params: the allow-list per type (rule 3) ------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.projexa_job__params_ok(p_type text, p_params jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_keys text[];
  v_allowed text[];
  v_kinds text[] := public.projexa_sync__kinds();
  v jsonb;
BEGIN
  IF p_params IS NULL OR jsonb_typeof(p_params) IS DISTINCT FROM 'object' OR length(p_params::text) > 16384 THEN
    RETURN false;
  END IF;
  v_keys := ARRAY(SELECT jsonb_object_keys(p_params));
  v_allowed := CASE p_type WHEN 'boq_rollup' THEN ARRAY['boqId'] WHEN 'csv_export' THEN ARRAY['kind', 'columns'] WHEN 'report_preview' THEN ARRAY['kind', 'sampleSize'] WHEN 'search_index' THEN ARRAY['kinds'] END;
  IF v_allowed IS NULL OR NOT (v_keys <@ v_allowed) THEN
    RETURN false;
  END IF;
  IF p_type = 'boq_rollup' THEN
    v := p_params -> 'boqId';
    RETURN v IS NULL OR (jsonb_typeof(v) = 'string' AND (v #>> '{}') ~ '^[A-Za-z0-9._:-]{1,64}$');
  END IF;
  IF p_type IN ('csv_export', 'report_preview') THEN
    v := p_params -> 'kind';
    IF v IS NULL OR jsonb_typeof(v) <> 'string' OR (v #>> '{}') <> ALL (v_kinds) THEN
      RETURN false;
    END IF;
  END IF;
  IF p_type = 'csv_export' THEN
    v := p_params -> 'columns';
    RETURN v IS NULL OR (jsonb_typeof(v) = 'array' AND jsonb_array_length(v) BETWEEN 1 AND 50
                         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^[A-Za-z0-9_]{1,64}$'));
  END IF;
  IF p_type = 'report_preview' THEN
    v := p_params -> 'sampleSize';
    RETURN v IS NULL OR (jsonb_typeof(v) = 'number' AND (v #>> '{}') ~ '^[0-9]{1,4}$' AND (v #>> '{}')::integer BETWEEN 1 AND 1000);
  END IF;
  -- search_index
  v := p_params -> 'kinds';
  RETURN v IS NULL OR (jsonb_typeof(v) = 'array' AND jsonb_array_length(v) BETWEEN 1 AND 8
                       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') <> ALL (v_kinds)));
END
$fn$;

-- expiry (rule 5): only rows that really expired are touched; p_job narrows it to one job ----------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.projexa_job__expire(p_org text, p_job text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_a integer;
  v_b integer;
  v_c integer;
BEGIN
  UPDATE platform.projexa_work_job SET status = 'queued', lease_id = NULL, claimed_by = NULL, claimed_device = NULL
   WHERE org_id = p_org AND (p_job IS NULL OR id = p_job) AND status = 'claimed' AND lease_expires_at < clock_timestamp() AND attempts < 3;
  GET DIAGNOSTICS v_a = ROW_COUNT;
  UPDATE platform.projexa_work_job SET status = 'failed', error_code = 'LEASE_EXPIRED', finished_at = clock_timestamp()
   WHERE org_id = p_org AND (p_job IS NULL OR id = p_job) AND status = 'claimed' AND lease_expires_at < clock_timestamp() AND attempts >= 3;
  GET DIAGNOSTICS v_b = ROW_COUNT;
  UPDATE platform.projexa_work_job SET status = 'failed', error_code = 'EXPIRED', finished_at = clock_timestamp()
   WHERE org_id = p_org AND (p_job IS NULL OR id = p_job) AND status = 'queued' AND created_at < clock_timestamp() - interval '24 hours';
  GET DIAGNOSTICS v_c = ROW_COUNT;
  RETURN v_a + v_b + v_c;
END
$fn$;

-- enqueue -----------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_job_enqueue(p_sub text, p_email text, p_project_id text, p_type text, p_params jsonb, p_visibility text DEFAULT 'requester')
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
  v_id text;
BEGIN
  IF p_type IS NULL OR p_type NOT IN ('boq_rollup', 'csv_export', 'report_preview', 'search_index')
     OR p_visibility IS NULL OR p_visibility NOT IN ('requester', 'project')
     OR NOT platform.projexa_job__params_ok(p_type, p_params)
     OR p_project_id IS NULL OR p_project_id = '' OR char_length(p_project_id) > 128 THEN
    RAISE EXCEPTION 'BAD_JOB' USING ERRCODE = 'AW400';
  END IF;
  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  v_ctx := public.projexa_sync__ctx(v_user, v_org);
  IF v_ctx IS NULL THEN
    RETURN jsonb_build_object('status', 'not_linked');
  END IF;
  IF public.ai_work_link__bind(v_ctx, p_project_id) IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  -- an id inside params must belong to the job's own project
  IF p_params ? 'boqId' AND NOT EXISTS (SELECT 1 FROM compliance.construction_boqs b WHERE b.id = (p_params ->> 'boqId') AND b.org_id = v_org AND b.project_id = p_project_id) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  -- open = still live: queued for under 24 hours, or claimed with a lease that has not run out
  IF (SELECT count(*) FROM platform.projexa_work_job j WHERE j.requested_by = v_user
        AND ((j.status = 'queued' AND j.created_at > clock_timestamp() - interval '24 hours') OR (j.status = 'claimed' AND j.lease_expires_at >= clock_timestamp()))) >= 30
     OR (SELECT count(*) FROM platform.projexa_work_job j WHERE j.requested_by = v_user AND j.created_at > clock_timestamp() - interval '1 day') >= 200 THEN
    RAISE EXCEPTION 'JOB_CAP' USING ERRCODE = 'AW429';
  END IF;
  INSERT INTO platform.projexa_work_job (org_id, project_id, type, params, visibility, view_class, requested_by)
  VALUES (v_org, p_project_id, p_type, p_params, p_visibility, public.projexa_sync__view_class(v_org, v_ctx ->> 'live_role'), v_user)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('status', 'ok', 'job_id', v_id);
END
$fn$;

-- claim: a lease on the oldest job this person may run ------------------------------------------------------------------------------------------
-- Answer: {status, job: {...} | null, next_poll_seconds}. next_poll_seconds: 0 with a job; 300 when nothing in the organisation is waiting; 60 when something waits that this person may not run.
CREATE OR REPLACE FUNCTION public.projexa_job_claim(p_sub text, p_email text, p_device_id text, p_types text[], p_lease_seconds integer DEFAULT 60)
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
  v_role text;
  v_view text;
  v_job record;
  v_lease text := replace(gen_random_uuid()::text, '-', '');
  v_secs integer := least(greatest(coalesce(p_lease_seconds, 60), 10), 120);
BEGIN
  IF p_device_id IS NULL OR p_device_id !~ '^[A-Za-z0-9_-]{8,64}$' OR p_types IS NULL OR cardinality(p_types) < 1 OR cardinality(p_types) > 8 THEN
    RAISE EXCEPTION 'BAD_JOB' USING ERRCODE = 'AW400';
  END IF;
  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;

  -- the idle poll: one indexed probe, then home
  IF NOT EXISTS (SELECT 1 FROM platform.projexa_work_job j
                  WHERE j.org_id = v_org AND j.status IN ('queued', 'claimed') AND j.type = ANY (p_types)
                    AND (j.status = 'queued' OR j.lease_expires_at < clock_timestamp())) THEN
    RETURN jsonb_build_object('status', 'ok', 'job', NULL, 'next_poll_seconds', 300);
  END IF;

  v_ctx := public.projexa_sync__ctx(v_user, v_org);
  IF v_ctx IS NULL THEN
    RETURN jsonb_build_object('status', 'not_linked');
  END IF;
  v_role := v_ctx ->> 'live_role';

  -- leases that ran out: offered again, or failed for good after the third attempt; queued for a day: failed EXPIRED
  PERFORM platform.projexa_job__expire(v_org, NULL);

  -- the requester's own jobs first: no view class needed
  SELECT j.id INTO v_job FROM platform.projexa_work_job j
  WHERE j.org_id = v_org AND j.status = 'queued' AND j.type = ANY (p_types) AND j.requested_by = v_user
  ORDER BY j.created_at, j.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND AND EXISTS (SELECT 1 FROM platform.projexa_work_job j
                           WHERE j.org_id = v_org AND j.status = 'queued' AND j.type = ANY (p_types) AND j.visibility = 'project' AND j.requested_by <> v_user) THEN
    v_view := public.projexa_sync__view_class(v_org, v_role);
    SELECT j.id INTO v_job FROM platform.projexa_work_job j
    WHERE j.org_id = v_org AND j.status = 'queued' AND j.type = ANY (p_types) AND j.visibility = 'project' AND j.requested_by <> v_user AND j.view_class = v_view
      AND EXISTS (SELECT 1 FROM compliance.projects pr WHERE pr.id = j.project_id AND pr.org_id = v_org AND public.ai_work_link__can_read_project(pr.access_level::text, pr.lead_user_id, v_user, v_role))
      -- the class stored at enqueue is still the requester's class NOW
      AND public.projexa_sync__view_class(v_org, public.projexa_sync__ctx(j.requested_by, v_org) ->> 'live_role') = j.view_class
    ORDER BY j.created_at, j.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  END IF;
  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('status', 'ok', 'job', NULL, 'next_poll_seconds', 60);
  END IF;

  UPDATE platform.projexa_work_job SET status = 'claimed', attempts = attempts + 1, lease_id = v_lease, claimed_by = v_user, claimed_device = p_device_id,
         claimed_at = clock_timestamp(), lease_started_at = clock_timestamp(), lease_expires_at = clock_timestamp() + make_interval(secs => v_secs)
   WHERE id = v_job.id;
  RETURN jsonb_build_object('status', 'ok', 'next_poll_seconds', 0, 'job', (SELECT jsonb_build_object('job_id', j.id, 'type', j.type, 'project_id', j.project_id, 'params', j.params, 'lease_id', j.lease_id,
           'lease_expires_at', to_char(j.lease_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'attempt', j.attempts, 'requested_by_you', j.requested_by = v_user)
           FROM platform.projexa_work_job j WHERE j.id = v_job.id));
END
$fn$;

-- heartbeat: more time for a long job, five minutes at most, never less than the lease already has ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_job_heartbeat(p_sub text, p_email text, p_job_id text, p_lease_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_user text;
  v_org text;
  v_reason text;
  v_j record;
  v_new timestamptz;
BEGIN
  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  SELECT * INTO v_j FROM platform.projexa_work_job j WHERE j.id = p_job_id AND j.org_id = v_org AND j.claimed_by = v_user AND j.lease_id = p_lease_id AND j.status = 'claimed' FOR UPDATE;
  IF NOT FOUND OR v_j.lease_expires_at < clock_timestamp() THEN
    RETURN jsonb_build_object('status', 'ok', 'outcome', 'lease_expired');
  END IF;
  v_new := greatest(v_j.lease_expires_at, least(clock_timestamp() + interval '60 seconds', v_j.lease_started_at + interval '5 minutes'));
  UPDATE platform.projexa_work_job SET lease_expires_at = v_new WHERE id = p_job_id;
  RETURN jsonb_build_object('status', 'ok', 'outcome', 'extended', 'lease_expires_at', to_char(v_new AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
END
$fn$;

-- result: a proposal, accepted once per lease, never written into a business table -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_job_result(p_sub text, p_email text, p_job_id text, p_lease_id text, p_ok boolean, p_result jsonb, p_error text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_user text;
  v_org text;
  v_reason text;
  v_j record;
BEGIN
  IF p_ok IS NULL OR (p_ok AND (p_result IS NULL OR length(p_result::text) > 262144)) OR (p_error IS NOT NULL AND char_length(p_error) > 64) THEN
    RAISE EXCEPTION 'BAD_RESULT' USING ERRCODE = 'AW400';
  END IF;
  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  SELECT * INTO v_j FROM platform.projexa_work_job j WHERE j.id = p_job_id AND j.org_id = v_org FOR UPDATE;
  IF NOT FOUND OR v_j.claimed_by IS DISTINCT FROM v_user OR v_j.lease_id IS DISTINCT FROM p_lease_id THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  IF v_j.status IN ('done', 'failed') THEN
    RETURN jsonb_build_object('status', 'ok', 'outcome', 'duplicate', 'job_status', v_j.status);
  END IF;
  IF v_j.status <> 'claimed' OR v_j.lease_expires_at < clock_timestamp() THEN
    RETURN jsonb_build_object('status', 'ok', 'outcome', 'lease_expired');
  END IF;
  UPDATE platform.projexa_work_job
     SET status = CASE WHEN p_ok THEN 'done' ELSE 'failed' END, result = CASE WHEN p_ok THEN p_result END, result_bytes = CASE WHEN p_ok THEN length(p_result::text) END,
         error_code = CASE WHEN p_ok THEN NULL ELSE coalesce(left(p_error, 64), 'FAILED') END, finished_at = clock_timestamp()
   WHERE id = p_job_id;
  RETURN jsonb_build_object('status', 'ok', 'outcome', 'accepted', 'job_status', CASE WHEN p_ok THEN 'done' ELSE 'failed' END);
END
$fn$;

-- get: only the requester reads the answer, and only while still entitled to it (rule 6) -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_job_get(p_sub text, p_email text, p_job_id text)
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
  v_j record;
BEGIN
  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  SELECT * INTO v_j FROM platform.projexa_work_job j WHERE j.id = p_job_id AND j.org_id = v_org AND j.requested_by = v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  v_ctx := public.projexa_sync__ctx(v_user, v_org);
  IF public.ai_work_link__bind(v_ctx, v_j.project_id) IS NULL
     OR (v_j.claimed_by IS DISTINCT FROM v_user AND v_j.claimed_by IS NOT NULL AND public.projexa_sync__view_class(v_org, v_ctx ->> 'live_role') IS DISTINCT FROM v_j.view_class) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  IF platform.projexa_job__expire(v_org, p_job_id) > 0 THEN
    SELECT * INTO v_j FROM platform.projexa_work_job j WHERE j.id = p_job_id;
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'job_status', v_j.status, 'attempts', v_j.attempts, 'type', v_j.type, 'result', v_j.result, 'error_code', v_j.error_code,
                            'ran_here', v_j.claimed_by = v_user);
END
$fn$;

-- cancel: the requester takes back a job that has not finished --------------------------------------------------------------------------------------
-- Answer: {status, outcome: 'cancelled' | 'finished', job_status}. A job already done / failed / cancelled is left as it is.
CREATE OR REPLACE FUNCTION public.projexa_job_cancel(p_sub text, p_email text, p_job_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_user text;
  v_org text;
  v_reason text;
  v_j record;
BEGIN
  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  SELECT * INTO v_j FROM platform.projexa_work_job j WHERE j.id = p_job_id AND j.org_id = v_org AND j.requested_by = v_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  IF v_j.status NOT IN ('queued', 'claimed') THEN
    RETURN jsonb_build_object('status', 'ok', 'outcome', 'finished', 'job_status', v_j.status);
  END IF;
  UPDATE platform.projexa_work_job SET status = 'cancelled', lease_id = NULL, error_code = 'CANCELLED', finished_at = clock_timestamp() WHERE id = p_job_id;
  RETURN jsonb_build_object('status', 'ok', 'outcome', 'cancelled', 'job_status', 'cancelled');
END
$fn$;

DO $$
DECLARE
  s text;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    'platform.projexa_job__params_ok(text, jsonb)',
    'platform.projexa_job__expire(text, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', s);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM app_runtime', s);
    END IF;
  END LOOP;
  FOREACH s IN ARRAY ARRAY[
    'public.projexa_job_enqueue(text, text, text, text, jsonb, text)',
    'public.projexa_job_claim(text, text, text, text[], integer)',
    'public.projexa_job_heartbeat(text, text, text, text)',
    'public.projexa_job_result(text, text, text, text, boolean, jsonb, text)',
    'public.projexa_job_get(text, text, text)',
    'public.projexa_job_cancel(text, text, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', s);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM app_runtime', s);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', s);
  END LOOP;
END $$;

COMMIT;
